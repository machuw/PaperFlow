// chrome-extension/reader/lib/agent-client.ts
//
// Phase 11 Plan 06 (D-C4): renamed from agent-dev-demo.ts. Adds top-level
// runAgent({messages, abortSignal?, onEvent?, assistantMsgId?}) public API for
// main-chat consumption (TOOL-01) + onEvent → RunAgentEvent emission for
// reasoning trace UI (TOOL-05). Preserves runAgentDevDemo as a thin wrapper so
// the D-06 dev-menu trigger keeps working unchanged (top-bar.tsx 1-line import
// path swap; D-06 grep invariant migrates: `agent-client|pf_debug_agent → 2 hits`).
//
// Phase 10 SSE-parser internals preserved verbatim (LF-LF / CRLF-CRLF tolerant
// frame extractor, addToolResult round-trip, BYOK passthrough header, Phoenix
// local capture, AbortSignal threading). The only structural change is the
// CLIENT_TOOLS dispatch table replacing hard-coded screenshotParagraph dispatch.
//
// W-05 (no client-side step-* synthesis): AI SDK 5's Data Stream Protocol does
// NOT carry explicit step boundary frames. The authoritative step boundaries
// live on the server in runAgent.ts's onStepFinish callback. The client emits
// only: tool-call (mapped from tool-input-available), tool-result/tool-error
// (mapped from tool-output-available), and finish (mapped from finish frame).
//
// N-04 (single-shape pin): the SSE frame's tool result lives at `frame.output`,
// pinned to ai@5.0.179 single shape — no `?? frame.result` fallback.
//
// Pitfall 2 / vercel/ai #7683: do NOT enable AI SDK's auto-resume client
// option (the s-A-W flag) — the client manually decides whether to re-POST
// after addToolResult. See AI-SPEC §3 for the literal name and probe target.

import { supabase } from './supabase'
import { getActiveBYOKConfig } from './byok-configs'
import { screenshotParagraph } from './agent-tools/screenshot-paragraph'
import { readPaperSection } from './agent-tools/read-paper-section'
import { writeCanvas } from './agent-tools/write-canvas'
import type { RunAgentEvent } from '../../../supabase/functions/_shared/types'

export type { RunAgentEvent } from '../../../supabase/functions/_shared/types'

// ─── Phoenix local capture (AI-SPEC §5) — OFF by default ──────────────────
// Toggle via DevTools: localStorage.pf_phoenix_capture = '1'
// Phoenix runs at http://localhost:6006 (px.launch_app()).
// Trace payload MUST NOT include the BYOK apiKey or Authorization header (D-02).

type PhoenixTrace = {
  runId: string | null
  startedAt: number
  finishedAt: number | null
  messageCount: number
  frames: Array<{ type: string; toolName?: string; delta?: string }>
  finishReason?: string
}

function isPhoenixEnabled(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('pf_phoenix_capture') === '1'
  } catch {
    return false
  }
}

async function postPhoenixTrace(trace: PhoenixTrace): Promise<void> {
  try {
    await fetch('http://localhost:6006/v1/traces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Minimal shape — Phoenix's OTLP/HTTP collector is lenient for dev capture.
      body: JSON.stringify({
        resourceSpans: [
          {
            scopeSpans: [
              {
                spans: [
                  {
                    name: 'agent-run',
                    attributes: trace,
                  },
                ],
              },
            ],
          },
        ],
      }),
    })
  } catch {
    console.warn('[phoenix] capture skipped — collector unreachable at http://localhost:6006')
  }
}

// Reuse the same Supabase URL the auth client uses; ${SB_URL}/functions/v1/agent-run.
// VITE_SUPABASE_URL is inlined at build time (CLAUDE.md Auth+Sync section).
// Computed lazily so the test environment can stub the env after module init.
function agentRunUrl(): string {
  const base = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? ''
  return `${base.replace(/\/$/, '')}/functions/v1/agent-run`
}

const DEFAULT_MESSAGES = [
  {
    role: 'user' as const,
    content:
      'Search arXiv for "vision transformers ImageNet 2024" and then take a screenshot of paragraph "p-intro-1" in the open paper.',
  },
]

type Frame = {
  type: string
  toolCallId?: string
  toolName?: string
  input?: unknown
  output?: unknown
  delta?: string
  finishReason?: string
  totalTokens?: number
  // Other fields ignored for POC.
  [k: string]: unknown
}

type Message = {
  role: string
  content: unknown
  toolCallId?: string
}

type RunOpts = {
  messages?: Message[]
  abortSignal?: AbortSignal
}

// ─── Client tool dispatch table (D-C4 multi-tool) ──────────────────────────
// Maps toolName from server-emitted tool-input-available frames → client-side
// implementation. Each handler returns a `ToolResult<T>`-shaped object that
// gets serialized into the addToolResult message body (`role:'tool'`).
const CLIENT_TOOLS: Record<string, (input: unknown) => Promise<unknown>> = {
  screenshotParagraph: (input) => screenshotParagraph(input),
  readPaperSection: (input) => readPaperSection(input),
  writeCanvas: (input) => writeCanvas(input),
}

// ─── Public runAgent API (TOOL-01) ─────────────────────────────────────────
// Called from main chat (Plan 07 chat-view.tsx via useAgentRun) AND from the
// D-06 dev-menu trigger (via runAgentDevDemo thin wrapper below).

export interface RunAgentClientOpts {
  messages: Message[]
  abortSignal?: AbortSignal
  onEvent?: (e: RunAgentEvent) => void
  assistantMsgId?: string  // for useAgentRun reducer keying — passed through but not used by SSE consumer
}

export async function runAgent(opts: RunAgentClientOpts): Promise<void> {
  // 1. JWT — abort if not logged in.
  const { data: { session } } = await supabase.auth.getSession()
  if (!session || typeof (session as { access_token?: unknown }).access_token !== 'string') {
    console.warn('[agent-client] not logged in — please log in via the AccountMenu first')
    return
  }
  const accessToken = (session as { access_token: string }).access_token

  // 2. Active BYOK config — read at fetch time (D-D2). Mid-stream switches
  //    take effect on the NEXT runAgent call; the in-flight request uses
  //    immutable baseURL/apiKey/model captured here.
  let byokApiKey: string | null = null
  let byokBaseURL: string | undefined = undefined
  let byokModel: string | undefined = undefined

  try {
    const active = await getActiveBYOKConfig()
    if (active) {
      byokApiKey = active.apiKey || null
      byokBaseURL = active.base_url
      byokModel = active.model
    }
  } catch {
    // No active config — fall into the no-active-config branch below.
  }

  // WARN-4: apiKey is the load-bearing gate. Without it the request cannot
  // succeed regardless of baseURL/model — short-circuit here so the user
  // gets a clean "configure BYOK" prompt rather than a server 401. Do NOT
  // also gate on !byokBaseURL && !byokModel — those can be missing and the
  // server will return a clean error; apiKey absence is the only condition
  // that proves the request is hopeless before we send it.
  //
  // MED-6 (cross-AI review): emit the distinct `config-error` event variant
  // (NOT tool-error with empty toolCallId/toolName). This event occurs
  // pre-tool-call so the UI surfaces it as a banner / setup prompt rather
  // than a trace card. The shared RunAgentEvent union in
  // supabase/functions/_shared/types.ts is extended for this variant.
  if (!byokApiKey) {
    console.warn('[agent-client] no active BYOK config — open Options → BYOK Configs to create one')
    opts.onEvent?.({
      type: 'config-error',
      kind: 'no-active-config',
      reason: 'no active BYOK config — open Options → BYOK Configs to create one',
    })
    return
  }

  // 3. Loop with onEvent callback wired through.
  await consumeStream({
    accessToken,
    byokApiKey,
    baseURL: byokBaseURL,
    model: byokModel,
    messages: opts.messages,
    signal: opts.abortSignal,
    onEvent: opts.onEvent,
  })
}

// ─── D-06 dev-menu thin wrapper ────────────────────────────────────────────
// top-bar.tsx imports `runAgentDevDemo` from this module (was '../lib/agent-dev-demo'
// before Plan 06 rename). The dev menu does NOT pass onEvent — its frames are
// console-logged inside consumeStream as before.

export async function runAgentDevDemo(opts: RunOpts = {}): Promise<void> {
  return runAgent({
    messages: opts.messages ?? DEFAULT_MESSAGES,
    abortSignal: opts.abortSignal,
  })
}

async function consumeStream(args: {
  accessToken: string
  byokApiKey: string | null
  baseURL?: string
  model?: string
  messages: Message[]
  signal?: AbortSignal
  onEvent?: (e: RunAgentEvent) => void
}): Promise<void> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${args.accessToken}`,
  }
  if (args.byokApiKey) {
    headers['X-BYOK-Authorization'] = `Bearer ${args.byokApiKey}`
  }

  const phoenixOn = isPhoenixEnabled()
  const trace: PhoenixTrace = phoenixOn
    ? { runId: null, startedAt: Date.now(), finishedAt: null, messageCount: args.messages.length, frames: [], finishReason: undefined }
    : { runId: null, startedAt: 0, finishedAt: null, messageCount: 0, frames: [] } // unused when off

  let res: Response
  try {
    res = await fetch(agentRunUrl(), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        messages: args.messages,
        baseURL: args.baseURL,
        model: args.model,
        dev_probe: true,
      }),
      signal: args.signal,
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      console.info('[agent-client] aborted before stream started')
      return
    }
    throw e
  }

  console.info('[agent-client] X-Run-Id:', res.headers.get('X-Run-Id'))
  if (phoenixOn) trace.runId = res.headers.get('X-Run-Id')

  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => '')
    console.error('[agent-client] non-OK response', res.status, body)
    return
  }

  // SSE parser — REUSES the LF-LF / CRLF-CRLF tolerant frame extractor pattern
  // from reader/lib/ai.ts:222-281. Comment frames (lines starting with ":")
  // are filtered out before JSON parsing.
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const pendingToolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }> = []

  let aborted = false
  outer: while (true) {
    let read: ReadableStreamReadResult<Uint8Array>
    try {
      read = await reader.read()
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        console.info('[agent-client] aborted mid-stream')
        aborted = true
        break
      }
      throw e
    }
    if (read.done) break
    buffer += decoder.decode(read.value, { stream: true })

    while (true) {
      const lf = buffer.indexOf('\n\n')
      const crlf = buffer.indexOf('\r\n\r\n')
      let pos: number
      let len: number
      if (lf === -1 && crlf === -1) break
      if (lf === -1) { pos = crlf; len = 4 }
      else if (crlf === -1) { pos = lf; len = 2 }
      else if (crlf < lf) { pos = crlf; len = 4 }
      else { pos = lf; len = 2 }

      const frameStr = buffer.slice(0, pos)
      buffer = buffer.slice(pos + len)

      // Comment frames (keepalive) start with ":". Skip them.
      if (frameStr.startsWith(':')) continue

      const dataLine = frameStr.split(/\r?\n/).find((l) => l.startsWith('data: '))
      if (!dataLine) continue
      const payload = dataLine.slice(6).trim()
      if (payload === '[DONE]') break outer

      let frame: Frame
      try {
        frame = JSON.parse(payload) as Frame
      } catch {
        console.warn('[agent-client] non-JSON frame:', payload)
        continue
      }

      console.log('[agent-client]', frame.type, frame)

      if (phoenixOn) {
        // Capture only the SHAPE — never raw apiKey or headers (D-02)
        trace.frames.push({
          type: frame.type,
          toolName: frame.toolName,
          delta: typeof frame.delta === 'string' && frame.delta.length < 200 ? frame.delta : undefined,
        })
        if (frame.type === 'finish') trace.finishReason = frame.finishReason
      }

      if (frame.type === 'text-delta' && typeof frame.delta === 'string') {
        // Optional toast — POC keeps it simple by writing to a Console group.
        console.info('[agent-client:text]', frame.delta)
      }

      // ── RunAgentEvent emission (TOOL-05) ──────────────────────────────
      // W-05: NO step-start / step-finish synthesis here. Server's
      // runAgent.ts onStepFinish callback owns step boundaries; the client
      // emits only the variants below.
      if (
        frame.type === 'tool-input-available' &&
        typeof frame.toolName === 'string' &&
        typeof frame.toolCallId === 'string'
      ) {
        pendingToolCalls.push({
          toolCallId: frame.toolCallId,
          toolName: frame.toolName,
          input: frame.input,
        })
        args.onEvent?.({
          type: 'tool-call',
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
        // N-04: pinned to ai@5.0.179 single-shape — `frame.output`, no `?? frame.result` fallback.
        const output = frame.output
        // Detect logical/transient error shape (D-B1 discriminated union)
        if (output && typeof output === 'object' && 'ok' in output && (output as { ok: boolean }).ok === false) {
          const o = output as { ok: false; kind?: 'transient' | 'logical'; reason?: string; detail?: string }
          args.onEvent?.({
            type: 'tool-error',
            toolCallId: frame.toolCallId,
            toolName: frame.toolName,
            kind: o.kind ?? 'logical',
            reason: o.reason ?? 'unknown',
            detail: o.detail,
          })
        } else {
          args.onEvent?.({
            type: 'tool-result',
            toolCallId: frame.toolCallId,
            toolName: frame.toolName,
            output,
          })
        }
      }

      if (frame.type === 'finish') {
        args.onEvent?.({
          type: 'finish',
          totalTokens: frame.totalTokens,
          finishReason: frame.finishReason ?? 'stop',
        })
      }

      // `error` frames are informational; we still drain pending tool calls
      // below so the round-trip completes even after a finish.
    }
  }

  if (aborted) return

  if (phoenixOn) {
    trace.finishedAt = Date.now()
    void postPhoenixTrace(trace)
  }

  // 4. Handle pending CLIENT tool calls — compute results, then re-POST.
  //    Phase 11 Plan 06 (D-C4): dispatch table covers screenshotParagraph,
  //    readPaperSection, writeCanvas. Server tools (searchArxiv, etc.) had
  //    `execute` and emitted tool-output-available frames already — no client
  //    work needed for them.
  if (pendingToolCalls.length === 0) return

  const newMessages: Message[] = [...args.messages]
  let appended = 0
  for (const call of pendingToolCalls) {
    const handler = CLIENT_TOOLS[call.toolName]
    if (!handler) {
      console.warn('[agent-client] unsupported client tool:', call.toolName)
      continue
    }
    const result = await handler(call.input)
    // Append a tool result message — AI SDK 5 addToolResult flow shape.
    newMessages.push({
      role: 'tool',
      content: result,
      toolCallId: call.toolCallId,
    })
    // Surface client-side tool resolution via onEvent so trace UI reflects
    // the result before the server emits its own tool-output-available frame
    // on the next round.
    if (result && typeof result === 'object' && 'ok' in result && (result as { ok: boolean }).ok === false) {
      const r = result as { ok: false; kind?: 'transient' | 'logical'; reason?: string; detail?: string }
      args.onEvent?.({
        type: 'tool-error',
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        kind: r.kind ?? 'logical',
        reason: r.reason ?? 'unknown',
        detail: r.detail,
      })
    } else {
      args.onEvent?.({
        type: 'tool-result',
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        output: result,
      })
    }
    appended++
  }

  if (appended === 0) return

  // Re-POST with the appended messages. Pitfall 2 (#7683): do NOT enable AI
  // SDK's auto-resume client option — we explicitly drive the next request.
  await consumeStream({
    accessToken: args.accessToken,
    byokApiKey: args.byokApiKey,
    baseURL: args.baseURL,
    model: args.model,
    messages: newMessages,
    signal: args.signal,
    onEvent: args.onEvent,
  })
}
