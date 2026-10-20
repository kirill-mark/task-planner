// Маршрут до Supabase: прокси первым, прямой путь — только при сетевой ошибке.
import { apiFetch, resetRoute, PROXY_URL, DIRECT_URL } from "../js/mark/endpoint.js";

let fails = 0;
const ok = (name, cond) => { console.log(`${cond ? "PASS" : "FAIL"} ${name}`); if (!cond) fails++; };
const fake = (down) => { const calls = []; return { calls, impl: async (url) => { calls.push(url); if (down.some((d) => url.startsWith(d))) throw new TypeError("Load failed"); return { ok: true, status: 200, url }; } }; };

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
f = { calls: [], impl: async (url) => { f.calls.push(url); return { ok: false, status: 500 }; } };
const e = await apiFetch(PROXY_URL + "/rest/v1/z", {}, f.impl);
ok("HTTP-ошибка — это ответ, другой путь не пробуется", e.status === 500 && f.calls.length === 1);

const ctrl = new AbortController(); ctrl.abort();
f = { calls: [], impl: async (url) => { f.calls.push(url); throw new DOMException("aborted", "AbortError"); } };
let threw = false;
try { await apiFetch(PROXY_URL + "/rest/v1/z", { signal: ctrl.signal }, f.impl); } catch { threw = true; }
ok("отмена запроса не превращается в повтор", threw && f.calls.length === 1);

f = fake([]);
await apiFetch("https://example.com/other", {}, f.impl);
ok("чужие адреса не трогаются", f.calls[0] === "https://example.com/other");

if (fails) { console.log(`${fails} endpoint checks failed`); process.exit(1); }
console.log("8/8 endpoint checks passed");
