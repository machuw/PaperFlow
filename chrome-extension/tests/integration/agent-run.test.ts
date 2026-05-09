// chrome-extension/tests/integration/agent-run.test.ts
//
// Phase 10 integration tests — exercises the deployed /agent-run Edge Function
// against a local Supabase stack. Tests skip gracefully when the function is
// unreachable (mirrors stripe-webhook.spec.ts pattern).
//
// Each `it()` block names the AI-SPEC §5 Reference Dataset row it implements.
// Cases 4 (stopWhen probe), 5 (abort latency), and 7 (keepalive smoke — now
// diagnostic-only) ALWAYS pass — they RECORD observed behavior to console for
// the bug-archive (CONTEXT.md SC #3 / D-04). SC #4 (keepalive) has its strict
// assertion in chrome-extension/tests/keepalive-transform.test.ts (Plan 10-05
// Task 3).
//
// Test 1 (happy-path) ALSO asserts that ≥1 `[prepareStep] step` log line was
// captured during the request — this is the AGENT-03 wiring proof per
// CONTEXT.md In-scope line 14.

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'

import {
  SENTINEL_PFX,
  loadDevnoteEnv,
  agentRunsAdmin,
  agentRunReachable,
  parseFramesFromBody,
  messagesForcingContinuousToolCalls,
  DEV_PROBE_BODY_FLAG,
} from '../agent-runtime-fixtures'

const env = loadDevnoteEnv()
const admin = agentRunsAdmin(env)

async function signupAndLogin(email: string) {
  await admin.auth.admin.createUser({
    email,
    password: 'pw123456',
    email_confirm: true,
  })
  const client = createClient(env.SB_URL, env.SB_ANON)
  const { data } = await client.auth.signInWithPassword({ email, password: 'pw123456' })
  return { client, userId: data.user!.id, accessToken: data.session!.access_token }
}

const AGENT_RUN_URL = `${env.SB_URL}/functions/v1/agent-run`

async function postAgentRun(args: {
  accessToken?: string
  byokHeader?: string
  body: unknown
  signal?: AbortSignal
}): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (args.accessToken) headers['Authorization'] = `Bearer ${args.accessToken}`
  if (args.byokHeader) headers['X-BYOK-Authorization'] = args.byokHeader
  return fetch(AGENT_RUN_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(args.body),
    signal: args.signal,
  })
}

/**
 * Read the local supabase functions serve log file (if present) and return
 * its current contents. When `supabase functions serve` is run with stdout
 * redirected to a known file (developer convention or our test bootstrap), we
 * can scan it for the `[prepareStep] step` log line emitted by Plan 10-05's
 * streamText prepareStep no-op hook.
 *
 * Returns an empty string if the log file does not exist — the caller MUST
 * fall back to alternative capture (vi.spyOn console for in-process serve, or
 * skip the assertion with a clear message) rather than silently passing.
 */
function readEdgeFunctionLogs(): string {
  // Conventional log path for `supabase functions serve` redirect:
  //   supabase functions serve --env-file ./supabase/.env > /tmp/agent-run.log 2>&1
  const candidates = [
    '/tmp/agent-run.log',
    resolve(__dirname, '..', '..', '..', '.supabase', 'logs', 'agent-run.log'),
  ]
  for (const p of candidates) {
    if (existsSync(p)) {
      return readFileSync(p, 'utf8')
    }
  }
  return ''
}

describe('/agent-run integration', () => {
  it('1. happy-path streams text + tool frames + prepareStep observation', async () => {
    if (!(await agentRunReachable(env))) return
    const { accessToken, userId } = await signupAndLogin(`agent-${Date.now()}-1@example.test`)

    // Snapshot the pre-request log size so we can capture only this request's
    // emissions in the assertion below (avoids flakiness from prior tests).
    const logsBefore = readEdgeFunctionLogs()

    const res = await postAgentRun({
      accessToken,
      body: {
        messages: [
          {
            role: 'user',
            content: 'Search arXiv for "transformers attention" and report the first hit.',
          },
        ],
        ...DEV_PROBE_BODY_FLAG,
      },
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('X-Run-Id')).toBeTruthy()
    expect(res.body).not.toBeNull()

    const seen = new Set<string>()
    let toolCalls = 0
    for await (const f of parseFramesFromBody(res.body!)) {
      seen.add(f.type)
      if (f.type === 'tool-input-available') toolCalls++
      if (f.type === 'finish' || f.type === 'error') break
    }
    // toolCalls is recorded for diagnostic visibility (some prompts produce
    // text-only completions; both branches are valid happy paths).
    console.info('[happy-path] toolCalls =', toolCalls, 'frame-types =', [...seen].join(','))

    expect(seen.has('text-delta') || seen.has('tool-input-available')).toBe(true)
    expect(seen.has('finish')).toBe(true)

    const { data: row } = await admin
      .from('agent_runs')
      .select('status, step_count')
      .eq('user_id', userId)
      .order('started_at', { ascending: false })
      .limit(1)
      .single()
    expect(row?.status).toBe('done')
    expect(row?.step_count ?? 0).toBeGreaterThan(0)

    // AGENT-03 proof: assert that the `[prepareStep] step` log line was
    // emitted during this request. The log capture path depends on how
    // `supabase functions serve` was started — see readEdgeFunctionLogs for
    // candidate paths. The assertion is on the post-request log delta.
    const logsAfter = readEdgeFunctionLogs()
    const delta = logsAfter.slice(logsBefore.length)
    if (logsAfter.length === 0) {
      // Fallback: log file not present (serve was not run with stdout redirect).
      // Surface a clear actionable warning but do not silently pass — the test
      // executor must arrange log redirection. Use console.warn for visibility,
      // and fail with a descriptive message so the developer knows to start
      // serve with `> /tmp/agent-run.log 2>&1`.
      throw new Error(
        'AGENT-03 prepareStep capture failed: no log file at /tmp/agent-run.log nor .supabase/logs/agent-run.log. ' +
          'Restart `supabase functions serve` with stdout redirected: ' +
          '`supabase functions serve --env-file ./supabase/.env > /tmp/agent-run.log 2>&1`',
      )
    }
    expect(delta).toMatch(/\[prepareStep\] step/)
  }, 60_000)

  it('2. auth gate returns 401 without JWT', async () => {
    if (!(await agentRunReachable(env))) return
    const before =
      (await admin.from('agent_runs').select('id', { count: 'exact', head: true })).count ?? 0

    const res = await postAgentRun({
      body: { messages: [{ role: 'user', content: 'hi' }] },
    })
    expect(res.status).toBe(401)

    const after =
      (await admin.from('agent_runs').select('id', { count: 'exact', head: true })).count ?? 0
    expect(after).toBe(before) // no row created on auth failure
  })

  it('3. rate-limit returns 429 before audit row', async () => {
    if (!(await agentRunReachable(env))) return
    const { accessToken, userId } = await signupAndLogin(`agent-${Date.now()}-3@example.test`)

    // Phase 11 Plan 08 (D-D3 / Phase 10 follow-up c): serial bursts with 10ms
    // jitter so all 12 requests deterministically land inside the same 300s
    // rate-limit window. The previous Promise.all approach allowed the test
    // framework to reorder requests across windows on slow CI, occasionally
    // missing the 11th/12th requests' 429 trip.
    const results: Response[] = []
    for (let i = 0; i < 12; i++) {
      const r = await postAgentRun({
        accessToken,
        body: { messages: [{ role: 'user', content: 'ping' }] },
      })
      results.push(r)
      if (i < 11) await new Promise((res) => setTimeout(res, 10))
    }
    const statuses = results.map((r) => r.status)
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(1)

    const { count } = await admin
      .from('agent_runs')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
    expect(count ?? 0).toBeLessThanOrEqual(10)
  }, 30_000)

  it('4. stopWhen probe — record bug-archive evidence (SC #3)', async () => {
    // Record-only: we ALWAYS pass. The point is the console output lands in
    // the phase summary as #7502/#7683 evidence (D-04 bug-archive).
    if (!(await agentRunReachable(env))) return
    const { accessToken, userId } = await signupAndLogin(`agent-${Date.now()}-4@example.test`)

    // NOTE: This test relies on AGENT_RUN_MAX_STEPS being set to 3 in the
    // local Supabase env — the developer can override .env locally before
    // running this case. If MAX_STEPS != 3, we record the actual ceiling
    // observed and still pass.
    const res = await postAgentRun({
      accessToken,
      body: { messages: messagesForcingContinuousToolCalls(), ...DEV_PROBE_BODY_FLAG },
    })
    expect(res.status).toBe(200)

    // Drain the stream.
    for await (const _ of parseFramesFromBody(res.body!)) {
      /* drain */
    }

    const { data: row } = await admin
      .from('agent_runs')
      .select('step_count, finish_reason, status')
      .eq('user_id', userId)
      .order('started_at', { ascending: false })
      .limit(1)
      .single()

    console.info('[stopwhen-probe]', JSON.stringify(row))
    expect(row?.finish_reason).toBeDefined()
    // Diagnostic only: with MAX_STEPS=3, expect step_count<=3 + reason in known set.
    // 'tool-calls' is an AI SDK 5 finish reason that surfaces when the SDK
    // halts mid-loop with a pending tool call (not a hard stop).
    expect(['stop', 'max-steps-reached', 'error', 'aborted', 'tool-calls'])
      .toContain(row?.finish_reason ?? 'unknown')
  }, 120_000)

  it('5. abort propagation finalizes within 5s (SC #2)', async () => {
    if (!(await agentRunReachable(env))) return
    const { accessToken, userId } = await signupAndLogin(`agent-${Date.now()}-5@example.test`)

    const ctl = new AbortController()
    const t0 = Date.now()
    // Phase 11 Plan 08 (D-D2): per-stage timing markers narrow the slow path
    // among the 4 candidate root causes (CONTEXT D-D2 line 161). Stage labels
    // are written as static literals (not template-only) so static greps such
    // as the plan's verify clause `grep "abort-stage-1"` match this source.
    const elapsed = () => `+${Date.now() - t0}ms`
    console.info(`[abort-stage-1] req-fired-pre ${elapsed()}`)
    const res = await postAgentRun({
      accessToken,
      body: { messages: messagesForcingContinuousToolCalls(), ...DEV_PROBE_BODY_FLAG },
      signal: ctl.signal,
    }).catch((e) => {
      if ((e as Error).name === 'AbortError') return null
      throw e
    })
    console.info(`[abort-stage-1] req-fired-post ${elapsed()}`)

    if (res && res.body) {
      // Receive at least one frame, then abort.
      for await (const _ of parseFramesFromBody(res.body)) {
        console.info(`[abort-stage-2] first-frame ${elapsed()}`)
        ctl.abort()
        console.info(`[abort-stage-3] abort-fired ${elapsed()}`)
        break
      }
    }

    // Poll agent_runs for terminal status, up to 5s.
    const deadline = Date.now() + 5_000
    let row: { status?: string; finish_reason?: string } | null = null
    while (Date.now() < deadline) {
      const r = await admin
        .from('agent_runs')
        .select('status, finish_reason')
        .eq('user_id', userId)
        .order('started_at', { ascending: false })
        .limit(1)
        .single()
      row = r.data ?? null
      if (row?.status && row.status !== 'running') break
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    console.info(`[abort-stage-4] row-flipped ${elapsed()}`)
    const latency = Date.now() - t0
    console.info('[abort-probe] latency_ms =', latency, 'row =', JSON.stringify(row))
    expect(row?.status).toBe('aborted')
    // Phase 11 Plan 08 (D-D2 line 168): strict assertion. SC #2 invariant —
    // `expect(latency).toBeLessThan(5_000)` is HARD, not console-info-only.
    expect(latency).toBeLessThan(5_000)
  }, 30_000)

  it('6. BYOK isolation sentinel (D-02)', async () => {
    if (!(await agentRunReachable(env))) return
    const { accessToken, userId } = await signupAndLogin(`agent-${Date.now()}-6@example.test`)

    const sentinel = `${SENTINEL_PFX}${Date.now()}`
    const res = await postAgentRun({
      accessToken,
      byokHeader: `Bearer ${sentinel}`,
      body: {
        messages: [{ role: 'user', content: 'hi' }],
        baseURL: 'https://api.openai.com/v1',
      },
    })

    // Drain the response body — failure mode is fine; the sentinel must not
    // surface anywhere.
    let body = ''
    if (res.body) {
      const r = res.body.getReader()
      const dec = new TextDecoder()
      while (true) {
        const { value, done } = await r.read()
        if (done) break
        body += dec.decode(value, { stream: true })
      }
    }

    // (a) sentinel must not appear in response body
    expect(body.includes(sentinel)).toBe(false)

    // (b) sentinel must not appear in any agent_runs row column for this user
    const { data: rows } = await admin.from('agent_runs').select('*').eq('user_id', userId)
    for (const r of rows ?? []) {
      const blob = JSON.stringify(r)
      expect(blob.includes(sentinel)).toBe(false)
    }
    // (c) sentinel must not appear in response headers (defensive)
    for (const [k, v] of res.headers.entries()) {
      expect(`${k}:${v}`.includes(sentinel)).toBe(false)
    }
  }, 30_000)

  it('7. (diagnostic) keepalive frame observed during long task — non-assertive', async () => {
    // Diagnostic only — records observed keepalive frames under live SSE load.
    // SC #4 strict assertion lives in chrome-extension/tests/keepalive-transform.test.ts
    // (Plan 10-05 Task 3). This integration probe never fails on count.
    if (!(await agentRunReachable(env))) return
    const { accessToken } = await signupAndLogin(`agent-${Date.now()}-7@example.test`)

    const res = await postAgentRun({
      accessToken,
      body: {
        messages: [{ role: 'user', content: 'Take your time. Then search arXiv slowly.' }],
        ...DEV_PROBE_BODY_FLAG,
      },
    })
    expect(res.status).toBe(200)
    if (!res.body) return

    let keepaliveCount = 0
    const deadline = Date.now() + 30_000
    for await (const f of parseFramesFromBody(res.body)) {
      if (f.type === 'keepalive') keepaliveCount++
      if (Date.now() > deadline) break
      if (f.type === 'finish' || f.type === 'error') break
    }
    // DIAGNOSTIC ONLY — no expect() on keepaliveCount. SC #4 is enforced by
    // the unit test in chrome-extension/tests/keepalive-transform.test.ts.
    console.info('[keepalive-probe] count =', keepaliveCount)
  }, 60_000)

  it('8. agent-run/index.ts uses runAgent abstraction (D-A4 invariant)', () => {
    // Phase 11 Plan 08 (PATTERNS.md §23): assert the Edge Function shell
    // delegates the loop to `runAgent` from `_shared/runAgent.ts`. This is the
    // v1.5+ DIY swap-out invariant — replacing runAgent.ts implementation
    // should not require touching this file. No supabase functions serve
    // needed; this is a pure-source grep test (no `agentRunReachable` skip).
    const indexPath = resolve(__dirname, '../../../supabase/functions/agent-run/index.ts')
    const src = readFileSync(indexPath, 'utf-8')
    expect(src).toMatch(/import \{ runAgent \} from '\.\.\/_shared\/runAgent\.ts'/)
    // Negative: streamText must NOT be imported in the shell (moved to runAgent.ts).
    expect(src).not.toMatch(/import \{[^}]*streamText[^}]*\} from 'ai'/)
  })
})
