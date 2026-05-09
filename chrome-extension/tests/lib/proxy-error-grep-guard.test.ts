// chrome-extension/tests/lib/proxy-error-grep-guard.test.ts
//
// PROXYERR-06 static guard. ProxyErrorCode union must live ONLY in
// supabase/functions/_shared/types.ts (the cross-boundary SoT). Any
// inline re-definition under chrome-extension/ or supabase/ fails this test.
//
// Pattern mirrors chrome-extension/tests/no-anthropic-sdk-grep.test.ts —
// fs-walk + regex on source files at test time (NOT child_process.execSync;
// per RESEARCH §Pitfall 2 — sibling grep-guards all use fs-walk).

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, resolve } from 'path';

// tests/lib/<file> → 3 layers up to repo root (NOT 2 layers like sibling tests/*.test.ts)
const REPO_ROOT = resolve(__dirname, '..', '..', '..');

const SHARED_TYPES_REL = 'supabase/functions/_shared/types.ts';
const SOURCE_OF_TRUTH = resolve(REPO_ROOT, SHARED_TYPES_REL);

// Matches inline ProxyErrorCode type definitions and ProxyErrorCode-eq
// re-assignments at line start. Does NOT match string literals (e.g. test
// fixtures) or class field annotations.
const FORBIDDEN_PATTERN =
  /^\s*(export\s+)?type\s+ProxyErrorCode\b|^\s*ProxyErrorCode\s*=/;

const SCAN_ROOTS = ['chrome-extension', 'supabase'];
const SCAN_EXTENSIONS = ['.ts', '.tsx'];

function* walk(dir: string): Generator<string> {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
      yield* walk(p);
    } else if (SCAN_EXTENSIONS.some((ext) => p.endsWith(ext))) {
      yield p;
    }
  }
}

describe('PROXYERR-06: ProxyErrorCode shared type guard', () => {
  it('only supabase/functions/_shared/types.ts defines ProxyErrorCode', () => {
    const offenders: Array<{ file: string; line: number; content: string }> = [];

    for (const root of SCAN_ROOTS) {
      const absRoot = resolve(REPO_ROOT, root);
      for (const file of walk(absRoot)) {
        // D-08: exclude SoT itself by JS path comparison (cross-platform safe)
        if (file === SOURCE_OF_TRUTH) continue;

        const content = readFileSync(file, 'utf-8');
        const lines = content.split('\n');
        lines.forEach((line, idx) => {
          if (FORBIDDEN_PATTERN.test(line)) {
            offenders.push({
              file: file.replace(REPO_ROOT + '/', ''),
              line: idx + 1,
              content: line.trim(),
            });
          }
        });
      }
    }

    if (offenders.length > 0) {
      // D-07: actionable error message — REQ id + violator file:line + fix hint
      const msg = offenders
        .map((o) => `  ${o.file}:${o.line}\n    ${o.content}`)
        .join('\n');
      throw new Error(
        `PROXYERR-06 violation: inline ProxyErrorCode definition detected.\n` +
          `Move the type to ${SHARED_TYPES_REL} and import via:\n` +
          `  client: import type { ProxyErrorCode } from '../../../supabase/functions/_shared/types'\n` +
          `  server: import type { ProxyErrorCode } from '../_shared/types.ts'\n` +
          `Offenders:\n${msg}`,
      );
    }
    expect(offenders).toEqual([]);
  });

  it('SoT file itself defines ProxyErrorCode exactly once', () => {
    // Defense-in-depth: catch typo / accidental duplicate / missed deletion in SoT
    const sotContent = readFileSync(SOURCE_OF_TRUTH, 'utf-8');
    const sotHits = sotContent
      .split('\n')
      .filter((l) => FORBIDDEN_PATTERN.test(l));
    expect(sotHits.length).toBe(1);
  });
});
