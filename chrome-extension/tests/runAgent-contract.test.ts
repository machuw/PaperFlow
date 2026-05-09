// chrome-extension/tests/runAgent-contract.test.ts
//
// Phase 11 Plan 06: DIY swap-out contract tests (CONTEXT line 177, selection
// note §9). Proves runAgent's public API shape (RunAgentEvent variants emitted
// via onEvent) is stable enough that a different implementation (e.g., DIY
// npm:openai + handwritten loop) can pass the same contract.
//
// Implementation strategy: stub globalThis.fetch with canned SSE frame
// sequences and assert the runAgent client wrapper translates AI SDK 5
// frame types → RunAgentEvent variants per W-05/W-06 invariants.
//
// W-06 honor (real bodies, no placeholders): each test uses Vitest
// `expect.objectContaining` matchers against the captured events array.
//
// Phase 14 eval set will integrate the agent-mock-provider.ts mock against
// the real Edge Function for end-to-end deterministic eval.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// --- chrome.storage.local stub ----------------------------------------------
;(globalThis as unknown as { chrome: unknown }).chrome = {
  storage: {
    local: {
      get: async () => ({}),
      set: async () => {},
    },
  },
  runtime: { lastError: null },
}

// --- Supabase client stub ---------------------------------------------------
const getSessionMock = vi.fn<[], Promise<{ data: { session: unknown } }>>()
vi.mock('../reader/lib/supabase', () => ({
  supabase: {
    auth: { getSession: () => getSessionMock() },
  },
}))

// --- fetch stub -------------------------------------------------------------
const fetchMock = vi.fn()
;(globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch

// --- Helpers ----------------------------------------------------------------

/** Build an SSE Response from JSON-frame strings. */
function sseResponse(frames: string[]): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const f of frames) controller.enqueue(encoder.encode(f))
      controller.close()
    },
  })
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream', 'X-Run-Id': 'contract-test-run' },
  })
}

function frame(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`
}

beforeEach(() => {
  getSessionMock.mockReset()
  getSessionMock.mockResolvedValue({ data: { session: { access_token: 'stub-jwt' } } })
  fetchMock.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('runAgent contract — public RunAgentEvent shape', () => {
  it('emits tool-call → tool-result → finish for happy path', async () => {
    const events: Array<{ type: string }> = []
    const { runAgent } = await import('../reader/lib/agent-client')

    fetchMock.mockResolvedValueOnce(
      sseResponse([
        frame({ type: 'tool-input-available', toolCallId: 'c1', toolName: 'searchArxiv', input: { query: 'test' } }),
        frame({ type: 'tool-output-available', toolCallId: 'c1', toolName: 'searchArxiv', output: { ok: true, data: { items: '<xml/>' } } }),
        frame({ type: 'finish', finishReason: 'stop', totalTokens: 100 }),
        'data: [DONE]\n\n',
      ]),
    )

    await runAgent({
      messages: [{ role: 'user', content: 'find papers' }],
      onEvent: (e) => events.push(e),
    })

    expect(events).toContainEqual(
      expect.objectContaining({ type: 'tool-call', toolCallId: 'c1', toolName: 'searchArxiv' }),
    )
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'tool-result', toolCallId: 'c1', toolName: 'searchArxiv' }),
    )
    expect(events).toContainEqual(expect.objectContaining({ type: 'finish' }))
    // W-05 honor: client does NOT synthesize step-start / step-finish from frame inspection.
    expect(events.filter((e) => e.type === 'step-start')).toHaveLength(0)
    expect(events.filter((e) => e.type === 'step-finish')).toHaveLength(0)
  })

  it('emits tool-error with kind:logical when output.ok===false && kind=="logical"', async () => {
    const events: Array<{ type: string; kind?: string; reason?: string }> = []
    const { runAgent } = await import('../reader/lib/agent-client')

    fetchMock.mockResolvedValueOnce(
      sseResponse([
        frame({ type: 'tool-input-available', toolCallId: 'c1', toolName: 'searchArxiv', input: { query: '' } }),
        frame({ type: 'tool-output-available', toolCallId: 'c1', toolName: 'searchArxiv', output: { ok: false, kind: 'logical', reason: 'arxiv-bad-query' } }),
        frame({ type: 'finish', finishReason: 'stop' }),
        'data: [DONE]\n\n',
      ]),
    )

    await runAgent({
      messages: [{ role: 'user', content: 'bad query' }],
      onEvent: (e) => events.push(e),
    })

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'tool-error',
        kind: 'logical',
        reason: 'arxiv-bad-query',
      }),
    )
    // Logical error MUST also emit an end-of-stream finish event (does not abort the contract).
    expect(events).toContainEqual(expect.objectContaining({ type: 'finish' }))
    // No tool-result for the failed call — only tool-error.
    expect(events.filter((e) => e.type === 'tool-result' && (e as { toolCallId?: string }).toolCallId === 'c1')).toHaveLength(0)
  })

  it('emits no further tool-result events after AbortController.abort()', async () => {
    const events: Array<{ type: string }> = []
    const { runAgent } = await import('../reader/lib/agent-client')

    // Slow stream: emit tool-call frame, then hang. Caller aborts within 50ms.
    fetchMock.mockImplementationOnce(async (_url: unknown, init?: RequestInit) => {
      const signal = init?.signal as AbortSignal | undefined
      const encoder = new TextEncoder()
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              frame({
                type: 'tool-input-available',
                toolCallId: 'c1',
                toolName: 'searchArxiv',
                input: { query: 'slow' },
              }),
            ),
          )
          // Never close — wait for abort signal to fire reader.cancel.
          if (signal) {
            signal.addEventListener('abort', () => {
              controller.error(new DOMException('aborted', 'AbortError'))
            })
          }
        },
      })
      return new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream', 'X-Run-Id': 'abort-test' },
      })
    })

    const ctl = new AbortController()
    const runPromise = runAgent({
      messages: [{ role: 'user', content: 'slow query' }],
      abortSignal: ctl.signal,
      onEvent: (e) => events.push(e),
    })
    await new Promise((r) => setTimeout(r, 50))
    ctl.abort()
    await runPromise.catch(() => { /* abort surfaces as throw or clean exit */ })
    // Allow any final flush.
    await new Promise((r) => setTimeout(r, 50))

    // Contract: tool-call emitted (server-side started), but NO tool-result
    // because we aborted before the server's tool-output-available frame.
    expect(events).toContainEqual(expect.objectContaining({ type: 'tool-call', toolCallId: 'c1' }))
    expect(events.filter((e) => e.type === 'tool-result')).toHaveLength(0)
  })
})
