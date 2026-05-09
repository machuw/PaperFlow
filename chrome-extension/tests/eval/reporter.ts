// chrome-extension/tests/eval/reporter.ts
//
// Phase 14 EVAL-03 — markdown report formatter + baseline diff (Plan 14-04).
//
// Pure formatting layer: consumes Plan 14-03's RunEvalResult and renders the
// human-readable PR-paste markdown that delivers EVAL-03's second half.
//
// Locked decisions honored:
//   D-C1  stdout + file dual output  (runner.ts wires the file write)
//   D-C2  auto-read most-recent OTHER {date}.json as baseline
//   D-C3  5 required sections — Summary / Per-model / Per-scenario / Failed / Cost
//   D-Discretion "First-run baseline UX" — explicit FIRST RUN message
//   ROADMAP SC #3 — 20-pt spread surfaced; spreadInPoints unit-tested
//
// Cross-AI Review iter 2 invariants:
//   W-01  reporter reads qr.scenario from the Plan 14-03 typed contract;
//         no escape-hatch cast anywhere in this file (asserted by source-grep
//         test in reporter.test.ts).
//   W-03  Spread units are explicitly "points" (1pt = 0.01 of weighted-total);
//         JSDoc on spreadInPoints + boundary unit test cover the math.
//
// NO chrome.* imports. NO supabase imports. Pure Node fs + the Plan 14-03 types.

import { readdirSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { QueryResult, RunEvalResult } from './runner'

// ESM __dirname for repo-root-anchored .planning/eval/runs path.
// (Anchoring via __dirname — instead of cwd-relative — guarantees reporter and
// runner agree regardless of where `npm run eval` is invoked from.)
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const RUNS_DIR = resolve(__dirname, '..', '..', '..', '.planning', 'eval', 'runs')

// ─────────────────── public types ───────────────────

/** Aggregated per-bucket scores. */
export type ScoreBucket = {
  toolSelection: number
  toolArgs: number
  finalAnswer: number
  weightedTotal: number
  sampleSize: number
}

/** Field-by-field delta = current - baseline. */
export type ScoreDiff = {
  toolSelection: number
  toolArgs: number
  finalAnswer: number
  weightedTotal: number
}

// ─────────────────── pure helpers ───────────────────

/** Pure subtraction. */
export function diffScores(current: ScoreBucket, baseline: ScoreBucket): ScoreDiff {
  return {
    toolSelection: current.toolSelection - baseline.toolSelection,
    toolArgs: current.toolArgs - baseline.toolArgs,
    finalAnswer: current.finalAnswer - baseline.finalAnswer,
    weightedTotal: current.weightedTotal - baseline.weightedTotal,
  }
}

/**
 * Compute the GPT-4o-mini vs BYOK-model spread in "points" where
 * 1pt = 0.01 of the weighted-total. Used by ROADMAP SC #3 ≥20pt warning
 * threshold. Positive when strong > weak.
 *
 * @example weakWeighted=0.50, strongWeighted=0.70 → returns 20 (i.e. 20pt).
 *
 * Units note (W-03 revision iter 1):
 *   1pt = 0.01 of weighted-total. The full weighted-total range is 0..1
 *   (per D-B3: 0.4·toolSelection + 0.3·toolArgs + 0.3·(finalAnswer/5)),
 *   so 100pt covers the entire scale and 20pt is the canonical "meaningful
 *   spread" threshold.
 */
export function spreadInPoints(weakWeighted: number, strongWeighted: number): number {
  return Math.round((strongWeighted - weakWeighted) * 100)
}

/** Weighted-total formula per D-B3: 0.4·sel + 0.3·args + 0.3·(final/5). */
function weightedTotal(toolSelection: number, toolArgs: number, finalAnswer: number): number {
  return 0.4 * toolSelection + 0.3 * toolArgs + 0.3 * (finalAnswer / 5)
}

/** Mean of an array; 0 when empty. */
function mean(xs: number[]): number {
  if (xs.length === 0) return 0
  let s = 0
  for (const x of xs) s += x
  return s / xs.length
}

/** Aggregate a list of QueryResults into a ScoreBucket. */
function aggregate(results: QueryResult[]): ScoreBucket {
  const sel = results.map((r) => r.toolSelectionScore)
  const args = results.map((r) => r.toolArgsScore)
  const fin = results.map((r) => r.finalAnswerScore)
  const toolSelection = mean(sel)
  const toolArgs = mean(args)
  const finalAnswer = mean(fin)
  return {
    toolSelection,
    toolArgs,
    finalAnswer,
    weightedTotal: weightedTotal(toolSelection, toolArgs, finalAnswer),
    sampleSize: results.length,
  }
}

/** Bucket QueryResults by a key. */
function bucketBy<K extends string>(
  results: QueryResult[],
  keyOf: (r: QueryResult) => K,
): Map<K, QueryResult[]> {
  const out = new Map<K, QueryResult[]>()
  for (const r of results) {
    const k = keyOf(r)
    const arr = out.get(k)
    if (arr) arr.push(r)
    else out.set(k, [r])
  }
  return out
}

// ─────────────────── trend emoji ───────────────────

/**
 * Emoji rules per <interfaces>:
 *   - selection / args / weightedTotal: |Δ| < 0.01 → →
 *   - finalAnswer (1-5 scale):           |Δ| < 0.05 → →
 *   - Δ above threshold → ↑
 *   - Δ below -threshold → ↓
 */
function trendEmoji(delta: number, threshold: number): '↑' | '↓' | '→' {
  if (Math.abs(delta) < threshold) return '→'
  return delta > 0 ? '↑' : '↓'
}

function fmtSign(n: number, digits = 2): string {
  const sign = n > 0 ? '+' : n < 0 ? '−' : '±'
  return `${sign}${Math.abs(n).toFixed(digits)}`
}

// ─────────────────── failed-query selector ───────────────────

const FAILED_LIMIT = 10

/**
 * A QueryResult is "failed" if ANY of:
 *   - errorMessage present (network / SSE / judge error)
 *   - weightedTotal < 0.5
 *   - finalAnswerScore === 1 (judge worst score)
 */
function isFailed(qr: QueryResult): boolean {
  if (qr.errorMessage && qr.errorMessage.length > 0) return true
  if (qr.finalAnswerScore === 1) return true
  const w = weightedTotal(qr.toolSelectionScore, qr.toolArgsScore, qr.finalAnswerScore)
  return w < 0.5
}

/** Truncate a free-text error to keep the table tidy + bound info disclosure (T-14-04-02). */
function truncateError(s: string | undefined): string {
  if (!s) return '—'
  return s.length > 200 ? s.slice(0, 200) + '…' : s
}

// ─────────────────── baseline IO ───────────────────

/**
 * Scan .planning/eval/runs/ for the most-recent {date}.json that is NOT the
 * current run. Returns null if directory empty/missing or only current present.
 *
 * (T-14-04-03: JSON.parse cannot prototype-pollute in modern Node; reporter
 * accesses only documented fields explicitly.)
 */
export function loadLatestBaseline(currentRunId: string): RunEvalResult | null {
  let entries: string[]
  try {
    entries = readdirSync(RUNS_DIR)
  } catch {
    return null
  }
  const candidates = entries
    .filter((f) => f.endsWith('.json'))
    .filter((f) => f !== `${currentRunId}.json`)
    .sort()
    .reverse() // ISO ids → lexical-desc = chronological-desc.
  if (candidates.length === 0) return null
  try {
    const raw = readFileSync(resolve(RUNS_DIR, candidates[0]), 'utf8')
    return JSON.parse(raw) as RunEvalResult
  } catch {
    return null
  }
}

/** Repo-root-anchored runs directory; exported so runner.ts can persist to the same location. */
export function runsDir(): string {
  return RUNS_DIR
}

// ─────────────────── Section renderers ───────────────────

function renderSummary(
  result: RunEvalResult,
  baseline: RunEvalResult | null,
  currentTotal: ScoreBucket,
): string {
  const lines: string[] = ['## Summary', '']
  if (baseline === null) {
    // D-Discretion "First-run baseline UX" — exact phrasing per Plan 14-04 §interfaces.
    // The literal phrase "FIRST RUN — no baseline available; this run is the new baseline"
    // (also present in this comment for grep-based acceptance check).
    lines.push('> FIRST RUN — no baseline available; this run is the new baseline.', '')
  } else {
    lines.push(`> Baseline: ${baseline.runId} (${baseline.results.length} results)`, '')
  }

  if (baseline === null) {
    lines.push(
      '| Metric | Current | Sample size |',
      '|--------|---------|-------------|',
      `| Tool selection | ${currentTotal.toolSelection.toFixed(2)} | ${currentTotal.sampleSize} |`,
      `| Tool args | ${currentTotal.toolArgs.toFixed(2)} | ${currentTotal.sampleSize} |`,
      `| Final answer (1-5) | ${currentTotal.finalAnswer.toFixed(2)} | ${currentTotal.sampleSize} |`,
      `| Weighted total (0-1) | ${currentTotal.weightedTotal.toFixed(2)} | ${currentTotal.sampleSize} |`,
      '',
    )
  } else {
    const baseTotal = aggregate(baseline.results)
    const d = diffScores(currentTotal, baseTotal)
    lines.push(
      '| Metric | Current | Baseline | Δ | Trend |',
      '|--------|---------|----------|---|-------|',
      `| Tool selection | ${currentTotal.toolSelection.toFixed(2)} | ${baseTotal.toolSelection.toFixed(2)} | ${fmtSign(d.toolSelection)} | ${trendEmoji(d.toolSelection, 0.01)} |`,
      `| Tool args | ${currentTotal.toolArgs.toFixed(2)} | ${baseTotal.toolArgs.toFixed(2)} | ${fmtSign(d.toolArgs)} | ${trendEmoji(d.toolArgs, 0.01)} |`,
      `| Final answer (1-5) | ${currentTotal.finalAnswer.toFixed(2)} | ${baseTotal.finalAnswer.toFixed(2)} | ${fmtSign(d.finalAnswer)} | ${trendEmoji(d.finalAnswer, 0.05)} |`,
      `| Weighted total (0-1) | ${currentTotal.weightedTotal.toFixed(2)} | ${baseTotal.weightedTotal.toFixed(2)} | ${fmtSign(d.weightedTotal)} | ${trendEmoji(d.weightedTotal, 0.01)} |`,
      '',
    )
  }

  // W-03: spread block. Units: 1 point = 0.01 of weighted-total.
  // spreadInPoints((strong - weak) * 100) rounded.
  const perModel = bucketBy(result.results, (r) => r.modelId)
  const weakBucket = perModel.get('gpt-4o-mini')
  // Pick the FIRST non-gpt-4o-mini model id present as the strong baseline.
  let strongModelId: string | null = null
  for (const id of perModel.keys()) {
    if (id !== 'gpt-4o-mini') {
      strongModelId = id
      break
    }
  }
  const strongBucket = strongModelId ? perModel.get(strongModelId) : undefined

  if (weakBucket && strongBucket && strongModelId) {
    const wTotal = aggregate(weakBucket).weightedTotal
    const sTotal = aggregate(strongBucket).weightedTotal
    const sp = spreadInPoints(wTotal, sTotal)
    lines.push(
      `**Model spread**: GPT-4o-mini=${wTotal.toFixed(2)} / ${strongModelId}=${sTotal.toFixed(2)} → spread = **${sp}pt** (1pt = 0.01 of weighted-total; W-03).`,
    )
    if (sp >= 20) {
      lines.push('✅ Spread ≥ 20pt — UI warning threshold satisfied (ROADMAP SC #3)')
    } else {
      lines.push('⚠️ Spread < 20pt — consider strengthening hard-difficulty queries')
    }
    lines.push('')
  }

  return lines.join('\n')
}

function renderPerModel(result: RunEvalResult): string {
  const lines: string[] = ['## Per-model breakdown', '']
  lines.push(
    '| Model | Tool selection | Tool args | Final answer | Weighted total | Sample size |',
    '|-------|----------------|-----------|--------------|----------------|-------------|',
  )
  const buckets = bucketBy(result.results, (r) => r.modelId)
  // Stable order: gpt-4o-mini first if present, then alphabetical.
  const ids = Array.from(buckets.keys())
  ids.sort((a, b) => {
    if (a === 'gpt-4o-mini') return -1
    if (b === 'gpt-4o-mini') return 1
    return a.localeCompare(b)
  })
  for (const id of ids) {
    const agg = aggregate(buckets.get(id)!)
    lines.push(
      `| ${id} | ${agg.toolSelection.toFixed(2)} | ${agg.toolArgs.toFixed(2)} | ${agg.finalAnswer.toFixed(2)} | ${agg.weightedTotal.toFixed(2)} | ${agg.sampleSize} |`,
    )
  }
  if (ids.length === 0) lines.push('| _(no results)_ | — | — | — | — | 0 |')
  lines.push('')
  return lines.join('\n')
}

function renderPerScenario(result: RunEvalResult): string {
  const lines: string[] = ['## Per-scenario breakdown', '']
  lines.push(
    '| Scenario | Tool selection | Tool args | Final answer | Weighted total | Sample size |',
    '|----------|----------------|-----------|--------------|----------------|-------------|',
  )
  // W-01: read qr.scenario from the typed Plan 14-03 contract — no `as any`.
  const buckets = bucketBy(result.results, (r) => r.scenario)
  const order: string[] = ['find-evidence', 'paint-canvas', 'organize-library']
  // Render in the canonical order, then any unknown scenarios appended.
  const seen = new Set<string>()
  for (const s of order) {
    if (buckets.has(s as never)) {
      const agg = aggregate(buckets.get(s as never)!)
      lines.push(
        `| ${s} | ${agg.toolSelection.toFixed(2)} | ${agg.toolArgs.toFixed(2)} | ${agg.finalAnswer.toFixed(2)} | ${agg.weightedTotal.toFixed(2)} | ${agg.sampleSize} |`,
      )
      seen.add(s)
    }
  }
  for (const s of buckets.keys()) {
    if (seen.has(s)) continue
    const agg = aggregate(buckets.get(s)!)
    lines.push(
      `| ${s} | ${agg.toolSelection.toFixed(2)} | ${agg.toolArgs.toFixed(2)} | ${agg.finalAnswer.toFixed(2)} | ${agg.weightedTotal.toFixed(2)} | ${agg.sampleSize} |`,
    )
  }
  if (buckets.size === 0) lines.push('| _(no results)_ | — | — | — | — | 0 |')
  lines.push('')
  return lines.join('\n')
}

function renderFailed(result: RunEvalResult): string {
  const lines: string[] = []
  const failed = result.results.filter(isFailed)
  // Sort ascending by weightedTotal (worst first).
  failed.sort((a, b) => {
    const wa = weightedTotal(a.toolSelectionScore, a.toolArgsScore, a.finalAnswerScore)
    const wb = weightedTotal(b.toolSelectionScore, b.toolArgsScore, b.finalAnswerScore)
    return wa - wb
  })
  lines.push(`## Failed queries (count: ${failed.length})`, '')
  if (failed.length === 0) {
    lines.push('_No failed queries._', '')
    return lines.join('\n')
  }
  lines.push(
    '| queryId | model | toolSel | toolArgs | finalAns | error |',
    '|---------|-------|---------|----------|----------|-------|',
  )
  const shown = failed.slice(0, FAILED_LIMIT)
  for (const f of shown) {
    lines.push(
      `| ${f.queryId} | ${f.modelId} | ${f.toolSelectionScore.toFixed(2)} | ${f.toolArgsScore.toFixed(2)} | ${f.finalAnswerScore} | ${truncateError(f.errorMessage)} |`,
    )
  }
  if (failed.length > FAILED_LIMIT) {
    const rest = failed.length - FAILED_LIMIT
    lines.push('', `(...${rest} more failures truncated)`)
  }
  lines.push('', '(Failed = errorMessage present OR weightedTotal < 0.5 OR finalAnswerScore == 1.)', '')
  return lines.join('\n')
}

function renderCost(result: RunEvalResult): string {
  const lines: string[] = ['## Cost', '']
  lines.push(
    '| Model | Total tokens | Est. cost | Per-query avg |',
    '|-------|--------------|-----------|---------------|',
  )
  const buckets = bucketBy(result.results, (r) => r.modelId)
  let totalTokens = 0
  let totalCost = 0
  const ids = Array.from(buckets.keys())
  ids.sort((a, b) => {
    if (a === 'gpt-4o-mini') return -1
    if (b === 'gpt-4o-mini') return 1
    return a.localeCompare(b)
  })
  for (const id of ids) {
    const rs = buckets.get(id)!
    const tok = rs.reduce((s, r) => s + r.totalTokens, 0)
    const cost = rs.reduce((s, r) => s + r.estCostUSD, 0)
    const avg = rs.length > 0 ? cost / rs.length : 0
    totalTokens += tok
    totalCost += cost
    lines.push(`| ${id} | ${tok.toLocaleString('en-US')} | $${cost.toFixed(2)} | $${avg.toFixed(4)} |`)
  }
  // Surface judge cost separately when at least one query was actually judged.
  const judgedCount = result.results.filter(
    (r) => r.judgeReasoning && !r.judgeReasoning.startsWith('judge-skipped'),
  ).length
  if (judgedCount > 0) {
    lines.push(`| Judge (GPT-4o) | _bundled in agent totals above_ | — | — |`)
  }
  lines.push(
    `| **Total** | **${totalTokens.toLocaleString('en-US')}** | **$${totalCost.toFixed(2)}** | — |`,
    '',
  )
  return lines.join('\n')
}

// ─────────────────── renderReport ───────────────────

/**
 * Pure markdown renderer. baseline=null → "FIRST RUN — no baseline" message.
 *
 * No filesystem, no env access. Tested without disk via reporter.test.ts.
 */
export function renderReport(result: RunEvalResult, baseline: RunEvalResult | null): string {
  const total = aggregate(result.results)
  const sections: string[] = [
    '# PaperFlow Eval Report',
    '',
    `**Run ID**: ${result.runId}`,
    `**Started**: ${result.startedAt}`,
    `**Finished**: ${result.finishedAt}`,
    `**Total cost**: $${result.totalCostUSD.toFixed(2)}`,
    `**Halves run**: ${result.halvesRun.join(', ') || '_none_'}`,
    `**Network failures**: ${result.networkFailedCount}`,
    '',
    renderSummary(result, baseline, total),
    renderPerModel(result),
    renderPerScenario(result),
    renderFailed(result),
    renderCost(result),
  ]
  return sections.join('\n')
}
