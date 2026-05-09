// Phase 12 Retrofit Plan 12-R1 — BYOK configs are LOCAL-ONLY (chrome.storage.local-backed).
// Per user feedback (memory: feedback_byok_local_only.md): BYOK 多配置不要跨设备同步.
// All fields (baseURL/model/name/is_active/apiKey) live ONLY in chrome.storage.local.
// Cross-device sync covers only papers/library/annotations/chat — NOT BYOK configs.
//
// Tests assert: (a) listBYOKConfigs reads from chrome.storage.local (no Supabase),
// (b) createBYOKConfig persists locally + handles name conflict + activates first config,
// (c) updateBYOKConfig writes to local config_byok_configs / config_apikeys,
// (d) deleteBYOKConfig removes from local + auto-activates next when active deleted (MED-3 invariant),
// (e) setActiveBYOKConfig updates is_active flags + cached active id locally,
// (f) getActiveBYOKConfig returns hydrated row from local storage,
// (g) subscribeByokConfigs listens on chrome.storage.onChanged (no Supabase Realtime),
// (h) onLogin_syncByokConfigs is a no-op (no Supabase round-trip).

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock the supabase module to a no-op stub so vite's import-analysis does not
// try to resolve `@supabase/supabase-js` (not installed in this worktree's
// pnpm tree). The local-only CRUD path under test never calls into the
// supabase client; the legacy migrateLegacyByokV12 (untouched in this Plan)
// is the only consumer of the import and is exercised separately by
// byok-migration.test.ts which mocks supabase with full behavior.
vi.mock('../reader/lib/supabase', () => ({
  supabase: {
    auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }), then: (r: any) => r({ data: [], error: null }) }),
        limit: () => ({ then: (r: any) => r({ data: [], error: null }) }),
        then: (r: any) => r({ data: [], error: null }),
      }),
      insert: () => Promise.resolve({ data: null, error: null }),
      upsert: () => Promise.resolve({ data: null, error: null }),
      update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
      delete: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
    }),
    rpc: () => Promise.resolve({ data: null, error: null }),
    channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}), unsubscribe: () => Promise.resolve('ok') }),
  },
}))

// jsdom doesn't provide chrome.storage — in-memory shim verbatim from
// byok-sync.test.ts (lines 30-56), extended with chrome.storage.onChanged
// listener registry so subscribeByokConfigs can be exercised.
const storageMock: Record<string, unknown> = {}
type ChangeListener = (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, areaName: string) => void
const onChangedListeners: ChangeListener[] = []

function fireChange(changes: Record<string, { oldValue?: unknown; newValue?: unknown }>): void {
  for (const fn of onChangedListeners) fn(changes, 'local')
}

beforeEach(() => {
  for (const k of Object.keys(storageMock)) delete storageMock[k]
  onChangedListeners.length = 0
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
          // Fire onChanged synchronously after the set resolves — matches the
          // Chrome MV3 behavior closely enough for unit-test purposes.
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

function nowIso(offsetSec: number = 0): string {
  return new Date(Date.UTC(2026, 3, 29, 0, 0, offsetSec)).toISOString()
}

// Wait for queued microtasks (chrome.storage.onChanged is fired async).
async function flushMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('byok-configs (local-only)', () => {
  beforeEach(async () => {
    vi.resetModules()
    await chrome.storage.local.clear()
  })

  it('listBYOKConfigs returns empty array when no configs stored', async () => {
    const { listBYOKConfigs } = await import('../reader/lib/byok-configs')
    const result = await listBYOKConfigs()
    expect(result).toEqual([])
  })

  it('listBYOKConfigs returns hydrated configs with apiKey merged from config_apikeys map', async () => {
    await chrome.storage.local.set({
      config_byok_configs: [
        { id: 'cfg-A', name: 'A', base_url: 'https://api.openai.com/v1', model: 'gpt-4o', is_active: true,  created_at: nowIso(1), updated_at: nowIso(1) },
        { id: 'cfg-B', name: 'B', base_url: 'http://localhost:8000/v1',   model: 'claude-sonnet-4', is_active: false, created_at: nowIso(2), updated_at: nowIso(2) },
      ],
      config_apikeys: { 'cfg-A': 'sk-A', 'cfg-B': 'sk-B' },
    })

    const { listBYOKConfigs } = await import('../reader/lib/byok-configs')
    const out = await listBYOKConfigs()
    expect(out).toHaveLength(2)
    expect(out[0].id).toBe('cfg-A')
    expect(out[0].apiKey).toBe('sk-A')
    expect(out[1].id).toBe('cfg-B')
    expect(out[1].apiKey).toBe('sk-B')
  })

  it('createBYOKConfig writes apiKey + cloud-shape row to chrome.storage.local (no Supabase RTT)', async () => {
    const { createBYOKConfig, listBYOKConfigs } = await import('../reader/lib/byok-configs')

    const created = await createBYOKConfig({
      name: 'Default', baseURL: 'https://api.openai.com/v1', model: 'gpt-4o', apiKey: 'sk-xyz', isActive: true,
    })

    // Local config_apikeys carries apiKey under the new id.
    const localMap = (await chrome.storage.local.get('config_apikeys'))['config_apikeys'] as Record<string, string>
    expect(localMap[created.id]).toBe('sk-xyz')

    // The persisted config_byok_configs array contains the row WITHOUT apiKey.
    const persisted = (await chrome.storage.local.get('config_byok_configs'))['config_byok_configs'] as any[]
    expect(persisted).toHaveLength(1)
    expect(persisted[0]).not.toHaveProperty('apiKey')
    expect(persisted[0].name).toBe('Default')
    expect(persisted[0].base_url).toBe('https://api.openai.com/v1')
    expect(persisted[0].model).toBe('gpt-4o')

    // listBYOKConfigs returns the hydrated view.
    const list = await listBYOKConfigs()
    expect(list).toHaveLength(1)
    expect(list[0].apiKey).toBe('sk-xyz')
  })

  it('createBYOKConfig with isActive=true caches the new active id locally', async () => {
    const { createBYOKConfig } = await import('../reader/lib/byok-configs')

    const created = await createBYOKConfig({
      name: 'A', baseURL: 'https://x/v1', model: 'm', apiKey: 'sk-a', isActive: true,
    })
    const cachedId = (await chrome.storage.local.get('config_active_byok_config_id'))['config_active_byok_config_id']
    expect(cachedId).toBe(created.id)
  })

  it('createBYOKConfig auto-activates the first config when array was previously empty (MED-3 invariant)', async () => {
    const { createBYOKConfig } = await import('../reader/lib/byok-configs')
    // Note: isActive omitted — we should still mark it active because it is the only one.
    const created = await createBYOKConfig({
      name: 'A', baseURL: 'https://x/v1', model: 'm', apiKey: 'sk-a',
    })
    const cachedId = (await chrome.storage.local.get('config_active_byok_config_id'))['config_active_byok_config_id']
    expect(cachedId).toBe(created.id)

    const persisted = (await chrome.storage.local.get('config_byok_configs'))['config_byok_configs'] as any[]
    expect(persisted[0].is_active).toBe(true)
  })

  it('createBYOKConfig with isActive=true deactivates any previous active config', async () => {
    const { createBYOKConfig } = await import('../reader/lib/byok-configs')
    await createBYOKConfig({ name: 'A', baseURL: 'https://x/v1', model: 'm', apiKey: 'sk-a', isActive: true })
    await createBYOKConfig({ name: 'B', baseURL: 'https://y/v1', model: 'n', apiKey: 'sk-b', isActive: true })

    const persisted = (await chrome.storage.local.get('config_byok_configs'))['config_byok_configs'] as any[]
    expect(persisted).toHaveLength(2)
    const aRow = persisted.find((r) => r.name === 'A')
    const bRow = persisted.find((r) => r.name === 'B')
    expect(aRow.is_active).toBe(false)
    expect(bRow.is_active).toBe(true)
  })

  it('createBYOKConfig with name conflict throws name-conflict error (no partial write)', async () => {
    const { createBYOKConfig } = await import('../reader/lib/byok-configs')
    await createBYOKConfig({ name: 'Default', baseURL: 'https://x/v1', model: 'm', apiKey: 'sk-1' })

    let caught: any = null
    try {
      await createBYOKConfig({ name: 'Default', baseURL: 'https://y/v1', model: 'n', apiKey: 'sk-2' })
    } catch (e) {
      caught = e
    }
    expect(caught).not.toBeNull()
    expect(String(caught?.message ?? caught)).toContain('name-conflict')

    // No orphan apiKey for the rejected create.
    const localMap = (await chrome.storage.local.get('config_apikeys'))['config_apikeys'] as Record<string, string>
    expect(Object.values(localMap)).toEqual(['sk-1'])
    const persisted = (await chrome.storage.local.get('config_byok_configs'))['config_byok_configs'] as any[]
    expect(persisted).toHaveLength(1)
  })

  it('updateBYOKConfig modifies the row in place; apiKey-only patch never touches the array', async () => {
    const { createBYOKConfig, updateBYOKConfig, listBYOKConfigs } = await import('../reader/lib/byok-configs')
    const created = await createBYOKConfig({ name: 'A', baseURL: 'https://x/v1', model: 'old', apiKey: 'sk-old' })

    await updateBYOKConfig(created.id, { model: 'newModel' })
    let list = await listBYOKConfigs()
    expect(list[0].model).toBe('newModel')

    // apiKey-only update lands in config_apikeys map.
    await updateBYOKConfig(created.id, { apiKey: 'sk-new' })
    const localMap = (await chrome.storage.local.get('config_apikeys'))['config_apikeys'] as Record<string, string>
    expect(localMap[created.id]).toBe('sk-new')
    list = await listBYOKConfigs()
    expect(list[0].apiKey).toBe('sk-new')
  })

  it('updateBYOKConfig name conflict throws name-conflict error', async () => {
    const { createBYOKConfig, updateBYOKConfig } = await import('../reader/lib/byok-configs')
    await createBYOKConfig({ name: 'A', baseURL: 'https://x/v1', model: 'm', apiKey: 'sk-a' })
    const b = await createBYOKConfig({ name: 'B', baseURL: 'https://y/v1', model: 'n', apiKey: 'sk-b' })

    let caught: any = null
    try {
      await updateBYOKConfig(b.id, { name: 'A' })
    } catch (e) {
      caught = e
    }
    expect(caught).not.toBeNull()
    expect(String(caught?.message ?? caught)).toContain('name-conflict')
  })

  it('deleteBYOKConfig removes row + clears local apiKey entry', async () => {
    const { createBYOKConfig, deleteBYOKConfig, listBYOKConfigs } = await import('../reader/lib/byok-configs')
    const a = await createBYOKConfig({ name: 'A', baseURL: 'https://x/v1', model: 'm', apiKey: 'sk-a' })
    const b = await createBYOKConfig({ name: 'B', baseURL: 'https://y/v1', model: 'n', apiKey: 'sk-b' })

    await deleteBYOKConfig(a.id)
    const list = await listBYOKConfigs()
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(b.id)

    const localMap = (await chrome.storage.local.get('config_apikeys'))['config_apikeys'] as Record<string, string>
    expect(localMap[a.id]).toBeUndefined()
    expect(localMap[b.id]).toBe('sk-b')
  })

  it('deleteBYOKConfig auto-activates the next config (oldest by created_at) when deleting active (MED-3 invariant)', async () => {
    const { createBYOKConfig, deleteBYOKConfig } = await import('../reader/lib/byok-configs')
    const a = await createBYOKConfig({ name: 'A', baseURL: 'https://x/v1', model: 'm', apiKey: 'sk-a', isActive: true })
    const b = await createBYOKConfig({ name: 'B', baseURL: 'https://y/v1', model: 'n', apiKey: 'sk-b' })
    const c = await createBYOKConfig({ name: 'C', baseURL: 'https://z/v1', model: 'o', apiKey: 'sk-c' })

    await deleteBYOKConfig(a.id)

    const cachedId = (await chrome.storage.local.get('config_active_byok_config_id'))['config_active_byok_config_id']
    expect(cachedId).toBe(b.id) // oldest remaining
    const persisted = (await chrome.storage.local.get('config_byok_configs'))['config_byok_configs'] as any[]
    const bRow = persisted.find((r) => r.id === b.id)
    expect(bRow.is_active).toBe(true)
    // c is not active; sanity
    const cRow = persisted.find((r) => r.id === c.id)
    expect(cRow.is_active).toBe(false)
  })

  it('deleteBYOKConfig leaves zero active when deleting the LAST config', async () => {
    const { createBYOKConfig, deleteBYOKConfig } = await import('../reader/lib/byok-configs')
    const a = await createBYOKConfig({ name: 'A', baseURL: 'https://x/v1', model: 'm', apiKey: 'sk-a', isActive: true })

    await deleteBYOKConfig(a.id)

    const cachedId = (await chrome.storage.local.get('config_active_byok_config_id'))['config_active_byok_config_id']
    expect(cachedId === null || cachedId === undefined).toBe(true)
    const persisted = (await chrome.storage.local.get('config_byok_configs'))['config_byok_configs'] as any[]
    expect(persisted).toEqual([])
    const localMap = (await chrome.storage.local.get('config_apikeys'))['config_apikeys'] as Record<string, string> | undefined
    expect(localMap?.[a.id]).toBeUndefined()
  })

  it('setActiveBYOKConfig switches active flag in place + caches new active id (no Supabase RPC)', async () => {
    const { createBYOKConfig, setActiveBYOKConfig } = await import('../reader/lib/byok-configs')
    const a = await createBYOKConfig({ name: 'A', baseURL: 'https://x/v1', model: 'm', apiKey: 'sk-a', isActive: true })
    const b = await createBYOKConfig({ name: 'B', baseURL: 'https://y/v1', model: 'n', apiKey: 'sk-b' })

    await setActiveBYOKConfig(b.id)

    const cachedId = (await chrome.storage.local.get('config_active_byok_config_id'))['config_active_byok_config_id']
    expect(cachedId).toBe(b.id)
    const persisted = (await chrome.storage.local.get('config_byok_configs'))['config_byok_configs'] as any[]
    expect(persisted.find((r) => r.id === a.id).is_active).toBe(false)
    expect(persisted.find((r) => r.id === b.id).is_active).toBe(true)
  })

  it('getActiveBYOKConfig returns null when no configs exist', async () => {
    const { getActiveBYOKConfig } = await import('../reader/lib/byok-configs')
    const view = await getActiveBYOKConfig()
    expect(view).toBeNull()
  })

  it('getActiveBYOKConfig returns active row hydrated with apiKey from local map', async () => {
    const { createBYOKConfig, getActiveBYOKConfig } = await import('../reader/lib/byok-configs')
    const a = await createBYOKConfig({ name: 'A', baseURL: 'https://x/v1', model: 'm', apiKey: 'sk-a', isActive: true })

    const view = await getActiveBYOKConfig()
    expect(view).not.toBeNull()
    expect(view!.id).toBe(a.id)
    expect(view!.apiKey).toBe('sk-a')
    expect(view!.base_url).toBe('https://x/v1')
    expect(view!.model).toBe('m')
  })

  it('subscribeByokConfigs invokes onChange with full re-fetched list when config_byok_configs changes', async () => {
    const { createBYOKConfig, subscribeByokConfigs } = await import('../reader/lib/byok-configs')
    await createBYOKConfig({ name: 'A', baseURL: 'https://x/v1', model: 'm', apiKey: 'sk-a' })

    const onChange = vi.fn()
    const unsub = subscribeByokConfigs(onChange)

    await createBYOKConfig({ name: 'B', baseURL: 'https://y/v1', model: 'n', apiKey: 'sk-b' })
    await flushMicrotasks()

    expect(onChange).toHaveBeenCalled()
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1]
    expect(lastCall[0]).toHaveLength(2)
    // Hydrated apiKeys are present.
    expect(lastCall[0].some((r: any) => r.apiKey === 'sk-a')).toBe(true)
    expect(lastCall[0].some((r: any) => r.apiKey === 'sk-b')).toBe(true)

    unsub()
    onChange.mockClear()
    // After unsubscribe — no further invocations.
    await chrome.storage.local.set({ config_byok_configs: [] })
    await flushMicrotasks()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('subscribeByokConfigs also fires for changes to config_active_byok_config_id and config_apikeys', async () => {
    const { createBYOKConfig, setActiveBYOKConfig, updateBYOKConfig, subscribeByokConfigs } = await import('../reader/lib/byok-configs')
    const a = await createBYOKConfig({ name: 'A', baseURL: 'https://x/v1', model: 'm', apiKey: 'sk-a', isActive: true })
    const b = await createBYOKConfig({ name: 'B', baseURL: 'https://y/v1', model: 'n', apiKey: 'sk-b' })

    const onChange = vi.fn()
    const unsub = subscribeByokConfigs(onChange)

    await setActiveBYOKConfig(b.id)
    await flushMicrotasks()
    expect(onChange).toHaveBeenCalled()
    onChange.mockClear()

    await updateBYOKConfig(a.id, { apiKey: 'sk-a-new' })
    await flushMicrotasks()
    expect(onChange).toHaveBeenCalled()

    unsub()
  })

  it('onLogin_syncByokConfigs is a no-op (BYOK is local-only — never syncs to cloud)', async () => {
    const { onLogin_syncByokConfigs } = await import('../reader/lib/byok-configs')

    // Pre-existing local state.
    await chrome.storage.local.set({
      config_byok_configs: [
        { id: 'cfg-A', name: 'A', base_url: 'https://x/v1', model: 'm', is_active: true, created_at: nowIso(0), updated_at: nowIso(0) },
      ],
      config_apikeys: { 'cfg-A': 'sk-A' },
      config_active_byok_config_id: 'cfg-A',
    })

    // Should resolve cleanly without throwing — local state is not mutated.
    await expect(onLogin_syncByokConfigs()).resolves.toBeUndefined()

    const persisted = (await chrome.storage.local.get('config_byok_configs'))['config_byok_configs'] as any[]
    expect(persisted).toHaveLength(1)
    expect(persisted[0].id).toBe('cfg-A')
  })
})
