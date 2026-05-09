import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ensureOverview } from '../../reader/lib/overview';

// Prevent supabase from trying to access chrome.storage at module init time.
// `sessionState` lets each test toggle whether a Supabase session exists,
// driving the `aiAvailable()` pre-flight branch in ensureOverview.
const sessionState: { session: { access_token: string } | null } = { session: null };
vi.mock('../../reader/lib/supabase', () => ({
  supabase: {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      getSession: () => Promise.resolve({ data: { session: sessionState.session } }),
    },
  },
  clearStaleSession: () => Promise.resolve(),
}));

// callAI real signature is callback-based: callAI(messages, kind, onChunk).
// rafBatchedAppender is mocked as a passthrough — every chunk fires set() immediately.
const callAIMock = vi.fn(async (_msgs: any, _kind: any, onChunk: (c: string) => void) => {
  onChunk('- A\n');
  onChunk('- B\n');
});
vi.mock('../../reader/lib/ai', () => ({
  buildMessages: vi.fn(() => []),
  callAI: (...args: any[]) => callAIMock(...(args as [any, any, any])),
  rafBatchedAppender: (set: (acc: string) => void) => ({ append: (x: string) => set(x), flush: () => {} }),
}));

// jsdom doesn't provide chrome.storage — stand up an in-memory shim.
const storageMock: Record<string, unknown> = {};
beforeEach(async () => {
  sessionState.session = null;
  callAIMock.mockClear();
  for (const key of Object.keys(storageMock)) delete storageMock[key];
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: (k: string | string[] | null) => {
          if (k === null || k === undefined) return Promise.resolve({ ...storageMock });
          if (Array.isArray(k)) {
            const result: Record<string, unknown> = {};
            for (const key of k) result[key] = storageMock[key];
            return Promise.resolve(result);
          }
          return Promise.resolve({ [k]: storageMock[k] });
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
    },
  };
});

const fakePaper = {
  id: 'p1', title: 't', authors: [], abstract: '', outline: [], paragraphs: [],
  memory: { whyItMatters: '', role: '', judgment: '', linked: [], nextActions: [] },
} as any;

describe('ensureOverview', () => {
  it('cache miss + session present → streams → caches', async () => {
    sessionState.session = { access_token: 'fake' };
    const states: any[] = [];
    await ensureOverview('P', fakePaper, 'contributions', 'gpt', 'en', (s) => states.push(s));
    expect(states[0].kind).toBe('streaming');
    expect(states.find((s) => s.kind === 'ready')).toBeTruthy();
    expect(states.find((s) => s.kind === 'ready')?.body).toBe('- A\n- B\n');
  });

  it('cache miss + BYOK fully configured → streams (no session needed)', async () => {
    // Phase 17: BYOK is now read exclusively via getActiveBYOKConfig (Phase 12
    // multi-config). Seed config_byok_configs + config_apikeys + active id
    // instead of the retired v1.1 split keys.
    await chrome.storage.local.set({
      config_byok_configs: [{
        id: 'cfg-overview-test',
        user_id: '',
        name: 'Default',
        base_url: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        is_active: true,
        created_at: '2026-05-04T00:00:00.000Z',
        updated_at: '2026-05-04T00:00:00.000Z',
      }],
      config_apikeys: { 'cfg-overview-test': 'sk-test' },
      config_active_byok_config_id: 'cfg-overview-test',
    });
    const states: any[] = [];
    await ensureOverview('P', fakePaper, 'contributions', 'gpt', 'en', (s) => states.push(s));
    expect(states.find((s) => s.kind === 'ready')).toBeTruthy();
  });

  it('cache hit → ready immediately', async () => {
    // Pre-populate using the same key pattern as storage.ts (overviewContrib)
    await chrome.storage.local.set({ 'paper:P:overview:contributions:gpt:en': '- cached' });
    const states: any[] = [];
    await ensureOverview('P', fakePaper, 'contributions', 'gpt', 'en', (s) => states.push(s));
    expect(states[0].kind).toBe('ready');
    expect(states[0].body).toBe('- cached');
    expect(states.length).toBe(1);
  });

  it('no apiKey + no session → emits unconfigured + skips callAI', async () => {
    // Neither route is usable — pre-flight should short-circuit.
    const states: any[] = [];
    await ensureOverview('P', fakePaper, 'contributions', 'gpt', 'en', (s) => states.push(s));
    expect(states).toEqual([{ kind: 'unconfigured' }]);
    expect(callAIMock).not.toHaveBeenCalled();
  });

  it('apiKey set but prefs missing baseURL → unconfigured (would-throw byok-misconfigured otherwise)', async () => {
    await chrome.storage.local.set({ config_apikey: 'sk-test', config_prefs: { baseURL: '', model: '' } });
    const states: any[] = [];
    await ensureOverview('P', fakePaper, 'contributions', 'gpt', 'en', (s) => states.push(s));
    expect(states).toEqual([{ kind: 'unconfigured' }]);
    expect(callAIMock).not.toHaveBeenCalled();
  });
});
