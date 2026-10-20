# Прокси к Supabase

В части сетей (в России без VPN) домен `supabase.co` недоступен, и приложение
не может ни синхронизироваться, ни обратиться к помощнику. Поэтому клиент ходит
через прокси на сервере владельца; при его недоступности — напрямую.

## Сервер

VPS Webdock `mark1.vps.webdock.cloud` (193.180.213.33), Ubuntu 24.04. На нём же
VPN: Xray (VLESS + Reality) на 443 и AmneziaWG. Прокси — в Caddy на порту 8443,
рядом с мини-приложением VPN-бота. Добавлено 20.10.2026, копия прежнего файла —
`/etc/caddy/Caddyfile.bak-20261020-094616`.

Блок в `/etc/caddy/Caddyfile` внутри сайта `mark1.vps.webdock.cloud:8443`
(перед `handle /api/*`):

```caddy
handle /sb/* {
	uri strip_prefix /sb
	reverse_proxy https://ofgicgqsmjvpsrvzefib.supabase.co {
		header_up Host ofgicgqsmjvpsrvzefib.supabase.co
		header_up -X-Forwarded-Host
	}
}
```

Применение без простоя: `sudo caddy validate --config /etc/caddy/Caddyfile`,
затем `sudo systemctl reload caddy`. Откат — вернуть копию и `reload`.
Журналы запросов у сайта отключены (`log { output discard }`): данные только
пересылаются и не хранятся. Через прокси идут вход, задачи, функции и Realtime
(WebSocket).

## Клиент

`js/mark/endpoint.js`: `API_URL` — прокси; `apiFetch` при сетевой ошибке
повторяет тот же запрос напрямую и следующие 10 минут пробует прямой путь
первым. HTTP-ошибки сервера — это ответ, а не повод сменить путь. Ключ
сохранённого входа закреплён прежним (`sb-ofgicgqsmjvpsrvzefib-auth-token`),
чтобы смена адреса никого не разлогинила. Тесты: `scripts/test-endpoint.mjs`.

## Ограничения

- Realtime идёт только через прокси; если сервер выключен, живые обновления
  пропадают, но сверка по возврату в приложение и по сети продолжается.
- У прокси тот же IP, что у VPN: блокировка IP заденет и его.
- Ссылки из писем (восстановление пароля) ведут на `supabase.co`.
- Веб-версия грузит supabase-js с `cdn.jsdelivr.net`; сборка для iPhone —
  нет (библиотека встроена). Для веба без VPN это отдельный вопрос.
