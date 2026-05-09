// Phase ai-cost-tier-pricing — unit tests for cost-plus calculator core.
//
// Run with: node --test scripts/ai-cost-analysis.test.mjs
//
// Tests use inline fixtures only — never read scripts/data/*.json so this
// suite can run in isolation and never depends on the actual pricing values
// (which will change over time).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  costPerCall,
  weightedCostPerCall,
  monthlyCost,
  recommendedPrice,
  marginAtPrice,
  generateReport,
} from './ai-cost-analysis.mjs'

test('costPerCall: hand-computed sample', () => {
  // (1000 × 2 + 500 × 8) / 1e6 = (2000 + 4000) / 1e6 = 0.006
  const c = costPerCall(
    { input_price_per_1m: 2, output_price_per_1m: 8 },
    { prompt_tokens: 1000, output_tokens: 500 },
  )
  assert.equal(c, 0.006)
})

test('costPerCall: tbd input price returns null (no fabrication)', () => {
  const c = costPerCall(
    { input_price_per_1m: 'tbd', output_price_per_1m: 8 },
    { prompt_tokens: 1000, output_tokens: 500 },
  )
  assert.equal(c, null)
})

test('costPerCall: tbd output price returns null', () => {
  const c = costPerCall(
    { input_price_per_1m: 2, output_price_per_1m: 'tbd' },
    { prompt_tokens: 1000, output_tokens: 500 },
  )
  assert.equal(c, null)
})

test('weightedCostPerCall: distribution weighting', () => {
  // kind A: cost = (1000×2 + 500×8) / 1e6 = 0.006
  // kind B: cost = (2000×2 + 1000×8) / 1e6 = 0.012
  // weighted: 0.6×0.006 + 0.4×0.012 = 0.0036 + 0.0048 = 0.0084
  const w = weightedCostPerCall(
    { input_price_per_1m: 2, output_price_per_1m: 8 },
    {
      kinds: [
        { kind: 'a', prompt_tokens: 1000, output_tokens: 500 },
        { kind: 'b', prompt_tokens: 2000, output_tokens: 1000 },
      ],
    },
    { a: 0.6, b: 0.4 },
  )
  assert.ok(Math.abs(w - 0.0084) < 1e-9, `expected ~0.0084, got ${w}`)
})

test('weightedCostPerCall: missing distribution key skipped (no exception)', () => {
  // Only kind A weighted; kind B has no distribution entry — skipped.
  // weighted = 0.5 × 0.006 = 0.003
  const w = weightedCostPerCall(
    { input_price_per_1m: 2, output_price_per_1m: 8 },
    {
      kinds: [
        { kind: 'a', prompt_tokens: 1000, output_tokens: 500 },
        { kind: 'b', prompt_tokens: 9999, output_tokens: 9999 },
      ],
    },
    { a: 0.5 },
  )
  assert.equal(w, 0.003)
})

test('monthlyCost: weighted × calls', () => {
  // weighted = 0.006, calls = 30000 → 180
  const m = monthlyCost(
    { input_price_per_1m: 2, output_price_per_1m: 8 },
    { kinds: [{ kind: 'a', prompt_tokens: 1000, output_tokens: 500 }] },
    { a: 1.0 },
    30000,
  )
  assert.equal(m, 180)
})

test('recommendedPrice: cost-plus inverse', () => {
  // All assertions use epsilon comparison — IEEE-754 means 5/(1-0.5) = 9.999...8.
  const close = (a, b) => Math.abs(a - b) < 1e-9
  // cost = 3, margin = 0.70 → 3 / 0.30 = 10
  assert.ok(close(recommendedPrice(3, 0.70), 10))
  // cost = 5, margin = 0.50 → 10
  assert.ok(close(recommendedPrice(5, 0.50), 10))
  // cost = 1, margin = 0.85 → 1 / 0.15 ≈ 6.6666...
  assert.ok(Math.abs(recommendedPrice(1, 0.85) - 6.6667) < 0.001)
})

test('recommendedPrice: null cost propagates null', () => {
  assert.equal(recommendedPrice(null, 0.70), null)
})

test('recommendedPrice: invalid margin throws', () => {
  assert.throws(() => recommendedPrice(3, 1.0), /margin/)
  assert.throws(() => recommendedPrice(3, -0.1), /margin/)
})

test('marginAtPrice: positive margin', () => {
  // cost=3, price=12 → margin = 9/12 = 0.75
  assert.equal(marginAtPrice(3, 12), 0.75)
})

test('marginAtPrice: cost ≥ price returns null (loss case marked separately)', () => {
  assert.equal(marginAtPrice(15, 12), null)
  assert.equal(marginAtPrice(12, 12), null)
})

test('marginAtPrice: null cost or non-positive price returns null', () => {
  assert.equal(marginAtPrice(null, 12), null)
  assert.equal(marginAtPrice(3, 0), null)
  assert.equal(marginAtPrice(3, -1), null)
})

test('generateReport: integration smoke (no exception, non-empty output, all 5 tables)', () => {
  const pricing = {
    fetched_at: '2026-05-07',
    models: [
      { id: 'm1', display_name: 'M1', provider: 'openai', tier_class: 'mini', input_price_per_1m: 1, output_price_per_1m: 4 },
      { id: 'm2', display_name: 'M2', provider: 'anthropic', tier_class: 'flagship', input_price_per_1m: 3, output_price_per_1m: 15 },
    ],
  }
  const workload = {
    version: 'test-fixture',
    kinds: [
      { kind: 'chat', prompt_tokens: 8000, output_tokens: 1500 },
      { kind: 'summary', prompt_tokens: 12000, output_tokens: 2000 },
    ],
    kind_distribution: { chat: 0.7, summary: 0.3 },
    alternative_distributions: {
      'chat-heavy': { chat: 0.9, summary: 0.1 },
    },
  }
  const md = generateReport(pricing, workload, {
    margin: 0.7, callsPerMonth: 30000, proPrice: 12, syncPrice: 4,
  })
  assert.ok(md.length > 500, `expected non-trivial report, got ${md.length} bytes`)
  assert.ok(md.includes('表 1：单次调用成本'), 'missing table 1')
  assert.ok(md.includes('表 2：Pro tier 月成本'), 'missing table 2')
  assert.ok(md.includes('表 3：cost-plus 推荐零售价'), 'missing table 3')
  assert.ok(md.includes('表 4：现行 Pro $12.00'), 'missing table 4')
  assert.ok(md.includes('表 5：敏感性分析'), 'missing table 5')
  assert.ok(md.includes('M1'), 'missing model row')
  assert.ok(md.includes('chat-heavy'), 'missing alternative distribution column')
})
