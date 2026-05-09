// Quick 260507-cf — verify the content-filter detector injects a synthetic
// content frame ONLY on streams that close with finish_reason=content_filter
// and have emitted no content. All upstream bytes must pass through verbatim.
//
// Run with: npx deno test supabase/functions/_shared/content-filter-detector.test.ts --no-check

import { assertEquals, assert, assertStringIncludes } from 'https://deno.land/std@0.220.0/assert/mod.ts'
import { makeContentFilterDetector } from './content-filter-detector.ts'

const enc = new TextEncoder()
const dec = new TextDecoder()

async function pipe(input: string | string[]): Promise<string> {
  const chunks = Array.isArray(input) ? input : [input]
  const upstream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c))
      controller.close()
    },
  })
  const transformed = upstream.pipeThrough(makeContentFilterDetector())
  const reader = transformed.getReader()
  let out = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    out += dec.decode(value, { stream: true })
  }
  return out
}

const SYNTH_MARK = 'pf-content-filter-synth'
const ERR_TEXT = 'upstream content guardrail blocked'

Deno.test('Test 1: passes through normal stream unchanged (finish_reason=stop)', async () => {
  const upstream = [
    'data: {"choices":[{"delta":{"content":"hello"},"index":0}]}\n\n',
    'data: {"choices":[{"delta":{"content":" world"},"index":0,"finish_reason":"stop"}]}\n\n',
    'data: [DONE]\n\n',
  ].join('')
  const out = await pipe(upstream)
  assertEquals(out, upstream)
  assert(!out.includes(SYNTH_MARK))
})

Deno.test('Test 2: injects synthetic frame when content_filter fires with no prior content', async () => {
  const upstream = [
    'data: {"id":"abc","choices":[{"delta":{"content":"","role":"assistant"},"index":0,"finish_reason":null}]}\n\n',
    'data: {"id":"abc","choices":[{"delta":{},"index":0,"finish_reason":"content_filter"}]}\n\n',
    'data: {"id":"abc","choices":[],"usage":{"prompt_tokens":100}}\n\n',
    'data: [DONE]\n\n',
  ].join('')
  const out = await pipe(upstream)
  assertStringIncludes(out, upstream)        // upstream bytes preserved verbatim
  assertStringIncludes(out, ERR_TEXT)         // synthetic injection visible to client
})

Deno.test('Test 2b: synthetic frame uses pf-content-filter-synth id when upstream has no id', async () => {
  const upstream = [
    'data: {"choices":[{"delta":{},"index":0,"finish_reason":"content_filter"}]}\n\n',
    'data: [DONE]\n\n',
  ].join('')
  const out = await pipe(upstream)
  assertStringIncludes(out, SYNTH_MARK)       // fallback id appears when upstream omits it
  assertStringIncludes(out, ERR_TEXT)
})

Deno.test('Test 3: skips injection if content already streamed (then content_filter)', async () => {
  // Some providers may stream a partial answer then trip the filter on a tail
  // section — in that case the user already saw output and we should not pollute.
  const upstream = [
    'data: {"choices":[{"delta":{"content":"partial answer"},"index":0,"finish_reason":null}]}\n\n',
    'data: {"choices":[{"delta":{},"index":0,"finish_reason":"content_filter"}]}\n\n',
    'data: [DONE]\n\n',
  ].join('')
  const out = await pipe(upstream)
  assertEquals(out, upstream)
  assert(!out.includes(SYNTH_MARK))
})

Deno.test('Test 4: injects only ONCE even if content_filter appears in multiple frames', async () => {
  const upstream = [
    'data: {"choices":[{"delta":{},"index":0,"finish_reason":"content_filter"}]}\n\n',
    'data: {"choices":[{"delta":{},"index":0,"finish_reason":"content_filter"}]}\n\n',
    'data: [DONE]\n\n',
  ].join('')
  const out = await pipe(upstream)
  // upstream bytes preserved
  assertStringIncludes(out, upstream)
  // exactly one injection
  const matches = out.match(new RegExp(ERR_TEXT, 'g')) || []
  assertEquals(matches.length, 1)
})

Deno.test('Test 5: handles chunks split mid-frame (transform must buffer)', async () => {
  // Same payload as Test 2, but the bytes are split arbitrarily — including
  // splitting a frame across two chunks. Synthesis must still trigger exactly once.
  const upstream = [
    'data: {"id":"abc","choices":[{"delta":{"content":"","role":"assistant"},"index":0,"finish_reason":null}]}\n\n',
    'data: {"id":"abc","choices":[{"delta":{},"index":0,"finish_reason":"content_filter"}]}\n\n',
    'data: {"id":"abc","choices":[],"usage":{"prompt_tokens":100}}\n\n',
    'data: [DONE]\n\n',
  ].join('')
  const split = [upstream.slice(0, 47), upstream.slice(47, 130), upstream.slice(130)]
  const out = await pipe(split)
  assertStringIncludes(out, upstream)
  const matches = out.match(new RegExp(ERR_TEXT, 'g')) || []
  assertEquals(matches.length, 1)
})

Deno.test('Test 6: ignores malformed frames without crashing', async () => {
  const upstream = [
    'data: not-valid-json\n\n',
    'event: ping\n\n',
    'data: {"choices":[{"delta":{"content":"ok"},"index":0,"finish_reason":"stop"}]}\n\n',
    'data: [DONE]\n\n',
  ].join('')
  const out = await pipe(upstream)
  assertEquals(out, upstream)
})

Deno.test('Test 7: injection content is OpenAI-compatible (parses + has content delta)', async () => {
  const upstream = [
    'data: {"id":"x","choices":[{"delta":{"content":"","role":"assistant"},"index":0}]}\n\n',
    'data: {"id":"x","choices":[{"delta":{},"index":0,"finish_reason":"content_filter"}]}\n\n',
    'data: [DONE]\n\n',
  ].join('')
  const out = await pipe(upstream)
  // Find the injected frame and verify it parses into an OpenAI-shaped chunk.
  const lines = out.split(/\n\n/)
  const synthFrame = lines.find((l) => l.includes(ERR_TEXT))
  assert(synthFrame, 'no synthetic frame found')
  const json = JSON.parse(synthFrame!.replace(/^data: /, ''))
  assertEquals(json.choices[0].delta.role, 'assistant')
  assert(json.choices[0].delta.content.length > 0)
  assertEquals(json.object, 'chat.completion.chunk')
})
