// chrome-extension/reader/lib/active-model.ts
//
// Phase 18 v1.4 (MUTEX-01/02): single-source mutex writer for the two
// "active model" storage keys. UI layer derived state must depend on the
// SAME setter so cross-callsite writes serialize through one pendingWrite
// chain (Phase 13 C-3 idiom — verbatim mirror of byok-health-check.ts:139).
//
// D-A1.3 sequence: clear-loser-first then write-winner. Crash between
// steps leaves "no active" — recoverable; never leaves "double active".
// Combined with ai.ts D-A4.1 priority (managed > byok > none), even a
// transient cross-tab inconsistency keeps routing decisions stable.
//
// D-A4 atomicity rationale: chrome.storage.local writes are NOT atomic
// across multiple keys. We accept the sub-microsecond window between
// the two setItem calls inside a single chain step — Chrome MV3 doesn't
// crash mid-microtask under normal extension lifecycle, and the chain
// serializes ALL writers within a tab. Cross-tab race is acknowledged
// as eventually-consistent via chrome.storage.onChanged + last-writer-wins.
//
// D-A2 invariant: this module is PURE chrome.storage.local — no supabase
// imports, no managed-models.ts / byok-configs.ts imports for runtime
// validation. We read managedModelsCache + config_byok_configs via
// getItem() so the chain stays single-flight and the dep graph stays flat.
//
// D-A6 invariant: NO getActiveModel() read helper exported. Read paths
// go through useActiveModel hook (Plan 18-02) or ai.ts inline (UNCHANGED).

import { getItem, setItem } from './storage-schema';

export type ActiveModelChoice =
  | { kind: 'managed'; id: string }
  | { kind: 'byok'; id: string }
  | { kind: 'none' };

// D-CD-01: module-level singleton write queue. Every setActiveModel call
// appends to this chain so the validate-then-write-loser-then-write-winner
// sequence cannot interleave across parallel callers. The chain is
// process-local (resets on SW restart, which is fine — no in-flight writes
// survive that anyway). Mirrors byok-health-check.ts:139 verbatim.
let pendingWrite: Promise<void> = Promise.resolve();

export function setActiveModel(choice: ActiveModelChoice): Promise<void> {
  // Decouple "what the caller observes" from "what the next caller chains
  // off of". The CALLER promise (returned below) MUST reject on validation
  // errors per D-A1.1. The MODULE-LEVEL chain MUST stay fulfilled so the
  // next setActiveModel call's .then(...) body actually runs.
  //
  // Mechanism: derive `result` from `pendingWrite.then(work)` and return it
  // to the caller (rejection-bearing). Re-assign `pendingWrite = result.catch(...)`
  // which swallows the rejection into a fulfilled chain — exactly the
  // byok-health-check.ts:162-167 idiom, but applied AFTER we've branched
  // off the caller's promise.
  const previous = pendingWrite;
  const result = previous.then(async () => {
    if (choice.kind === 'managed') {
      // D-A1.1: validate id against managedModelsCache; throw on miss.
      // Reading the cache via getItem keeps the chain single-flight; we
      // do NOT call into managed-models.ts (would risk fetch on cache
      // miss + breaking the D-A2 invariant).
      const cache = await getItem('managedModelsCache');
      const known = cache?.models?.some((m) => m.id === choice.id) ?? false;
      if (!known) {
        throw new Error(`Unknown managed model id: ${choice.id}`);
      }
      // D-A1.3: clear loser FIRST, then write winner. T-18-05: schema
      // already accepts null for byok key + '' for managed key; no
      // schema changes needed.
      await setItem('config_active_byok_config_id', null);
      await setItem('config_active_managed_model_id', choice.id);
    } else if (choice.kind === 'byok') {
      // D-A1.1: validate id against config_byok_configs; throw on miss.
      const rows = (await getItem('config_byok_configs')) ?? [];
      const known = rows.some((r) => r.id === choice.id);
      if (!known) {
        throw new Error(`Unknown BYOK config id: ${choice.id}`);
      }
      await setItem('config_active_managed_model_id', '');
      await setItem('config_active_byok_config_id', choice.id);
    } else {
      // kind === 'none' — clear both. No validation needed.
      await setItem('config_active_managed_model_id', '');
      await setItem('config_active_byok_config_id', null);
    }
  });
  pendingWrite = result.catch((e) => {
    // T-18-01c: swallow into the CHAIN only. The caller's `result` promise
    // still rejects (we returned it before this .catch). The next
    // setActiveModel call's .then(work) chains off the fulfilled chain and
    // its work body executes regardless.
    // eslint-disable-next-line no-console
    console.error('[setActiveModel] write failed', e);
  });
  return result;
}
