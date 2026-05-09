-- Lock delete_topic_atomic: revoke EXECUTE from public/anon/authenticated,
-- grant only to service_role (called exclusively from the delete-topic Edge Function).
-- REVOKE/GRANT are DCL and cannot be sent as bare statements via the Supabase CLI
-- splitter in this version; wrapping in a DO $$ EXECUTE $$ block is the workaround.
do $$
begin
  execute 'revoke all on function delete_topic_atomic(uuid, uuid) from public';
  execute 'revoke all on function delete_topic_atomic(uuid, uuid) from anon';
  execute 'revoke all on function delete_topic_atomic(uuid, uuid) from authenticated';
  execute 'grant execute on function delete_topic_atomic(uuid, uuid) to service_role';
end $$;
