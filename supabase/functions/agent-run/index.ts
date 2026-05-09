// Phase 11 D-A4: HTTP/SSE shell. Delegates the agent loop to runAgent
// (../_shared/runAgent.ts). Preserves D-02 BYOK chokepoint (only
// buildProvider({req, body}) reads the BYOK header), D-05 audit-row lifecycle,
// req.signal abort listener, and 25s keepalive pipeThrough at HTTP egress.
import { getUserFromRequest } from '../_shared/auth.ts'
import { errorResp } from '../_shared/responses.ts'
import { serviceRoleClient } from '../_shared/clients.ts'
import { buildProvider } from '../_shared/byok-passthrough.ts'
import { runAgent } from '../_shared/runAgent.ts'
import { searchArxivTool } from './tools/search-arxiv.ts'
import { fetchSemanticScholarTool } from './tools/fetch-semantic-scholar.ts'
import { screenshotParagraphTool } from './tools/screenshot-paragraph.ts'
import { readPaperSectionTool } from './tools/read-paper-section.ts'
import { writeCanvasTool } from './tools/write-canvas.ts'
import { createKeepaliveTransform } from './keepalive.ts'

const MAX_STEPS = Number(Deno.env.get('AGENT_RUN_MAX_STEPS') ?? '10')

// v1.2.x A2 — Always-on system prompt. Addresses the failure mode where the
// agent emits ONE failing tool call and then terminates without producing a
// user-facing answer (Phase 14 q-01 live eval). Caller-supplied `body.system`
// overrides; any role:'system' entries in body.messages are additive (the
// SDK prepends both).
const DEFAULT_AGENT_SYSTEM_PROMPT = [
  "You are a research assistant operating inside the user's paper reader.",
  "Available tools: readPaperSection, screenshotParagraph, searchArxiv, fetchSemanticScholar, writeCanvas.",
  "Tool-failure recovery: when a tool returns ok:false, INSPECT reason+detail and either retry with a corrected argument (e.g. wrong paragraphId → consult the description for valid forms like 'abs' or 'sec0-p0'), or switch to a different tool, or fall back to your prior knowledge. Never abandon a task after a single failed call.",
  "Final-answer obligation: every run MUST end with a user-facing answer. If you partially succeeded, summarize what you found and explicitly note what failed and why. Do not stop silently after a tool error.",
  "Be concise: tool results are evidence, not transcripts to repeat — synthesize, don't paraphrase.",
].join(' ')

type AgentRunBody = {
  messages: Array<{ role: 'user' | 'assistant' | 'tool' | 'system'; content: unknown; toolCallId?: string }>
  baseURL?: string  // BYOK only
  model?: string    // BYOK only
  dev_probe?: boolean  // Phase 10 dev-menu smart-sampling tag
  system?: string  // v1.2.x A2 — caller override for the always-on system prompt
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return errorResp('method-not-allowed', 405)

  // JWT auth (REUSE v1.1). BYOK apiKey arrives on `X-BYOK-Authorization` (D-02).
  const session = await getUserFromRequest(req)
  if (!session) return errorResp('Unauthorized', 401)
  const { user, client: supa } = session

  const { data: rateOK } = await supa.rpc('rate_limit_check', { p_max_count: 10, p_window_sec: 300 })
  if (rateOK === false) return errorResp('rate-limited', 429)

  let body: AgentRunBody
  try { body = await req.json() as AgentRunBody } catch { return errorResp('invalid-json-body', 400) }

  // Provider chokepoint (D-02) — only place that reads `req` for BYOK.
  let isBYOK = false
  let provider: ReturnType<typeof buildProvider>['provider'] | null = null
  let modelName = ''
  try {
    const built = buildProvider({ req, body })
    isBYOK = built.isBYOK
    provider = built.provider
    modelName = built.modelName
  } catch (e) {
    return errorResp((e as Error).message || 'provider-init-failed', 500)
  }

  // Audit row INSERT (D-05). Service-role write so RLS does not block.
  const admin = serviceRoleClient()
  const { data: sub } = await supa.from('subscriptions').select('tier').eq('user_id', user.id).single()
  const tierAtCall = (sub?.tier ?? 'free') as 'free' | 'sync' | 'pro'
  const { data: runRow, error: insertErr } = await admin
    .from('agent_runs')
    .insert({ user_id: user.id, status: 'running', tier_at_call: tierAtCall, byok: isBYOK })
    .select('id')
    .single()
  if (insertErr || !runRow) return errorResp('audit-insert-failed', 500)

  // Idempotent finalize. `status='running'` filter dedupes onFinish vs abort race (D-05 / D-04).
  const finalizeRun = (args: {
    status: 'done' | 'aborted' | 'error'
    finishReason: string
    totalTokens: number
    stepCount: number
    errorMessage?: string  // MUST be redacted upstream — D-02 contract
  }) => {
    // Phase 11 Plan 08 D-D2 candidate 2 + 4 (stacked):
    //   - candidate 2: detach UPDATE from any await chain via EdgeRuntime.waitUntil.
    //   - candidate 4: bypass supabase-js's fetch interceptor / realtime
    //     instrumentation by hitting PostgREST directly. The JS client wraps
    //     fetch in ways that have been observed to delay propagation of the
    //     outer abort signal; raw fetch() + service-role key replicates the
    //     same wire request without any client-side wrapping.
    const sbUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const sbServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const url = `${sbUrl}/rest/v1/agent_runs?id=eq.${encodeURIComponent(runRow.id)}&status=eq.running`
    const body = JSON.stringify({
      finished_at: new Date().toISOString(),
      status: args.status,
      finish_reason: args.finishReason,
      step_count: args.stepCount,
      total_tokens: args.totalTokens || null,
      ...(args.errorMessage ? { error_message: args.errorMessage } : {}),
    })
    const updatePromise = fetch(url, {
      method: 'PATCH',
      headers: {
        'apikey': sbServiceKey,
        'Authorization': `Bearer ${sbServiceKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body,
    })
    const er = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime
    if (er && typeof er.waitUntil === 'function') {
      er.waitUntil(updatePromise.then(() => { /* drain */ }, () => { /* swallow */ }))
    } else {
      // Fallback: best-effort fire-and-forget. Idempotent &status=eq.running
      // dedupe guarantees we don't double-write on retry.
      void updatePromise.catch(() => { /* swallow */ })
    }
  }

  // AbortController + req.signal listener — fire-and-forget `void finalizeRun`
  // (5s abort latency invariant per Phase 10 D-04).
  const abortController = new AbortController()
  let stepCountSeen = 0
  let totalTokensSeen = 0
  req.signal.addEventListener('abort', () => {
    abortController.abort('client-disconnect')
    // Phase 11 Plan 08 D-D2 candidate 5 (last-resort escape hatch): defer UPDATE
    // to next-tick via setTimeout(..., 0) so the listener returns immediately.
    // Best-effort — no retry, no error surface; finalizeRun is idempotent via
    // its &status=eq.running dedupe. Combined with candidate 2 + 4 above, the
    // listener does ZERO synchronous work past abortController.abort().
    setTimeout(() => {
      try {
        finalizeRun({
          status: 'aborted',
          finishReason: 'aborted',
          totalTokens: totalTokensSeen,
          stepCount: stepCountSeen,
        })
      } catch { /* swallow; idempotent dedupe via &status=eq.running */ }
    }, 0)
  })

  // Delegate loop. runAgent owns: streamText, manual step counter, stopWhen,
  // prepareStep, tool-result observation, toUIMessageStreamResponse.
  const sseResp = await runAgent({
    messages: body.messages as Parameters<typeof runAgent>[0]['messages'],
    systemPrompt: body.system ?? DEFAULT_AGENT_SYSTEM_PROMPT,
    tools: {
      searchArxiv: searchArxivTool,
      fetchSemanticScholar: fetchSemanticScholarTool,
      screenshotParagraph: screenshotParagraphTool,
      readPaperSection: readPaperSectionTool,
      writeCanvas: writeCanvasTool,
    },
    model: provider!(modelName),
    maxSteps: MAX_STEPS,
    abortSignal: abortController.signal,
    onStepFinish: ({ stepNumber, usage }) => {
      stepCountSeen = stepNumber
      totalTokensSeen += usage?.totalTokens ?? 0
      // Per-step quota — managed only (D-03). BYOK exempt.
      if (!isBYOK) supa.rpc('increment_ai_usage').then(() => {}, () => {})
    },
    onFinish: ({ status, finishReason, totalTokens, stepCount }) => {
      stepCountSeen = stepCount
      totalTokensSeen = totalTokens
      void finalizeRun({ status: req.signal.aborted ? 'aborted' : status, finishReason, totalTokens, stepCount })
    },
  })

  // Egress: keepalive wrap (D-A4 last line) + X-Run-Id.
  if (!sseResp.body) return errorResp('stream-init-failed', 500)
  const wrapped = sseResp.body.pipeThrough(createKeepaliveTransform(25_000))
  const headers = new Headers(sseResp.headers)
  headers.set('X-Run-Id', runRow.id)
  headers.set('Cache-Control', 'no-store')
  return new Response(wrapped, { status: sseResp.status, headers })
})
