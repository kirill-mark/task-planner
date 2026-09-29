-- Контроль работы (раздел 14 ТЗ): технические показатели и уведомление
-- ответственному о системной остановке обработки — без текста пользователя.
--
--   * mark_health_events — след сбоев, которые пользователь видит как понятный
--     статус и которые поэтому не попадают в журнал ошибок: лимит и сбой
--     ИИ-провайдера, ошибка распознавания речи, сбой чтения при рассылке.
--     Только источник, вид и техническая причина. Хранится 30 дней.
--   * mark_health_report(since) — сводка за период из уже существующих
--     журналов: операции, входящие обновления бота, уведомления, запуски
--     расписания и ответы обработчиков. Только для service_role.
--   * Расписание mark-health (функция) — раз в час проверка с оповещением при
--     проблеме, раз в сутки сводка. Создаётся из команды mark-reminders, чтобы
--     секрет расписания не попадал в репозиторий.

create table if not exists public.mark_health_events (
  id      bigserial   primary key,
  at      timestamptz not null default now(),
  source  text        not null,  -- bot | assistant | reminders
  kind    text        not null,  -- provider_limit | provider | parse | voice | read
  detail  text
);
create index if not exists mark_health_events_at_idx on public.mark_health_events (at);
alter table public.mark_health_events enable row level security;
-- политик нет: читать и писать может только service_role
revoke all on public.mark_health_events from anon, authenticated;

create or replace function public.mark_health_report(p_since timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with runs as (
    select d.start_time, d.status
    from cron.job_run_details d join cron.job j on j.jobid = d.jobid
    where j.jobname = 'mark-reminders' and d.start_time >= p_since
  ), gaps as (
    select start_time - lag(start_time) over (order by start_time) as gap from runs
  )
  select jsonb_build_object(
    'since', p_since,
    'now', now(),
    'ops', (select coalesce(jsonb_object_agg(k, n), '{}') from (
        select source || ':' || status as k, count(*) as n from mark_operations where created_at >= p_since group by 1) x),
    'active_users', (select count(distinct user_id) from mark_operations where created_at >= p_since),
    'updates', (select coalesce(jsonb_object_agg(status, n), '{}') from (
        select status, count(*) as n from telegram_updates where received_at >= p_since group by 1) x),
    'stuck_updates', (select count(*) from telegram_updates
        where status = 'processing' and received_at >= p_since and received_at < now() - interval '5 minutes'),
    'notifications', (select coalesce(jsonb_object_agg(status, n), '{}') from (
        select status, count(*) as n from sent_notifications
        where sent_at >= p_since and kind not like 'health%' group by 1) x),
    'stuck_notifications', (select count(*) from sent_notifications
        where status = 'processing' and sent_at >= p_since and sent_at < now() - interval '10 minutes'),
    'events', (select coalesce(jsonb_object_agg(k, n), '{}') from (
        select source || ':' || kind as k, count(*) as n from mark_health_events where at >= p_since group by 1) x),
    'reminder_runs', (select count(*) from runs),
    'reminder_runs_failed', (select count(*) from runs where status <> 'succeeded'),
    'reminder_last_run', (select max(start_time) from runs),
    'reminder_max_gap_min', (select round(extract(epoch from greatest(
        coalesce(max(gap), interval '0'),
        now() - coalesce((select max(start_time) from runs), p_since))) / 60) from gaps),
    'http_failed', (select count(*) from net._http_response
        where created >= p_since and (status_code is null or status_code not between 200 and 299)),
    'backup_last_ok', (select max(d.start_time) from cron.job_run_details d join cron.job j on j.jobid = d.jobid
        where j.jobname = 'mark-backup' and d.status = 'succeeded')
  );
$$;

revoke all on function public.mark_health_report(timestamptz) from public, anon, authenticated;
grant execute on function public.mark_health_report(timestamptz) to service_role;

-- 30 дней следа — в той же ночной уборке, что и корзина
create or replace function public.mark_purge_health() returns void
language sql security definer set search_path = public, pg_temp as $$
  delete from mark_health_events where at < now() - interval '30 days';
  delete from sent_notifications where kind like 'health%' and sent_at < now() - interval '30 days';
$$;
revoke all on function public.mark_purge_health() from public, anon, authenticated;

do $$
declare v_cmd text;
begin
  select command into v_cmd from cron.job where jobname = 'mark-reminders';
  if v_cmd is null then
    raise notice 'mark-reminders не найден — расписание mark-health не создано';
    return;
  end if;
  v_cmd := replace(v_cmd, '/functions/v1/send-reminders', '/functions/v1/mark-health');
  perform cron.schedule('mark-health-check', '7 * * * *', replace(v_cmd, '''{}''::jsonb', '''{"mode":"check"}''::jsonb'));
  perform cron.schedule('mark-health-daily', '5 6 * * *', replace(v_cmd, '''{}''::jsonb', '''{"mode":"daily"}''::jsonb'));
  perform cron.schedule('mark-purge-health', '43 3 * * *', 'select public.mark_purge_health()');
end;
$$;

-- pg_net по умолчанию ждёт ответа 5 секунд; рассылка с холодного старта
-- дольше, и запуск выглядел сбоем, хотя отрабатывал. 55 секунд — меньше
-- минутного шага, поэтому «таймаут» в сводке теперь означает настоящий сбой.
do $$
declare r record;
begin
  for r in select jobid, command from cron.job
           where jobname in ('mark-reminders', 'mark-health-check', 'mark-health-daily', 'mark-backup')
             and command not like '%timeout_milliseconds%' loop
    perform cron.alter_job(r.jobid, command := regexp_replace(r.command, '(body := [^)]*?::jsonb)', '\1,' || chr(10) || '    timeout_milliseconds := 55000'));
  end loop;
end;
$$;
