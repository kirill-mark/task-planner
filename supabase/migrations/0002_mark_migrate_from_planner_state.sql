-- Этап 1 ТЗ: перенос из planner_state в целевую модель.
--
-- Свойства, которых требует раздел 13:
--   * повтор безопасен: второй запуск не создаёт копий и не затирает данные,
--     появившиеся после первого (вставка идёт с on conflict do nothing);
--   * ничего не выбрасывается: повреждённые даты и потерянные связи переносятся
--     как есть, а проблема попадает в mark_migration_quarantine;
--   * пустая дата остаётся пустой — текущий день не подставляется;
--   * исходные значения сохраняются в legacy_metadata, включая происхождение
--     предположения о часовом поясе.
--
-- Функция считает один аккаунт и возвращает отчёт. planner_state не изменяется.

create or replace function mark_migrate_user(p_user uuid, p_version integer default 1)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_data        jsonb;
  v_updated     timestamptz;
  v_tz          text;
  v_run_id      bigint;
  v_item        jsonb;
  v_idx         integer;
  v_id          text;
  v_group       text;
  v_mode        text;
  v_date_raw    text;
  v_time_raw    text;
  v_date        date;
  v_time        time;
  v_created     timestamptz;
  v_quarantined integer := 0;
  v_sections    integer := 0;
  v_groups      integer := 0;
  v_tasks       integer := 0;
begin
  select data, updated_at into v_data, v_updated
  from planner_state where user_id = p_user;

  if v_data is null then
    return jsonb_build_object('user_id', p_user, 'status', 'no_source');
  end if;

  select timezone into v_tz from user_settings where user_id = p_user;

  insert into mark_migration_runs (version, user_id, source_updated_at, status)
  values (p_version, p_user, v_updated, 'running')
  returning id into v_run_id;

  -- ------------------------------------------------------------- разделы --
  v_idx := 0;
  for v_item in select * from jsonb_array_elements(coalesce(v_data->'sections', '[]'::jsonb)) loop
    v_id := v_item->>'id';
    if v_id is null or v_id = '' then
      insert into mark_migration_quarantine (user_id, kind, source_id, reason, payload)
      values (p_user, 'section', null, 'раздел без идентификатора', v_item);
      v_quarantined := v_quarantined + 1;
      continue;
    end if;

    insert into mark_sections (user_id, id, name, color, position, legacy_metadata)
    values (
      p_user, v_id,
      left(coalesce(nullif(v_item->>'name', ''), 'Без названия'), 80),
      coalesce(nullif(v_item->>'color', ''), '#7d8ca3'),
      v_idx,
      jsonb_build_object('source', 'planner_state', 'original', v_item)
    )
    on conflict (user_id, id) do nothing;

    if found then v_sections := v_sections + 1; end if;
    v_idx := v_idx + 1;
  end loop;

  -- -------------------------------------------------------------- группы --
  v_idx := 0;
  for v_item in select * from jsonb_array_elements(coalesce(v_data->'groups', '[]'::jsonb)) loop
    v_id := v_item->>'id';
    if v_id is null or v_id = '' then
      insert into mark_migration_quarantine (user_id, kind, source_id, reason, payload)
      values (p_user, 'group', null, 'группа без идентификатора', v_item);
      v_quarantined := v_quarantined + 1;
      continue;
    end if;

    -- Ссылка на несуществующий раздел не отменяет перенос группы: она
    -- переносится без раздела, а факт попадает в карантин.
    v_group := v_item->>'sectionId';
    if v_group is not null and not exists (
      select 1 from mark_sections s where s.user_id = p_user and s.id = v_group
    ) then
      insert into mark_migration_quarantine (user_id, kind, source_id, reason, payload)
      values (p_user, 'group', v_id, 'ссылка на несуществующий раздел: ' || v_group, v_item);
      v_quarantined := v_quarantined + 1;
      v_group := null;
    end if;

    insert into mark_groups (user_id, id, section_id, name, color, position, legacy_metadata)
    values (
      p_user, v_id, v_group,
      left(coalesce(nullif(v_item->>'name', ''), 'Без названия'), 80),
      coalesce(nullif(v_item->>'color', ''), '#5b8def'),
      v_idx,
      jsonb_build_object('source', 'planner_state', 'original', v_item)
    )
    on conflict (user_id, id) do nothing;

    if found then v_groups := v_groups + 1; end if;
    v_idx := v_idx + 1;
  end loop;

  -- -------------------------------------------------------------- задачи --
  v_idx := 0;
  for v_item in select * from jsonb_array_elements(coalesce(v_data->'tasks', '[]'::jsonb)) loop
    v_id := v_item->>'id';
    if v_id is null or v_id = '' then
      insert into mark_migration_quarantine (user_id, kind, source_id, reason, payload)
      values (p_user, 'task', null, 'задача без идентификатора', v_item);
      v_quarantined := v_quarantined + 1;
      continue;
    end if;

    v_group := v_item->>'groupId';
    if v_group is not null and not exists (
      select 1 from mark_groups g where g.user_id = p_user and g.id = v_group
    ) then
      insert into mark_migration_quarantine (user_id, kind, source_id, reason, payload)
      values (p_user, 'task', v_id, 'ссылка на несуществующую группу: ' || v_group, v_item);
      v_quarantined := v_quarantined + 1;
      v_group := null;
    end if;

    -- дата и время: пустое остаётся пустым, кривое — в карантин, но задача
    -- всё равно переносится
    v_date_raw := nullif(v_item->>'date', '');
    v_time_raw := nullif(v_item->>'time', '');
    v_date := null;
    v_time := null;

    if v_date_raw is not null then
      begin
        v_date := v_date_raw::date;
      exception when others then
        insert into mark_migration_quarantine (user_id, kind, source_id, reason, payload)
        values (p_user, 'task', v_id, 'нераспознанная дата: ' || v_date_raw, v_item);
        v_quarantined := v_quarantined + 1;
      end;
    end if;

    if v_time_raw is not null and v_date is not null then
      begin
        v_time := v_time_raw::time;
      exception when others then
        insert into mark_migration_quarantine (user_id, kind, source_id, reason, payload)
        values (p_user, 'task', v_id, 'нераспознанное время: ' || v_time_raw, v_item);
        v_quarantined := v_quarantined + 1;
      end;
    elsif v_time_raw is not null and v_date is null then
      -- время без даты по ТЗ требует уточнения, молча сохранять его нельзя
      insert into mark_migration_quarantine (user_id, kind, source_id, reason, payload)
      values (p_user, 'task', v_id, 'время без даты: ' || v_time_raw, v_item);
      v_quarantined := v_quarantined + 1;
    end if;

    v_mode := coalesce(nullif(v_item->>'dateMode', ''), 'due');

    begin
      v_created := to_timestamp((v_item->>'createdAt')::bigint / 1000.0);
    exception when others then
      v_created := now();
    end;

    insert into mark_tasks (
      user_id, id, group_id, title, notes,
      planned_date, planned_time, due_date, due_time,
      timezone, completed, position, created_at, updated_at, legacy_metadata
    )
    values (
      p_user, v_id, v_group,
      left(coalesce(nullif(v_item->>'title', ''), 'Без названия'), 200),
      coalesce(v_item->>'notes', ''),
      case when v_mode = 'on'  then v_date end,
      case when v_mode = 'on'  then v_time end,
      case when v_mode <> 'on' then v_date end,
      case when v_mode <> 'on' then v_time end,
      -- пояс аккаунта применяется только к событию со временем, и факт
      -- предположения фиксируется рядом
      case when v_time is not null then v_tz end,
      coalesce((v_item->>'completed')::boolean, false),
      v_idx,
      v_created,
      v_created,
      jsonb_build_object(
        'source', 'planner_state',
        'original', v_item,
        'date_mode', v_mode,
        'timezone_origin', case when v_time is not null then 'assumed_from_account_settings' else 'not_applicable' end,
        -- выполненность сохраняется, но момент завершения старая модель не
        -- хранила: выдумывать его нельзя
        'completed_at_known', false
      )
    )
    on conflict (user_id, id) do nothing;

    if found then v_tasks := v_tasks + 1; end if;
    v_idx := v_idx + 1;
  end loop;

  update mark_migration_runs
  set finished_at = now(),
      status = 'done',
      counts = jsonb_build_object(
        'sections_inserted', v_sections,
        'groups_inserted', v_groups,
        'tasks_inserted', v_tasks,
        'quarantined', v_quarantined
      )
  where id = v_run_id;

  return jsonb_build_object(
    'user_id', p_user,
    'status', 'done',
    'run_id', v_run_id,
    'sections_inserted', v_sections,
    'groups_inserted', v_groups,
    'tasks_inserted', v_tasks,
    'quarantined', v_quarantined
  );
end;
$$;

-- Сверка: приводим перенесённое обратно к старому виду и сравниваем с
-- источником. Совпадения общих количеств недостаточно — сверяются сами
-- идентификаторы и значения полей.
create or replace function mark_verify_user(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_data     jsonb;
  v_src      jsonb;
  v_dst      jsonb;
  v_missing  jsonb;
  v_diff     jsonb;
begin
  select data into v_data from planner_state where user_id = p_user;
  if v_data is null then
    return jsonb_build_object('user_id', p_user, 'status', 'no_source');
  end if;

  -- исходные задачи, приведённые к сравнимому виду
  select jsonb_object_agg(t->>'id', jsonb_build_object(
           'title', left(coalesce(nullif(t->>'title',''), 'Без названия'), 200),
           'notes', coalesce(t->>'notes', ''),
           'date', nullif(t->>'date',''),
           'time', nullif(t->>'time',''),
           'mode', coalesce(nullif(t->>'dateMode',''), 'due'),
           'completed', coalesce((t->>'completed')::boolean, false),
           'group', t->>'groupId'
         ))
  into v_src
  from jsonb_array_elements(coalesce(v_data->'tasks','[]'::jsonb)) t
  where t->>'id' is not null;

  -- перенесённые задачи, приведённые к тому же виду
  select jsonb_object_agg(id, jsonb_build_object(
           'title', title,
           'notes', notes,
           'date', to_char(coalesce(planned_date, due_date), 'YYYY-MM-DD'),
           'time', to_char(coalesce(planned_time, due_time), 'HH24:MI'),
           'mode', case when planned_date is not null then 'on' else 'due' end,
           'completed', completed,
           'group', group_id
         ))
  into v_dst
  from mark_tasks
  where user_id = p_user and deleted_at is null;

  v_src := coalesce(v_src, '{}'::jsonb);
  v_dst := coalesce(v_dst, '{}'::jsonb);

  -- что не доехало
  select coalesce(jsonb_agg(k), '[]'::jsonb) into v_missing
  from jsonb_object_keys(v_src) k
  where not v_dst ? k;

  -- что доехало с другими значениями
  select coalesce(jsonb_agg(jsonb_build_object('id', k, 'source', v_src->k, 'migrated', v_dst->k)), '[]'::jsonb)
  into v_diff
  from jsonb_object_keys(v_src) k
  where v_dst ? k and v_src->k is distinct from v_dst->k;

  return jsonb_build_object(
    'user_id', p_user,
    'source_tasks', (select count(*) from jsonb_object_keys(v_src)),
    'migrated_tasks', (select count(*) from jsonb_object_keys(v_dst)),
    'source_sections', jsonb_array_length(coalesce(v_data->'sections','[]'::jsonb)),
    'migrated_sections', (select count(*) from mark_sections where user_id = p_user and deleted_at is null),
    'source_groups', jsonb_array_length(coalesce(v_data->'groups','[]'::jsonb)),
    'migrated_groups', (select count(*) from mark_groups where user_id = p_user and deleted_at is null),
    'missing', v_missing,
    'mismatched', v_diff,
    'quarantined', (select count(*) from mark_migration_quarantine where user_id = p_user)
  );
end;
$$;

revoke all on function mark_migrate_user(uuid, integer) from public, anon, authenticated;
revoke all on function mark_verify_user(uuid) from public, anon, authenticated;
