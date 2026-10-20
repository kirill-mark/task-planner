-- Manual permanent deletion of the tasks shown in the current user's trash.
-- Defining this function does not delete anything. The app calls it only
-- after an explicit confirmation; active/restored/changed tasks are skipped.
begin;

create or replace function public.mark_empty_trash(p_tasks jsonb, p_expected_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_tasks integer;
begin
  if v_user is null then raise exception 'authentication required'; end if;
  if p_expected_user is distinct from v_user then raise exception 'account changed'; end if;
  if p_tasks is null or jsonb_typeof(p_tasks) <> 'array' then
    raise exception 'task snapshot must be an array';
  end if;
  if jsonb_array_length(p_tasks) > 10000 then raise exception 'too many tasks'; end if;

  perform public.mark_lock_user(v_user);
  if public.mark_mode(v_user) <> 'v2' then raise exception 'account_not_switched'; end if;

  delete from public.mark_tasks t
  using jsonb_to_recordset(p_tasks) as requested(id text, deleted_at timestamptz)
  where t.user_id = v_user
    and t.id = requested.id
    and t.deleted_at is not null
    and t.deleted_at = requested.deleted_at;
  get diagnostics v_tasks = row_count;

  -- Physical deletion has no row tombstone. Invalidate incremental cursors
  -- so other devices take a full snapshot instead of keeping a cached row.
  if v_tasks > 0 then
    insert into public.mark_account_mode (user_id, mode, epoch, changed_at, note)
    values (v_user, 'v2', 2, now(), 'empty_trash')
    on conflict (user_id) do update
    set epoch = coalesce(mark_account_mode.epoch, 1) + 1,
        changed_at = now(), note = 'empty_trash';
  end if;
  return jsonb_build_object('tasks', v_tasks);
end;
$$;

revoke all on function public.mark_empty_trash(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.mark_empty_trash(jsonb, uuid) to authenticated;

commit;
