import { getUserFromRequest } from '../_shared/auth.ts'
import { json, errorResp } from '../_shared/responses.ts'
import { serviceRoleClient } from '../_shared/clients.ts'
import { MANAGED_MODELS, tierMeetsMin, type Tier } from '../_shared/managed-models.ts'
import { makeContentFilterDetector } from '../_shared/content-filter-detector.ts'
import { makeUsageCaptureTransform } from '../_shared/usage-capture-transform.ts'
// Phase 23 anchor (D-03): server 也以 _shared/types.ts 的 ProxyErrorCode
// 为类型 SoT 心智契约；当下 server 不消费此 type（reason 字段走独立 kebab-case
// 字符串，与 ProxyErrorCode 解耦 by Phase 21 design），未来若需对齐 reason
// 字段（v1.6+），import 链已就绪。Deno 默认不报告未使用 type-only import。
import type { ProxyErrorCode } from '../_shared/types.ts'

const OPENAI_KEY = Deno.env.get('OPENAI_API_KEY')!
const OPENAI_URL = Deno.env.get('OPENAI_BASE_URL')!
const OPENAI_MODEL = Deno.env.get('OPENAI_MODEL')!
// Fast-model fallback for kinds with long prompts where TTFT matters more than
// peak quality (chat embeds full paper + history → 5–15K tokens; Opus through
// newapi → Bedrock often exceeds the client's 30s inactivity watchdog). When
// unset, falls back to OPENAI_MODEL (no behavioral change).
const OPENAI_MODEL_FAST = Deno.env.get('OPENAI_MODEL_FAST') ?? OPENAI_MODEL
const FAST_KINDS = new Set(['chat', 'explain'])
const UPGRADE_URL = Deno.env.get('UPGRADE_URL')!
const NEWAPI_URL = Deno.env.get('NEWAPI_BASE_URL') ?? ''
const NEWAPI_KEY = Deno.env.get('NEWAPI_API_KEY') ?? ''

Deno.serve(async (req) => {
  const session = await getUserFromRequest(req)
  if (!session) return errorResp('Unauthorized', 401)
  const { user, client: supa } = session

  // Rate limit (§15.2)
  const { data: allowed } = await supa.rpc('rate_limit_check', {
    p_max_count: 10, p_window_sec: 300,
  })
  if (allowed === false) {
    return new Response(JSON.stringify({ reason: 'RATE_LIMITED' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': '60' },
    })
  }

  // Quota (§8.3)
  let newUsed: number
  try {
    const { data, error } = await supa.rpc('increment_ai_usage')
    if (error) {
      if (error.message.includes('sync tier')) return json({ reason: 'sync-tier-no-managed-ai' }, 403)
      return json({ error: 'quota-check-failed' }, 500)
    }
    newUsed = data as number
  } catch {
    return json({ error: 'quota-check-failed' }, 500)
  }

  if (newUsed === -1) {
    const { data: sub } = await supa.from('subscriptions').select('tier').eq('user_id', user.id).single()
    const tier = sub?.tier ?? 'free'
    const limit = tier === 'pro' ? 30000 : 20
    return json({ tier, used: limit, limit, upgrade_url: UPGRADE_URL }, 402)
  }

  const body = await req.json() as { kind?: string; model?: string; messages: unknown[] }

  // Phase 15 D-C4 + D-G3: provider routing.
  // (1) body.model present → MANAGED_MODELS whitelist + tier check + provider-mapped upstream.
  // (2) body.model absent → v1.1 fallback to OpenAI env (preserves Free-tier behavior).
  let upstreamURL: string
  let upstreamKey: string
  let upstreamModel: string

  if (body.model) {
    const m = MANAGED_MODELS.find((x) => x.id === body.model && x.enabled)
    if (!m) {
      return json({ reason: 'unknown-model' }, 400)
    }
    // T-15-01-T1 mitigation — server-side tier check is the load-bearing gate.
    const { data: subTier } = await supa.from('subscriptions').select('tier').eq('user_id', user.id).single()
    const userTier: Tier = (subTier?.tier as Tier) ?? 'free'
    if (!tierMeetsMin(userTier, m.min_tier)) {
      return json({
        reason: 'tier-locked',
        required_tier: m.min_tier,
        upgrade_url: UPGRADE_URL,
      }, 403)
    }
    if (m.provider === 'newapi') {
      if (!NEWAPI_URL || !NEWAPI_KEY) {
        return json({ reason: 'managed-provider-misconfigured' }, 500)
      }
      upstreamURL = NEWAPI_URL
      upstreamKey = NEWAPI_KEY
    } else {
      upstreamURL = OPENAI_URL
      upstreamKey = OPENAI_KEY
    }
    upstreamModel = m.upstream_model
  } else {
    // v1.1 fallback path. Per-kind model split: long-prompt kinds (chat,
    // explain) need fast TTFT, others can use the heavier default. When
    // OPENAI_MODEL_FAST is unset, this collapses to the original v1.1
    // single-model behavior.
    upstreamURL = OPENAI_URL
    upstreamKey = OPENAI_KEY
    upstreamModel = body.kind && FAST_KINDS.has(body.kind) ? OPENAI_MODEL_FAST : OPENAI_MODEL
  }

  const oaResp = await fetch(`${upstreamURL}/chat/completions`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${upstreamKey}`, 'Content-Type': 'application/json' },
    // Phase ai-cost-tier-pricing: stream_options.include_usage requests OpenAI's
    // final usage chunk. Anthropic / Gemini ignore unrecognised fields and emit
    // their own native usage shapes; usage-extractor handles all three.
    body: JSON.stringify({
      model: upstreamModel,
      messages: body.messages,
      stream: true,
      stream_options: { include_usage: true },
    }),
  })

  const admin = serviceRoleClient()
  const { data: sub } = await supa.from('subscriptions').select('tier').eq('user_id', user.id).single()
  // Phase ai-cost-tier-pricing: await insert + select id so usage-capture-transform
  // can update prompt_tokens/output_tokens on stream completion. Adds one DB
  // round-trip (~20-50ms) to streaming startup; this is the documented trade-off.
  const { data: logRow } = await admin
    .from('ai_usage_log')
    .insert({
      user_id: user.id, kind: body.kind, tier_at_call: sub?.tier ?? 'free', model: upstreamModel,
    })
    .select('id')
    .single<{ id: string }>()

  // Build response stream: content-filter (Quick 260507-cf) first, then usage capture.
  // Order matters: usage transform sees the post-content-filter stream so synthesised
  // error frames don't pollute parsing; content-filter detector itself is unchanged.
  let stream: ReadableStream<Uint8Array> = oaResp.body!.pipeThrough(makeContentFilterDetector())
  if (logRow?.id) {
    const logId = logRow.id
    stream = stream.pipeThrough(
      makeUsageCaptureTransform({
        update: (values) => admin.from('ai_usage_log').update(values).eq('id', logId),
        defer: (p) => {
          // Supabase Edge Runtime global; typed via globalThis cast (same pattern as
          // agent-run/index.ts:114) so deno check is happy.
          const er = (globalThis as { EdgeRuntime?: { waitUntil?: (p: PromiseLike<unknown>) => void } }).EdgeRuntime
          er?.waitUntil?.(p)
        },
      }),
    )
  }
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
})
