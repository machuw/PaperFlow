// supabase/functions/_shared/managed-models.ts
//
// Phase 15 D-C1 + D-C4: hardcoded registry, single source of truth for
// both `managed-models/index.ts` (GET filter) and `ai-proxy/index.ts`
// (POST whitelist enforcement). v1.5+ may migrate to Postgres `managed_models`
// table behind admin UI; v1.3 ships hardcoded.
//
// 2026-05-07: switched from claude-opus-4-7 to claude-haiku-4-5-20251001
// after Bedrock guardrails on opus repeatedly tripped on long paper context
// (see Quick 260507-cf for the content_filter SSE evidence). Pro tier still
// gates managed AI per the existing pricing model — only the model id moved.

export type Tier = 'free' | 'sync' | 'pro';

export interface ManagedModel {
  id: string;
  display_name: string;
  provider: 'newapi' | 'openai';
  upstream_model: string;
  min_tier: Tier;
  enabled: boolean;
}

export const MANAGED_MODELS: readonly ManagedModel[] = [
  {
    id: 'claude-haiku-4-5-20251001',
    display_name: 'claude-4.5-haiku',
    provider: 'newapi',
    upstream_model: 'claude-haiku-4-5-20251001',
    min_tier: 'pro',
    enabled: true,
  },
] as const;

const TIER_RANK: Record<Tier, number> = { free: 0, sync: 1, pro: 2 };

/**
 * Returns true iff `userTier` meets-or-exceeds `requiredTier`.
 * Pro >= Sync >= Free. Used by both GET filter (locked flag) and ai-proxy
 * whitelist enforcement (T-15-01-T1 mitigation).
 */
export function tierMeetsMin(userTier: Tier, requiredTier: Tier): boolean {
  return TIER_RANK[userTier] >= TIER_RANK[requiredTier];
}
