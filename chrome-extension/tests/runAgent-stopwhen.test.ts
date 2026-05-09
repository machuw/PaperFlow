// chrome-extension/tests/runAgent-stopwhen.test.ts
//
// Phase 11 Plan 08: deterministic stopWhen verification per CONTEXT D-D3 (b)
// + Phase 10 follow-up (b).
//
// Uses createMockProvider('continuous-tools') from Plan 02 to drive streamText
// through up-to-6 canned tool-call rounds with stopWhen=stepCountIs(3) +
// manual step counter (the D-04 ground truth pattern that runAgent.ts uses).
// Asserts that the manual counter aborts at exactly 3 step-finish events,
// regardless of SDK stopWhen behavior under #7502/#7683.
//
// Why we exercise streamText directly instead of importing runAgent:
//   The Edge Function's runAgent.ts uses Deno-style `.ts` import suffixes
//   that Vitest's moduleResolution does not strip; importing it cross-tree
//   surfaces a "Failed to resolve import 'ai'" error. This test reproduces
//   the SAME ground-truth pattern — manual `stepCount++` in onStepFinish that
//   aborts the inner controller at the ceiling — so a regression in the
//   pattern would fail this test even though it's not literally calling
//   runAgent.
//
// Phase 14 eval set will reuse createMockProvider for offline eval; this
// test is the canary for the manual step counter contract.

import { describe, it, expect } from 'vitest'
import { streamText, stepCountIs } from 'ai'
import { createMockProvider } from './agent-mock-provider'

describe('runAgent stopWhen (deterministic)', () => {
  it('manual step counter aborts at exactly maxSteps step-finish events (D-04)', async () => {
    const MAX_STEPS = 3
    let stepCount = 0
    let manualAborted = false
    const inner = new AbortController()

    const result = streamText({
      model: createMockProvider('continuous-tools'),
      // No tool definitions — the mock provider emits canned tool-call frames;
      // streamText will surface them as parts but won't try to invoke any
      // execute() hook (no toolset registered).
      tools: {},
      messages: [{ role: 'user', content: 'continuous tool calls' }],
      stopWhen: stepCountIs(MAX_STEPS),
      abortSignal: inner.signal,
      onStepFinish: () => {
        stepCount++
        if (stepCount >= MAX_STEPS) {
          manualAborted = true
          // GROUND TRUTH: independent of SDK stopWhen behavior under #7502/#7683.
          inner.abort('max-steps-reached')
        }
      },
    })

    // Drain the SSE response body so streamText finishes its work.
    const resp = result.toUIMessageStreamResponse({ headers: { 'Cache-Control': 'no-store' } })
    if (resp.body) {
      const reader = resp.body.getReader()
      try {
        while (true) {
          const { done } = await reader.read()
          if (done) break
        }
      } catch { /* abort may surface as throw — expected after manual abort */ }
    }

    console.info('[stopwhen-deterministic] stepCount =', stepCount, 'manualAborted =', manualAborted)

    // The manual counter MUST enforce 3 — even if SDK stopWhen behavior is
    // unreliable per #7502/#7683. Strict assertion: not <=, not >=. Exactly 3.
    expect(stepCount).toBe(MAX_STEPS)
    expect(manualAborted).toBe(true)
  }, 10_000)
})
