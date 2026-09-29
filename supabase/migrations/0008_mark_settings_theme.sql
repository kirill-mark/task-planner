-- Тема оформления в аккаунте (раздел 7 ТЗ): выбор синхронизируется между
-- устройствами; «system» хранится как выбор режима, а светлый или тёмный вид
-- определяет само устройство. По умолчанию — как в системе (решение 30.09.2026).
alter table user_settings add column if not exists theme text not null default 'system';
alter table user_settings drop constraint if exists user_settings_theme_check;
alter table user_settings add constraint user_settings_theme_check check (theme in ('light', 'dark', 'system'));
