-- Все существующие аккаунты переключены на новую модель (29.09.2026). Новые
-- начинают сразу в ней: иначе новичок попадал бы в planner_state, который для
-- всех остальных уже закрыт, а его устройства и бот — в разные модели.
--
-- legacy остаётся только как явное состояние после отката (mark_rollback_user).

create or replace function mark_mode(p_user uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select mode from mark_account_mode where user_id = p_user), 'v2');
$$;

revoke all on function mark_mode(uuid) from public, anon, authenticated;

-- Запись о режиме появляется вместе с аккаунтом, так что клиенты, читающие её
-- напрямую, видят то же, что и база.
create or replace function mark_account_mode_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.mark_account_mode (user_id, mode, epoch, note)
  values (new.id, 'v2', 1, 'new account')
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke all on function mark_account_mode_for_new_user() from public, anon, authenticated;

drop trigger if exists mark_account_mode_for_new_user on auth.users;
create trigger mark_account_mode_for_new_user after insert on auth.users
  for each row execute function mark_account_mode_for_new_user();
