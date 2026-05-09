// chrome-extension/tests/e2e/_global-teardown.ts
//
// Phase 24 — Playwright globalTeardown sweep of e2e users.
// Runs ONCE at end of full Playwright run (D-08); crash-resilient (D-09).
// D-11: non-blocking — try/catch all errors, console.warn only.

import type { FullConfig } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const E2E_EMAIL_PATTERN = /^e2e-.*@e2e\.test$/;

export default async function globalTeardown(_config: FullConfig): Promise<void> {
  try {
    const envPath = resolve(__dirname, '../../../supabase/.env');
    if (!existsSync(envPath)) {
      console.warn('[teardown] supabase/.env missing; skipping cleanup');
      return;
    }
    const env = readFileSync(envPath, 'utf-8');
    const SERVICE_ROLE_KEY = env.match(/^SUPABASE_SERVICE_ROLE_KEY=(.+)$/m)?.[1]?.trim();
    if (!SERVICE_ROLE_KEY) {
      console.warn('[teardown] SUPABASE_SERVICE_ROLE_KEY missing; skipping cleanup');
      return;
    }
    const sb = createClient('http://127.0.0.1:54321', SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data } = await sb.auth.admin.listUsers({ perPage: 1000 });
    const e2eUsers = (data?.users ?? []).filter((u) =>
      E2E_EMAIL_PATTERN.test(u.email ?? ''),
    );
    for (const u of e2eUsers) {
      await sb.auth.admin.deleteUser(u.id); // CASCADE → subscriptions row deleted
    }
    console.log(`[teardown] cleaned ${e2eUsers.length} e2e users`);
  } catch (e) {
    // D-11: non-blocking; Playwright exit code already determined.
    console.warn('[teardown] cleanup failed (non-fatal):', e);
  }
}
