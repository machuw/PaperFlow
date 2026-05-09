-- Phase 10: agent_runs audit table (CONTEXT.md D-05).
-- Audit-only: every /agent-run request INSERTs status='running' on entry and UPDATEs
-- on exit. Service-role writes only (Edge Function); clients SELECT their own rows via RLS.
-- NOT added to the realtime publication — Path A architecture uses SSE as the
-- primary push channel; agent_runs exists for billing reconciliation and debug archive.

create table agent_runs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  status        text not null
    check (status in ('running','done','aborted','error')),
  step_count    int  not null default 0,
  total_tokens  int,
  finish_reason text,
  error_message text,                          -- redacted; never contains apiKey fragments (D-02)
  tier_at_call  text not null,
  byok          boolean not null default false
);
create index on agent_runs (user_id, started_at desc);

alter table agent_runs enable row level security;

-- Clients SELECT their own runs only. INSERT/UPDATE flow through service-role
-- from the Edge Function (no client write policy = default deny).
create policy "users see own agent_runs" on agent_runs
  for select using (auth.uid() = user_id);
