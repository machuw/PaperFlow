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
      fetchMock.mockResolvedValueOnce(
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
      );

      const { getValidAccessToken } = await import('../reader/lib/codex-auth');
      const before = Date.now();
      const result = await getValidAccessToken();

      expect(result).toBe('new-access');
      expect(fetchMock).toHaveBeenCalledTimes(1);
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
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: 'forced-new-access',
            refresh_token: 'forced-new-refresh',
            expires_in: 864_000,
            token_type: 'bearer',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );

      const { getValidAccessToken } = await import('../reader/lib/codex-auth');
      const result = await getValidAccessToken({ forceRefresh: true });

      expect(result).toBe('forced-new-access');
      expect(fetchMock).toHaveBeenCalledTimes(1);
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

        // Polling endpoint hit 3 times, then /oauth/token hit 1 time = 4 total
        expect(fetchMock).toHaveBeenCalledTimes(4);
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
