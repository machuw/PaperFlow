-- 013_pro_quota_30k.sql
--
-- Hotfix: bump Pro tier monthly limit 300 → 30000 inside the
-- `increment_ai_usage` RPC. Companion to commit d6d31ef which already
-- updated the 6 client/edge sites; this migration is the missing
-- server-side enforcement piece.
--
-- The full quota model (free/sync/pro limits, period kind, managed-AI
-- enablement) will be lifted into a `plans` config table in v1.5
-- (see `.planning/seeds/v1.5-tier-policy-table.md`). Until then we keep
-- the case-when shape of 005_rpc.sql; the only change is the literal.

create or replace function increment_ai_usage()
returns int
language plpgsql security definer as $$
declare
  v_uid    uuid := auth.uid();
  v_tier   text;
  v_period text;
  v_limit  int;
  v_used   int;
begin
  if v_uid is null then raise exception 'unauthenticated'; end if;

  select tier into v_tier from subscriptions where user_id = v_uid;
  if v_tier is null then v_tier := 'free'; end if;

  if v_tier = 'sync' then
    raise exception 'sync tier has no managed ai';
  end if;

  v_period := case when v_tier = 'pro'
              then to_char(now() at time zone 'utc', 'YYYY-MM')
              else 'lifetime-trial' end;
  v_limit  := case when v_tier = 'pro' then 30000 else 20 end;

  insert into ai_usage (user_id, period, used)
  values (v_uid, v_period, 0)
  on conflict (user_id, period) do nothing;

  select used into v_used from ai_usage
  where user_id = v_uid and period = v_period for update;

  if v_used >= v_limit then return -1; end if;

  update ai_usage set used = used + 1
  where user_id = v_uid and period = v_period;

  return v_used + 1;
end $$;
