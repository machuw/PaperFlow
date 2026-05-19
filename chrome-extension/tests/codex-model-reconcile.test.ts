// chrome-extension/tests/codex-model-reconcile.test.ts
//
// Slice 3 #25 — reconcileActiveCodexModel: when the active BYOK config is
// a codex preset and its stored model is missing from the freshly
// discovered list, auto-reset the model to availableModels[0] and dispatch
// a one-shot action toast informing the user.
//
// jsdom + in-memory chrome.storage shim verbatim from byok-configs.test.ts.
// supabase is mocked because byok-configs.ts imports it at the top level.

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../reader/lib/supabase', () => ({
  supabase: {
    auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }), then: (r: any) => r({ data: [], error: null }) }),
        limit: () => ({ then: (r: any) => r({ data: [], error: null }) }),
        then: (r: any) => r({ data: [], error: null }),
      }),
      insert: () => Promise.resolve({ data: null, error: null }),
      upsert: () => Promise.resolve({ data: null, error: null }),
      update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
      delete: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
    }),
    rpc: () => Promise.resolve({ data: null, error: null }),
    channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}), unsubscribe: () => Promise.resolve('ok') }),
  },
}));

const storageMock: Record<string, unknown> = {};

beforeEach(async () => {
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
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  };
  vi.resetModules();
});

async function seedActiveCodexConfig(model: string): Promise<void> {
  // Mirror byok-configs.createBYOKConfig's storage shape — a single active
  // codex BYOK row + cached active-id pointer.
  storageMock['config_byok_configs'] = [
    {
      id: 'cfg-codex-1',
      user_id: '',
      name: 'My ChatGPT',
      base_url: 'chatgpt://codex',
      model,
      is_active: true,
      created_at: '2026-05-19T00:00:00Z',
      updated_at: '2026-05-19T00:00:00Z',
    },
  ];
  storageMock['config_active_byok_config_id'] = 'cfg-codex-1';
  storageMock['config_apikeys'] = {};
}

describe('reconcileActiveCodexModel — Slice 3 #25', () => {
  it('cycle 1 tracer: stale active codex model is reset to availableModels[0]', async () => {
    await seedActiveCodexConfig('gpt-removed');
    const { reconcileActiveCodexModel } = await import('../reader/lib/codex-model-reconcile');
    await reconcileActiveCodexModel(['gpt-5.2', 'gpt-6-preview']);

    const rows = storageMock['config_byok_configs'] as Array<{ id: string; model: string }>;
    expect(rows[0].model).toBe('gpt-5.2');
  });

  it('cycle 2: dispatches pf-show-toast whose message names both the old and new model id', async () => {
    await seedActiveCodexConfig('gpt-removed');
    const toastEvents: any[] = [];
    const listener = (e: Event) => toastEvents.push((e as CustomEvent).detail);
    window.addEventListener('pf-show-toast', listener);
    try {
      const { reconcileActiveCodexModel } = await import('../reader/lib/codex-model-reconcile');
      await reconcileActiveCodexModel(['gpt-5.2']);
    } finally {
      window.removeEventListener('pf-show-toast', listener);
    }

    expect(toastEvents).toHaveLength(1);
    expect(toastEvents[0].message).toContain('gpt-removed');
    expect(toastEvents[0].message).toContain('gpt-5.2');
    // Open Options action wired so the user can adjust their pick.
    expect(toastEvents[0].action?.label).toBeTruthy();
    expect(typeof toastEvents[0].action?.handler).toBe('function');
    expect(toastEvents[0].timeoutMs).toBe(8000);
  });

  it('cycle 4: active config is non-codex — leave it alone (no write, no toast)', async () => {
    // Seed an openai-compatible row whose model coincidentally is not in the
    // codex list. The codex discovery refresh must not disturb non-codex
    // configs — that would clobber a user-edited DeepSeek / OpenRouter pick.
    storageMock['config_byok_configs'] = [
      {
        id: 'cfg-openai-1',
        user_id: '',
        name: 'My OpenAI',
        base_url: 'https://api.openai.com/v1',
        model: 'gpt-4o',
        is_active: true,
        created_at: '2026-05-19T00:00:00Z',
        updated_at: '2026-05-19T00:00:00Z',
      },
    ];
    storageMock['config_active_byok_config_id'] = 'cfg-openai-1';
    storageMock['config_apikeys'] = { 'cfg-openai-1': 'sk-...' };

    const toastEvents: any[] = [];
    const listener = (e: Event) => toastEvents.push((e as CustomEvent).detail);
    window.addEventListener('pf-show-toast', listener);
    try {
      const { reconcileActiveCodexModel } = await import('../reader/lib/codex-model-reconcile');
      await reconcileActiveCodexModel(['gpt-5.2']);
    } finally {
      window.removeEventListener('pf-show-toast', listener);
    }

    const rows = storageMock['config_byok_configs'] as Array<{ model: string }>;
    expect(rows[0].model).toBe('gpt-4o');
    expect(toastEvents).toHaveLength(0);
  });

  it('PR #30 review fix: refreshAvailableModels (via getValidAccessToken refresh) calls reconcile end-to-end', async () => {
    // Guards the dynamic-import wire-up in codex-auth.ts. If anyone deletes
    // the `await import('./codex-model-reconcile')` line, the unit cycles
    // above still pass — only an integration test against the actual refresh
    // flow catches the regression. Mocks the token + /codex/models fetches,
    // seeds an expired access_token + a stale codex active config, then
    // verifies the config's stored model was rewritten through the entire
    // refresh → discovery → reconcile chain.
    await seedActiveCodexConfig('gpt-removed');
    storageMock['codex_auth_tokens'] = {
      access_token:  'old-access',
      refresh_token: 'old-refresh',
      expires_at:    Date.now() - 1, // expired → forces refresh
      token_type:    'bearer',
    };

    const fetchMock = vi.fn();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      fetchMock
        // 1) /oauth/token refresh
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token:  'fresh-access',
              refresh_token: 'fresh-refresh',
              expires_in:    864_000,
              token_type:    'bearer',
            }),
            { status: 200 },
          ),
        )
        // 2) /codex/models discovery — returns a list WITHOUT 'gpt-removed'
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ data: [{ id: 'gpt-5.2' }] }), { status: 200 }),
        );

      const { getValidAccessToken } = await import('../reader/lib/codex-auth');
      await getValidAccessToken();
      // Discovery + reconcile run as a void'd chain off the refresh path,
      // with a deep await stack: fetch → json → setItem → dynamic import
      // → reconcile → getActiveBYOKConfig → updateBYOKConfig. Poll the
      // observable instead of guessing the right number of microtask flips.
      const start = Date.now();
      while (Date.now() - start < 1000) {
        const rows = storageMock['config_byok_configs'] as Array<{ model: string }>;
        if (rows[0].model === 'gpt-5.2') break;
        await new Promise((r) => setTimeout(r, 0));
      }

      const rows = storageMock['config_byok_configs'] as Array<{ model: string }>;
      expect(rows[0].model).toBe('gpt-5.2');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('cycle 5: empty newModels — no write, no toast (defensive)', async () => {
    // refreshAvailableModels guarantees a [CODEX_DEFAULT_MODEL] fallback, but
    // double-defend: if someone ever calls reconcile with [] directly, we
    // must NOT rewrite cfg.model to undefined.
    await seedActiveCodexConfig('gpt-removed');
    const toastEvents: any[] = [];
    const listener = (e: Event) => toastEvents.push((e as CustomEvent).detail);
    window.addEventListener('pf-show-toast', listener);
    try {
      const { reconcileActiveCodexModel } = await import('../reader/lib/codex-model-reconcile');
      await reconcileActiveCodexModel([]);
    } finally {
      window.removeEventListener('pf-show-toast', listener);
    }

    const rows = storageMock['config_byok_configs'] as Array<{ model: string }>;
    expect(rows[0].model).toBe('gpt-removed');
    expect(toastEvents).toHaveLength(0);
  });

  it('cycle 3: model already in the list — no write, no toast', async () => {
    await seedActiveCodexConfig('gpt-5.2');
    const toastEvents: any[] = [];
    const listener = (e: Event) => toastEvents.push((e as CustomEvent).detail);
    window.addEventListener('pf-show-toast', listener);
    try {
      const { reconcileActiveCodexModel } = await import('../reader/lib/codex-model-reconcile');
      await reconcileActiveCodexModel(['gpt-5.2', 'gpt-6-preview']);
    } finally {
      window.removeEventListener('pf-show-toast', listener);
    }

    const rows = storageMock['config_byok_configs'] as Array<{ id: string; model: string; updated_at: string }>;
    expect(rows[0].model).toBe('gpt-5.2');
    // No spurious bump on the row's updated_at — the function never went near
    // updateBYOKConfig because the active model was already in the live list.
    expect(rows[0].updated_at).toBe('2026-05-19T00:00:00Z');
    expect(toastEvents).toHaveLength(0);
  });
});
