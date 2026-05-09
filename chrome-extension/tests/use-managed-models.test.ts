// chrome-extension/tests/use-managed-models.test.ts
//
// Phase 18 Plan 18-02 — vitest suite for useManagedModels hook (HOOK-02).
//
// Coverage map (B12..B16 from 18-02-PLAN.md):
//   it 1 — anonymous returns models=[] (B12, D-A3.1)
//   it 2 — hasSession triggers fetch + populates models (B13)
//   it 3 — cache subscriber updates models without re-fetch (B14)
//   it 4 — Realtime UPDATE triggers fetchManagedModels({force:true}) (B15)

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// Stub fetchManagedModels with a controllable mock — record call count + args.
const fetchCalls: Array<{ force?: boolean }> = []
let fetchReturnValue: any[] = []
const cacheSubscribers: Array<(models: any[]) => void> = []

vi.mock('../reader/lib/managed-models', () => ({
  fetchManagedModels: (opts?: { force?: boolean }) => {
    fetchCalls.push({ force: opts?.force })
    return Promise.resolve(fetchReturnValue)
  },
  subscribeManagedModelsCache: (cb: (m: any[]) => void) => {
    cacheSubscribers.push(cb)
    return () => {
      const i = cacheSubscribers.indexOf(cb)
      if (i >= 0) cacheSubscribers.splice(i, 1)
    }
  },
}))

// Stub subscribeSubscriptions (D-A5.1 — mock the wrapper not supabase client).
const realtimeSubscribers: Array<(payload: any) => void> = []
let channelUnsubscribeCount = 0
vi.mock('../reader/lib/subscriptions-sync', () => ({
  subscribeSubscriptions: (cb: (payload: any) => void) => {
    realtimeSubscribers.push(cb)
    return {
      unsubscribe: () => {
        channelUnsubscribeCount++
        const i = realtimeSubscribers.indexOf(cb)
        if (i >= 0) realtimeSubscribers.splice(i, 1)
        return Promise.resolve('ok')
      },
    }
  },
}))

// Stub supabase.auth.onAuthStateChange.
const authListeners: Array<(evt: string, session: any) => void> = []
vi.mock('../reader/lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: () => Promise.resolve({ data: { user: null } }),
      onAuthStateChange: (cb: (evt: string, session: any) => void) => {
        authListeners.push(cb)
        return { data: { subscription: { unsubscribe: () => { /* noop */ } } } }
      },
    },
    from: () => ({ select: () => ({ then: (r: any) => r({ data: [], error: null }) }) }),
    channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}), unsubscribe: () => Promise.resolve('ok') }),
  },
}))

const storageMock: Record<string, unknown> = {}

beforeEach(() => {
  fetchCalls.length = 0
  fetchReturnValue = []
  cacheSubscribers.length = 0
  realtimeSubscribers.length = 0
  authListeners.length = 0
  channelUnsubscribeCount = 0
  for (const k of Object.keys(storageMock)) delete storageMock[k]
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
        set: () => Promise.resolve(),
        remove: () => Promise.resolve(),
      },
      onChanged: { addListener: () => {}, removeListener: () => {} },
    },
  }
})

async function flushMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('useManagedModels — Phase 18 hook (HOOK-02)', () => {
  it('1. anonymous user (no sb-token) → models=[]', async () => {
    // No storageMock['sb-...-auth-token']
    const { useManagedModels } = await import('../reader/lib/use-managed-models')
    const { result } = renderHook(() => useManagedModels())
    await act(async () => { await flushMicrotasks() })
    expect(result.current.models).toEqual([])
    expect(fetchCalls).toHaveLength(0)  // no fetch for anonymous
  })

  it('2. hasSession (sb-token present) → fetchManagedModels called → models populated', async () => {
    storageMock['sb-fakeref-auth-token'] = 'fake-jwt'
    fetchReturnValue = [{ id: 'A', display_name: 'A', min_tier: 'free', locked: false, provider: 'p', upstream_model: 'A' }]
    const { useManagedModels } = await import('../reader/lib/use-managed-models')
    const { result } = renderHook(() => useManagedModels())
    await act(async () => { await flushMicrotasks() })
    expect(fetchCalls.length).toBeGreaterThanOrEqual(1)
    expect(result.current.models).toEqual(fetchReturnValue)
  })

  it('3. cache subscriber updates models without re-calling fetch', async () => {
    storageMock['sb-fakeref-auth-token'] = 'fake-jwt'
    fetchReturnValue = []
    const { useManagedModels } = await import('../reader/lib/use-managed-models')
    const { result } = renderHook(() => useManagedModels())
    await act(async () => { await flushMicrotasks() })
    const beforeCount = fetchCalls.length
    // Fire cache subscriber from outside hook
    const newModels = [{ id: 'B', display_name: 'B', min_tier: 'free', locked: false, provider: 'p', upstream_model: 'B' }]
    await act(async () => {
      cacheSubscribers.forEach((cb) => cb(newModels))
      await flushMicrotasks()
    })
    expect(result.current.models).toEqual(newModels)
    expect(fetchCalls.length).toBe(beforeCount)  // no extra fetch
  })

  it('4. subscriptions Realtime UPDATE → fetchManagedModels({force:true}) called', async () => {
    storageMock['sb-fakeref-auth-token'] = 'fake-jwt'
    fetchReturnValue = [{ id: 'A', display_name: 'A', min_tier: 'free', locked: false, provider: 'p', upstream_model: 'A' }]
    const { useManagedModels } = await import('../reader/lib/use-managed-models')
    const { result } = renderHook(() => useManagedModels())
    await act(async () => { await flushMicrotasks() })
    const beforeCount = fetchCalls.length
    fetchReturnValue = [
      { id: 'A', display_name: 'A', min_tier: 'free', locked: false, provider: 'p', upstream_model: 'A' },
      { id: 'B', display_name: 'B', min_tier: 'pro', locked: false, provider: 'p', upstream_model: 'B' },
    ]
    await act(async () => {
      realtimeSubscribers.forEach((cb) => cb({ tier: 'pro', cancel_at_period_end: false, current_period_end: null }))
      await flushMicrotasks()
    })
    expect(fetchCalls.length).toBeGreaterThan(beforeCount)
    expect(fetchCalls[fetchCalls.length - 1].force).toBe(true)
    expect(result.current.models.length).toBe(2)
  })
})
