import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// jsdom doesn't provide chrome.storage — same pattern as the other unit tests
// in this directory. Must be set up BEFORE importing supabase.ts because that
// module reads chrome.storage at the first auth call.
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
        set: (obj: Record<string, unknown>) => { Object.assign(storageMock, obj); return Promise.resolve(); },
        remove: (k: string | string[]) => {
          const keys = Array.isArray(k) ? k : [k];
          for (const key of keys) delete storageMock[key];
          return Promise.resolve();
        },
        clear: () => { for (const key of Object.keys(storageMock)) delete storageMock[key]; return Promise.resolve(); },
      },
      onChanged: { addListener: () => {}, removeListener: () => {} },
    },
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('isStaleSessionResponse — interceptor decision rule', () => {
  it('401 anywhere is stale', async () => {
    const { isStaleSessionResponse } = await import('../../reader/lib/supabase');
    expect(isStaleSessionResponse(401, 'http://127.0.0.1:54321/rest/v1/papers')).toBe(true);
    expect(isStaleSessionResponse(401, 'http://127.0.0.1:54321/auth/v1/user')).toBe(true);
    expect(isStaleSessionResponse(401, 'http://127.0.0.1:54321/functions/v1/ai-proxy')).toBe(true);
  });
  it('403 only counts when path is /auth/v1/* (GoTrue rejected the JWT)', async () => {
    const { isStaleSessionResponse } = await import('../../reader/lib/supabase');
    expect(isStaleSessionResponse(403, 'http://127.0.0.1:54321/auth/v1/user')).toBe(true);
  });
  it('403 elsewhere is NOT stale (likely RLS denial)', async () => {
    const { isStaleSessionResponse } = await import('../../reader/lib/supabase');
    expect(isStaleSessionResponse(403, 'http://127.0.0.1:54321/rest/v1/papers')).toBe(false);
    expect(isStaleSessionResponse(403, 'http://127.0.0.1:54321/functions/v1/ai-proxy')).toBe(false);
  });
  it('2xx / 4xx other than 401|403 are NOT stale', async () => {
    const { isStaleSessionResponse } = await import('../../reader/lib/supabase');
    expect(isStaleSessionResponse(200, 'http://127.0.0.1:54321/auth/v1/user')).toBe(false);
    expect(isStaleSessionResponse(404, 'http://127.0.0.1:54321/rest/v1/papers')).toBe(false);
    expect(isStaleSessionResponse(429, 'http://127.0.0.1:54321/auth/v1/user')).toBe(false);
  });
});

/**
 * End-to-end behavior of the wrapped fetch the SupabaseClient was built with.
 * Drives the wrapped fetch via supabase.from() (always issues a request, no
 * session-presence pre-check like auth.getUser has) and asserts that a 401
 * round-trip clears the session via supabase.auth.signOut({scope:'local'}).
 */
describe('supabase wrapped fetch — stale-session auto-clear behavior', () => {
  it('401 round-trip → triggers signOut({scope:"local"})', async () => {
    const { supabase } = await import('../../reader/lib/supabase');
    const signOutSpy = vi
      .spyOn(supabase.auth, 'signOut')
      .mockResolvedValue({ error: null } as any);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":"invalid_token"}', { status: 401 })),
    );

    await supabase.from('papers').select('id').then(() => {}, () => {});
    // Let the interceptor's microtask flush before asserting.
    await Promise.resolve(); await Promise.resolve();

    expect(signOutSpy).toHaveBeenCalledTimes(1);
    expect(signOutSpy).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('403 from /rest/v1 (RLS denial) does NOT trigger signOut', async () => {
    const { supabase } = await import('../../reader/lib/supabase');
    const signOutSpy = vi
      .spyOn(supabase.auth, 'signOut')
      .mockResolvedValue({ error: null } as any);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"code":"42501","message":"row-level security"}', { status: 403 })),
    );

    await supabase.from('papers').select('id').then(() => {}, () => {});
    await Promise.resolve(); await Promise.resolve();

    expect(signOutSpy).not.toHaveBeenCalled();
  });

  it('clearStaleSession single-flights — burst of 401s coalesces to one signOut', async () => {
    const { supabase } = await import('../../reader/lib/supabase');
    let resolveSignOut!: () => void;
    const signOutSpy = vi
      .spyOn(supabase.auth, 'signOut')
      .mockImplementation(
        () => new Promise<{ error: null }>((r) => { resolveSignOut = () => r({ error: null }); }) as any,
      );

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 401 })),
    );

    await Promise.all([
      supabase.from('papers').select('id').then(() => {}, () => {}),
      supabase.from('papers').select('id').then(() => {}, () => {}),
      supabase.from('papers').select('id').then(() => {}, () => {}),
    ]);
    await Promise.resolve(); await Promise.resolve();

    expect(signOutSpy).toHaveBeenCalledTimes(1);
    resolveSignOut();
  });
});
