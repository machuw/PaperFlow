// chrome-extension/tests/keepalive-transform.test.ts
//
// Unit test for `supabase/functions/agent-run/keepalive.ts` — strictly verifies
// that createKeepaliveTransform emits keepalive comment frames at the configured
// interval, regardless of whether the upstream source produces any chunks.
//
// This complements Plan 10-07 Test 7 (live SSE keepalive observation, marked
// diagnostic-only). Together: this unit test gives SC #4 strict coverage; the
// integration test gives end-to-end observation under real load.
//
// Why 100ms interval over 500ms wall time (instead of the production 25s):
//   - 4+ keepalive frames in 500ms is deterministic on any machine.
//   - 25s in CI would either time out or burn budget for marginal coverage.
//   - The transform's logic is interval-agnostic; small intervals exercise
//     the same code path as large ones.

import { describe, it, expect } from 'vitest'
import { createKeepaliveTransform } from '../../supabase/functions/agent-run/keepalive.ts'

describe('createKeepaliveTransform', () => {
  it('emits ≥4 keepalive frames over 500ms at 100ms interval', async () => {
    // Synthetic slow source: one tiny chunk every 200ms; never closes during
    // the measurement window. The transform's keepalive timer is independent
    // of this stream's chunks — that's the contract being tested.
    const encoder = new TextEncoder()
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('payload-0\n\n'))
        const t1 = setTimeout(() => controller.enqueue(encoder.encode('payload-1\n\n')), 200)
        const t2 = setTimeout(() => controller.enqueue(encoder.encode('payload-2\n\n')), 400)
        const close = setTimeout(() => {
          clearTimeout(t1); clearTimeout(t2)
          controller.close()
        }, 500)
        // Keep refs so test runner does not GC; setTimeout returns a number
        // in browser-like environments and Timeout in node — both fine to leave.
        void [t1, t2, close]
      },
    })

    const wrapped = source.pipeThrough(createKeepaliveTransform(100))

    const reader = wrapped.getReader()
    const decoder = new TextDecoder()
    let captured = ''
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      captured += decoder.decode(value, { stream: true })
    }

    // Count keepalive comment frames in the captured output. The frame format
    // is exactly `:keepalive\n\n`; we count occurrences (split returns N+1
    // segments → keepaliveCount = parts.length - 1).
    const keepaliveCount = captured.split(':keepalive\n\n').length - 1

    expect(keepaliveCount).toBeGreaterThanOrEqual(4)
  })
})
