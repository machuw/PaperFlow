-- 014_ai_usage_log_model_idx.sql
--
-- Phase ai-cost-tier-pricing: speed up monthly per-model aggregation queries
-- run by `scripts/ai-cost-analysis.mjs` against real production data once
-- `ai-proxy` starts populating prompt_tokens / output_tokens (T5).
--
-- Existing index: ai_usage_log (user_id, created_at desc) from 001_tables.sql:101
--   covers per-user reads — different access pattern, kept as-is.
--
-- This index covers (model, created_at desc) for analyst-style queries like
--   select model, sum(prompt_tokens), sum(output_tokens), count(*)
--   from ai_usage_log
--   where created_at >= now() - interval '30 days'
--   group by model;
--
-- Local/dev: plain create index (table is empty/small).
-- Production: ops should switch to `create index concurrently` if/when this
-- migration is replayed against a populated table — out of scope for this phase.

create index if not exists ai_usage_log_model_created_idx
  on ai_usage_log (model, created_at desc);
