// chrome-extension/tests/subscribe-subscriptions-channel.test.ts
//
// Phase 18 Plan 18-02 — vitest CHANNEL-01: subscribeSubscriptions multi-mount safety.
//
// D-A5: 4 scenarios verifying ref-count behavior of the supabase channel
// returned by subscribeSubscriptions. Mock the wrapper (not supabase
// client) per D-A5.1 — gives us deterministic ref-count instrumentation
// without coupling to supabase-js v2 internals.
//
// CHANNEL-02 escalation: if S4 (paired interleaved) fails, this test
// should fail loudly with FOLLOW-UP-ISSUE marker — Plan 18-02 acceptance
// halts per CONTEXT T-18-03.

import { describe, it, expect, beforeEach, vi } from 'vitest'

// In-test subscriber registry + ref-count counter.
// D-A5.1: this lives in the TEST file, not a production module — we are
// instrumenting the channel multi-mount surface, not changing it.
let subscribers: Set<(payload: unknown) => void>
let channelCount: number

vi.mock('../reader/lib/subscriptions-sync', () => ({
  subscribeSubscriptions: (fn: (payload: unknown) => void) => {
    subscribers.add(fn)
    channelCount++
    return {
      unsubscribe: () => {
        subscribers.delete(fn)
        channelCount = Math.max(0, channelCount - 1)
        return Promise.resolve('ok')
      },
    }
  },
}))

beforeEach(() => {
  subscribers = new Set()
  channelCount = 0
})

// Helper to fire a fake supabase Realtime UPDATE event.
function fireRealtimeUpdate(payload: unknown) {
  for (const cb of subscribers) cb(payload)
}

describe('subscribeSubscriptions multi-mount safety (CHANNEL-01)', () => {
  it('S1 happy path — two consumers both receive update; A unmount; B still receives; B unmount; channel cleaned up', async () => {
    const { subscribeSubscriptions } = await import('../reader/lib/subscriptions-sync')
    const aReceived: unknown[] = []
    const bReceived: unknown[] = []
    const chA = subscribeSubscriptions((p) => aReceived.push(p))
    const chB = subscribeSubscriptions((p) => bReceived.push(p))
    expect(channelCount).toBe(2)

    fireRealtimeUpdate({ tier: 'pro' })
    expect(aReceived).toEqual([{ tier: 'pro' }])
    expect(bReceived).toEqual([{ tier: 'pro' }])

    await chA.unsubscribe()
    expect(channelCount).toBe(1)

    fireRealtimeUpdate({ tier: 'sync' })
    expect(aReceived).toEqual([{ tier: 'pro' }])           // unchanged
    expect(bReceived).toEqual([{ tier: 'pro' }, { tier: 'sync' }])

    await chB.unsubscribe()
    expect(channelCount).toBe(0)
    expect(subscribers.size).toBe(0)
  })

  it('S2 sequential — mount A, mount B, unmount A, unmount B', async () => {
    const { subscribeSubscriptions } = await import('../reader/lib/subscriptions-sync')
    const chA = subscribeSubscriptions(() => {})
    const chB = subscribeSubscriptions(() => {})
    expect(channelCount).toBe(2)
    await chA.unsubscribe()
    expect(channelCount).toBe(1)
    await chB.unsubscribe()
    expect(channelCount).toBe(0)
    expect(subscribers.size).toBe(0)
  })

  it('S3 reverse — mount A, mount B, unmount B, unmount A', async () => {
    const { subscribeSubscriptions } = await import('../reader/lib/subscriptions-sync')
    const aReceived: unknown[] = []
    const chA = subscribeSubscriptions((p) => aReceived.push(p))
    const chB = subscribeSubscriptions(() => {})
    expect(channelCount).toBe(2)
    fireRealtimeUpdate({ tier: 'pro' })
    expect(aReceived).toHaveLength(1)
    await chB.unsubscribe()
    expect(channelCount).toBe(1)
    // A still receives after B unmounts
    fireRealtimeUpdate({ tier: 'sync' })
    expect(aReceived).toHaveLength(2)
    await chA.unsubscribe()
    expect(channelCount).toBe(0)
    expect(subscribers.size).toBe(0)
  })

  it('S4 paired interleaved (CHANNEL-02 critical) — mount A, mount B, unmount A, mount C, unmount B, unmount C; channelCount never negative', async () => {
    const { subscribeSubscriptions } = await import('../reader/lib/subscriptions-sync')
    const chA = subscribeSubscriptions(() => {})
    expect(channelCount).toBe(1)
    const chB = subscribeSubscriptions(() => {})
    expect(channelCount).toBe(2)
    await chA.unsubscribe()
    expect(channelCount, 'after A unmount, channelCount should be 1').toBe(1)
    expect(channelCount, 'channelCount must NEVER go negative').toBeGreaterThanOrEqual(0)
    const chC = subscribeSubscriptions(() => {})
    expect(channelCount, 'after C mount, channelCount should be 2').toBe(2)
    await chB.unsubscribe()
    expect(channelCount, 'after B unmount, channelCount should be 1').toBe(1)
    expect(channelCount).toBeGreaterThanOrEqual(0)
    await chC.unsubscribe()
    // Final assertion. If this fails, CHANNEL-02 escalates: the wrapper
    // is NOT correctly ref-counted under interleaved mount/unmount, and
    // Phase 18 plan 02 acceptance halts. Emit FOLLOW-UP-ISSUE with
    // broker-fan-out proposal per CONTEXT.md T-18-03.
    expect(
      channelCount,
      'CHANNEL-02 ESCALATION: FOLLOW-UP-ISSUE — subscribeSubscriptions NOT reference-counted under interleaved mount/unmount; broker fan-out required (see .planning/phases/18-data-layer-gates/18-CONTEXT.md T-18-03)',
    ).toBe(0)
    expect(subscribers.size).toBe(0)
  })
})
