// supabase/functions/_shared/types.ts
//
// Cross-boundary type contracts shared between Edge Function (Deno) and
// Chrome extension client (Vite/TS). Per CONTEXT D-B4 line 117: client
// tools import these types via relative path — no monorepo, no copies.
//
// Three unions live here:
//   1. ToolResult<T>  — every tool's execute() return shape (D-B1).
//   2. RunAgentEvent  — the public contract emitted by runAgent.onEvent
//                       (D-A3 lines 56-64 verbatim). This is THE most
//                       important Phase 11 design output — locking this
//                       shape is what makes the v1.5+ DIY 逃生口 viable
//                       (CONTEXT line 281).
//   3. ProxyErrorCode — [NEW Phase 23] discriminated union surfaced by
//                       client `callAI` (managed proxy) + `streamBYOK`
//                       (BYOK validation). Server anchors import here as SoT.

export type ToolErrorKind = 'transient' | 'logical'

/**
 * Discriminated union for every tool's execute() return value.
 *
 * - { ok: true, data }              — success path, data has the tool-specific shape
 * - { ok: false, kind: 'transient', reason } — runAgent emits onEvent('tool-error', kind:'transient'), does NOT push back to model (D-B2)
 * - { ok: false, kind: 'logical', reason }   — runAgent emits onEvent + SDK serializes into tool-output-available frame so model self-corrects (D-B3)
 */
export type ToolResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: ToolErrorKind; reason: string; detail?: string }

/**
 * Public event contract emitted by runAgent.onEvent. Consumers (UI/dev menu)
 * type-narrow on `type`. Verbatim from CONTEXT.md D-A3 lines 56-64.
 *
 * Phase 12 Plan 05 (MED-6 cross-AI review iter 2): extended with a distinct
 * `config-error` variant for pre-tool-call config issues (e.g. user has no
 * active BYOK config). Avoids overloading `tool-error` with empty
 * toolCallId/toolName. Non-breaking: existing consumers type-narrow on `type`
 * and ignore unknown variants gracefully.
 */
export type RunAgentEvent =
  | { type: 'step-start'; stepNumber: number }
  | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }
  | { type: 'tool-result'; toolCallId: string; toolName: string; output: unknown }
  | { type: 'tool-error'; toolCallId: string; toolName: string; kind: ToolErrorKind; reason: string; detail?: string }
  | { type: 'step-finish'; stepNumber: number; finishReason: string }
  | { type: 'finish'; totalTokens?: number; finishReason: string }
  // MED-6 (cross-AI review iter 2): distinct event for pre-tool-call config
  // errors. Phase 12 emits `no-active-config` from agent-client when no BYOK
  // config is set up; future kinds (e.g. `invalid-config` for malformed
  // baseURL) can extend this union without breaking existing consumers.
  | { type: 'config-error'; kind: 'no-active-config' | 'invalid-config'; reason: string; detail?: string }

/**
 * Discriminated union of error codes surfaced by `callAI` (managed proxy)
 * and `streamBYOK` (BYOK validation). 9 SCREAMING_SNAKE_CASE codes for
 * proxy errors (Phase 21 D-E3 convention) + 1 orthogonal `byok-misconfigured`
 * for local BYOK config failure (kept unchanged per Phase 21 CONTEXT
 * correction #4 — orthogonal to proxy taxonomy).
 *
 * NEW codes added in Phase 21 to support Phase 15 managed-models tier check:
 *   - TIER_LOCKED      — model requires higher tier than user has
 *   - MODEL_NOT_FOUND  — model id not in MANAGED_MODELS registry
 *
 * Phase 23: relocated from chrome-extension/reader/lib/ai.ts to this SoT;
 * client + server now both import from here. Adding a new code = 1 file edit.
 */
export type ProxyErrorCode =
  | 'QUOTA_EXCEEDED'        // payload {tier, used, limit, upgrade_url} — Pro quota used
  | 'TIER_NO_MANAGED_AI'    // payload server reason — Sync/Free tier has no managed AI
  | 'RATE_LIMITED'          // empty payload — too many requests in window
  | 'UNAUTHENTICATED'       // empty payload — no session / expired token
  | 'SERVER_ERROR'          // empty payload — 5xx upstream
  | 'TIMEOUT'               // empty payload — inactivity watchdog (30s no chunks)
  | 'UNKNOWN'               // empty payload — fallback for non-mapped status codes
  | 'TIER_LOCKED'           // NEW Phase 21 — Phase 15 tier whitelist reject
  | 'MODEL_NOT_FOUND'       // NEW Phase 21 — Phase 15 registry miss
  | 'byok-misconfigured';   // KEEP-AS-IS (orthogonal; Phase 21 CONTEXT correction #4)
