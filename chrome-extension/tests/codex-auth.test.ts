// chrome-extension/tests/codex-auth.test.ts
//
// Slice 1 #8 — codex-auth module unit tests.
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
    tabs: {
      create: vi.fn().mockResolvedValue({ id: 1 }),
    },
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

// Drain pending microtasks. Used after getValidAccessToken() — its post-
// refresh `void refreshAvailableModels(...)` (PR #26 review LOW-2) returns
// control before the discovery fetch + setItem chain has run, so any
// assertion against storageMock['codex_available_models'] needs to wait
// for the void'd promise chain to complete. A 0-ms setTimeout lap drains
// every pending microtask (more robust than counting Promise.resolve flips).
async function flushAsync() {
  await new Promise((r) => setTimeout(r, 0));
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('codex-auth', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  describe('getValidAccessToken', () => {
    it('returns the stored access_token when it has not expired (no fetch)', async () => {
      await chrome.storage.local.set({
        codex_auth_tokens: {
          access_token: 'stored-access-token',
          refresh_token: 'stored-refresh-token',
          // PR #10 review hardening: 60s skew margin. Sit well outside the
          // refresh window so the token is unambiguously "not yet expired".
          expires_at: Date.now() + 10 * 60_000,
          token_type: 'bearer',
        },
      });
      const { getValidAccessToken } = await import('../reader/lib/codex-auth');
      const result = await getValidAccessToken();
      expect(result).toBe('stored-access-token');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('refreshes via /oauth/token when access_token has expired, returns new token and stores new pair', async () => {
      await chrome.storage.local.set({
        codex_auth_tokens: {
          access_token: 'old-access',
          refresh_token: 'old-refresh',
          expires_at: Date.now() - 1,
          token_type: 'bearer',
        },
      });
      fetchMock
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: 'new-access',
              refresh_token: 'new-refresh',
              id_token: 'new-id-token',
              expires_in: 864_000,
              token_type: 'bearer',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        )
        // #22 cycle 5: refresh path also re-fetches /codex/models.
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ data: [{ id: 'gpt-5.2' }, { id: 'gpt-6-preview' }] }),
            { status: 200 },
          ),
        );

      const { getValidAccessToken } = await import('../reader/lib/codex-auth');
      const before = Date.now();
      const result = await getValidAccessToken();
      // Discovery is fire-and-forget on the refresh path — let the void'd
      // promise chain drain before asserting on codex_available_models.
      await flushAsync();

      expect(result).toBe('new-access');
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://auth.openai.com/oauth/token');
      expect((init as RequestInit).method).toBe('POST');
      const body = new URLSearchParams((init as RequestInit).body as string);
      expect(body.get('grant_type')).toBe('refresh_token');
      expect(body.get('refresh_token')).toBe('old-refresh');
      expect(body.get('client_id')).toBe('app_EMoamEEZ73f0CkXaXp7hrann');

      const stored = storageMock['codex_auth_tokens'] as any;
      expect(stored.access_token).toBe('new-access');
      expect(stored.refresh_token).toBe('new-refresh');
      expect(stored.id_token).toBe('new-id-token');
      expect(stored.token_type).toBe('bearer');
      // expires_at ≈ now + 10 days; should comfortably be in the future
      expect(stored.expires_at).toBeGreaterThanOrEqual(before + 864_000 * 1000 - 1000);

      // #22 cycle 5: discovered model list cached with fresh access_token.
      expect(storageMock['codex_available_models']).toEqual(['gpt-5.2', 'gpt-6-preview']);
      const discoveryHeaders = (fetchMock.mock.calls[1][1] as RequestInit).headers as Record<string, string>;
      expect(discoveryHeaders['Authorization']).toBe('Bearer new-access');
    });

    it('throws CodexReloginRequiredError and clears stored tokens + user when refresh returns invalid_grant', async () => {
      await chrome.storage.local.set({
        codex_auth_tokens: {
          access_token: 'expired',
          refresh_token: 'revoked-refresh',
          expires_at: Date.now() - 1,
          token_type: 'bearer',
        },
        codex_auth_user: { email: 'someone@example.com' },
      });
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: 'invalid_grant', error_description: 'refresh_token revoked' }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        ),
      );

      const { getValidAccessToken, CodexReloginRequiredError } = await import(
        '../reader/lib/codex-auth'
      );
      await expect(getValidAccessToken()).rejects.toBeInstanceOf(CodexReloginRequiredError);
      expect(storageMock['codex_auth_tokens']).toBeUndefined();
      expect(storageMock['codex_auth_user']).toBeUndefined();
    });

    it('with forceRefresh: true, refreshes even when access_token has not expired', async () => {
      await chrome.storage.local.set({
        codex_auth_tokens: {
          access_token: 'still-valid-access',
          refresh_token: 'still-valid-refresh',
          expires_at: Date.now() + 60_000,
          token_type: 'bearer',
        },
      });
      fetchMock
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: 'forced-new-access',
              refresh_token: 'forced-new-refresh',
              expires_in: 864_000,
              token_type: 'bearer',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        )
        // #22 cycle 5: forceRefresh path also re-fetches /codex/models.
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ data: [{ id: 'gpt-5.2' }] }), { status: 200 }),
        );

      const { getValidAccessToken } = await import('../reader/lib/codex-auth');
      const result = await getValidAccessToken({ forceRefresh: true });
      await flushAsync();

      expect(result).toBe('forced-new-access');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('#22 cycle 5: refresh succeeds but discovery 500s — tokens stored, models fall back', async () => {
      await chrome.storage.local.set({
        codex_auth_tokens: {
          access_token: 'old-access',
          refresh_token: 'old-refresh',
          expires_at: Date.now() - 1,
          token_type: 'bearer',
        },
      });
      fetchMock
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: 'fresh',
              refresh_token: 'fresh-refresh',
              expires_in: 864_000,
              token_type: 'bearer',
            }),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(new Response('boom', { status: 500 }));

      const { getValidAccessToken } = await import('../reader/lib/codex-auth');
      const { CODEX_DEFAULT_MODEL } = await import('../reader/lib/byok-presets');
      const result = await getValidAccessToken();
      await flushAsync();

      expect(result).toBe('fresh');
      expect((storageMock['codex_auth_tokens'] as any).access_token).toBe('fresh');
      expect(storageMock['codex_available_models']).toEqual([CODEX_DEFAULT_MODEL]);
    });
  });

  describe('loginStart', () => {
    it('POSTs to /usercode with client_id, opens auth page in a new tab, returns deviceAuthId/userCode/intervalMs/expiresAtMs', async () => {
      const expiresIso = '2099-01-01T00:00:00.000Z';
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            device_auth_id: 'deviceauth_xyz',
            user_code: 'ABCD-EFGH',
            interval: '5',
            expires_at: expiresIso,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );

      const { loginStart } = await import('../reader/lib/codex-auth');
      const result = await loginStart();

      // POST /usercode with JSON body containing client_id
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://auth.openai.com/api/accounts/deviceauth/usercode');
      expect((init as RequestInit).method).toBe('POST');
      expect(JSON.parse((init as RequestInit).body as string)).toEqual({
        client_id: 'app_EMoamEEZ73f0CkXaXp7hrann',
      });

      // Opens the device auth page in a new tab — URL must carry the
      // server-issued user_code as a query param so the page pre-fills the
      // verification box instead of forcing the user to retype it.
      expect((chrome as any).tabs.create).toHaveBeenCalledTimes(1);
      const tabCall = (chrome as any).tabs.create.mock.calls[0][0];
      expect(tabCall.url).toBe('https://auth.openai.com/codex/device?user_code=ABCD-EFGH');

      // Return shape: interval parsed to ms, expires parsed to ms
      expect(result).toEqual({
        deviceAuthId: 'deviceauth_xyz',
        userCode: 'ABCD-EFGH',
        intervalMs: 5_000,
        expiresAtMs: new Date(expiresIso).getTime(),
      });
    });
  });

  describe('loginPoll', () => {
    // Build a fake JWT (header.payload.signature). Only payload is decoded
    // by the production code — header + sig can be arbitrary.
    function fakeJwt(payload: object): string {
      const b64 = (s: string) =>
        btoa(s).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
      return `${b64('{}')}.${b64(JSON.stringify(payload))}.sig`;
    }

    it('polls until 200, exchanges authorization_code for tokens, stores tokens and user', async () => {
      vi.useFakeTimers();
      try {
        // First two polls: 403 (still waiting). Third poll: 200 (authorized).
        fetchMock
          .mockResolvedValueOnce(new Response('still waiting', { status: 403 }))
          .mockResolvedValueOnce(new Response('still waiting', { status: 403 }))
          .mockResolvedValueOnce(
            new Response(
              JSON.stringify({
                authorization_code: 'auth-code-xyz',
                code_verifier: 'verifier-abc',
              }),
              { status: 200, headers: { 'content-type': 'application/json' } },
            ),
          )
          // Fourth call: token exchange at /oauth/token
          .mockResolvedValueOnce(
            new Response(
              JSON.stringify({
                access_token: 'fresh-access',
                refresh_token: 'fresh-refresh',
                id_token: fakeJwt({ email: 'someone@example.com' }),
                expires_in: 864_000,
                token_type: 'bearer',
              }),
              { status: 200, headers: { 'content-type': 'application/json' } },
            ),
          )
          // Fifth call (#22 cycle 4): post-exchange model discovery fetch.
          .mockResolvedValueOnce(
            new Response(
              JSON.stringify({ data: [{ id: 'gpt-5.2' }] }),
              { status: 200, headers: { 'content-type': 'application/json' } },
            ),
          );

        const { loginPoll } = await import('../reader/lib/codex-auth');
        const start = Date.now();
        const intervalMs = 5_000;
        const promise = loginPoll({
          deviceAuthId: 'device-auth-123',
          userCode: 'ABCD-EFGH',
          intervalMs,
          expiresAtMs: start + 15 * 60 * 1000, // 15 min window
        });

        // Advance enough time for three polling intervals to fire.
        await vi.advanceTimersByTimeAsync(intervalMs * 3 + 1);
        await promise;

        // Polling 3× + /oauth/token + /codex/models discovery = 5 total
        expect(fetchMock).toHaveBeenCalledTimes(5);
        const pollUrl = 'https://auth.openai.com/api/accounts/deviceauth/token';
        for (let i = 0; i < 3; i++) {
          expect(fetchMock.mock.calls[i][0]).toBe(pollUrl);
          const init = fetchMock.mock.calls[i][1] as RequestInit;
          expect(init.method).toBe('POST');
          const body = JSON.parse(init.body as string);
          expect(body).toEqual({ device_auth_id: 'device-auth-123', user_code: 'ABCD-EFGH' });
        }

        const [exchangeUrl, exchangeInit] = fetchMock.mock.calls[3];
        expect(exchangeUrl).toBe('https://auth.openai.com/oauth/token');
        const exchangeBody = new URLSearchParams((exchangeInit as RequestInit).body as string);
        expect(exchangeBody.get('grant_type')).toBe('authorization_code');
        expect(exchangeBody.get('code')).toBe('auth-code-xyz');
        expect(exchangeBody.get('code_verifier')).toBe('verifier-abc');
        expect(exchangeBody.get('client_id')).toBe('app_EMoamEEZ73f0CkXaXp7hrann');
        expect(exchangeBody.get('redirect_uri')).toBe(
          'https://auth.openai.com/deviceauth/callback',
        );

        const storedTokens = storageMock['codex_auth_tokens'] as any;
        expect(storedTokens.access_token).toBe('fresh-access');
        expect(storedTokens.refresh_token).toBe('fresh-refresh');
        expect(storedTokens.token_type).toBe('bearer');
        expect(storedTokens.expires_at).toBeGreaterThan(Date.now());

        const storedUser = storageMock['codex_auth_user'] as any;
        expect(storedUser).toEqual({ email: 'someone@example.com' });

        // #22 cycle 4: discovery results are stored under codex_available_models.
        const storedModels = storageMock['codex_available_models'] as any;
        expect(storedModels).toEqual(['gpt-5.2']);

        const [discoveryUrl, discoveryInit] = fetchMock.mock.calls[4];
        expect(String(discoveryUrl)).toContain('chatgpt.com/backend-api/codex/models');
        const discoveryHeaders = (discoveryInit as RequestInit).headers as Record<string, string>;
        expect(discoveryHeaders['Authorization']).toBe('Bearer fresh-access');
      } finally {
        vi.useRealTimers();
      }
    });

    it('#22 cycle 4: stores [CODEX_DEFAULT_MODEL] fallback when /codex/models fails', async () => {
      vi.useFakeTimers();
      try {
        fetchMock
          .mockResolvedValueOnce(
            new Response(
              JSON.stringify({
                authorization_code: 'auth-code-xyz',
                code_verifier: 'verifier-abc',
              }),
              { status: 200 },
            ),
          )
          .mockResolvedValueOnce(
            new Response(
              JSON.stringify({
                access_token: 'fresh-access',
                refresh_token: 'fresh-refresh',
                id_token: fakeJwt({ email: 'someone@example.com' }),
                expires_in: 864_000,
                token_type: 'bearer',
              }),
              { status: 200 },
            ),
          )
          // /codex/models returns 500 — login must still succeed; models fall back.
          .mockResolvedValueOnce(new Response('boom', { status: 500 }));

        const { loginPoll } = await import('../reader/lib/codex-auth');
        const { CODEX_DEFAULT_MODEL } = await import('../reader/lib/byok-presets');
        const start = Date.now();
        const intervalMs = 5_000;
        const promise = loginPoll({
          deviceAuthId: 'd',
          userCode: 'U',
          intervalMs,
          expiresAtMs: start + 15 * 60 * 1000,
        });
        await vi.advanceTimersByTimeAsync(intervalMs + 1);
        await promise;

        // Tokens persisted regardless of discovery failure.
        expect(storageMock['codex_auth_tokens']).toBeDefined();
        // Models fell back to the constant.
        expect(storageMock['codex_available_models']).toEqual([CODEX_DEFAULT_MODEL]);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('loginPoll cancellation', () => {
    it('aborts polling when AbortSignal fires before authorization', async () => {
      vi.useFakeTimers();
      try {
        // Server keeps returning "still waiting" forever — only abort can break us out.
        fetchMock.mockResolvedValue(new Response('still', { status: 403 }));

        const { loginPoll } = await import('../reader/lib/codex-auth');
        const controller = new AbortController();
        const intervalMs = 5_000;
        const promise = loginPoll(
          {
            deviceAuthId: 'device-auth-cancel',
            userCode: 'CANC-EL',
            intervalMs,
            expiresAtMs: Date.now() + 15 * 60 * 1000,
          },
          controller.signal,
        );
        // Let one poll happen so we know polling is in progress.
        await vi.advanceTimersByTimeAsync(intervalMs + 1);
        expect(fetchMock).toHaveBeenCalledTimes(1);

        // abort() fires synchronously; sleep's abort listener rejects
        // immediately, which propagates through the await chain in loginPoll.
        controller.abort();
        await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
        // No tokens stored because we never reached the exchange step.
        expect(storageMock['codex_auth_tokens']).toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('getCurrentUser', () => {
    it('returns { email } when codex_auth_user is set', async () => {
      await chrome.storage.local.set({
        codex_auth_user: { email: 'someone@example.com' },
      });
      const { getCurrentUser } = await import('../reader/lib/codex-auth');
      const user = await getCurrentUser();
      expect(user).toEqual({ email: 'someone@example.com' });
    });

    it('returns null when codex_auth_user is not set', async () => {
      const { getCurrentUser } = await import('../reader/lib/codex-auth');
      const user = await getCurrentUser();
      expect(user).toBeNull();
    });
  });

  describe('fetchCodexModels', () => {
    it('Slice 1 #22 tracer: GETs /codex/models with Bearer + OpenAI-Beta headers, returns array of model ids', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: [{ id: 'gpt-5.2' }, { id: 'gpt-6-preview' }] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );

      const { fetchCodexModels } = await import('../reader/lib/codex-auth');
      const models = await fetchCodexModels('tracer-access-token');

      expect(models).toEqual(['gpt-5.2', 'gpt-6-preview']);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toContain('chatgpt.com/backend-api/codex/models');
      // v0.2.3 — server filters returned models by `client_version` per the
      // openai/codex `minimal_client_version` schema. Pin the assertion to
      // the shared constant rather than a literal so future bumps stay in
      // lockstep across codex-auth + codex-stream + tests.
      const { CODEX_CLIENT_VERSION } = await import('../reader/lib/byok-presets');
      expect(String(url)).toContain(`client_version=${CODEX_CLIENT_VERSION}`);
      const headers = (init as RequestInit).headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer tracer-access-token');
      expect(headers['OpenAI-Beta']).toBe('responses=experimental');
    });

    it('Slice 1 #22 cycle 2: throws on non-2xx so caller can fall back to CODEX_DEFAULT_MODEL', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }),
      );
      const { fetchCodexModels } = await import('../reader/lib/codex-auth');
      await expect(fetchCodexModels('stale-token')).rejects.toThrow(/fetchCodexModels failed.*401/);
    });

    it('Slice 1 #22 cycle 2: surfaces network errors (fetch rejection) so caller can fall back', async () => {
      fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      const { fetchCodexModels } = await import('../reader/lib/codex-auth');
      await expect(fetchCodexModels('any-token')).rejects.toThrow();
    });

    it('v0.2.2 hotfix: parses the real Codex API shape — body.models with .slug per OpenAI Codex CLI', async () => {
      // Verified against openai/codex source: codex-rs/codex-api/src/endpoint/
      // models.rs returns ModelsResponse { models: Vec<ModelInfo> }, where each
      // ModelInfo carries `slug` (not `id`). v0.2.1 read `body.data` + `m.id`
      // and silently fell back to [CODEX_DEFAULT_MODEL] for every user.
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            models: [
              { slug: 'gpt-5.5',       display_name: 'GPT-5.5',       description: 'Frontier' },
              { slug: 'gpt-5.4',       display_name: 'GPT-5.4',       description: 'Everyday' },
              { slug: 'gpt-5.4-mini',  display_name: 'GPT-5.4 mini',  description: 'Simple' },
              { slug: 'gpt-5.3-codex', display_name: 'GPT-5.3 codex', description: 'Coding' },
              { slug: 'gpt-5.2',       display_name: 'GPT-5.2',       description: 'Long' },
            ],
          }),
          { status: 200 },
        ),
      );
      const { fetchCodexModels } = await import('../reader/lib/codex-auth');
      const models = await fetchCodexModels('tok');
      expect(models).toEqual(['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.2']);
    });

    it('PR #26 review fix: drops malformed entries (null, missing id, non-string id)', async () => {
      // Defensive guard against an unexpected /codex/models payload shape —
      // ensures no `undefined` slips into codex_available_models and round-
      // trips as the literal "undefined" model id.
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              { id: 'gpt-5.2' },
              null,
              { name: 'no-id-here' },
              { id: 42 },
              { id: 'gpt-6-preview' },
            ],
          }),
          { status: 200 },
        ),
      );
      const { fetchCodexModels } = await import('../reader/lib/codex-auth');
      const models = await fetchCodexModels('tok');
      expect(models).toEqual(['gpt-5.2', 'gpt-6-preview']);
    });
  });

  describe('logout', () => {
    it('clears both codex_auth_tokens and codex_auth_user from storage', async () => {
      await chrome.storage.local.set({
        codex_auth_tokens: {
          access_token: 'a',
          refresh_token: 'r',
          expires_at: Date.now() + 60_000,
          token_type: 'bearer',
        },
        codex_auth_user: { email: 'someone@example.com' },
      });

      const { logout } = await import('../reader/lib/codex-auth');
      await logout();

      expect(storageMock['codex_auth_tokens']).toBeUndefined();
      expect(storageMock['codex_auth_user']).toBeUndefined();
    });
  });
});
