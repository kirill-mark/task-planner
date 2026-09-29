-- Этап 1 ТЗ, раздел 11 «Контракт записи».
--
-- Одна транзакция на пакет: проверить доступ, версию и поля, применить
-- изменение, повысить серверную ревизию и зарегистрировать результат.
--
-- Свойства, которых требует ТЗ:
--   * повтор той же операции возвращает первоначальный результат;
--   * повтор того же operation_id с другим содержимым отклоняется;
--   * несовпадение base_revision — это конфликт с актуальными данными в ответе,
--     а не молчаливая перезапись;
--   * владелец берётся из проверенной сессии (аргумент функции), а не из тела
--     запроса; ссылки на чужие объекты невозможны из-за внешних ключей.

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
  v_cur_rev   bigint;
  v_result    jsonb;
  v_status    text;
  v_results   jsonb := '[]'::jsonb;
  v_allowed   text[];
  v_bad       text[];
begin
  if p_user is null then
    raise exception 'user is required';
  end if;

  for v_op in select * from jsonb_array_elements(coalesce(p_ops, '[]'::jsonb)) loop
    v_id     := v_op->>'operation_id';
    v_entity := v_op->>'entity';
    v_type   := v_op->>'type';
    v_target := v_op->>'entity_id';
    v_base   := nullif(v_op->>'base_revision', '')::bigint;
    v_changes := coalesce(v_op->'changes', '{}'::jsonb);
    v_status := null;
    v_result := null;

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

    -- --- проверка полей ---
    v_allowed := case v_entity
      when 'task'    then array['title','notes','group_id','planned_date','planned_time','due_date','due_time',
                                'timezone','duration_minutes','priority','completed','position']
      when 'group'   then array['name','color','section_id','position']
      when 'section' then array['name','color','position']
      else null end;

    if v_allowed is null then
      insert into mark_operations (operation_id, user_id, source, entity, entity_id, type, base_revision, changes, request_hash, status, result)
      values (v_id, p_user, p_source, coalesce(v_entity,'task'), v_target, coalesce(v_type,'update'), v_base, v_changes, v_hash,
              'rejected', jsonb_build_object('reason', 'неизвестный тип объекта: ' || coalesce(v_entity,'—')));
      v_results := v_results || jsonb_build_object('operation_id', v_id, 'status', 'rejected', 'reason', 'неизвестный тип объекта');
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
      if v_entity = 'task' then
        select revision into v_cur_rev from mark_tasks where user_id = p_user and id = v_target;

        if v_type = 'create' then
          if v_cur_rev is not null then
            v_status := 'conflict';
            v_result := jsonb_build_object('reason', 'объект уже существует', 'revision', v_cur_rev);
          else
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
            v_status := 'applied';
            v_result := jsonb_build_object('revision', 1);
          end if;

        elsif v_type = 'update' then
          if v_cur_rev is null then
            v_status := 'conflict';
            v_result := jsonb_build_object('reason', 'объект не найден');
          elsif v_base is not null and v_base <> v_cur_rev then
            -- актуальные данные возвращаются сразу, чтобы клиент показал конфликт
            v_status := 'conflict';
            v_result := jsonb_build_object('reason', 'версия устарела', 'revision', v_cur_rev,
              'current', (select to_jsonb(t) from mark_tasks t where t.user_id = p_user and t.id = v_target));
          else
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
            v_status := 'applied';
            v_result := jsonb_build_object('revision', v_cur_rev + 1);
          end if;

        elsif v_type = 'delete' then
          if v_cur_rev is null then
            -- удаление того, чего нет, — не ошибка: результат тот же
            v_status := 'applied';
            v_result := jsonb_build_object('already_absent', true);
          elsif v_base is not null and v_base <> v_cur_rev then
            v_status := 'conflict';
            v_result := jsonb_build_object('reason', 'версия устарела', 'revision', v_cur_rev);
          else
            update mark_tasks set deleted_at = now(), revision = revision + 1, updated_at = now()
            where user_id = p_user and id = v_target;
            v_status := 'applied';
            v_result := jsonb_build_object('revision', v_cur_rev + 1);
          end if;
        end if;

      elsif v_entity = 'group' then
        select revision into v_cur_rev from mark_groups where user_id = p_user and id = v_target;
        if v_type = 'create' and v_cur_rev is null then
          insert into mark_groups (user_id, id, section_id, name, color, position)
          values (p_user, v_target, nullif(v_changes->>'section_id',''),
                  left(coalesce(nullif(v_changes->>'name',''),'Без названия'),80),
                  coalesce(nullif(v_changes->>'color',''), '#5b8def'),
                  coalesce(nullif(v_changes->>'position','')::int, 0));
          v_status := 'applied'; v_result := jsonb_build_object('revision', 1);
        elsif v_type = 'update' and v_cur_rev is not null and (v_base is null or v_base = v_cur_rev) then
          update mark_groups set
            name       = coalesce(left(nullif(v_changes->>'name',''),80), name),
            color      = coalesce(nullif(v_changes->>'color',''), color),
            section_id = case when v_changes ? 'section_id' then nullif(v_changes->>'section_id','') else section_id end,
            position   = coalesce(nullif(v_changes->>'position','')::int, position),
            revision   = revision + 1, updated_at = now()
          where user_id = p_user and id = v_target;
          v_status := 'applied'; v_result := jsonb_build_object('revision', v_cur_rev + 1);
        elsif v_type = 'delete' then
          update mark_groups set deleted_at = now(), revision = revision + 1, updated_at = now()
          where user_id = p_user and id = v_target;
          v_status := 'applied'; v_result := jsonb_build_object('revision', coalesce(v_cur_rev,0) + 1);
        else
          v_status := 'conflict';
          v_result := jsonb_build_object('reason', 'версия устарела или объект отсутствует', 'revision', v_cur_rev);
        end if;

      elsif v_entity = 'section' then
        select revision into v_cur_rev from mark_sections where user_id = p_user and id = v_target;
        if v_type = 'create' and v_cur_rev is null then
          insert into mark_sections (user_id, id, name, color, position)
          values (p_user, v_target,
                  left(coalesce(nullif(v_changes->>'name',''),'Без названия'),80),
                  coalesce(nullif(v_changes->>'color',''), '#7d8ca3'),
                  coalesce(nullif(v_changes->>'position','')::int, 0));
          v_status := 'applied'; v_result := jsonb_build_object('revision', 1);
        elsif v_type = 'update' and v_cur_rev is not null and (v_base is null or v_base = v_cur_rev) then
          update mark_sections set
            name     = coalesce(left(nullif(v_changes->>'name',''),80), name),
            color    = coalesce(nullif(v_changes->>'color',''), color),
            position = coalesce(nullif(v_changes->>'position','')::int, position),
            revision = revision + 1, updated_at = now()
          where user_id = p_user and id = v_target;
          v_status := 'applied'; v_result := jsonb_build_object('revision', v_cur_rev + 1);
        elsif v_type = 'delete' then
          update mark_sections set deleted_at = now(), revision = revision + 1, updated_at = now()
          where user_id = p_user and id = v_target;
          v_status := 'applied'; v_result := jsonb_build_object('revision', coalesce(v_cur_rev,0) + 1);
        else
          v_status := 'conflict';
          v_result := jsonb_build_object('reason', 'версия устарела или объект отсутствует', 'revision', v_cur_rev);
        end if;
      end if;

    exception when others then
      -- ошибка одной операции не роняет весь пакет и сохраняется как результат
      v_status := 'rejected';
      v_result := jsonb_build_object('reason', sqlerrm);
    end;

    if v_status is null then
      v_status := 'rejected';
      v_result := jsonb_build_object('reason', 'неизвестный тип операции: ' || coalesce(v_type,'—'));
    end if;

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

revoke all on function mark_apply_operations(uuid, text, jsonb) from public, anon, authenticated;
