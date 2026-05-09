// Phase 12 D-A3 boot-time migration unit coverage. Cases per PATTERNS map:
// logged-in / logged-out / idempotent / cross-tab race / empty / pre-populated /
// apiKey-only-degenerate / baseURL-only-degenerate / model-only-degenerate
// (HIGH-1 cross-AI review supersedes WARN-2 — both prefs required, never
// invent a default model).
//
// Plan 12-R2: BYOK is local-only. migrateLegacyByokV12 has zero Supabase
// touchpoints — it reads v1.1 keys (config_apikey + config_prefs) and writes
// v1.2 keys (config_byok_configs + config_active_byok_config_id +
// config_apikeys) in chrome.storage.local, gated by migrationState idempotency.
//
// Cross-tab race semantics changed in 12-R2: instead of catching Postgres
// 23505 unique-violation, the function checks `config_byok_configs.length > 0`
// before writing. The race-loser scenario therefore becomes "sibling tab
// already populated config_byok_configs; second tab sees non-empty array and
// exits without overwriting".
//
// 12-R1 already deleted the byok_configs cloud table from the SQL migrations,
// so this test no longer needs the Supabase client mock — it stubs only
// chrome.storage.local.

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// Mock the supabase module to a no-op stub so vite's import-analysis does not
// try to resolve `@supabase/supabase-js` even though byok-configs.ts no longer
// imports it directly. Some indirect import path (e.g. via storage-schema) may
// still reach for the package. Defensive belt-and-braces — see byok-configs.test.ts.
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

// jsdom doesn't provide chrome.storage — verbatim shim from byok-sync.test.ts.
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

describe('migrateLegacyByokV12', () => {
  // vitest's spyOn return type generic differs across versions; use a loose
  // structural type for the only methods we actually call (.mock + .mockRestore).
  let warnSpy: { mock: { calls: unknown[][] }; mockRestore: () => void }

  beforeEach(async () => {
    await chrome.storage.local.clear()
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {}) as unknown as typeof warnSpy
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  // 1. Logged-in path: v1.1 keys present, no existing v1.2 configs -> writes
  //    Default row to config_byok_configs + config_apikeys[newId] + active id.
  //    (Login state is irrelevant in local-only mode — same path as logged-out.)
  it('logged-in path: v1.1 keys present, byok_configs empty -> inserts Default + writes config_apikeys[newId]', async () => {
    await chrome.storage.local.set({
      config_apikey: 'sk-x',
      config_prefs: { baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    })

    const { migrateLegacyByokV12 } = await import('../reader/lib/byok-configs')
    await migrateLegacyByokV12()

    const configs = (await chrome.storage.local.get('config_byok_configs'))['config_byok_configs'] as any[]
    expect(configs).toHaveLength(1)
    const row = configs[0]
    expect(row).toMatchObject({
      name: 'Default',
      base_url: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      is_active: true,
    })
    // D-02 invariant — no apiKey field on the persisted row.
    expect(row).not.toHaveProperty('apiKey')
    expect(row).not.toHaveProperty('api_key')

    // Local apiKey map populated under the new uuid.
    const apikeys = (await chrome.storage.local.get('config_apikeys'))['config_apikeys'] as Record<string, string>
    expect(Object.keys(apikeys)).toHaveLength(1)
    expect(Object.values(apikeys)).toContain('sk-x')
    expect(apikeys[row.id]).toBe('sk-x')

    // Active id cached.
    const activeId = (await chrome.storage.local.get('config_active_byok_config_id'))['config_active_byok_config_id']
    expect(activeId).toBe(row.id)

    const flag = (await chrome.storage.local.get('migrationState:byok-configs-v12'))['migrationState:byok-configs-v12']
    expect(flag).toBe('done')
  })

  // 2. Logged-out path: same v1.1 keys, no session -> writes only to
  //    chrome.storage.local. In local-only mode this is identical to the
  //    logged-in path (no session check happens).
  it('logged-out path: same v1.1 keys, no session -> writes only to config_apikeys', async () => {
    await chrome.storage.local.set({
      config_apikey: 'sk-localonly',
      config_prefs: { baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    })

    const { migrateLegacyByokV12 } = await import('../reader/lib/byok-configs')
    await migrateLegacyByokV12()

    const configs = (await chrome.storage.local.get('config_byok_configs'))['config_byok_configs'] as any[]
    expect(configs).toHaveLength(1)

    const apikeys = (await chrome.storage.local.get('config_apikeys'))['config_apikeys'] as Record<string, string>
    expect(Object.keys(apikeys)).toHaveLength(1)
    expect(Object.values(apikeys)).toContain('sk-localonly')

    const activeId = (await chrome.storage.local.get('config_active_byok_config_id'))['config_active_byok_config_id']
    expect(typeof activeId).toBe('string')
    expect(activeId).toBe(configs[0].id)

    const flag = (await chrome.storage.local.get('migrationState:byok-configs-v12'))['migrationState:byok-configs-v12']
    expect(flag).toBe('done')
  })

  // 3. Idempotent: second invocation no-ops.
  //
  // Phase 17 D-A1: outer flag is now `migrationState:byok-v11-retire-v17`,
  // separate from Phase 12's `migrationState:byok-configs-v12` so the two
  // passes can be audited independently. The retire flag is what gates the
  // helper now — setting v12='done' alone is no longer sufficient (a v1.1
  // user whose v12 flag was 'done' but v17 was absent must still get the
  // retire pass run on Phase 17 first boot).
  it('idempotent: second invocation no-ops when retire flag=done', async () => {
    await chrome.storage.local.set({
      'migrationState:byok-v11-retire-v17': 'done',
      config_apikey: 'sk-x',
      config_prefs: { baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    })

    const { migrateLegacyByokV12 } = await import('../reader/lib/byok-configs')
    await migrateLegacyByokV12()

    // No write should have occurred — config_byok_configs / config_apikeys /
    // config_active_byok_config_id remain absent.
    const configs = (await chrome.storage.local.get('config_byok_configs'))['config_byok_configs']
    expect(configs).toBeUndefined()
    const apikeys = (await chrome.storage.local.get('config_apikeys'))['config_apikeys']
    expect(apikeys).toBeUndefined()
    const activeId = (await chrome.storage.local.get('config_active_byok_config_id'))['config_active_byok_config_id']
    expect(activeId).toBeUndefined()
  })

  // 4. Cross-tab race: sibling tab finished migrating first (config_byok_configs
  //    already non-empty in chrome.storage.local). Second tab sees populated
  //    array and exits without overwriting — preserving the winner's row.
  //
  //    12-R2 semantics swap: instead of Postgres 23505 unique-violation +
  //    apiKey re-key dance, the simpler local-only flow just no-ops if any
  //    config row already exists.
  it('cross-tab race: sibling tab populated config_byok_configs first -> second tab no-ops', async () => {
    // Pre-seed: sibling tab already wrote the winner row + apiKey map entry.
    await chrome.storage.local.set({
      config_byok_configs: [{
        id: 'winner-id',
        user_id: '',
        name: 'Default',
        base_url: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        is_active: true,
        created_at: '2026-04-29T00:00:00.000Z',
        updated_at: '2026-04-29T00:00:00.000Z',
      }],
      config_apikeys: { 'winner-id': 'sk-winner' },
      config_active_byok_config_id: 'winner-id',
      // v1.1 keys are also still present — the migration must NOT overwrite
      // the winner row even though oldApiKey/oldPrefs would otherwise trigger
      // a write.
      config_apikey: 'sk-loser',
      config_prefs: { baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    })

    const { migrateLegacyByokV12 } = await import('../reader/lib/byok-configs')

    // Must NOT throw.
    await expect(migrateLegacyByokV12()).resolves.toBeUndefined()

    // Winner row preserved verbatim.
    const configs = (await chrome.storage.local.get('config_byok_configs'))['config_byok_configs'] as any[]
    expect(configs).toHaveLength(1)
    expect(configs[0].id).toBe('winner-id')

    // apiKey map untouched — winner's apiKey survives, no loser entry added.
    const apikeys = (await chrome.storage.local.get('config_apikeys'))['config_apikeys'] as Record<string, string>
    expect(apikeys['winner-id']).toBe('sk-winner')
    expect(Object.keys(apikeys)).toHaveLength(1)

    // Active id stays on the winner.
    const activeId = (await chrome.storage.local.get('config_active_byok_config_id'))['config_active_byok_config_id']
    expect(activeId).toBe('winner-id')

    const flag = (await chrome.storage.local.get('migrationState:byok-configs-v12'))['migrationState:byok-configs-v12']
    expect(flag).toBe('done')
  })

  // 5. Empty path: no v1.1 keys -> mark done without writes.
  it('empty path: no v1.1 keys -> marks done without writes', async () => {
    // No legacy keys set.

    const { migrateLegacyByokV12 } = await import('../reader/lib/byok-configs')
    await migrateLegacyByokV12()

    const configs = (await chrome.storage.local.get('config_byok_configs'))['config_byok_configs']
    expect(configs).toBeUndefined()
    const apikeys = (await chrome.storage.local.get('config_apikeys'))['config_apikeys']
    expect(apikeys).toBeUndefined()
    const activeId = (await chrome.storage.local.get('config_active_byok_config_id'))['config_active_byok_config_id']
    expect(activeId).toBeUndefined()

    const flag = (await chrome.storage.local.get('migrationState:byok-configs-v12'))['migrationState:byok-configs-v12']
    expect(flag).toBe('done')
  })

  // 6. config_byok_configs already populated -> skip even if v1.1 keys present.
  //    (Same guard as #4 but exercised on a pristine flag — covers the
  //    "v1.2 user with cleared migrationState" branch, e.g. dev reset.)
  it('byok_configs already populated -> skip migration even if v1.1 keys present', async () => {
    await chrome.storage.local.set({
      config_byok_configs: [{
        id: 'pre-existing',
        user_id: '',
        name: 'Default',
        base_url: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        is_active: true,
        created_at: '2026-04-29T00:00:00.000Z',
        updated_at: '2026-04-29T00:00:00.000Z',
      }],
      config_apikey: 'sk-x',
      config_prefs: { baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    })

    const { migrateLegacyByokV12 } = await import('../reader/lib/byok-configs')
    await migrateLegacyByokV12()

    // Pre-existing row untouched, no second row added.
    const configs = (await chrome.storage.local.get('config_byok_configs'))['config_byok_configs'] as any[]
    expect(configs).toHaveLength(1)
    expect(configs[0].id).toBe('pre-existing')

    // No apiKey map entry created — pre-existing user is responsible for their
    // own apiKey state.
    const apikeys = (await chrome.storage.local.get('config_apikeys'))['config_apikeys']
    expect(apikeys).toBeUndefined()

    const flag = (await chrome.storage.local.get('migrationState:byok-configs-v12'))['migrationState:byok-configs-v12']
    expect(flag).toBe('done')
  })

  // 7. Phase 17 D-A3 step 2: apiKey-only-degenerate (no baseURL, no model)
  //    NOW creates a Default row with empty baseURL/model so the user keeps
  //    their key on retire (instead of Phase 12 R2's skip-with-log behavior).
  //    The user fills in baseURL/model via Options → BYOK Configs after.
  //    Anti-assertion: still NO invented 'gpt-4o-mini' default model.
  it('Phase 17 D-A3 step 2: apiKey-only-degenerate (no prefs) -> creates row with empty prefs', async () => {
    await chrome.storage.local.set({
      config_apikey: 'sk-degenerate',
      // config_prefs intentionally absent.
    })

    const { migrateLegacyByokV12 } = await import('../reader/lib/byok-configs')
    await migrateLegacyByokV12()

    const configs = (await chrome.storage.local.get('config_byok_configs'))['config_byok_configs'] as any[]
    expect(configs).toHaveLength(1)
    expect(configs[0].name).toBe('Default')
    expect(configs[0].base_url).toBe('')
    expect(configs[0].model).toBe('')
    expect(configs[0].is_active).toBe(true)

    const apikeys = (await chrome.storage.local.get('config_apikeys'))['config_apikeys'] as Record<string, string>
    expect(apikeys[configs[0].id]).toBe('sk-degenerate')

    const flag = (await chrome.storage.local.get('migrationState:byok-configs-v12'))['migrationState:byok-configs-v12']
    expect(flag).toBe('done')

    // Anti-assertion: nothing written contains an invented default model.
    const allKeys = await chrome.storage.local.get(null as any)
    const v12Slice = JSON.stringify({
      config_byok_configs: (allKeys as any).config_byok_configs,
      config_apikeys: (allKeys as any).config_apikeys,
    })
    expect(v12Slice).not.toContain('gpt-4o-mini')
  })

  // 8. Phase 17 D-A3 step 2: baseURL-only-degenerate (model empty) NOW
  //    creates a row carrying the partial baseURL with an empty model so the
  //    user keeps both their apiKey AND their partially-configured baseURL.
  //    Phase 12 R2 used to skip-with-log; Phase 17 retains as much state as
  //    possible on the migration boundary.
  it('Phase 17 D-A3 step 2: baseURL-only-degenerate (model empty) -> creates row with partial prefs', async () => {
    await chrome.storage.local.set({
      config_apikey: 'sk-x',
      config_prefs: { baseURL: 'https://api.openai.com/v1', model: '' },
    })

    const { migrateLegacyByokV12 } = await import('../reader/lib/byok-configs')
    await migrateLegacyByokV12()

    const configs = (await chrome.storage.local.get('config_byok_configs'))['config_byok_configs'] as any[]
    expect(configs).toHaveLength(1)
    expect(configs[0].base_url).toBe('https://api.openai.com/v1')
    expect(configs[0].model).toBe('')

    const apikeys = (await chrome.storage.local.get('config_apikeys'))['config_apikeys'] as Record<string, string>
    expect(apikeys[configs[0].id]).toBe('sk-x')

    const flag = (await chrome.storage.local.get('migrationState:byok-configs-v12'))['migrationState:byok-configs-v12']
    expect(flag).toBe('done')
  })

  // 9. Phase 17 D-A3 step 2: model-only-degenerate (baseURL empty) NOW
  //    creates a row carrying the partial model with an empty baseURL. Same
  //    rationale as Test 8 — preserve maximum state across migration.
  it('Phase 17 D-A3 step 2: model-only-degenerate (baseURL empty) -> creates row with partial prefs', async () => {
    await chrome.storage.local.set({
      config_apikey: 'sk-x',
      config_prefs: { baseURL: '', model: 'gpt-4o' },
    })

    const { migrateLegacyByokV12 } = await import('../reader/lib/byok-configs')
    await migrateLegacyByokV12()

    const configs = (await chrome.storage.local.get('config_byok_configs'))['config_byok_configs'] as any[]
    expect(configs).toHaveLength(1)
    expect(configs[0].base_url).toBe('')
    expect(configs[0].model).toBe('gpt-4o')

    const apikeys = (await chrome.storage.local.get('config_apikeys'))['config_apikeys'] as Record<string, string>
    expect(apikeys[configs[0].id]).toBe('sk-x')

    const flag = (await chrome.storage.local.get('migrationState:byok-configs-v12'))['migrationState:byok-configs-v12']
    expect(flag).toBe('done')
  })
})
