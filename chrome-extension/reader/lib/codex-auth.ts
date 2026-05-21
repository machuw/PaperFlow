// chrome-extension/reader/lib/codex-auth.ts
//
// OpenAI Codex BYOK preset — OAuth Device Code Flow + token lifecycle.
// PRD #7 / Slice 1 #8.

import { getItem, removeItem, setItem } from './storage-schema';
import { CODEX_DEFAULT_MODEL } from './byok-presets';

const CODEX_OAUTH_TOKEN_URL = 'https://auth.openai.com/oauth/token';
const CODEX_DEVICE_AUTH_USERCODE_URL = 'https://auth.openai.com/api/accounts/deviceauth/usercode';
const CODEX_DEVICE_AUTH_TOKEN_URL = 'https://auth.openai.com/api/accounts/deviceauth/token';
const CODEX_DEVICE_AUTH_PAGE_URL = 'https://auth.openai.com/codex/device';
const CODEX_DEVICE_REDIRECT_URI = 'https://auth.openai.com/deviceauth/callback';
const CODEX_MODELS_URL =
  'https://chatgpt.com/backend-api/codex/models?client_version=0.42.0';
// Codex CLI's OAuth client_id — the only viable identity per Phase 0 spike
// (OpenAI does not allow third-party registration). See PRD #7.
const CODEX_OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';

// Thrown when the stored refresh_token has been server-side revoked
// (OAuth `invalid_grant`). UI catches this to flip to a "re-login" state.
export class CodexReloginRequiredError extends Error {
  constructor(message = 'codex-auth: refresh_token revoked, re-login required') {
    super(message);
    this.name = 'CodexReloginRequiredError';
  }
}

// Refresh a few seconds early so a network round-trip can't land on the
// server side past expiry, forcing an avoidable 401 self-heal round-trip.
const ACCESS_TOKEN_SKEW_MS = 60_000;

export async function getValidAccessToken(opts: { forceRefresh?: boolean } = {}): Promise<string> {
  const tokens = await getItem('codex_auth_tokens');
  if (!tokens) throw new Error('codex-auth: not logged in');
  if (!opts.forceRefresh && Date.now() < tokens.expires_at - ACCESS_TOKEN_SKEW_MS) return tokens.access_token;

  const resp = await fetch(CODEX_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: CODEX_OAUTH_CLIENT_ID,
    }).toString(),
  });
  const body = await resp.json();
  if (!resp.ok) {
    if (body?.error === 'invalid_grant') {
      await removeItem('codex_auth_tokens');
      await removeItem('codex_auth_user');
      throw new CodexReloginRequiredError();
    }
    throw new Error(`codex-auth: refresh failed (${resp.status})`);
  }
  const newTokens = {
    access_token:  body.access_token,
    refresh_token: body.refresh_token,
    id_token:      body.id_token,
    expires_at:    Date.now() + body.expires_in * 1000,
    token_type:    'bearer' as const,
  };
  await setItem('codex_auth_tokens', newTokens);
  // ADR-0002: refresh is the natural pulse-check moment to re-discover the
  // model list. Fire-and-forget on this path so a slow /codex/models RTT does
  // not lengthen the 401 self-heal in codex-stream (which already awaits the
  // refresh response to get back to its retry POST). The discovery has no
  // ordering dependency on the AI call — only the picker UI consumes it.
  void refreshAvailableModels(newTokens.access_token);
  return newTokens.access_token;
}

export interface LoginStartResult {
  deviceAuthId: string;
  userCode:     string;
  intervalMs:   number;
  expiresAtMs:  number;
}

export async function loginStart(): Promise<LoginStartResult> {
  const resp = await fetch(CODEX_DEVICE_AUTH_USERCODE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CODEX_OAUTH_CLIENT_ID }),
  });
  if (!resp.ok) {
    throw new Error(`codex-auth: device-flow start failed (${resp.status})`);
  }
  const body = await resp.json();
  // The server returns interval as a string (per Phase 0 spike); parse defensively.
  const intervalSec = Math.max(parseInt(String(body.interval), 10) || 5, 3);
  // Defensive: new Date('garbage').getTime() returns NaN, which would make
  // `Date.now() < NaN` immediately false and the polling loop exit on first
  // tick before ever calling the token endpoint. Fall back to a 10-minute
  // ceiling so a malformed server response degrades to a still-usable flow.
  const expiresAtMs = new Date(body.expires_at).getTime();
  const safeExpiresAtMs = Number.isFinite(expiresAtMs)
    ? expiresAtMs
    : Date.now() + 10 * 60_000;
  // Open the device-code page WITH user_code prefilled so the user doesn't
  // have to paste it manually. Per spec §15.1 the auth.openai.com/codex/device
  // page accepts a `user_code` query param and skips its prompt step.
  const pageUrl = `${CODEX_DEVICE_AUTH_PAGE_URL}?user_code=${encodeURIComponent(body.user_code)}`;
  await chrome.tabs.create({ url: pageUrl, active: true });
  return {
    deviceAuthId: body.device_auth_id,
    userCode:     body.user_code,
    intervalMs:   intervalSec * 1000,
    expiresAtMs:  safeExpiresAtMs,
  };
}

export interface LoginPollArgs {
  deviceAuthId: string;
  userCode:     string;
  intervalMs:   number;
  expiresAtMs:  number;
}

export async function loginPoll(args: LoginPollArgs, signal?: AbortSignal): Promise<void> {
  let authorized: { authorization_code: string; code_verifier: string } | null = null;
  while (Date.now() < args.expiresAtMs) {
    signal?.throwIfAborted();
    await sleep(args.intervalMs, signal);
    signal?.throwIfAborted();
    const resp = await fetch(CODEX_DEVICE_AUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_auth_id: args.deviceAuthId,
        user_code:      args.userCode,
      }),
      signal,
    });
    if (resp.status === 200) {
      authorized = await resp.json();
      break;
    }
    if (resp.status === 403 || resp.status === 404 || resp.status === 400) {
      continue;
    }
    throw new Error(`codex-auth: device flow polling unexpected status ${resp.status}`);
  }
  if (!authorized) throw new Error('codex-auth: device flow timed out before authorization');

  // Exchange authorization_code (+ server-issued code_verifier) for tokens.
  const exchange = await fetch(CODEX_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'authorization_code',
      code:          authorized.authorization_code,
      redirect_uri:  CODEX_DEVICE_REDIRECT_URI,
      client_id:     CODEX_OAUTH_CLIENT_ID,
      code_verifier: authorized.code_verifier,
    }).toString(),
  });
  if (!exchange.ok) {
    throw new Error(`codex-auth: token exchange failed (${exchange.status})`);
  }
  const body = await exchange.json();
  await setItem('codex_auth_tokens', {
    access_token:  body.access_token,
    refresh_token: body.refresh_token,
    id_token:      body.id_token,
    expires_at:    Date.now() + body.expires_in * 1000,
    token_type:    'bearer',
  });
  if (body.id_token) {
    const payload = decodeJwtPayload(body.id_token);
    if (payload?.email && typeof payload.email === 'string') {
      await setItem('codex_auth_user', { email: payload.email });
    }
  }
  // ADR-0002: discover the live model list and cache it. Discovery failures
  // must NOT fail login — fall back to [CODEX_DEFAULT_MODEL] so the UI still
  // has a usable model id.
  await refreshAvailableModels(body.access_token);
}

// Fetch + persist the available-models list, swallowing errors with a
// [CODEX_DEFAULT_MODEL] fallback per ADR-0002. Called opportunistically after
// login (loginPoll) and after refresh (getValidAccessToken — fire-and-forget).
// PR #26 re-review LOW: the whole body is wrapped in try/catch — `setItem`
// can reject (storage quota, extension context invalidated mid-refresh) and
// the void'd refresh caller has no surrounding catch to swallow that.
//
// Slice 3 #25: after persisting, call reconcileActiveCodexModel so a stale
// stored cfg.model (model removed by OpenAI / tier downgrade) is auto-reset
// and the user sees a one-shot "switched to X" toast. Reconcile is itself
// best-effort; failures don't poison the discovery write.
async function refreshAvailableModels(accessToken: string): Promise<void> {
  try {
    let models: string[];
    try {
      models = await fetchCodexModels(accessToken);
      if (models.length === 0) models = [CODEX_DEFAULT_MODEL];
    } catch {
      models = [CODEX_DEFAULT_MODEL];
    }
    await setItem('codex_available_models', models);
    // Late import breaks a real module-init cycle:
    //   codex-auth → codex-model-reconcile → toast-helpers → codex-auth
    // (toast-helpers re-imports `CodexReloginRequiredError` from this file.)
    // A static import here would evaluate toast-helpers before
    // CodexReloginRequiredError is exported, leaving toast-helpers'
    // binding `undefined` and breaking `surfaceCodexError`'s instanceof
    // check at runtime. Do NOT inline this import. The module loader
    // caches the result after the first call so the runtime cost is one
    // microtask per refresh, not per call.
    const { reconcileActiveCodexModel } = await import('./codex-model-reconcile');
    await reconcileActiveCodexModel(models);
  } catch {
    // Best-effort discovery — never throw out of this function.
  }
}

// Sleep that aborts cleanly if the AbortSignal fires mid-wait. Used by the
// device flow polling loop so a user-clicked "Cancel" snaps out of the
// inter-poll wait instead of hanging until the next interval boundary.
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    const t = setTimeout(resolve, ms);
    if (signal) {
      const onAbort = () => {
        clearTimeout(t);
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

// Decode without verifying the JWT signature. Use ONLY for display purposes
// (e.g. showing the logged-in email in the BYOK panel) — NEVER gate
// authorization on payload claims. The token's authority is the server's
// signature, which we do not check here.
function decodeJwtPayload(jwt: string): any {
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;
  const b64url = parts[1];
  // base64url → base64 with padding
  const padded = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padding = (4 - (padded.length % 4)) % 4;
  try {
    return JSON.parse(atob(padded + '='.repeat(padding)));
  } catch {
    return null;
  }
}

export async function getCurrentUser(): Promise<{ email: string } | null> {
  return (await getItem('codex_auth_user')) ?? null;
}

// Discover the set of model ids this ChatGPT subscription has access to.
// Called opportunistically after token exchange / refresh (see ADR-0002) so
// the BYOK MODEL picker always reflects the live tier — never hardcoded.
//
// Response shape verified against openai/codex source
// (codex-rs/codex-api/src/endpoint/models.rs + protocol/src/openai_models.rs):
//   { "models": [{ "slug": "<id>", "display_name": "...", ... }] }
// `slug` is the wire identifier the responses endpoint expects in `body.model`.
// v0.2.1 read `body.data[].id` (mistakenly mirroring the OpenAI public API
// shape) and silently fell back to [CODEX_DEFAULT_MODEL] for every user.
// Legacy `id` is also accepted so the parser tolerates the public-API shape
// if the same code is ever pointed at api.openai.com.
export async function fetchCodexModels(accessToken: string): Promise<string[]> {
  const resp = await fetch(CODEX_MODELS_URL, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'OpenAI-Beta':   'responses=experimental',
    },
  });
  if (!resp.ok) throw new Error(`codex-auth: fetchCodexModels failed (${resp.status})`);
  const body = await resp.json();
  const rows = (body?.models ?? body?.data ?? []) as unknown[];
  // Defensive: only keep entries with a string slug (or legacy id). Drop
  // anything malformed so no `undefined` slips into codex_available_models
  // and round-trips as the literal "undefined" wire value.
  return rows.flatMap((m: unknown) => {
    if (!m || typeof m !== 'object') return [];
    const slug = (m as { slug?: unknown }).slug;
    const id = (m as { id?: unknown }).id;
    if (typeof slug === 'string') return [slug];
    if (typeof id === 'string') return [id];
    return [];
  });
}

export async function logout(): Promise<void> {
  await removeItem('codex_auth_tokens');
  await removeItem('codex_auth_user');
  await removeItem('codex_available_models');
}
