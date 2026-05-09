import { createClient, SupabaseClient } from '@supabase/supabase-js'

const SB_URL = import.meta.env.VITE_SUPABASE_URL as string
const SB_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!SB_URL || !SB_ANON) {
  // Fail fast at module load rather than producing cryptic 401s downstream.
  // Local dev: copy chrome-extension/.env.local.example → .env.local and fill in
  // values from supabase/.env.local-devnote.md (see spec §4.2 Hybrid deployment).
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. See chrome-extension/.env.local.example')
}

/**
 * Chrome storage adapter for Supabase auth session persistence.
 * Supabase SDK defaults to window.localStorage — but extension service
 * workers have no localStorage, and reader/sw.js/options all need to
 * share the same session. chrome.storage.local is the common ground.
 */
const chromeStorage = {
  getItem:    async (k: string) => (await chrome.storage.local.get(k))[k] ?? null,
  setItem:    async (k: string, v: string) => { await chrome.storage.local.set({ [k]: v }) },
  removeItem: async (k: string) => { await chrome.storage.local.remove(k) },
}

// Single-flight guard so a burst of failing requests doesn't spawn parallel
// signOut() calls. Resets after the in-flight clear resolves so a *later*
// stale-session episode (e.g., user logs back in then their token rotates
// again) is still handled.
let clearInFlight: Promise<void> | null = null

/**
 * Drop the cached session from chrome.storage and emit SIGNED_OUT to
 * subscribers. Uses scope:'local' so we don't fire another network round-trip
 * (which would itself 401 with the same dead token). Safe to call from inside
 * a fetch interceptor — the local-only path doesn't go back through fetch.
 */
export function clearStaleSession(): Promise<void> {
  if (clearInFlight) return clearInFlight
  clearInFlight = (async () => {
    try {
      await supabase.auth.signOut({ scope: 'local' })
    } catch {
      // signOut failure here means the session was already gone; silent is fine.
    } finally {
      clearInFlight = null
    }
  })()
  return clearInFlight
}

/**
 * Pure decision: does this response status + URL mean "the cached bearer is
 * dead, drop the session"? Triggers on:
 *   - 401 anywhere → unambiguously stale auth (server rejected the bearer).
 *   - 403 from /auth/v1/* → GoTrue couldn't decode/verify the JWT (signing key
 *     rotated, project switched, etc.). RLS denials from /rest/v1 also return
 *     403 but those are policy outcomes, not stale auth — left alone.
 *
 * Exported so the unit test can pin the rule without booting a Supabase
 * client. The interceptingFetch below is the only production caller.
 */
export function isStaleSessionResponse(status: number, url: string): boolean {
  if (status === 401) return true
  if (status === 403 && url.includes('/auth/v1/')) return true
  return false
}

/**
 * Fetch wrapper that auto-clears the cached session when the server says the
 * token is dead. Without this, a session left over from a previous local-
 * supabase run keeps generating identical 401/403s on every paper open until
 * the user manually re-logs in.
 */
const interceptingFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init)
  const url = typeof input === 'string'
    ? input
    : input instanceof URL ? input.toString() : input.url
  if (isStaleSessionResponse(res.status, url)) void clearStaleSession()
  return res
}

/**
 * Auth lock override for chrome-extension contexts.
 *
 * Three same-origin contexts contend for the gotrue auth lock:
 *   - background/sw.ts (alarm-driven getSession every 30 min)
 *   - reader page (getSession + onAuthStateChange at boot)
 *   - options page (getSession + onAuthStateChange on mount)
 *
 * supabase-js's default `navigatorLock` aborts after 5s and emits
 *   "Lock 'lock:sb-…-auth-token' was not released within 5000ms"
 * before stealing the lock. That message is a console.warn, which Chrome
 * surfaces in chrome://extensions Errors — confusing users since the SDK
 * recovers fine. The 5s/steal recovery exists for browsers where Web Locks
 * may leak; Chromium MV3 reliably auto-releases held locks when the holding
 * context (SW or document) tears down, so the steal heuristic is unneeded.
 *
 * This wrapper coordinates the same set of contexts via navigator.locks but
 * drops the abort timer entirely.
 */
const chromiumLock = async <R>(
  name: string,
  _acquireTimeout: number,
  fn: () => Promise<R>,
): Promise<R> => {
  if (typeof navigator === 'undefined' || !navigator.locks) return await fn()
  return await navigator.locks.request(name, { mode: 'exclusive' }, async () => fn())
}

export const supabase: SupabaseClient = createClient(SB_URL, SB_ANON, {
  auth: {
    storage: chromeStorage,
    autoRefreshToken: true,
    persistSession: true,
    // launchWebAuthFlow returns the redirect URL directly; we parse it
    // manually in LoginModal (Task B6). Let SDK not re-parse window.location.
    detectSessionInUrl: false,
    lock: chromiumLock,
  },
  global: { fetch: interceptingFetch },
})
