// supabase/functions/_shared/tool-result.ts
//
// Tool authors return one of these three helpers from execute(). The
// discriminated union narrows downstream so callers can branch on
// `result.ok` without unsafe casts. Re-exports `ToolResult` from
// ./types.ts so server tools have a single import surface.
//
// CONTEXT D-B2: runAgent does NOT auto-retry transient errors — the tool
// is responsible. Use withRetry inside execute() to retry idempotent ops;
// catch the final exception and return transientError(...) so the
// SDK serializes the structured error into tool-output-available frame.

export type { ToolResult, ToolErrorKind } from './types.ts'
import type { ToolResult } from './types.ts'

export function success<T>(data: T): ToolResult<T> {
  return { ok: true, data }
}

/**
 * Tool encountered a transient failure (network error, 429 rate-limit,
 * timeout, etc.). After internal retry exhaustion, return this so
 * runAgent emits onEvent({type:'tool-error', kind:'transient'}) — but
 * does NOT push the error back to the model (D-B2). User sees the
 * failure as a UI trace card; model proceeds with no message contamination.
 */
export function transientError(reason: string, detail?: string): ToolResult<never> {
  return { ok: false, kind: 'transient', reason, detail }
}

/**
 * Tool encountered a logical / user-fixable error (bad input, resource
 * not found, semantic mismatch). The SDK serializes this into the
 * tool-output-available frame and the model sees `{ok:false, kind:'logical', reason}`
 * on the next turn (D-B3) → self-corrects without human intervention.
 */
export function logicalError(reason: string, detail?: string): ToolResult<never> {
  return { ok: false, kind: 'logical', reason, detail }
}

/**
 * Generic exponential-backoff retry. Tool authors wrap idempotent fetches
 * in withRetry; on exhaustion `withRetry` THROWS the last error — the
 * caller MUST catch in execute() and return transientError(...).
 *
 * Defaults: 2 attempts, 200ms initial backoff (linear scale: 200ms / 400ms).
 * Override via opts for slow APIs (e.g., Semantic Scholar = 1 req/s, use backoffMs >= 1100).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts?: { maxAttempts?: number; backoffMs?: number },
): Promise<T> {
  const max = opts?.maxAttempts ?? 2
  const backoff = opts?.backoffMs ?? 200
  let lastErr: unknown
  for (let i = 0; i < max; i++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      if (i < max - 1) {
        await new Promise((r) => setTimeout(r, backoff * (i + 1)))
      }
    }
  }
  throw lastErr
}
