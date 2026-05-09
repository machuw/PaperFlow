-- Generic updated_at trigger factory
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger t_papers_updated_at        before update on papers        for each row execute function set_updated_at();
create trigger t_memory_updated_at        before update on memory        for each row execute function set_updated_at();
create trigger t_chat_updated_at          before update on chat          for each row execute function set_updated_at();
create trigger t_canvas_updated_at        before update on canvas        for each row execute function set_updated_at();
create trigger t_subscriptions_updated_at before update on subscriptions for each row execute function set_updated_at();
create trigger t_byok_prefs_updated_at    before update on byok_prefs    for each row execute function set_updated_at();

-- Auto-create subscriptions row when new user signs up (tier='free')
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.subscriptions (user_id, tier) values (new.id, 'free');
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
