import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// React 18 act() warns unless the test env opts in via this global flag
// (mirrors summary-page.test.tsx).
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// chrome.* shim. Defined as `let store` so each test starts from a known
// chrome.storage.local snapshot; chrome.storage.onChanged listeners are
// captured into `listeners` so tests can drive cache updates.
type StorageStore = Record<string, unknown>;
let store: StorageStore = {};
let listeners: Array<(c: Record<string, { newValue?: unknown; oldValue?: unknown }>, area: string) => void> = [];

function fireChange(key: string, newValue: unknown) {
  const oldValue = store[key];
  store[key] = newValue;
  for (const fn of listeners) fn({ [key]: { newValue, oldValue } }, 'local');
}

const tabsCreateSpy = vi.fn();

beforeEach(() => {
  store = {};
  listeners = [];
  tabsCreateSpy.mockClear();
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: (keys: string | string[] | Record<string, unknown> | null) => {
          if (keys === null || keys === undefined) return Promise.resolve({ ...store });
          if (typeof keys === 'string') return Promise.resolve(keys in store ? { [keys]: store[keys] } : {});
          if (Array.isArray(keys)) {
            const out: StorageStore = {};
            for (const k of keys) if (k in store) out[k] = store[k];
            return Promise.resolve(out);
          }
          // object form: { key: defaultValue }
          const out: StorageStore = {};
          for (const k of Object.keys(keys)) out[k] = k in store ? store[k] : (keys as Record<string, unknown>)[k];
          return Promise.resolve(out);
        },
        set: (obj: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(obj)) fireChange(k, v);
          return Promise.resolve();
        },
        remove: (keys: string | string[]) => {
          const arr = Array.isArray(keys) ? keys : [keys];
          for (const k of arr) fireChange(k, undefined);
          return Promise.resolve();
        },
      },
      onChanged: {
        addListener: (fn: typeof listeners[number]) => { listeners.push(fn); },
        removeListener: (fn: typeof listeners[number]) => {
          listeners = listeners.filter((l) => l !== fn);
        },
      },
    },
    runtime: {
      openOptionsPage: () => {},
      getURL: (p: string) => `chrome-extension://abc/${p}`,
      id: 'abc',
    },
    tabs: { create: tabsCreateSpy },
  };
  // Default fetch stub — checkBYOKHealth probes call fetch('http://localhost/v1/models');
  // most tests don't care about the result, so return a 200 with empty data.
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: [] }),
      } as unknown as Response),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Cfg = {
  id: string;
  user_id: string;
  name: string;
  base_url: string;
  model: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

function seedConfigs(rows: Array<Partial<Cfg> & { id: string; name: string; base_url: string; model: string; is_active: boolean }>) {
  const now = new Date().toISOString();
  const full: Cfg[] = rows.map((r) => ({
    user_id: '00000000-0000-0000-0000-000000000000',
    created_at: now,
    updated_at: now,
    ...r,
  }) as Cfg);
  store['config_byok_configs'] = full;
  store['config_apikeys'] = Object.fromEntries(full.map((c) => [c.id, 'sk-test']));
  store['config_active_byok_config_id'] = full.find((c) => c.is_active)?.id ?? null;
}

async function flushAsync(times = 6) {
  for (let i = 0; i < times; i++) await act(async () => { await Promise.resolve(); });
}

describe('BYOKChip', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('T1: renders Name only when an active config exists (model lives in popover row)', async () => {
    seedConfigs([{ id: 'a', name: 'Foo', base_url: 'https://api.openai.com/v1', model: 'gpt-4o', is_active: true }]);
    const { BYOKChip } = await import('../../reader/components/byok-chip');
    await act(async () => { root.render(<BYOKChip />); });
    await flushAsync();
    // Chip label is name-only per redesign — model shows in the popover row,
    // not the chip itself (top-bar real estate is tight).
    expect(container.textContent).toMatch(/Foo/);
  });

  it('T5: clicking a row calls setActiveBYOKConfig and closes popover', async () => {
    seedConfigs([
      { id: 'a', name: 'Foo', base_url: 'https://api.openai.com/v1', model: 'gpt-4o', is_active: true },
      { id: 'b', name: 'Bar', base_url: 'http://localhost:8000/v1', model: 'sonnet', is_active: false },
    ]);
    const { BYOKChip } = await import('../../reader/components/byok-chip');
    await act(async () => { root.render(<BYOKChip />); });
    await flushAsync();
    await act(async () => { (container.querySelector('.byok-chip') as HTMLButtonElement).click(); });
    await flushAsync();
    const rows = container.querySelectorAll('[role="menuitemradio"]');
    // pick the inactive (Bar) row
    const barRow = Array.from(rows).find((r) => r.textContent?.includes('Bar')) as HTMLElement;
    await act(async () => { (barRow as HTMLElement).click(); });
    await flushAsync();
    // active is now 'b'
    expect(store['config_active_byok_config_id']).toBe('b');
    // popover closed
    expect(container.querySelector('.byok-popover-panel')).toBeNull();
  });

  // ──────────────────────────────────────────────────────────────────
  // C-3 acceptance test added 2026-05-01 iter-2 (--reviews mode).
  // (T2/T8/T9/T11/T12 migrated to tests/model-picker.test.tsx Phase 20-01.)
  // ──────────────────────────────────────────────────────────────────

  it('T10: C-3 race-safe — three concurrent persistByokHealth calls all land in cache', async () => {
    // Plan-level acceptance test: prove the module-level write queue in
    // byok-health-check.ts (Task 3) serializes parallel writers
    // so no entry is lost to a read-modify-write race.
    const { persistByokHealth } = await import('../../reader/lib/byok-health-check');
    // Start with empty cache
    store['byokHealthCache'] = {};
    // Fire 3 concurrent persists for distinct config IDs.
    await Promise.all([
      persistByokHealth('a', { status: 'healthy', modelCount: 1 }),
      persistByokHealth('b', { status: 'healthy', modelCount: 2 }),
      persistByokHealth('c', { status: 'unreachable', error: 'down' }),
    ]);
    // All three entries must be present.
    const cache = store['byokHealthCache'] as Record<string, { healthy: boolean; modelCount?: number; reason?: string }>;
    expect(Object.keys(cache).sort()).toEqual(['a', 'b', 'c']);
    expect(cache.a.healthy).toBe(true);
    expect(cache.a.modelCount).toBe(1);
    expect(cache.b.healthy).toBe(true);
    expect(cache.b.modelCount).toBe(2);
    expect(cache.c.healthy).toBe(false);
    expect(cache.c.reason).toBe('down');
  });

});
