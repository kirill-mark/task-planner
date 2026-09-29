-- Раздел 7 ТЗ, «Планирование» и рабочий стол: настройки аккаунта, общие для
-- всех устройств. Значения по умолчанию сохраняют нынешнее поведение.
alter table user_settings add column if not exists workday_start time not null default '10:00';
alter table user_settings add column if not exists workday_end time not null default '19:00';
alter table user_settings add column if not exists buffer_minutes integer not null default 0;
alter table user_settings add column if not exists week_start smallint not null default 1;       -- 1 = понедельник, 7 = воскресенье
alter table user_settings add column if not exists new_task_date text not null default 'inbox';  -- без названной даты: inbox | today
-- Раскладка главной — отдельно для телефона и компьютера (раздел 5), с версией:
-- одновременная правка с двух устройств не должна молча стирать более свежую.
alter table user_settings add column if not exists home_layout jsonb;
alter table user_settings add column if not exists home_layout_version integer not null default 0;
-- «Фокус дня» — до трёх задач, выбранных пользователем на конкретный день.
alter table user_settings add column if not exists focus jsonb;

alter table user_settings drop constraint if exists user_settings_planning_check;
alter table user_settings add constraint user_settings_planning_check check (
  workday_end > workday_start
  and buffer_minutes between 0 and 120
  and week_start in (1, 7)
  and new_task_date in ('inbox', 'today')
);

-- Раскладка сохраняется только поверх той версии, от которой её меняли.
create or replace function mark_save_home_layout(p_layout jsonb, p_expected integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_version integer;
begin
  if v_user is null then
    raise exception 'unauthorized';
  end if;
  insert into user_settings (user_id) values (v_user) on conflict (user_id) do nothing;
  update user_settings
     set home_layout = p_layout, home_layout_version = home_layout_version + 1, updated_at = now()
   where user_id = v_user and home_layout_version = p_expected
  returning home_layout_version into v_version;
  if v_version is null then
    return jsonb_build_object('status', 'conflict',
      'layout', (select home_layout from user_settings where user_id = v_user),
      'version', (select home_layout_version from user_settings where user_id = v_user));
  end if;
  return jsonb_build_object('status', 'saved', 'version', v_version);
end;
$$;

revoke all on function mark_save_home_layout(jsonb, integer) from public, anon;
grant execute on function mark_save_home_layout(jsonb, integer) to authenticated;
