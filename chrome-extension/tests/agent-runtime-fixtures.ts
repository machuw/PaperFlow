// LOCATION-LOCKED: this file MUST stay at chrome-extension/tests/ (sibling to
// integration/) — path resolution depends on it. Specifically, the devnote path
// resolves with 2 `..` segments from this file's `__dirname` to reach the repo
// root's `supabase/.env.local-devnote.md`. Moving this file (e.g. into
// integration/) silently changes the resolved path AND Vitest ESM behavior
// for `__dirname` may differ from CommonJS — both reasons to keep the file
// pinned here. The existsSync() guard below converts any future relocation
// from a confusing readFileSync ENOENT into an actionable error.
//
// chrome-extension/tests/agent-runtime-fixtures.ts
//
// Shared fixtures + helpers for Phase 10 integration tests. Centralizes:
//   - devnote env loading (factored from rpc.spec.ts pattern)
//   - SSE Data Stream Protocol frame iteration
//   - SENTINEL_PFX for the BYOK isolation probe (D-02)
//   - Message factories that exercise specific runtime paths

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient, SupabaseClient } from '@supabase/supabase-js'

// ESM-safe __dirname shim. Vitest provides __dirname for free in CJS, but tsx
// runs this file in ESM mode (package.json "type": "module") for the Phase 14
// eval runner — where __dirname is undefined unless we derive it from
// import.meta.url. Vitest still works because the shim returns the same path
// the CJS auto-globals would have.
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/**
 * Sentinel prefix for the BYOK isolation probe (AI-SPEC §5 dataset row 7).
 * Must be unique enough to be detectable in any logs / DB rows / response
 * bodies if it ever escapes the request lifetime.
 */
export const SENTINEL_PFX = 'SENTINEL_KEY_PFX_'

export type Frame = {
  type: string
  toolCallId?: string
  toolName?: string
  input?: unknown
  output?: unknown
  delta?: string
  finishReason?: string
  errorText?: string
  [k: string]: unknown
}

export type DevnoteEnv = {
  SB_URL: string
  SB_ANON: string
  SB_SERVICE: string
}

export function loadDevnoteEnv(): DevnoteEnv {
  // 2 `..` segments from chrome-extension/tests/ → repo root → supabase/.env.local-devnote.md
  // If this file is ever moved (especially into integration/, which would need
  // 3 `..` segments), this resolved path becomes wrong; the existsSync guard
  // below converts that failure mode from a confusing ENOENT into a clear
  // location-locked violation message.
  const devnotePath = resolve(__dirname, '..', '..', 'supabase', '.env.local-devnote.md')
  if (!existsSync(devnotePath)) {
    throw new Error(
      `fixture path resolved to ${devnotePath} — verify tests/ vs tests/integration/ location ` +
        `(LOCATION-LOCKED rule: agent-runtime-fixtures.ts must stay at chrome-extension/tests/)`,
    )
  }
  const devnote = readFileSync(devnotePath, 'utf8')
  const extract = (rx: RegExp) => {
    const m = devnote.match(rx)
    if (!m) throw new Error(`devnote missing ${rx}`)
    return m[1].trim()
  }
  return {
    SB_URL: extract(/SB_URL=(.+)/),
    SB_ANON: extract(/SB_ANON=(.+)/),
    SB_SERVICE: extract(/SB_SERVICE=(.+)/),
  }
}

export function agentRunsAdmin(env: DevnoteEnv = loadDevnoteEnv()): SupabaseClient {
  return createClient(env.SB_URL, env.SB_SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/**
 * Iterates Data Stream Protocol frames from a streaming response body.
 * Comment frames (`:keepalive\n\n`) are surfaced as `{ type: 'keepalive' }`
 * synthetic frames so tests can count them (AGENT-06).
 */
export async function* parseFramesFromBody(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<Frame, void, void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) return
    buffer += decoder.decode(value, { stream: true })

    while (true) {
      const lf = buffer.indexOf('\n\n')
      const crlf = buffer.indexOf('\r\n\r\n')
      let pos: number
      let len: number
      if (lf === -1 && crlf === -1) break
      if (lf === -1) {
        pos = crlf
        len = 4
      } else if (crlf === -1) {
        pos = lf
        len = 2
      } else if (crlf < lf) {
        pos = crlf
        len = 4
      } else {
        pos = lf
        len = 2
      }

      const frameStr = buffer.slice(0, pos)
      buffer = buffer.slice(pos + len)

      if (frameStr.startsWith(':')) {
        yield { type: 'keepalive', raw: frameStr } as Frame
        continue
      }

      const dataLine = frameStr.split(/\r?\n/).find((l) => l.startsWith('data: '))
      if (!dataLine) continue
      const payload = dataLine.slice(6).trim()
      if (payload === '[DONE]') return

      try {
        yield JSON.parse(payload) as Frame
      } catch {
        // ignore non-JSON frames (defensive)
      }
    }
  }
}

/**
 * System prompt + user message designed to induce continuous tool calls.
 * Used by the stopWhen probe (SC #3) to force the loop into >3 steps so the
 * step ceiling is exercised.
 */
export function messagesForcingContinuousToolCalls() {
  return [
    {
      role: 'system' as const,
      content:
        'You MUST call searchArxiv repeatedly with progressively narrower queries until you find an exact match. ' +
        'Do not stop after the first result — always issue at least 5 follow-up searches.',
    },
    {
      role: 'user' as const,
      content:
        'Find the seminal paper on attention mechanisms by Vaswani et al. Search arXiv aggressively until you locate it.',
    },
  ]
}

/** Plan 06 dev-menu probe flag — used by smart-sampling and by tests to mark dev runs. */
export const DEV_PROBE_BODY_FLAG = { dev_probe: true }

/** Function-reachable probe — graceful skip when local Supabase is down. */
export async function agentRunReachable(env: DevnoteEnv): Promise<boolean> {
  try {
    const r = await fetch(`${env.SB_URL}/functions/v1/agent-run`, {
      method: 'POST',
      body: 'probe',
    })
    // Phase 11 Plan 08 (VERIFICATION.md non-blocking finding #1):
    // 404 means the function isn't being served — the developer needs to start
    // `supabase functions serve agent-run`. Treat as unreachable so the test
    // gracefully skips instead of running against a route that will never
    // produce real agent_runs rows.
    if (r.status === 404) return false
    return r.status < 500
  } catch {
    return false
  }
}
