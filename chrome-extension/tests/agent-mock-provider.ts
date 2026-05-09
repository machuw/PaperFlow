// chrome-extension/tests/agent-mock-provider.ts
//
// LOCATION-LOCKED: this file MUST stay at chrome-extension/tests/
// (sibling to agent-runtime-fixtures.ts). The fixtures/ subdirectory is
// reserved for STATIC ASSETS (.xml / .html / .pdf); this is executable
// TypeScript and must live at the tests/ root per PATTERNS.md §22 Correction.
// CONTEXT.md D-D3 line 170 hint suggested tests/fixtures/, but PATTERNS.md
// §22 Correction supersedes it: keep top-level so .ts and .xml/.pdf assets
// don't share a directory.
//
// Phase 11 Plan 02 — D-D3 + Phase 10 follow-up (b) deterministic LanguageModelV2
// stub. Provides canned tool-call frame sequences keyed by scenario so the
// runAgent contract test (Plan 06) and stopWhen probe (Phase 10 follow-up)
// can run without a live LLM. Phase 14 eval set will reuse this fixture for
// offline evals (CONTEXT line 170).
//
// The stub conforms to the LanguageModelV2 shape that ai@5.0.179 +
// @ai-sdk/provider@2.0.1 produce: doStream() returns
// { stream: ReadableStream<LanguageModelV2StreamPart>, request, response }.
// Public type is `LanguageModel` (re-exported from `ai`); the V2 shape lives
// in @ai-sdk/provider, which `ai` consumes transitively. We type-define the
// emitted stream parts structurally (see V2StreamPart below) to avoid hard
// import dependencies on the transitive `@ai-sdk/provider` package while
// still preserving doStream() conformance via the final cast at the boundary.

import type { LanguageModel } from 'ai'

export type MockScenario =
  | 'happy-path-search'
  | 'continuous-tools'
  | 'tool-error-logical'
  | 'tool-error-transient'
  | 'mixed-server-client'

/**
 * Subset of `LanguageModelV2StreamPart` shapes we emit. The full provider
 * spec defines more variants (reasoning-*, tool-input-*, file, source, raw,
 * error); we only need the ones below for canned playback.
 *
 * Field shapes mirror @ai-sdk/provider@2.0.1 exactly so a structural cast
 * at the doStream boundary type-checks against `LanguageModelV2`.
 */
type V2Usage = {
  inputTokens: number | undefined
  outputTokens: number | undefined
  totalTokens: number | undefined
}

type V2StreamPart =
  | { type: 'stream-start'; warnings: [] }
  | { type: 'response-metadata'; id: string; modelId: string; timestamp: Date }
  | { type: 'text-start'; id: string }
  | { type: 'text-delta'; id: string; delta: string }
  | { type: 'text-end'; id: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; input: string }
  | {
      type: 'finish'
      usage: V2Usage
      finishReason: 'stop' | 'length' | 'content-filter' | 'tool-calls' | 'error' | 'other' | 'unknown'
    }

/**
 * Build a canned chunk sequence for a given scenario. Each scenario reflects
 * a specific Phase 11 / Phase 14 verification target.
 *
 * Each outer array element = one streamText "round" (one model response).
 * The SDK re-invokes doStream() per step when tool results come back in
 * subsequent message turns; this mock returns the next canned round each time.
 */
function chunksForScenario(scenario: MockScenario): V2StreamPart[][] {
  switch (scenario) {
    case 'happy-path-search':
      // 1× searchArxiv tool-call → tool-output (handled by SDK) → finish
      return [
        [
          { type: 'stream-start', warnings: [] },
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'searchArxiv',
            input: JSON.stringify({ query: 'transformers', maxResults: 5 }),
          },
          {
            type: 'finish',
            usage: { inputTokens: 50, outputTokens: 20, totalTokens: 70 },
            finishReason: 'tool-calls',
          },
        ],
        [
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 't1' },
          { type: 'text-delta', id: 't1', delta: 'Found relevant papers.' },
          { type: 'text-end', id: 't1' },
          {
            type: 'finish',
            usage: { inputTokens: 80, outputTokens: 10, totalTokens: 90 },
            finishReason: 'stop',
          },
        ],
      ]

    case 'continuous-tools':
      // 6 tool-calls in 6 rounds. With MAX_STEPS=3 (test override),
      // runAgent's manual step counter aborts after step 3 (D-04 ground truth).
      // Phase 10 follow-up (b): proves stopWhen + manual counter both work
      // even when the model would otherwise loop forever.
      return Array.from({ length: 6 }, (_, i) => [
        { type: 'stream-start', warnings: [] },
        {
          type: 'tool-call',
          toolCallId: `call-${i + 1}`,
          toolName: 'searchArxiv',
          input: JSON.stringify({ query: `iter-${i + 1}`, maxResults: 1 }),
        },
        {
          type: 'finish',
          usage: { inputTokens: 50, outputTokens: 20, totalTokens: 70 },
          finishReason: 'tool-calls',
        },
      ])

    case 'tool-error-logical':
      // 1× searchArxiv (bad query) → tool returns ok:false kind:'logical'
      // → SDK re-feeds error back as message → model self-corrects with new query
      // → tool returns ok:true → finish.
      return [
        [
          { type: 'stream-start', warnings: [] },
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'searchArxiv',
            input: JSON.stringify({ query: 'bad-query', maxResults: 5 }),
          },
          {
            type: 'finish',
            usage: { inputTokens: 50, outputTokens: 20, totalTokens: 70 },
            finishReason: 'tool-calls',
          },
        ],
        [
          { type: 'stream-start', warnings: [] },
          {
            type: 'tool-call',
            toolCallId: 'call-2',
            toolName: 'searchArxiv',
            input: JSON.stringify({ query: 'corrected-query', maxResults: 5 }),
          },
          {
            type: 'finish',
            usage: { inputTokens: 90, outputTokens: 20, totalTokens: 110 },
            finishReason: 'tool-calls',
          },
        ],
        [
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 't1' },
          { type: 'text-delta', id: 't1', delta: 'Self-corrected and found results.' },
          { type: 'text-end', id: 't1' },
          {
            type: 'finish',
            usage: { inputTokens: 120, outputTokens: 8, totalTokens: 128 },
            finishReason: 'stop',
          },
        ],
      ]

    case 'tool-error-transient':
      // 1× searchArxiv → tool returns ok:false kind:'transient'
      // → runAgent emits onEvent({type:'tool-error', kind:'transient'}) but
      // does NOT replay messages (D-B2). Model proceeds without retry.
      return [
        [
          { type: 'stream-start', warnings: [] },
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'searchArxiv',
            input: JSON.stringify({ query: 'q', maxResults: 5 }),
          },
          {
            type: 'finish',
            usage: { inputTokens: 50, outputTokens: 20, totalTokens: 70 },
            finishReason: 'tool-calls',
          },
        ],
        [
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 't1' },
          { type: 'text-delta', id: 't1', delta: 'Tool transient — proceeding without retry.' },
          { type: 'text-end', id: 't1' },
          {
            type: 'finish',
            usage: { inputTokens: 80, outputTokens: 8, totalTokens: 88 },
            finishReason: 'stop',
          },
        ],
      ]

    case 'mixed-server-client':
      // 1× searchArxiv (server tool, has execute) → tool result returned
      // → 1× screenshotParagraph (client tool, NO execute, resolved via
      // addToolResult round-trip per Phase 10 D-01) → finish.
      return [
        [
          { type: 'stream-start', warnings: [] },
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'searchArxiv',
            input: JSON.stringify({ query: 'q', maxResults: 5 }),
          },
          {
            type: 'finish',
            usage: { inputTokens: 50, outputTokens: 20, totalTokens: 70 },
            finishReason: 'tool-calls',
          },
        ],
        [
          { type: 'stream-start', warnings: [] },
          {
            type: 'tool-call',
            toolCallId: 'call-2',
            toolName: 'screenshotParagraph',
            input: JSON.stringify({ paragraphId: 'p-1' }),
          },
          {
            type: 'finish',
            usage: { inputTokens: 90, outputTokens: 20, totalTokens: 110 },
            finishReason: 'tool-calls',
          },
        ],
        [
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 't1' },
          { type: 'text-delta', id: 't1', delta: 'Done — server + client tool round-trip.' },
          { type: 'text-end', id: 't1' },
          {
            type: 'finish',
            usage: { inputTokens: 130, outputTokens: 9, totalTokens: 139 },
            finishReason: 'stop',
          },
        ],
      ]
  }
}

/**
 * Build a LanguageModelV2-shaped stub. Each invocation of doStream() pops
 * the next round from the canned sequence; if exhausted, returns a finish
 * chunk with reason='stop' to terminate cleanly.
 *
 * Cursor is per-instance — each createMockProvider() call starts at 0.
 * Tests requiring deterministic re-runs should rebuild the provider rather
 * than reuse one across cases.
 */
export function createMockProvider(scenario: MockScenario): LanguageModel {
  const rounds = chunksForScenario(scenario)
  let cursor = 0

  // Structural V2 shape — typed inline rather than imported from
  // @ai-sdk/provider (transitive dep) to keep the public surface anchored
  // to `ai`. The final `as unknown as LanguageModel` cast is intentional:
  // the runtime shape is verified by the runAgent contract test (Plan 06)
  // exercising streamText({ model: createMockProvider(...) }).
  const provider = {
    specificationVersion: 'v2' as const,
    provider: 'mock',
    modelId: `mock-${scenario}`,
    supportedUrls: {} as Record<string, RegExp[]>,
    async doGenerate(): Promise<never> {
      throw new Error(
        'doGenerate not implemented in mock provider — use streamText, not generateText',
      )
    },
    async doStream() {
      const round =
        rounds[cursor] ??
        ([
          { type: 'stream-start', warnings: [] },
          {
            type: 'finish',
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            finishReason: 'stop',
          },
        ] satisfies V2StreamPart[])
      cursor++
      const stream = new ReadableStream<V2StreamPart>({
        start(controller) {
          for (const chunk of round) controller.enqueue(chunk)
          controller.close()
        },
      })
      return {
        stream,
        request: { body: '{}' },
        response: { headers: {} as Record<string, string> },
      }
    },
  }

  return provider as unknown as LanguageModel
}
