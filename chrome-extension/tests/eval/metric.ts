// chrome-extension/tests/eval/metric.ts
//
// Phase 14 EVAL-02 — pure metric functions consumed by the eval runner
// (Plan 14-03 runner.ts) and the reporter (Plan 14-04 reporter.ts).
//
// jaccardScore   — set-overlap score for tool selection (D-B3 #1)
// argsContainsScore — per-tool arg-match score (D-B3 #2)
//
// C-5 cross-AI review iter 2: argsContainsScore branches on ArgMatch.kind
// ('exact' vs 'substring') so the gold contract from queries.schema.ts is
// honored verbatim — agents passing weak substring matches against an
// 'exact' gold value (e.g. 'sec' against 'sec1-p3') correctly score 0.

import type { GoldQuery, ToolName, ArgMatch } from './queries.schema'

/**
 * Jaccard similarity: |A ∩ B| / |A ∪ B|.
 *
 * Empty-set conventions:
 *   - jaccard([], []) = 1   (both empty → perfect agreement)
 *   - jaccard(A, [])  = 0 for non-empty A (expected nothing, observed something)
 *   - jaccard([], B)  = 0 for non-empty B (likewise — symmetric)
 */
export function jaccardScore(expected: string[], observed: string[]): number {
  const E = new Set(expected)
  const O = new Set(observed)
  if (E.size === 0 && O.size === 0) return 1
  let intersect = 0
  for (const x of E) if (O.has(x)) intersect++
  const union = E.size + O.size - intersect
  return union === 0 ? 0 : intersect / union
}

/**
 * Per expected entry, find any actual call to the same tool whose args
 * match every key in argsContains under the per-key ArgMatch policy.
 *
 * Score = matched_entries / expected_entries. If expected is empty → 1.
 *
 * C-5 branches on match.kind:
 *   - kind: 'exact'     → string equality (case-sensitive); used for IDs
 *   - kind: 'substring' → case-insensitive substring; used for keywords
 */
export function argsContainsScore(
  expectedToolArgs: GoldQuery['expectedToolArgs'],
  observedCalls: Array<{ toolName: ToolName; args: Record<string, unknown> }>,
): number {
  if (expectedToolArgs.length === 0) return 1
  let matched = 0
  for (const exp of expectedToolArgs) {
    const candidates = observedCalls.filter((c) => c.toolName === exp.tool)
    const ok = candidates.some((c) =>
      Object.entries(exp.argsContains).every(([k, match]) => matchArg(c.args[k], match)),
    )
    if (ok) matched++
  }
  return matched / expectedToolArgs.length
}

function matchArg(actual: unknown, match: ArgMatch): boolean {
  if (actual == null) return false
  const av = String(actual)
  if (match.kind === 'exact') {
    return av === match.value
  }
  // substring (case-insensitive)
  return av.toLowerCase().includes(match.value.toLowerCase())
}
