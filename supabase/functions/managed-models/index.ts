// supabase/functions/managed-models/index.ts
//
// Phase 15 D-C2: GET /managed-models — returns tier-filtered model list
// with `locked` flag so UI can render row-with-Upgrade-CTA (D-D1) for
// users below min_tier. D-A2: anonymous users get 401, no list leakage.

import { getUserFromRequest } from '../_shared/auth.ts'
import { json, errorResp } from '../_shared/responses.ts'
import { MANAGED_MODELS, tierMeetsMin, type Tier } from '../_shared/managed-models.ts'

const UPGRADE_URL = Deno.env.get('UPGRADE_URL')!

Deno.serve(async (req) => {
  if (req.method !== 'GET') return errorResp('method-not-allowed', 405)

  const session = await getUserFromRequest(req)
  if (!session) return errorResp('Unauthorized', 401)
  const { user, client: supa } = session

  const { data: sub } = await supa
    .from('subscriptions')
    .select('tier')
    .eq('user_id', user.id)
    .single()
  const tier: Tier = (sub?.tier as Tier) ?? 'free'

  // D-D1: include locked rows so Free/Sync see them with Upgrade CTA.
  // D-C2: locked = userTier does NOT meet min_tier.
  const filtered = MANAGED_MODELS
    .filter((m) => m.enabled)
    .map((m) => ({
      id: m.id,
      display_name: m.display_name,
      min_tier: m.min_tier,
      provider: m.provider,
      upstream_model: m.upstream_model,
      locked: !tierMeetsMin(tier, m.min_tier),
    }))

  return json({ models: filtered, upgrade_url: UPGRADE_URL }, 200)
})
