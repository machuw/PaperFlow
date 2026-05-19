import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock supabase so that auth.getSession() resolves with a fake access token.
vi.mock('../reader/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({
        data: { session: { access_token: 'fake-access-token' } },
      }),
    },
  },
}));

// Stand up an in-memory chrome.storage.local shim matching the pattern used
// in byok-sync.test.ts / storage-schema.test.ts.
const storageMock: Record<string, unknown> = {};
beforeEach(() => {
  for (const k of Object.keys(storageMock)) delete storageMock[k];
  (globalThis as any).chrome = {
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
          Object.assign(storageMock, obj);
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
      onChanged: { addListener: () => {}, removeListener: () => {} },
    },
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Build a minimal OpenAI-compatible SSE response body so that
 * callChatCompletion's stream reader terminates cleanly. A single [DONE]
 * frame is enough — the generator exits on that marker.
 */
function sseDoneResponse(): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

// Phase 17: helper that seeds Phase 12 multi-config schema in chrome.storage.local
// (replaces v1.1 setItem('config_apikey'/'config_prefs') idiom retired in
// Phase 17 D-B1+D-E2). All routing tests below use this single helper so the
// active-row write is canonical across cases.
async function seedActiveBYOKConfig(opts: { apiKey: string; baseURL: string; model: string }): Promise<void> {
  const { setItem } = await import('../reader/lib/storage-schema');
  await setItem('config_byok_configs', [{
    id: 'router-test-cfg',
    user_id: '',
    name: 'Default',
    base_url: opts.baseURL,
    model: opts.model,
    is_active: true,
    created_at: '2026-05-04T00:00:00.000Z',
    updated_at: '2026-05-04T00:00:00.000Z',
  }]);
  await setItem('config_apikeys', { 'router-test-cfg': opts.apiKey });
  await setItem('config_active_byok_config_id', 'router-test-cfg');
}

async function clearActiveBYOKConfig(): Promise<void> {
  const { removeItem } = await import('../reader/lib/storage-schema');
  await removeItem('config_byok_configs');
  await removeItem('config_apikeys');
  await removeItem('config_active_byok_config_id');
}

describe('callAI router — BYOK vs proxy (iron rule)', () => {
  it('apiKey set → fetch NEVER hits /functions/v1/ai-proxy', async () => {
    const { callAI } = await import('../reader/lib/ai');

    await seedActiveBYOKConfig({
      apiKey: 'sk-test',
      baseURL: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
    });

    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockImplementation(async () => sseDoneResponse());

    const onChunk = vi.fn();
    try {
      await callAI([{ role: 'user', content: 'hi' }], 'explain', onChunk);
    } catch {
      // BYOK stream-parser errors from the stubbed body are OK — the assertion
      // below is about WHERE fetch was called, not whether the call succeeded.
    }

    expect(fetchSpy).toHaveBeenCalled();
    for (const call of fetchSpy.mock.calls) {
      const url = String(call[0]);
      expect(url).not.toContain('/functions/v1/ai-proxy');
    }
  });

  it('no apiKey → fetch DOES hit /functions/v1/ai-proxy', async () => {
    const { callAI } = await import('../reader/lib/ai');

    await clearActiveBYOKConfig();

    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockImplementation(async () => sseDoneResponse());

    const onChunk = vi.fn();
    try {
      await callAI([{ role: 'user', content: 'hi' }], 'explain', onChunk);
    } catch {
      // Swallow — we care about fetch target, not end-to-end success.
    }

    const calledProxy = fetchSpy.mock.calls.some((c) =>
      String(c[0]).includes('/functions/v1/ai-proxy'),
    );
    expect(calledProxy).toBe(true);
  });
});

describe('callAI router — Slice 2 #9 Codex sentinel routing', () => {
  it('baseURL=chatgpt://codex → fetch hits chatgpt.com/backend-api/codex/responses, NOT ai-proxy or chat/completions', async () => {
    const { callAI } = await import('../reader/lib/ai');
    const { setItem } = await import('../reader/lib/storage-schema');

    await seedActiveBYOKConfig({
      apiKey: '',                       // codex preset has no user-supplied apiKey
      baseURL: 'chatgpt://codex',       // sentinel that triggers codex-stream
      model: 'gpt-5.2',
    });
    await setItem('codex_auth_tokens', {
      access_token: 'router-test-tok',
      refresh_token: 'r',
      // PR #10 review hardening introduced a 60s skew margin in
      // getValidAccessToken — sit well outside it.
      expires_at: Date.now() + 10 * 60_000,
      token_type: 'bearer',
    });

    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockImplementation(async () => sseDoneResponse());

    const onChunk = vi.fn();
    try {
      await callAI([{ role: 'user', content: 'hi' }], 'explain', onChunk);
    } catch {
      // ignore stream parse issues — only fetch targets matter here
    }

    const urls = fetchSpy.mock.calls.map((c) => String(c[0]));
    // Routed to codex-stream
    expect(urls.some((u) => u.includes('chatgpt.com/backend-api/codex/responses'))).toBe(true);
    // Did NOT touch managed proxy
    expect(urls.some((u) => u.includes('/functions/v1/ai-proxy'))).toBe(false);
    // Did NOT touch the standard openai-compatible /chat/completions path
    expect(urls.some((u) => u.endsWith('/chat/completions'))).toBe(false);
  });
});

describe('callAI router — Phase 15 D-E2 3-priority routing', () => {
  // Test 1 — managed wins over BYOK (priority 1)
  it('managedId set + valid BYOK apiKey → routes to ai-proxy with body.model', async () => {
    const { callAI } = await import('../reader/lib/ai');
    const { setItem } = await import('../reader/lib/storage-schema');

    // Both managed AND BYOK configured — managed must win (D-E2 priority 1).
    await setItem('config_active_managed_model_id', 'claude-haiku-4-5-20251001');
    await seedActiveBYOKConfig({
      apiKey: 'sk-test',
      baseURL: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
    });

    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockImplementation(async () => sseDoneResponse());

    const onChunk = vi.fn();
    try {
      await callAI([{ role: 'user', content: 'hi' }], 'explain', onChunk);
    } catch {
      // ignore stream parse issues
    }

    // ai-proxy was called with the managed model id; openai.com was NOT.
    const proxyCalls = fetchSpy.mock.calls.filter((c) =>
      String(c[0]).includes('/functions/v1/ai-proxy'),
    );
    expect(proxyCalls.length).toBeGreaterThan(0);
    for (const call of proxyCalls) {
      const init = call[1] as RequestInit;
      const body = JSON.parse(String(init.body));
      expect(body.model).toBe('claude-haiku-4-5-20251001');
    }
    // BYOK upstream NEVER called.
    for (const call of fetchSpy.mock.calls) {
      expect(String(call[0])).not.toContain('api.openai.com');
    }
  });

  // Test 2 — managedId empty + BYOK apiKey → BYOK wins (priority 2)
  it('managedId empty + valid BYOK apiKey → routes to BYOK', async () => {
    const { callAI } = await import('../reader/lib/ai');
    const { setItem } = await import('../reader/lib/storage-schema');

    await setItem('config_active_managed_model_id', '');
    await seedActiveBYOKConfig({
      apiKey: 'sk-test',
      baseURL: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
    });

    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockImplementation(async () => sseDoneResponse());

    const onChunk = vi.fn();
    try {
      await callAI([{ role: 'user', content: 'hi' }], 'explain', onChunk);
    } catch {
      /* swallow */
    }

    // ai-proxy NEVER called.
    for (const call of fetchSpy.mock.calls) {
      expect(String(call[0])).not.toContain('/functions/v1/ai-proxy');
    }
  });

  // Test 3 — managedId empty + no BYOK apiKey → fallback proxy WITHOUT model field
  it('managedId empty + no apiKey → routes to ai-proxy WITHOUT body.model', async () => {
    const { callAI } = await import('../reader/lib/ai');
    const { setItem } = await import('../reader/lib/storage-schema');

    await setItem('config_active_managed_model_id', '');
    await clearActiveBYOKConfig();

    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockImplementation(async () => sseDoneResponse());

    const onChunk = vi.fn();
    try {
      await callAI([{ role: 'user', content: 'hi' }], 'explain', onChunk);
    } catch {
      /* swallow */
    }

    const proxyCalls = fetchSpy.mock.calls.filter((c) =>
      String(c[0]).includes('/functions/v1/ai-proxy'),
    );
    expect(proxyCalls.length).toBeGreaterThan(0);
    for (const call of proxyCalls) {
      const init = call[1] as RequestInit;
      const body = JSON.parse(String(init.body));
      expect('model' in body).toBe(false); // model field omitted for fallback
    }
  });

  // Test 4 — streamThroughProxy with model emits "model" field (verified via Test 1)
  // Test 5 — streamThroughProxy without model OMITS field (verified via Test 3)

  // Test 6 — 403 with tier-locked payload → ProxyError 'TIER_NO_MANAGED_AI' + payload preserved
  it('403 tier-locked payload → ProxyError code "TIER_NO_MANAGED_AI" with payload preserved', async () => {
    const { callAI, ProxyError } = await import('../reader/lib/ai');
    const { setItem } = await import('../reader/lib/storage-schema');

    await setItem('config_active_managed_model_id', 'claude-haiku-4-5-20251001');

    const tierLockedPayload = {
      reason: 'tier-locked',
      required_tier: 'pro',
      upgrade_url: 'https://example.com/upgrade',
    };
    vi.spyOn(global, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify(tierLockedPayload), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const onChunk = vi.fn();
    let caught: unknown = null;
    try {
      await callAI([{ role: 'user', content: 'hi' }], 'explain', onChunk);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ProxyError);
    const e = caught as InstanceType<typeof ProxyError>;
    expect(e.code).toBe('TIER_NO_MANAGED_AI');
    expect(e.payload).toMatchObject({
      reason: 'tier-locked',
      required_tier: 'pro',
      upgrade_url: expect.any(String),
    });
  });

  // Test 7 — inactivity timeout regression (no chunks for >10s → ProxyError 'TIMEOUT')
  it('inactivity timeout still fires when stream stalls', async () => {
    vi.useFakeTimers();
    const { callAI, ProxyError } = await import('../reader/lib/ai');
    const { setItem } = await import('../reader/lib/storage-schema');

    await setItem('config_active_managed_model_id', '');
    await clearActiveBYOKConfig();

    // Build a stream that never emits and never closes — caller's watchdog
    // should abort it after the 10s inactivity threshold.
    let abortListener: (() => void) | null = null;
    vi.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          // Wire abort propagation so timer-driven .abort() actually rejects
          // the read promise (jsdom / node-stream behaviour parity).
          const sig = (init as RequestInit | undefined)?.signal;
          if (sig) {
            abortListener = () => {
              try { controller.error(new DOMException('Aborted', 'AbortError')); } catch { /* noop */ }
            };
            sig.addEventListener('abort', abortListener);
          }
          // intentionally never enqueue or close.
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    });

    const onChunk = vi.fn();
    let caught: unknown = null;
    const callPromise = callAI([{ role: 'user', content: 'hi' }], 'explain', onChunk).catch((e) => {
      caught = e;
    });

    // Advance past the 10s watchdog.
    await vi.advanceTimersByTimeAsync(11_000);
    // Yield microtasks so the abort propagates through the stream.
    await callPromise;

    expect(caught).toBeInstanceOf(ProxyError);
    expect((caught as InstanceType<typeof ProxyError>).code).toBe('TIMEOUT');
    vi.useRealTimers();
    // Cleanup ref to avoid leakage
    abortListener = null;
  });
});
