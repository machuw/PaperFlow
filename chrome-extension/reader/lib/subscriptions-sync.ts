// chrome-extension/reader/lib/subscriptions-sync.ts
import { supabase } from './supabase'

type SubListener = (sub: { tier: string; cancel_at_period_end: boolean; current_period_end: string | null }) => void

// Each call gets a unique channel name. supabase.channel(name) returns the
// existing channel object for duplicate names; a second .on() after the
// first .subscribe() throws "cannot add postgres_changes callbacks after
// subscribe()" and white-screens the reader (no Error Boundary). Concurrent
// callers exist (top-bar AccountMenu + use-managed-models Effect 4). See
// .planning/phases/18-data-layer-gates/FOLLOW-UP-ISSUE-CHANNEL-02.md.
let channelCounter = 0

export function subscribeSubscriptions(fn: SubListener) {
  const channelName = `subscriptions-sync:${++channelCounter}`
  return supabase.channel(channelName)
    .on('postgres_changes', {
      event: 'UPDATE', schema: 'public', table: 'subscriptions',
    }, (payload) => {
      fn(payload.new as any)
    })
    .subscribe()
}
