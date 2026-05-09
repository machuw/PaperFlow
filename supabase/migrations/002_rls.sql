-- Own-rows policy applied identically to 8 user content + config tables
alter table papers enable row level security;
create policy "own rows" on papers for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table highlights enable row level security;
create policy "own rows" on highlights for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table margin_notes enable row level security;
create policy "own rows" on margin_notes for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table memory enable row level security;
create policy "own rows" on memory for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table chat enable row level security;
create policy "own rows" on chat for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table canvas enable row level security;
create policy "own rows" on canvas for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table subscriptions enable row level security;
create policy "own rows" on subscriptions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table byok_prefs enable row level security;
create policy "own rows" on byok_prefs for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ai_usage: client reads own; no client write (Edge Function service_role only)
alter table ai_usage enable row level security;
create policy "read own usage" on ai_usage for select
  using (user_id = auth.uid());

-- ai_usage_log and rate_limits: no client policy = default deny (service_role only)
alter table ai_usage_log enable row level security;
alter table rate_limits enable row level security;
