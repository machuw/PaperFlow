// QuotaChip · spec §10.4 — top-bar AI usage pill.
//
// Renders exactly 5 visible states driven by (session, tier, usage):
//   hidden         → logged-out (pure BYOK flow has no quota concept)
//   free-normal    → Free tier, pct <  60%
//   free-warn      → Free tier, pct >= 60% and < 100%
//   free-critical  → Free tier, pct >= 100%
//   pro            → Pro tier (monthly window)
//   sync           → Sync tier (BYOK-only, static pill)
//
// Refresh strategy:
//   - Initial load on mount (reads session → tier → usage).
//   - onAuthStateChange re-runs refresh and re-wires the realtime channel
//     because a new JWT resets the RLS context.
//   - A Supabase realtime channel on public.ai_usage triggers refresh on any
//     INSERT/UPDATE. RLS scopes rows to the current user, so no extra filter
//     is needed.
//
// Clicking the chip dispatches `open-account-menu`, which AccountMenu
// listens for (it owns the `open` state internally).

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { t, useT } from '../lib/i18n'
import type { Session } from '@supabase/supabase-js'
import '../styles/quota-chip.css'

type State = 'hidden' | 'free-normal' | 'free-warn' | 'free-critical' | 'pro' | 'sync'

export function QuotaChip({ onOpenMenu }: { onOpenMenu: () => void }) {
  useT()  // re-render on locale change
  const [state, setState] = useState<State>('hidden')
  const [used, setUsed] = useState(0)
  const [limit, setLimit] = useState(20)

  useEffect(() => {
    let cancelled = false
    let channel: ReturnType<typeof supabase.channel> | null = null

    async function refresh(session: Session | null) {
      // Hidden for logged-out users — pure BYOK flow has no quota concept.
      if (!session) {
        if (!cancelled) setState('hidden')
        return
      }

      const { data: sub } = await supabase
        .from('subscriptions')
        .select('tier')
        .maybeSingle()
      const tier = (sub?.tier as 'free' | 'sync' | 'pro' | undefined) ?? 'free'

      // Sync tier uses BYOK for AI; show a static pill — no usage fetch.
      if (tier === 'sync') {
        if (!cancelled) setState('sync')
        return
      }

      const period = tier === 'pro'
        ? new Date().toISOString().slice(0, 7)
        : 'lifetime-trial'
      const { data: u } = await supabase
        .from('ai_usage')
        .select('used')
        .eq('period', period)
        .maybeSingle()
      if (cancelled) return
      const _used = u?.used ?? 0
      const _limit = tier === 'pro' ? 30000 : 20
      setUsed(_used)
      setLimit(_limit)

      if (tier === 'pro') {
        setState('pro')
        return
      }

      // Free tier: 3 gradient states based on usage fraction.
      const pct = _used / _limit
      if (pct >= 1) setState('free-critical')
      else if (pct >= 0.6) setState('free-warn')
      else setState('free-normal')
    }

    function wireChannel(session: Session | null) {
      if (channel) {
        channel.unsubscribe()
        channel = null
      }
      if (!session) return
      channel = supabase
        .channel('quota-chip')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'ai_usage' },
          () => { void refresh(session) },
        )
        .subscribe()
    }

    // Initial load: read session, do first refresh, attach channel.
    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      void refresh(data.session)
      wireChannel(data.session)
    })

    // Re-run on login / logout — new JWT = new RLS context.
    const { data: authListener } = supabase.auth.onAuthStateChange(async (_evt, session) => {
      if (cancelled) return
      await refresh(session)
      wireChannel(session)
    })

    return () => {
      cancelled = true
      authListener.subscription.unsubscribe()
      if (channel) channel.unsubscribe()
    }
  }, [])

  if (state === 'hidden') return null

  const label =
    state === 'sync'          ? t('quota.sync') :
    state === 'pro'           ? t('quota.pro',           { used, limit }) :
    state === 'free-critical' ? t('quota.free.critical') :
    state === 'free-warn'     ? t('quota.free.warn',     { used, limit }) :
                                t('quota.free',          { used, limit })

  return (
    <button
      className={`quota-chip quota-${state}`}
      onClick={onOpenMenu}
      aria-label={label}
      title={label}
    >
      {label}
    </button>
  )
}
