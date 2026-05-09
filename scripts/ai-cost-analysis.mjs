#!/usr/bin/env node
// Phase ai-cost-tier-pricing — cost-plus calculator
//
// Reads scripts/data/model-pricing.json + scripts/data/workload-assumptions.json,
// computes per-model cost / Pro-tier monthly cost / recommended retail price /
// margin at fixed price points, and writes a markdown fragment with tables 1-5.
//
// Usage:
//   node scripts/ai-cost-analysis.mjs \
//     --pricing scripts/data/model-pricing.json \
//     --workload scripts/data/workload-assumptions.json \
//     --margin 0.70 \
//     --out docs/specs/2026-05-07-analysis-ai-cost-tier-pricing.md
//
// Optional flags:
//   --calls-per-month <int>    Override 30000 (Pro tier monthly cap)
//   --pro-price <num>          Pro tier retail USD (default 12)
//   --sync-price <num>         Sync tier retail USD (default 4) — informational only,
//                              Sync has no managed AI
//
// Pure functions (cost / weight / price / margin) are exported for unit testing
// from ai-cost-analysis.test.mjs without spawning a process.

import { readFileSync, writeFileSync } from 'node:fs'

// ---------- Pure calculation core (exported for tests) ----------

/**
 * Cost of one call given a model's per-1M-token prices and a kind's token use.
 * Returns null if either price is "tbd".
 */
export function costPerCall(model, kindAssumption) {
  const inP = model.input_price_per_1m
  const outP = model.output_price_per_1m
  if (typeof inP !== 'number' || typeof outP !== 'number') return null
  return (kindAssumption.prompt_tokens * inP + kindAssumption.output_tokens * outP) / 1_000_000
}

/**
 * Distribution-weighted cost per call across all kinds in workload.
 * Returns null if model has any "tbd" price (we can't compute partial weighted).
 */
export function weightedCostPerCall(model, workload, distribution) {
  let total = 0
  for (const kind of workload.kinds) {
    const w = distribution[kind.kind]
    if (typeof w !== 'number') continue
    const c = costPerCall(model, kind)
    if (c === null) return null
    total += c * w
  }
  return total
}

/** Pro-tier monthly cost per active user. */
export function monthlyCost(model, workload, distribution, callsPerMonth) {
  const w = weightedCostPerCall(model, workload, distribution)
  return w === null ? null : w * callsPerMonth
}

/** Cost-plus recommended retail price for a target margin (0..1). */
export function recommendedPrice(monthlyCostUsd, margin) {
  if (monthlyCostUsd === null) return null
  if (margin >= 1 || margin < 0) throw new Error(`margin must be in [0,1), got ${margin}`)
  return monthlyCostUsd / (1 - margin)
}

/** Realised margin at a fixed retail price. Returns null if price ≤ cost (loss). */
export function marginAtPrice(monthlyCostUsd, retailPrice) {
  if (monthlyCostUsd === null || retailPrice <= 0) return null
  if (monthlyCostUsd >= retailPrice) return null
  return (retailPrice - monthlyCostUsd) / retailPrice
}

// ---------- Formatting helpers ----------

function fmtUsd(x, digits = 4) {
  if (x === null || x === undefined) return 'N/A'
  return `$${x.toFixed(digits)}`
}

function fmtPct(x) {
  if (x === null || x === undefined) return 'N/A'
  if (x < 0) return `**LOSS** (${(x * 100).toFixed(1)}%)`
  return `${(x * 100).toFixed(1)}%`
}

function fmtPrice(x) {
  if (x === null || x === undefined) return 'N/A'
  return `$${x.toFixed(2)}`
}

// ---------- Report generation ----------

function table1_costPerKind(pricing, workload) {
  const lines = ['### 表 1：单次调用成本（USD，按 kind × model）', '']
  const models = pricing.models
  const header = ['kind \\ model', ...models.map((m) => m.display_name)]
  lines.push(`| ${header.join(' | ')} |`)
  lines.push(`| ${header.map(() => '---').join(' | ')} |`)
  for (const k of workload.kinds) {
    const row = [`**${k.kind}** (${k.prompt_tokens}↑/${k.output_tokens}↓)`]
    for (const m of models) {
      row.push(fmtUsd(costPerCall(m, k)))
    }
    lines.push(`| ${row.join(' | ')} |`)
  }
  return lines.join('\n')
}

function table2_monthlyCost(pricing, workload, distribution, calls) {
  const lines = [
    '### 表 2：Pro tier 月成本/用户（默认 distribution，30000 calls/月）',
    '',
    '| Model | tier_class | provider | 加权 cost/call | 月成本/用户 |',
    '| --- | --- | --- | --- | --- |',
  ]
  const rows = pricing.models.map((m) => ({
    m,
    weighted: weightedCostPerCall(m, workload, distribution),
    monthly: monthlyCost(m, workload, distribution, calls),
  }))
  rows.sort((a, b) => {
    if (a.monthly === null) return 1
    if (b.monthly === null) return -1
    return a.monthly - b.monthly
  })
  for (const { m, weighted, monthly } of rows) {
    lines.push(
      `| ${m.display_name} | ${m.tier_class} | ${m.provider} | ${fmtUsd(weighted)} | ${fmtUsd(monthly, 2)} |`,
    )
  }
  return lines.join('\n')
}

function table3_recommendedPrice(pricing, workload, distribution, calls) {
  const margins = [0.5, 0.7, 0.85]
  const lines = [
    '### 表 3：cost-plus 推荐零售价（不同目标毛利下）',
    '',
    `| Model | 月成本/用户 | @ 50% 毛利 | @ 70% 毛利 | @ 85% 毛利 |`,
    `| --- | --- | --- | --- | --- |`,
  ]
  for (const m of pricing.models) {
    const cost = monthlyCost(m, workload, distribution, calls)
    const cells = margins.map((mg) => fmtPrice(recommendedPrice(cost, mg)))
    lines.push(`| ${m.display_name} | ${fmtUsd(cost, 2)} | ${cells.join(' | ')} |`)
  }
  return lines.join('\n')
}

function table4_marginAtFixed(pricing, workload, distribution, calls, proPrice) {
  const lines = [
    `### 表 4：现行 Pro $${proPrice.toFixed(2)} 下各模型实际毛利`,
    '',
    '| Model | 月成本/用户 | 毛利 @ $' + proPrice.toFixed(2) + ' | 净利润/用户 | Verdict |',
    '| --- | --- | --- | --- | --- |',
  ]
  const rows = pricing.models.map((m) => {
    const cost = monthlyCost(m, workload, distribution, calls)
    const margin = marginAtPrice(cost, proPrice)
    const profit = cost === null ? null : proPrice - cost
    let verdict = '—'
    if (cost === null) verdict = 'N/A (tbd 价格)'
    else if (cost > proPrice) verdict = '🔴 亏损'
    else if (margin >= 0.7) verdict = '🟢 健康（≥70%）'
    else if (margin >= 0.5) verdict = '🟡 偏低（50-70%）'
    else verdict = '🟠 危险（<50%）'
    return { m, cost, margin, profit, verdict }
  })
  rows.sort((a, b) => {
    if (a.cost === null) return 1
    if (b.cost === null) return -1
    return a.cost - b.cost
  })
  for (const r of rows) {
    lines.push(
      `| ${r.m.display_name} | ${fmtUsd(r.cost, 2)} | ${fmtPct(r.margin)} | ${fmtUsd(r.profit, 2)} | ${r.verdict} |`,
    )
  }
  return lines.join('\n')
}

function table5_sensitivity(pricing, workload, calls) {
  const variants = {
    default: workload.kind_distribution,
    ...workload.alternative_distributions,
  }
  // strip _-prefixed metadata keys
  const cleanVariants = {}
  for (const [k, v] of Object.entries(variants)) {
    if (k.startsWith('_')) continue
    if (typeof v === 'object' && v !== null) cleanVariants[k] = v
  }
  const variantNames = Object.keys(cleanVariants)
  const lines = [
    '### 表 5：敏感性分析（distribution 变体下月成本/用户）',
    '',
    `| Model | ${variantNames.join(' | ')} |`,
    `| --- | ${variantNames.map(() => '---').join(' | ')} |`,
  ]
  for (const m of pricing.models) {
    const cells = variantNames.map((v) => fmtUsd(monthlyCost(m, workload, cleanVariants[v], calls), 2))
    lines.push(`| ${m.display_name} | ${cells.join(' | ')} |`)
  }
  return lines.join('\n')
}

export function generateReport(pricing, workload, opts) {
  const calls = opts.callsPerMonth
  const distribution = workload.kind_distribution
  const proPrice = opts.proPrice
  const syncPrice = opts.syncPrice

  const sections = [
    '<!-- AUTO-GENERATED by scripts/ai-cost-analysis.mjs — do not edit by hand. -->',
    `<!-- Generated: ${new Date().toISOString()} -->`,
    `<!-- Inputs: pricing fetched_at=${pricing.fetched_at}, workload version=${workload.version} -->`,
    '',
    '## 自动生成：成本与定价矩阵',
    '',
    `**输入参数**：calls_per_month=${calls} · 默认 distribution（chat=${distribution.chat}, explain=${distribution.explain}, summary=${distribution.summary}, translate=${distribution.translate}, overview=${distribution.overview}）· Pro 现价 $${proPrice.toFixed(2)} · Sync 现价 $${syncPrice.toFixed(2)}（Sync 无 managed AI，本节不评估）`,
    '',
    table1_costPerKind(pricing, workload),
    '',
    table2_monthlyCost(pricing, workload, distribution, calls),
    '',
    table3_recommendedPrice(pricing, workload, distribution, calls),
    '',
    table4_marginAtFixed(pricing, workload, distribution, calls, proPrice),
    '',
    table5_sensitivity(pricing, workload, calls),
    '',
  ]
  return sections.join('\n')
}

// ---------- CLI entry ----------

function parseArgs(argv) {
  const args = {}
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const key = a.slice(2)
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith('--')) {
      args[key] = next
      i++
    } else {
      args[key] = true
    }
  }
  return args
}

function main() {
  const args = parseArgs(process.argv)
  for (const k of ['pricing', 'workload', 'out']) {
    if (!args[k]) {
      console.error(`Missing required --${k} <path>`)
      process.exit(2)
    }
  }
  const pricing = JSON.parse(readFileSync(args.pricing, 'utf8'))
  const workload = JSON.parse(readFileSync(args.workload, 'utf8'))
  const opts = {
    margin: parseFloat(args.margin ?? '0.70'),
    callsPerMonth: parseInt(args['calls-per-month'] ?? workload.calls_per_month_pro ?? '30000', 10),
    proPrice: parseFloat(args['pro-price'] ?? '12'),
    syncPrice: parseFloat(args['sync-price'] ?? '4'),
  }
  const md = generateReport(pricing, workload, opts)
  writeFileSync(args.out, md)
  console.log(`Wrote ${args.out} (${md.length} bytes, ${pricing.models.length} models)`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
