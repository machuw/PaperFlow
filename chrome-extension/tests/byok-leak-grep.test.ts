import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

// CONTEXT.md D-02 BYOK trust-boundary defense (Phase 10 G2 guardrail).
//
// This test is the static line of defense against accidentally leaking
// the BYOK apiKey via console / Sentry / EdgeRuntime.waitUntil / DB writes /
// thrown Error messages. The runtime sentinel-key probe in agent-run.test.ts
// (Plan 07) is the dynamic complement.
//
// Scope: every file that mentions `byokApiKey` must be free of the listed
// forbidden patterns. Today that is two files (the chokepoint and the
// Edge Function entry); Phase 11+ scope expands to runAgent abstraction.

const REPO_ROOT = resolve(__dirname, '..', '..')

// Files that legitimately handle the BYOK apiKey OR sit on its execution
// path. Phase 10 Plan 03 shipped byok-passthrough.ts (the chokepoint); Plan
// 04 shipped agent-run/index.ts (the shell). Phase 11 Plan 01 adds
// runAgent.ts to the audit set so the loop abstraction layer is statically
// verified to NOT acquire a path to the BYOK header (D-02 / T-11-01-04).
// Test gracefully skips any file not yet present.
const AUDITED_FILES = [
  'supabase/functions/_shared/byok-passthrough.ts',
  'supabase/functions/agent-run/index.ts',
  'supabase/functions/_shared/runAgent.ts',
]

// Forbidden patterns. Each matches a class of leak.
const FORBIDDEN_PATTERNS: Array<{ name: string; rx: RegExp }> = [
  {
    name: 'console call with byokApiKey argument',
    rx: /console\.(log|warn|error|info|debug)\s*\([^)]*\bbyokApiKey\b/,
  },
  {
    name: 'Sentry call with byokApiKey argument',
    rx: /Sentry\.\w+\s*\([^)]*\bbyokApiKey\b/,
  },
  {
    name: 'EdgeRuntime.waitUntil with byokApiKey argument',
    rx: /EdgeRuntime\.waitUntil\s*\([^)]*\bbyokApiKey\b/,
  },
  {
    name: 'DB write payload includes byokApiKey',
    rx: /\.from\s*\(\s*['"](agent_runs|ai_usage_log|subscriptions)['"]\s*\)\s*\.\s*(insert|update|upsert)\s*\([^)]*\bbyokApiKey\b/s,
  },
  {
    name: 'thrown Error containing byokApiKey',
    rx: /throw\s+new\s+Error\s*\([^)]*\bbyokApiKey\b/,
  },
  {
    name: 'console call dumps Authorization header',
    rx: /console\.(log|warn|error|info|debug)\s*\([^)]*\bAuthorization\b[^)]*\)/,
  },
  {
    name: 'console call dumps x-byok-authorization header',
    rx: /console\.(log|warn|error|info|debug)\s*\([^)]*x-byok-authorization/i,
  },
]

describe('BYOK apiKey leak grep guard (D-02)', () => {
  for (const rel of AUDITED_FILES) {
    const abs = resolve(REPO_ROOT, rel)

    if (!existsSync(abs)) {
      it.skip(`${rel} (not yet present — Plan 04 will create it)`, () => {})
      continue
    }

    const source = readFileSync(abs, 'utf8')

    for (const { name, rx } of FORBIDDEN_PATTERNS) {
      it(`${rel} — does not match: ${name}`, () => {
        const m = source.match(rx)
        if (m) {
          const upTo = source.slice(0, m.index!)
          const line = upTo.split('\n').length
          throw new Error(
            `D-02 leak detected in ${rel}:${line} — ${name}\n  matched: ${m[0]}`,
          )
        }
        expect(m).toBeNull()
      })
    }
  }
})
