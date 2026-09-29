-- Дефекты и риски из инвентаризации (docs/stage0-inventory.md): D07, D08, D09,
-- R4, R6. Серверная часть; изменения обработчиков и клиента — в том же коммите.

-- ------------------------------------------ D07: повторы от Telegram --

-- Telegram повторяет доставку, если не дождался ответа. Без журнала повтор
-- обрабатывался заново: вторая задача, второе удаление, второе сообщение.
-- update_id уникален для бота, поэтому одна строка на событие. Текст сообщений
-- здесь не хранится — только факт и исход обработки.
create table if not exists telegram_updates (
  update_id   bigint      primary key,
  chat_id     bigint,
  kind        text,
  status      text        not null default 'processing',
  error       text,
  received_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint telegram_updates_status_check check (status in ('processing', 'done', 'failed'))
);

create index if not exists telegram_updates_received_idx on telegram_updates (received_at);
alter table telegram_updates enable row level security; -- только сервер

-- true — событие новое и захвачено этим вызовом; false — уже видели. Повтор не
-- обрабатывается заново, даже если первая обработка упала: её частичный
-- результат неизвестен, а пользователь об ошибке уже извещён.
create or replace function mark_claim_telegram_update(p_update_id bigint, p_chat_id bigint, p_kind text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into telegram_updates (update_id, chat_id, kind) values (p_update_id, p_chat_id, p_kind)
  on conflict (update_id) do nothing;
  if not found then
    return false;
  end if;
  -- журнал нужен только на время возможных повторов
  delete from telegram_updates where received_at < now() - interval '30 days';
  return true;
end;
$$;

revoke all on function mark_claim_telegram_update(bigint, bigint, text) from public, anon, authenticated;

-- ------------------------------------------------- R4: коды привязки --

-- Срок жизни 10 минут. Время и флаг ставит база, а не клиент: иначе код можно
-- было бы создать «вечным» или вернуть в оборот.
alter table link_codes add column if not exists expires_at timestamptz;
update link_codes set expires_at = created_at + interval '10 minutes' where expires_at is null;
alter table link_codes alter column expires_at set not null;

create or replace function mark_link_code_defaults()
returns trigger
language plpgsql
as $$
begin
  new.created_at := now();
  new.expires_at := now() + interval '10 minutes';
  new.used := false;
  return new;
end;
$$;

drop trigger if exists mark_link_code_defaults on link_codes;
create trigger mark_link_code_defaults before insert on link_codes
  for each row execute function mark_link_code_defaults();

-- Пользователь создаёт, видит и удаляет свои коды, но не меняет их: прежняя
-- политика «всё со своими» позволяла снять отметку used.
drop policy if exists "own link codes" on link_codes;
drop policy if exists "own link codes read" on link_codes;
drop policy if exists "own link codes insert" on link_codes;
drop policy if exists "own link codes delete" on link_codes;
create policy "own link codes read" on link_codes for select using (auth.uid() = user_id);
create policy "own link codes insert" on link_codes for insert with check (auth.uid() = user_id);
create policy "own link codes delete" on link_codes for delete using (auth.uid() = user_id);

-- ------------------------------- R4 + R6: погашение кода и привязка --

-- Одна связка на аккаунт: привязка из приложения — явное действие владельца,
-- поэтому прежний чат этого аккаунта заменяется. Чат, привязанный к другому
-- аккаунту, молча не переезжает: сначала его отвязывают в том аккаунте.
-- Код проверяется и гасится в той же транзакции, что и привязка.
create or replace function mark_redeem_link_code(p_code text, p_chat_id bigint, p_username text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code     link_codes%rowtype;
  v_owner    uuid;
  v_replaced integer := 0;
begin
  select * into v_code from link_codes where code = p_code for update;
  if not found or v_code.used then
    return jsonb_build_object('status', 'invalid');
  end if;
  if v_code.expires_at <= now() then
    return jsonb_build_object('status', 'expired');
  end if;

  select user_id into v_owner from telegram_links where telegram_chat_id = p_chat_id for update;
  if v_owner is not null and v_owner <> v_code.user_id then
    return jsonb_build_object('status', 'chat_taken'); -- код не тратится
  end if;

  update link_codes set used = true where code = p_code;

  delete from telegram_links where user_id = v_code.user_id and telegram_chat_id <> p_chat_id;
  get diagnostics v_replaced = row_count;

  insert into telegram_links (telegram_chat_id, user_id, telegram_username)
  values (p_chat_id, v_code.user_id, p_username)
  on conflict (telegram_chat_id) do update set telegram_username = excluded.telegram_username;

  return jsonb_build_object('status', case when v_owner is null then 'linked' else 'already' end,
                            'replaced', v_replaced);
end;
$$;

revoke all on function mark_redeem_link_code(text, bigint, text) from public, anon, authenticated;

create unique index if not exists telegram_links_one_per_user on telegram_links (user_id);

-- -------------------------------------------- D08: доставка напоминаний --

-- Отметка ставилась до отправки, и сорвавшееся напоминание считалось
-- доставленным. Теперь запись проходит состояния: processing (захвачено) →
-- sent (Telegram подтвердил) или unknown (ответа нет — повторять вслепую
-- нельзя, мог прийти дубль). Явный отказ Telegram снимает захват, и следующий
-- запуск пробует снова, пока окно не закрылось.
alter table sent_notifications add column if not exists status text not null default 'sent';
alter table sent_notifications add column if not exists detail text;
alter table sent_notifications drop constraint if exists sent_notifications_status_check;
alter table sent_notifications add constraint sent_notifications_status_check
  check (status in ('processing', 'sent', 'unknown', 'failed'));

-- ------------------------------------------ D09: часовой пояс аккаунта --

-- Раньше каждый вход записывал пояс устройства в аккаунт, и устройства меняли
-- его друг другу, а с ним — время напоминаний. Теперь пояс устройства
-- записывается только в аккаунт без пояса; иначе приложение спрашивает.
-- legacy — пояс остался от прежнего поведения и никем не подтверждён.
alter table user_settings add column if not exists timezone_source text not null default 'legacy';
alter table user_settings drop constraint if exists user_settings_timezone_source_check;
alter table user_settings add constraint user_settings_timezone_source_check
  check (timezone_source in ('legacy', 'device', 'confirmed'));
