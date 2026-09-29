-- Корзина (раздел 3 ТЗ) и правка удалённого (A14).
--
--   * Удалённое хранится 30 дней: его можно прочитать (mark_get_trash) и
--     восстановить операцией restore; потом оно удаляется окончательно
--     (mark_purge_trash, раз в сутки по расписанию).
--   * Восстановление задачи возвращает и её удалённые группу и раздел —
--     иначе она ссылалась бы на то, чего нет на экране.
--   * Правка удалённого объекта — конфликт с его текущей версией, а не
--     молчаливое применение: удалённая задача не воскресает от старой
--     офлайн-правки, клиент предлагает восстановить её явно или сохранить
--     правку новой задачей (A14).
--
-- Контракт прежний: одна транзакция на пакет, проверка полей и версий,
-- повтор operation_id возвращает прежний результат, другое содержимое под тем
-- же id отклоняется. Функция заменяет mark_apply_operations_unlocked; обёртка
-- с блокировкой владельца и проверкой режима (0004, 0005) не меняется.

alter table mark_operations drop constraint if exists mark_operations_type_check;
alter table mark_operations add constraint mark_operations_type_check check (type in ('create', 'update', 'delete', 'restore'));

create or replace function mark_row(p_entity text, p_user uuid, p_id text)
returns jsonb
language sql
stable
set search_path = public
as $$
  select case p_entity
    when 'task'    then (select to_jsonb(t) from mark_tasks t    where t.user_id = p_user and t.id = p_id)
    when 'group'   then (select to_jsonb(g) from mark_groups g   where g.user_id = p_user and g.id = p_id)
    when 'section' then (select to_jsonb(s) from mark_sections s where s.user_id = p_user and s.id = p_id)
  end;
$$;

revoke all on function mark_row(text, uuid, text) from public, anon, authenticated;

-- Восстановить одну строку из корзины; вернуть её новую ревизию или null.
create or replace function mark_undelete(p_entity text, p_user uuid, p_id text)
returns bigint
language plpgsql
set search_path = public
as $$
declare
  v_rev bigint;
begin
  if p_entity = 'task' then
    update mark_tasks set deleted_at = null, revision = revision + 1, updated_at = now()
    where user_id = p_user and id = p_id and deleted_at is not null returning revision into v_rev;
  elsif p_entity = 'group' then
    update mark_groups set deleted_at = null, revision = revision + 1, updated_at = now()
    where user_id = p_user and id = p_id and deleted_at is not null returning revision into v_rev;
  else
    update mark_sections set deleted_at = null, revision = revision + 1, updated_at = now()
    where user_id = p_user and id = p_id and deleted_at is not null returning revision into v_rev;
  end if;
  return v_rev;
end;
$$;

revoke all on function mark_undelete(text, uuid, text) from public, anon, authenticated;

create or replace function mark_apply_operations_unlocked(
  p_user   uuid,
  p_source text,
  p_ops    jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_op        jsonb;
  v_id        text;
  v_entity    text;
  v_type      text;
  v_target    text;
  v_base      bigint;
  v_changes   jsonb;
  v_hash      text;
  v_existing  mark_operations%rowtype;
  v_cur       jsonb;
  v_cur_rev   bigint;
  v_deleted   boolean;
  v_result    jsonb;
  v_status    text;
  v_results   jsonb := '[]'::jsonb;
  v_allowed   text[];
  v_bad       text[];
  v_parent    jsonb;
begin
  if p_user is null then
    raise exception 'user is required';
  end if;

  for v_op in select * from jsonb_array_elements(coalesce(p_ops, '[]'::jsonb)) loop
    v_id      := v_op->>'operation_id';
    v_entity  := v_op->>'entity';
    v_type    := v_op->>'type';
    v_target  := v_op->>'entity_id';
    v_base    := nullif(v_op->>'base_revision', '')::bigint;
    v_changes := coalesce(v_op->'changes', '{}'::jsonb);
    v_status  := null;
    v_result  := null;

    -- одинаковое содержимое даёт одинаковый отпечаток, поэтому повтор узнаётся
    v_hash := md5(coalesce(v_entity,'') || '|' || coalesce(v_type,'') || '|' ||
                  coalesce(v_target,'') || '|' || coalesce(v_base::text,'') || '|' ||
                  v_changes::text);

    if v_id is null or v_id = '' then
      v_results := v_results || jsonb_build_object(
        'operation_id', null, 'status', 'rejected', 'reason', 'operation_id обязателен');
      continue;
    end if;

    -- --- идемпотентность ---
    select * into v_existing from mark_operations where operation_id = v_id;
    if found then
      if v_existing.user_id <> p_user then
        v_results := v_results || jsonb_build_object(
          'operation_id', v_id, 'status', 'rejected', 'reason', 'operation_id принадлежит другому владельцу');
      elsif v_existing.request_hash = v_hash then
        v_results := v_results || jsonb_build_object(
          'operation_id', v_id, 'status', v_existing.status, 'result', v_existing.result, 'repeat', true);
      else
        v_results := v_results || jsonb_build_object(
          'operation_id', v_id, 'status', 'rejected', 'reason', 'operation_id уже использован с другим содержимым');
      end if;
      continue;
    end if;

    -- --- проверка объекта, типа и полей ---
    v_allowed := case v_entity
      when 'task'    then array['title','notes','group_id','planned_date','planned_time','due_date','due_time',
                                'timezone','duration_minutes','priority','completed','position']
      when 'group'   then array['name','color','section_id','position']
      when 'section' then array['name','color','position']
      else null end;

    if v_allowed is null or v_type not in ('create', 'update', 'delete', 'restore') or v_target is null or v_target = '' then
      insert into mark_operations (operation_id, user_id, source, entity, entity_id, type, base_revision, changes, request_hash, status, result)
      values (v_id, p_user, p_source, case when v_allowed is null then 'task' else v_entity end, v_target,
              case when v_type in ('create','update','delete','restore') then v_type else 'update' end,
              v_base, v_changes, v_hash, 'rejected',
              jsonb_build_object('reason', 'неизвестный объект или тип операции: ' || coalesce(v_entity,'—') || '/' || coalesce(v_type,'—')));
      v_results := v_results || jsonb_build_object('operation_id', v_id, 'status', 'rejected', 'reason', 'неизвестный объект или тип операции');
      continue;
    end if;

    select array_agg(k) into v_bad
    from jsonb_object_keys(v_changes) k
    where not (k = any(v_allowed));

    if v_bad is not null then
      insert into mark_operations (operation_id, user_id, source, entity, entity_id, type, base_revision, changes, request_hash, status, result)
      values (v_id, p_user, p_source, v_entity, v_target, v_type, v_base, v_changes, v_hash,
              'rejected', jsonb_build_object('reason', 'недопустимые поля: ' || array_to_string(v_bad, ', ')));
      v_results := v_results || jsonb_build_object('operation_id', v_id, 'status', 'rejected', 'reason', 'недопустимые поля: ' || array_to_string(v_bad, ', '));
      continue;
    end if;

    -- --- применение ---
    begin
      v_cur := mark_row(v_entity, p_user, v_target);
      v_cur_rev := (v_cur->>'revision')::bigint;
      v_deleted := v_cur is not null and v_cur->>'deleted_at' is not null;

      if v_type = 'create' then
        if v_cur is not null then
          v_status := 'conflict';
          v_result := jsonb_build_object('reason', 'объект уже существует', 'revision', v_cur_rev, 'current', v_cur);
        elsif v_entity = 'task' then
          insert into mark_tasks (user_id, id, group_id, title, notes, planned_date, planned_time,
                                  due_date, due_time, timezone, duration_minutes, priority, completed, position)
          values (
            p_user, v_target,
            nullif(v_changes->>'group_id',''),
            left(coalesce(nullif(v_changes->>'title',''), 'Без названия'), 200),
            coalesce(v_changes->>'notes',''),
            nullif(v_changes->>'planned_date','')::date,
            nullif(v_changes->>'planned_time','')::time,
            nullif(v_changes->>'due_date','')::date,
            nullif(v_changes->>'due_time','')::time,
            nullif(v_changes->>'timezone',''),
            nullif(v_changes->>'duration_minutes','')::int,
            coalesce(nullif(v_changes->>'priority',''), 'normal'),
            coalesce((v_changes->>'completed')::boolean, false),
            coalesce(nullif(v_changes->>'position','')::int, 0)
          );
          v_status := 'applied'; v_result := jsonb_build_object('revision', 1);
        elsif v_entity = 'group' then
          insert into mark_groups (user_id, id, section_id, name, color, position)
          values (p_user, v_target, nullif(v_changes->>'section_id',''),
                  left(coalesce(nullif(v_changes->>'name',''),'Без названия'),80),
                  coalesce(nullif(v_changes->>'color',''), '#5b8def'),
                  coalesce(nullif(v_changes->>'position','')::int, 0));
          v_status := 'applied'; v_result := jsonb_build_object('revision', 1);
        else
          insert into mark_sections (user_id, id, name, color, position)
          values (p_user, v_target,
                  left(coalesce(nullif(v_changes->>'name',''),'Без названия'),80),
                  coalesce(nullif(v_changes->>'color',''), '#7d8ca3'),
                  coalesce(nullif(v_changes->>'position','')::int, 0));
          v_status := 'applied'; v_result := jsonb_build_object('revision', 1);
        end if;

      elsif v_type = 'restore' then
        if v_cur is null then
          v_status := 'conflict'; v_result := jsonb_build_object('reason', 'объект не найден');
        elsif not v_deleted then
          -- уже на месте: восстановление ничего не меняет, результат тот же
          v_status := 'applied'; v_result := jsonb_build_object('revision', v_cur_rev, 'already_present', true);
        elsif (v_cur->>'deleted_at')::timestamptz < now() - interval '30 days' then
          v_status := 'rejected'; v_result := jsonb_build_object('reason', 'срок хранения в корзине истёк');
        else
          -- сначала родители, иначе восстановленное ссылалось бы на удалённое
          if v_entity = 'task' and v_cur->>'group_id' is not null then
            v_parent := mark_row('group', p_user, v_cur->>'group_id');
            if v_parent->>'section_id' is not null then perform mark_undelete('section', p_user, v_parent->>'section_id'); end if;
            perform mark_undelete('group', p_user, v_cur->>'group_id');
          elsif v_entity = 'group' and v_cur->>'section_id' is not null then
            perform mark_undelete('section', p_user, v_cur->>'section_id');
          end if;
          v_status := 'applied';
          v_result := jsonb_build_object('revision', mark_undelete(v_entity, p_user, v_target));
        end if;

      elsif v_cur is null then
        if v_type = 'delete' then
          v_status := 'applied'; v_result := jsonb_build_object('already_absent', true);
        else
          v_status := 'conflict'; v_result := jsonb_build_object('reason', 'объект не найден');
        end if;

      elsif v_deleted then
        if v_type = 'delete' then
          -- удаление удалённого — не ошибка: результат тот же
          v_status := 'applied'; v_result := jsonb_build_object('revision', v_cur_rev, 'already_absent', true);
        else
          -- A14: правка не воскрешает удалённое
          v_status := 'conflict';
          v_result := jsonb_build_object('reason', 'объект удалён', 'deleted', true, 'revision', v_cur_rev, 'current', v_cur);
        end if;

      elsif v_base is not null and v_base <> v_cur_rev then
        -- актуальные данные возвращаются сразу, чтобы клиент показал конфликт
        v_status := 'conflict';
        v_result := jsonb_build_object('reason', 'версия устарела', 'revision', v_cur_rev, 'current', v_cur);

      elsif v_type = 'delete' then
        if v_entity = 'task' then
          update mark_tasks set deleted_at = now(), revision = revision + 1, updated_at = now() where user_id = p_user and id = v_target;
        elsif v_entity = 'group' then
          update mark_groups set deleted_at = now(), revision = revision + 1, updated_at = now() where user_id = p_user and id = v_target;
        else
          update mark_sections set deleted_at = now(), revision = revision + 1, updated_at = now() where user_id = p_user and id = v_target;
        end if;
        v_status := 'applied'; v_result := jsonb_build_object('revision', v_cur_rev + 1);

      elsif v_entity = 'task' then
        update mark_tasks set
          title            = coalesce(left(nullif(v_changes->>'title',''),200), title),
          notes            = coalesce(v_changes->>'notes', notes),
          group_id         = case when v_changes ? 'group_id' then nullif(v_changes->>'group_id','') else group_id end,
          planned_date     = case when v_changes ? 'planned_date' then nullif(v_changes->>'planned_date','')::date else planned_date end,
          planned_time     = case when v_changes ? 'planned_time' then nullif(v_changes->>'planned_time','')::time else planned_time end,
          due_date         = case when v_changes ? 'due_date' then nullif(v_changes->>'due_date','')::date else due_date end,
          due_time         = case when v_changes ? 'due_time' then nullif(v_changes->>'due_time','')::time else due_time end,
          timezone         = case when v_changes ? 'timezone' then nullif(v_changes->>'timezone','') else timezone end,
          duration_minutes = case when v_changes ? 'duration_minutes' then nullif(v_changes->>'duration_minutes','')::int else duration_minutes end,
          priority         = coalesce(nullif(v_changes->>'priority',''), priority),
          completed        = coalesce((v_changes->>'completed')::boolean, completed),
          completed_at     = case
                               when (v_changes->>'completed')::boolean is true and not completed then now()
                               when (v_changes->>'completed')::boolean is false then null
                               else completed_at end,
          position         = coalesce(nullif(v_changes->>'position','')::int, position),
          revision         = revision + 1,
          updated_at       = now()
        where user_id = p_user and id = v_target;
        v_status := 'applied'; v_result := jsonb_build_object('revision', v_cur_rev + 1);

      elsif v_entity = 'group' then
        update mark_groups set
          name       = coalesce(left(nullif(v_changes->>'name',''),80), name),
          color      = coalesce(nullif(v_changes->>'color',''), color),
          section_id = case when v_changes ? 'section_id' then nullif(v_changes->>'section_id','') else section_id end,
          position   = coalesce(nullif(v_changes->>'position','')::int, position),
          revision   = revision + 1, updated_at = now()
        where user_id = p_user and id = v_target;
        v_status := 'applied'; v_result := jsonb_build_object('revision', v_cur_rev + 1);

      else
        update mark_sections set
          name     = coalesce(left(nullif(v_changes->>'name',''),80), name),
          color    = coalesce(nullif(v_changes->>'color',''), color),
          position = coalesce(nullif(v_changes->>'position','')::int, position),
          revision = revision + 1, updated_at = now()
        where user_id = p_user and id = v_target;
        v_status := 'applied'; v_result := jsonb_build_object('revision', v_cur_rev + 1);
      end if;

    exception when others then
      -- ошибка одной операции не роняет весь пакет и сохраняется как результат
      v_status := 'rejected';
      v_result := jsonb_build_object('reason', sqlerrm);
    end;

    insert into mark_operations (operation_id, user_id, source, entity, entity_id, type, base_revision, changes, request_hash, status, result)
    values (v_id, p_user, p_source, v_entity, v_target, v_type, v_base, v_changes, v_hash, v_status, v_result);

    v_results := v_results || jsonb_build_object(
      'operation_id', v_id, 'status', v_status, 'result', v_result);
  end loop;

  return jsonb_build_object(
    'results', v_results,
    'server_seq', (select coalesce(max(server_seq), 0) from mark_operations where user_id = p_user)
  );
end;
$$;

revoke all on function mark_apply_operations_unlocked(uuid, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------- корзина --

create or replace function mark_get_trash(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_user is null then
    raise exception 'user is required';
  end if;
  if auth.uid() is not null and auth.uid() <> p_user then
    raise exception 'forbidden: доступ только к своим данным';
  end if;
  return jsonb_build_object(
    'keep_days', 30,
    'tasks', coalesce((select jsonb_agg(to_jsonb(t) order by t.deleted_at desc) from mark_tasks t
                       where t.user_id = p_user and t.deleted_at > now() - interval '30 days'), '[]'::jsonb),
    'groups', coalesce((select jsonb_agg(to_jsonb(g) order by g.deleted_at desc) from mark_groups g
                        where g.user_id = p_user and g.deleted_at > now() - interval '30 days'), '[]'::jsonb),
    'sections', coalesce((select jsonb_agg(to_jsonb(s) order by s.deleted_at desc) from mark_sections s
                          where s.user_id = p_user and s.deleted_at > now() - interval '30 days'), '[]'::jsonb)
  );
end;
$$;

revoke all on function mark_get_trash(uuid) from public, anon;
grant execute on function mark_get_trash(uuid) to authenticated;

-- Окончательное удаление через 30 дней. Задачи первыми; группа и раздел —
-- только когда на них больше ничего не ссылается (ни живое, ни в корзине).
create or replace function mark_purge_trash()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tasks integer; v_groups integer; v_sections integer;
begin
  delete from mark_tasks where deleted_at < now() - interval '30 days';
  get diagnostics v_tasks = row_count;
  delete from mark_groups g where g.deleted_at < now() - interval '30 days'
    and not exists (select 1 from mark_tasks t where t.user_id = g.user_id and t.group_id = g.id);
  get diagnostics v_groups = row_count;
  delete from mark_sections s where s.deleted_at < now() - interval '30 days'
    and not exists (select 1 from mark_groups g where g.user_id = s.user_id and g.section_id = s.id);
  get diagnostics v_sections = row_count;
  return jsonb_build_object('tasks', v_tasks, 'groups', v_groups, 'sections', v_sections);
end;
$$;

revoke all on function mark_purge_trash() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'mark-purge-trash';
    perform cron.schedule('mark-purge-trash', '41 3 * * *', 'select public.mark_purge_trash()');
  end if;
end;
$$;
