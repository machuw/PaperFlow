// chrome-extension/tests/e2e/_jwt-fixture.ts
//
// Phase 24 — service-role JWT mint helper for e2e tests.
// Mints a real HS256-signed Supabase session JWT via service-role admin
// API + jose; consumers seed it into chrome.storage.local under the
// sb-127-auth-token key (E2E-01 + E2E-02).
//
// SECURITY: This file MUST stay under chrome-extension/tests/e2e/. Never
// import from chrome-extension/reader/, options/, background/, content/ —
// service-role key would leak into production bundle. Build-safety guard:
// chrome-extension/tests/lib/service-role-key-leak-guard.test.ts.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as jose from 'jose';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// tests/e2e/<file> → 3 layers up to repo root → supabase/.env
const ENV_PATH = resolve(__dirname, '../../../supabase/.env');
const LOCAL_SUPABASE_URL = 'http://127.0.0.1:54321';

// Computed from VITE_SUPABASE_URL=http://127.0.0.1:54321 → host '127.0.0.1' →
// split('.')[0] = '127' → 'sb-127-auth-token'.
// Source: chrome-extension/node_modules/@supabase/supabase-js/dist/index.cjs:373
// (defaultStorageKey formula: `sb-${baseUrl.hostname.split('.')[0]}-auth-token`)
export const EXPECTED_STORAGE_KEY = 'sb-127-auth-token' as const;

// Shared regex between mint side and _global-teardown.ts cleanup side (D-10)
export const E2E_EMAIL_PATTERN = /^e2e-.*@e2e\.test$/;

let _adminClient: SupabaseClient | null = null;

function loadEnv(): { SERVICE_ROLE_KEY: string; JWT_SECRET: string } {
  if (!existsSync(ENV_PATH)) {
    throw new Error(
      `[mintTestUserJWT] supabase/.env missing at ${ENV_PATH}. ` +
        `Run \`supabase start\` and copy supabase/.env.example to supabase/.env.`,
    );
  }
  const env = readFileSync(ENV_PATH, 'utf-8');
  const SERVICE_ROLE_KEY = env.match(/^SUPABASE_SERVICE_ROLE_KEY=(.+)$/m)?.[1]?.trim();
  const JWT_SECRET = env.match(/^JWT_SECRET=(.+)$/m)?.[1]?.trim();
  if (!SERVICE_ROLE_KEY || !JWT_SECRET) {
    throw new Error(
      `[mintTestUserJWT] supabase/.env missing SUPABASE_SERVICE_ROLE_KEY or JWT_SECRET. ` +
        `Append: JWT_SECRET=super-secret-jwt-token-with-at-least-32-characters-long`,
    );
  }
  if (JWT_SECRET.length < 32) {
    // HS256 safety per ASVS V6 + Pitfall 6 — Supabase Auth gateway also enforces
    throw new Error(`[mintTestUserJWT] JWT_SECRET length < 32 (HS256 unsafe).`);
  }
  return { SERVICE_ROLE_KEY, JWT_SECRET };
}

function getAdminClient(): SupabaseClient {
  if (_adminClient) return _adminClient;
  const { SERVICE_ROLE_KEY } = loadEnv();
  _adminClient = createClient(LOCAL_SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _adminClient;
}

export async function mintTestUserJWT(
  userId: string,
  tier: 'free' | 'sync' | 'pro',
): Promise<{ jwt: string; user_id: string; email: string; cleanup: () => Promise<void> }> {
  const { JWT_SECRET } = loadEnv();
  const sb = getAdminClient();
  const email = `e2e-${userId}-${tier}@e2e.test`;

  // 1. Create auth.users — Pitfall 7: password required even though never used.
  // Trigger on_auth_user_created (004_triggers.sql:17-26) auto-inserts
  // (user_id, tier='free') row into subscriptions.
  const { data: created, error } = await sb.auth.admin.createUser({
    email,
    password: globalThis.crypto.randomUUID(),
    email_confirm: true, // skip OTP flow
  });
  if (error || !created.user) {
    throw new Error(`[mintTestUserJWT] admin.createUser failed: ${error?.message ?? 'no user'}`);
  }
  const user = created.user;

  // 2. Mint HS256 JWT mirroring real Supabase session payload (D-03).
  const secret = new TextEncoder().encode(JWT_SECRET);
  const now = Math.floor(Date.now() / 1000);
  const jwt = await new jose.SignJWT({
    aud: 'authenticated',
    sub: user.id,
    email,
    role: 'authenticated',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(secret);

  // 3. CRITICAL: upsert NOT insert (Pitfall 1) — handle_new_user trigger
  // already inserted (user_id, tier='free') row; insert would 23505 unique violation.
  // Source: supabase/migrations/004_triggers.sql:17-26
  if (tier !== 'free') {
    const { error: subErr } = await sb
      .from('subscriptions')
      .upsert({ user_id: user.id, tier }, { onConflict: 'user_id' });
    if (subErr) {
      throw new Error(`[mintTestUserJWT] subscriptions upsert failed: ${subErr.message}`);
    }
  }

  // 4. Cleanup closure — defense-in-depth alongside globalTeardown.
  const cleanup = async (): Promise<void> => {
    await sb.auth.admin.deleteUser(user.id); // CASCADE → subscriptions row deleted
  };

  return { jwt, user_id: user.id, email, cleanup };
}
