-- Этап 1 ТЗ: целевая модель данных MARK.
--
-- Таблицы создаются рядом с planner_state и никем пока не читаются: наполнение
-- их данными ничего не ломает, поэтому миграцию можно репетировать на живом
-- проекте, а откат — это очистка этих таблиц.
--
-- Идентификаторы остаются текстовыми: у старых групп они вида 'work', 'general',
-- и ТЗ прямо запрещает приводить их к UUID без карты соответствия.
-- Уникальность — (user_id, id), все ссылки включают владельца, поэтому связь с
-- чужим разделом невозможна на уровне ограничений, а не только проверок в коде.

-- ---------------------------------------------------------------- разделы --

create table if not exists mark_sections (
  user_id         uuid        not null references auth.users(id) on delete cascade,
  id              text        not null,
  name            text        not null,
  color           text        not null default '#7d8ca3',
  position        integer     not null default 0,
  revision        bigint      not null default 1,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  legacy_metadata jsonb       not null default '{}'::jsonb,
  primary key (user_id, id),
  constraint mark_sections_name_len check (char_length(name) <= 80)
);

-- ------------------------------------------------------------------ группы --

create table if not exists mark_groups (
  user_id         uuid        not null references auth.users(id) on delete cascade,
  id              text        not null,
  section_id      text,
  name            text        not null,
  color           text        not null default '#5b8def',
  position        integer     not null default 0,
  revision        bigint      not null default 1,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  legacy_metadata jsonb       not null default '{}'::jsonb,
  primary key (user_id, id),
  -- NULL в section_id допустим (группа вне раздела); непустая ссылка обязана
  -- указывать на раздел того же владельца
  constraint mark_groups_section_fk
    foreign key (user_id, section_id) references mark_sections (user_id, id)
    on update cascade on delete restrict,
  constraint mark_groups_name_len check (char_length(name) <= 80)
);

create index if not exists mark_groups_section_idx on mark_groups (user_id, section_id);

-- ------------------------------------------------------------------ задачи --

create table if not exists mark_tasks (
  user_id          uuid        not null references auth.users(id) on delete cascade,
  id               text        not null,
  group_id         text,
  title            text        not null,
  notes            text        not null default '',
  -- «Запланировать на» и «Выполнить до» — разные вещи, задача может иметь обе
  planned_date     date,
  planned_time     time,
  due_date         date,
  due_time         time,
  -- IANA-пояс события; для даты без времени не нужен
  timezone         text,
  duration_minutes integer,
  priority         text        not null default 'normal',
  completed        boolean     not null default false,
  completed_at     timestamptz,
  position         integer     not null default 0,
  revision         bigint      not null default 1,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  -- сюда кладётся всё, что не разобрано однозначно: исходные значения дат,
  -- происхождение часового пояса, неизвестные старые поля
  legacy_metadata  jsonb       not null default '{}'::jsonb,
  primary key (user_id, id),
  constraint mark_tasks_group_fk
    foreign key (user_id, group_id) references mark_groups (user_id, id)
    on update cascade on delete restrict,
  constraint mark_tasks_priority_check check (priority in ('low', 'normal', 'high')),
  constraint mark_tasks_duration_check check (duration_minutes is null or duration_minutes > 0),
  -- время без даты требует уточнения и не должно храниться молча
  constraint mark_tasks_planned_time_needs_date check (planned_time is null or planned_date is not null),
  constraint mark_tasks_due_time_needs_date check (due_time is null or due_date is not null)
);

create index if not exists mark_tasks_group_idx   on mark_tasks (user_id, group_id);
create index if not exists mark_tasks_planned_idx on mark_tasks (user_id, planned_date) where deleted_at is null;
create index if not exists mark_tasks_due_idx     on mark_tasks (user_id, due_date)     where deleted_at is null;
create index if not exists mark_tasks_open_idx    on mark_tasks (user_id, completed)    where deleted_at is null;

-- ---------------------------------------------------------------- операции --

-- Журнал записей: повтор той же операции возвращает прежний результат, повтор с
-- другим содержимым отклоняется. Серверная последовательность даёт курсор для
-- досверки, не зависящий от часов клиента.
create table if not exists mark_operations (
  operation_id  text        primary key,
  user_id       uuid        not null references auth.users(id) on delete cascade,
  source        text        not null,
  entity        text        not null,
  entity_id     text,
  type          text        not null,
  base_revision bigint,
  changes       jsonb       not null default '{}'::jsonb,
  request_hash  text        not null,
  status        text        not null,
  result        jsonb,
  server_seq    bigserial   not null,
  created_at    timestamptz not null default now(),
  constraint mark_operations_source_check check (source in ('web', 'miniapp', 'bot', 'migration')),
  constraint mark_operations_entity_check check (entity in ('task', 'group', 'section')),
  constraint mark_operations_type_check   check (type   in ('create', 'update', 'delete')),
  constraint mark_operations_status_check check (status in ('applied', 'conflict', 'rejected'))
);

create index if not exists mark_operations_user_seq_idx on mark_operations (user_id, server_seq);

-- ------------------------------------------------- миграция: журнал и карантин --

create table if not exists mark_migration_runs (
  id                bigserial   primary key,
  version           integer     not null,
  user_id           uuid,
  source_updated_at timestamptz,
  counts            jsonb,
  status            text        not null,
  started_at        timestamptz not null default now(),
  finished_at       timestamptz
);

-- Повреждённые связи и даты не выбрасываются и не «чинятся» молча: запись
-- переносится, а проблема попадает сюда с исходным содержимым.
create table if not exists mark_migration_quarantine (
  id         bigserial   primary key,
  user_id    uuid,
  kind       text        not null,
  source_id  text,
  reason     text        not null,
  payload    jsonb       not null,
  created_at timestamptz not null default now()
);

-- --------------------------------------------------------------------- RLS --

alter table mark_sections              enable row level security;
alter table mark_groups                enable row level security;
alter table mark_tasks                 enable row level security;
alter table mark_operations            enable row level security;
alter table mark_migration_runs        enable row level security;
alter table mark_migration_quarantine  enable row level security;

-- Читать — только своё. Писать на этом этапе может лишь сервер: запись пойдёт
-- через проверяемый слой операций, а не напрямую из клиента.
drop policy if exists "own sections read" on mark_sections;
create policy "own sections read" on mark_sections for select using (auth.uid() = user_id);

drop policy if exists "own groups read" on mark_groups;
create policy "own groups read" on mark_groups for select using (auth.uid() = user_id);

drop policy if exists "own tasks read" on mark_tasks;
create policy "own tasks read" on mark_tasks for select using (auth.uid() = user_id);

drop policy if exists "own operations read" on mark_operations;
create policy "own operations read" on mark_operations for select using (auth.uid() = user_id);
