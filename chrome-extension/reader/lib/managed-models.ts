// chrome-extension/reader/lib/managed-models.ts
//
// Phase 15: client-side managed-models module.
//   (1) fetchManagedModels — GET /managed-models with TTL-gated cache (D-C3)
//   (2) migrateAnthropicViaProxyToManaged — boot-time idempotent migration (D-F1)
//   (3) subscribeManagedModelsCache — chrome.storage.onChanged live-subscribe (D-C3 c)
//
// All chrome.storage.local — D-A2 invariant. No managed-credential write
// path: ai-proxy holds NEWAPI_API_KEY server-side; client just passes the
// model id through callAI (per Plan 15-03 ai.ts changes).
//
// JSDoc note on the literal preset id "anthropic-via-proxy": the v1.2 BYOK
// preset registry shipped a synthetic entry under that id. Phase 15 retired
// the preset (Plan 15-02 D-F4 hard cutover removes the union member + array
// entry). The literal string is referenced here only via runtime string-match
// on the persisted row's `name` and `base_url` so we can identify legacy rows
// during migration. No type-level usage — applyPreset throws on the retired
// id by design (see byok-presets.ts D-F3).

import { supabase } from './supabase';
import { getItem, setItem } from './storage-schema';
import type { StorageSchema } from './storage-schema';

// 2026-05-07: tightened from 1h to 5min. Registry changes (model add/remove,
// rename, tier change) now propagate to clients within 5 minutes of next
// picker open; the prior 1h window left users stuck on stale entries (e.g.
// opus → haiku swap) until they manually wiped storage. The picker is opened
// at most a few times per session, so the extra round-trip cost (~50–200ms
// behind the awaitGetSession() gate) is negligible.
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Public read surface for UI consumers (Plan 15-04 Options section).
 * Mirrors the cache row shape from StorageSchema['managedModelsCache'].
 */
export type ManagedModelInfo = NonNullable<StorageSchema['managedModelsCache']>['models'][number];

// ---------- (1) fetchManagedModels (D-C3) ----------

/**
 * Fetch managed-models list. Reads cache first; if fresh, returns it without
 * a network call. Otherwise hits GET /managed-models, updates cache, returns.
 *
 * Errors:
 *   - 401 (no session): returns [], does NOT write cache (caller hides section)
 *   - 5xx / network: returns cached models if any, else []; logs console.warn
 *
 * Caller is expected to coordinate with `subscribeManagedModelsCache` for
 * cross-context cache propagation (Plan 15-04).
 */
export async function fetchManagedModels(opts?: { force?: boolean }): Promise<ManagedModelInfo[]> {
  const cache = await getItem('managedModelsCache');
  if (!opts?.force && cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return cache.models;
  }
  try {
    // 2026-05-07: await getSession() before invoke to force supabase-js's
    // async _initialize to complete. Without this gate, fresh-mount calls
    // race the SDK init and `functions.invoke` ships without the
    // Authorization header → 401 → empty list → empty SYSTEM MODELS for
    // multiple minutes until something else (page reload / Realtime UPDATE)
    // re-triggers the fetch.
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return [];
    const { data, error } = await supabase.functions.invoke<{
      models: ManagedModelInfo[];
      upgrade_url?: string;
    }>('managed-models', { method: 'GET' });
    if (error) {
      // Distinguish 401 (anonymous → empty list, no cache) from other errors
      // (degraded path → return cache if available).
      const status = (error as { status?: number }).status;
      if (status === 401) return [];
      console.warn('[managed-models] fetch error; using cache if any', error);
      return cache?.models ?? [];
    }
    const models = data?.models ?? [];
    await setItem('managedModelsCache', { ts: Date.now(), models });
    return models;
  } catch (e) {
    console.warn('[managed-models] fetch threw; using cache if any', e);
    return cache?.models ?? [];
  }
}

// ---------- (2) migrateAnthropicViaProxyToManaged (D-F1) ----------

/**
 * Boot-time idempotent migration. Removes any anthropic-via-proxy preset
 * entries from config_byok_configs + config_apikeys (since BYOK_PRESETS no
 * longer carries that id, applyPreset would throw). For Pro users, sets
 * the active managed model id (see Pro branch below) so the user keeps a
 * working managed-AI route after upgrade.
 *
 * Idempotency: flag-gated (`migrationState:managed-models-v13`); plus
 * defensive non-empty check on `config_active_managed_model_id` for
 * cross-tab race protection (T-15-03-T5).
 *
 * D-F4: this runs even if the user never had anthropic-via-proxy — the
 * Pro-tier active-id setter is unconditional. Migration is a no-op for
 * such users; only mutation is the flag set + active-id set on Pro.
 *
 * Returns flags so callers (e.g. main.tsx D-F2 toast) can decide whether
 * to surface UI based on what actually changed.
 */
export async function migrateAnthropicViaProxyToManaged(): Promise<{
  migratedRow: boolean;
  setActiveModel: boolean;
}> {
  const flag = await getItem('migrationState:managed-models-v13');
  if (flag === 'done') return { migratedRow: false, setActiveModel: false };

  await setItem('migrationState:managed-models-v13', 'in-progress');

  try {
    // T-15-03-T5: defensive race protection — if a sibling tab already wrote
    // the active id, leave it alone; only the BYOK row cleanup proceeds.
    const existingActive = (await getItem('config_active_managed_model_id')) ?? '';

    // (1) Filter config_byok_configs: drop anthropic-via-proxy rows.
    // Phase 12 byok_configs row shape does NOT carry a `preset` column; we
    // infer from the v1.2 default name string OR the base_url path. Other
    // preset ids (openai/openrouter/custom) are untouched — T-15-03-T4
    // mitigation, verified by unit test 'preserves non-matching'.
    const rows = (await getItem('config_byok_configs')) ?? [];
    const isAnthropicViaProxy = (r: { name: string; base_url: string }) =>
      r.name === 'Anthropic (via PaperFlow proxy)'
      || r.base_url.includes('/functions/v1/ai-proxy');
    const removedRows = rows.filter(isAnthropicViaProxy);
    const keptRows = rows.filter((r) => !isAnthropicViaProxy(r));

    let migratedRow = false;
    if (removedRows.length > 0) {
      await setItem('config_byok_configs', keptRows);

      // (2) Drop matching apiKey map entries.
      const apikeys = (await getItem('config_apikeys')) ?? {};
      const removedIds = new Set(removedRows.map((r) => r.id));
      const filteredKeys: Record<string, string> = {};
      for (const [id, key] of Object.entries(apikeys)) {
        if (!removedIds.has(id)) filteredKeys[id] = key;
      }
      await setItem('config_apikeys', filteredKeys);

      // (3) If the active BYOK config was a removed row, clear the cached
      // active id so getActiveBYOKConfig falls back gracefully.
      const activeBYOK = (await getItem('config_active_byok_config_id')) ?? '';
      if (activeBYOK && removedIds.has(activeBYOK)) {
        await setItem('config_active_byok_config_id', null);
      }
      migratedRow = true;
    }

    // (4) Read current tier (logged-in only); set active managed model.
    let setActiveModel = false;
    if (!existingActive) {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const { data: sub } = await supabase
          .from('subscriptions')
          .select('tier')
          .eq('user_id', session.user.id)
          .single();
        const tier = (sub?.tier as string) ?? 'free';
        if (tier === 'pro') {
          await setItem('config_active_managed_model_id', 'claude-haiku-4-5-20251001');
          setActiveModel = true;
        } else {
          await setItem('config_active_managed_model_id', '');
        }
      } else {
        await setItem('config_active_managed_model_id', '');
      }
    }

    await setItem('migrationState:managed-models-v13', 'done');
    return { migratedRow, setActiveModel };
  } catch (e) {
    // D-F1 step 4: don't leave 'in-progress' stuck on error — mark done so
    // user isn't permanently degraded; the helper logs and returns.
    console.warn('[managed-models] migration error (non-blocking)', e);
    await setItem('migrationState:managed-models-v13', 'done');
    return { migratedRow: false, setActiveModel: false };
  }
}

// ---------- (3) subscribeManagedModelsCache (D-C3 c) ----------

/**
 * chrome.storage.onChanged live-subscribe. Mirrors Phase 13 byok-chip.tsx
 * pattern (Plan 13-02 C-5 cross-AI review). READ-ONLY listener; no fetch
 * triggered inside (D-C3 invariant — only Options mount, login success,
 * subscriptions Realtime are entry points to refresh the cache).
 *
 * Returns an unsubscribe function. Caller (Plan 15-04 Options page) maps
 * the cache → ManagedModelInfo[] via the round-trip in the listener.
 */
export function subscribeManagedModelsCache(
  onChange: (models: ManagedModelInfo[]) => void,
): () => void {
  const listener = (
    changes: Record<string, { newValue?: unknown }>,
    areaName: string,
  ): void => {
    if (areaName !== 'local') return;
    if (!('managedModelsCache' in changes)) return;
    const next = changes.managedModelsCache?.newValue as
      StorageSchema['managedModelsCache'];
    onChange(next?.models ?? []);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
