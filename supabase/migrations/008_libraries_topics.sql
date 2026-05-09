-- supabase/migrations/006_libraries_topics.sql

create table libraries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade default auth.uid(),
  name        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, name)
);
create index libraries_user_created_idx on libraries (user_id, created_at);

create table topics (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade default auth.uid(),
  name        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, name)
);
create index topics_user_created_idx on topics (user_id, created_at);

alter table papers drop column topic;
alter table papers
  add column library_id uuid references libraries(id) on delete set null,
  add column topic_ids  uuid[] not null default '{}';
create index papers_user_library_idx on papers (user_id, library_id);
create index papers_topic_ids_gin   on papers using gin (topic_ids);

alter table libraries enable row level security;
create policy "user owns libraries" on libraries
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table topics enable row level security;
create policy "user owns topics" on topics
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create trigger libraries_updated_at before update on libraries
  for each row execute function set_updated_at();
create trigger topics_updated_at before update on topics
  for each row execute function set_updated_at();

-- Atomic delete: catalog row + array_remove on all this user's papers in one tx.
-- service_role bypasses RLS; public cannot call this (security definer, no public grant).
create or replace function delete_topic_atomic(p_topic_id uuid, p_user_id uuid)
returns void
language plpgsql security definer as $func$
begin
  update papers
    set topic_ids = array_remove(topic_ids, p_topic_id)
    where user_id = p_user_id and topic_ids @> array[p_topic_id];
  delete from topics where id = p_topic_id and user_id = p_user_id;
end $func$;
