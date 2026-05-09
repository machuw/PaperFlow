// chrome-extension/reader/lib/use-active-model.ts
//
// Phase 18 v1.4 (HOOK-01): React hook that subscribes to the 4 storage
// keys driving model selection and resolves them into a discriminated
// union for chip-text and ModelPicker rendering.
//
// D-A4.1 invariant: priority is managed > byok > none, mirroring
// ai.ts:647-649 D-E2 — UI agrees with router. If both keys end up
// populated by external means (manual devtools edit / sibling-tab race),
// managed wins; self-heals on the next mutex writer call.
//
// D-A2: 'loading' state lasts <30ms typical (chrome.storage.local.get of
// 4 keys, no network, no supabase auth lock). Consumers (Phase 19
// BYOKChip / ModelPicker) gate UI render on kind !== 'loading' to avoid
// the "logged-in user sees no section" flash.
//
// D-A6: this module is read-only. Writes go through active-model.ts.
//
// D-CD-05: useSyncExternalStore is the proven cross-context render path
// (i18n.ts:2566-2576).

import { useSyncExternalStore } from 'react';
import type { ManagedModelInfo } from './managed-models';
import type { StorageSchema } from './storage-schema';

// Phase 19 will consume this. Keep raw shape as the actual cache/array
// row types so Phase 19 can read display_name / name / locked / provider
// / base_url / model directly.
type ManagedRaw = ManagedModelInfo;
type BYOKRaw = StorageSchema['config_byok_configs'][number];

export type ActiveModel =
  | { kind: 'loading' }
  | { kind: 'none' }
  | { kind: 'managed'; id: string; display: string; raw: ManagedRaw | undefined }
  | { kind: 'byok'; id: string; display: string; raw: BYOKRaw | undefined };

// Module-level snapshot cache (D-CD-05; mirror i18n.ts:2482-2486 pattern).
let snapshot: ActiveModel = { kind: 'loading' };
const subscribers = new Set<() => void>();

function notify() {
  // Mirror i18n.ts D18 subscriber error isolation: one buggy callback
  // must not starve others.
  subscribers.forEach((cb) => {
    try { cb(); } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[use-active-model] subscriber failed', e);
    }
  });
}

// D-A4.1 priority resolver: managed > byok > none. Mirrors ai.ts:647-649.
function resolve(state: Record<string, unknown>): ActiveModel {
  const mid = (state.config_active_managed_model_id as string | undefined) ?? '';
  if (mid) {
    const cache = state.managedModelsCache as StorageSchema['managedModelsCache'];
    const raw = cache?.models?.find((m) => m.id === mid);
    // D-A2.2 / T-18-04: cache stale → display:'', NEVER throw.
    return raw
      ? { kind: 'managed', id: mid, display: raw.display_name, raw }
      : { kind: 'managed', id: mid, display: '', raw: undefined };
  }
  const bid = (state.config_active_byok_config_id as string | null | undefined) ?? null;
  if (bid) {
    const rows = (state.config_byok_configs as BYOKRaw[] | undefined) ?? [];
    const raw = rows.find((r) => r.id === bid);
    return raw
      ? { kind: 'byok', id: bid, display: raw.name, raw }
      : { kind: 'byok', id: bid, display: '', raw: undefined };
  }
  return { kind: 'none' };
}

const WATCHED_KEYS = [
  'config_active_managed_model_id',
  'config_active_byok_config_id',
  'managedModelsCache',
  'config_byok_configs',
] as const;

async function hydrate(): Promise<void> {
  // Single multi-key fetch — Phase 17 idiom but narrowed to 4 specific
  // keys vs get(null) to avoid pulling paper:* / library / etc.
  const all = await chrome.storage.local.get([...WATCHED_KEYS]);
  snapshot = resolve(all);
  notify();
}

// Module-load: kick off async hydration; chrome.storage.onChanged
// listener installs once and lives for module lifetime (mirror
// i18n.ts:2525-2533 module-level subscription pattern).
void hydrate();

if (typeof chrome !== 'undefined' && chrome.storage?.onChanged?.addListener) {
  chrome.storage.onChanged.addListener((changes, area) => {
    // B10: only listen on local area.
    if (area !== 'local') return;
    // B9: only re-hydrate when one of the 4 watched keys actually changed.
    if (!WATCHED_KEYS.some((k) => k in changes)) return;
    void hydrate();
  });
}

export function useActiveModel(): ActiveModel {
  return useSyncExternalStore(
    (cb) => {
      subscribers.add(cb);
      return () => { subscribers.delete(cb); };
    },
    () => snapshot,
    () => snapshot,  // server snapshot for SSR safety
  );
}
