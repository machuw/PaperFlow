// Phase 17 D-A1 / D-D1 retire-migration unit coverage. 8 scenarios covering:
//   1. Already-v1.2 user (no v1.1 keys, configs populated) → flag set, no-op.
//   2. First-time-launch v1.1 user (full prefs) → migrates + removeItem +
//      flag='done'.
//   3. Idempotent re-run (retire flag='done') → second invocation no-op.
//   4. Cross-tab race (second invocation while first sees flag='done') →
//      flag-gated, no state change.
//   5. Degenerate apiKey-only (no prefs) → creates row with empty
//      baseURL/model, flag='done', physically removes config_apikey.
//   6. Degenerate prefs-only (no apiKey) → no row created, removeItem
//      ('config_prefs'), flag='done'.
//   7. Both empty → flag='done' direct.
//   8. Schema-removed regression: getItem('config_apikey' as never) returns
//      null at runtime after retire migration cleared the key. (TypeScript
//      compile-time fence is enforced by Task 2 + tsc --noEmit.)
//
// Phase 17 D-D2: zero Supabase touch. Helper writes purely to
// chrome.storage.local. The vi.mock('../reader/lib/supabase', ...) block from
// byok-migration.test.ts is intentionally OMITTED here — no Supabase client
// import path is reached.
//
// Phase 17 D-A1: outer flag is `migrationState:byok-v11-retire-v17` — separate
// from Phase 12's `migrationState:byok-configs-v12` so the two passes can be
// audited independently. Both flags are written 'done' on success.

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// jsdom doesn't provide chrome.storage — verbatim shim from byok-migration.test.ts:47-74.
const storageMock: Record<string, unknown> = {}
beforeEach(() => {
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
        set: (obj: Record<string, unknown>) => { Object.assign(storageMock, obj); return Promise.resolve() },
        remove: (k: string | string[]) => {
          const keys = Array.isArray(k) ? k : [k]
          for (const key of keys) delete storageMock[key]
          return Promise.resolve()
        },
        clear: () => { for (const key of Object.keys(storageMock)) delete storageMock[key]; return Promise.resolve() },
      },
      onChanged: { addListener: () => {}, removeListener: () => {} },
    },
  }
})

describe('migrateLegacyByokV12 / Phase 17 retire', () => {
  let warnSpy: { mock: { calls: unknown[][] }; mockRestore: () => void }

  beforeEach(async () => {
    await chrome.storage.local.clear()
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {}) as unknown as typeof warnSpy
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  // 1. Already-v1.2 user — flag absent, config_byok_configs already populated.
  it('1. already-v1.2 user (no v1.1 keys, configs populated) → flag set, no-op', async () => {
    await chrome.storage.local.set({
      config_byok_configs: [{
        id: 'a-1',
        user_id: '',
        name: 'My Custom',
        base_url: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        is_active: true,
        created_at: '2026-04-29T00:00:00.000Z',
        updated_at: '2026-04-29T00:00:00.000Z',
      }],
      config_apikeys: { 'a-1': 'sk-existing' },
    })

    const { migrateLegacyByokV12 } = await import('../reader/lib/byok-configs')
    await migrateLegacyByokV12()

    const flag = (await chrome.storage.local.get('migrationState:byok-v11-retire-v17'))['migrationState:byok-v11-retire-v17']
    expect(flag).toBe('done')

    const configs = (await chrome.storage.local.get('config_byok_configs'))['config_byok_configs'] as any[]
    expect(configs).toHaveLength(1)
    expect(configs[0].id).toBe('a-1')

    const apikeys = (await chrome.storage.local.get('config_apikeys'))['config_apikeys'] as Record<string, string>
    expect(apikeys['a-1']).toBe('sk-existing')
  })

  // 2. First-time-launch v1.1 user — config_apikey + complete prefs present.
  it('2. first-time-launch v1.1 user (full prefs) → migrates + removeItem v1.1 keys + flag=done', async () => {
    await chrome.storage.local.set({
      config_apikey: 'sk-x',
      config_prefs: { baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    })

    const { migrateLegacyByokV12 } = await import('../reader/lib/byok-configs')
    await migrateLegacyByokV12()

    const after = await chrome.storage.local.get(null)
    // D-B2: physically removed.
    expect((after as any)['config_apikey']).toBeUndefined()
    expect((after as any)['config_prefs']).toBeUndefined()

    // Default row created.
    const configs = (after as any)['config_byok_configs'] as any[]
    expect(configs).toHaveLength(1)
    expect(configs[0].name).toBe('Default')
    expect(configs[0].base_url).toBe('https://api.openai.com/v1')
    expect(configs[0].model).toBe('gpt-4o-mini')
    expect(configs[0].is_active).toBe(true)

    // apiKey transferred to map under new id.
    const apikeys = (after as any)['config_apikeys'] as Record<string, string>
    expect(apikeys[configs[0].id]).toBe('sk-x')

    // Active id cached.
    expect((after as any)['config_active_byok_config_id']).toBe(configs[0].id)

    // Both flags 'done'.
    expect((after as any)['migrationState:byok-v11-retire-v17']).toBe('done')
    expect((after as any)['migrationState:byok-configs-v12']).toBe('done')
  })

  // 3. Idempotent re-run — retire flag already 'done'.
  it('3. idempotent re-run (flag=done) → second invocation no-op', async () => {
    await chrome.storage.local.set({
      'migrationState:byok-v11-retire-v17': 'done',
      config_byok_configs: [{
        id: 'pre-existing',
        user_id: '',
        name: 'Existing',
        base_url: 'https://x.example.com/v1',
        model: 'mod-x',
        is_active: true,
        created_at: '2026-04-29T00:00:00.000Z',
        updated_at: '2026-04-29T00:00:00.000Z',
      }],
    })

    const { migrateLegacyByokV12 } = await import('../reader/lib/byok-configs')
    await migrateLegacyByokV12()

    const configs = (await chrome.storage.local.get('config_byok_configs'))['config_byok_configs'] as any[]
    expect(configs).toHaveLength(1)
    expect(configs[0].id).toBe('pre-existing')
    expect(configs[0].name).toBe('Existing')
  })

  // 4. Cross-tab race — second invocation sees flag='done', exits without
  //    writing any v1.2 keys.
  it('4. cross-tab race (second invocation while first sees flag=done) → flag-gated', async () => {
    await chrome.storage.local.set({
      'migrationState:byok-v11-retire-v17': 'done',
    })

    const { migrateLegacyByokV12 } = await import('../reader/lib/byok-configs')
    await migrateLegacyByokV12()

    const after = await chrome.storage.local.get(null)
    expect((after as any)['config_byok_configs']).toBeUndefined()
    expect((after as any)['config_apikeys']).toBeUndefined()
    expect((after as any)['config_active_byok_config_id']).toBeUndefined()
  })

  // 5. Degenerate apiKey-only (D-A3 step 2) — apiKey present but prefs absent.
  it('5. degenerate apiKey-only → creates row with empty baseURL/model + flag=done + removeItem', async () => {
    await chrome.storage.local.set({
      config_apikey: 'sk-degenerate',
      // config_prefs intentionally absent.
    })

    const { migrateLegacyByokV12 } = await import('../reader/lib/byok-configs')
    await migrateLegacyByokV12()

    const after = await chrome.storage.local.get(null)
    expect((after as any)['config_apikey']).toBeUndefined()                  // D-B2 physical removal

    const configs = (after as any)['config_byok_configs'] as any[]
    expect(configs).toHaveLength(1)
    expect(configs[0].base_url).toBe('')
    expect(configs[0].model).toBe('')
    expect(configs[0].is_active).toBe(true)
    expect(configs[0].name).toBe('Default')

    const newId = configs[0].id
    const apikeys = (after as any)['config_apikeys'] as Record<string, string>
    expect(apikeys[newId]).toBe('sk-degenerate')

    expect((after as any)['config_active_byok_config_id']).toBe(newId)
    expect((after as any)['migrationState:byok-v11-retire-v17']).toBe('done')
  })

  // 6. Degenerate prefs-only — no apiKey but prefs present.
  it('6. degenerate prefs-only → no row created, but removeItem("config_prefs") + flag=done', async () => {
    await chrome.storage.local.set({
      config_prefs: { baseURL: 'https://api.openai.com/v1', model: 'gpt-4o' },
    })

    const { migrateLegacyByokV12 } = await import('../reader/lib/byok-configs')
    await migrateLegacyByokV12()

    const after = await chrome.storage.local.get(null)
    expect((after as any)['config_prefs']).toBeUndefined()                   // D-B2 physical removal
    expect((after as any)['config_byok_configs']).toBeUndefined()             // no row created
    expect((after as any)['config_apikeys']).toBeUndefined()
    expect((after as any)['migrationState:byok-v11-retire-v17']).toBe('done')
  })

  // 7. Both empty — neither v1.1 key present, no v1.2 state.
  it('7. both empty (no v1.1 keys) → flag=done direct', async () => {
    const { migrateLegacyByokV12 } = await import('../reader/lib/byok-configs')
    await migrateLegacyByokV12()

    const after = await chrome.storage.local.get(null)
    expect((after as any)['migrationState:byok-v11-retire-v17']).toBe('done')
    expect((after as any)['config_byok_configs']).toBeUndefined()
    expect((after as any)['config_apikeys']).toBeUndefined()
  })

  // 8. Schema-removed regression — at runtime, after the migration removed
  //    config_apikey, getItem returns null. Compile-time field deletion is
  //    enforced by Task 2 + tsc --noEmit.
  it('8. schema-removed regression: getItem("config_apikey") returns null at runtime', async () => {
    await chrome.storage.local.set({ config_apikey: 'sk-soon-gone' })

    const { migrateLegacyByokV12 } = await import('../reader/lib/byok-configs')
    await migrateLegacyByokV12()

    const { getItem } = await import('../reader/lib/storage-schema')
    // 'as never' bypasses the TypeScript fence so the runtime symptom is
    // observable even if Task 2 has already deleted the typed key.
    const v = await getItem('config_apikey' as never)
    expect(v).toBeNull()
  })
})
