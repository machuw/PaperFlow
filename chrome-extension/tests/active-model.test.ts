// chrome-extension/tests/active-model.test.ts
//
// Phase 18 Plan 18-01 — vitest suite for setActiveModel (MUTEX-01/02).
//
// Test infra: chrome.storage shim verbatim from byok-configs.test.ts:42-105
// (D-CD-03 — proven across 9 test files); vi.resetModules() per-test so the
// module-level pendingWrite chain starts fresh each it-block (mirror
// tests/lib/i18n.test.ts:9-12 reset pattern).
//
// Coverage map (B1..B7 from 18-01-PLAN.md):
//   it 1 — managed happy path (B1)
//   it 2 — byok happy path (B2)
//   it 3 — none clears both (B3)
//   it 4 — invalid managed id throws + no write (B4)
//   it 5 — invalid byok id throws + no write (B5)
//   it 6 — concurrent serialize: clear-loser-first + last-enqueue-wins (B6)
//   it 7 — chain unpoisoned by validation throw (B7)

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Defensive supabase mock — active-model.ts itself does NOT import supabase
// (D-A2 invariant), but vite's import-analysis may transit to it via the
// storage-schema.ts type imports / the wider dep graph. Mirror
// byok-configs.test.ts:23-40 stub.
vi.mock('../reader/lib/supabase', () => ({
  supabase: {
    auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
    from: () => ({
      select: () => ({
        eq: () => ({ then: (r: any) => r({ data: [], error: null }) }),
        then: (r: any) => r({ data: [], error: null }),
      }),
    }),
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

// Track write order for it 6 (concurrent serialize). Each chrome.storage.local.set
// call appends one entry per key written; we assert ordering on this log.
const writeLog: Array<{ key: string; value: unknown }> = []

beforeEach(() => {
  for (const k of Object.keys(storageMock)) delete storageMock[k]
  onChangedListeners.length = 0
  writeLog.length = 0
  // Critical: reset module-level pendingWrite per test. Without this, the
  // singleton chain accumulates state across tests and concurrent-serialize
  // ordering assertions become flaky.
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
            writeLog.push({ key, value: val })
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
        clear: () => {
          for (const key of Object.keys(storageMock)) delete storageMock[key]
          return Promise.resolve()
        },
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
}

// Helper — seed managedModelsCache with a model id list.
function seedManagedCache(ids: string[]) {
  storageMock['managedModelsCache'] = {
    ts: Date.now(),
    models: ids.map((id) => ({
      id,
      display_name: id,
      min_tier: 'free',
      locked: false,
      provider: 'p',
      upstream_model: id,
    })),
  }
}

function seedByokConfigs(ids: string[]) {
  storageMock['config_byok_configs'] = ids.map((id) => ({
    id,
    user_id: 'u',
    name: id,
    base_url: 'http://x',
    model: 'm',
    is_active: false,
    created_at: '',
    updated_at: '',
  }))
}

describe('setActiveModel — Phase 18 mutex writer (MUTEX-01)', () => {
  it('1. managed happy path: writes managed id, clears byok id', async () => {
    seedManagedCache(['claude-haiku-4-5-20251001'])
    const { setActiveModel } = await import('../reader/lib/active-model')
    await setActiveModel({ kind: 'managed', id: 'claude-haiku-4-5-20251001' })
    await flushMicrotasks()
    expect(storageMock['config_active_managed_model_id']).toBe('claude-haiku-4-5-20251001')
    expect(storageMock['config_active_byok_config_id']).toBeNull()
  })

  it('2. byok happy path: writes byok id, clears managed id', async () => {
    seedByokConfigs(['uuid-A'])
    const { setActiveModel } = await import('../reader/lib/active-model')
    await setActiveModel({ kind: 'byok', id: 'uuid-A' })
    await flushMicrotasks()
    expect(storageMock['config_active_managed_model_id']).toBe('')
    expect(storageMock['config_active_byok_config_id']).toBe('uuid-A')
  })

  it('3. none: clears both keys', async () => {
    storageMock['config_active_managed_model_id'] = 'old-managed'
    storageMock['config_active_byok_config_id'] = 'old-byok'
    const { setActiveModel } = await import('../reader/lib/active-model')
    await setActiveModel({ kind: 'none' })
    await flushMicrotasks()
    expect(storageMock['config_active_managed_model_id']).toBe('')
    expect(storageMock['config_active_byok_config_id']).toBeNull()
  })

  it('4. invalid managed id throws + no storage write', async () => {
    seedManagedCache(['known-model']) // does NOT include "unknown-model"
    const { setActiveModel } = await import('../reader/lib/active-model')
    await expect(setActiveModel({ kind: 'managed', id: 'unknown-model' }))
      .rejects.toThrow(/Unknown managed model id: unknown-model/)
    await flushMicrotasks()
    // Neither active key was ever written — they remain absent from storage.
    expect(storageMock['config_active_managed_model_id']).toBeUndefined()
    expect(storageMock['config_active_byok_config_id']).toBeUndefined()
  })

  it('5. invalid byok id throws + no storage write', async () => {
    seedByokConfigs(['known-uuid'])
    const { setActiveModel } = await import('../reader/lib/active-model')
    await expect(setActiveModel({ kind: 'byok', id: 'unknown-uuid' }))
      .rejects.toThrow(/Unknown BYOK config id: unknown-uuid/)
    await flushMicrotasks()
    expect(storageMock['config_active_managed_model_id']).toBeUndefined()
    expect(storageMock['config_active_byok_config_id']).toBeUndefined()
  })

  it('6. concurrent serialize: two back-to-back calls land in enqueue order; final state = last enqueued', async () => {
    seedManagedCache(['model-X'])
    seedByokConfigs(['uuid-Y'])
    const { setActiveModel } = await import('../reader/lib/active-model')
    // Fire both without await between — both enqueue onto the same module-level
    // pendingWrite chain. The second call's chain step starts ONLY after the
    // first call's chain step has fully resolved (clear-loser-first + write-winner).
    const pA = setActiveModel({ kind: 'managed', id: 'model-X' })
    const pB = setActiveModel({ kind: 'byok', id: 'uuid-Y' })
    await Promise.all([pA, pB])
    await flushMicrotasks()
    // Last enqueued = byok, so byok wins.
    expect(storageMock['config_active_managed_model_id']).toBe('')
    expect(storageMock['config_active_byok_config_id']).toBe('uuid-Y')
    // Verify clear-loser-first within EACH chain step:
    //   A (managed): writeLog[0] = clear byok (null) → writeLog[1] = write managed (model-X)
    //   B (byok):    writeLog[2] = clear managed ('') → writeLog[3] = write byok (uuid-Y)
    expect(writeLog).toHaveLength(4)
    // A: clear byok first
    expect(writeLog[0].key).toBe('config_active_byok_config_id')
    expect(writeLog[0].value).toBeNull()
    // A: write managed
    expect(writeLog[1].key).toBe('config_active_managed_model_id')
    expect(writeLog[1].value).toBe('model-X')
    // B: clear managed first (the new loser since byok will win)
    expect(writeLog[2].key).toBe('config_active_managed_model_id')
    expect(writeLog[2].value).toBe('')
    // B: write byok winner
    expect(writeLog[3].key).toBe('config_active_byok_config_id')
    expect(writeLog[3].value).toBe('uuid-Y')
  })

  it('7. chain unpoisoned by validation throw: invalid call followed by valid call still resolves', async () => {
    seedManagedCache(['valid-model'])
    const { setActiveModel } = await import('../reader/lib/active-model')
    await expect(setActiveModel({ kind: 'managed', id: 'unknown-model' }))
      .rejects.toThrow()
    // Chain must remain usable for subsequent callers — the .catch re-throw
    // returns a settled (rejected) promise; the next .then chains off settled
    // state and its body runs as if nothing went wrong.
    await setActiveModel({ kind: 'managed', id: 'valid-model' })
    await flushMicrotasks()
    expect(storageMock['config_active_managed_model_id']).toBe('valid-model')
    expect(storageMock['config_active_byok_config_id']).toBeNull()
  })
})
