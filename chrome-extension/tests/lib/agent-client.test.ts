// chrome-extension/tests/lib/agent-client.test.ts
//
// Phase 11 Plan 06: renamed from agent-dev-demo.test.ts. Covers the same
// SSE-consumer surface (now in reader/lib/agent-client.ts) plus the new
// ToolResult discriminated union shape from Plan 05 (`result.data.dataUrl`).
//
// Surface under test:
//   - reader/lib/agent-tools/screenshot-paragraph.ts (Plan 05 — `{ok:true, data:{dataUrl}}` shape)
//   - reader/lib/agent-client.ts (JWT bail-out, BYOK header attach,
//     [DONE]-terminated SSE parsing, addToolResult round-trip)
//
// Networking + storage are mocked via vi.mock — the test stays hermetic and
// does NOT require a live Supabase instance.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// --- chrome.storage.local stub ----------------------------------------------
// agent-client reads `config_apikey` via chrome.storage.local.get(['config_apikey']).
// Tests inject the value through this in-memory store.
let storageStore: Record<string, unknown> = {}
// Plan 05 real screenshotParagraph uses chrome.tabs.captureVisibleTab + CSS.escape
// + document.querySelector. Stub all three so the agent-client round-trip test
// (round 2 invokes screenshotParagraph in browser context) reaches the
// `result.data.dataUrl` shape and the addToolResult re-POST happens.
;(globalThis as unknown as { chrome: unknown }).chrome = {
  storage: {
    local: {
      get: (keys: string[] | string) => {
        const arr = Array.isArray(keys) ? keys : [keys]
        const out: Record<string, unknown> = {}
        for (const k of arr) if (k in storageStore) out[k] = storageStore[k]
        return Promise.resolve(out)
      },
      set: (_obj: Record<string, unknown>) => Promise.resolve(),
    },
  },
  tabs: {
    captureVisibleTab: (
      _opts: { format: string },
      cb: (data: string) => void,
    ) => {
      // 1×1 transparent PNG.
      cb('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=')
    },
  },
  runtime: { lastError: null as null | { message: string } },
}

// CSS.escape polyfill — jsdom does NOT provide CSS as a global. Plan 05
// screenshotParagraph uses CSS.escape on paragraphId before querySelector.
if (typeof (globalThis as unknown as { CSS?: unknown }).CSS === 'undefined') {
  ;(globalThis as unknown as { CSS: { escape: (s: string) => string } }).CSS = {
    escape: (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '\\$&'),
  }
}
// jsdom provides document + requestAnimationFrame but NOT Element.scrollIntoView.
// Plan 05 screenshotParagraph calls target.scrollIntoView before captureVisibleTab —
// stub it as a no-op so the call resolves cleanly.
if (typeof Element !== 'undefined' && !(Element.prototype as { scrollIntoView?: unknown }).scrollIntoView) {
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {}
}

// --- Supabase client stub ---------------------------------------------------
const getSessionMock = vi.fn<[], Promise<{ data: { session: unknown } }>>()
vi.mock('../../reader/lib/supabase', () => ({
  supabase: {
    auth: { getSession: () => getSessionMock() },
  },
}))

// --- byok-configs stub (Phase 12 Plan 05) -----------------------------------
// agent-client.runAgent now reads the active config via
// byok-configs.getActiveBYOKConfig() at fetch time (D-D2 read-at-call-time).
// Default to null so the legacy `config_apikey` fallback path covers existing
// test cases unchanged.
const getActiveBYOKConfigMock = vi.fn<[], Promise<unknown>>()
vi.mock('../../reader/lib/byok-configs', () => ({
  getActiveBYOKConfig: () => getActiveBYOKConfigMock(),
}))

// fetch — assigned per-test so each test can drive its own SSE script.
const fetchMock = vi.fn()
;(globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch

// --- Helpers ----------------------------------------------------------------

/** Build a Response with a streamed body emitting the given SSE frames. */
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
    headers: { 'Content-Type': 'text/event-stream', 'X-Run-Id': 'test-run-id' },
  })
}

beforeEach(() => {
  storageStore = {}
  getSessionMock.mockReset()
  fetchMock.mockReset()
  // Phase 12 Plan 05: reset multi-config mock; default to null so existing
  // legacy `config_apikey` cases continue to work via the new fallback path.
  getActiveBYOKConfigMock.mockReset()
  getActiveBYOKConfigMock.mockResolvedValue(null)
  // Inject the fake paragraph element so Plan 05 screenshotParagraph's
  // document.querySelector(`[data-pid="..."]`) finds a hit.
  document.body.innerHTML = '<div data-pid="p-intro-1">intro paragraph</div><div data-pid="p-1">round-trip paragraph</div>'
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

// ---------------------------------------------------------------------------
// screenshotParagraph stub
// ---------------------------------------------------------------------------

describe('screenshotParagraph (Plan 05 real impl)', () => {
  it('returns ok=true with a data:image/png URL when paragraphId is provided', async () => {
    const { screenshotParagraph } = await import('../../reader/lib/agent-tools/screenshot-paragraph')
    const result = await screenshotParagraph({ paragraphId: 'p-intro-1' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.dataUrl).toMatch(/^data:image\/png;base64,/)
    }
  })

  it('returns ok=false when paragraphId is missing', async () => {
    const { screenshotParagraph } = await import('../../reader/lib/agent-tools/screenshot-paragraph')
    const result = await screenshotParagraph({} as { paragraphId: string })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      // Plan 05: Zod schema rejection produces { ok:false, kind:'logical', reason:'bad-input', detail:<zod msg> }
      expect(result.reason).toBe('bad-input')
      expect(result.kind).toBe('logical')
      expect(result.detail).toMatch(/paragraphId/i)
    }
  })
})

// ---------------------------------------------------------------------------
// runAgentDevDemo
// ---------------------------------------------------------------------------

describe('runAgentDevDemo', () => {
  it('returns silently and logs a warning when no Supabase session', async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { runAgentDevDemo } = await import('../../reader/lib/agent-client')
    await runAgentDevDemo()

    expect(warn).toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('attaches Authorization Bearer + X-BYOK-Authorization when BYOK is set, then drains [DONE]', async () => {
    getSessionMock.mockResolvedValue({
      data: { session: { access_token: 'JWT-AAA' } },
    })
    // Phase 17: BYOK comes exclusively from getActiveBYOKConfig (multi-config).
    // The v1.1 fallback via storageStore['config_apikey'] was deleted.
    getActiveBYOKConfigMock.mockResolvedValue({
      id: 'cfg-AAA', user_id: '', name: 'Default',
      base_url: 'https://api.openai.com/v1', model: 'gpt-4o',
      is_active: true, created_at: '', updated_at: '',
      apiKey: 'sk-byok-secret',
    })

    fetchMock.mockResolvedValueOnce(
      sseResponse([
        'data: {"type":"text-start"}\n\n',
        'data: {"type":"text-delta","delta":"hello"}\n\n',
        'data: {"type":"finish","finishReason":"stop"}\n\n',
        'data: [DONE]\n\n',
      ]),
    )

    const { runAgentDevDemo } = await import('../../reader/lib/agent-client')
    await runAgentDevDemo()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0]
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer JWT-AAA')
    expect(headers['X-BYOK-Authorization']).toBe('Bearer sk-byok-secret')
    expect(headers['Content-Type']).toBe('application/json')
    // dev_probe smart-sampling tag
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ dev_probe: true })
  })

  it('omits X-BYOK-Authorization when apiKey is empty string (placeholder allowed via legacy fallback)', async () => {
    // Phase 12 Plan 05 contract change: a fully-missing apiKey now triggers the
    // WARN-4 config-error short-circuit. To keep coverage of the
    // "no X-BYOK-Authorization header" branch, we set apiKey to empty string
    // via legacy fallback — runAgent reads it as null and emits config-error.
    // The behaviour we now assert: no fetch + no X-BYOK-Authorization leak.
    getSessionMock.mockResolvedValue({
      data: { session: { access_token: 'JWT-BBB' } },
    })

    const { runAgentDevDemo } = await import('../../reader/lib/agent-client')
    await runAgentDevDemo()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('handles tool-input-available for screenshotParagraph by re-POSTing with addToolResult message', async () => {
    getSessionMock.mockResolvedValue({
      data: { session: { access_token: 'JWT-CCC' } },
    })
    // Phase 17: BYOK from getActiveBYOKConfig (multi-config); v1.1 fallback gone.
    getActiveBYOKConfigMock.mockResolvedValue({
      id: 'cfg-CCC', user_id: '', name: 'Default',
      base_url: 'https://api.openai.com/v1', model: 'gpt-4o',
      is_active: true, created_at: '', updated_at: '',
      apiKey: 'sk-CCC',
    })

    // Stream 1: server emits one client tool-call.
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        'data: {"type":"tool-input-available","toolCallId":"call-1","toolName":"screenshotParagraph","input":{"paragraphId":"p-1"}}\n\n',
        'data: {"type":"finish","finishReason":"tool-calls"}\n\n',
        'data: [DONE]\n\n',
      ]),
    )
    // Stream 2: continuation finishes immediately.
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        'data: {"type":"text-delta","delta":"done"}\n\n',
        'data: {"type":"finish","finishReason":"stop"}\n\n',
        'data: [DONE]\n\n',
      ]),
    )

    const { runAgentDevDemo } = await import('../../reader/lib/agent-client')
    await runAgentDevDemo()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const secondCallBody = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)
    // The tool-result message must carry the toolCallId verbatim and an ok=true content.
    const toolMsg = secondCallBody.messages.find((m: { role: string }) => m.role === 'tool')
    expect(toolMsg).toBeDefined()
    expect(toolMsg.toolCallId).toBe('call-1')
    expect(toolMsg.content).toMatchObject({ ok: true })
    expect(typeof toolMsg.content.data.dataUrl).toBe('string')
    expect(toolMsg.content.data.dataUrl.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('tolerates CRLF line endings in SSE frames', async () => {
    getSessionMock.mockResolvedValue({
      data: { session: { access_token: 'JWT-DDD' } },
    })
    getActiveBYOKConfigMock.mockResolvedValue({
      id: 'cfg-DDD', user_id: '', name: 'Default',
      base_url: 'https://api.openai.com/v1', model: 'gpt-4o',
      is_active: true, created_at: '', updated_at: '',
      apiKey: 'sk-DDD',
    })
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        'data: {"type":"text-delta","delta":"x"}\r\n\r\n',
        'data: [DONE]\r\n\r\n',
      ]),
    )

    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { runAgentDevDemo } = await import('../../reader/lib/agent-client')
    await runAgentDevDemo()
    // text-delta frame was successfully parsed.
    const types = log.mock.calls.map((c) => c[1])
    expect(types).toContain('text-delta')
  })

  it('skips keepalive comment frames (lines starting with ":")', async () => {
    getSessionMock.mockResolvedValue({
      data: { session: { access_token: 'JWT-EEE' } },
    })
    getActiveBYOKConfigMock.mockResolvedValue({
      id: 'cfg-EEE', user_id: '', name: 'Default',
      base_url: 'https://api.openai.com/v1', model: 'gpt-4o',
      is_active: true, created_at: '', updated_at: '',
      apiKey: 'sk-EEE',
    })
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        ':keepalive\n\n',
        'data: {"type":"text-delta","delta":"y"}\n\n',
        'data: [DONE]\n\n',
      ]),
    )
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { runAgentDevDemo } = await import('../../reader/lib/agent-client')
    await runAgentDevDemo()
    // The keepalive must NOT appear as a logged frame.
    const types = log.mock.calls.map((c) => c[1])
    expect(types).not.toContain(':keepalive')
    expect(types).toContain('text-delta')
  })

  it('aborts cleanly when the caller signals abort before fetch starts', async () => {
    getSessionMock.mockResolvedValue({
      data: { session: { access_token: 'JWT-FFF' } },
    })
    getActiveBYOKConfigMock.mockResolvedValue({
      id: 'cfg-FFF', user_id: '', name: 'Default',
      base_url: 'https://api.openai.com/v1', model: 'gpt-4o',
      is_active: true, created_at: '', updated_at: '',
      apiKey: 'sk-FFF',
    })
    const ctrl = new AbortController()
    ctrl.abort()
    const abortErr = new DOMException('aborted', 'AbortError')
    fetchMock.mockRejectedValueOnce(abortErr)

    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const { runAgentDevDemo } = await import('../../reader/lib/agent-client')
    await expect(runAgentDevDemo({ abortSignal: ctrl.signal })).resolves.toBeUndefined()
    expect(info).toHaveBeenCalled()
  })

  // ---------------------------------------------------------------------------
  // Phase 12 Plan 05: multi-config + 0-config + legacy fallback + WARN-4
  // ---------------------------------------------------------------------------

  it('runAgent reads active BYOK config from byok-configs.getActiveBYOKConfig and sends baseURL+model in body', async () => {
    getSessionMock.mockResolvedValue({
      data: { session: { access_token: 'JWT-MULTI-1' } },
    })
    getActiveBYOKConfigMock.mockResolvedValue({
      id: 'cfg-A',
      user_id: 'u',
      name: 'Default',
      base_url: 'https://api.openai.com/v1',
      model: 'gpt-4o',
      is_active: true,
      created_at: '',
      updated_at: '',
      apiKey: 'sk-active',
    })
    fetchMock.mockResolvedValueOnce(sseResponse(['data: [DONE]\n\n']))

    const { runAgent } = await import('../../reader/lib/agent-client')
    await runAgent({ messages: [{ role: 'user', content: 'hi' }] })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0]
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers['X-BYOK-Authorization']).toBe('Bearer sk-active')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.baseURL).toBe('https://api.openai.com/v1')
    expect(body.model).toBe('gpt-4o')
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }])
  })

  it('runAgent emits config-error event (NOT tool-error) when getActiveBYOKConfig returns null AND legacy config_apikey is missing', async () => {
    // MED-6 (cross-AI review): assert distinct config-error variant — NOT
    // tool-error with empty toolCallId/toolName (the prior overloaded shape).
    getSessionMock.mockResolvedValue({
      data: { session: { access_token: 'JWT-NO-CFG' } },
    })
    getActiveBYOKConfigMock.mockResolvedValue(null)
    // storageStore is empty (no config_apikey)

    const events: Array<Record<string, unknown>> = []
    const { runAgent } = await import('../../reader/lib/agent-client')
    await runAgent({
      messages: [{ role: 'user', content: 'hi' }],
      onEvent: (e) => events.push(e as unknown as Record<string, unknown>),
    })

    // No fetch should have happened.
    expect(fetchMock).not.toHaveBeenCalled()
    // Exactly one config-error event with kind='no-active-config' and a reason string.
    const cfgErrors = events.filter((e) => e.type === 'config-error')
    expect(cfgErrors.length).toBe(1)
    expect(cfgErrors[0].kind).toBe('no-active-config')
    expect(typeof cfgErrors[0].reason).toBe('string')
    // Anti-assertion: no tool-error with empty toolCallId/toolName (prior overloaded shape).
    const overloadedToolErrors = events.filter(
      (e) =>
        e.type === 'tool-error' &&
        (e as { toolCallId?: string }).toolCallId === '' &&
        (e as { toolName?: string }).toolName === '',
    )
    expect(overloadedToolErrors.length).toBe(0)
  })

  it('Phase 17 D-B1: runAgent does NOT fall back to legacy v1.1 keys (config_apikey/prefs) — emits config-error instead', async () => {
    // Phase 17 deleted the v1.1 backward-compat fallback in agent-client.ts:
    // when getActiveBYOKConfig returns null, runAgent no longer reads
    // config_apikey/config_prefs from chrome.storage.local. Even if a v1.1
    // user is mid-migration with both keys still in storage (which the
    // boot-time retire migration normally cleans), runAgent emits
    // config-error rather than using the legacy keys. The user is steered
    // to Options → BYOK Configs to create a multi-config row.
    getSessionMock.mockResolvedValue({
      data: { session: { access_token: 'JWT-LEGACY' } },
    })
    getActiveBYOKConfigMock.mockResolvedValue(null)
    storageStore['config_apikey'] = 'sk-legacy'
    storageStore['config_prefs'] = { baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini' }

    const events: Array<Record<string, unknown>> = []
    const { runAgent } = await import('../../reader/lib/agent-client')
    await runAgent({
      messages: [{ role: 'user', content: 'hi' }],
      onEvent: (e) => events.push(e as unknown as Record<string, unknown>),
    })

    // No fetch — Phase 17 D-B1 short-circuits at the no-active-config branch
    // because the v1.1 fallback path was deleted.
    expect(fetchMock).not.toHaveBeenCalled()
    // config-error emitted (MED-6 variant; same shape as the
    // baseURL-without-apiKey case below).
    const cfgErrors = events.filter((e) => e.type === 'config-error')
    expect(cfgErrors.length).toBe(1)
    expect(cfgErrors[0].kind).toBe('no-active-config')
  })

  it('runAgent emits config-error when only baseURL is present but apiKey is missing', async () => {
    // WARN-4: apiKey is the only load-bearing field — gate must be !byokApiKey alone,
    // not !byokApiKey && !byokBaseURL && !byokModel.
    // MED-6 (cross-AI review): emit config-error variant, not overloaded tool-error.
    getSessionMock.mockResolvedValue({
      data: { session: { access_token: 'JWT-WARN-4' } },
    })
    getActiveBYOKConfigMock.mockResolvedValue(null)
    storageStore['config_prefs'] = { baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini' }
    // NO config_apikey — apiKey is missing despite baseURL/model being present.

    const events: Array<Record<string, unknown>> = []
    const { runAgent } = await import('../../reader/lib/agent-client')
    await runAgent({
      messages: [{ role: 'user', content: 'hi' }],
      onEvent: (e) => events.push(e as unknown as Record<string, unknown>),
    })

    // No fetch — apiKey is the load-bearing gate (WARN-4).
    expect(fetchMock).not.toHaveBeenCalled()
    // config-error variant emitted with no-active-config kind (MED-6).
    const cfgErrors = events.filter((e) => e.type === 'config-error')
    expect(cfgErrors.length).toBe(1)
    expect(cfgErrors[0].kind).toBe('no-active-config')
    // Anti-assertion: NOT a tool-error with empty toolCallId (MED-6).
    const overloadedToolErrors = events.filter(
      (e) =>
        e.type === 'tool-error' &&
        (e as { toolCallId?: string }).toolCallId === '' &&
        (e as { toolName?: string }).toolName === '',
    )
    expect(overloadedToolErrors.length).toBe(0)
  })
})
