// chrome-extension/reader/lib/byok-configs.ts
//
// Phase 12 Retrofit Plans 12-R1 + 12-R2 — BYOK configs are LOCAL-ONLY.
// Per user feedback (memory: feedback_byok_local_only.md):
//   "BYOK 多配置不要跨设备同步。所有字段（baseURL/model/name/is_active/apiKey）
//    只存 chrome.storage.local。Supabase byok_configs 表/RLS/Realtime 整条线
//    不必要。跨设备同步的范围只有论文信息（papers/library/annotations/chat）。"
//
// All persistence flows through chrome.storage.local under three keys:
//   - config_byok_configs: BYOKConfigCloudRow[] (no apiKey field — kept name
//     "Cloud" for backward compatibility with the public type even though
//     nothing leaves the device)
//   - config_apikeys: { [configId]: apiKey } (separate map; same MV3 sandbox)
//   - config_active_byok_config_id: string | null (cached active id)
//
// Public API surface preserved EXACTLY so consumers (agent-client.ts, main.tsx,
// the 12-07 Options UI) require zero changes:
//   listBYOKConfigs / createBYOKConfig / updateBYOKConfig / deleteBYOKConfig /
//   setActiveBYOKConfig / getActiveBYOKConfig / subscribeByokConfigsRealtime
//   (alias subscribeByokConfigs) / onLogin_syncByokConfigs / pushByokConfig /
//   migrateLegacyByokV12.
//
// 12-R2 closed the last Supabase coupling: migrateLegacyByokV12 used to call
// supabase.from('byok_configs').upsert + 23505 cross-tab race lookup. It is
// now pure chrome.storage.local: read v1.1 keys, write v1.2 keys, mark
// migrationState. Cross-tab races are bounded by the migrationState idempotency
// flag plus the "skip if config_byok_configs already non-empty" guard.

import { getItem, setItem } from './storage-schema'

// -- Types --------------------------------------------------------------------

/**
 * Persisted shape — never carries apiKey. Type name retained from the
 * Supabase-backed era for source-stability across the 12-R1 retrofit; nothing
 * leaves the device.
 */
export type BYOKConfigCloudRow = {
  id: string
  user_id: string
  name: string
  base_url: string
  model: string
  is_active: boolean
  created_at: string
  updated_at: string
}

/**
 * Hydrated shape with the apiKey overlaid from chrome.storage.local
 * config_apikeys[id]. apiKey may be empty string if no local entry exists.
 */
export type BYOKConfigClientView = BYOKConfigCloudRow & { apiKey: string }

// -- Helpers ------------------------------------------------------------------

async function readConfigs(): Promise<BYOKConfigCloudRow[]> {
  const r = (await chrome.storage.local.get('config_byok_configs')) as { config_byok_configs?: BYOKConfigCloudRow[] }
  return Array.isArray(r.config_byok_configs) ? r.config_byok_configs : []
}

async function writeConfigs(rows: BYOKConfigCloudRow[]): Promise<void> {
  await chrome.storage.local.set({ config_byok_configs: rows })
}

async function readApiKeyMap(): Promise<Record<string, string>> {
  const m = await getItem('config_apikeys')
  return (m as Record<string, string> | null) ?? {}
}

async function writeApiKeyMap(map: Record<string, string>): Promise<void> {
  await setItem('config_apikeys', map)
}

function hydrate(row: BYOKConfigCloudRow, map: Record<string, string>): BYOKConfigClientView {
  return { ...row, apiKey: map[row.id] ?? '' }
}

function newLocalId(): string {
  return (globalThis.crypto as Crypto).randomUUID()
}

// -- CRUD ---------------------------------------------------------------------

export async function listBYOKConfigs(): Promise<BYOKConfigClientView[]> {
  const rows = await readConfigs()
  const map = await readApiKeyMap()
  return rows.map((r) => hydrate(r, map))
}

export async function getActiveBYOKConfig(): Promise<BYOKConfigClientView | null> {
  const rows = await readConfigs()
  if (rows.length === 0) return null
  const cachedId = await getItem('config_active_byok_config_id')
  const map = await readApiKeyMap()
  if (cachedId) {
    const hit = rows.find((r) => r.id === cachedId)
    if (hit) return hydrate(hit, map)
  }
  // Fallback: scan for is_active=true row.
  const active = rows.find((r) => r.is_active)
  if (!active) return null
  await setItem('config_active_byok_config_id', active.id)
  return hydrate(active, map)
}

export async function createBYOKConfig(input: {
  name: string
  baseURL: string
  model: string
  apiKey: string
  isActive?: boolean
}): Promise<BYOKConfigClientView> {
  const rows = await readConfigs()
  if (rows.some((r) => r.name === input.name)) {
    throw new Error('name-conflict')
  }

  const id = newLocalId()
  const now = new Date().toISOString()
  // Auto-activate if explicitly requested OR this is the first config (MED-3
  // invariant — the array must never end up with zero active rows when at
  // least one row exists).
  const shouldActivate = !!input.isActive || rows.length === 0

  // Build the row WITHOUT apiKey — apiKey lives only in config_apikeys map.
  const newRow: BYOKConfigCloudRow = {
    id,
    user_id: '', // unused in local-only mode; preserved for type stability
    name: input.name,
    base_url: input.baseURL,
    model: input.model,
    is_active: shouldActivate,
    created_at: now,
    updated_at: now,
  }

  // If we are activating this one, deactivate any previous active rows in the
  // same write so the array invariant holds atomically.
  const nextRows: BYOKConfigCloudRow[] = shouldActivate
    ? [...rows.map((r) => (r.is_active ? { ...r, is_active: false } : r)), newRow]
    : [...rows, newRow]
  await writeConfigs(nextRows)

  // apiKey persisted to local map (D-02 separation kept for source-stability).
  const map = await readApiKeyMap()
  map[id] = input.apiKey
  await writeApiKeyMap(map)

  if (shouldActivate) {
    await setItem('config_active_byok_config_id', id)
  }

  return { ...newRow, apiKey: input.apiKey }
}

export async function updateBYOKConfig(
  id: string,
  patch: Partial<{ name: string; baseURL: string; model: string; apiKey: string }>,
): Promise<void> {
  const rows = await readConfigs()
  const idx = rows.findIndex((r) => r.id === id)
  if (idx < 0) {
    // Row missing — still allow apiKey-only patch through (mirrors prior
    // best-effort semantics where local apiKey could be written without a
    // matching cloud row), but skip the array write.
    if (patch.apiKey !== undefined) {
      const map = await readApiKeyMap()
      map[id] = patch.apiKey
      await writeApiKeyMap(map)
    }
    return
  }

  // Name uniqueness check (excluding self).
  if (patch.name !== undefined && rows.some((r) => r.id !== id && r.name === patch.name)) {
    throw new Error('name-conflict')
  }

  // Build the row patch (no apiKey field — apiKey is map-only).
  const rowPatch: Partial<BYOKConfigCloudRow> = {}
  if (patch.name !== undefined) rowPatch.name = patch.name
  if (patch.baseURL !== undefined) rowPatch.base_url = patch.baseURL
  if (patch.model !== undefined) rowPatch.model = patch.model

  if (Object.keys(rowPatch).length > 0) {
    rowPatch.updated_at = new Date().toISOString()
    const next = rows.slice()
    next[idx] = { ...next[idx], ...rowPatch }
    await writeConfigs(next)
  }

  if (patch.apiKey !== undefined) {
    const map = await readApiKeyMap()
    map[id] = patch.apiKey
    await writeApiKeyMap(map)
  }
}

export async function deleteBYOKConfig(id: string): Promise<void> {
  const rows = await readConfigs()
  const target = rows.find((r) => r.id === id)
  if (!target) return // already gone — best-effort

  const cachedActive = await getItem('config_active_byok_config_id')
  const wasActive = cachedActive === id || target.is_active

  const remaining = rows.filter((r) => r.id !== id)

  // MED-3 — if the deleted row was active and others remain, auto-activate the
  // oldest by created_at ASC.
  let nextActiveId: string | null = null
  if (wasActive && remaining.length > 0) {
    const sorted = remaining.slice().sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0))
    nextActiveId = sorted[0].id
    for (const r of remaining) r.is_active = r.id === nextActiveId
  }
  await writeConfigs(remaining)

  // Clear local apiKey entry.
  const map = await readApiKeyMap()
  if (map[id] !== undefined) {
    delete map[id]
    await writeApiKeyMap(map)
  }

  if (wasActive) {
    if (nextActiveId) {
      await setItem('config_active_byok_config_id', nextActiveId)
    } else {
      // 0 remaining — clear cache; agent-client emits 'no-active-config' on next call.
      await setItem('config_active_byok_config_id', null)
    }
  }
}

export async function setActiveBYOKConfig(id: string): Promise<void> {
  const rows = await readConfigs()
  const next = rows.map((r) => ({ ...r, is_active: r.id === id }))
  await writeConfigs(next)
  await setItem('config_active_byok_config_id', id)
}

// -- 三函数模式 ----------------------------------------------------------------

/**
 * Plan 12-R1: BYOK is local-only per user feedback (memory:
 * feedback_byok_local_only.md). This call used to push local-only configs to
 * Supabase + cache the active id; both behaviors are now no-ops because the
 * "cloud byok_configs" table is no longer the source of truth. Kept exported
 * with the same signature so existing main.tsx login flow (and any other
 * caller) does not need to change.
 */
export async function onLogin_syncByokConfigs(): Promise<void> {
  // Intentional no-op — BYOK never syncs to cloud.
  return
}

/**
 * Plan 12-R1: previously upserted a config row to Supabase. BYOK is now
 * local-only so this is a no-op kept for source-stability with anything that
 * may still call it (currently only re-exported, no external consumer).
 */
export async function pushByokConfig(_view: BYOKConfigClientView): Promise<void> {
  // Intentional no-op — BYOK never syncs to cloud.
  return
}

/**
 * Subscribe to local BYOK config changes via chrome.storage.onChanged. Fires
 * whenever config_byok_configs / config_active_byok_config_id / config_apikeys
 * change in chrome.storage.local. PATTERNS recommendation preserved: re-fetch
 * the full hydrated list on any change rather than incrementally merge.
 */
export function subscribeByokConfigsRealtime(
  onChange: (configs: BYOKConfigClientView[]) => void,
): () => void {
  const watched = new Set([
    'config_byok_configs',
    'config_active_byok_config_id',
    'config_apikeys',
  ])
  const listener = (
    changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
    areaName: string,
  ): void => {
    if (areaName !== 'local') return
    if (!Object.keys(changes).some((k) => watched.has(k))) return
    void listBYOKConfigs().then((fresh) => onChange(fresh))
  }
  chrome.storage.onChanged.addListener(listener)
  return () => {
    chrome.storage.onChanged.removeListener(listener)
  }
}

// Alias under the name the tests + plan API surface expect.
export const subscribeByokConfigs = subscribeByokConfigsRealtime

// -- Phase 12 D-A3 boot-time migration + Phase 17 D-A1 retire pass -----------

/**
 * Phase 17 D-A1 retire pass — extends the original Phase 12 D-A3 boot-time
 * migration. Single helper that:
 *
 *   1. Outer-flag-gates on `migrationState:byok-v11-retire-v17` (D-A1 — separate
 *      from Phase 12's `migrationState:byok-configs-v12` so the two passes can
 *      be audited independently). After flag === 'done', the helper is a no-op.
 *   2. Promotes v1.1 single-config users to a Phase 12 'Default' multi-config
 *      row when prefs are complete. Same logic as Phase 12 R2.
 *   3. Adds D-A3 step 2 degenerate apiKey-only path: when only oldApiKey is
 *      present (no prefs), still create config_byok_configs[0] with empty
 *      base_url/model so the user keeps their key — they fix the missing
 *      fields in Options → BYOK Configs.
 *   4. Skips degenerate prefs-only path (no apiKey to keep — nothing to migrate).
 *   5. Phase 17 D-B2 / D-E2 — at the single try-block exit, physically removes
 *      `config_apikey` + `config_prefs` from chrome.storage.local AND sets BOTH
 *      flags ('migrationState:byok-configs-v12' + 'migrationState:byok-v11-retire-v17')
 *      to 'done'. After this point, no v1.1 read path can return data.
 *   6. D-D3 nested catch hardening: if the body throws, still try to set the
 *      retire flag 'done' so a transient write failure doesn't permanently
 *      stick the user in 'in-progress' state across boots.
 *
 * D-B4 invariant: after retire flag === 'done', a global grep for
 * `config_apikey|config_prefs` across `chrome-extension/reader/` and
 * `chrome-extension/options/` returns 0 hits outside comments and tests.
 *
 * Cross-tab race protection (Phase 12 R2 idiom carried forward):
 *   - Outer retire flag — first tab to finish writes 'done'; subsequent
 *     callers see 'done' and exit early.
 *   - `config_byok_configs.length > 0` guard — if a sibling tab already
 *     populated the array (or this is a re-run on a v1.2 user), skip the
 *     populate block but still proceed to physical key removal.
 *
 * Plan 12-R2: pure chrome.storage.local — no Supabase touch. BYOK configs
 * never sync (memory: feedback_byok_local_only.md).
 */
export async function migrateLegacyByokV12(): Promise<void> {
  // Phase 17 D-A1: outer gate — retire flag.
  const retireFlag = await getItem('migrationState:byok-v11-retire-v17')
  if (retireFlag === 'done') return

  await setItem('migrationState:byok-v11-retire-v17', 'in-progress')

  try {
    // Detect v1.1 state. The schema no longer declares config_apikey or
    // config_prefs (Phase 17 deletion); the migration helper is the ONE place
    // where direct chrome.storage.local access is permitted to read these
    // legacy keys. Typed accessors (getItem/setItem/removeItem) cannot be
    // used here because the keys are no longer in StorageSchema.
    //
    // HIGH-1: BOTH baseURL AND model required for a clean migration.
    // apiKey-only / prefs-only handled below as degenerate paths.
    const v11Stored = await chrome.storage.local.get(['config_apikey', 'config_prefs']) as {
      config_apikey?: string
      config_prefs?: { baseURL?: string; model?: string } | null
    }
    const oldApiKey = v11Stored.config_apikey ?? ''
    const oldPrefs = v11Stored.config_prefs ?? null
    const hasBothPrefs = !!(oldPrefs?.baseURL && oldPrefs?.model)

    // Phase 12 R2 forward migration when both prefs are complete + apiKey
    // present + array empty. Note: hasBothPrefs alone is NOT sufficient — a
    // prefs-only state (no apiKey) is degenerate and falls through to the
    // prefs-only branch below (no row created, just orphan key cleanup).
    if (hasBothPrefs && oldApiKey) {
      const existingRows = await readConfigs()
      if (existingRows.length === 0) {
        const baseURL = oldPrefs!.baseURL!
        const model = oldPrefs!.model!
        const newId = newLocalId()
        const now = new Date().toISOString()

        const defaultRow: BYOKConfigCloudRow = {
          id: newId,
          user_id: '', // unused in local-only mode; preserved for type stability.
          name: 'Default',
          base_url: baseURL,
          model,
          is_active: true,
          created_at: now,
          updated_at: now,
        }

        await writeConfigs([defaultRow])
        const map = await readApiKeyMap()
        map[newId] = oldApiKey
        await writeApiKeyMap(map)
        await setItem('config_active_byok_config_id', newId)
      }
      // else: existing rows already populated (cross-tab race winner OR v1.2
      // user with cleared flag) — leave the array untouched; physical key
      // removal happens at the single exit below.
    } else if (oldApiKey) {
      // Phase 17 D-A3 step 2 — degenerate apiKey-only. Still create a Default
      // row with empty baseURL/model so the user keeps their key on retire.
      // User fills in baseURL/model via Options → BYOK Configs after.
      const existingRows = await readConfigs()
      if (existingRows.length === 0) {
        console.warn('[byok-retire-v17] degenerate-apikey-only: creating row with empty baseURL/model')
        const newId = newLocalId()
        const now = new Date().toISOString()
        await writeConfigs([{
          id: newId,
          user_id: '',
          name: 'Default',
          base_url: oldPrefs?.baseURL ?? '',
          model: oldPrefs?.model ?? '',
          is_active: true,
          created_at: now,
          updated_at: now,
        }])
        const map = await readApiKeyMap()
        map[newId] = oldApiKey
        await writeApiKeyMap(map)
        await setItem('config_active_byok_config_id', newId)
      }
    } else if (oldPrefs?.baseURL || oldPrefs?.model) {
      // Degenerate prefs-only — no apiKey to keep. Log + fall through to
      // physical removal so the orphan prefs key is cleared on retire.
      console.warn(
        '[byok-retire-v17] skipping legacy migration: skipped-incomplete-prefs ' +
          '(prefs-only, no apiKey; baseURL=' + (oldPrefs?.baseURL || '') +
          ', model=' + (oldPrefs?.model || '') + ')',
      )
    }

    // Phase 17 D-B2 / D-E2 — single exit physical removal of v1.1 keys + both
    // flags 'done'. After this point, no v1.1 read path can return data.
    // Direct chrome.storage.local.remove because the typed accessor (removeItem)
    // requires keyof StorageSchema and Phase 17 deleted these key names.
    await chrome.storage.local.remove(['config_apikey', 'config_prefs'])
    await setItem('migrationState:byok-configs-v12', 'done')
    await setItem('migrationState:byok-v11-retire-v17', 'done')
  } catch (e) {
    // D-D3 nested catch hardening (mirror Phase 16 D-D3): don't leave the
    // retire flag stuck on 'in-progress' — mark done so the user isn't
    // permanently degraded; the helper logs and returns. Idempotent on retry.
    console.warn('[byok-retire-v17] migration error (non-blocking)', e)
    try {
      await setItem('migrationState:byok-v11-retire-v17', 'done')
    } catch {
      // Swallow — boot must remain non-blocking. Worst case: migration retries
      // on next boot, which is still idempotent (Test 7 — both empty no-op).
    }
  }
}

// -- Phase 16 D-D1 boot-time migration ---------------------------------------

/**
 * Phase 16 D-D1: boot-time silent migration for openai/openrouter/custom →
 * openai-compatible preset id collapse. Idempotency-flagged via
 * `migrationState:openai-compat-v16`. NO toast (D-D2 — internal id rename
 * only, no user-visible change beyond the dropdown row count which Plan
 * 16-02 owns).
 *
 * Behaviour:
 *   1. flag === 'done' → no-op early-exit (returns migratedCount=0).
 *   2. Read config_byok_configs from chrome.storage.local.
 *   3. For any row whose `preset` field equals 'openai' / 'openrouter' /
 *      'custom', rewrite preset → 'openai-compatible'. ALL other fields
 *      are preserved verbatim via spread (T-16-01-01 mitigation): name,
 *      base_url, model, id, is_active, created_at, updated_at, user_id.
 *   4. Write back ONLY if any row changed (idempotent + avoids race noise).
 *   5. flag = 'done'.
 *   6. Catch path: log + still set flag='done' so a transient write
 *      failure does not stick the user in 'in-progress' across boots
 *      (T-16-01-02 mitigation; mirrors managed-models D-F1 idiom).
 *
 * Row schema caveat: Phase 12 byok_configs row shape does NOT carry a
 * top-level `preset` column; the preset hint travels via the editor state
 * only. The migration acts on rows that DO carry a preset field (e.g. from
 * any earlier defensive write or external tool); for rows without preset,
 * the migration is a no-op flag-set. The cast `(r as any).preset` is safe
 * because BYOKConfigRow type does not declare preset.
 */
export async function migrateOpenAICompatV16(): Promise<{ migratedCount: number }> {
  const flag = await getItem('migrationState:openai-compat-v16')
  if (flag === 'done') return { migratedCount: 0 }

  await setItem('migrationState:openai-compat-v16', 'in-progress')

  try {
    const rows = (await getItem('config_byok_configs')) ?? []
    const OLD_IDS = new Set(['openai', 'openrouter', 'custom'])

    let changed = 0
    const next = rows.map((r) => {
      // Cast: BYOKConfigCloudRow does not declare preset; older rows or
      // future writes may carry it under 'preset'. Spread preserves every
      // other field (T-16-01-01 / T-16-01-06 mitigation — never drop or
      // alter rows beyond the preset rewrite).
      const preset = (r as { preset?: string }).preset
      if (preset && OLD_IDS.has(preset)) {
        changed += 1
        return { ...r, preset: 'openai-compatible' } as typeof r
      }
      return r
    })

    if (changed > 0) await setItem('config_byok_configs', next)

    await setItem('migrationState:openai-compat-v16', 'done')
    return { migratedCount: changed }
  } catch (e) {
    // T-16-01-02: don't leave 'in-progress' stuck on error — mark done so
    // user isn't permanently degraded; the helper logs and returns.
    console.warn('[openai-compat-v16] migration error (non-blocking)', e)
    try {
      await setItem('migrationState:openai-compat-v16', 'done')
    } catch {
      // If even the catch's setItem fails, swallow — boot must remain
      // non-blocking. Worst case: migration retries on next boot, which is
      // still idempotent (Test 6 — already-migrated rows are no-ops).
    }
    return { migratedCount: 0 }
  }
}

// -- Quick task 260507 boot-time migration -----------------------------------

/**
 * Quick task 260507: boot-time silent migration for the local-litellm
 * preset removal. Supersedes deferred Phase 25 (RENAME-01/02 — local-litellm
 * → local-claude-wrapper rename) with outright deletion: claude-code-openai-
 * wrapper is no longer a supported BYOK path. Mirrors Phase 16
 * migrateOpenAICompatV16's idempotency-flag + non-blocking-catch idiom.
 *
 * Idempotency-flagged via `migrationState:byok-local-litellm-removal`. NO
 * toast (silent — internal id rewrite only; the user's wrapper config is
 * preserved verbatim, just relabelled under openai-compatible).
 *
 * Behaviour:
 *   1. flag === 'done' → no-op early-exit (returns migratedCount=0).
 *   2. Read config_byok_configs from chrome.storage.local.
 *   3. For any row whose `preset` field equals 'local-litellm', rewrite
 *      preset → 'openai-compatible'. ALL other fields preserved verbatim
 *      via spread (mirrors Phase 16 T-16-01-01 mitigation): name, base_url,
 *      model, id, is_active, created_at, updated_at, user_id.
 *   4. Write back ONLY if any row changed (idempotent + avoids race noise).
 *   5. flag = 'done'.
 *   6. Catch path: log + still set flag='done' so a transient write
 *      failure does not stick the user in 'in-progress' across boots.
 *
 * Row schema caveat (carried from Phase 16): Phase 12 byok_configs row
 * shape does NOT carry a top-level `preset` column; the preset hint travels
 * via the editor state only. The migration acts on rows that DO carry a
 * preset field (defensive — external tools or test seeds); for rows
 * without preset, the migration is a no-op flag-set. Existing user
 * wrapper configs (baseURL=http://localhost:8000/v1) keep working
 * verbatim because the row never carried 'local-litellm' in the first
 * place — the dropdown label change is the only user-visible delta.
 */
export async function migrateLocalLitellmRemoval(): Promise<{ migratedCount: number }> {
  const flag = await getItem('migrationState:byok-local-litellm-removal')
  if (flag === 'done') return { migratedCount: 0 }

  await setItem('migrationState:byok-local-litellm-removal', 'in-progress')

  try {
    const rows = (await getItem('config_byok_configs')) ?? []

    let changed = 0
    const next = rows.map((r) => {
      // Cast: BYOKConfigCloudRow does not declare preset; older rows or
      // external writes may carry it under 'preset'. Spread preserves every
      // other field — never drop or alter rows beyond the preset rewrite.
      const preset = (r as { preset?: string }).preset
      if (preset === 'local-litellm') {
        changed += 1
        return { ...r, preset: 'openai-compatible' } as typeof r
      }
      return r
    })

    if (changed > 0) await setItem('config_byok_configs', next)

    await setItem('migrationState:byok-local-litellm-removal', 'done')
    return { migratedCount: changed }
  } catch (e) {
    // Don't leave 'in-progress' stuck on error — mark done so user isn't
    // permanently degraded; helper logs and returns.
    console.warn('[byok-local-litellm-removal] migration error (non-blocking)', e)
    try {
      await setItem('migrationState:byok-local-litellm-removal', 'done')
    } catch {
      // Boot must remain non-blocking; idempotent retry on next boot.
    }
    return { migratedCount: 0 }
  }
}
