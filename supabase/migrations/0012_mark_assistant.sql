-- Раздел 8 ТЗ: настройки помощника в аккаунте.
alter table user_settings add column if not exists assistant_consent_at timestamptz; -- когда человек согласился передавать задачи ИИ-провайдеру
alter table user_settings add column if not exists assistant_brief boolean not null default true; -- краткие ответы
alter table user_settings add column if not exists assistant_confirm_all boolean not null default false; -- всегда показывать черновик, даже для одной задачи
