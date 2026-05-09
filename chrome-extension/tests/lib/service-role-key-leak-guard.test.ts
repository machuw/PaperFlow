// chrome-extension/tests/lib/service-role-key-leak-guard.test.ts
//
// E2E-01 build-safety guard. service-role key MUST NEVER appear in the
// chrome-extension/dist/ production bundle. Helper file _jwt-fixture.ts
// must remain under chrome-extension/tests/e2e/ only — Vite production
// build entries (reader/options/background/content) cannot reach tests/.
//
// Defense-in-depth (D-14): structural isolation (file location) + this
// grep-guard (test layer). Mirrors Phase 23 proxy-error-grep-guard.test.ts
// fs-walk + regex idiom.
//
// Graceful-skip when dist/ missing — RESEARCH A3: CI MUST run
// `npm run build:dev` before `npm test` to make this guard effective.
// Mirrors chrome-extension/tests/byok-leak-grep.test.ts:62-69 pattern.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, resolve } from 'path';

// tests/lib/<file> → 3 layers up to repo root
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const DIST_DIR = resolve(REPO_ROOT, 'chrome-extension/dist');

// Forbidden literal — env var name should never appear in client bundle.
const FORBIDDEN_LITERAL = 'SUPABASE_SERVICE_ROLE_KEY';

// JWT shape regex — matches base64url-encoded JWT structure (3 dot-separated segments).
const JWT_SHAPE = /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

/**
 * Decode JWT middle segment to detect role:"service_role" claim.
 * Returns false on malformed tokens (anon JWTs, garbage, etc.).
 */
function isServiceRoleJWT(token: string): boolean {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return payload.role === 'service_role';
  } catch {
    return false;
  }
}

function* walk(dir: string): Generator<string> {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      yield* walk(p);
    } else if (p.endsWith('.js') || p.endsWith('.html') || p.endsWith('.json')) {
      yield p;
    }
  }
}

describe('E2E-01 service-role key leak guard', () => {
  it('dist/ contains no SUPABASE_SERVICE_ROLE_KEY env var name', () => {
    if (!existsSync(DIST_DIR)) {
      // Graceful-skip per RESEARCH A3: CI must run `npm run build:dev` first.
      console.warn(
        `[leak-guard] ${DIST_DIR} not found — run \`npm run build:dev\` first; skipping.`,
      );
      return;
    }
    const offenders: Array<{ file: string; line: number }> = [];
    for (const file of walk(DIST_DIR)) {
      const content = readFileSync(file, 'utf8');
      const idx = content.indexOf(FORBIDDEN_LITERAL);
      if (idx !== -1) {
        const line = content.slice(0, idx).split('\n').length;
        offenders.push({ file: file.replace(REPO_ROOT + '/', ''), line });
      }
    }
    if (offenders.length > 0) {
      const msg = offenders.map((o) => `  ${o.file}:${o.line}`).join('\n');
      throw new Error(
        `E2E-01 violation: SUPABASE_SERVICE_ROLE_KEY literal found in production bundle.\n` +
          `Helper file _jwt-fixture.ts must remain in chrome-extension/tests/e2e/ only.\n` +
          `Offenders:\n${msg}`,
      );
    }
    expect(offenders).toEqual([]);
  });

  it('dist/ contains no service-role JWT (decoded role==="service_role")', () => {
    if (!existsSync(DIST_DIR)) {
      console.warn(
        `[leak-guard] ${DIST_DIR} not found — run \`npm run build:dev\` first; skipping.`,
      );
      return;
    }
    const offenders: string[] = [];
    for (const file of walk(DIST_DIR)) {
      const content = readFileSync(file, 'utf8');
      const matches = content.match(JWT_SHAPE) ?? [];
      for (const tok of matches) {
        if (isServiceRoleJWT(tok)) {
          offenders.push(`${file.replace(REPO_ROOT + '/', '')}: ${tok.slice(0, 40)}...`);
        }
      }
    }
    if (offenders.length > 0) {
      throw new Error(
        `E2E-01 violation: service-role JWT decoded with role:"service_role" found in production bundle.\n` +
          `Offenders:\n  ${offenders.join('\n  ')}`,
      );
    }
    expect(offenders).toEqual([]);
  });
});
