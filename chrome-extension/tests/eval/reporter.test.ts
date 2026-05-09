// chrome-extension/tests/eval/reporter.test.ts
//
// Phase 14 EVAL-03 — vitest unit tests for reporter.ts (Plan 14-04).
//
// Coverage (≥7 it() blocks):
//   1. spreadInPoints W-03 boundary — 0.50/0.70 → 20pt
//   2. spreadInPoints W-03 below threshold — 0.50/0.69 → 19pt
//   3. renderReport spread block at 20pt → "**20pt**" + "Spread ≥ 20pt"
//   4. renderReport spread block at 19pt → "Spread < 20pt"
//   5. renderReport first-run path → "FIRST RUN" + 5 D-C3 sections
//   6. renderReport baseline diff path → contains Δ + ↑/↓/→
//   7. diffScores subtraction
//   8. failed-queries truncation (12 failures → 10 rows + truncation note)
//   9. loadLatestBaseline 3-file scenario → returns second-newest
//  10. W-01 source discipline — no `(qr as any).scenario` cast
//
// NO live HTTP. NO chrome.* references. NO supabase imports.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  renderReport,
  diffScores,
  loadLatestBaseline,
  spreadInPoints,
  type ScoreBucket,
} from './reporter'
import type { RunEvalResult, QueryResult } from './runner'
import type { Scenario } from './queries.schema'

// ESM __dirname.
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Repo-root .planning/eval/runs (matches reporter.ts loadLatestBaseline path).
const RUNS_DIR = resolve(__dirname, '..', '..', '..', '.planning', 'eval', 'runs')

// ───────────────── helpers ─────────────────

function makeQueryResult(
  qid: string,
  modelId: string,
  scenario: Scenario,
  override: Partial<QueryResult> = {},
): QueryResult {
  return {
    queryId: qid,
    modelId,
    scenario,
    observedToolCalls: [],
    finalAnswer: 'stub',
    toolSelectionScore: 0.5,
    toolArgsScore: 0.5,
    finalAnswerScore: 3,
    totalTokens: 1000,
    estCostUSD: 0.01,
    durationMs: 100,
    retryAttempts: 0,
    ...override,
  }
}

function makeMockResult(runId: string, override: Partial<RunEvalResult> = {}): RunEvalResult {
  return {
    runId,
    startedAt: '2026-04-29T10:00:00.000Z',
    finishedAt: '2026-04-29T10:05:00.000Z',
    totalCostUSD: 0.5,
    results: [],
    networkFailedCount: 0,
    halvesRun: ['weak', 'strong'],
    ...override,
  }
}

// ───────────────── spreadInPoints (W-03 units) ─────────────────

describe('spreadInPoints (W-03 units)', () => {
  it('weak=0.50 strong=0.70 → 20pt boundary', () => {
    expect(spreadInPoints(0.5, 0.7)).toBe(20)
  })

  it('weak=0.50 strong=0.69 → 19pt below threshold', () => {
    expect(spreadInPoints(0.5, 0.69)).toBe(19)
  })

  it('equal weighted totals → 0pt', () => {
    expect(spreadInPoints(0.6, 0.6)).toBe(0)
  })
})

// ───────────────── renderReport spread block (W-03 boundary) ─────────────────

describe('renderReport spread block (W-03)', () => {
  it('renders **20pt** and the ≥20pt threshold-satisfied message', () => {
    const result = makeMockResult('r1', {
      results: [
        // gpt-4o-mini weighted = 0.4*0.5 + 0.3*0.5 + 0.3*(2.5/5) = 0.2+0.15+0.15 = 0.50
        makeQueryResult('q-01-x', 'gpt-4o-mini', 'find-evidence', {
          toolSelectionScore: 0.5,
          toolArgsScore: 0.5,
          finalAnswerScore: 2.5,
        }),
        // claude weighted = 0.4*0.7 + 0.3*0.7 + 0.3*(3.5/5) = 0.28+0.21+0.21 = 0.70
        makeQueryResult('q-01-x', 'claude-sonnet-4-5-20250929', 'find-evidence', {
          toolSelectionScore: 0.7,
          toolArgsScore: 0.7,
          finalAnswerScore: 3.5,
        }),
      ],
    })
    const md = renderReport(result, null)
    expect(md).toContain('**20pt**')
    expect(md).toContain('Spread ≥ 20pt')
  })

  it('renders **19pt** and the <20pt warning message', () => {
    const result = makeMockResult('r2', {
      results: [
        // weak weighted = 0.50
        makeQueryResult('q-01-x', 'gpt-4o-mini', 'find-evidence', {
          toolSelectionScore: 0.5,
          toolArgsScore: 0.5,
          finalAnswerScore: 2.5,
        }),
        // strong weighted ≈ 0.69:
        // 0.4*0.69 + 0.3*0.69 + 0.3*(3.45/5) = 0.276+0.207+0.207 = 0.69
        makeQueryResult('q-01-x', 'claude-sonnet-4-5-20250929', 'find-evidence', {
          toolSelectionScore: 0.69,
          toolArgsScore: 0.69,
          finalAnswerScore: 3.45,
        }),
      ],
    })
    const md = renderReport(result, null)
    expect(md).toContain('**19pt**')
    expect(md).toContain('Spread < 20pt')
  })
})

// ───────────────── renderReport — first run + 5 sections (D-C3) ─────────────────

describe('renderReport — first-run path', () => {
  it('emits FIRST RUN message and all 5 D-C3 sections', () => {
    const result = makeMockResult('r-first', {
      results: [
        makeQueryResult('q-01-x', 'gpt-4o-mini', 'find-evidence'),
        makeQueryResult('q-01-x', 'claude-sonnet-4-5-20250929', 'find-evidence'),
      ],
    })
    const md = renderReport(result, null)
    expect(md).toContain('# PaperFlow Eval Report')
    expect(md).toContain('**Run ID**: r-first')
    expect(md).toContain('FIRST RUN')
    expect(md).toContain('## Summary')
    expect(md).toContain('## Per-model breakdown')
    expect(md).toContain('## Per-scenario breakdown')
    expect(md).toContain('## Failed queries')
    expect(md).toContain('## Cost')
  })
})

// ───────────────── renderReport — baseline diff path (Δ + emoji) ─────────────────

describe('renderReport — baseline diff path', () => {
  it('emits Δ column and at least one trend emoji (↑/↓/→)', () => {
    const baseline = makeMockResult('r-baseline', {
      results: [
        makeQueryResult('q-01-x', 'gpt-4o-mini', 'find-evidence', {
          toolSelectionScore: 0.4,
          toolArgsScore: 0.4,
          finalAnswerScore: 2.0,
        }),
        makeQueryResult('q-01-x', 'claude-sonnet-4-5-20250929', 'find-evidence', {
          toolSelectionScore: 0.6,
          toolArgsScore: 0.6,
          finalAnswerScore: 3.0,
        }),
      ],
    })
    const current = makeMockResult('r-current', {
      results: [
        makeQueryResult('q-01-x', 'gpt-4o-mini', 'find-evidence', {
          toolSelectionScore: 0.5,
          toolArgsScore: 0.5,
          finalAnswerScore: 2.5,
        }),
        makeQueryResult('q-01-x', 'claude-sonnet-4-5-20250929', 'find-evidence', {
          toolSelectionScore: 0.7,
          toolArgsScore: 0.7,
          finalAnswerScore: 3.5,
        }),
      ],
    })
    const md = renderReport(current, baseline)
    expect(md).toContain('Baseline: r-baseline')
    expect(md).toContain('Δ')
    expect(md).toMatch(/[↑↓→]/)
    // Current beat baseline → at least one ↑.
    expect(md).toContain('↑')
  })
})

// ───────────────── diffScores ─────────────────

describe('diffScores', () => {
  it('subtracts current minus baseline field-by-field', () => {
    const current: ScoreBucket = {
      toolSelection: 0.83,
      toolArgs: 0.7,
      finalAnswer: 3.8,
      weightedTotal: 0.7,
      sampleSize: 20,
    }
    const baseline: ScoreBucket = {
      toolSelection: 0.71,
      toolArgs: 0.65,
      finalAnswer: 3.5,
      weightedTotal: 0.58,
      sampleSize: 20,
    }
    const d = diffScores(current, baseline)
    expect(d.toolSelection).toBeCloseTo(0.12, 5)
    expect(d.toolArgs).toBeCloseTo(0.05, 5)
    expect(d.finalAnswer).toBeCloseTo(0.3, 5)
    expect(d.weightedTotal).toBeCloseTo(0.12, 5)
  })
})

// ───────────────── failed-queries truncation ─────────────────

describe('renderReport — failed-queries section', () => {
  it('renders 3 rows for 3 failures', () => {
    const failed1 = makeQueryResult('q-fail-1', 'gpt-4o-mini', 'find-evidence', {
      toolSelectionScore: 0,
      toolArgsScore: 0,
      finalAnswerScore: 1,
      errorMessage: 'network-error: ECONNRESET',
    })
    const failed2 = makeQueryResult('q-fail-2', 'gpt-4o-mini', 'paint-canvas', {
      toolSelectionScore: 0.1,
      toolArgsScore: 0.1,
      finalAnswerScore: 1,
    })
    const failed3 = makeQueryResult('q-fail-3', 'gpt-4o-mini', 'organize-library', {
      errorMessage: 'judge-failed',
      toolSelectionScore: 0,
      toolArgsScore: 0,
      finalAnswerScore: 1,
    })
    const result = makeMockResult('r-failed', { results: [failed1, failed2, failed3] })
    const md = renderReport(result, null)
    expect(md).toContain('q-fail-1')
    expect(md).toContain('q-fail-2')
    expect(md).toContain('q-fail-3')
    expect(md).not.toContain('more failures truncated')
  })

  it('caps at 10 rows + appends truncation note when failures > 10', () => {
    const failures: QueryResult[] = []
    for (let i = 0; i < 12; i++) {
      failures.push(
        makeQueryResult(`q-fail-${i}`, 'gpt-4o-mini', 'find-evidence', {
          toolSelectionScore: 0,
          toolArgsScore: 0,
          finalAnswerScore: 1,
          errorMessage: `network-error-${i}`,
        }),
      )
    }
    const result = makeMockResult('r-many-fail', { results: failures })
    const md = renderReport(result, null)
    expect(md).toContain('(...2 more failures truncated)')
    // First 10 should be present, last 2 not.
    const failedSection = md.split('## Failed queries')[1]?.split('## Cost')[0] ?? ''
    const rowCount = (failedSection.match(/\| q-fail-/g) ?? []).length
    expect(rowCount).toBe(10)
  })
})

// ───────────────── loadLatestBaseline (filesystem) ─────────────────

describe('loadLatestBaseline', () => {
  // Test isolates by writing temp {date}.json files into RUNS_DIR with a unique prefix.
  const PREFIX = `eval-test-baseline-${Date.now()}`
  const writtenFiles: string[] = []

  beforeEach(() => {
    if (!existsSync(RUNS_DIR)) mkdirSync(RUNS_DIR, { recursive: true })
  })

  afterEach(() => {
    for (const f of writtenFiles.splice(0)) {
      try {
        rmSync(f, { force: true })
      } catch {
        /* ignore */
      }
    }
  })

  function writeFakeRun(runId: string): string {
    const fakeResult: RunEvalResult = {
      runId,
      startedAt: '2026-04-29T10:00:00.000Z',
      finishedAt: '2026-04-29T10:01:00.000Z',
      totalCostUSD: 0,
      results: [],
      networkFailedCount: 0,
      halvesRun: [],
    }
    const path = resolve(RUNS_DIR, `${runId}.json`)
    writeFileSync(path, JSON.stringify(fakeResult, null, 2))
    writtenFiles.push(path)
    return path
  }

  it('returns the second-newest run when 3 prior files exist', () => {
    // ISO-style ids; lexical-desc = chronological-desc.
    writeFakeRun(`${PREFIX}-2026-04-27T10-00-00-000Z`)
    const second = `${PREFIX}-2026-04-28T10-00-00-000Z`
    writeFakeRun(second)
    const current = `${PREFIX}-2026-04-29T10-00-00-000Z`
    writeFakeRun(current)

    const got = loadLatestBaseline(current)
    expect(got).not.toBeNull()
    expect(got!.runId).toBe(second)
  })

  it('returns null when only the current run is present', () => {
    const current = `${PREFIX}-only-${Date.now()}-2026-04-29T10-00-00-000Z`
    writeFakeRun(current)
    const got = loadLatestBaseline(current)
    expect(got).toBeNull()
  })
})

// ───────────────── W-01 source discipline (no `as any` for scenario) ─────────────────

describe('reporter source discipline (W-01 fix)', () => {
  it('reporter.ts reads qr.scenario from the typed contract — no `as any` cast for scenario', () => {
    const src = readFileSync(resolve(__dirname, 'reporter.ts'), 'utf8')
    // No `(qr as any).scenario` or similar escape-hatch when reading scenario.
    expect(src.match(/\(\s*\w+\s*as\s+any\s*\)\s*\.\s*scenario/)).toBeNull()
  })
})
