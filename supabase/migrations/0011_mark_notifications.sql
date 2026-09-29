-- Раздел 10 ТЗ: настройки уведомлений и надёжная доставка.
alter table user_settings add column if not exists morning_time time not null default '09:00';
alter table user_settings add column if not exists evening_time time not null default '21:00';
alter table user_settings add column if not exists reminder_lead integer not null default 30;
alter table user_settings add column if not exists quiet_enabled boolean not null default false;
alter table user_settings add column if not exists quiet_start time not null default '23:00';
alter table user_settings add column if not exists quiet_end time not null default '08:00';
alter table user_settings drop constraint if exists user_settings_notify_check;
alter table user_settings add constraint user_settings_notify_check check (reminder_lead in (5, 15, 30, 60));

-- Пользователь заблокировал бота: доставка прекращается и это видно в кабинете;
-- снимается, когда он снова пишет боту.
alter table telegram_links add column if not exists blocked_at timestamptz;

-- Отметка о неотправленном по истечении окна (раздел 10): сводки догоняются
-- в пределах часа, напоминания — пока событие не началось, потом — expired.
alter table sent_notifications drop constraint if exists sent_notifications_status_check;
alter table sent_notifications add constraint sent_notifications_status_check
  check (status in ('processing', 'sent', 'unknown', 'failed', 'expired'));

-- Планировщик — раз в минуту вместо пяти (целевой интервал раздела 10; риск R5).
do $$
declare v_cmd text;
begin
  select command into v_cmd from cron.job where jobname = 'mark-reminders';
  if v_cmd is not null then
    perform cron.alter_job((select jobid from cron.job where jobname = 'mark-reminders'), schedule := '* * * * *');
  end if;
end;
$$;
