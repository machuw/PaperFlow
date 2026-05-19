// chrome-extension/tests/codex-stream.test.ts
//
// Slice 2 #9 — codex-stream module unit tests.
// jsdom + inline chrome.storage shim + fetch mock; no real OpenAI hits.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const storageMock: Record<string, unknown> = {};
const fetchMock = vi.fn();
const originalFetch = globalThis.fetch;

beforeEach(() => {
  for (const k of Object.keys(storageMock)) delete storageMock[k];
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  (globalThis as any).chrome = {
    tabs: { create: vi.fn().mockResolvedValue({ id: 1 }) },
    storage: {
      local: {
        get: (k: string | string[] | null) => {
          if (k === null || k === undefined) return Promise.resolve({ ...storageMock });
          if (Array.isArray(k)) {
            const out: Record<string, unknown> = {};
            for (const key of k) if (key in storageMock) out[key] = storageMock[key];
            return Promise.resolve(out);
          }
          return Promise.resolve(k in storageMock ? { [k]: storageMock[k] } : {});
        },
        set: (obj: Record<string, unknown>) => {
          for (const [key, val] of Object.entries(obj)) storageMock[key] = val;
          return Promise.resolve();
        },
        remove: (k: string | string[]) => {
          const keys = Array.isArray(k) ? k : [k];
          for (const key of keys) delete storageMock[key];
          return Promise.resolve();
        },
        clear: () => {
          for (const key of Object.keys(storageMock)) delete storageMock[key];
          return Promise.resolve();
        },
      },
    },
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('codex-stream', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('POSTs to the Codex backend with Bearer access_token + required headers', async () => {
    await chrome.storage.local.set({
      codex_auth_tokens: {
        access_token: 'tracer-access',
        refresh_token: 'tracer-refresh',
        expires_at: Date.now() + 10 * 60_000,
        token_type: 'bearer',
      },
    });
    fetchMock.mockResolvedValueOnce(
      new Response('', { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    );

    const { streamCodexResponses } = await import('../reader/lib/codex-stream');
    await streamCodexResponses(
      [{ role: 'user', content: 'hello' }],
      new AbortController().signal,
      () => {},
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('chatgpt.com/backend-api/codex/responses');
    expect(url).toContain('client_version=0.42.0');
    expect((init as RequestInit).method).toBe('POST');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer tracer-access');
    expect(headers['OpenAI-Beta']).toBe('responses=experimental');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('body has model=gpt-5.2, store=false, stream=true, input array maps from messages', async () => {
    await chrome.storage.local.set({
      codex_auth_tokens: {
        access_token: 'a',
        refresh_token: 'r',
        expires_at: Date.now() + 10 * 60_000,
        token_type: 'bearer',
      },
    });
    fetchMock.mockResolvedValueOnce(
      new Response('', { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    );

    const { streamCodexResponses } = await import('../reader/lib/codex-stream');
    await streamCodexResponses(
      [
        { role: 'user',      content: 'hi' },
        { role: 'assistant', content: 'hello' },
        { role: 'user',      content: 'tell me a joke' },
      ],
      new AbortController().signal,
      () => {},
    );

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('gpt-5.2');
    expect(body.store).toBe(false);
    expect(body.stream).toBe(true);
    expect(body.input).toEqual([
      { role: 'user',      content: 'hi' },
      { role: 'assistant', content: 'hello' },
      { role: 'user',      content: 'tell me a joke' },
    ]);
  });

  it('#22 cycle 6: body.model uses caller-supplied model id when provided', async () => {
    await chrome.storage.local.set({
      codex_auth_tokens: {
        access_token: 'a',
        refresh_token: 'r',
        expires_at: Date.now() + 10 * 60_000,
        token_type: 'bearer',
      },
    });
    fetchMock.mockResolvedValueOnce(
      new Response('', { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    );

    const { streamCodexResponses } = await import('../reader/lib/codex-stream');
    await streamCodexResponses(
      [{ role: 'user', content: 'hi' }],
      new AbortController().signal,
      () => {},
      'gpt-6-preview',
    );
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string).model).toBe('gpt-6-preview');
  });

  it('#22 cycle 6: empty / undefined model falls back to CODEX_DEFAULT_MODEL', async () => {
    await chrome.storage.local.set({
      codex_auth_tokens: {
        access_token: 'a',
        refresh_token: 'r',
        expires_at: Date.now() + 10 * 60_000,
        token_type: 'bearer',
      },
    });
    fetchMock.mockResolvedValue(
      new Response('', { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    );

    const { streamCodexResponses } = await import('../reader/lib/codex-stream');
    const { CODEX_DEFAULT_MODEL } = await import('../reader/lib/byok-presets');

    await streamCodexResponses(
      [{ role: 'user', content: 'hi' }],
      new AbortController().signal,
      () => {},
      '',
    );
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string).model)
      .toBe(CODEX_DEFAULT_MODEL);

    await streamCodexResponses(
      [{ role: 'user', content: 'hi' }],
      new AbortController().signal,
      () => {},
      // 4th arg omitted
    );
    expect(JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string).model)
      .toBe(CODEX_DEFAULT_MODEL);
  });

  it('system messages are extracted into the instructions field; input contains only user/assistant', async () => {
    await chrome.storage.local.set({
      codex_auth_tokens: {
        access_token: 'a',
        refresh_token: 'r',
        expires_at: Date.now() + 10 * 60_000,
        token_type: 'bearer',
      },
    });
    fetchMock.mockResolvedValueOnce(
      new Response('', { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    );

    const { streamCodexResponses } = await import('../reader/lib/codex-stream');
    await streamCodexResponses(
      [
        { role: 'system', content: 'You are a paper summarizer. Be terse.' },
        { role: 'user',   content: 'Summarize this paper in one line.' },
      ],
      new AbortController().signal,
      () => {},
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.instructions).toBe('You are a paper summarizer. Be terse.');
    expect(body.input).toEqual([
      { role: 'user', content: 'Summarize this paper in one line.' },
    ]);
  });

  it('parses SSE deltas and invokes onChunk in order', async () => {
    await chrome.storage.local.set({
      codex_auth_tokens: {
        access_token: 'a',
        refresh_token: 'r',
        expires_at: Date.now() + 10 * 60_000,
        token_type: 'bearer',
      },
    });
    const encoder = new TextEncoder();
    const sse =
      'data: {"type":"response.output_text.delta","delta":"Hello "}\n\n' +
      'data: {"type":"response.output_text.delta","delta":"world"}\n\n' +
      'data: {"type":"response.output_text.delta","delta":"!"}\n\n' +
      'data: [DONE]\n\n';
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(sse));
        controller.close();
      },
    });
    fetchMock.mockResolvedValueOnce(
      new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    );

    const { streamCodexResponses } = await import('../reader/lib/codex-stream');
    const chunks: string[] = [];
    await streamCodexResponses(
      [{ role: 'user', content: 'hi' }],
      new AbortController().signal,
      (c) => chunks.push(c),
    );
    expect(chunks).toEqual(['Hello ', 'world', '!']);
  });

  it('on 401, forces a refresh and retries the request once, succeeds', async () => {
    await chrome.storage.local.set({
      codex_auth_tokens: {
        access_token: 'stale-access',
        refresh_token: 'stale-refresh',
        expires_at: Date.now() + 10 * 60_000,
        token_type: 'bearer',
      },
    });
    const encoder = new TextEncoder();
    const sseStream = () => new ReadableStream({
      start(c) {
        c.enqueue(encoder.encode(
          'data: {"type":"response.output_text.delta","delta":"ok"}\n\n' +
          'data: [DONE]\n\n',
        ));
        c.close();
      },
    });
    fetchMock
      // 1) initial Codex POST → 401
      .mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))
      // 2) /oauth/token refresh (called by getValidAccessToken({forceRefresh:true}))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({
          access_token: 'fresh-access',
          refresh_token: 'fresh-refresh',
          expires_in: 864_000,
          token_type: 'bearer',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ))
      // 3) #22 cycle 5: refresh path opportunistically re-discovers models.
      //    Returns 500 so the discovery falls back silently — the 401 retry
      //    is what this test cares about.
      .mockResolvedValueOnce(new Response('boom', { status: 500 }))
      // 4) retried Codex POST → 200 SSE
      .mockResolvedValueOnce(new Response(sseStream(), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }));

    const { streamCodexResponses } = await import('../reader/lib/codex-stream');
    const chunks: string[] = [];
    await streamCodexResponses(
      [{ role: 'user', content: 'hi' }],
      new AbortController().signal,
      (c) => chunks.push(c),
    );

    expect(chunks).toEqual(['ok']);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    // Retry used the freshly-refreshed access_token.
    const retryInit = fetchMock.mock.calls[3][1] as RequestInit;
    expect((retryInit.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer fresh-access',
    );
  });

  it('Slice 3 #12: on 401 after retry, throws CodexReloginRequiredError so the UI can surface a re-login toast', async () => {
    await chrome.storage.local.set({
      codex_auth_tokens: {
        access_token: 'a',
        refresh_token: 'r',
        expires_at: Date.now() + 10 * 60_000,
        token_type: 'bearer',
      },
    });
    fetchMock
      // 1) initial Codex POST → 401
      .mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))
      // 2) refresh → 200 with new token
      .mockResolvedValueOnce(new Response(
        JSON.stringify({
          access_token: 'fresh',
          refresh_token: 'fresh',
          expires_in: 864_000,
          token_type: 'bearer',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ))
      // 3) #22 cycle 5: refresh-driven model discovery (failure is silent)
      .mockResolvedValueOnce(new Response('boom', { status: 500 }))
      // 4) retried Codex POST → still 401
      .mockResolvedValueOnce(new Response('still unauthorized', { status: 401 }));

    const { streamCodexResponses } = await import('../reader/lib/codex-stream');
    const { CodexReloginRequiredError } = await import('../reader/lib/codex-auth');
    await expect(
      streamCodexResponses(
        [{ role: 'user', content: 'hi' }],
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toBeInstanceOf(CodexReloginRequiredError);
    expect(fetchMock).toHaveBeenCalledTimes(4); // 1 codex + 1 refresh + 1 discovery + 1 retry
  });

  it.each([
    ['404 model gone',           404, 'unknown model gpt-5.2'],
    ['400 schema change',        400, 'Bad Request: Instructions are required'],
    ['500 backend down',         500, 'internal server error'],
  ])('Slice 3 #12: %s also throws CodexApiSurfaceChangedError', async (_label, status, body) => {
    await chrome.storage.local.set({
      codex_auth_tokens: {
        access_token: 'a',
        refresh_token: 'r',
        expires_at: Date.now() + 10 * 60_000,
        token_type: 'bearer',
      },
    });
    fetchMock.mockResolvedValueOnce(new Response(body, { status }));

    const { streamCodexResponses, CodexApiSurfaceChangedError } =
      await import('../reader/lib/codex-stream');
    await expect(
      streamCodexResponses(
        [{ role: 'user', content: 'hi' }],
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toBeInstanceOf(CodexApiSurfaceChangedError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('Slice 3 #12: 403 forbidden throws CodexApiSurfaceChangedError so the UI can prompt to switch BYOK', async () => {
    await chrome.storage.local.set({
      codex_auth_tokens: {
        access_token: 'a',
        refresh_token: 'r',
        expires_at: Date.now() + 10 * 60_000,
        token_type: 'bearer',
      },
    });
    fetchMock.mockResolvedValueOnce(
      new Response('forbidden — not a Codex subscriber', { status: 403 }),
    );

    const { streamCodexResponses } = await import('../reader/lib/codex-stream');
    const { CodexApiSurfaceChangedError } = await import('../reader/lib/codex-stream');
    await expect(
      streamCodexResponses(
        [{ role: 'user', content: 'hi' }],
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toBeInstanceOf(CodexApiSurfaceChangedError);
    expect(fetchMock).toHaveBeenCalledTimes(1); // no refresh, no retry — 403 is terminal
  });

  it('PR #15 fix: fetch TypeError (offline / DNS) is classified as CodexNetworkError, not raw error', async () => {
    // Without this classification, every callAI caller's surfaceCodexError
    // check would slip past on offline and the user would see a useless
    // "AI request failed: Failed to fetch" toast instead of a classified one.
    await chrome.storage.local.set({
      codex_auth_tokens: {
        access_token: 'a',
        refresh_token: 'r',
        expires_at: Date.now() + 10 * 60_000,
        token_type: 'bearer',
      },
    });
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const { streamCodexResponses, CodexNetworkError } =
      await import('../reader/lib/codex-stream');
    await expect(
      streamCodexResponses(
        [{ role: 'user', content: 'hi' }],
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toBeInstanceOf(CodexNetworkError);
  });

  it('PR #15 fix: AbortError from fetch propagates verbatim (not wrapped as CodexNetworkError)', async () => {
    // The try/catch added for network classification must NOT swallow
    // user-initiated aborts — every caller has dedicated AbortError handling
    // and would otherwise show a misleading network toast.
    await chrome.storage.local.set({
      codex_auth_tokens: {
        access_token: 'a',
        refresh_token: 'r',
        expires_at: Date.now() + 10 * 60_000,
        token_type: 'bearer',
      },
    });
    fetchMock.mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'));

    const { streamCodexResponses, CodexNetworkError } =
      await import('../reader/lib/codex-stream');
    const promise = streamCodexResponses(
      [{ role: 'user', content: 'hi' }],
      new AbortController().signal,
      () => {},
    );
    await expect(promise).rejects.toThrow(/Abort/);
    await expect(promise).rejects.not.toBeInstanceOf(CodexNetworkError);
  });

  it('passes the AbortSignal to fetch so cancellation propagates', async () => {
    await chrome.storage.local.set({
      codex_auth_tokens: {
        access_token: 'a',
        refresh_token: 'r',
        expires_at: Date.now() + 10 * 60_000,
        token_type: 'bearer',
      },
    });
    fetchMock.mockResolvedValueOnce(
      new Response('', { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    );

    const { streamCodexResponses } = await import('../reader/lib/codex-stream');
    const controller = new AbortController();
    await streamCodexResponses(
      [{ role: 'user', content: 'hi' }],
      controller.signal,
      () => {},
    );
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBe(controller.signal);
  });

  it('PR #10 fix: aborting mid-SSE-stream rejects with AbortError and stops reading', async () => {
    // Signal-identity check (the test above) doesn't guarantee the reader
    // actually terminates — fetch could pass the signal but the consumer
    // loop could still hang. This test wires a real ReadableStream whose
    // pull function never completes, then aborts and asserts the promise
    // rejects with AbortError. Models the "user clicked stop mid-stream"
    // path that ai.ts depends on.
    await chrome.storage.local.set({
      codex_auth_tokens: {
        access_token: 'a',
        refresh_token: 'r',
        expires_at: Date.now() + 10 * 60_000,
        token_type: 'bearer',
      },
    });
    const controller = new AbortController();
    // Build a ReadableStream that emits one chunk, then waits until aborted.
    // The real Response/fetch contract: when AbortController.abort() fires
    // mid-stream, the underlying body reader's `read()` rejects with the
    // signal's reason. Simulate that by listening to the signal and
    // erroring the stream when it fires.
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(ctrl) {
        ctrl.enqueue(encoder.encode('data: {"delta":"start"}\n\n'));
        controller.signal.addEventListener('abort', () => {
          ctrl.error(controller.signal.reason ?? new DOMException('Aborted', 'AbortError'));
        });
      },
    });
    fetchMock.mockResolvedValueOnce(
      new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    );

    const { streamCodexResponses } = await import('../reader/lib/codex-stream');
    const chunks: string[] = [];
    const promise = streamCodexResponses(
      [{ role: 'user', content: 'hi' }],
      controller.signal,
      (c) => {
        chunks.push(c);
        controller.abort();  // abort as soon as first delta arrives
      },
    );
    await expect(promise).rejects.toThrow(/abort/i);
    expect(chunks).toEqual(['start']);  // got the first delta, then bailed
  });

  it('PR #10 fix: refresh→invalid_grant during 401 retry propagates CodexReloginRequiredError', async () => {
    // The 401 retry calls getValidAccessToken({forceRefresh:true}). If the
    // refresh_token is server-side revoked, codex-auth throws
    // CodexReloginRequiredError BEFORE the second Codex POST ever fires.
    // That error must propagate so the UI's surfaceCodexError can show the
    // re-login toast. Previously untested — would have silently degraded
    // to a "stream failed" generic error if the propagation broke.
    await chrome.storage.local.set({
      codex_auth_tokens: {
        access_token: 'stale',
        refresh_token: 'revoked-refresh',
        expires_at: Date.now() + 10 * 60_000,
        token_type: 'bearer',
      },
    });
    fetchMock
      // 1) initial Codex POST → 401
      .mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))
      // 2) /oauth/token refresh → 400 invalid_grant (revoked)
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ error: 'invalid_grant' }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      ));

    const { streamCodexResponses } = await import('../reader/lib/codex-stream');
    const { CodexReloginRequiredError } = await import('../reader/lib/codex-auth');
    await expect(
      streamCodexResponses(
        [{ role: 'user', content: 'hi' }],
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toBeInstanceOf(CodexReloginRequiredError);
    expect(fetchMock).toHaveBeenCalledTimes(2); // no 3rd Codex retry — refresh failed first
  });
});
