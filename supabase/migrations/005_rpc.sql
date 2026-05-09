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
  v_limit  := case when v_tier = 'pro' then 300 else 20 end;

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

revoke all on function increment_ai_usage() from public;
grant  execute on function increment_ai_usage() to authenticated;

create or replace function rate_limit_check(
  p_max_count int default 10,
  p_window_sec int default 300
) returns boolean
language plpgsql security definer as $$
declare
  v_uid uuid := auth.uid();
  v_bucket timestamptz;
  v_count int;
begin
  if v_uid is null then raise exception 'unauthenticated'; end if;
  v_bucket := date_trunc('minute', now()) -
              (extract(minute from now())::int % (p_window_sec / 60)) * interval '1 minute';
  insert into rate_limits (user_id, window_start, count)
  values (v_uid, v_bucket, 1)
  on conflict (user_id, window_start) do update
    set count = rate_limits.count + 1
  returning count into v_count;
  if v_count > p_max_count then return false; end if;
  return true;
end $$;

revoke all on function rate_limit_check(int, int) from public;
grant  execute on function rate_limit_check(int, int) to authenticated;
