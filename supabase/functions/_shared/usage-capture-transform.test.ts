// Phase ai-cost-tier-pricing — verify usage-capture-transform:
//   1. Pass-through: every upstream byte forwarded verbatim
//   2. SSE parsing: complete lines parsed, partial lines buffered
//   3. Anthropic two-shot: input from message_start, output from message_delta
//   4. Robustness: malformed JSON / no-usage stream don't throw or fire update
//
// Run with: npx deno test supabase/functions/_shared/usage-capture-transform.test.ts --no-check

import { assert, assertEquals } from 'https://deno.land/std@0.220.0/assert/mod.ts'
import { makeUsageCaptureTransform, type UsageUpdateDeps } from './usage-capture-transform.ts'

const enc = new TextEncoder()
const dec = new TextDecoder()

function makeRecorder(): { deps: UsageUpdateDeps; updates: Array<Record<string, number>> } {
  const updates: Array<Record<string, number>> = []
  const deps: UsageUpdateDeps = {
    update: (values) => {
      updates.push({ ...values } as Record<string, number>)
      return Promise.resolve()
    },
    defer: (p) => {
      // For tests, run sync. Swallow errors so they don't surface as unhandled.
      Promise.resolve(p).catch(() => {})
    },
  }
  return { deps, updates }
}

async function pipe(
  chunks: string[],
  deps: UsageUpdateDeps,
): Promise<string> {
  const upstream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c))
      controller.close()
    },
  })
  const transformed = upstream.pipeThrough(makeUsageCaptureTransform(deps))
  const reader = transformed.getReader()
  let out = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    out += dec.decode(value, { stream: true })
  }
  return out
}

Deno.test('OpenAI: single-chunk final usage frame → update with both fields', async () => {
  const { deps, updates } = makeRecorder()
  const sse =
    `data: {"id":"x","choices":[{"delta":{"content":"Hi"}}]}\n\n` +
    `data: {"id":"x","choices":[],"usage":{"prompt_tokens":1024,"completion_tokens":256}}\n\n` +
    `data: [DONE]\n\n`
  const out = await pipe([sse], deps)
  assertEquals(out, sse, 'pass-through must preserve input bytes')
  assertEquals(updates.length, 1, 'expected one update call')
  assertEquals(updates[0], { prompt_tokens: 1024, output_tokens: 256 })
})

Deno.test('Pass-through: split mid-line across two chunks still parses correctly', async () => {
  const { deps, updates } = makeRecorder()
  const full = `data: {"choices":[],"usage":{"prompt_tokens":900,"completion_tokens":100}}\n\n`
  const split = 30 // mid-JSON
  const out = await pipe([full.slice(0, split), full.slice(split)], deps)
  assertEquals(out, full, 'every byte must reach client even when split')
  assertEquals(updates.length, 1)
  assertEquals(updates[0], { prompt_tokens: 900, output_tokens: 100 })
})

Deno.test('Anthropic two-shot: input from message_start, output progresses via message_delta', async () => {
  const { deps, updates } = makeRecorder()
  const sse =
    `data: ${JSON.stringify({
      type: 'message_start',
      message: { id: 'msg_01', usage: { input_tokens: 1500, output_tokens: 1 } },
    })}\n\n` +
    `data: ${JSON.stringify({ type: 'content_block_delta', delta: { text: 'Hi' } })}\n\n` +
    `data: ${JSON.stringify({ type: 'message_delta', usage: { output_tokens: 100 } })}\n\n` +
    `data: ${JSON.stringify({ type: 'message_delta', usage: { output_tokens: 350 } })}\n\n`
  await pipe([sse], deps)
  // Fire-on-change semantics: ≥1 update; LAST update has the final values.
  // (input from message_start, output from final message_delta).
  assertEquals(updates.at(-1), { prompt_tokens: 1500, output_tokens: 350 })
  // Sanity: at least one fire happened, no duplicate-no-op fires.
  assertEquals(updates.length >= 1 && updates.length <= 3, true,
    `expected 1-3 updates, got ${updates.length}`)
})

Deno.test('Gemini: usageMetadata each chunk → last update has final values', async () => {
  const { deps, updates } = makeRecorder()
  const sse =
    `data: ${JSON.stringify({ usageMetadata: { promptTokenCount: 1500, candidatesTokenCount: 50 } })}\n\n` +
    `data: ${JSON.stringify({ usageMetadata: { promptTokenCount: 1500, candidatesTokenCount: 250 } })}\n\n`
  await pipe([sse], deps)
  // Fire-on-change: 2 updates (50, then 250). DB final state is the second.
  assertEquals(updates.at(-1), { prompt_tokens: 1500, output_tokens: 250 })
})

Deno.test('Malformed JSON in mid-stream → no throw, no update if no valid usage seen', async () => {
  const { deps, updates } = makeRecorder()
  const sse =
    `data: {malformed json}\n\n` +
    `data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n` +
    `data: [DONE]\n\n`
  const out = await pipe([sse], deps)
  assertEquals(out, sse, 'pass-through preserved')
  assertEquals(updates.length, 0, 'no usage seen → no update fired')
})

Deno.test('Stream with no usage at all → defer never called', async () => {
  const { deps, updates } = makeRecorder()
  const sse =
    `data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n` +
    `data: {"choices":[{"delta":{"content":" world"}}]}\n\n` +
    `data: [DONE]\n\n`
  await pipe([sse], deps)
  assertEquals(updates.length, 0)
})

Deno.test('Comment lines (`:keepalive`) and blank lines are ignored without throwing', async () => {
  const { deps, updates } = makeRecorder()
  const sse =
    `:keepalive\n\n` +
    `\n\n` +
    `data: {"choices":[],"usage":{"prompt_tokens":50,"completion_tokens":10}}\n\n`
  await pipe([sse], deps)
  assertEquals(updates.length, 1)
  assertEquals(updates[0], { prompt_tokens: 50, output_tokens: 10 })
})

Deno.test('Defer error must not propagate', async () => {
  const updates: Array<Record<string, number>> = []
  const deps: UsageUpdateDeps = {
    update: (v) => {
      updates.push({ ...v } as Record<string, number>)
      return Promise.reject(new Error('db down'))
    },
    defer: (p) => { Promise.resolve(p).catch(() => {}) },
  }
  const sse = `data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5}}\n\n`
  const out = await pipe([sse], deps)
  assertEquals(out, sse, 'pass-through still works under db failure')
  assertEquals(updates.length, 1)
  assert(true, 'no exception escaped to test runner')
})
