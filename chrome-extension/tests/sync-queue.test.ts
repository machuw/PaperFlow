import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock supabase client to avoid hitting real endpoints in tests — and
// to sidestep the env-var check in supabase.ts that would otherwise
// throw at import time.
vi.mock('../reader/lib/supabase', () => {
  // `nextError` lets individual tests simulate Supabase returning an
  // error envelope (e.g. the Postgres P0001 cap-trigger error).
  const state: { nextError: any } = { nextError: null }
  const upsertSpy = vi.fn().mockImplementation(() => {
    const err = state.nextError
    state.nextError = null
    return Promise.resolve({ data: null, error: err })
  })
  const deleteSpy = vi.fn().mockResolvedValue({ data: null, error: null })
  const eq = vi.fn().mockReturnValue({ then: (r: any) => r({ data: null, error: null }) })
  const match = vi.fn().mockResolvedValue({ data: null, error: null })
  const invokeSpy = vi.fn().mockResolvedValue({ data: null, error: null })
  return {
    supabase: {
      from: vi.fn((_table: string) => ({
        upsert: upsertSpy,
        delete: () => ({ eq, match }),
      })),
      functions: { invoke: invokeSpy },
    },
    __spies: { upsertSpy, deleteSpy, eq, match, invokeSpy },
    __state: state,
  }
})

import { enqueue, drain, clear } from '../reader/lib/sync-queue'
import { supabase } from '../reader/lib/supabase'

const storageMock: Record<string, unknown> = {}
beforeEach(() => {
  for (const k of Object.keys(storageMock)) delete storageMock[k]
  ;(globalThis as any).chrome = {
    storage: {
      local: {
        get: (k: string) => Promise.resolve(k in storageMock ? { [k]: storageMock[k] } : {}),
        set: (obj: Record<string, unknown>) => { Object.assign(storageMock, obj); return Promise.resolve() },
        remove: (k: string) => { delete storageMock[k]; return Promise.resolve() },
        clear: () => { for (const key of Object.keys(storageMock)) delete storageMock[key]; return Promise.resolve() },
      },
      onChanged: { addListener: () => {}, removeListener: () => {} },
    },
  }
})

describe('sync-queue', () => {
  beforeEach(async () => {
    await chrome.storage.local.clear()
    vi.clearAllMocks()
  })

  it('enqueue persists to chrome.storage.local.sync:queue', async () => {
    await enqueue({ table: 'highlights', op: 'upsert', row: { id: 'h1' }, ts: 123 })
    const raw = (await chrome.storage.local.get('sync:queue'))['sync:queue'] as any[]
    expect(raw).toHaveLength(1)
    expect(raw[0].row.id).toBe('h1')
  })

  it('drain flushes all queued ops to supabase then clears queue (online)', async () => {
    const origOnLine = Object.getOwnPropertyDescriptor(navigator, 'onLine')
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })

    await enqueue({ table: 'highlights', op: 'upsert', row: { id: 'h1' }, ts: 1 })
    await enqueue({ table: 'margin_notes', op: 'delete', row: { id: 'n1' }, ts: 2 })
    await drain()

    const raw = (await chrome.storage.local.get('sync:queue'))['sync:queue'] as any[] | undefined
    expect(raw ?? []).toHaveLength(0)

    if (origOnLine) Object.defineProperty(navigator, 'onLine', origOnLine)
  })

  it('drain does nothing when offline; queue preserved', async () => {
    const origOnLine = Object.getOwnPropertyDescriptor(navigator, 'onLine')
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })

    await enqueue({ table: 'highlights', op: 'upsert', row: { id: 'h1' }, ts: 1 })
    await drain()

    const raw = (await chrome.storage.local.get('sync:queue'))['sync:queue'] as any[]
    expect(raw).toHaveLength(1)

    if (origOnLine) Object.defineProperty(navigator, 'onLine', origOnLine)
  })

  it('clear removes the queue (used by logout cleanup per spec §15.1)', async () => {
    await enqueue({ table: 'highlights', op: 'upsert', row: { id: 'h1' }, ts: 1 })
    await clear()
    const raw = (await chrome.storage.local.get('sync:queue'))['sync:queue']
    expect(raw).toBeUndefined()
  })

  // F1 hook: once the papers-table cap trigger lands (TODO.md § Post-launch)
  // it will raise a Postgres P0001 exception on insert beyond the free-tier
  // cap. drain()'s catch block clears libraryCapBannerDismissed so the
  // banner re-shows on next drawer open. Queue is preserved for retry.
  it('drain: papers P0001 cap error clears libraryCapBannerDismissed', async () => {
    const origOnLine = Object.getOwnPropertyDescriptor(navigator, 'onLine')
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })

    // User dismissed the banner earlier — flag is set.
    await chrome.storage.local.set({ libraryCapBannerDismissed: 1700000000000 })

    // Stage a P0001 error on the next upsert, then enqueue a papers upsert.
    const { __state } = (await import('../reader/lib/supabase')) as any
    __state.nextError = { code: 'P0001', message: 'library cap exceeded' }

    await enqueue({ table: 'papers', op: 'upsert', row: { user_id: 'u', paper_key: 'k' }, ts: 1 })
    await drain()

    // Banner-dismiss flag wiped.
    const flag = (await chrome.storage.local.get('libraryCapBannerDismissed'))['libraryCapBannerDismissed']
    expect(flag).toBeUndefined()

    // Queue preserved (upsert failed).
    const raw = (await chrome.storage.local.get('sync:queue'))['sync:queue'] as any[]
    expect(raw).toHaveLength(1)

    if (origOnLine) Object.defineProperty(navigator, 'onLine', origOnLine)
  })
})

describe('sync-queue rpc op', () => {
  it('drains an rpc op via supabase.functions.invoke', async () => {
    const invokeSpy = vi.spyOn(supabase.functions, 'invoke').mockResolvedValue({ data: null, error: null })
    await enqueue({ kind: 'rpc', fn: 'delete-library', args: { id: 'lib-q4' }, ts: 0 })
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
    await drain()
    expect(invokeSpy).toHaveBeenCalledWith('delete-library', { body: { id: 'lib-q4' } })
  })
})
