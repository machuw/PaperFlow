// Phase 15 Plan 15-03 Task 1 — fetchManagedModels TTL cache + error coverage.
// Tests 8-11 in plan <behavior>:
//   8. cache fresh (ts within TTL) → returns cached, no network
//   9. cache stale → calls supabase.functions.invoke('managed-models', GET); writes new cache
//  10. cache absent + 401 → returns []; does NOT write cache; non-throwing
//  11. cache present + 500 → returns cached models (degraded); console.warn

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock supabase.functions.invoke per-test via the `invokeImpl` reference.
const mockInvoke = vi.fn();

vi.mock('../reader/lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: (name: string, opts?: unknown) => mockInvoke(name, opts),
    },
    auth: {
      // 2026-05-07: fetchManagedModels now awaits getSession() before invoke
      // to gate on supabase-js _initialize completion. Stub returns a session
      // so existing test cases (which assume an authenticated user) proceed
      // past the guard. (vi.fn isn't usable inside the mock factory here —
      // the factory runs before vi is fully wired in some hoisting orders.)
      getSession: async () => ({ data: { session: { access_token: 'test' } } }),
    },
  },
}));

const storageMock: Record<string, unknown> = {};
beforeEach(() => {
  for (const k of Object.keys(storageMock)) delete storageMock[k];
  mockInvoke.mockReset();
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
});

const sampleModel = {
  id: 'claude-haiku-4-5-20251001',
  display_name: 'claude-4.5-haiku',
  min_tier: 'pro' as const,
  locked: false,
  provider: 'newapi',
  upstream_model: 'claude-haiku-4-5-20251001',
};

describe('fetchManagedModels', () => {
  // Test 8 — cache fresh
  it('cache fresh (within TTL) → returns cached, no network call', async () => {
    storageMock['managedModelsCache'] = {
      ts: Date.now() - 1000, // 1 second old
      models: [sampleModel],
    };

    const { fetchManagedModels } = await import('../reader/lib/managed-models');
    const result = await fetchManagedModels();

    expect(result).toEqual([sampleModel]);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  // Test 9 — cache stale
  it('cache stale → calls invoke + writes new cache + returns models', async () => {
    storageMock['managedModelsCache'] = {
      ts: Date.now() - 2 * 60 * 60 * 1000, // 2 hours old (TTL is 1h)
      models: [],
    };
    mockInvoke.mockResolvedValue({
      data: { models: [sampleModel], upgrade_url: 'https://example.com/upgrade' },
      error: null,
    });

    const { fetchManagedModels } = await import('../reader/lib/managed-models');
    const result = await fetchManagedModels();

    expect(mockInvoke).toHaveBeenCalledWith('managed-models', { method: 'GET' });
    expect(result).toEqual([sampleModel]);
    const cache = storageMock['managedModelsCache'] as { ts: number; models: unknown[] };
    expect(cache.models).toEqual([sampleModel]);
    expect(cache.ts).toBeGreaterThan(Date.now() - 1000);
  });

  // Test 10 — cache absent + 401
  it('cache absent + 401 → returns []; does NOT write cache; non-throwing', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: { status: 401, message: 'Unauthorized' },
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { fetchManagedModels } = await import('../reader/lib/managed-models');
    const result = await fetchManagedModels();

    expect(result).toEqual([]);
    expect(storageMock['managedModelsCache']).toBeUndefined();
    // 401 path is handled distinctly (no warn — anonymous expected).
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  // Test 11 — cache present + 500
  it('cache present + 500 → returns cached models (degraded); console.warn emitted', async () => {
    storageMock['managedModelsCache'] = {
      ts: Date.now() - 2 * 60 * 60 * 1000, // stale → triggers fetch
      models: [sampleModel],
    };
    mockInvoke.mockResolvedValue({
      data: null,
      error: { status: 500, message: 'Internal Server Error' },
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { fetchManagedModels } = await import('../reader/lib/managed-models');
    const result = await fetchManagedModels();

    expect(result).toEqual([sampleModel]); // degraded path
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
