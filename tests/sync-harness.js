// Стенд приёмочных сценариев A11 и A13 для движка синхронизации.
//
// Работает против настоящего сервера (mark-ops и mark_get_state) под сессией
// аккаунта: из tests/.session.json (не коммитится) или из формы входа. «Устройство» —
// отдельный экземпляр движка со своей базой IndexedDB, как у отдельного
// браузера. Отключение сети изображается на уровне транспорта: запрос не
// выходит из страницы вовсе, и это считается, чтобы доказать, что офлайн-правки
// не утекли на сервер раньше времени.

import { SyncEngine } from "../js/mark/engine.js";
import { createTransport } from "../js/mark/transport.js";
import { deleteLocalDb } from "../js/mark/localdb.js";

const LS = "mark-harness:";
const out = document.getElementById("out");

function log(...args) {
  const line = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
  out.textContent += line + "\n";
  console.log("[harness]", ...args);
}

function flag(name, device) { return `${LS}${name}:${device}`; }
function get(name, device) { return localStorage.getItem(flag(name, device)); }
function set(name, device, value) {
  if (value == null) localStorage.removeItem(flag(name, device));
  else localStorage.setItem(flag(name, device), String(value));
}
function bump(name, device) { set(name, device, Number(get(name, device) || 0) + 1); }

function readJournal(device) {
  try { return JSON.parse(get("journal", device) || "[]"); } catch { return []; }
}
function writeJournal(device, entry) {
  const j = readJournal(device);
  j.push(entry);
  set("journal", device, JSON.stringify(j));
}

// Сессия: либо файл tests/.session.json, либо обычный вход владельцем
// аккаунта в форме на странице. Хранилище входа отдельное от приложения на том
// же адресе, чтобы стенд не трогал его сессию.
let session = null;
let authClient = null;

async function loadSession() {
  const res = await fetch(`./.session.json?t=${Date.now()}`, { cache: "no-store" }).catch(() => null);
  if (res?.ok) {
    const file = await res.json();
    session = { user_id: file.user_id, token: async () => file.access_token };
    return session;
  }
  const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = await import("../js/mark/transport.js");
  authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { storageKey: "mark-harness-auth" } });
  let { data } = await authClient.auth.getSession();
  if (!data.session) {
    const form = document.getElementById("login");
    form.hidden = false;
    await new Promise((resolve) => {
      form.onsubmit = async (e) => {
        e.preventDefault();
        const { error } = await authClient.auth.signInWithPassword({
          email: form.email.value.trim(), password: form.password.value,
        });
        form.password.value = "";
        if (error) { log("вход не удался:", error.message); return; }
        form.hidden = true;
        resolve();
      };
    });
    ({ data } = await authClient.auth.getSession());
  }
  session = {
    user_id: data.session.user.id,
    token: async () => (await authClient.auth.getSession()).data.session?.access_token || null,
  };
  return session;
}

// fetch устройства: «нет сети» — запрос не уходит; «сбой после отправки» —
// запрос доходит до сервера, а ответ теряется вместе со страницей.
function deviceFetch(device) {
  return async (url, init) => {
    const kind = url.includes("/functions/v1/mark-ops") ? "ops" : "read";
    if (get("offline", device) === "1") {
      bump(`blocked-${kind}`, device);
      throw new TypeError("Failed to fetch (harness: offline)");
    }
    bump(`sent-${kind}`, device);
    const res = await fetch(url, init);
    if (kind === "ops") {
      const body = await res.clone().json().catch(() => null);
      writeJournal(device, { status: res.status, results: body?.results?.map((r) => ({ id: r.operation_id, status: r.status, repeat: !!r.repeat })) });
      if (get("crash-after-send", device) === "1") {
        set("crash-after-send", device, null);
        set("crashed", device, "1");
        log(`устройство ${device}: сервер ответил, страница закрывается до обработки ответа`);
        location.reload();
        return new Promise(() => {}); // ответ так и не будет обработан
      }
    }
    return res;
  };
}

function transportFor(device) {
  return createTransport({
    getAccessToken: () => session.token(),
    fetchImpl: deviceFetch(device),
  });
}

function dbName(device) { return `mark-test:${device}:${session.user_id}`; }

async function openDevice(device) {
  const e = new SyncEngine({ userId: session.user_id, transport: transportFor(device), dbName: dbName(device) });
  return e.open();
}

async function resetDevice(device) {
  await deleteLocalDb(dbName(device));
  for (const k of Object.keys(localStorage)) if (k.startsWith(LS) && k.endsWith(`:${device}`)) localStorage.removeItem(k);
}

// Сравниваемое содержимое: только значимые поля, без служебных пометок.
const TASK_FIELDS = ["id", "group_id", "title", "notes", "planned_date", "due_date", "priority", "completed", "position"];
function norm(view) {
  const pick = (r, f) => Object.fromEntries(f.map((k) => [k, r[k] ?? null]));
  return {
    groups: view.groups.map((g) => pick(g, ["id", "section_id", "name", "color", "position"])).sort((a, b) => a.id.localeCompare(b.id)),
    tasks: view.tasks.map((t) => pick(t, TASK_FIELDS)).sort((a, b) => a.id.localeCompare(b.id)),
  };
}

async function serverView() {
  const r = await createTransport({ getAccessToken: () => session.token() }).getState(session.user_id, null);
  if (r.kind !== "ok") throw new Error(`чтение сервера: ${r.kind} ${r.message || ""}`);
  return { groups: r.state.groups, tasks: r.state.tasks, raw: r.state };
}

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: !!ok, detail });
  log(`${ok ? "OK  " : "FAIL"} ${name}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`);
}
function takeChecks() {
  const c = checks.splice(0);
  return { passed: c.filter((x) => x.ok).length, failed: c.filter((x) => !x.ok).map((x) => x.name), checks: c };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ------------------------------------------------------------------ A11 --
// Два устройства одновременно добавляют разные задачи и редактируют разные
// существующие задачи — все изменения сохраняются.

async function a11() {
  log("\n=== A11 ===");
  await resetDevice("A");
  await resetDevice("B");
  const A = await openDevice("A");
  const B = await openDevice("B");

  await A.sync();
  const group = await A.createGroup({ name: "A11 группа", color: "#3fb98c" });
  const t1 = await A.createTask({ title: "A11 общая задача 1", group_id: group, position: 1 });
  const t2 = await A.createTask({ title: "A11 общая задача 2", group_id: group, position: 2 });
  await A.sync();
  await B.sync();
  check("B видит исходные задачи A", B.view.tasks.some((t) => t.id === t1) && B.view.tasks.some((t) => t.id === t2));

  // Оба уходят в офлайн и правят параллельно — самый частый реальный случай:
  // телефон и компьютер, каждый со своей очередью.
  set("offline", "A", 1);
  set("offline", "B", 1);
  const ta = await A.createTask({ title: "A11 новая с устройства A", group_id: group, position: 3 });
  await A.updateTask(t1, { title: "A11 общая задача 1 — правка с A" });
  const tb = await B.createTask({ title: "A11 новая с устройства B", group_id: group, position: 4 });
  await B.updateTask(t2, { notes: "заметка с устройства B" });
  await B.completeTask(t2, true);

  const opsA = A.outbox.map((o) => o.operation_id);
  const opsB = B.outbox.map((o) => o.operation_id);
  check("очереди до отправки: A=2, B=3", opsA.length === 2 && opsB.length === 3, { A: opsA.length, B: opsB.length });

  set("offline", "A", null);
  set("offline", "B", null);
  // Одновременная отправка: два запроса к серверу в полёте в одно время.
  await Promise.all([A.sync("online"), B.sync("online")]);
  // Второй проход — каждое устройство забирает правки другого.
  await Promise.all([A.sync("recheck"), B.sync("recheck")]);

  const server = await serverView();
  const sv = norm(server);
  const av = norm(A.view);
  const bv = norm(B.view);

  check("очереди пусты на обоих", A.outbox.length === 0 && B.outbox.length === 0, { A: A.outbox.length, B: B.outbox.length });
  check("конфликтов и отказов нет", !A.status().conflicts.length && !B.status().conflicts.length && !A.status().failed.length && !B.status().failed.length);
  check("A и B показывают одно и то же", same(av, bv));
  check("A совпадает с сервером", same(av, sv));
  const s = Object.fromEntries(server.tasks.map((t) => [t.id, t]));
  check("задача с A есть ровно одна", server.tasks.filter((t) => t.id === ta).length === 1);
  check("задача с B есть ровно одна", server.tasks.filter((t) => t.id === tb).length === 1);
  check("правка A в задаче 1 сохранена", s[t1]?.title === "A11 общая задача 1 — правка с A", s[t1]?.title);
  check("правка B в задаче 2 сохранена", s[t2]?.notes === "заметка с устройства B" && s[t2]?.completed === true, { notes: s[t2]?.notes, completed: s[t2]?.completed });
  check("ревизии: задача 1 = 2, задача 2 = 3", s[t1]?.revision === 2 && s[t2]?.revision === 3, { t1: s[t1]?.revision, t2: s[t2]?.revision });
  check("статус обоих — synced", A.status().state === "synced" && B.status().state === "synced", { A: A.status().state, B: B.status().state });

  A.close();
  B.close();
  return { ...takeChecks(), ids: { group, t1, t2, ta, tb }, operation_ids: [...opsA, ...opsB] };
}

// ------------------------------------------------------------------ A13 --
// Без сети создать, изменить и завершить задачи, закрыть PWA, открыть снова и
// восстановить сеть — очередь сохранена и применена один раз.

async function a13Prepare() {
  log("\n=== A13, шаг 1: правки без сети ===");
  await resetDevice("P");
  const P = await openDevice("P");
  await P.sync();
  const group = await P.createGroup({ name: "A13 группа", color: "#f2a541" });
  const x = await P.createTask({ title: "A13 существующая задача", group_id: group, position: 1 });
  await P.sync();
  check("исходная задача на сервере", (await serverView()).tasks.some((t) => t.id === x));

  const sentBeforeOffline = Number(get("sent-ops", "P") || 0);
  set("offline", "P", 1);
  const n1 = await P.createTask({ title: "A13 новая 1 (офлайн)", group_id: group, position: 2 });
  const n2 = await P.createTask({ title: "A13 новая 2 (офлайн)", group_id: group, position: 3 });
  await P.updateTask(x, { title: "A13 существующая задача — изменена офлайн" });
  await P.completeTask(x, true);
  await P.updateTask(n1, { notes: "дописано офлайн" });
  await P.completeTask(n2, true);
  await P.sync("offline-attempt");

  const ops = P.outbox.map((o) => o.operation_id);
  check("в очереди 6 операций", ops.length === 6, ops.length);
  check("статус — нет сети", P.status().state === "offline", P.status().state);
  check("на экране новые задачи и изменения", P.view.tasks.some((t) => t.id === n1) && P.view.tasks.find((t) => t.id === x)?.completed === true);
  check("ни одна операция не ушла на сервер, попытки остановлены",
    Number(get("sent-ops", "P") || 0) === sentBeforeOffline && Number(get("blocked-ops", "P") || 0) > 0,
    { sent: Number(get("sent-ops", "P") || 0) - sentBeforeOffline, blocked: Number(get("blocked-ops", "P") || 0) });
  const ids = { group, x, n1, n2 };
  set("ids", "P", JSON.stringify(ids));
  set("ops", "P", JSON.stringify(ops));
  // База закрывается как при закрытии приложения; вкладку закрывает внешний шаг.
  P.close();
  return { ...takeChecks(), ids, operation_ids: ops, note: "теперь закрыть вкладку и открыть стенд заново" };
}

async function a13Reopen() {
  log("\n=== A13, шаг 2: открыто заново, сети всё ещё нет ===");
  const ids = JSON.parse(get("ids", "P") || "{}");
  const ops = JSON.parse(get("ops", "P") || "[]");
  const P = await openDevice("P");
  check("очередь пережила закрытие: те же 6 операций", same(P.outbox.map((o) => o.operation_id), ops), P.outbox.length);
  check("правки видны сразу после открытия", P.view.tasks.find((t) => t.id === ids.x)?.title === "A13 существующая задача — изменена офлайн"
    && P.view.tasks.find((t) => t.id === ids.n1)?.notes === "дописано офлайн"
    && P.view.tasks.find((t) => t.id === ids.n2)?.completed === true);
  const before = await serverView();
  check("сервер их пока не видел", !before.tasks.some((t) => t.id === ids.n1) && before.tasks.find((t) => t.id === ids.x)?.completed === false);

  log("восстанавливаю сеть");
  set("offline", "P", null);
  await P.sync("online");
  await P.sync("recheck");

  const server = await serverView();
  const s = Object.fromEntries(server.tasks.map((t) => [t.id, t]));
  check("очередь пуста", P.outbox.length === 0, P.outbox.length);
  check("статус — synced", P.status().state === "synced", P.status().state);
  check("экран совпадает с сервером", same(norm(P.view), norm(server)));
  check("задача X изменена и выполнена, ревизия 3", s[ids.x]?.title === "A13 существующая задача — изменена офлайн" && s[ids.x]?.completed && s[ids.x]?.revision === 3, s[ids.x] && { title: s[ids.x].title, completed: s[ids.x].completed, revision: s[ids.x].revision });
  check("новая 1 создана с заметкой, ревизия 2", s[ids.n1]?.notes === "дописано офлайн" && s[ids.n1]?.revision === 2);
  check("новая 2 создана и выполнена, ревизия 2", s[ids.n2]?.completed === true && s[ids.n2]?.revision === 2);
  check("новые задачи не задвоились", server.tasks.filter((t) => t.title.startsWith("A13 новая")).length === 2);
  check("completed_at проставил сервер", !!s[ids.x]?.completed_at && !!s[ids.n2]?.completed_at);

  const sentBefore = Number(get("sent-ops", "P") || 0);
  await P.sync("again");
  check("повторная сверка ничего не отправляет", Number(get("sent-ops", "P") || 0) === sentBefore);
  P.close();
  return { ...takeChecks(), ids, operation_ids: ops, journal: readJournal("P") };
}

// Жёсткий вариант A13: запрос дошёл, сервер применил, а ответ потерян вместе
// со страницей. После открытия очередь отправляется снова с теми же id.
async function a13LostPrepare() {
  log("\n=== A13, потерянный ответ: шаг 1 ===");
  await resetDevice("L");
  const L = await openDevice("L");
  await L.sync();
  const group = await L.createGroup({ name: "A13L группа" });
  await L.sync();
  set("offline", "L", 1);
  const y = await L.createTask({ title: "A13L новая (ответ потеряется)", group_id: group });
  await L.completeTask(y, true);
  const ops = L.outbox.map((o) => o.operation_id);
  set("ids", "L", JSON.stringify({ group, y }));
  set("ops", "L", JSON.stringify(ops));
  set("journal", "L", null); // в журнале остаётся только отправка, которая «потеряется»
  set("offline", "L", null);
  set("crash-after-send", "L", 1);
  log("сеть есть, отправляю — страница закроется, не дождавшись обработки ответа");
  await L.sync("online"); // до конца не дойдёт: страница перезагрузится
  return { note: "не должно было сюда дойти" };
}

async function a13LostReopen() {
  log("\n=== A13, потерянный ответ: шаг 2 ===");
  const { y } = JSON.parse(get("ids", "L") || "{}");
  const ops = JSON.parse(get("ops", "L") || "[]");
  check("страница действительно закрылась посреди отправки", get("crashed", "L") === "1");
  const journal = readJournal("L");
  check("первая отправка дошла до сервера и применена", journal.length === 1 && journal[0].results?.every((r) => r.status === "applied" && !r.repeat), journal);
  const L = await openDevice("L");
  check("после открытия операции всё ещё в очереди как неподтверждённые", same(L.outbox.map((o) => o.operation_id), ops) && L.outbox.every((o) => o.state === "pending"));
  await L.sync("reopen");
  await L.sync("recheck");
  const j2 = readJournal("L");
  check("повтор распознан сервером как повтор", j2.length === 2 && j2[1].results?.every((r) => r.repeat), j2[1]);
  const server = await serverView();
  check("задача ровно одна", server.tasks.filter((t) => t.id === y).length === 1);
  const t = server.tasks.find((t) => t.id === y);
  check("ревизия 2 — ни одна операция не применена дважды", t?.revision === 2 && t?.completed === true, t && { revision: t.revision, completed: t.completed });
  check("очередь пуста, статус synced", L.outbox.length === 0 && L.status().state === "synced", L.status().state);
  L.close();
  return { ...takeChecks(), operation_ids: ops, journal: j2 };
}

// ------------------------------------------------------------ запуск --

async function boot() {
  // Сервис-воркер приложения отдаёт файлы из кэша раньше сети; стенд должен
  // работать строго со свежим кодом.
  if (navigator.serviceWorker?.controller) {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
    log("снят сервис-воркер, перезагрузка");
    location.reload();
    return;
  }
  await loadSession();
  log(`сессия загружена, user_id=${session.user_id}`);
  window.H = {
    a11, a13Prepare, a13Reopen, a13LostPrepare, a13LostReopen,
    serverView, resetDevice, openDevice, readJournal,
    ready: true,
  };
  // шаги, которые должны продолжиться сами после перезагрузки страницы
  if (get("crashed", "L") === "1" && !get("lost-done", "L")) {
    set("lost-done", "L", 1);
    window.H.lastReport = await a13LostReopen();
  }
}

boot().catch((e) => log("ОШИБКА", String(e && e.stack || e)));
