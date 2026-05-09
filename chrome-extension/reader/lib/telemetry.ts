// chrome-extension/reader/lib/telemetry.ts
//
// Quick task 260506-8ov — per-chat-request telemetry.
//
// Emits ONE `console.info('[pf-chat-telemetry]', payload)` per chat AI call so
// a developer running the extension locally can diagnose chat slowness in
// DevTools without adding deps, dashboards, or persistence. Production opt-in
// via `chrome.storage.local.set({'debug:chatTelemetry': true})`.
//
// Chat-only by construction: the helper is invoked only when callAI is called
// with kind === 'chat' AND opts.telemetry is provided. Selection actions
// (explain/summarize/translate), summary, and overview AI paths do NOT pass
// telemetry, so no record is composed for them.

import { getItem } from './storage-schema';

export interface ChatTelemetryRecord {
  ts: string;                  // new Date().toISOString()
  paperId: string | null;      // caller-supplied; effectivePaper.id ?? .urlHash
  sessionId: string | null;    // caller-supplied; chat session id
  query: string;               // last user message text, truncated to 500
  messages_count: number;      // messages.length passed to callChatCompletion / proxy
  system_chars: number;        // sum content.length where role === 'system'
  history_chars: number;       // sum content.length where role !== 'system' AND not the LAST user message
  user_chars: number;          // length of LAST user message (the new turn)
  total_chars: number;         // system + history + user
  est_input_tokens: number;    // Math.round(total_chars / 4)
  model: string;               // cfg.model (or managed model id)
  route: 'byok' | 'managed';   // caller-known
  ttft_ms: number | null;      // hi-res; null if no chunk arrived (timeout/error before first byte)
  total_stream_ms: number;     // hi-res; fetch invocation → stream end / abort / error
  output_chars: number;        // aggregated assistant content length
  status: 'ok' | 'error' | 'aborted';
  error?: string;              // err.message?.slice(0,200) on error/abort
}

export interface ChatTelemetryHookInput {
  paperId: string | null;
  sessionId: string | null;
  route: 'byok' | 'managed';
  /** Optional callback after the record is composed (used by tests). */
  onComplete?: (rec: ChatTelemetryRecord) => void;
}

/**
 * Walk the messages array once and produce per-message stats DERIVED FROM
 * THE MESSAGES AS SENT. Do NOT recompute from paper/history elsewhere — the
 * whole point is to measure exactly what the model received.
 *
 * `history_chars` excludes both the system message AND the LAST user message
 * (the new turn). On the first turn this is 0 by construction; on later turns
 * it grows by prior assistant.length + prior user.length.
 *
 * `query` is the last user message content, truncated to 500 chars.
 */
export function composeMessageStats(
  messages: Array<{ role: string; content: string }>,
): {
  messages_count: number;
  system_chars: number;
  history_chars: number;
  user_chars: number;
  total_chars: number;
  est_input_tokens: number;
  query: string;
} {
  let lastUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') { lastUserIndex = i; break; }
  }

  let system_chars = 0;
  let history_chars = 0;
  let user_chars = 0;

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const len = m.content.length;
    if (m.role === 'system') {
      system_chars += len;
    } else if (i === lastUserIndex) {
      user_chars = len;
    } else {
      history_chars += len;
    }
  }

  const total_chars = system_chars + history_chars + user_chars;
  const est_input_tokens = Math.round(total_chars / 4);
  const query = lastUserIndex >= 0 ? messages[lastUserIndex].content.slice(0, 500) : '';

  return {
    messages_count: messages.length,
    system_chars,
    history_chars,
    user_chars,
    total_chars,
    est_input_tokens,
    query,
  };
}

// Read the opt-in flag on every call. Flipping the storage flag should take
// effect on the next chat without an extension reload — the round-trip is
// ~0.5ms vs multi-second chats, so caching is not worth the UX surprise.
// `import.meta.env.DEV` is gated below it: Vite tree-shakes the always-true
// branch in prod builds, leaving only the storage path live.
export async function isChatTelemetryEnabled(): Promise<boolean> {
  if (import.meta.env.DEV) return true;
  try {
    const v = await getItem('debug:chatTelemetry');
    return v === true;
  } catch {
    return false;
  }
}

/**
 * Emit one `console.info('[pf-chat-telemetry]', rec)` line if the gate is on.
 * Swallow any error from console.info defensively (no-op).
 */
export async function logChatTelemetry(rec: ChatTelemetryRecord): Promise<void> {
  const enabled = await isChatTelemetryEnabled();
  if (!enabled) return;
  try {
    console.info('[pf-chat-telemetry]', rec);
  } catch {
    // never let a logging failure surface to chat callers
  }
}
