// chrome-extension/reader/lib/byok-health-check.ts
//
// Phase 12 PROVIDER-03 (D-C1 + D-C2): localhost-only health probe.
//
// Remote BYOK URLs are NOT checked — apiKey + CORS + quota make a useful
// status hard to compute; runtime errors during real agent runs surface
// the failure mode more clearly. Localhost is the one place where the
// user can self-correct (start the wrapper / LiteLLM) within seconds, so
// an explicit chip at save time is high-value UX.
//
// `isLocalhostURL` is exported so options/main.tsx can gate its on-save
// re-probe call without redefining the same hostname check (WARN-3 fix).
//
// DV-1 (cross-AI review iter 2): retry-once-on-failure with 200ms backoff.
// Resolves slow-machine concerns (1.5s too aggressive on cold-start under
// load) without contradicting the 1.5s acceptance baseline. Total
// worst-case wall time: 1.5s + 200ms + 1.5s = ~3.2s, still under the
// user-attention threshold.
//
// Mostly pure (checkBYOKHealth, isLocalhostURL); persistByokHealth is
// the one exception that imports storage-schema for the round-trip
// helper + maintains a module-level write queue (Phase 13 C-3
// race-safe). No supabase imports.

import { getItem, setItem } from './storage-schema';

export type HealthResult =
  | { status: 'healthy'; modelCount: number }
  | { status: 'unreachable'; error: string }
  | { status: 'unchecked' };

const TIMEOUT_MS = 1500;
const RETRY_BACKOFF_MS = 200;
const MAX_ATTEMPTS = 2;

export function isLocalhostURL(baseURL: string): boolean {
  try {
    const u = new URL(baseURL);
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

// DV-1 cross-AI review: minimal retry helper. We do NOT lift this from
// supabase/functions/_shared/tool-result.ts because that lives in Edge
// Function land (Deno) and crossing the boundary risks bundler issues.
// This is a 5-line client-side equivalent.
async function withRetryOnce<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS));
      }
    }
  }
  throw lastErr;
}

export async function checkBYOKHealth(baseURL: string): Promise<HealthResult> {
  if (!isLocalhostURL(baseURL)) {
    return { status: 'unchecked' };
  }

  // Build the /v1/models URL, normalizing trailing slash so we don't get
  // 'http://localhost:4000/v1//models'.
  const modelsURL = `${baseURL.replace(/\/+$/, '')}/models`;

  // DV-1: wrap fetch in retry-once helper. Both attempts get a fresh
  // AbortSignal.timeout(1500), so a transient cold-start delay on
  // attempt 1 does NOT consume the budget for attempt 2.
  let res: Response;
  try {
    res = await withRetryOnce(() =>
      fetch(modelsURL, { signal: AbortSignal.timeout(TIMEOUT_MS) }),
    );
  } catch (e) {
    const err = e as Error;
    return {
      status: 'unreachable',
      error: err.name === 'AbortError' || err.name === 'TimeoutError'
        ? `timeout after ${TIMEOUT_MS}ms (retry exhausted)`
        : err.message,
    };
  }

  if (!res.ok) {
    return { status: 'unreachable', error: `HTTP ${res.status}` };
  }

  // Best-effort modelCount. 200 alone is enough for "healthy" — body
  // parse failure should not flip the chip back to unreachable.
  let modelCount = 0;
  try {
    const body = await res.json();
    if (body && Array.isArray(body.data)) {
      modelCount = body.data.length;
    }
  } catch {
    modelCount = 0;
  }

  return { status: 'healthy', modelCount };
}

// ───────────────────────────────────────────────────────────────────
// Phase 13 (WARN-5 + C-3 race-safe): single round-trip helper consumed
// by both the top-bar BYOKChip (byok-chip.tsx) and the Options page
// (options/main.tsx). Lifts the persistence shape from
// options/main.tsx:194-216 into this pure module so all writers funnel
// through one path. 'unchecked' is a no-op (does not write) — same
// semantic as the inline copy.
//
// C-3 (cross-AI review consensus): three call sites can fire
// concurrently — chip mount probe, options mount probe, and saveConfig
// on-save probe. Each call does read-modify-write of byokHealthCache.
// Without serialization, two parallel reads of the same {} can race
// and the second writer overwrites the first writer's entry. Fix:
// module-level `pendingWrite` chained promise serializes every call;
// every persistByokHealth invocation appends to the chain and resolves
// when the underlying setItem returns.
// ───────────────────────────────────────────────────────────────────

type CacheEntry = {
  ts: number;
  healthy: boolean;
  modelCount?: number;
  reason?: string;
};

// C-3: module-level write queue. Every persistByokHealth call appends
// to this chain so the read-modify-write sequence cannot interleave
// across parallel callers. The chain is process-local (resets on SW
// restart, which is fine — no in-flight writes survive that anyway).
let pendingWrite: Promise<void> = Promise.resolve();

export function persistByokHealth(
  configId: string,
  result: HealthResult,
): Promise<void> {
  if (result.status === 'unchecked') {
    // No-op for unchecked; do NOT enqueue (avoid lengthening the chain
    // for a write that will be skipped anyway).
    return Promise.resolve();
  }
  pendingWrite = pendingWrite
    .then(async () => {
      const cache = ((await getItem('byokHealthCache')) ?? {}) as Record<string, CacheEntry>;
      const next: Record<string, CacheEntry> = { ...cache };
      if (result.status === 'healthy') {
        next[configId] = { ts: Date.now(), healthy: true, modelCount: result.modelCount };
      } else {
        // status === 'unreachable'
        next[configId] = { ts: Date.now(), healthy: false, reason: result.error };
      }
      await setItem('byokHealthCache', next);
    })
    .catch((e) => {
      // Swallow the error so a failed write does not poison the chain
      // for subsequent callers. Log for diagnostics.
      // eslint-disable-next-line no-console
      console.error('[persistByokHealth] write failed', e);
    });
  return pendingWrite;
}
