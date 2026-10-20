// Маршрут до сервера Supabase.
//
// В части сетей (в том числе в России без VPN) домен supabase.co недоступен.
// Поэтому приложение ходит через прокси на сервере владельца — он только
// пересылает запросы, ничего не хранит и не пишет в журналы. Если прокси
// недоступен, запрос повторяется напрямую, и следующие 10 минут прямой путь
// пробуется первым. Хуже, чем без прокси, не становится.
//
// Ключ сохранённого входа в supabase-js строится из адреса сервера; он
// закреплён прежним, иначе смена адреса разлогинила бы всех.

export const DIRECT_URL = "https://ofgicgqsmjvpsrvzefib.supabase.co";
export const PROXY_URL = "https://mark1.vps.webdock.cloud:8443/sb";
export const API_URL = PROXY_URL;
export const AUTH_STORAGE_KEY = "sb-ofgicgqsmjvpsrvzefib-auth-token";

const DIRECT_FIRST_MS = 10 * 60 * 1000;
let directFirstUntil = 0;

// Тот же fetch, но с запасным маршрутом. Ответ сервера с любым HTTP-кодом —
// это ответ, а не повод идти другим путём; другой путь пробуется только при
// сетевой ошибке. Повтор безопасен: записи идут с operation_id.
export async function apiFetch(input, init = {}, fetchImpl = (...a) => fetch(...a)) {
  const url = typeof input === "string" ? input : input.url;
  if (!url.startsWith(PROXY_URL) && !url.startsWith(DIRECT_URL)) return fetchImpl(input, init);
  const path = url.startsWith(PROXY_URL) ? url.slice(PROXY_URL.length) : url.slice(DIRECT_URL.length);
  const routes = Date.now() < directFirstUntil ? [DIRECT_URL, PROXY_URL] : [PROXY_URL, DIRECT_URL];
  const req = (base) => typeof input === "string" ? fetchImpl(base + path, init) : fetchImpl(new Request(base + path, input), init);
  try {
    return await req(routes[0]);
  } catch (e) {
    if (init?.signal?.aborted) throw e;
    directFirstUntil = routes[0] === PROXY_URL ? Date.now() + DIRECT_FIRST_MS : 0;
    return req(routes[1]);
  }
}

// для тестов
export function resetRoute() { directFirstUntil = 0; }
