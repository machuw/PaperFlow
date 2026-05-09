// chrome-extension/tests/eval/runner.ts
//
// Phase 14 EVAL-02 + EVAL-03 — eval runner core.
//
// Reads queries.json + papers.json; iterates queries x halves (gpt-4o-mini
// weak / BYOK strong) sequentially with rate-limit-defending sleep;
// POSTs to local /agent-run; collects SSE frames; computes 3 metrics;
// emits raw JSON to .planning/eval/runs/{ISO}.json.
//
// Cross-AI Review iter 2 invariants:
//   C-1: PF_EVAL_OPENAI_KEY routes weak baseline via api.openai.com;
//        PF_EVAL_BYOK_KEY routes strong baseline via user's BYOK proxy.
//        Half-skipping: missing key → warn + skip half (don't throw).
//   C-2: Queries run sequentially; configurable inter-query sleep (default 2s).
//   C-3: withRetry — 3 attempts, exponential backoff (1/3/9s); 30s on 429.
//   C-4: ESM-safe — fileURLToPath(import.meta.url), isMainModule helper.
//   C-6: --query <id>, --model gpt-4o-mini|byok, --skip-judge for live smoke.
//
// Prereqs (D-B1):
//   1. supabase start && supabase functions serve --env-file ./supabase/.env
//   2. chrome-extension/.env.local has PF_EVAL_BYOK_KEY (B-02) + optionally
//      PF_EVAL_BYOK_MODEL (B-03) + PF_EVAL_OPENAI_KEY (C-1) + OPENAI_API_KEY (judge)
//   3. supabase/.env.local-devnote.md has SB_URL/SB_ANON/SB_SERVICE

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { jaccardScore, argsContainsScore } from './metric'
import { parseSSEFrames, type SSEFrame } from './sse'
import { judgeFinalAnswer } from './judge'
import { renderReport, loadLatestBaseline, runsDir } from './reporter'
import type { GoldQuery, ToolName, Scenario } from './queries.schema'
import {
  loadDevnoteEnv as fixturesLoadDevnoteEnv,
  agentRunReachable,
  type DevnoteEnv,
} from '../agent-runtime-fixtures'

// C-4 ESM-safe __dirname / __filename.
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// ─────────────────── public types ───────────────────

type Paper = {
  paperId: string
  arxivId: string
  arxivUrl: string
  title: string
  category: string
}

export type QueryResult = {
  queryId: string
  modelId: string
  scenario: Scenario

  observedToolCalls: Array<{
    toolName: ToolName
    args: Record<string, unknown>
    succeeded: boolean
  }>

  finalAnswer: string

  toolSelectionScore: number
  toolArgsScore: number
  finalAnswerScore: number

  totalTokens: number
  estCostUSD: number

  errorMessage?: string
  judgeReasoning?: string
  durationMs: number
  retryAttempts: number
}

export type RunEvalResult = {
  runId: string
  startedAt: string
  finishedAt: string
  totalCostUSD: number
  results: QueryResult[]
  networkFailedCount: number
  halvesRun: Array<'weak' | 'strong'>
}

// B-03: COST_RATES keyed by canonical model id with default fallback.
const COST_RATES_USD_PER_1M_TOKENS: Record<string, { input: number; output: number }> = {
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'claude-sonnet-4-5-20250929': { input: 3.0, output: 15.0 },
  'gpt-4o': { input: 2.5, output: 10.0 },
  default: { input: 3.0, output: 15.0 },
}
function rateFor(modelId: string) {
  return COST_RATES_USD_PER_1M_TOKENS[modelId] ?? COST_RATES_USD_PER_1M_TOKENS.default
}

const DEFAULT_MAX_COST_USD = 60
const MAX_REPOSTS = 5
const DEFAULT_INTER_QUERY_SLEEP_MS = 2000

// ─────────────────── C-3 withRetry ───────────────────

export type RetryOpts = {
  maxAttempts?: number
  baseBackoffMs?: number
  rateLimitBackoffMs?: number
  isRateLimited?: (err: unknown) => boolean
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOpts = {}): Promise<T> {
  const max = opts.maxAttempts ?? 3
  const base = opts.baseBackoffMs ?? 1000
  const rate = opts.rateLimitBackoffMs ?? 30000
  const isRate = opts.isRateLimited ?? (() => false)
  let lastErr: unknown
  for (let attempt = 1; attempt <= max; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (attempt === max) break
      const delay = isRate(err) ? rate : base * Math.pow(3, attempt - 1)
      await sleep(delay)
    }
  }
  throw lastErr
}

function isRateLimitedErr(err: unknown): boolean {
  return err instanceof Error && /rate-limited|\b429\b/i.test(err.message)
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// ─────────────────── C-4 ESM entry detection ───────────────────

export function isMainModule(metaUrl: string): boolean {
  try {
    const thisFile = fileURLToPath(metaUrl)
    const argvFile = resolve(process.argv[1] ?? '')
    return thisFile === argvFile
  } catch {
    return false
  }
}

// ─────────────────── B-02 + C-1 env loaders ───────────────────

function loadDevnoteEnv() {
  return fixturesLoadDevnoteEnv()
}

function loadByokKey(): string | null {
  if (process.env.PF_EVAL_BYOK_KEY) return process.env.PF_EVAL_BYOK_KEY
  const p = resolve(__dirname, '..', '..', '.env.local')
  if (!existsSync(p)) return null
  const m = readFileSync(p, 'utf8').match(/^PF_EVAL_BYOK_KEY=(.+)$/m)
  return m && m[1].trim() ? m[1].trim() : null
}

function loadByokModel(): string {
  if (process.env.PF_EVAL_BYOK_MODEL) return process.env.PF_EVAL_BYOK_MODEL
  const p = resolve(__dirname, '..', '..', '.env.local')
  if (existsSync(p)) {
    const m = readFileSync(p, 'utf8').match(/^PF_EVAL_BYOK_MODEL=(.+)$/m)
    if (m && m[1].trim()) return m[1].trim()
  }
  return 'claude-sonnet-4-5-20250929'
}

// C-1: distinct from judge OPENAI_API_KEY.
function loadEvalOpenaiKey(): string | null {
  if (process.env.PF_EVAL_OPENAI_KEY) return process.env.PF_EVAL_OPENAI_KEY
  const p = resolve(__dirname, '..', '..', '.env.local')
  if (!existsSync(p)) return null
  const m = readFileSync(p, 'utf8').match(/^PF_EVAL_OPENAI_KEY=(.+)$/m)
  return m && m[1].trim() ? m[1].trim() : null
}

// iter-4 hotfix: support OpenAI-compat proxies (e.g. newapi.magicneko.com)
// for weak baseline. Default = api.openai.com/v1.
function loadEvalOpenaiBaseURL(): string {
  if (process.env.PF_EVAL_OPENAI_BASE_URL) return process.env.PF_EVAL_OPENAI_BASE_URL
  const p = resolve(__dirname, '..', '..', '.env.local')
  if (existsSync(p)) {
    const m = readFileSync(p, 'utf8').match(/^PF_EVAL_OPENAI_BASE_URL=(.+)$/m)
    if (m && m[1].trim()) return m[1].trim()
  }
  return 'https://api.openai.com/v1'
}

// v1.2.x A4 follow-up: judge model override (newapi.magicneko.com has no
// gpt-4o channel — fall back to gpt-4o-mini or whatever the user's proxy
// supports). Default = gpt-4o (D-B3).
function loadEvalJudgeModel(): string {
  if (process.env.PF_EVAL_JUDGE_MODEL) return process.env.PF_EVAL_JUDGE_MODEL
  const p = resolve(__dirname, '..', '..', '.env.local')
  if (existsSync(p)) {
    const m = readFileSync(p, 'utf8').match(/^PF_EVAL_JUDGE_MODEL=(.+)$/m)
    if (m && m[1].trim()) return m[1].trim()
  }
  return 'gpt-4o'
}

// iter-4 hotfix: BYOK strong baseline needs explicit baseURL (Edge Function
// passes body.baseURL to byok-passthrough; without it, BYOK key is sent to
// managed-AI default endpoint and authn fails).
function loadEvalByokBaseURL(): string | undefined {
  if (process.env.PF_EVAL_BYOK_BASE_URL) return process.env.PF_EVAL_BYOK_BASE_URL
  const p = resolve(__dirname, '..', '..', '.env.local')
  if (!existsSync(p)) return undefined
  const m = readFileSync(p, 'utf8').match(/^PF_EVAL_BYOK_BASE_URL=(.+)$/m)
  return m && m[1].trim() ? m[1].trim() : undefined
}

function loadJudgeOpenaiKey(): string | null {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY
  const candidates = [
    resolve(__dirname, '..', '..', '.env.local'),
    resolve(__dirname, '..', '..', '..', 'supabase', '.env'),
  ]
  for (const p of candidates) {
    if (!existsSync(p)) continue
    const m = readFileSync(p, 'utf8').match(/^OPENAI_API_KEY=(.+)$/m)
    if (m && m[1].trim()) return m[1].trim()
  }
  return null
}

// ─────────────────── auth ───────────────────

async function signupAndLogin(
  env: DevnoteEnv,
  runId: string,
): Promise<{ accessToken: string; userId: string }> {
  const admin = createClient(env.SB_URL, env.SB_SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const email = `eval-${runId}@example.test`
  await admin.auth.admin.createUser({
    email,
    password: 'pw123456',
    email_confirm: true,
  })
  const client = createClient(env.SB_URL, env.SB_ANON)
  const { data, error } = await client.auth.signInWithPassword({ email, password: 'pw123456' })
  if (error || !data.session || !data.user) {
    throw new Error(`signupAndLogin failed: ${error?.message ?? 'no session'}`)
  }
  return { accessToken: data.session.access_token, userId: data.user.id }
}

// ─────────────────── per-half descriptor ───────────────────

type Half = {
  label: 'weak' | 'strong'
  modelId: string
  apiKey: string
  baseURL: string | undefined
}

// ─────────────────── client-tool stubs (D-B2 write-side mock) ───────────────────

const STUB_PNG_DATAURL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

function clientToolStub(
  toolName: string,
  input: Record<string, unknown>,
): Record<string, unknown> {
  if (toolName === 'screenshotParagraph') {
    return { ok: true, dataUrl: STUB_PNG_DATAURL }
  }
  if (toolName === 'readPaperSection') {
    const paragraphId = String(input?.paragraphId ?? 'unknown')
    return { ok: true, text: `paragraph stub for ${paragraphId}` }
  }
  if (toolName === 'writeCanvas') {
    return { ok: true, nodeId: `mock-${Date.now()}` }
  }
  return { ok: false, kind: 'logical', reason: 'unsupported-client-tool' }
}

// ─────────────────── runOneQuery ───────────────────

async function runOneQuery(args: {
  query: GoldQuery
  paper: Paper
  half: Half
  accessToken: string
  judgeOpenaiKey: string | null
  judgeBaseURL: string
  judgeModel: string
  skipJudge: boolean
  sbUrl: string
}): Promise<QueryResult> {
  const startMs = Date.now()
  const observedToolCalls: Array<{
    toolName: ToolName
    args: Record<string, unknown>
    succeeded: boolean
  }> = []
  let finalAnswerBuf = ''
  let totalTokens = 0
  let errorMessage: string | undefined

  type Message = { role: 'system' | 'user' | 'assistant' | 'tool'; content: unknown; toolCallId?: string }
  const systemMessage: Message = {
    role: 'system',
    content: `The user has paper "${args.paper.title}" (paperId=${args.paper.paperId}, arxivId=${args.paper.arxivId}) currently open.`,
  }
  let messages: Message[] = [systemMessage, { role: 'user', content: args.query.query }]

  for (let round = 0; round <= MAX_REPOSTS; round++) {
    const res = await fetch(`${args.sbUrl}/functions/v1/agent-run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${args.accessToken}`,
        'X-BYOK-Authorization': `Bearer ${args.half.apiKey}`,
      },
      body: JSON.stringify({
        messages,
        baseURL: args.half.baseURL,
        model: args.half.modelId,
        dev_probe: false,
      }),
    })
    if (res.status === 429) {
      throw new Error(`rate-limited: agent-run returned 429 (round ${round})`)
    }
    if (!res.ok || !res.body) {
      const txt = await res.text().catch(() => '')
      throw new Error(`agent-run http ${res.status}: ${txt.slice(0, 200)}`)
    }

    // v1.2.x A2.1: track per-round assistant text + tool_calls so we can
    // reconstruct a proper assistant message on re-POST. Without it the
    // next round's history is `[system, user, tool]` with a floating
    // tool result — claude/gpt can't synthesize because the assistant
    // turn (text + tool_use) is missing from the narrative.
    let roundAssistantText = ''
    const roundToolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }> = []
    const pendingClientCalls: Array<{ toolCallId: string; toolName: string; input: unknown }> = []
    for await (const frame of parseSSEFrames(res.body)) {
      if (frame.type === 'text-delta' && typeof frame.delta === 'string') {
        roundAssistantText += frame.delta
      }
      if (
        frame.type === 'tool-input-available' &&
        typeof frame.toolCallId === 'string' &&
        typeof frame.toolName === 'string'
      ) {
        roundToolCalls.push({
          toolCallId: frame.toolCallId,
          toolName: frame.toolName,
          input: frame.input,
        })
      }
      handleFrame(frame, observedToolCalls, pendingClientCalls, (delta) => {
        finalAnswerBuf += delta
      })
      if (frame.type === 'finish' && typeof frame.totalTokens === 'number') {
        totalTokens = frame.totalTokens
      }
    }

    if (pendingClientCalls.length === 0) break
    if (round === MAX_REPOSTS) {
      errorMessage = 'max-reposts-exceeded'
      break
    }
    // Reconstruct the assistant turn (text + tool-use parts) BEFORE the
    // tool-result message so the next round sees a coherent narrative.
    // ModelMessage shape per AI SDK 5: assistant.content can be an array
    // of {type:'text'} + {type:'tool-call'} parts.
    const newMessages: Message[] = [...messages]
    const assistantContent: Array<Record<string, unknown>> = []
    if (roundAssistantText) {
      assistantContent.push({ type: 'text', text: roundAssistantText })
    }
    for (const tc of roundToolCalls) {
      assistantContent.push({
        type: 'tool-call',
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        input: tc.input,
      })
    }
    if (assistantContent.length > 0) {
      newMessages.push({
        role: 'assistant',
        content: assistantContent,
      })
    }
    for (const call of pendingClientCalls) {
      const result = clientToolStub(call.toolName, (call.input ?? {}) as Record<string, unknown>)
      newMessages.push({
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            // AI SDK 5 ToolResultOutput discriminated union — `json` accepts
            // any structured value. Without `type` the prompt validator fails
            // with "No matching discriminator" on output.type.
            output: { type: 'json', value: result },
          },
        ] as unknown,
        toolCallId: call.toolCallId,
      })
    }
    messages = newMessages
  }

  // Compute metrics.
  const toolSelectionScore = jaccardScore(
    args.query.expectedTools,
    observedToolCalls.map((c) => c.toolName),
  )
  const toolArgsScore = argsContainsScore(args.query.expectedToolArgs, observedToolCalls)

  let finalAnswerScore = 0
  let judgeReasoning: string | undefined
  if (args.skipJudge) {
    judgeReasoning = 'judge-skipped'
  } else if (args.judgeOpenaiKey) {
    try {
      const verdict = await judgeFinalAnswer({
        answer: finalAnswerBuf,
        rubric: args.query.finalAnswerRubric,
        keywords: args.query.finalAnswerKeywords,
        openaiKey: args.judgeOpenaiKey,
        baseURL: args.judgeBaseURL,
        model: args.judgeModel,
      })
      finalAnswerScore = verdict.score
      judgeReasoning = verdict.reasoning
    } catch (err) {
      finalAnswerScore = 0
      judgeReasoning = `judge-failed: ${(err as Error).message}`
      if (!errorMessage) errorMessage = 'judge-failed'
    }
  }

  // Cost estimate: input/output 70/30 split per <runner_design>.
  const rate = rateFor(args.half.modelId)
  const inTok = totalTokens * 0.7
  const outTok = totalTokens * 0.3
  const estCostUSD = (inTok * rate.input + outTok * rate.output) / 1_000_000

  return {
    queryId: args.query.queryId,
    modelId: args.half.modelId,
    scenario: args.query.scenario,
    observedToolCalls,
    finalAnswer: finalAnswerBuf,
    toolSelectionScore,
    toolArgsScore,
    finalAnswerScore,
    totalTokens,
    estCostUSD,
    errorMessage,
    judgeReasoning,
    durationMs: Date.now() - startMs,
    retryAttempts: 0,
  }
}

function handleFrame(
  frame: SSEFrame,
  observedToolCalls: Array<{
    toolName: ToolName
    args: Record<string, unknown>
    succeeded: boolean
  }>,
  pendingClientCalls: Array<{ toolCallId: string; toolName: string; input: unknown }>,
  onTextDelta: (s: string) => void,
) {
  if (
    frame.type === 'tool-input-available' &&
    typeof frame.toolName === 'string' &&
    typeof frame.toolCallId === 'string'
  ) {
    observedToolCalls.push({
      toolName: frame.toolName as ToolName,
      args: (frame.input ?? {}) as Record<string, unknown>,
      succeeded: false,
    })
    pendingClientCalls.push({
      toolCallId: frame.toolCallId,
      toolName: frame.toolName,
      input: frame.input,
    })
  }
  if (
    frame.type === 'tool-output-available' &&
    typeof frame.toolName === 'string' &&
    typeof frame.toolCallId === 'string'
  ) {
    // The matching tool-input came from the server side already with execute()
    // — drop from pendingClientCalls so we don't re-POST it.
    const i = pendingClientCalls.findIndex((c) => c.toolCallId === frame.toolCallId)
    if (i >= 0) pendingClientCalls.splice(i, 1)
    // Mark observedToolCalls entry succeeded=true unless output.ok===false.
    const last = [...observedToolCalls].reverse().find((c) => c.toolName === frame.toolName)
    if (last) {
      const out = frame.output as { ok?: boolean } | undefined
      last.succeeded = !(out && out.ok === false)
    }
  }
  if (frame.type === 'text-delta' && typeof frame.delta === 'string') {
    onTextDelta(frame.delta)
  }
}

// ─────────────────── runEval (orchestration) ───────────────────

export async function runEval(
  opts: {
    dryRun?: boolean
    queryIds?: string[]
    modelOnly?: 'gpt-4o-mini' | 'byok'
    skipJudge?: boolean
    maxCostUSD?: number
    interQuerySleepMs?: number
  } = {},
): Promise<RunEvalResult> {
  const runId = new Date().toISOString().replace(/[:.]/g, '-')
  const startedAt = new Date().toISOString()

  // Step 1 — load files (no network, runs in dryRun too).
  const papers: Paper[] = JSON.parse(readFileSync(resolve(__dirname, 'papers.json'), 'utf8'))
  const queries: GoldQuery[] = JSON.parse(readFileSync(resolve(__dirname, 'queries.json'), 'utf8'))
  const ps = new Set(papers.map((p) => p.paperId))
  for (const q of queries) {
    if (!ps.has(q.paperId)) throw new Error(`orphan paperId in queries.json: ${q.paperId}`)
  }
  const byokModel = loadByokModel()

  // Step 2 — W-02: dryRun BEFORE probe + auth + judge load.
  if (opts.dryRun) {
    process.stdout.write(
      `DRY RUN — would execute ${queries.length} queries × 2 models = ${queries.length * 2} runs\n`,
    )
    process.stdout.write(`  baseline 1: gpt-4o-mini (route: api.openai.com via PF_EVAL_OPENAI_KEY)\n`)
    process.stdout.write(`  baseline 2: ${byokModel} (route: BYOK proxy via PF_EVAL_BYOK_KEY)\n`)
    process.stdout.write(
      `  inter-query sleep: ${opts.interQuerySleepMs ?? DEFAULT_INTER_QUERY_SLEEP_MS}ms (C-2)\n`,
    )
    process.stdout.write(`  retry policy: 3 attempts, backoff 1s/3s/9s, 30s on 429 (C-3)\n`)
    process.stdout.write(`  output (skipped in dryRun): .planning/eval/runs/${runId}.json\n`)
    return {
      runId,
      startedAt,
      finishedAt: new Date().toISOString(),
      totalCostUSD: 0,
      results: [],
      networkFailedCount: 0,
      halvesRun: [],
    }
  }

  // Step 3 — live path: env + keys.
  const env = loadDevnoteEnv()
  const byokKey = loadByokKey()
  const evalOpenaiKey = loadEvalOpenaiKey()
  const judgeOpenaiKey = loadJudgeOpenaiKey()

  // C-1: half-skipping (warn but don't throw unless BOTH missing).
  const runWeak = !!evalOpenaiKey
  const runStrong = !!byokKey
  if (!runWeak && !runStrong) {
    throw new Error(
      'Neither PF_EVAL_OPENAI_KEY nor PF_EVAL_BYOK_KEY is set — no models to run. See chrome-extension/.env.local.example',
    )
  }
  if (!runWeak) console.warn('[eval] PF_EVAL_OPENAI_KEY missing — SKIPPING gpt-4o-mini half')
  if (!runStrong) console.warn('[eval] PF_EVAL_BYOK_KEY missing — SKIPPING BYOK strong half')

  // C-6: --model-only override.
  const wantWeak = (opts.modelOnly === 'gpt-4o-mini' || opts.modelOnly === undefined) && runWeak
  const wantStrong = (opts.modelOnly === 'byok' || opts.modelOnly === undefined) && runStrong

  // Judge key required unless --skip-judge.
  if (!opts.skipJudge && !judgeOpenaiKey) {
    throw new Error(
      'OPENAI_API_KEY (judge) not set — required for LLM-as-judge. Use --skip-judge for smoke testing.',
    )
  }

  // Step 4 — probe.
  if (!(await agentRunReachable(env))) {
    throw new Error(
      'agent-run unreachable — run `supabase start && supabase functions serve --env-file ./supabase/.env`',
    )
  }

  // Step 5 — auth.
  const { accessToken } = await signupAndLogin(env, runId)

  // Step 6 — run × halves SEQUENTIALLY with sleep (C-2).
  const maxCost = opts.maxCostUSD ?? DEFAULT_MAX_COST_USD
  const sleepMs = opts.interQuerySleepMs ?? DEFAULT_INTER_QUERY_SLEEP_MS
  const halves: Half[] = []
  const halvesRun: Array<'weak' | 'strong'> = []
  if (wantWeak) {
    halves.push({
      label: 'weak',
      modelId: 'gpt-4o-mini',
      apiKey: evalOpenaiKey!,
      baseURL: loadEvalOpenaiBaseURL(),  // iter-4: PF_EVAL_OPENAI_BASE_URL override
    })
    halvesRun.push('weak')
  }
  if (wantStrong) {
    halves.push({
      label: 'strong',
      modelId: byokModel,
      apiKey: byokKey!,
      baseURL: loadEvalByokBaseURL(),  // iter-4: PF_EVAL_BYOK_BASE_URL (Edge Function routes via byok-passthrough)
    })
    halvesRun.push('strong')
  }

  let cumulativeCost = 0
  let networkFailedCount = 0
  const results: QueryResult[] = []

  for (const half of halves) {
    let queryIdx = 0
    for (const query of queries) {
      if (opts.queryIds && !opts.queryIds.includes(query.queryId)) {
        queryIdx++
        continue
      }
      const paper = papers.find((p) => p.paperId === query.paperId)!

      if (cumulativeCost > maxCost) {
        results.push({
          queryId: query.queryId,
          modelId: half.modelId,
          scenario: query.scenario,
          observedToolCalls: [],
          finalAnswer: '',
          toolSelectionScore: 0,
          toolArgsScore: 0,
          finalAnswerScore: 1,
          totalTokens: 0,
          estCostUSD: 0,
          errorMessage: 'cost-cap-reached',
          durationMs: 0,
          retryAttempts: 0,
        })
        queryIdx++
        continue
      }

      // C-3: wrap runOneQuery in withRetry.
      let attempts = 0
      try {
        const qr = await withRetry(
          () => {
            attempts++
            return runOneQuery({
              query,
              paper,
              half,
              accessToken,
              judgeOpenaiKey,
              judgeBaseURL: loadEvalOpenaiBaseURL(),
              judgeModel: loadEvalJudgeModel(),
              skipJudge: !!opts.skipJudge,
              sbUrl: env.SB_URL,
            })
          },
          {
            maxAttempts: 3,
            baseBackoffMs: 1000,
            rateLimitBackoffMs: 30000,
            isRateLimited: isRateLimitedErr,
          },
        )
        qr.retryAttempts = attempts - 1
        cumulativeCost += qr.estCostUSD
        results.push(qr)
      } catch (err) {
        const msg = isRateLimitedErr(err) ? 'rate-limited' : 'error-network'
        results.push({
          queryId: query.queryId,
          modelId: half.modelId,
          scenario: query.scenario,
          observedToolCalls: [],
          finalAnswer: '',
          toolSelectionScore: 0,
          toolArgsScore: 0,
          finalAnswerScore: 1,
          totalTokens: 0,
          estCostUSD: 0,
          errorMessage: msg,
          durationMs: 0,
          retryAttempts: 3,
        })
        networkFailedCount++
      }

      queryIdx++
      // C-2: sleep BETWEEN queries (skip after the very last in this half).
      if (queryIdx < queries.length) await sleep(sleepMs)
    }
  }

  // Step 7 — write raw JSON.
  const result: RunEvalResult = {
    runId,
    startedAt,
    finishedAt: new Date().toISOString(),
    totalCostUSD: cumulativeCost,
    results,
    networkFailedCount,
    halvesRun,
  }
  // Plan 14-04 D-C1: persist raw JSON to repo-root-anchored .planning/eval/runs/.
  // Anchored via reporter.runsDir() so cwd-independent (works whether `npm run
  // eval` is invoked from chrome-extension/ or repo root).
  const runsDirAbs = runsDir()
  mkdirSync(runsDirAbs, { recursive: true })
  writeFileSync(resolve(runsDirAbs, `${runId}.json`), JSON.stringify(result, null, 2))

  // Plan 14-04 wiring: render markdown alongside JSON (D-C1 dual output, D-C2 baseline diff).
  // Skipped in dryRun (W-02 short-circuit returns earlier above).
  const baseline = loadLatestBaseline(runId)
  const md = renderReport(result, baseline)
  writeFileSync(resolve(runsDirAbs, `${runId}.md`), md, 'utf8')
  process.stdout.write('\n' + md + '\n')

  return result
}

// ─────────────────── C-4 + C-6 entry point (ESM-safe) ───────────────────

if (isMainModule(import.meta.url)) {
  const argv = process.argv.slice(2)
  const dryRun = argv.includes('--dry-run')
  const skipJudge = argv.includes('--skip-judge')
  const queryIdx = argv.findIndex((a) => a === '--query')
  const queryIds = queryIdx >= 0 && argv[queryIdx + 1] ? [argv[queryIdx + 1]] : undefined
  const modelIdx = argv.findIndex((a) => a === '--model')
  const modelArg = modelIdx >= 0 ? argv[modelIdx + 1] : undefined
  const modelOnly: 'gpt-4o-mini' | 'byok' | undefined =
    modelArg === 'gpt-4o-mini' ? 'gpt-4o-mini' : modelArg === 'byok' ? 'byok' : undefined
  const sleepMatch = argv.find((a) => a.startsWith('--inter-query-sleep-ms='))
  const interQuerySleepMs = sleepMatch ? Number(sleepMatch.split('=')[1]) : undefined
  const maxCostMatch = argv.find((a) => a.startsWith('--max-cost='))
  const maxCostUSD = maxCostMatch ? Number(maxCostMatch.split('=')[1]) : DEFAULT_MAX_COST_USD

  runEval({ dryRun, queryIds, modelOnly, skipJudge, interQuerySleepMs, maxCostUSD }).then(
    (result) => {
      process.stdout.write(
        `\nrunId: ${result.runId}\n${
          dryRun
            ? 'dry-run: 0 results written.'
            : `${result.results.length} results written to .planning/eval/runs/${result.runId}.json (${result.networkFailedCount} network-failed, halves run: ${result.halvesRun.join(',')})`
        }\nEstCost: $${result.totalCostUSD.toFixed(2)}\n`,
      )
    },
    (err) => {
      console.error('eval-failed:', err.message)
      if (err.stack) console.error(err.stack)
      process.exit(2)
    },
  )
}
