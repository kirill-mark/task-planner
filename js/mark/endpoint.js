// Маршрут до сервера Supabase.
//
// В части сетей (в том числе в России без VPN) домен supabase.co недоступен.
// Поэтому приложение ходит через прокси на сервере владельца — он только
// пересылает запросы, ничего не хранит и не пишет в журналы. Если прокси
// недоступен или молчит, запрос повторяется напрямую, и следующие 10 минут
// прямой путь пробуется первым. Хуже, чем без прокси, не становится.
//
// Ключ сохранённого входа в supabase-js строится из адреса сервера; он
// закреплён прежним, иначе смена адреса разлогинила бы всех.

export const DIRECT_URL = "https://ofgicgqsmjvpsrvzefib.supabase.co";
export const PROXY_URL = "https://mark1.vps.webdock.cloud:8443/sb";
export const API_URL = PROXY_URL;
export const AUTH_STORAGE_KEY = "sb-ofgicgqsmjvpsrvzefib-auth-token";

const DIRECT_FIRST_MS = 10 * 60 * 1000;
let directFirstUntil = 0;

// Выключенный сервер не отвечает отказом — запрос просто висит до таймаута
// системы (около минуты), а таймаут вызывающего (20 с у сверки) отменял его
// раньше, чем дело доходило до прямого пути. Поэтому, пока прокси не отвечал
// недавно, рядом с запросом идёт короткая проба: нет ответа за PROBE_MS —
// запрос снимается и уходит напрямую. Медленный, но живой ответ (помощник)
// пробу не задевает: она смотрит только, отвечает ли сам прокси.
export const timing = { probeMs: 4000, proxyOkMs: 2 * 60 * 1000, routeMs: 15000 };
let proxyOkUntil = 0;

function unreachable() { return new TypeError("proxy unreachable"); }

function probeProxy(fetchImpl) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timing.probeMs);
  // Любой HTTP-ответ, даже 401 без ключа, значит, что прокси жив.
  return fetchImpl(PROXY_URL + "/auth/v1/health", { signal: ctrl.signal, cache: "no-store" })
    .then(() => true, () => false)
    .finally(() => clearTimeout(timer));
}

async function viaProxy(send, init, fetchImpl) {
  if (Date.now() < proxyOkUntil) return send(PROXY_URL, init);
  const ctrl = new AbortController();
  const outer = init?.signal;
  const relay = () => ctrl.abort(outer.reason);
  if (outer) { if (outer.aborted) relay(); else outer.addEventListener("abort", relay, { once: true }); }
  const main = send(PROXY_URL, { ...init, signal: ctrl.signal });
  try {
    const dead = probeProxy(fetchImpl).then((alive) => alive ? new Promise(() => {}) : "dead");
    const first = await Promise.race([main, dead]);
    if (first === "dead") {
      ctrl.abort();
      main.catch(() => {});
      throw unreachable();
    }
    return first;
  } finally {
    outer?.removeEventListener("abort", relay);
  }
}

// Тот же fetch, но с запасным маршрутом. Ответ сервера с любым HTTP-кодом —
// это ответ, а не повод идти другим путём; другой путь пробуется только при
// сетевой ошибке или молчании прокси. Повтор безопасен: записи идут с
// operation_id.
export async function apiFetch(input, init = {}, fetchImpl = (...a) => fetch(...a)) {
  const url = typeof input === "string" ? input : input.url;
  if (!url.startsWith(PROXY_URL) && !url.startsWith(DIRECT_URL)) return fetchImpl(input, init);
  const path = url.startsWith(PROXY_URL) ? url.slice(PROXY_URL.length) : url.slice(DIRECT_URL.length);
  const send = (base, opts) => typeof input === "string" ? fetchImpl(base + path, opts) : fetchImpl(new Request(base + path, input), opts);
  // Запросы входа (supabase-js) идут без своего таймаута: при сети, которая
  // молча теряет пакеты, они висели бы бесконечно, а вместе с ними — запуск
  // приложения. Поэтому у каждого пути без таймаута вызывающего есть предел.
  const capped = (run) => async (base) => {
    if (init?.signal) return run(base, init);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timing.routeMs);
    try {
      return await run(base, { ...init, signal: ctrl.signal });
    } catch (e) {
      throw ctrl.signal.aborted ? new TypeError("route timed out") : e;
    } finally {
      clearTimeout(timer);
    }
  };
  const go = capped(async (base, opts) => {
    if (base !== PROXY_URL) return send(base, opts);
    const res = await viaProxy(send, opts, fetchImpl);
    proxyOkUntil = Date.now() + timing.proxyOkMs;
    return res;
  });
  const routes = Date.now() < directFirstUntil ? [DIRECT_URL, PROXY_URL] : [PROXY_URL, DIRECT_URL];
  try {
    return await go(routes[0]);
  } catch (e) {
    if (init?.signal?.aborted) throw e;
    if (routes[0] === PROXY_URL) proxyOkUntil = 0;
    directFirstUntil = routes[0] === PROXY_URL ? Date.now() + DIRECT_FIRST_MS : 0;
    return go(routes[1]);
  }
}

// для тестов
export function resetRoute() { directFirstUntil = 0; proxyOkUntil = 0; }
