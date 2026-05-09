// supabase/functions/agent-run/keepalive.ts
//
// 25s SSE keepalive injection (AI-SPEC §4 Core Pattern Invariant #4;
// selection note §6.4). Intermediate proxies (e.g., Cloudflare) idle-cut
// connections after some threshold; a `:keepalive\n\n` SSE comment frame
// keeps the connection alive without affecting Data Stream Protocol parsing.
//
// SSE comment frames (lines starting with `:`) are silently swallowed by the
// EventSource parser AND by AI SDK 5's UI Stream Protocol parser, so they
// are safe to interleave with text-delta / tool-input-available / finish frames.
//
// Implementation: a TransformStream that does NOT touch upstream bytes — it
// only schedules a setInterval that enqueues the keepalive bytes alongside
// passing through whatever the SDK produces.

const KEEPALIVE_FRAME = new TextEncoder().encode(':keepalive\n\n')

/**
 * Build a TransformStream that:
 *   - On start, schedules a setInterval that enqueues `:keepalive\n\n` every
 *     `intervalMs` milliseconds.
 *   - On every chunk, passes the chunk through unchanged.
 *   - On flush (downstream done), clears the interval.
 *
 * Usage:
 *   const wrapped = result.body!.pipeThrough(createKeepaliveTransform(25_000))
 *   return new Response(wrapped, { headers, status })
 */
export function createKeepaliveTransform(intervalMs: number): TransformStream<Uint8Array, Uint8Array> {
  let timer: number | undefined

  return new TransformStream<Uint8Array, Uint8Array>({
    start(controller) {
      timer = setInterval(() => {
        try {
          controller.enqueue(KEEPALIVE_FRAME)
        } catch {
          // Stream already closed; clear the timer defensively.
          if (timer !== undefined) clearInterval(timer)
        }
      }, intervalMs) as unknown as number
    },
    transform(chunk, controller) {
      controller.enqueue(chunk)
    },
    flush() {
      if (timer !== undefined) clearInterval(timer)
    },
    // `cancel` is part of the Web Streams TransformStream spec but absent from
    // TypeScript's `Transformer<I,O>` interface. Cast the literal to bypass
    // TS2353 — runtime supports it (Deno Edge Function) and this handles the
    // upstream-cancellation path that `flush` does not cover.
    cancel() {
      if (timer !== undefined) clearInterval(timer)
    },
  } as Transformer<Uint8Array, Uint8Array> & {
    cancel?: () => void
  })
}
