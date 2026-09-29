// Интерфейс этапа 2 поверх новой модели. Состояние экрана и события — здесь,
// разметка — в views.js, расчёты — в derive.js.
//
// Перерисовка целиком, но без потерь: всё, что человек вводит, живёт в
// черновиках (data-draft) и возвращается в поля, а фокус и выделение
// восстанавливаются по data-key. Обновление данных не сбрасывает ввод,
// фокус и открытый редактор (раздел 4 ТЗ).

import {
  supabase, getSession, onAuthChange, signIn, signUp, signOut, telegramMiniAppSignIn,
  updateDisplayName, updatePassword, fetchTelegramLink, createLinkCode, unlinkTelegram,
  subscribeTelegramLink, reconcileTimezone, setAccountTimezone,
} from "../sync.js?v=13";
import { ModelStore } from "../mark/store.js";
import { todayIso, hhmm, deviceTimezone, plural } from "./lib.js";
import { overdueKind } from "./derive.js";
import {
  layoutOf, defaultLayout, renderShell, renderHome, renderTasks, renderCalendar, renderAssistant, renderProfile,
  renderAuth, renderSplash, syncLabel,
} from "./views.js";

const root = document.getElementById("app");
const THEME_KEY = "mark:theme";
const DESKTOP = window.matchMedia("(min-width: 1024px)");

const store = new ModelStore({ supabase, source: window.Telegram?.WebApp?.initData ? "miniapp" : "web" });

let session = null;
let authResolved = false;
let tgLoginInFlight = !!window.Telegram?.WebApp?.initData;
let rows = store.rows;
let status = store.status;
let telegram = { status: "loading", link: null };
let telegramChannel = null;
let tz = { prompt: null, device: deviceTimezone() };
let trash = { status: "loading", tasks: [] };

const settings = {
  theme: readTheme(),
  timezone: null,
  morning_digest: true,
  evening_digest: true,
  task_reminders: true,
  workday: { start: "10:00", end: "19:00", buffer: 0 },
  workday_start: "10:00",
  workday_end: "19:00",
  buffer_minutes: 0,
  week_start: 1,
  new_task_date: "inbox",
  morning_time: "09:00",
  evening_time: "21:00",
  reminder_lead: 30,
  quiet_enabled: false,
  quiet_start: "23:00",
  quiet_end: "08:00",
};

function syncWorkday() {
  settings.workday = { start: hhmm(settings.workday_start), end: hhmm(settings.workday_end), buffer: Number(settings.buffer_minutes) || 0 };
}

const today0 = todayIso();
const ui = {
  quick: "",
  search: "",
  layoutDraft: null, // { phone|desktop: [...] } в режиме настройки главной
  layoutKind: null,
  layoutMsg: "",
  focusPick: false,
  editor: null,      // { id|null, draft, error }
  manage: null,      // { form: null|{kind,id,name,color,section_id} }
  confirm: null,     // { title, text, ok, danger, moveOptions, moveTo, onOk }
  showDone: false,
  calMonth: today0.slice(0, 7),
  selectedDate: today0,
  saved: {},         // key → { cls, text } — «Сохраняется / Сохранено / Не удалось»
  profile: {},
  linkCode: null,
  telegramMsg: "",
  auth: { mode: "signin", email: "", error: "", message: "", busy: false },
};

// ------------------------------------------------------------------- тема --

function readTheme() {
  try { return localStorage.getItem(THEME_KEY) || "system"; } catch { return "system"; }
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* только на эту сессию */ }
  const tg = window.Telegram?.WebApp;
  if (tg) {
    // шапка и фон Mini App согласуются с темой приложения (раздел 4)
    const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
    try { tg.setHeaderColor(bg); tg.setBackgroundColor(bg); } catch { /* старые клиенты Telegram */ }
  }
}
applyTheme(settings.theme);
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => applyTheme(settings.theme));

// ---------------------------------------------------------------- маршрут --

function parseRoute() {
  const h = location.hash.replace(/^#\/?/, "");
  const [name, query] = h.split("?");
  const params = Object.fromEntries(new URLSearchParams(query || ""));
  const known = ["home", "tasks", "calendar", "assistant", "profile"];
  return { name: known.includes(name) ? name : "home", params };
}
let route = parseRoute();
if (route.name === "calendar" && route.params.date) { ui.selectedDate = route.params.date; ui.calMonth = route.params.date.slice(0, 7); }

window.addEventListener("hashchange", () => {
  route = parseRoute();
  if (route.name === "calendar" && route.params.date) selectDate(route.params.date);
  if (route.name === "profile" && telegram.status === "loading") loadTelegram();
  if (route.name === "tasks" && route.params.view === "trash") loadTrash();
  openFromLink();
  if (route.name !== "tasks" && ui.editor && DESKTOP.matches) ui.editor = null;
  render();
  window.scrollTo(0, 0);
});

function go(hash) {
  if (location.hash === hash) render(); else location.hash = hash;
}

function selectDate(iso) {
  ui.selectedDate = iso;
  ui.calMonth = iso.slice(0, 7);
}

// ---------------------------------------------------------------- рендер --

function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function context() {
  return {
    rows, status, today: todayIso(), nowMin: nowMinutes(), route, ui, session, settings,
    telegram, tz, trash, isDesktop: DESKTOP.matches,
  };
}

function render() {
  const focus = captureFocus();
  if (!session) {
    root.innerHTML = !authResolved || tgLoginInFlight ? renderSplash() : renderAuth(ui.auth);
  } else {
    const ctx = context();
    const page = { home: renderHome, tasks: renderTasks, calendar: renderCalendar, assistant: renderAssistant, profile: renderProfile }[route.name] || renderHome;
    root.innerHTML = renderShell(ctx, page(ctx));
  }
  restoreFocus(focus);
}

function captureFocus() {
  const el = document.activeElement;
  if (!el || !root.contains(el) || !el.dataset?.key) return null;
  let sel = null;
  try { sel = [el.selectionStart, el.selectionEnd]; } catch { /* date/time поля */ }
  return { key: el.dataset.key, sel };
}

function restoreFocus(f) {
  const el = f ? root.querySelector(`[data-key="${CSS.escape(f.key)}"]`) : root.querySelector("[autofocus]");
  if (!el) return;
  el.focus({ preventScroll: true });
  if (f?.sel && f.sel[0] != null) { try { el.setSelectionRange(f.sel[0], f.sel[1]); } catch { /* не текст */ } }
}

// Черновики: путь вида "editor.title" → ui.editor.draft.title и т.п.
function setDraft(path, value) {
  const [head, ...rest] = path.split(".");
  if (head === "quick") ui.quick = value;
  else if (head === "editor" && ui.editor) ui.editor.draft[rest[0]] = value;
  else if (head === "manage" && ui.manage?.form) ui.manage.form[rest[1]] = value;
  else if (head === "confirm" && ui.confirm) ui.confirm.moveTo = value;
  else if (head === "profile") ui.profile[rest[0]] = value;
  else if (head === "auth") ui.auth[rest[0]] = value;
  else if (head === "search") { ui.search = value; render(); }
}

// ------------------------------------------------------------------ данные --

// Ссылка «Открыть» из бота: #/tasks?open=<id> — открыть эту задачу, как только
// она есть в данных (раньше данных её может не быть).
let openedFromLink = null;
function openFromLink() {
  const id = route.params.open;
  if (!id || openedFromLink === id || !rows.tasks.some((t) => t.id === id)) return;
  openedFromLink = id;
  openEditor(id);
}

store.subscribe(() => {
  rows = store.rows;
  openFromLink();
  // задачу, открытую в редакторе, удалили на другом устройстве
  if (ui.editor?.id && !rows.tasks.some((t) => t.id === ui.editor.id)) ui.editor.error = "Эта задача удалена на другом устройстве. Сохранение создаст её заново как новую.";
  render();
});

let lastStatusKey = "";
store.onStatus((s) => {
  status = s;
  const key = `${syncLabel(s).text}|${(s.conflicts || []).length}|${(s.failed || []).length}`;
  if (key !== lastStatusKey) { lastStatusKey = key; render(); }
  // модель аккаунта сменили на сервере (откат) — нужен прежний интерфейс
  if (s.mode === "legacy" && session) switchToLegacy(session.user.id);
});

function switchToLegacy(userId) {
  try { localStorage.setItem("mark:mode:" + userId, "legacy"); } catch { /* ниже всё равно перезагрузка */ }
  location.reload();
}

async function checkAccountMode(userId) {
  const { data, error } = await supabase.from("mark_account_mode").select("mode").eq("user_id", userId).maybeSingle();
  if (error) return;
  const mode = data?.mode === "legacy" ? "legacy" : "v2";
  try { localStorage.setItem("mark:mode:" + userId, mode); } catch { /* не страшно */ }
  if (mode === "legacy") switchToLegacy(userId);
}

async function loadSettings(userId) {
  const { data, error } = await supabase.from("user_settings")
    .select("timezone, theme, morning_digest, evening_digest, task_reminders, workday_start, workday_end, buffer_minutes, week_start, new_task_date, home_layout, home_layout_version, focus, morning_time, evening_time, reminder_lead, quiet_enabled, quiet_start, quiet_end").eq("user_id", userId).maybeSingle();
  if (error || !session || session.user.id !== userId) return;
  if (data) {
    settings.timezone = data.timezone;
    for (const k of ["morning_digest", "evening_digest", "task_reminders"]) settings[k] = data[k] ?? true;
    for (const k of ["workday_start", "workday_end", "buffer_minutes", "week_start", "new_task_date", "home_layout", "home_layout_version", "focus",
      "morning_time", "evening_time", "reminder_lead", "quiet_enabled", "quiet_start", "quiet_end"]) {
      if (data[k] !== undefined && data[k] !== null) settings[k] = data[k];
    }
    syncWorkday();
    if (data.theme && data.theme !== settings.theme) { settings.theme = data.theme; applyTheme(data.theme); }
  }
  render();
}

// Каждая настройка показывает «Сохраняется → Сохранено / Не удалось сохранить».
async function saveSetting(key, patch, savedKey = key) {
  ui.saved[savedKey] = { cls: "", text: "Сохраняется…" };
  render();
  const { error } = await supabase.from("user_settings")
    .update({ ...patch, updated_at: new Date().toISOString() }).eq("user_id", session.user.id);
  ui.saved[savedKey] = error ? { cls: "bad", text: "Не удалось сохранить" } : { cls: "ok", text: "Сохранено" };
  render();
  if (!error) setTimeout(() => { if (ui.saved[savedKey]?.cls === "ok") { delete ui.saved[savedKey]; render(); } }, 2500);
  return !error;
}

async function checkTimezone(userId) {
  const r = await reconcileTimezone(userId);
  if (!session || session.user.id !== userId) return;
  if (r.account) settings.timezone = r.account;
  let chosen = null;
  try { chosen = localStorage.getItem("mark:tz-choice:" + userId); } catch { /* спросим снова */ }
  tz.prompt = r.status === "differs" && chosen !== `${r.account}|${r.device}` ? { account: r.account, device: r.device } : null;
  render();
}

async function loadTrash() {
  if (!session || !store.userId) return;
  trash = { ...trash, status: trash.tasks.length ? "ok" : "loading" };
  render();
  const r = await store.fetchTrash();
  trash = r.ok ? { status: "ok", tasks: r.tasks || [], keep_days: r.keep_days } : { status: "error", tasks: [] };
  render();
}

async function loadTelegram() {
  if (!session) return;
  const userId = session.user.id;
  telegram = await fetchTelegramLink(userId);
  if (telegram.status === "linked") ui.linkCode = null;
  render();
  if (!telegramChannel) {
    telegramChannel = subscribeTelegramLink(userId, async () => {
      telegram = await fetchTelegramLink(userId);
      if (telegram.status === "linked") { ui.linkCode = null; ui.telegramMsg = ""; }
      render();
    });
  }
}

// --------------------------------------------------------------------- вход --

onAuthChange((next) => {
  authResolved = true;
  if (next) tgLoginInFlight = false;
  const prevId = session?.user?.id;
  session = next;
  if (next && next.user.id !== prevId) {
    const userId = next.user.id;
    store.attachUser(userId);
    checkAccountMode(userId);
    loadSettings(userId);
    checkTimezone(userId);
    telegram = { status: "loading", link: null };
    if (route.name === "profile") loadTelegram();
    if (route.name === "tasks" && route.params.view === "trash") setTimeout(loadTrash, 500);
  } else if (!next && prevId) {
    store.detachUser();
    rows = store.rows;
    if (telegramChannel) { telegramChannel.unsubscribe(); telegramChannel = null; }
    Object.assign(ui, { editor: null, manage: null, confirm: null, quick: "", linkCode: null, telegramMsg: "", saved: {}, profile: {} });
    tz = { prompt: null, device: deviceTimezone() };
  }
  render();
});

async function tryTelegramAutoLogin() {
  const tg = window.Telegram?.WebApp;
  if (!tg?.initData) { tgLoginInFlight = false; return; }
  tg.ready();
  tg.expand();
  try {
    if (await getSession()) return;
    const result = await telegramMiniAppSignIn(tg.initData);
    if (!result.ok && result.reason === "not_linked") {
      ui.auth.message = "Этот Telegram ещё не привязан к аккаунту MARK. Войдите по email, затем в кабинете подключите Telegram.";
    }
  } finally {
    tgLoginInFlight = false;
    render();
  }
}

// ----------------------------------------------------------------- задачи --

const emptyDraft = (over = {}) => ({
  title: "", notes: "", group_id: "", planned_date: "", planned_time: "", due_date: "", due_time: "",
  duration_minutes: "", priority: "normal", ...over,
});

function openEditor(id, defaults = {}) {
  if (id) {
    const t = rows.tasks.find((x) => x.id === id);
    if (!t) return;
    ui.editor = { id, error: "", draft: emptyDraft({
      title: t.title, notes: t.notes || "", group_id: t.group_id || "",
      planned_date: t.planned_date || "", planned_time: hhmm(t.planned_time), due_date: t.due_date || "", due_time: hhmm(t.due_time),
      duration_minutes: t.duration_minutes ? String(t.duration_minutes) : "", priority: t.priority || "normal",
    }) };
  } else {
    ui.editor = { id: null, error: "", draft: emptyDraft(defaults) };
  }
  if (DESKTOP.matches && !id && route.name !== "tasks") { /* на компьютере новая задача — диалогом поверх */ }
  render();
}

function saveEditor() {
  const ed = ui.editor;
  const d = ed.draft;
  const title = String(d.title || "").trim();
  if (!title) { ed.error = "Нужно название задачи."; render(); return; }
  if (d.planned_time && !d.planned_date) { ed.error = "Для времени «на» укажите дату — время без даты не сохраняется."; render(); return; }
  if (d.due_time && !d.due_date) { ed.error = "Для времени дедлайна укажите дату."; render(); return; }
  const fields = {
    title, notes: d.notes || "", group_id: d.group_id || null,
    planned_date: d.planned_date || null, planned_time: d.planned_time || null,
    due_date: d.due_date || null, due_time: d.due_time || null,
    duration_minutes: d.duration_minutes ? Number(d.duration_minutes) : null, priority: d.priority || "normal",
  };
  const exists = ed.id && rows.tasks.some((t) => t.id === ed.id);
  if (exists) store.updateTaskV2(ed.id, fields, { timezone: settings.timezone });
  else store.createTaskV2(fields, { timezone: settings.timezone });
  ui.editor = null;
  render();
}

function quickAdd(title) {
  title = title.trim();
  if (!title) return;
  const fields = { title };
  // Без названной даты — во «Входящие»; в контексте дня — на этот день.
  if (route.name === "tasks" && route.params.view === "today") fields.planned_date = todayIso();
  else if (route.name === "calendar") fields.planned_date = ui.selectedDate;
  else if (settings.new_task_date === "today") fields.planned_date = todayIso();
  store.createTaskV2(fields, { timezone: settings.timezone });
  ui.quick = "";
  render();
}

function moveToToday(id) {
  const t = rows.tasks.find((x) => x.id === id);
  if (!t) return;
  const today = todayIso();
  const kind = overdueKind(t, today);
  // Просроченный дедлайн переносится явно — сам он не меняется никогда.
  if (kind === "overdue" || (t.due_date && t.due_date <= today)) store.updateTaskV2(id, { due_date: today, due_time: t.due_time }, { timezone: settings.timezone });
  else store.updateTaskV2(id, { planned_date: today, planned_time: t.planned_time }, { timezone: settings.timezone });
}

// -------------------------------------------------------- разделы и группы --

function startStructureForm(kind, id, sectionId) {
  const src = id ? (kind === "group" ? rows.groups : rows.sections).find((x) => x.id === id) : null;
  ui.manage.form = { kind, id: id || null, name: src?.name || "", color: src?.color || (kind === "group" ? "#7FA7D9" : "#6ED6A0"),
    section_id: src?.section_id || sectionId || rows.sections[0]?.id || "" };
  render();
}

function saveStructure() {
  const f = ui.manage.form;
  const name = String(f.name || "").trim();
  if (!name) return;
  if (f.kind === "section") {
    if (f.id) store.updateSection(f.id, { name, color: f.color });
    else store.createSectionV2({ name, color: f.color });
  } else if (f.id) {
    const g = rows.groups.find((x) => x.id === f.id);
    store.updateGroup(f.id, { name, color: f.color });
    if (g && f.section_id && g.section_id !== f.section_id) store.engine?.updateGroup(f.id, { section_id: f.section_id });
  } else {
    store.createGroupV2({ name, section_id: f.section_id || null, color: f.color });
  }
  ui.manage.form = null;
  render();
}

function confirmDeleteGroup(id) {
  const g = rows.groups.find((x) => x.id === id);
  if (!g) return;
  const n = rows.tasks.filter((t) => t.group_id === id && !t.completed).length;
  const all = rows.tasks.filter((t) => t.group_id === id).length;
  const others = rows.groups.filter((x) => x.id !== id);
  const moveOptions = all ? [...others.map((o) => ({ value: o.id, label: `в группу «${o.name}»` })), { value: "__inbox", label: "во «Входящие» без группы" }, { value: "__delete", label: "удалить вместе с задачами" }] : null;
  ui.confirm = {
    title: `Удалить группу «${g.name}»?`,
    text: all ? `В группе ${all} ${plural(all, "задача", "задачи", "задач")}, из них открытых — ${n}. По умолчанию задачи переносятся.` : "Группа пустая.",
    ok: "Удалить группу", danger: true, moveOptions, moveTo: moveOptions ? moveOptions[0].value : null,
    onOk: async (moveTo) => {
      if (moveTo === "__inbox") {
        for (const t of rows.tasks.filter((x) => x.group_id === id)) await store.engine.updateTask(t.id, { group_id: null });
        await store.deleteGroupV2(id);
      } else await store.deleteGroupV2(id, { moveTo: moveTo && moveTo !== "__delete" ? moveTo : null });
    },
  };
  render();
}

function confirmDeleteSection(id) {
  const s = rows.sections.find((x) => x.id === id);
  if (!s) return;
  const groups = rows.groups.filter((g) => g.section_id === id);
  const tasks = rows.tasks.filter((t) => groups.some((g) => g.id === t.group_id)).length;
  const others = rows.sections.filter((x) => x.id !== id);
  const moveOptions = groups.length ? [...others.map((o) => ({ value: o.id, label: `группы — в раздел «${o.name}»` })), { value: "__delete", label: "удалить группы и задачи" }] : null;
  ui.confirm = {
    title: `Удалить раздел «${s.name}»?`,
    text: groups.length ? `В разделе ${groups.length} ${plural(groups.length, "группа", "группы", "групп")} и ${tasks} ${plural(tasks, "задача", "задачи", "задач")}. По умолчанию группы с задачами переносятся.` : "Раздел пустой.",
    ok: "Удалить раздел", danger: true, moveOptions, moveTo: moveOptions ? moveOptions[0].value : null,
    onOk: (moveTo) => store.deleteSectionV2(id, { moveTo: moveTo && moveTo !== "__delete" ? { section: moveTo } : null }),
  };
  render();
}

// --------------------------------------------------------------- события --

const actions = {
  "new-task": (el) => {
    const defaults = {};
    if (el.dataset.date) defaults.planned_date = el.dataset.date;
    else if (route.name === "calendar") defaults.planned_date = ui.selectedDate;
    else if (route.name === "tasks" && route.params.view === "today") defaults.planned_date = todayIso();
    else if (settings.new_task_date === "today") defaults.planned_date = todayIso();
    if (el.dataset.group) defaults.group_id = el.dataset.group;
    openEditor(null, defaults);
  },
  "open-task": (el) => openEditor(el.dataset.id),
  "close-editor": () => { ui.editor = null; render(); },
  toggle: (el) => {
    const t = rows.tasks.find((x) => x.id === el.dataset.id);
    if (!t) return;
    store.setCompleted(t.id, !t.completed);
    if (el.dataset.close) ui.editor = null;
  },
  "delete-task": (el) => {
    const t = rows.tasks.find((x) => x.id === el.dataset.id);
    if (!t) return;
    ui.confirm = { title: "Удалить задачу?", text: `«${t.title}» будет удалена на всех устройствах.`, ok: "Удалить", danger: true,
      onOk: () => { store.deleteTask(t.id); ui.editor = null; } };
    render();
  },
  "move-today": (el) => moveToToday(el.dataset.id),
  "toggle-done": () => { ui.showDone = !ui.showDone; render(); },
  "cal-prev": () => { shiftMonth(-1); },
  "cal-next": () => { shiftMonth(1); },
  "cal-today": () => { selectDate(todayIso()); render(); },
  "pick-date": (el) => {
    selectDate(el.dataset.date);
    if (el.dataset.go === "calendar") go(`#/calendar?date=${el.dataset.date}`); else render();
  },
  "sync-now": () => store.syncNow(),
  "keep-mine": (el) => store.keepMine(Number(el.dataset.seq)),
  "restore-apply": (el) => store.restoreAndReapply(Number(el.dataset.seq)),
  "save-new": (el) => store.saveAsNew(Number(el.dataset.seq)),
  "restore-task": async (el) => {
    await store.restoreTask(el.dataset.id);
    trash = { ...trash, tasks: trash.tasks.filter((t) => t.id !== el.dataset.id) };
    render();
    setTimeout(loadTrash, 2500);
  },
  "reload-trash": () => loadTrash(),
  "clear-search": () => { ui.search = ""; render(); },
  "set-week-start": (el) => { settings.week_start = Number(el.dataset.value); saveSetting("week_start", { week_start: settings.week_start }, "planning"); },
  "set-new-task-date": (el) => { settings.new_task_date = el.dataset.value; saveSetting("new_task_date", { new_task_date: settings.new_task_date }, "planning"); },
  "export-json": () => exportJson(),
  "layout-edit": () => {
    const { kind, list } = layoutOf(context());
    ui.layoutDraft = { [kind]: list.map((w) => ({ ...w })) };
    ui.layoutKind = kind;
    ui.layoutMsg = "";
    render();
  },
  "layout-cancel": () => { ui.layoutDraft = null; render(); },
  "layout-reset": () => { ui.layoutDraft = { [ui.layoutKind]: defaultLayout(ui.layoutKind) }; render(); },
  "w-move": (el) => {
    const l = ui.layoutDraft[ui.layoutKind], i = Number(el.dataset.i), j = i + Number(el.dataset.dir);
    if (j < 0 || j >= l.length) return;
    [l[i], l[j]] = [l[j], l[i]];
    render();
  },
  "w-col": (el) => { const w = ui.layoutDraft[ui.layoutKind][Number(el.dataset.i)]; w.col = w.col === "side" ? "main" : "side"; render(); },
  "w-hide": (el) => { ui.layoutDraft[ui.layoutKind][Number(el.dataset.i)].hidden = true; render(); },
  "w-add": (el) => {
    const l = ui.layoutDraft[ui.layoutKind];
    const existing = l.find((w) => w.type === el.dataset.type);
    if (existing) existing.hidden = false; else l.push({ type: el.dataset.type, col: "main" });
    render();
  },
  "layout-save": () => saveLayout(),
  "focus-pick": () => { ui.focusPick = !ui.focusPick; render(); },
  "export-csv": () => exportCsv(),
  "discard-mine": (el) => store.discard(Number(el.dataset.seq)),
  "tz-use-device": () => chooseTimezone(tz.prompt?.device),
  "tz-keep": () => chooseTimezone(tz.prompt?.account),
  "set-theme": (el) => {
    settings.theme = el.dataset.theme;
    applyTheme(settings.theme);
    saveSetting("theme", { theme: settings.theme });
  },
  manage: () => { ui.manage = { form: null }; render(); },
  "close-manage": () => { ui.manage = null; render(); },
  "new-section": () => startStructureForm("section"),
  "new-group": (el) => startStructureForm("group", null, el.dataset.section),
  "edit-section": (el) => startStructureForm("section", el.dataset.id),
  "edit-group": (el) => startStructureForm("group", el.dataset.id),
  "cancel-structure": () => { ui.manage.form = null; render(); },
  "pick-color": (el) => { if (ui.manage?.form) { ui.manage.form.color = el.dataset.color; render(); } },
  "delete-group": (el) => confirmDeleteGroup(el.dataset.id),
  "delete-section": (el) => confirmDeleteSection(el.dataset.id),
  "cancel-confirm": () => { ui.confirm = null; render(); },
  "link-telegram": async () => {
    ui.telegramMsg = "";
    ui.linkCode = await createLinkCode(session.user.id);
    if (!ui.linkCode) ui.telegramMsg = "Не удалось создать код привязки. Проверьте связь и попробуйте ещё раз.";
    render();
  },
  "unlink-telegram": async () => {
    ui.telegramMsg = "";
    if (await unlinkTelegram(session.user.id)) telegram = { status: "none", link: null };
    else ui.telegramMsg = "Не удалось отвязать Telegram — связка осталась. Попробуйте ещё раз.";
    render();
  },
  "retry-telegram": () => { telegram = { status: "loading", link: null }; render(); loadTelegram(); },
  logout: () => {
    const n = status?.unconfirmed || 0;
    // A16: выход с неотправленными изменениями — только с явным выбором
    if (n) {
      ui.confirm = { title: "Выйти, не дождавшись отправки?", text: `${n} ${plural(n, "изменение ещё не отправлено", "изменения ещё не отправлены", "изменений ещё не отправлены")}. Они останутся на этом устройстве и уйдут при следующем входе в этот аккаунт; другому аккаунту они не покажутся.`,
        ok: "Выйти", danger: true, onOk: () => signOut() };
      render();
    } else signOut();
  },
  "auth-toggle": () => { ui.auth.mode = ui.auth.mode === "signin" ? "signup" : "signin"; ui.auth.error = ""; ui.auth.message = ""; render(); },
};

// ---------------------------------------------------- рабочий стол, фокус --

// Сохраняется поверх той версии, от которой меняли: одновременная правка с
// другого устройства не стирается молча, а показывается (раздел 5).
async function saveLayout() {
  const kind = ui.layoutKind;
  const layout = { ...(settings.home_layout || {}), [kind]: ui.layoutDraft[kind] };
  const { data, error } = await supabase.rpc("mark_save_home_layout", { p_layout: layout, p_expected: settings.home_layout_version || 0 });
  if (error) { ui.layoutMsg = "Не удалось сохранить раскладку. Проверьте связь и попробуйте ещё раз."; render(); return; }
  if (data.status === "conflict") {
    settings.home_layout = data.layout;
    settings.home_layout_version = data.version;
    ui.layoutMsg = "Раскладку только что изменили на другом устройстве — показана она. Повторите свои изменения поверх неё.";
    ui.layoutDraft = { [kind]: (data.layout?.[kind] || defaultLayout(kind)).map((w) => ({ ...w })) };
    render();
    return;
  }
  settings.home_layout = layout;
  settings.home_layout_version = data.version;
  ui.layoutDraft = null;
  render();
}

async function toggleFocus(id, on) {
  const today = todayIso();
  const cur = settings.focus?.date === today ? [...(settings.focus.ids || [])] : [];
  const ids = on ? [...new Set([...cur, id])].slice(0, 3) : cur.filter((x) => x !== id);
  settings.focus = { date: today, ids };
  render();
  await saveSetting("focus", { focus: settings.focus }, "focus");
}

// ---------------------------------------------------------------- экспорт --

function download(name, type, text) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const clean = (row) => Object.fromEntries(Object.entries(row).filter(([k]) => !k.startsWith("_") && k !== "user_id" && k !== "seq"));

function exportJson() {
  const data = {
    format: "mark-export",
    schema_version: 1,
    exported_at: new Date().toISOString(),
    account: session.user.email,
    note: "Состояние, подтверждённое сервером, плюс изменения этого устройства, ещё не отправленные.",
    sections: rows.sections.map(clean),
    groups: rows.groups.map(clean),
    tasks: rows.tasks.map(clean),
  };
  download(`mark-${todayIso()}.json`, "application/json", JSON.stringify(data, null, 2));
}

function exportCsv() {
  const cell = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ["Название", "Описание", "Раздел", "Группа", "Запланировано на", "Время", "Выполнить до", "Время дедлайна", "Длительность, мин", "Приоритет", "Выполнено", "Выполнено в"];
  const lines = rows.tasks.map((t) => {
    const g = rows.groups.find((x) => x.id === t.group_id);
    const sct = g ? rows.sections.find((x) => x.id === g.section_id) : null;
    return [t.title, t.notes, sct?.name || "", g?.name || "Входящие", t.planned_date, hhmm(t.planned_time), t.due_date, hhmm(t.due_time),
      t.duration_minutes, { low: "низкий", normal: "обычный", high: "высокий" }[t.priority] || "", t.completed ? "да" : "нет", t.completed_at || ""].map(cell).join(";");
  });
  // BOM — чтобы Excel открыл кириллицу без вопросов
  download(`mark-${todayIso()}.csv`, "text/csv", "\ufeff" + [head.join(";"), ...lines].join("\r\n"));
}

function shiftMonth(n) {
  const [y, m] = ui.calMonth.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  ui.calMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  render();
}

async function chooseTimezone(zone) {
  if (!zone || !session) return;
  const prompt = tz.prompt;
  const r = await setAccountTimezone(session.user.id, zone);
  if (r.ok) {
    settings.timezone = zone;
    if (prompt) { try { localStorage.setItem("mark:tz-choice:" + session.user.id, `${zone}|${prompt.device}`); } catch { /* спросим снова */ } }
    tz.prompt = null;
    ui.saved.timezone = { cls: "ok", text: "Сохранено" };
  } else {
    ui.saved.timezone = { cls: "bad", text: "Не удалось сохранить" };
  }
  render();
}

const submits = {
  "save-task": () => saveEditor(),
  "quick-add": (form) => quickAdd(new FormData(form).get("title") || ""),
  "save-structure": () => saveStructure(),
  "confirm-submit": async () => {
    const cf = ui.confirm;
    ui.confirm = null;
    render();
    await cf?.onOk?.(cf.moveTo);
    render();
  },
  "save-name": async (form) => {
    const name = String(new FormData(form).get("name") || "").trim();
    ui.saved.name = { cls: "", text: "Сохраняется…" };
    render();
    const { data, error } = await updateDisplayName(name);
    if (data?.user) session.user = data.user;
    ui.saved.name = error ? { cls: "bad", text: error.message } : { cls: "ok", text: "Сохранено" };
    render();
  },
  "save-password": async (form) => {
    const password = String(new FormData(form).get("password") || "");
    if (password.length < 6) { ui.saved.password = { cls: "bad", text: "Минимум 6 символов" }; render(); return; }
    const { error } = await updatePassword(password);
    ui.saved.password = error ? { cls: "bad", text: error.message } : { cls: "ok", text: "Пароль изменён" };
    form.reset();
    render();
  },
  "auth-submit": async (form) => {
    const fd = new FormData(form);
    const email = String(fd.get("email") || "").trim();
    const password = String(fd.get("password") || "");
    if (!email || !password) return;
    Object.assign(ui.auth, { email, error: "", message: "", busy: true });
    render();
    const { data, error } = ui.auth.mode === "signup" ? await signUp(email, password) : await signIn(email, password);
    ui.auth.busy = false;
    if (error) ui.auth.error = error.message;
    else if (ui.auth.mode === "signup" && !data.session) ui.auth.message = "Проверьте почту и перейдите по ссылке для подтверждения, потом войдите.";
    render();
  },
};

root.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el || el.tagName === "FORM" || el.tagName === "INPUT" || el.tagName === "SELECT") return;
  const fn = actions[el.dataset.action];
  if (fn) { e.preventDefault(); fn(el); }
});

root.addEventListener("submit", (e) => {
  const form = e.target.closest("form[data-action]");
  if (!form) return;
  e.preventDefault();
  submits[form.dataset.action]?.(form);
});

root.addEventListener("input", (e) => {
  const el = e.target;
  if (el.dataset?.draft) setDraft(el.dataset.draft, el.value);
});

root.addEventListener("change", (e) => {
  const el = e.target;
  if (el.dataset?.draft) setDraft(el.dataset.draft, el.value);
  if (el.dataset?.action === "focus-toggle") {
    toggleFocus(el.dataset.id, el.checked);
    return;
  }
  if (el.dataset?.action === "set-setting") {
    const key = el.dataset.setting;
    settings[key] = el.checked;
    saveSetting(key, { [key]: el.checked }, "notify");
    if (key === "quiet_enabled") render();
  } else if (el.dataset?.action === "set-timezone") {
    chooseTimezone(el.value);
  } else if (el.dataset?.notifyInput) {
    const key = el.dataset.notifyInput;
    const value = key === "reminder_lead" ? Number(el.value) : el.value;
    if (!value) return;
    settings[key] = value;
    saveSetting(key, { [key]: value }, "notify");
  } else if (el.dataset?.settingInput) {
    const key = el.dataset.settingInput;
    const value = key === "buffer_minutes" ? Number(el.value) : el.value;
    if (!value && key !== "buffer_minutes") return;
    const next = { ...settings, [key]: value };
    if (hhmm(next.workday_end) <= hhmm(next.workday_start)) {
      ui.saved.planning = { cls: "bad", text: "Конец рабочего дня должен быть позже начала" };
      render();
      return;
    }
    settings[key] = value;
    syncWorkday();
    saveSetting(key, { [key]: value }, "planning");
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (ui.confirm) ui.confirm = null;
  else if (ui.manage) ui.manage = null;
  else if (ui.editor) ui.editor = null;
  else return;
  render();
});

DESKTOP.addEventListener("change", () => render());

// День и «сейчас» меняются сами: раз в минуту — перерисовка (ввод не теряется).
setInterval(() => { if (session) render(); }, 60000);

render();
tryTelegramAutoLogin();
