// Маршрут до Supabase: прокси первым, прямой путь — только при сетевой ошибке.
import { apiFetch, resetRoute, timing, PROXY_URL, DIRECT_URL } from "../js/mark/endpoint.js";

let fails = 0;
const ok = (name, cond) => { console.log(`${cond ? "PASS" : "FAIL"} ${name}`); if (!cond) fails++; };
// Проба прокси (/auth/v1/health) — служебная, в счёт запросов не идёт.
const isProbe = (url) => url === PROXY_URL + "/auth/v1/health";
const fake = (down) => { const calls = []; return { calls, impl: async (url) => { if (!isProbe(url)) calls.push(url); if (down.some((d) => url.startsWith(d))) throw new TypeError("Load failed"); return { ok: true, status: 200, url }; } }; };

resetRoute();
let f = fake([]);
await apiFetch(PROXY_URL + "/rest/v1/x", {}, f.impl);
ok("обычно — через прокси, один запрос", f.calls.length === 1 && f.calls[0] === PROXY_URL + "/rest/v1/x");

f = fake([PROXY_URL]);
const r = await apiFetch(PROXY_URL + "/functions/v1/mark-ops", { method: "POST" }, f.impl);
ok("прокси недоступен — тот же путь напрямую", r.url === DIRECT_URL + "/functions/v1/mark-ops" && f.calls.length === 2);

f = fake([PROXY_URL]);
await apiFetch(PROXY_URL + "/auth/v1/token", {}, f.impl);
ok("после сбоя прокси прямой путь пробуется первым", f.calls[0].startsWith(DIRECT_URL) && f.calls.length === 1);

f = fake([DIRECT_URL]);
await apiFetch(PROXY_URL + "/auth/v1/token", {}, f.impl);
ok("прямой путь снова недоступен — возврат к прокси", f.calls.length === 2 && f.calls[1].startsWith(PROXY_URL));
f = fake([]);
await apiFetch(PROXY_URL + "/rest/v1/y", {}, f.impl);
ok("и дальше снова прокси первым", f.calls[0].startsWith(PROXY_URL));

resetRoute();
f = { calls: [], impl: async (url) => { if (!isProbe(url)) f.calls.push(url); return { ok: false, status: 500 }; } };
const e = await apiFetch(PROXY_URL + "/rest/v1/z", {}, f.impl);
ok("HTTP-ошибка — это ответ, другой путь не пробуется", e.status === 500 && f.calls.length === 1);

const ctrl = new AbortController(); ctrl.abort();
f = { calls: [], impl: async (url) => { f.calls.push(url); throw new DOMException("aborted", "AbortError"); } };
let threw = false;
try { await apiFetch(PROXY_URL + "/rest/v1/z", { signal: ctrl.signal }, f.impl); } catch { threw = true; }
ok("отмена запроса не превращается в повтор", threw && f.calls.length === 1);


// Выключенный сервер: прокси не отвечает вовсе, запрос висит до отмены.
timing.probeMs = 30;
const silent = (alsoDirect = false) => {
  const calls = [];
  const impl = (url, opts = {}) => {
    calls.push(url);
    if (url.startsWith(PROXY_URL) || alsoDirect) {
      return new Promise((_, reject) => opts.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    }
    return Promise.resolve({ ok: true, status: 200, url });
  };
  return { calls, impl };
};
resetRoute();
let sl = silent();
let t0 = Date.now();
const viaDirect = await apiFetch(PROXY_URL + "/functions/v1/mark-ops", { method: "POST" }, sl.impl);
ok("прокси молчит — через короткую пробу напрямую", viaDirect.url === DIRECT_URL + "/functions/v1/mark-ops" && Date.now() - t0 < 1000);
ok("молчащий прокси — дальше прямой путь первым", (await apiFetch(PROXY_URL + "/rest/v1/q", {}, sl.impl)).url.startsWith(DIRECT_URL));

resetRoute();
const callerCtrl = new AbortController();
sl = silent(true);
const pending = apiFetch(PROXY_URL + "/rest/v1/w", { signal: callerCtrl.signal }, sl.impl).then(() => "ok", (e) => e.name);
setTimeout(() => callerCtrl.abort(), 5);
ok("отмена вызывающим при молчащем прокси — без повтора", (await pending) === "AbortError" && sl.calls.filter((u) => u.startsWith(DIRECT_URL)).length === 0);

resetRoute();
let slowCalls = [];
const slow = (url, opts = {}) => {
  slowCalls.push(url);
  if (url.endsWith("/auth/v1/health")) return Promise.resolve({ ok: false, status: 401 });
  return new Promise((res) => setTimeout(() => res({ ok: true, status: 200, url }), 80));
};
const slowRes = await apiFetch(PROXY_URL + "/functions/v1/mark-assistant", { method: "POST" }, slow);
ok("живой прокси с долгим ответом — без повтора напрямую", slowRes.url.startsWith(PROXY_URL) && !slowCalls.some((u) => u.startsWith(DIRECT_URL)));
slowCalls = [];
await apiFetch(PROXY_URL + "/rest/v1/e", {}, slow);
ok("недавно отвечавший прокси — без пробы", slowCalls.length === 1);

// Сеть молча теряет всё (Россия без VPN при выключенном прокси): запрос без
// своего таймаута не висит вечно, а заканчивается сетевой ошибкой.
resetRoute();
timing.routeMs = 60;
sl = silent(true);
t0 = Date.now();
const capErr = await apiFetch(PROXY_URL + "/auth/v1/token", { method: "POST" }, sl.impl).then(() => null, (e) => e);
ok("оба пути молчат — сетевая ошибка, а не вечное ожидание", capErr instanceof TypeError && Date.now() - t0 < 1000);
timing.routeMs = 15000;

f = fake([]);
await apiFetch("https://example.com/other", {}, f.impl);
ok("чужие адреса не трогаются", f.calls[0] === "https://example.com/other");

if (fails) { console.log(`${fails} endpoint checks failed`); process.exit(1); }
console.log("14/14 endpoint checks passed");
