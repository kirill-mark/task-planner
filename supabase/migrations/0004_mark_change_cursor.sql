-- Этап 1 ТЗ, раздел 12: устойчивый серверный курсор изменений.
--
-- Досверка не может опираться на updated_at: это часы того, кто писал, а ТЗ
-- прямо требует, чтобы неверные часы устройства не влияли на порядок и на
-- результат синхронизации (сценарий A15). Поэтому у каждой записи есть seq из
-- общей серверной последовательности: он монотонный, не зависит ни от одних
-- часов и переживает переподключения.
--
-- Клиент хранит последний виденный seq и спрашивает «что изменилось после» —
-- этим закрывается окно между первым чтением и подпиской, возврат во вкладку и
-- восстановление сети.

create sequence if not exists mark_change_seq;

alter table mark_sections add column if not exists seq bigint not null default nextval('mark_change_seq');
alter table mark_groups   add column if not exists seq bigint not null default nextval('mark_change_seq');
alter table mark_tasks    add column if not exists seq bigint not null default nextval('mark_change_seq');

create index if not exists mark_sections_seq_idx on mark_sections (user_id, seq);
create index if not exists mark_groups_seq_idx   on mark_groups   (user_id, seq);
create index if not exists mark_tasks_seq_idx    on mark_tasks    (user_id, seq);

-- Сам по себе номер из последовательности курсором не является: он выдаётся в
-- момент записи, а видимой строка становится в момент фиксации. Если две
-- транзакции одного владельца получили 100 и 101, а зафиксировалась первой 101,
-- клиент успеет запомнить курсор 101 и строку со 100 не увидит никогда.
--
-- Поэтому записи одного владельца выстраиваются в очередь блокировкой до конца
-- транзакции: номер берётся только под ней, и порядок номеров совпадает с
-- порядком фиксации. Разные владельцы друг друга не ждут.
create or replace function mark_lock_user(p_user uuid)
returns void
language sql
as $$
  select pg_advisory_xact_lock(hashtextextended('mark:' || p_user::text, 0));
$$;

-- Не часть API: вызванная извне, она лишь даёт способ задерживать чужие записи.
revoke all on function mark_lock_user(uuid) from public, anon, authenticated;

-- Любая запись обязана поднять seq. Триггер надёжнее перечисления всех мест в
-- коде: пропустить его нельзя — ни контракту записи, ни миграции, ни будущему
-- боту. Вставка тоже идёт через него, потому что значение по умолчанию
-- вычисляется до блокировки.
create or replace function mark_bump_seq()
returns trigger
language plpgsql
as $$
begin
  perform mark_lock_user(new.user_id);
  new.seq := nextval('mark_change_seq');
  return new;
end;
$$;

drop trigger if exists mark_sections_seq on mark_sections;
create trigger mark_sections_seq before insert or update on mark_sections
  for each row execute function mark_bump_seq();

drop trigger if exists mark_groups_seq on mark_groups;
create trigger mark_groups_seq before insert or update on mark_groups
  for each row execute function mark_bump_seq();

drop trigger if exists mark_tasks_seq on mark_tasks;
create trigger mark_tasks_seq before insert or update on mark_tasks
  for each row execute function mark_bump_seq();

-- Та же блокировка закрывает гонку в контракте записи. mark_apply_operations
-- читает текущую ревизию и только потом пишет; две одновременные правки одной
-- задачи с одинаковой base_revision обе проходили проверку, и вторая молча
-- затирала первую — ровно то, что ТЗ запрещает в A12. Под блокировкой пакеты
-- одного владельца применяются строго по очереди, и вторая правка видит уже
-- поднятую ревизию и получает конфликт. Заодно два одновременных повтора одного
-- operation_id больше не спорят за вставку в журнал.
--
-- Сама функция не переписывается: прежняя переименовывается во внутреннюю, а
-- под старым именем встаёт обёртка, которая берёт блокировку. Обработчику
-- mark-ops менять ничего не нужно.
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'mark_apply_operations_unlocked'
  ) then
    alter function mark_apply_operations(uuid, text, jsonb) rename to mark_apply_operations_unlocked;
  end if;
end;
$$;

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
  return mark_apply_operations_unlocked(p_user, p_source, p_ops);
end;
$$;

revoke all on function mark_apply_operations(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function mark_apply_operations_unlocked(uuid, text, jsonb) from public, anon, authenticated;

-- Снимок целиком (p_since = null) либо только изменившееся после курсора.
-- Удалённые записи возвращаются тоже: иначе клиент не узнает, что их больше нет.
create or replace function mark_get_state(p_user uuid, p_since bigint default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cursor bigint;
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

-- Realtime для новой модели: только подсказка «что-то изменилось», после которой
-- клиент читает изменения по курсору. Доступ к событиям ограничен теми же
-- политиками чтения своих строк, что и обычные запросы.
do $$
declare
  t text;
begin
  foreach t in array array['mark_sections', 'mark_groups', 'mark_tasks'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;
