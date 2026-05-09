-- Phase 12: byok_configs N-row table (CONTEXT.md D-A1 + D-A4).
-- Promotes v1.1 byok_prefs (1-row per user) to multi-config (N-row per user).
-- apiKey stays in chrome.storage.local config_apikeys map (D-02 invariant);
-- this table only carries non-sensitive {name, base_url, model, is_active}.
-- Partial unique index enforces "exactly one active config per user" at DB
-- layer, eliminating client-side race; toggling active flows through
-- set_active_byok_config RPC (deactivate-others-then-activate-self txn).
-- RLS uses single FOR ALL policy per codebase convention (002_rls.sql:30-32).

create table byok_configs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  base_url    text not null,
  model       text not null,
  is_active   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- D-A4: at most one active config per user (DB-layer invariant).
create unique index byok_configs_one_active_per_user
  on byok_configs (user_id) where is_active = true;

-- D-A1: name uniqueness per user (prevents duplicate "Default" on cross-tab race).
create unique index byok_configs_unique_name_per_user
  on byok_configs (user_id, name);

-- Index for cross-tab listings ordered by creation time.
create index byok_configs_user_created on byok_configs (user_id, created_at);

alter table byok_configs enable row level security;

create policy "own rows" on byok_configs for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Reuse set_updated_at() function from 004_triggers.sql (do not redeclare).
create trigger t_byok_configs_updated_at before update on byok_configs
  for each row execute function set_updated_at();

-- Realtime publication: cross-tab sync (D-D2) + cross-device sync require this.
-- 010_agent_runs is intentionally NOT in the publication (audit-only); 011 IS.
alter publication supabase_realtime add table byok_configs;

-- D-A4: switch active config in a single transaction. Order matters —
-- deactivate-others FIRST, then activate-self — otherwise the partial unique
-- index transiently sees 2 active rows and rejects.
-- MED-2 hardening (cross-AI review iter 2):
--   * `set search_path = public, pg_temp` — security-definer best practice;
--     prevents search-path hijacking by a malicious schema entry.
--   * All references schema-qualified as `public.byok_configs` so the
--     function is robust regardless of the caller's search_path.
--   * Concurrent activation retry semantics: this function is functionally
--     idempotent (sets is_active to a TARGET id, not additive). If two
--     tabs race and one loses on the partial unique index, retrying with
--     the SAME id is safe; the loser will simply re-confirm the winner's
--     state (or take over if the winner already exited the txn).
create or replace function public.set_active_byok_config(p_config_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_rows int;
begin
  if v_uid is null then raise exception 'unauthenticated'; end if;

  update public.byok_configs set is_active = false
    where user_id = v_uid and is_active = true and id <> p_config_id;

  update public.byok_configs set is_active = true
    where id = p_config_id and user_id = v_uid;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'byok_config % not found for user %', p_config_id, v_uid;
  end if;
end $$;

revoke all on function public.set_active_byok_config(uuid) from public;
grant  execute on function public.set_active_byok_config(uuid) to authenticated;
