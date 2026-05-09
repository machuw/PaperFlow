// Phase ai-cost-tier-pricing — extract token usage from a single SSE chunk.
//
// Three providers, three usage shapes:
//
//   OpenAI (chat.completion.chunk, requires stream_options.include_usage):
//     final chunk has `usage: { prompt_tokens, completion_tokens, total_tokens }`
//     and an empty `choices` array. Mid-stream chunks have no `usage` field.
//
//   Anthropic (messages stream): two-shot.
//     `message_start` carries `message.usage.input_tokens` (final) AND
//                              `message.usage.output_tokens` (initial, ~1).
//     `message_delta`  carries `usage.output_tokens` (running total; LAST
//                              such value is final).
//     Other event types (content_block_*, message_stop) carry no usage.
//
//   Gemini (generateContent stream):
//     every chunk carries `usageMetadata: { promptTokenCount,
//     candidatesTokenCount, totalTokenCount }`. Last chunk's values are final.
//
// Strategy: this function returns a PARTIAL update per chunk (each field may
// be null, meaning "no signal for this field in this chunk"). The consumer
// (usage-capture-transform) merges by tracking the last non-null value for
// each field independently — that handles Anthropic's two-shot cleanly.
//
// Hard rule: never throw on bad input. Streaming pipeline must not break.

export type UsageSource = 'openai' | 'anthropic' | 'gemini';

export interface ChunkUsage {
  prompt_tokens: number | null;
  output_tokens: number | null;
  raw_source: UsageSource;
}

export function extractUsage(chunk: unknown): ChunkUsage | null {
  if (!chunk || typeof chunk !== 'object') return null;
  const c = chunk as Record<string, unknown>;

  // OpenAI: top-level `usage` with prompt_tokens + completion_tokens
  const usageObj = c.usage;
  if (usageObj && typeof usageObj === 'object') {
    const u = usageObj as Record<string, unknown>;

    if (typeof u.prompt_tokens === 'number') {
      return {
        prompt_tokens: u.prompt_tokens,
        output_tokens: typeof u.completion_tokens === 'number' ? u.completion_tokens : null,
        raw_source: 'openai',
      };
    }

    // Anthropic message_delta: usage has output_tokens only (running total).
    // Use type discriminator to disambiguate from a hypothetical OpenAI shape
    // where only completion_tokens is present.
    if (c.type === 'message_delta' && typeof u.output_tokens === 'number') {
      return {
        prompt_tokens: null,
        output_tokens: u.output_tokens,
        raw_source: 'anthropic',
      };
    }

    // Anthropic non-streaming or rare standalone usage block: input_tokens present.
    if (typeof u.input_tokens === 'number') {
      return {
        prompt_tokens: u.input_tokens,
        output_tokens: typeof u.output_tokens === 'number' ? u.output_tokens : null,
        raw_source: 'anthropic',
      };
    }
  }

  // Anthropic message_start: usage nested under message.
  if (c.type === 'message_start' && c.message && typeof c.message === 'object') {
    const msg = c.message as Record<string, unknown>;
    const mu = msg.usage;
    if (mu && typeof mu === 'object') {
      const u = mu as Record<string, unknown>;
      const input = typeof u.input_tokens === 'number' ? u.input_tokens : null;
      const output = typeof u.output_tokens === 'number' ? u.output_tokens : null;
      if (input !== null || output !== null) {
        return { prompt_tokens: input, output_tokens: output, raw_source: 'anthropic' };
      }
    }
  }

  // Gemini: usageMetadata at top level.
  const meta = c.usageMetadata;
  if (meta && typeof meta === 'object') {
    const u = meta as Record<string, unknown>;
    return {
      prompt_tokens: typeof u.promptTokenCount === 'number' ? u.promptTokenCount : null,
      output_tokens: typeof u.candidatesTokenCount === 'number' ? u.candidatesTokenCount : null,
      raw_source: 'gemini',
    };
  }

  return null;
}
