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

-- Любая запись, прошедшая через контракт, обязана поднять seq. Триггер надёжнее
-- перечисления всех мест в коде: пропустить его нельзя.
create or replace function mark_bump_seq()
returns trigger
language plpgsql
as $$
begin
  new.seq := nextval('mark_change_seq');
  return new;
end;
$$;

drop trigger if exists mark_sections_seq on mark_sections;
create trigger mark_sections_seq before update on mark_sections
  for each row execute function mark_bump_seq();

drop trigger if exists mark_groups_seq on mark_groups;
create trigger mark_groups_seq before update on mark_groups
  for each row execute function mark_bump_seq();

drop trigger if exists mark_tasks_seq on mark_tasks;
create trigger mark_tasks_seq before update on mark_tasks
  for each row execute function mark_bump_seq();

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
