-- 012_revert_byok_configs.sql
-- Revert Phase 12 byok_configs cloud sync per user product decision:
-- BYOK configs are local-only (chrome.storage.local). Cross-device sync only
-- covers papers/library/annotations/chat going forward.
-- See feedback memory: feedback_byok_local_only.md
-- Replaces 011_byok_configs.sql (kept in history for traceability).

-- 1. Remove from supabase_realtime publication.
--    ALTER PUBLICATION DROP TABLE has no IF EXISTS clause in Postgres,
--    so guard via pg_publication_tables for idempotency.
do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'byok_configs'
  ) then
    execute 'alter publication supabase_realtime drop table public.byok_configs';
  end if;
end $$;

-- 2. Drop the security-definer RPC
drop function if exists public.set_active_byok_config(uuid);

-- 3. Drop the table (CASCADE handles indexes/policies/triggers)
drop table if exists public.byok_configs cascade;
