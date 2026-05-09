// Phase ai-cost-tier-pricing — TransformStream that captures token usage from
// an in-flight SSE response and writes it back to ai_usage_log on completion.
//
// Pass-through guarantee: every upstream byte is forwarded verbatim. Only side
// effect is a fire-and-forget UPDATE to the row identified by `logId`.
//
// SSE parsing: chunks may split frames mid-line. We buffer decoded text and
// only consume complete lines (split on `\n`). The last partial line stays in
// the buffer for the next chunk; `flush()` drains it.
//
// Anthropic emits a two-shot usage signal:
//   - message_start carries final input_tokens (and an early output_tokens=1)
//   - message_delta carries the running output_tokens; LAST value is final
// Our extractor returns null for fields it has no signal for, and we track
// last-non-null per field independently so the final UPDATE has both correct.
//
// Logging failure must NEVER break the stream — every error path is caught.

import { extractUsage } from './usage-extractor.ts'

export interface UsageUpdateDeps {
  /** Performs the partial update on ai_usage_log. Caller binds row id. */
  update: (values: { prompt_tokens?: number; output_tokens?: number }) => PromiseLike<unknown>
  /** Defers the update past response close — typically `EdgeRuntime.waitUntil`. */
  defer: (p: PromiseLike<unknown>) => void
}

export function makeUsageCaptureTransform(
  deps: UsageUpdateDeps,
): TransformStream<Uint8Array, Uint8Array> {
  const dec = new TextDecoder()
  let buf = ''
  let lastPrompt: number | null = null
  let lastOutput: number | null = null

  const consumeLine = (line: string): void => {
    // SSE frames are `data: <json>` (other event types like `event: foo` are ignored).
    if (!line.startsWith('data:')) return
    const payload = line.slice(5).trimStart()
    if (!payload || payload === '[DONE]') return
    let parsed: unknown
    try {
      parsed = JSON.parse(payload)
    } catch {
      // Half-formed JSON or comment line — ignore and let next chunk flush proper data.
      return
    }
    const u = extractUsage(parsed)
    if (!u) return
    if (u.prompt_tokens !== null) lastPrompt = u.prompt_tokens
    if (u.output_tokens !== null) lastOutput = u.output_tokens
  }

  const consumeBuffer = (final: boolean): void => {
    const lines = buf.split('\n')
    // If not final, last element may be a partial line — keep it for next chunk.
    buf = final ? '' : (lines.pop() ?? '')
    for (const line of lines) consumeLine(line)
    if (final && buf) {
      consumeLine(buf)
      buf = ''
    }
  }

  // Track last value we've fired to the DB so we don't re-write identical state.
  let firedPrompt: number | null = null
  let firedOutput: number | null = null

  // fireIfChanged — invoked from both transform() and flush() to absorb the
  // dev/prod runtime difference (`supabase functions serve` doesn't reliably
  // run/await TransformStream.flush; production Edge Runtime does). Calling
  // from transform() guarantees correctness in dev. Calling from flush() is
  // a final safety net plus the right place for production's deferred write.
  //
  // Anthropic two-shot consideration: message_start sets prompt+output(=1),
  // subsequent message_delta updates output. firing on every change means
  // we get ~2-3 writes/stream for Anthropic (acceptable). Gemini emits
  // usageMetadata on every chunk (10-50 writes/stream); accept this in v1
  // and revisit only if it shows up in DB load profiles.
  const fireIfChanged = async (): Promise<void> => {
    if (lastPrompt === firedPrompt && lastOutput === firedOutput) return
    if (lastPrompt === null && lastOutput === null) return
    firedPrompt = lastPrompt
    firedOutput = lastOutput
    const values: { prompt_tokens?: number; output_tokens?: number } = {}
    if (lastPrompt !== null) values.prompt_tokens = lastPrompt
    if (lastOutput !== null) values.output_tokens = lastOutput
    try {
      await Promise.resolve(deps.update(values))
    } catch {
      // Logging failure must never break the stream.
    }
  }

  return new TransformStream({
    async transform(chunk, controller) {
      controller.enqueue(chunk) // pass-through first, ALWAYS
      try {
        buf += dec.decode(chunk, { stream: true })
        consumeBuffer(false)
      } catch {
        // Decode/parse failure must not kill the stream.
      }
      await fireIfChanged()
    },
    async flush() {
      try {
        buf += dec.decode()
        consumeBuffer(true)
      } catch {
        // ignore
      }
      await fireIfChanged()
      // Production-only: schedule a no-op via defer so the runtime sees a
      // waitUntil registration (some Edge Runtime versions log a warning if
      // a streaming function returns without one). Real work is already done
      // above via await. In tests / dev with no EdgeRuntime, this is harmless.
      try {
        deps.defer(Promise.resolve())
      } catch {
        // EdgeRuntime.waitUntil is sync-throwing in some shapes — never propagate.
      }
    },
  })
}
