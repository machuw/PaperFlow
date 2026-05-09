// supabase/functions/_shared/runAgent.ts
//
// Phase 11 D-A1..D-A4: server-side abstraction layer wrapping AI SDK 5
// streamText with manual step counter (D-04), tool-result observation
// (D-B2/D-B3), and abortSignal bridging. Pure compute — no Supabase imports.
//
// Public contract (RunAgentEvent) is locked in ./types.ts. Callers (the
// agent-run/index.ts shell) wire DB side-effects via onStepFinish/onFinish
// callbacks. The v1.5+ DIY swap-out (npm:openai + handwritten loop) only
// needs to re-implement this file — callers and the public event shape
// remain stable (CONTEXT line 281).
//
// D-A4 boundary:
//   - In runAgent: streamText, stopWhen + manual step counter (D-04),
//     prepareStep hook, onStepFinish event emit, tool registry assembly,
//     abort wiring inside loop, toUIMessageStreamResponse() egress.
//   - In the shell (agent-run/index.ts): JWT auth, rate_limit_check,
//     agent_runs INSERT/UPDATE, AbortController creation, X-Run-Id header
//     injection, keepalive pipeThrough at HTTP egress.
//
// D-02 invariant: runAgent NEVER reads `X-BYOK-Authorization` — the model
// arrives pre-built from buildProvider({req, body}) in the shell. The
// chokepoint stays at `_shared/byok-passthrough.ts`. This file's signature
// (no `req` parameter) is the structural enforcement of that invariant.

import { streamText, stepCountIs, type LanguageModel, type ModelMessage, type ToolSet, type Tool } from 'ai'
import type { RunAgentEvent } from './types.ts'

export interface RunAgentOptions {
  messages: ModelMessage[]
  tools: ToolSet
  /** Pre-built LanguageModel from buildProvider — runAgent never reads BYOK headers. */
  model: LanguageModel
  maxSteps: number
  systemPrompt?: string
  abortSignal: AbortSignal
  onEvent?: (e: RunAgentEvent) => void
  onStepFinish?: (step: { stepNumber: number; usage?: { totalTokens?: number } }) => void
  onFinish?: (info: {
    status: 'done' | 'aborted' | 'error'
    finishReason: string
    totalTokens: number
    stepCount: number
    errorMessage?: string
  }) => void
  prepareStep?: (params: { stepNumber: number }) => Record<string, unknown> | Promise<Record<string, unknown>>
}

/**
 * Wrap each tool's execute() so we can observe its ToolResult and emit
 * 'tool-error' events. Tools without `execute` (client tools) pass through
 * unchanged — the client implementation is observed via the SDK's
 * tool-output-available frame in the SSE stream (frame parsing happens in
 * the client agent-client.ts, not here).
 *
 * Per D-B1, server tools return the discriminated union
 *   { ok: true; data } | { ok: false; kind: 'transient'|'logical'; reason; detail? }
 * The wrapper inspects this shape and emits onEvent accordingly. The
 * original return value is passed through unchanged so the SDK's Data Stream
 * Protocol can serialize it into the tool-output-available frame (D-B3 path).
 */
function instrumentTools(
  tools: ToolSet,
  onEvent: ((e: RunAgentEvent) => void) | undefined,
): ToolSet {
  if (!onEvent) return tools
  const wrapped: Record<string, Tool> = {}
  for (const [name, def] of Object.entries(tools)) {
    const t = def as Tool & {
      execute?: (input: unknown, ctx: { toolCallId: string; abortSignal?: AbortSignal; messages: ModelMessage[] }) => unknown
    }
    if (typeof t.execute !== 'function') {
      // Client tool — no execute hook to wrap. Frame observation happens
      // downstream in agent-client.ts (Plan 11-06).
      wrapped[name] = t
      continue
    }
    const originalExecute = t.execute
    wrapped[name] = {
      ...t,
      execute: async (
        input: unknown,
        ctx: { toolCallId: string; abortSignal?: AbortSignal; messages: ModelMessage[] },
      ) => {
        // Emit tool-call BEFORE execute fires (the SDK also emits
        // tool-input-available frames; this gives runAgent observation parity
        // for server tools so UI can show a "running" trace card immediately).
        onEvent({ type: 'tool-call', toolCallId: ctx.toolCallId, toolName: name, input })

        // Phase 11 Plan 08 D-D2 candidate 1: race original execute against
        // abortSignal so outer abort propagates within the listener tick. If
        // the tool's underlying fetch ignores or buffers abort, the race
        // ensures we don't await past abort. The originalExecute is still
        // expected to forward ctx.abortSignal — this is the belt-and-suspenders
        // safety net for tools that miss the signal.
        const abortPromise = new Promise<never>((_, reject) => {
          if (ctx.abortSignal?.aborted) {
            reject(new Error('aborted'))
            return
          }
          ctx.abortSignal?.addEventListener(
            'abort',
            () => reject(new Error('aborted')),
            { once: true },
          )
        })
        let out: unknown
        try {
          out = await Promise.race([originalExecute(input, ctx), abortPromise])
        } catch (e) {
          if ((e as Error).message === 'aborted') {
            // Surface as transient tool-error; runAgent's outer abort path
            // will finalize the run as 'aborted' regardless.
            onEvent({
              type: 'tool-error',
              toolCallId: ctx.toolCallId,
              toolName: name,
              kind: 'transient',
              reason: 'aborted',
            })
            return { ok: false, kind: 'transient', reason: 'aborted' }
          }
          throw e
        }

        // Type-narrow on the discriminated union shape (D-B1). If the tool
        // returns a falsy ok flag with kind+reason, classify as tool-error;
        // otherwise treat as a successful tool result.
        if (
          out !== null
          && typeof out === 'object'
          && 'ok' in out
          && (out as { ok: unknown }).ok === false
          && 'kind' in out
          && 'reason' in out
        ) {
          const o = out as { ok: false; kind: 'transient' | 'logical'; reason: string; detail?: string }
          onEvent({
            type: 'tool-error',
            toolCallId: ctx.toolCallId,
            toolName: name,
            kind: o.kind,
            reason: o.reason,
            detail: o.detail,
          })
        } else {
          onEvent({ type: 'tool-result', toolCallId: ctx.toolCallId, toolName: name, output: out })
        }
        return out
      },
    } as Tool
  }
  return wrapped as ToolSet
}

/**
 * runAgent — server-side wrapper around streamText.
 *
 * Returns the SSE Response from `result.toUIMessageStreamResponse(...)` —
 * the caller is expected to `pipeThrough(createKeepaliveTransform)` at HTTP
 * egress (D-A4 last line: keepalive stays in shell, NOT inside runAgent).
 * The caller is also responsible for adding `X-Run-Id` to the response
 * headers (runAgent has no knowledge of the audit row id).
 */
export async function runAgent(opts: RunAgentOptions): Promise<Response> {
  // Manual step counter — D-04 ground truth. SDK stopWhen is belt-and-suspenders.
  let stepCount = 0
  let stepUsageTotal = 0
  let manualFinishReason: string | null = null

  // Inner controller chained to the outer abortSignal. The outer signal owns
  // client-disconnect semantics; the inner controller owns max-step abort.
  // Both abort the underlying streamText call (we pass inner.signal to the
  // SDK), but we keep them separate so the outer remains the source of truth
  // for caller-side teardown decisions.
  const inner = new AbortController()
  // Phase 11 Plan 08 D-D2 candidate 3: hold a reference to any reader runAgent
  // owns so streamText's internal cleanup doesn't hold up the abort tick. In
  // the current implementation runAgent does NOT directly own a downstream
  // reader (`toUIMessageStreamResponse` consumes streamText's parts internally
  // and returns a Response), so this slot is reserved for future use; setting
  // it preserves the abort-propagation pattern for v1.5+ DIY swap-out where
  // the loop may own a reader directly.
  let pendingReader: ReadableStreamDefaultReader<Uint8Array> | null = null
  const onOuterAbort = () => {
    inner.abort('outer-abort')
    // Cancel any reader runAgent owns so streamText's cleanup path doesn't
    // wait for downstream drain. .cancel() resolves synchronously when the
    // stream has no more pending reads.
    pendingReader?.cancel('outer-abort').catch(() => { /* no-op */ })
  }
  if (opts.abortSignal.aborted) {
    inner.abort('outer-already-aborted')
  } else {
    opts.abortSignal.addEventListener('abort', onOuterAbort, { once: true })
  }

  const tools = instrumentTools(opts.tools, opts.onEvent)

  const result = streamText({
    model: opts.model,
    tools,
    messages: opts.messages,
    system: opts.systemPrompt,
    stopWhen: stepCountIs(opts.maxSteps),
    abortSignal: inner.signal,
    onStepFinish: (step: { usage?: { totalTokens?: number } }) => {
      stepCount++
      stepUsageTotal += step.usage?.totalTokens ?? 0
      opts.onEvent?.({ type: 'step-finish', stepNumber: stepCount, finishReason: 'continue' })
      opts.onStepFinish?.({ stepNumber: stepCount, usage: step.usage })
      if (stepCount >= opts.maxSteps) {
        manualFinishReason = 'max-steps-reached'
        // GROUND TRUTH: independent of SDK stopWhen behavior under #7502/#7683.
        inner.abort('max-steps-reached')
      }
    },
    prepareStep: opts.prepareStep ?? (({ stepNumber }: { stepNumber: number }) => {
      // Default: no-op probe log — preserves Phase 10 D-04 observable proof
      // and Phase 10 integration Test 1's [prepareStep] step assertion. Logs
      // only `stepNumber` (an int) — never `messages` or `model` config
      // (PII guard; T-10-05-08 / T-11-01-01).
      console.info('[prepareStep] step', stepNumber)
      opts.onEvent?.({ type: 'step-start', stepNumber })
      return {}
    }),
    onFinish: ({ usage, finishReason: sdkReason }: { usage?: { totalTokens?: number }; finishReason?: string }) => {
      const terminal = manualFinishReason ?? (sdkReason ?? 'stop')
      const totalTokens = stepUsageTotal || (usage?.totalTokens ?? 0)
      const status: 'done' | 'aborted' | 'error' = opts.abortSignal.aborted
        ? 'aborted'
        : (sdkReason === 'error' ? 'error' : 'done')
      opts.onEvent?.({ type: 'finish', totalTokens, finishReason: terminal })
      opts.onFinish?.({
        status,
        finishReason: terminal,
        totalTokens,
        stepCount,
      })
    },
  })

  // Caller is responsible for keepalive pipeThrough at HTTP egress (D-A4).
  // We do NOT add X-Run-Id here — the shell does, since runAgent has no
  // knowledge of the audit row id.
  return result.toUIMessageStreamResponse({
    headers: { 'Cache-Control': 'no-store' },
  })
}
