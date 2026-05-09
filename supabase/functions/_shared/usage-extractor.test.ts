// Phase ai-cost-tier-pricing — verify extractUsage handles three providers'
// streaming usage shapes plus malformed inputs without throwing.
//
// Run with: npx deno test supabase/functions/_shared/usage-extractor.test.ts --no-check

import { assertEquals } from 'https://deno.land/std@0.220.0/assert/mod.ts'
import { extractUsage } from './usage-extractor.ts'

Deno.test('OpenAI: final chunk with usage → both fields populated', () => {
  const chunk = {
    id: 'chatcmpl-abc',
    object: 'chat.completion.chunk',
    model: 'gpt-4o-mini',
    choices: [],
    usage: { prompt_tokens: 1024, completion_tokens: 256, total_tokens: 1280 },
  }
  assertEquals(extractUsage(chunk), {
    prompt_tokens: 1024,
    output_tokens: 256,
    raw_source: 'openai',
  })
})

Deno.test('OpenAI: mid-stream delta chunk (no usage) → null', () => {
  const chunk = {
    id: 'chatcmpl-abc',
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: { content: 'Hello' }, finish_reason: null }],
  }
  assertEquals(extractUsage(chunk), null)
})

Deno.test('Anthropic: message_start → input_tokens (final) + output_tokens (initial)', () => {
  const chunk = {
    type: 'message_start',
    message: {
      id: 'msg_01',
      type: 'message',
      role: 'assistant',
      content: [],
      model: 'claude-haiku-4-5-20251001',
      stop_reason: null,
      usage: { input_tokens: 1500, output_tokens: 1 },
    },
  }
  assertEquals(extractUsage(chunk), {
    prompt_tokens: 1500,
    output_tokens: 1,
    raw_source: 'anthropic',
  })
})

Deno.test('Anthropic: message_delta → output_tokens only, prompt_tokens null', () => {
  const chunk = {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage: { output_tokens: 350 },
  }
  assertEquals(extractUsage(chunk), {
    prompt_tokens: null,
    output_tokens: 350,
    raw_source: 'anthropic',
  })
})

Deno.test('Anthropic: content_block_delta (no usage) → null', () => {
  const chunk = {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text: 'Hello' },
  }
  assertEquals(extractUsage(chunk), null)
})

Deno.test('Gemini: usageMetadata → both fields populated', () => {
  const chunk = {
    candidates: [{ content: { parts: [{ text: 'Hello' }], role: 'model' } }],
    usageMetadata: {
      promptTokenCount: 1500,
      candidatesTokenCount: 250,
      totalTokenCount: 1750,
    },
  }
  assertEquals(extractUsage(chunk), {
    prompt_tokens: 1500,
    output_tokens: 250,
    raw_source: 'gemini',
  })
})

Deno.test('OpenAI: usage with prompt_tokens but completion_tokens missing → output null, no throw', () => {
  const chunk = {
    object: 'chat.completion.chunk',
    choices: [],
    usage: { prompt_tokens: 1024 },
  }
  assertEquals(extractUsage(chunk), {
    prompt_tokens: 1024,
    output_tokens: null,
    raw_source: 'openai',
  })
})

Deno.test('Bad inputs: null / undefined / primitives / empty object → null, no throw', () => {
  assertEquals(extractUsage(null), null)
  assertEquals(extractUsage(undefined), null)
  assertEquals(extractUsage('string-not-object'), null)
  assertEquals(extractUsage(42), null)
  assertEquals(extractUsage([]), null)
  assertEquals(extractUsage({}), null)
  assertEquals(extractUsage({ usage: 'not-an-object' }), null)
})
