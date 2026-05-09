// chrome-extension/reader/lib/use-managed-models.ts
//
// Phase 18 v1.4 (HOOK-02): lift the 4 useEffect block from
// options/main.tsx:188-253 into a shared hook so Options page (Plan
// 20-01) and Phase 19 ModelPicker can both consume it without
// duplicating ~50 LOC. Exposes minimum-surface `{models}` per D-A3.
//
// D-A3.1: anonymous → models=[] (mirror fetchManagedModels 401 path).
// D-A3.2: session change detected via supabase.auth.onAuthStateChange;
// SIGNED_IN triggers fetch via the hasSession dep on Effect 2.
//
// T-18-03 caveat: Effect 4 calls subscribeSubscriptions which returns
// a supabase RealtimeChannel. Multiple consumers (BYOKChip popover +
// Options) each get their own channel.subscribe(). CHANNEL-01 vitest
// (this plan, Task 3) verifies the wrapper ref-count behavior across
// 4 mount/unmount scenarios — if S4 fails CHANNEL-02 escalates.

import { useEffect, useState } from 'react';
import {
  fetchManagedModels,
  subscribeManagedModelsCache,
  type ManagedModelInfo,
} from './managed-models';
import { subscribeSubscriptions } from './subscriptions-sync';
import { supabase } from './supabase';
import { getItem, setItem } from './storage-schema';

/**
 * 2026-05-07: reconcile `config_active_managed_model_id` against the freshly-
 * fetched registry. Three cases self-heal here:
 *   (a) saved id is stale (registry rename/swap, e.g. opus → haiku): id no
 *       longer matches any entry → pick the first unlocked entry.
 *   (b) saved id is empty AND user has at least one unlocked entry: pick it.
 *   (c) saved id is valid (exists in registry): no-op.
 *
 * Locked entries (tier below min_tier) are skipped — auto-selecting one would
 * surface a tier-locked error on the next chat. Free users with no unlocked
 * entries get config_active_managed_model_id cleared so the picker chip
 * resolves to "+ Select model" rather than dangling on a stale id.
 */
async function reconcileActiveManagedModel(models: ManagedModelInfo[]): Promise<void> {
  const current = (await getItem('config_active_managed_model_id')) ?? '';
  const validIds = new Set(models.map((m) => m.id));
  if (current && validIds.has(current)) return;

  const firstUnlocked = models.find((m) => !m.locked);
  const next = firstUnlocked?.id ?? '';
  if (next === current) return;
  await setItem('config_active_managed_model_id', next);
}

export function useManagedModels(): { models: ManagedModelInfo[] } {
  const [models, setModels] = useState<ManagedModelInfo[]>([]);
  const [hasSession, setHasSession] = useState<boolean>(false);

  // EFFECT 1 — auth gate (verbatim from options/main.tsx:192-213).
  // Uses chrome.storage.local.get(null) scan for sb-{ref}-auth-token to
  // avoid the navigator.locks deadlock path that hung Options page on
  // second open (Phase 17 hasSession race fix).
  useEffect(() => {
    void (async () => {
      try {
        const all = await chrome.storage.local.get(null);
        const tokenKey = Object.keys(all).find(
          (k) => k.startsWith('sb-') && k.endsWith('-auth-token'),
        );
        setHasSession(!!tokenKey);
      } catch {
        setHasSession(false);
      }
    })();
    const { data: authListener } = supabase.auth.onAuthStateChange((_evt, session) => {
      setHasSession(!!session);
    });
    return () => authListener.subscription.unsubscribe();
  }, []);

  // EFFECT 2 — mount fetch + post-login refetch (lift from :219-231,
  // dropped activeManagedId — that's useActiveModel's job per D-A6
  // separation).
  useEffect(() => {
    if (!hasSession) {
      setModels([]);  // D-A3.1 anonymous
      return;
    }
    void fetchManagedModels().then((m) => {
      setModels(m);
      void reconcileActiveManagedModel(m);
    });
  }, [hasSession]);

  // EFFECT 3 — cache live-subscribe (verbatim from :237-240). READ-ONLY
  // (no setItem inside the listener — anti-pattern guard).
  useEffect(() => {
    const unsub = subscribeManagedModelsCache(setModels);
    return () => unsub();
  }, []);

  // EFFECT 4 — subscriptions Realtime UPDATE → force refetch (verbatim
  // from :247-253). Stripe webhook → managed-models cache invalidates.
  useEffect(() => {
    if (!hasSession) return;
    const channel = subscribeSubscriptions(() => {
      void fetchManagedModels({ force: true }).then((m) => {
        setModels(m);
        void reconcileActiveManagedModel(m);
      });
    });
    return () => { void channel.unsubscribe(); };
  }, [hasSession]);

  return { models };
}
