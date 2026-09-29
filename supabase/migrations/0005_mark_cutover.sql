-- Раздел 13 ТЗ, «Производственное переключение» и «Откат» — по одному аккаунту.
--
-- Модель аккаунта хранится на сервере, а не на устройстве: веб, PWA, Mini App,
-- бот и напоминания одного человека обязаны работать с одной и той же моделью,
-- иначе задача из бота не появится на компьютере.
--
--   legacy — источник истины planner_state; запись в новую модель закрыта;
--   v2     — источник истины новая модель; запись в planner_state закрыта
--            самой базой, в том числе для серверных обработчиков, поэтому
--            старая вкладка или старая версия бота не могут её перезаписать (A08).

create table if not exists mark_account_mode (
  user_id    uuid        primary key references auth.users(id) on delete cascade,
  mode       text        not null default 'legacy',
  -- растёт при каждой пересборке данных аккаунта: клиент с другим номером
  -- обязан забыть курсор и взять полный снимок
  epoch      integer     not null default 1,
  changed_at timestamptz not null default now(),
  note       text,
  constraint mark_account_mode_check check (mode in ('legacy', 'v2'))
);

alter table mark_account_mode enable row level security;
drop policy if exists "own mode read" on mark_account_mode;
create policy "own mode read" on mark_account_mode for select using (auth.uid() = user_id);

create or replace function mark_mode(p_user uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select mode from mark_account_mode where user_id = p_user), 'legacy');
$$;

revoke all on function mark_mode(uuid) from public, anon, authenticated;

-- Снимки planner_state, сделанные при переключении и откате: точка возврата,
-- не зависящая от ночной копии.
create table if not exists mark_legacy_snapshots (
  id         bigserial   primary key,
  user_id    uuid        not null references auth.users(id) on delete cascade,
  reason     text        not null,
  data       jsonb       not null,
  taken_at   timestamptz not null default now()
);

alter table mark_legacy_snapshots enable row level security;

-- -------------------------------------------- запрет старой записи (A08) --

create or replace function mark_guard_planner_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := coalesce(new.user_id, old.user_id);
begin
  if mark_mode(v_user) <> 'legacy' then
    raise exception 'planner_state закрыт: аккаунт переведён на новую модель'
      using errcode = 'P0403', hint = 'Обновите приложение, локальные изменения сохранены';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists mark_guard_planner_state on planner_state;
create trigger mark_guard_planner_state before insert or update or delete on planner_state
  for each row execute function mark_guard_planner_state();

-- ---------------------------------- запись в новую модель — только v2 --

-- Иначе данные аккаунта в старой модели разошлись бы с новой ещё до
-- переключения. Ошибка с узнаваемым текстом: обработчик отвечает на неё 409.
create or replace function mark_apply_operations(
  p_user   uuid,
  p_source text,
  p_ops    jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user is null then
    raise exception 'user is required';
  end if;
  perform mark_lock_user(p_user);
  if mark_mode(p_user) <> 'v2' then
    raise exception 'account_not_switched';
  end if;
  return mark_apply_operations_unlocked(p_user, p_source, p_ops);
end;
$$;

revoke all on function mark_apply_operations(uuid, text, jsonb) from public, anon, authenticated;

-- Номер пересборки идёт в каждом ответе чтения.
create or replace function mark_get_state(p_user uuid, p_since bigint default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cursor bigint;
  v_epoch  integer;
begin
  if p_user is null then
    raise exception 'user is required';
  end if;

  -- Функция выполняется с правами владельца, поэтому обязана сама проверить,
  -- за кого её вызвали: иначе любой авторизованный прочитал бы чужой аккаунт,
  -- просто подставив чужой идентификатор. auth.uid() пуст только у сервера.
  if auth.uid() is not null and auth.uid() <> p_user then
    raise exception 'forbidden: доступ только к своим данным';
  end if;

  select coalesce((select epoch from mark_account_mode where user_id = p_user), 1) into v_epoch;

  -- Курсор считается до выборки строк. Каждый оператор здесь видит свой снимок,
  -- поэтому в ответ могут попасть строки новее курсора — их клиент получит ещё
  -- раз, это безопасно. Обратный порядок терял бы строки.
  select greatest(
           coalesce((select max(seq) from mark_sections where user_id = p_user), 0),
           coalesce((select max(seq) from mark_groups   where user_id = p_user), 0),
           coalesce((select max(seq) from mark_tasks    where user_id = p_user), 0)
         )
    into v_cursor;

  return jsonb_build_object(
    'cursor', v_cursor,
    'epoch', v_epoch,
    'mode', mark_mode(p_user),
    'full', p_since is null,
    'sections', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.position, s.id)
      from mark_sections s
      where s.user_id = p_user
        and (p_since is null and s.deleted_at is null or p_since is not null and s.seq > p_since)
    ), '[]'::jsonb),
    'groups', coalesce((
      select jsonb_agg(to_jsonb(g) order by g.position, g.id)
      from mark_groups g
      where g.user_id = p_user
        and (p_since is null and g.deleted_at is null or p_since is not null and g.seq > p_since)
    ), '[]'::jsonb),
    'tasks', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.position, t.id)
      from mark_tasks t
      where t.user_id = p_user
        and (p_since is null and t.deleted_at is null or p_since is not null and t.seq > p_since)
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function mark_get_state(uuid, bigint) from public, anon;
grant execute on function mark_get_state(uuid, bigint) to authenticated;

-- ------------------------------------------------------ переключение --

-- Одна транзакция на аккаунт: заморозить старую запись, пересобрать новую
-- модель из самого свежего planner_state, сверить и только тогда открыть
-- новую. Любое расхождение откатывает всё, аккаунт остаётся в legacy.
--
-- Пересборка, а не дополнение: репетиция делалась раньше, и с тех пор
-- пользователь продолжал работать в старой модели. Повторный перенос только
-- добавил бы недостающее, не обновив изменённое и не убрав удалённое.
create or replace function mark_cutover_user(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_data   jsonb;
  v_ops    integer;
  v_report jsonb;
  v_verify jsonb;
begin
  if mark_mode(p_user) = 'v2' then
    return jsonb_build_object('user_id', p_user, 'status', 'already_v2');
  end if;

  -- Блокировка строки держит все записи в planner_state до конца транзакции:
  -- ни веб, ни бот не впишут ничего между снимком и переключением. После неё
  -- их запись упрётся в запрет.
  select data into v_data from planner_state where user_id = p_user for update;
  if v_data is null then
    raise exception 'нет planner_state у %', p_user;
  end if;
  perform mark_lock_user(p_user);

  -- Правки новой модели от пользователя до переключения невозможны (запись
  -- закрыта для legacy), а сделанные до отката он уже выгрузил в planner_state.
  -- Если после последнего отката в журнале что-то есть — пересборка стёрла бы
  -- это, стоп.
  select count(*) into v_ops from mark_operations
  where user_id = p_user and source <> 'migration'
    and created_at > coalesce((select max(taken_at) from mark_legacy_snapshots
                               where user_id = p_user and reason = 'before-rollback'), '-infinity');
  if v_ops > 0 then
    raise exception 'в новой модели уже есть операции пользователя (%), пересборка стёрла бы их', v_ops;
  end if;

  insert into mark_legacy_snapshots (user_id, reason, data) values (p_user, 'cutover', v_data);

  delete from mark_tasks where user_id = p_user;
  delete from mark_groups where user_id = p_user;
  delete from mark_sections where user_id = p_user;
  delete from mark_migration_quarantine where user_id = p_user;

  v_report := mark_migrate_user(p_user, 2);
  v_verify := mark_verify_user(p_user);

  if jsonb_array_length(v_verify->'missing') > 0
     or jsonb_array_length(v_verify->'mismatched') > 0
     or (v_verify->>'quarantined')::int > 0
     or (v_verify->>'source_tasks') <> (v_verify->>'migrated_tasks')
     or (v_verify->>'source_groups') <> (v_verify->>'migrated_groups')
     or (v_verify->>'source_sections') <> (v_verify->>'migrated_sections') then
    raise exception 'сверка не сошлась, переключение отменено: %', v_verify;
  end if;

  insert into mark_account_mode (user_id, mode, epoch, changed_at, note)
  values (p_user, 'v2', 1, now(), 'cutover')
  on conflict (user_id) do update
    set mode = 'v2', epoch = mark_account_mode.epoch + 1, changed_at = now(), note = 'cutover';

  return jsonb_build_object('user_id', p_user, 'status', 'switched', 'migration', v_report, 'verify', v_verify);
end;
$$;

revoke all on function mark_cutover_user(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------ откат --

-- Старый формат из новой модели. Всё, что было в исходной записи и новая модель
-- не хранит (неизвестные поля), берётся из legacy_metadata.original, поверх —
-- текущие значения.
create or replace function mark_export_legacy(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'sections', coalesce((
      select jsonb_agg(coalesce(s.legacy_metadata->'original', '{}'::jsonb)
                       || jsonb_build_object('id', s.id, 'name', s.name, 'color', s.color)
                       order by s.position, s.id)
      from mark_sections s where s.user_id = p_user and s.deleted_at is null), '[]'::jsonb),
    'groups', coalesce((
      select jsonb_agg(coalesce(g.legacy_metadata->'original', '{}'::jsonb)
                       || jsonb_build_object('id', g.id, 'name', g.name, 'color', g.color, 'sectionId', g.section_id)
                       order by g.position, g.id)
      from mark_groups g where g.user_id = p_user and g.deleted_at is null), '[]'::jsonb),
    'tasks', coalesce((
      select jsonb_agg(coalesce(t.legacy_metadata->'original', '{}'::jsonb)
                       || jsonb_build_object(
                            'id', t.id,
                            'title', t.title,
                            'notes', t.notes,
                            'date', coalesce(to_char(coalesce(t.planned_date, t.due_date), 'YYYY-MM-DD'), ''),
                            'time', coalesce(to_char(coalesce(t.planned_time, t.due_time), 'HH24:MI'), ''),
                            'dateMode', case when t.planned_date is not null then 'on'
                                             when t.due_date is not null then 'due'
                                             else coalesce(t.legacy_metadata->>'date_mode', 'due') end,
                            'groupId', t.group_id,
                            'completed', t.completed,
                            'createdAt', (extract(epoch from t.created_at) * 1000)::bigint)
                       order by t.position, t.id)
      from mark_tasks t where t.user_id = p_user and t.deleted_at is null), '[]'::jsonb),
    'updatedAt', (extract(epoch from now()) * 1000)::bigint
  );
$$;

revoke all on function mark_export_legacy(uuid) from public, anon, authenticated;

-- После открытия записи просто вернуть старую базу нельзя: пропадёт всё, что
-- сделано после переключения. Поэтому planner_state пишется заново из новой
-- модели, а текущее его содержимое сохраняется снимком.
create or replace function mark_rollback_user(p_user uuid, p_note text default 'rollback')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old  jsonb;
  v_new  jsonb;
  v_last bigint;
begin
  if mark_mode(p_user) <> 'v2' then
    return jsonb_build_object('user_id', p_user, 'status', 'not_v2');
  end if;

  perform mark_lock_user(p_user); -- новые операции ждут; после отката их не примут
  select data into v_old from planner_state where user_id = p_user for update;
  if v_old is not null then
    insert into mark_legacy_snapshots (user_id, reason, data) values (p_user, 'before-rollback', v_old);
  end if;

  v_new := mark_export_legacy(p_user);
  select max(server_seq) into v_last from mark_operations where user_id = p_user;

  update mark_account_mode set mode = 'legacy', changed_at = now(), note = p_note where user_id = p_user;

  update planner_state set data = v_new, updated_at = now() where user_id = p_user;
  if not found then
    insert into planner_state (user_id, data, updated_at) values (p_user, v_new, now());
  end if;

  return jsonb_build_object('user_id', p_user, 'status', 'rolled_back',
    'last_confirmed_operation', v_last,
    'tasks', jsonb_array_length(v_new->'tasks'));
end;
$$;

revoke all on function mark_rollback_user(uuid, text) from public, anon, authenticated;
