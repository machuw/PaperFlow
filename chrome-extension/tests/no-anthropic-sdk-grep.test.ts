// chrome-extension/tests/no-anthropic-sdk-grep.test.ts
//
// PROVIDER-05 static guard. Phase 12 explicitly does NOT introduce the
// Anthropic Claude Agent SDK (selection note §4: spawn child_process,
// Edge Function cannot run it; design-center is Claude Code, not paper readers).
// This test fails the build if any future change adds an `@anthropic*` import
// or dependency under chrome-extension/reader/, supabase/functions/, or
// the root package.json.
//
// Pattern mirrors chrome-extension/tests/byok-leak-grep.test.ts — read source
// files at test time and assert forbidden strings are absent.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, resolve } from 'path';

const REPO_ROOT = resolve(__dirname, '..', '..');

const FORBIDDEN_PATTERNS = [
  /from\s+['"]@anthropic-ai\/[^'"]+['"]/,            // import ... from '@anthropic-ai/sdk'
  /from\s+['"]@anthropic\/[^'"]+['"]/,                // import ... from '@anthropic/claude-agent-sdk'
  /require\(\s*['"]@anthropic[^'"]+['"]\s*\)/,        // commonjs require
  /['"]@anthropic-ai\/claude-agent-sdk['"]/,          // package.json string ref
  /['"]@anthropic\/claude-agent-sdk['"]/,
];

const SCAN_ROOTS = [
  'chrome-extension/reader',
  'chrome-extension/options',
  'supabase/functions',
];

const SCAN_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

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

describe('PROVIDER-05: no Anthropic Claude Agent SDK', () => {
  it('source tree contains no @anthropic* imports', () => {
    const offenders: Array<{ file: string; pattern: string; line: string }> = [];
    for (const root of SCAN_ROOTS) {
      const absRoot = resolve(REPO_ROOT, root);
      for (const file of walk(absRoot)) {
        const content = readFileSync(file, 'utf-8');
        const lines = content.split('\n');
        lines.forEach((line, idx) => {
          for (const pat of FORBIDDEN_PATTERNS) {
            if (pat.test(line)) {
              offenders.push({ file: `${file}:${idx + 1}`, pattern: pat.source, line: line.trim() });
            }
          }
        });
      }
    }
    if (offenders.length > 0) {
      const msg = offenders
        .map((o) => `  ${o.file}\n    pattern: ${o.pattern}\n    line: ${o.line}`)
        .join('\n');
      throw new Error(
        `PROVIDER-05 violation: Anthropic SDK imports detected.\n` +
        `Phase 12 selection note §4 locked: spawn child_process unavailable in Edge ` +
        `Function; Path A (LiteLLM doc) is the only Anthropic route. Remove these:\n${msg}`
      );
    }
    expect(offenders).toEqual([]);
  });

  it('package.json declares no @anthropic* dependency', () => {
    const pkgPaths = ['package.json', 'chrome-extension/package.json'];
    const offenders: Array<{ file: string; key: string }> = [];
    for (const path of pkgPaths) {
      const abs = resolve(REPO_ROOT, path);
      let pkg: any;
      try {
        pkg = JSON.parse(readFileSync(abs, 'utf-8'));
      } catch {
        continue;
      }
      const buckets = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
      for (const bucket of buckets) {
        const obj = pkg[bucket] ?? {};
        for (const key of Object.keys(obj)) {
          if (key.startsWith('@anthropic-ai/') || key.startsWith('@anthropic/')) {
            offenders.push({ file: `${path}#${bucket}`, key });
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  // LOW-2 follow-up (cross-AI review): lockfile transitive audit.
  //
  // False-positive policy:
  //   The lockfile may legitimately mention `@anthropic-ai/*` strings if some
  //   transitive dependency (e.g., a future supabase-js or eval tool) pulls
  //   the SDK in indirectly without a direct dep. PROVIDER-05 forbids the
  //   *agent-runtime* SDK specifically, not all Anthropic-namespaced packages.
  //
  //   Therefore this test checks for direct-dep declarations of the agent
  //   SDK in the lockfile's top-level `packages` map; transitive entries that
  //   are not the agent SDK (e.g., `@anthropic-ai/tokenizer`) are tolerated
  //   with a console warning so reviewers can re-evaluate the dep tree.
  it('package-lock.json contains no direct @anthropic-ai/claude-agent-sdk reference', () => {
    const lockPaths = ['chrome-extension/package-lock.json', 'package-lock.json'];
    const directHits: Array<{ file: string; key: string }> = [];
    const tolerated: string[] = [];
    const FORBIDDEN_DEP_ROOTS = [
      '@anthropic-ai/claude-agent-sdk',
      '@anthropic/claude-agent-sdk',
      '@anthropic-ai/sdk',           // chat completions SDK; we only allow OpenAI-compat
    ];
    for (const path of lockPaths) {
      const abs = resolve(REPO_ROOT, path);
      let lock: any;
      try {
        lock = JSON.parse(readFileSync(abs, 'utf-8'));
      } catch {
        continue;
      }
      const packages = lock.packages ?? {};
      for (const pkgKey of Object.keys(packages)) {
        // pkgKey shape: "" (root) or "node_modules/<name>" or "node_modules/<scope>/<name>"
        for (const forbidden of FORBIDDEN_DEP_ROOTS) {
          if (pkgKey.endsWith('node_modules/' + forbidden)) {
            directHits.push({ file: path, key: pkgKey });
          }
        }
        if (pkgKey.includes('@anthropic') && !FORBIDDEN_DEP_ROOTS.some((f) => pkgKey.endsWith('node_modules/' + f))) {
          tolerated.push(`${path} :: ${pkgKey}`);
        }
      }
    }
    if (tolerated.length > 0) {
      // Informational only — see false-positive policy above.
      console.warn('PROVIDER-05 lockfile audit: tolerated transitive @anthropic-ai mentions:\n' + tolerated.join('\n'));
    }
    expect(directHits).toEqual([]);
  });
});
