// chrome-extension/tests/use-active-model.test.ts
//
// Phase 18 Plan 18-02 — vitest suite for useActiveModel hook (HOOK-01).
//
// Test infra: chrome.storage shim verbatim from byok-configs.test.ts:42-105
// + vi.resetModules() per-test for module-level snapshot/listener state
// (mirror tests/lib/i18n.test.ts:9-12, 73-90).
//
// Coverage map (B1..B11 from 18-02-PLAN.md):
//   it 1 — loading → none transition (B1, B2)
//   it 2 — managed precedence with cache hit (B3)
//   it 3 — onChanged re-hydrate notifies subscribers (B8, B9 partial)
//   it 4 — D-A4.1 priority + cache-stale fallback (B5, B6)

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// Defensive supabase mock — use-active-model.ts itself does NOT import supabase
// (D-A2 invariant), but vite's import-analysis may transit to it via the
// type imports / the wider dep graph.
vi.mock('../reader/lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: () => Promise.resolve({ data: { user: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    from: () => ({ select: () => ({ then: (r: any) => r({ data: [], error: null }) }) }),
    rpc: () => Promise.resolve({ data: null, error: null }),
    channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}), unsubscribe: () => Promise.resolve('ok') }),
  },
}))

// jsdom doesn't provide chrome.storage — in-memory shim verbatim from
// byok-configs.test.ts:42-105 (D-CD-03).
const storageMock: Record<string, unknown> = {}
type ChangeListener = (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, areaName: string) => void
const onChangedListeners: ChangeListener[] = []

function fireChange(changes: Record<string, { oldValue?: unknown; newValue?: unknown }>): void {
  for (const fn of onChangedListeners) fn(changes, 'local')
}

beforeEach(() => {
  for (const k of Object.keys(storageMock)) delete storageMock[k]
  onChangedListeners.length = 0
  // Critical: reset module-level snapshot + listener install per test.
  vi.resetModules()
  ;(globalThis as any).chrome = {
    storage: {
      local: {
        get: (k: string | string[] | null) => {
          if (k === null || k === undefined) return Promise.resolve({ ...storageMock })
          if (Array.isArray(k)) {
            const out: Record<string, unknown> = {}
            for (const key of k) if (key in storageMock) out[key] = storageMock[key]
            return Promise.resolve(out)
          }
          return Promise.resolve(k in storageMock ? { [k]: storageMock[k] } : {})
        },
        set: (obj: Record<string, unknown>) => {
          const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {}
          for (const [key, val] of Object.entries(obj)) {
            changes[key] = { oldValue: storageMock[key], newValue: val }
            storageMock[key] = val
          }
          queueMicrotask(() => fireChange(changes))
          return Promise.resolve()
        },
        remove: (k: string | string[]) => {
          const keys = Array.isArray(k) ? k : [k]
          const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {}
          for (const key of keys) {
            if (key in storageMock) {
              changes[key] = { oldValue: storageMock[key], newValue: undefined }
              delete storageMock[key]
            }
          }
          queueMicrotask(() => fireChange(changes))
          return Promise.resolve()
        },
        clear: () => { for (const key of Object.keys(storageMock)) delete storageMock[key]; return Promise.resolve() },
      },
      onChanged: {
        addListener: (fn: ChangeListener) => { onChangedListeners.push(fn) },
        removeListener: (fn: ChangeListener) => {
          const i = onChangedListeners.indexOf(fn)
          if (i >= 0) onChangedListeners.splice(i, 1)
        },
      },
    },
  }
})

async function flushMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('useActiveModel — Phase 18 hook (HOOK-01)', () => {
  it('1. loading → none transition with empty storage', async () => {
    // Stall the hydrate get() so we can observe the loading state before
    // the snapshot resolves. In production chrome.storage.local.get takes
    // 1-30ms; in jsdom Promise.resolve resolves in a microtask which races
    // ahead of renderHook's first render. We stall on a manual gate.
    let releaseGet: (value: Record<string, unknown>) => void = () => {}
    const gateGet = new Promise<Record<string, unknown>>((res) => { releaseGet = res })
    const originalGet = (globalThis as any).chrome.storage.local.get
    ;(globalThis as any).chrome.storage.local.get = (k: string | string[] | null) => {
      // Only stall the first 4-key array call (the module-load hydrate);
      // pass through others to avoid breaking other tests sharing state.
      if (Array.isArray(k)) return gateGet
      return originalGet(k)
    }
    const { useActiveModel } = await import('../reader/lib/use-active-model')
    const { result } = renderHook(() => useActiveModel())
    // Initial synchronous return: loading (hydrate get() still pending)
    expect(result.current.kind).toBe('loading')
    // Now release the gate; hydrate completes → snapshot 'none' → notify
    await act(async () => {
      releaseGet({})
      await flushMicrotasks()
    })
    expect(result.current.kind).toBe('none')
  })

  it('2. managed precedence with cache hit: kind=managed, display=Display X, raw populated', async () => {
    storageMock['config_active_managed_model_id'] = 'X'
    storageMock['managedModelsCache'] = {
      ts: Date.now(),
      models: [{ id: 'X', display_name: 'Display X', min_tier: 'free', locked: false, provider: 'p', upstream_model: 'X' }],
    }
    const { useActiveModel } = await import('../reader/lib/use-active-model')
    const { result } = renderHook(() => useActiveModel())
    await act(async () => { await flushMicrotasks() })
    expect(result.current.kind).toBe('managed')
    if (result.current.kind === 'managed') {
      expect(result.current.id).toBe('X')
      expect(result.current.display).toBe('Display X')
      expect(result.current.raw?.id).toBe('X')
    }
  })

  it('3. onChanged re-hydrate: chrome.storage.onChanged for managed_id triggers re-render with new snapshot', async () => {
    const { useActiveModel } = await import('../reader/lib/use-active-model')
    const { result } = renderHook(() => useActiveModel())
    await act(async () => { await flushMicrotasks() })
    expect(result.current.kind).toBe('none')
    // Now seed cache + fire onChanged
    storageMock['managedModelsCache'] = {
      ts: Date.now(),
      models: [{ id: 'Y', display_name: 'Display Y', min_tier: 'free', locked: false, provider: 'p', upstream_model: 'Y' }],
    }
    storageMock['config_active_managed_model_id'] = 'Y'
    await act(async () => {
      fireChange({
        config_active_managed_model_id: { newValue: 'Y' },
        managedModelsCache: { newValue: storageMock['managedModelsCache'] },
      })
      await flushMicrotasks()
    })
    expect(result.current.kind).toBe('managed')
    if (result.current.kind === 'managed') {
      expect(result.current.id).toBe('Y')
      expect(result.current.display).toBe('Display Y')
    }
  })

  it('4. D-A4.1 + cache stale: managed_id non-empty but NOT in cache, byok_id non-null in configs → managed wins, display=empty, raw=undefined', async () => {
    storageMock['config_active_managed_model_id'] = 'STALE'
    storageMock['managedModelsCache'] = {
      ts: Date.now(),
      models: [{ id: 'OTHER', display_name: 'Other', min_tier: 'free', locked: false, provider: 'p', upstream_model: 'OTHER' }],
    }
    storageMock['config_active_byok_config_id'] = 'Y'
    storageMock['config_byok_configs'] = [
      { id: 'Y', user_id: 'u', name: 'My Config', base_url: 'http://x', model: 'm', is_active: true, created_at: '', updated_at: '' },
    ]
    const { useActiveModel } = await import('../reader/lib/use-active-model')
    const { result } = renderHook(() => useActiveModel())
    await act(async () => { await flushMicrotasks() })
    // Managed wins ties even when stale
    expect(result.current.kind).toBe('managed')
    if (result.current.kind === 'managed') {
      expect(result.current.id).toBe('STALE')
      expect(result.current.display).toBe('')  // T-18-04 fallback
      expect(result.current.raw).toBeUndefined()
    }
  })
})
