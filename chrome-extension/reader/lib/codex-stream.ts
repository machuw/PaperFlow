// chrome-extension/reader/lib/codex-stream.ts
//
// Slice 2 #9 — Codex backend protocol adapter.
// Encapsulates POST chatgpt.com/backend-api/codex/responses + SSE parsing +
// 401 self-heal. Interface mirrors streamBYOK so ai.ts can swap by sentinel.

import { getValidAccessToken, CodexReloginRequiredError } from './codex-auth';
import type { ChatMessage } from './ai';

const CODEX_RESPONSES_URL =
  'https://chatgpt.com/backend-api/codex/responses?client_version=0.42.0';

// Slice 3 #12: thrown when Codex returns a non-401 non-2xx — either OpenAI
// changed the API surface (404 model gone, 400 schema change) or the user's
// account doesn't have Codex access (403). UI surfaces this with a "switch
// BYOK provider" toast since re-login won't help.
export class CodexApiSurfaceChangedError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'CodexApiSurfaceChangedError';
  }
}

// PR #15 review fix: thrown when fetch itself rejects (offline, DNS, TLS,
// CORS preflight refused) — i.e. no Response object was ever produced.
// Without this, raw `TypeError: Failed to fetch` would slip past all five
// callAI catch sites' surfaceCodexError check and produce a useless
// "AI request failed: Failed to fetch" toast.
export class CodexNetworkError extends Error {
  constructor(public cause: unknown) {
    super(`codex-stream: network error — ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'CodexNetworkError';
  }
}

export async function streamCodexResponses(
  messages: ChatMessage[],
  signal: AbortSignal,
  onChunk: (chunk: string) => void,
): Promise<void> {
  // Codex Responses API takes the system prompt as a top-level `instructions`
  // field (not as a `role: 'system'` entry inside `input`). Concatenate any
  // system messages so the caller can pass an OpenAI chat-style array verbatim.
  const instructions = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  const input = messages.filter((m) => m.role !== 'system');
  const body = JSON.stringify({
    model:        'gpt-5.2',
    instructions: instructions || 'You are a helpful assistant.',
    input,
    store:        false,
    stream:       true,
  });

  // First attempt: use cached access_token. On 401 — access_token may be
  // stale even though our local exp check says fresh (e.g. server-side
  // revocation) — force-refresh once and retry. One shot only; a second 401
  // surfaces as the original error and the UI prompts re-login.
  const sendOnce = async (forceRefresh: boolean): Promise<Response> => {
    const accessToken = await getValidAccessToken({ forceRefresh });
    try {
      return await fetch(CODEX_RESPONSES_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'OpenAI-Beta':   'responses=experimental',
          'Content-Type':  'application/json',
        },
        body,
        signal,
      });
    } catch (err) {
      // Don't classify user-aborts as network errors — let them surface as
      // AbortError so callers' AbortError branches still hit. fetch's contract
      // is to throw a DOMException with name 'AbortError' when the signal fires.
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      if (err instanceof Error && err.name === 'AbortError') throw err;
      throw new CodexNetworkError(err);
    }
  };

  let res = await sendOnce(false);
  if (res.status === 401) {
    res = await sendOnce(true);
  }
  if (!res.ok) {
    // Slice 3 #12: surface a re-login signal when the retry still fails 401.
    // The reader UI listens for this to show a toast linking to Options
    // instead of leaking a raw status-code error string to the user.
    if (res.status === 401) {
      throw new CodexReloginRequiredError(
        'codex-stream: 401 after refresh — refresh_token likely revoked',
      );
    }
    const bodyText = await res.text().catch(() => '');
    // Slice 3 #12: every non-401 non-2xx is a surface change from PaperFlow's
    // point of view — Codex endpoint went 404/500, model id was rejected with
    // a 400, account isn't a Codex subscriber (403), etc. The remediation is
    // the same: tell the user to switch BYOK providers, since re-login won't
    // help. UI catches this and toasts accordingly.
    throw new CodexApiSurfaceChangedError(
      res.status,
      `codex-stream: ${res.status}${bodyText ? ` — ${bodyText.slice(0, 200)}` : ''}`,
    );
  }
  if (!res.body) return;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE frames are separated by a blank line; accept LF-LF + CRLF-CRLF.
      while (true) {
        const lf = buffer.indexOf('\n\n');
        const crlf = buffer.indexOf('\r\n\r\n');
        const pos = lf === -1 ? crlf : crlf === -1 ? lf : Math.min(lf, crlf);
        if (pos === -1) break;
        const sepLen = pos === crlf ? 4 : 2;
        const frame = buffer.slice(0, pos);
        buffer = buffer.slice(pos + sepLen);
        const dataLine = frame.split(/\r?\n/).find((l) => l.startsWith('data: '));
        if (!dataLine) continue;
        const payload = dataLine.slice(6).trim();
        if (payload === '[DONE]') return;
        try {
          const json = JSON.parse(payload);
          if (typeof json?.delta === 'string') onChunk(json.delta);
        } catch {
          // Malformed frame — skip silently.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
