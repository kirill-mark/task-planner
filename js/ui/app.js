// Интерфейс этапа 2 поверх новой модели. Состояние экрана и события — здесь,
// разметка — в views.js, расчёты — в derive.js.
//
// Перерисовка целиком, но без потерь: всё, что человек вводит, живёт в
// черновиках (data-draft) и возвращается в поля, а фокус и выделение
// восстанавливаются по data-key. Обновление данных не сбрасывает ввод,
// фокус и открытый редактор (раздел 4 ТЗ).

import {
  supabase, getSession, onAuthChange, signIn, signUp, signOut, requestPasswordReset, telegramMiniAppSignIn,
  updateDisplayName, updatePassword, fetchTelegramLink, createLinkCode, unlinkTelegram,
  subscribeTelegramLink, reconcileTimezone, setAccountTimezone,
} from "../sync.js?v=13";
import { ModelStore } from "../mark/store.js";
import { exportFile } from "../file-export.js";
import { memoryRequest, memoryDay, scopedNote, activeMemory, noteDate, recallChats } from "../assistant-memory.js";
import { readChats, writeChats, beginConversation, appendMemory } from "../assistant-chats.js";
import { routeForWidgetOpen } from "../widget-snapshot.js";
import { getDeviceSpeech } from "../device-speech.js";
import { getDeviceWidget } from "../device-widget.js";
import { getDeviceNotifications } from "../device-notifications.js";
import { syncModalScroll, pageScrollY, scrollPageTo } from "./modal-scroll.js";
import { createMotion } from "./motion.js";
import { clearOverdue } from "./clear-overdue.js";
import { todayIso, hhmm, deviceTimezone, plural, addDays, shortDate } from "./lib.js";
import { overdueKind, dayLoad } from "./derive.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../mark/transport.js";
import { apiFetch } from "../mark/endpoint.js";
import {
  layoutOf, defaultLayout, renderShell, renderHome, renderTasks, renderCalendar, renderAssistant, renderProfile,
  renderAuth, renderSplash, syncLabel,
} from "./views.js";

const root = document.getElementById("app");
const motion = createMotion(root, () => syncModalScroll(root));
const THEME_KEY = "mark:theme";
const DESKTOP = window.matchMedia("(min-width: 1024px)");

const store = new ModelStore({ supabase, source: window.Telegram?.WebApp?.initData ? "miniapp" : "web" });
const deviceNotifications = getDeviceNotifications();
const deviceWidget = getDeviceWidget();
const deviceSpeech = getDeviceSpeech();
let speechBase = "";
let speechOwner = null;
let speechScreen = false;
let assistantRequest = null;
let iphoneWidget = deviceWidget?.getState() || null;
let pendingWidgetOpen = null;
let iphoneReminders = deviceNotifications?.getState() || null;

function updateIphoneReminders() {
  deviceWidget?.update({ userId: session?.user?.id || null, tasks: store.rows.tasks,
    ready: !!store.engine && store.userId === session?.user?.id,
    timezone: settings.timezone || deviceTimezone() || "UTC" });
  applyWidgetOpen();
  deviceNotifications?.update({ userId: session?.user?.id || null, tasks: store.rows.tasks,
    ready: !!store.engine && store.userId === session?.user?.id,
    timezone: settings.timezone || deviceTimezone() || "UTC" });
}

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
  assistant_consent_at: null,
  assistant_brief: true,
  assistant_confirm_all: true,
};

function syncWorkday() {
  settings.workday = { start: hhmm(settings.workday_start), end: hhmm(settings.workday_end), buffer: Number(settings.buffer_minutes) || 0 };
}

const today0 = todayIso();
function readTasksMode() {
  try { return localStorage.getItem("mark:tasks-mode") === "projects" ? "projects" : "list"; } catch { return "list"; }
}

const ui = {
  quick: "",
  search: "",
  layoutDraft: null, // { phone|desktop: [...] } в режиме настройки главной
  layoutKind: null,
  layoutMsg: "",
  focusPick: false,
  mainPick: false,   // лист выбора главной задачи
  tasksMode: readTasksMode(), // «Списком» | «По проектам», хранится на телефоне
  tasksMenu: false, tasksFilters: false, searchOpen: false,
  projectQuery: "", projectMenu: false, projectForm: null, // { id|null, name, error }
  toast: null,       // { text, label, action } — сообщение внизу на 5 секунд
  assistant: { chat: [], input: "", busy: false },
  editor: null,      // { id|null, draft, error }
  manage: null,      // { form: null|{kind,id,name,color,section_id} }
  confirm: null,     // { title, text, ok, danger, moveOptions, moveTo, onOk }
  showDone: false,
  overdueCleanup: null,
  trashCleanup: null,
  more: {},          // «Показать ещё»: ключ списка → сколько добавлено
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

// Возврат на экран — с тем же положением прокрутки; из кабинета — на экран,
// с которого в него пришли (A38). Выбранный день и фильтры живут в адресе и ui.
const scrollMemory = new Map();
let lastHash = location.hash || "#/home";

window.addEventListener("hashchange", () => {
  scrollMemory.set(lastHash, pageScrollY());
  if (scrollMemory.size > 30) scrollMemory.delete(scrollMemory.keys().next().value);
  const from = lastHash;
  lastHash = location.hash || "#/home";
  route = parseRoute();
  ui.tasksMenu = false; ui.tasksFilters = false; ui.projectMenu = false;
  if (route.name !== "tasks") ui.searchOpen = false;
  if (route.name !== "assistant") deviceSpeech?.cancel();
  if (route.name === "profile" && !from.startsWith("#/profile")) ui.profileFrom = from;
  if (route.name === "calendar" && route.params.date) selectDate(route.params.date);
  if (route.name === "profile" && telegram.status === "loading") loadTelegram();
  if (route.name === "tasks" && route.params.view === "trash") loadTrash();
  openFromLink();
  if (route.name !== "tasks" && ui.editor && DESKTOP.matches) ui.editor = null;
  render();
  scrollPageTo(scrollMemory.get(lastHash) ?? 0);
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
  if (deviceSpeech) ui.assistant.voice = deviceSpeech.getState();
  return {
    rows, status, today: todayIso(), nowMin: nowMinutes(), route, ui, session, settings,
    telegram, tz, trash, iphoneReminders, iphoneWidget, speechAvailable: !!deviceSpeech, isDesktop: DESKTOP.matches,
    proposalStatus: (id) => store.proposalStatus(id), applyingProposal: (id) => applying.has(id),
  };
}

function render() {
  const transition = motion.before({ route: session ? route.name : 'auth',
    editor: ui.editor ? (ui.editor.id || 'new') : null,
    panel: ui.assistant.panel, thread: ui.assistant.threadId });
  const focus = captureFocus();
  const transcript = root.querySelector(".assistant-transcript");
  const chatScroll = transcript?.scrollTop || 0;
  const atEnd = !transcript || transcript.scrollHeight - chatScroll - transcript.clientHeight < 90;
  const openDetails = [...root.querySelectorAll("details[data-detail][open]")].map((el) => el.dataset.detail);
  const onChat = !!session && route.name === "assistant";
  if (ui.editor && (deviceSpeech?.getState().phase || "idle") !== "idle") deviceSpeech.cancel();
  if (speechScreen !== onChat) { speechScreen = onChat; deviceSpeech?.setScreenActive(onChat); }

  if (!session) {
    root.innerHTML = !authResolved || tgLoginInFlight ? renderSplash() : renderAuth(ui.auth);
  } else {
    const ctx = context();
    const page = { home: renderHome, tasks: renderTasks, calendar: renderCalendar, assistant: renderAssistant, profile: renderProfile }[route.name] || renderHome;
    root.innerHTML = renderShell(ctx, page(ctx));
  }
  motion.after(transition);
  syncModalScroll(root);
  restoreFocus(focus);
  root.querySelectorAll("details[data-detail]").forEach((el) => { el.open = openDetails.includes(el.dataset.detail); });
  const nextTranscript = root.querySelector(".assistant-transcript");
  if (nextTranscript) nextTranscript.scrollTop = atEnd || ui.assistant.scrollEnd ? nextTranscript.scrollHeight : chatScroll;
  // Длинный новый ответ показывается с начала, чтобы было видно, как он проявляется.
  if (nextTranscript && ui.assistant.scrollToReply) {
    const replies = nextTranscript.querySelectorAll(".assistant-messages > .bubble.bot");
    const last = replies[replies.length - 1];
    if (last && last.offsetHeight > nextTranscript.clientHeight * 0.6) {
      nextTranscript.scrollTop += last.getBoundingClientRect().top - nextTranscript.getBoundingClientRect().top - 12;
    }
    ui.assistant.scrollToReply = false;
  }
  ui.assistant.scrollEnd = false;
  resizeComposer();
  sizeQuickTitle();
  if (onChat && !ui.assistant.chat.length) ui.assistant.greetingAnimated = true;

}

function resizeComposer() {
  const el = root.querySelector('[data-key="assistant"]');
  if (!el) return;
  el.style.height = "auto";
  el.style.height = Math.min(144, Math.max(32, el.scrollHeight)) + "px";
}
function chatViewport() {
  const v = window.visualViewport;
  document.documentElement.style.setProperty("--chat-height", (v?.height || window.innerHeight) + "px");
  document.documentElement.style.setProperty("--chat-top", (v?.offsetTop || 0) + "px");
  // Высота клавиатуры: на iPhone она перекрывает страницу, не уменьшая её, —
  // листы внизу экрана поднимаются на эту величину и остаются над клавиатурой.
  // В приложении на iPhone высоту присылает нативная часть заранее (MARKBridgeViewController).
  if (window.__markNativeKeyboard) return;
  const kb = v ? Math.max(0, Math.round(window.innerHeight - v.height - v.offsetTop)) : 0;
  document.documentElement.style.setProperty("--kb", (kb > 80 ? kb : 0) + "px");
  document.documentElement.classList.toggle("kb-open", kb > 80);
}
window.visualViewport?.addEventListener("resize", chatViewport);
window.visualViewport?.addEventListener("scroll", chatViewport);
window.addEventListener("resize", chatViewport);
chatViewport();
if (deviceSpeech) {
  deviceSpeech.subscribe((voice) => {
    if (speechOwner !== session?.user?.id || route.name !== "assistant") return;
    const a = ui.assistant;
    a.voice = voice;
    if (voice.text) a.input = (speechBase + (speechBase ? " " : "") + voice.text).slice(0, 2000);
    render();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") deviceSpeech.stop().catch(() => {});
  });
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
  else if (head === "editor" && ui.editor) {
    ui.editor.draft[rest[0]] = value;
    if (!ui.editor.id) {
      ui.editor.touched = true;
      persistDraft();
      const add = root.querySelector(".c-quick .c-add");
      if (add) add.disabled = !String(ui.editor.draft.title || "").trim();
      if (rest[0] === "title") sizeQuickTitle();
    }
  }
  else if (head === "manage" && ui.manage?.form) ui.manage.form[rest[1]] = value;
  else if (head === "confirm" && ui.confirm) ui.confirm.moveTo = value;
  else if (head === "profile") ui.profile[rest[0]] = value;
  else if (head === "auth") ui.auth[rest[0]] = value;
  else if (head === "search") { ui.search = value; render(); }
  else if (head === "projectQuery") { ui.projectQuery = value; render(); }
  else if (head === "projectForm" && ui.projectForm) {
    ui.projectForm.name = value;
    ui.projectForm.error = "";
    const ok = root.querySelector(".c-sheet-ok");
    if (ok) ok.disabled = !value.trim();
  }
  else if (head === "assistantMemory") ui.assistant.memoryDraft = value;
  else if (head === "assistantInput") {
    ui.assistant.input = value;
    saveChat();
    resizeComposer();
    const send = root.querySelector(".assistant-send");
    if (send) send.disabled = !value.trim() || ui.assistant.busy || status?.state === "offline" || (ui.assistant.voice?.phase || "idle") !== "idle";
  }
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
  updateIphoneReminders();
  openFromLink();
  // задачу, открытую в редакторе, удалили на другом устройстве
  if (ui.editor?.id && !rows.tasks.some((t) => t.id === ui.editor.id)) ui.editor.error = "Эта задача удалена на другом устройстве. Сохранение создаст её заново как новую.";
  render();
});

function applyWidgetOpen() {
  if (!pendingWidgetOpen || !authResolved) return;
  const target = routeForWidgetOpen(pendingWidgetOpen, session?.user?.id);
  pendingWidgetOpen = null;
  if (!target) return;
  openedFromLink = null;
  go(target);
  openFromLink();
}
if (deviceWidget) {
  deviceWidget.subscribe((s) => { iphoneWidget = s; render(); });
  deviceWidget.onOpen((value) => { pendingWidgetOpen = value; applyWidgetOpen(); render(); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") deviceWidget.refresh(); });
  window.addEventListener("focus", () => deviceWidget.refresh());
  setInterval(() => { if (document.visibilityState === "visible") deviceWidget.refresh(); }, 60000);
}

if (deviceNotifications) {
  deviceNotifications.subscribe((s) => { iphoneReminders = s; render(); });
  deviceNotifications.onOpenTask((id) => {
    openedFromLink = null;
    go(`#/tasks?open=${encodeURIComponent(id)}`);
    if (route.params.open === id) { openFromLink(); render(); }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") deviceNotifications.refresh();
  });
  window.addEventListener("focus", () => deviceNotifications.refresh());
  setInterval(() => { if (document.visibilityState === "visible") deviceNotifications.refresh(); }, 60000);
}

let lastStatusKey = "";
store.onStatus((s) => {
  status = s;
  const key = `${syncLabel(s).text}|${(s.conflicts || []).length}|${(s.failed || []).length}|${s.proposalsRev ?? 0}`;
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
    .select("timezone, theme, morning_digest, evening_digest, task_reminders, workday_start, workday_end, buffer_minutes, week_start, new_task_date, home_layout, home_layout_version, focus, morning_time, evening_time, reminder_lead, quiet_enabled, quiet_start, quiet_end, assistant_consent_at, assistant_brief, assistant_confirm_all").eq("user_id", userId).maybeSingle();
  if (error || !session || session.user.id !== userId) return;
  if (data) {
    settings.timezone = data.timezone;
    for (const k of ["morning_digest", "evening_digest", "task_reminders"]) settings[k] = data[k] ?? true;
    for (const k of ["workday_start", "workday_end", "buffer_minutes", "week_start", "new_task_date", "home_layout", "home_layout_version", "focus",
      "morning_time", "evening_time", "reminder_lead", "quiet_enabled", "quiet_start", "quiet_end", "assistant_consent_at", "assistant_brief", "assistant_confirm_all"]) {
      if (data[k] !== undefined && data[k] !== null) settings[k] = data[k];
    }
    syncWorkday();
    if (data.theme && data.theme !== settings.theme) { settings.theme = data.theme; applyTheme(data.theme); }
  }
  updateIphoneReminders();
  render();
}

// Каждая настройка показывает «Сохраняется → Сохранено / Не удалось сохранить».
async function saveSetting(key, patch, savedKey = key) {
  const owner = session?.user?.id;
  if (!owner) return false;
  ui.saved[savedKey] = { cls: "", text: "Сохраняется…" };
  render();
  const { error } = await supabase.from("user_settings")
    .update({ ...patch, updated_at: new Date().toISOString() }).eq("user_id", owner);
  if (owner !== session?.user?.id) return false;
  ui.saved[savedKey] = error ? { cls: "bad", text: "Не удалось сохранить" } : { cls: "ok", text: "Сохранено" };
  render();
  if (!error) setTimeout(() => { if (ui.saved[savedKey]?.cls === "ok") { delete ui.saved[savedKey]; render(); } }, 2500);
  return !error;
}

async function checkTimezone(userId) {
  const r = await reconcileTimezone(userId);
  if (!session || session.user.id !== userId) return;
  if (r.account) settings.timezone = r.account;
  updateIphoneReminders();
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
  if (prevId !== next?.user?.id) {
    speechOwner = null;
    deviceSpeech?.cancel();
    assistantRequest?.abort();
    ui.assistant = { chat: [], input: "", busy: false };
    settings.assistant_consent_at = null;
  }
  session = next;
  if (next && next.user.id !== prevId) {
    settings.timezone = null;
    const userId = next.user.id;
    store.attachUser(userId);
    loadChat(userId);
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
    Object.assign(ui, { editor: null, manage: null, confirm: null, quick: "", linkCode: null, telegramMsg: "", saved: {}, profile: {}, overdueCleanup: null, trashCleanup: null, assistant: { chat: [], input: "", busy: false } });
    tz = { prompt: null, device: deviceTimezone() };
  }
  updateIphoneReminders();
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
      ui.auth.message = "Этот Telegram ещё не привязан к аккаунту Mark. Войдите по email, затем в профиле подключите Telegram.";
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

// Черновик новой задачи (решение владельца, docs/design-c/scope.md): начатая
// запись сохраняется на устройстве при каждом изменении и возвращается при
// следующем открытии формы; очищается после добавления или «Удалить черновик».
const draftKey = () => `mark:task-draft:v1:${session?.user?.id || "anon"}`;
const DRAFT_FIELDS = ["title", "notes", "group_id", "planned_date", "planned_time", "due_date", "due_time", "duration_minutes", "priority"];
const draftHasContent = (d) => !!(String(d.title || "").trim() || String(d.notes || "").trim() || d.group_id || d.planned_date || d.due_date);

function readDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(draftKey()) || "null");
    return d && typeof d === "object" && draftHasContent(d) ? d : null;
  } catch { return null; }
}

function writeDraft(d) {
  try { localStorage.setItem(draftKey(), JSON.stringify(Object.fromEntries(DRAFT_FIELDS.map((k) => [k, d[k] ?? ""])))); } catch { /* хранилище недоступно */ }
}

function clearDraft() {
  try { localStorage.removeItem(draftKey()); } catch { /* хранилище недоступно */ }
}

// Запись черновика только для новой задачи и только после действий человека.
function persistDraft() {
  const ed = ui.editor;
  if (!ed || ed.id || !ed.touched) return;
  if (draftHasContent(ed.draft)) writeDraft(ed.draft); else clearDraft();
}

let toastTimer = null;
function showToast(text, label = "", action = null) {
  clearTimeout(toastTimer);
  ui.toast = { text, label, action };
  toastTimer = setTimeout(() => { ui.toast = null; render(); }, 5000);
}

function closeEditor() {
  const ed = ui.editor;
  if (!ed) return;
  ui.editor = null;
  if (!ed.id && ed.touched && draftHasContent(ed.draft)) {
    writeDraft(ed.draft);
    showToast("Черновик сохранён", "Продолжить", () => openEditor(null));
  } else if (!ed.id && !ed.restored) clearDraft();
  render();
}

function sizeQuickTitle() {
  const el = root.querySelector("#quick-title");
  if (!el) return;
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, parseFloat(getComputedStyle(el).lineHeight) * 5 + 22) + "px";
}

async function setMainTask(id) {
  settings.focus = { date: todayIso(), ids: id ? [id] : [] };
  ui.mainPick = false;
  render();
  await saveSetting("focus", { focus: settings.focus }, "focus");
}

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
    const saved = DESKTOP.matches ? null : readDraft();
    ui.editor = saved
      ? { id: null, error: "", mode: "quick", restored: true, touched: true, draft: emptyDraft(saved) }
      : { id: null, error: "", mode: DESKTOP.matches ? "full" : "quick", draft: emptyDraft(defaults) };
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
  else {
    // 6 секунд задача ждёт на телефоне, пока на экране «Отменить» (5 секунд).
    const id = store.createTaskV2(fields, { timezone: settings.timezone, holdMs: 6000 });
    if (!id) {
      ed.error = "Хранилище на телефоне ещё не готово. Текст остался в форме — попробуйте ещё раз через пару секунд.";
      render();
      return;
    }
    clearDraft();
    const today = todayIso();
    const where = fields.group_id ? `в проект «${rows.groups.find((g) => g.id === fields.group_id)?.name || ""}»`
      : fields.planned_date === today ? "в план на сегодня"
      : fields.planned_date ? `в план на ${shortDate(fields.planned_date, { today })}`
      : !fields.due_date ? "во «Входящие»" : "";
    showToast(`Задача добавлена${where ? " " + where : ""}`, "Отменить", () => store.undoCreate(id));
  }
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
  "enable-iphone-reminders": () => deviceNotifications?.enable(),
  "disable-iphone-reminders": () => deviceNotifications?.disable(),
  "test-iphone-reminders": () => deviceNotifications?.test(),
  "retry-iphone-reminders": () => deviceNotifications?.refresh(),
  "new-task": (el) => {
    const defaults = {};
    if (el.dataset.date) defaults.planned_date = el.dataset.date;
    else if (route.name === "calendar") defaults.planned_date = ui.selectedDate;
    else if (route.name === "tasks" && route.params.view === "today") defaults.planned_date = todayIso();
    else if (settings.new_task_date === "today") defaults.planned_date = todayIso();
    if (el.dataset.group) defaults.group_id = el.dataset.group;
    else if (route.name === "tasks" && route.params.project) defaults.group_id = route.params.project;
    if (el.dataset.title) defaults.title = el.dataset.title;
    ui.searchOpen = false;
    openEditor(null, defaults);
  },
  "open-task": (el) => openEditor(el.dataset.id),
  "close-editor": () => closeEditor(),
  "editor-more": () => { if (ui.editor) { ui.editor.mode = "full"; ui.editor.datePick = false; render(); } },
  "quick-date-pick": () => { if (ui.editor) { ui.editor.datePick = !ui.editor.datePick; render(); } },
  "quick-date": (el) => {
    const ed = ui.editor;
    if (!ed) return;
    ed.draft.planned_date = el.dataset.date || "";
    if (!ed.draft.planned_date) ed.draft.planned_time = "";
    ed.datePick = false;
    ed.touched = true;
    persistDraft();
    render();
  },
  "quick-project-clear": () => {
    if (!ui.editor) return;
    ui.editor.draft.group_id = "";
    ui.editor.touched = true;
    persistDraft();
    render();
  },
  "draft-delete": () => {
    clearDraft();
    if (ui.editor) ui.editor = { id: null, error: "", mode: "quick", draft: emptyDraft({}) };
    render();
  },
  "search-open": () => { ui.searchOpen = true; render(); },
  "search-close": () => { ui.searchOpen = false; ui.search = ""; render(); },
  "tasks-mode-menu": () => { ui.tasksMenu = !ui.tasksMenu; render(); },
  "tasks-mode": (el) => {
    ui.tasksMode = el.dataset.mode === "projects" ? "projects" : "list";
    try { localStorage.setItem("mark:tasks-mode", ui.tasksMode); } catch { /* хранилище недоступно */ }
    ui.tasksMenu = false;
    if (route.params.view && route.params.view !== "all") go("#/tasks"); else render();
  },
  "tasks-filters": () => { ui.tasksFilters = true; render(); },
  "tasks-filters-close": (el) => { ui.tasksFilters = false; if (el.tagName === "A") go(el.getAttribute("href")); else render(); },
  "project-menu": () => { ui.projectMenu = !ui.projectMenu; render(); },
  "project-new": () => { ui.projectForm = { id: null, name: "", error: "" }; render(); },
  "project-rename": (el) => {
    const g = rows.groups.find((x) => x.id === el.dataset.id);
    ui.projectMenu = false;
    if (g) ui.projectForm = { id: g.id, name: g.name, error: "" };
    render();
  },
  "project-form-close": () => { ui.projectForm = null; render(); },
  "project-delete": (el) => {
    const g = rows.groups.find((x) => x.id === el.dataset.id);
    ui.projectMenu = false;
    if (!g) return render();
    const n = rows.tasks.filter((t) => t.group_id === g.id).length;
    ui.confirm = { title: `Удалить проект «${g.name}»?`, danger: true, ok: "Удалить проект",
      text: n ? `Удалится только проект. ${n} ${plural(n, "задача останется", "задачи останутся", "задач останутся")} и будут без проекта — их можно найти в общем списке.`
        : "В проекте нет задач. Удалится только сам проект.",
      onOk: async () => {
        await store.deleteProject(g.id);
        go("#/tasks?view=projects");
        showToast(`Проект «${g.name}» удалён`);
        render();
      } };
    render();
  },
  "main-pick": () => { ui.mainPick = true; render(); },
  "main-pick-close": () => { ui.mainPick = false; render(); },
  "main-set": (el) => setMainTask(el.dataset.id),
  "main-clear": () => setMainTask(null),
  "toast-act": () => {
    const t = ui.toast;
    clearTimeout(toastTimer);
    ui.toast = null;
    t?.action?.();
    render();
  },
  toggle: (el) => {
    const t = rows.tasks.find((x) => x.id === el.dataset.id);
    if (!t) return;
    const completing = !t.completed;
    store.setCompleted(t.id, completing);
    if (el.dataset.close) ui.editor = null;
    // Случайное завершение отменяется сразу; повторное касание отметки — тоже отмена.
    if (completing) showToast("Задача выполнена", "Отменить", () => store.setCompleted(t.id, false));
    else if (ui.toast?.text === "Задача выполнена") { clearTimeout(toastTimer); ui.toast = null; }
    render();
  },
  "delete-task": (el) => {
    const t = rows.tasks.find((x) => x.id === el.dataset.id);
    if (!t) return;
    ui.confirm = { title: "Удалить задачу?", text: `«${t.title}» будет удалена на всех устройствах.`, ok: "Удалить", danger: true,
      onOk: () => { store.deleteTask(t.id); ui.editor = null; } };
    render();
  },
  "move-today": (el) => moveToToday(el.dataset.id),
  "clear-overdue": async () => {
    if (ui.overdueCleanup?.busy || !session || !store.engine) return;
    const userId = session.user.id;
    ui.overdueCleanup = { busy: true, text: "Убираем просроченные задачи…" };
    render();
    const result = await clearOverdue(store, todayIso(), nowMinutes());
    if (session?.user?.id !== userId) return;
    ui.overdueCleanup = { busy: false, failed: result.failed,
      text: result.failed
        ? `Убрано в корзину: ${result.moved}. Остальные задачи не удалось убрать — попробуйте ещё раз.`
        : `Убрано в корзину: ${result.moved}. Задачи можно восстановить в разделе «Корзина».` };
    render();
  },
  "toggle-done": () => { ui.showDone = !ui.showDone; render(); },
  "show-more": (el) => { ui.more[el.dataset.key] = (ui.more[el.dataset.key] || 0) + Number(el.dataset.step || 50); render(); },
  "cal-prev": () => { shiftMonth(-1); },
  "cal-next": () => { shiftMonth(1); },
  "cal-today": () => { selectDate(todayIso()); render(); },
  "cal-month-toggle": () => { ui.calMonthOpen = !ui.calMonthOpen; ui.calMonth = (ui.selectedDate || todayIso()).slice(0, 7); render(); },
  "cal-week-prev": () => { selectDate(addDays(ui.selectedDate || todayIso(), -7)); render(); },
  "cal-week-next": () => { selectDate(addDays(ui.selectedDate || todayIso(), 7)); render(); },
  "pick-date": (el) => {
    selectDate(el.dataset.date);
    if (!DESKTOP.matches) ui.calMonthOpen = false;
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
  "empty-trash": () => {
    if (ui.trashCleanup?.busy || trash.status !== "ok" || !trash.tasks.length) return;
    const tasks = trash.tasks.map((t) => ({ ...t }));
    const userId = session?.user?.id;
    ui.confirm = { title: "Очистить корзину?", text: `Будут окончательно удалены задачи из корзины: ${tasks.length}. Восстановить их будет нельзя.`, ok: "Удалить окончательно", danger: true,
      onOk: async () => {
        if (session?.user?.id !== userId) return;
        ui.trashCleanup = { busy: true, text: "Очищаем корзину…" };
        render();
        let result;
        try { result = await store.emptyTrash(tasks); }
        catch { result = { ok: false, message: "Не удалось подтвердить очистку. Обновите корзину и попробуйте снова." }; }
        if (session?.user?.id !== userId) return;
        ui.trashCleanup = { busy: false, failed: !result.ok,
          text: result.ok ? `Удалено окончательно: ${result.count}.` : result.message };
        await loadTrash();
      } };
    render();
  },
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
  "layout-reset": () => {
    ui.confirm = { title: "Вернуть стандартную раскладку?", text: "Виджеты, их порядок и размеры станут как по умолчанию. Задачи не изменятся.", ok: "Вернуть",
      onOk: () => { ui.layoutDraft = { [ui.layoutKind]: defaultLayout(ui.layoutKind) }; } };
    render();
  },
  "w-move": (el) => {
    const l = ui.layoutDraft[ui.layoutKind], i = Number(el.dataset.i), j = i + Number(el.dataset.dir);
    if (j < 0 || j >= l.length) return;
    [l[i], l[j]] = [l[j], l[i]];
    render();
  },
  "w-col": (el) => { const w = ui.layoutDraft[ui.layoutKind][Number(el.dataset.i)]; w.col = w.col === "side" ? "main" : "side"; render(); },
  "w-size": (el) => { ui.layoutDraft[ui.layoutKind][Number(el.dataset.i)].size = el.dataset.size; render(); },
  "w-hide": (el) => { ui.layoutDraft[ui.layoutKind][Number(el.dataset.i)].hidden = true; render(); },
  "w-add": (el) => {
    const l = ui.layoutDraft[ui.layoutKind];
    const existing = l.find((w) => w.type === el.dataset.type);
    if (existing) existing.hidden = false; else l.push({ type: el.dataset.type, col: "main" });
    render();
  },
  "layout-save": () => saveLayout(),
  "assistant-consent": async () => {
    const value = new Date().toISOString();
    const owner = session?.user?.id;
    const ok = await saveSetting("assistant_consent_at", { assistant_consent_at: value }, "assistant");
    if (ok && owner === session?.user?.id) settings.assistant_consent_at = value;
    render();
  },
  "assistant-revoke": () => { deviceSpeech?.cancel(); assistantRequest?.abort(); ui.assistant = { ...ui.assistant, busy: false }; settings.assistant_consent_at = null; saveSetting("assistant_consent_at", { assistant_consent_at: null }, "assistant"); },
  "assistant-voice": async () => {
    if (!deviceSpeech || ui.assistant.busy) return;
    if ((ui.assistant.voice?.phase || "idle") !== "idle") {
      if (ui.assistant.voice?.phase === "starting") await deviceSpeech.cancel();
      else await deviceSpeech.stop();
      return;
    }
    root.querySelector('[data-key="assistant"]')?.blur();
    speechBase = ui.assistant.input.trim();
    speechOwner = session?.user?.id;
    await deviceSpeech.start();
  },
  "assistant-new": () => { createFreshChat(); render(); },
  "assistant-chats": () => { deviceSpeech?.cancel(); ui.assistant.panel = "chats"; render(); },
  "assistant-open-chat": (el) => { saveChat(); activateChat(el.dataset.id); render(); },
  "assistant-close-panel": () => { ui.assistant.panel = null; render(); },
  "assistant-memory": () => {
    deviceSpeech?.cancel(); ui.assistant.panel = "memory";
    ui.assistant.memoryDraft = (ui.assistant.book?.memory || []).join("\n"); render();
  },
  "assistant-memory-save": () => {
    const a = ui.assistant;
    const lines = [...new Set((a.memoryDraft || "").split("\n").map(x => x.trim()).filter(Boolean))];
    if (lines.length > 20 || lines.some(x => x.length > 400)) {
      a.memoryError = "До 20 заметок, каждая — не длиннее 400 символов."; render(); return;
    }
    const previous = a.book.memory; a.book.memory = lines;
    const removed = previous.filter(n => !lines.includes(n));
    const excluded = [];
    for (const t of a.book.threads) for (const m of t.messages) if (m.memoryNote && removed.includes(m.memoryNote) && !m.recallExcluded) { m.recallExcluded = true; excluded.push(m); }
    if (saveChat()) { a.panel = null; a.memoryError = ""; }
    else { a.book.memory = previous; for (const m of excluded) delete m.recallExcluded; }
    render();
  },
  "assistant-ask": (el) => askAssistant(el.dataset.text),
  "assistant-clear": () => {
    ui.confirm = { title: "Очистить этот чат?", text: "Сообщения этого чата удалятся с устройства. Остальные чаты и память останутся.", ok: "Очистить", danger: true,
      onOk: () => { ui.assistant.chat = []; ui.assistant.input = ""; saveChat(); activateChat(ui.assistant.threadId); } };
    render();
  },
  "draft-apply": (el) => applyProposal(ui.assistant.chat[Number(el.dataset.msg)]),
  "draft-cancel": (el) => { const m = ui.assistant.chat[Number(el.dataset.msg)]; if (m) { m.state = "cancelled"; saveChat(); render(); } },
  "draft-undo": (el) => {
    const m = ui.assistant.chat[Number(el.dataset.msg)];
    if (!m || m.state !== "auto") return;
    for (const id of m.created || []) if (id) store.deleteTask(id);
    m.state = "cancelled";
    saveChat();
    render();
  },
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
  "auth-toggle": () => { if (ui.auth.busy) return; ui.auth.mode = ui.auth.mode === "signin" ? "signup" : "signin"; ui.auth.error = ""; ui.auth.message = ""; render(); },
  "auth-recover": () => { if (ui.auth.busy) return; Object.assign(ui.auth, { mode: "recover", error: "", message: "" }); render(); },
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

// ---------------------------------------------------------------- помощник --

// Conversations survive new chats; saved notes and selected user messages carry context.
function activateChat(id) {
  const menu = root.querySelector(".assistant-menu"); if (menu) menu.open = false;
  const book = ui.assistant.book;
  const thread = book?.threads.find(t => t.id === id);
  if (!thread) return;
  deviceSpeech?.cancel(); assistantRequest?.abort();
  book.activeId = id;
  ui.assistant = { book, threadId: id, chat: thread.messages, input: thread.input || "", busy: false,
    greetingIndex: thread.greeting, greetingAnimated: false, scrollEnd: true };
  saveChat();
}
function loadChat(userId) {
  const book = readChats(localStorage, userId);
  ui.assistant.book = book;
  activateChat(book.activeId);
}
function createFreshChat() {
  saveChat();
  const book = ui.assistant.book;
  if (!book) return;
  const t = beginConversation(book);
  activateChat(t.id);
}
// Сворачивание и возврат продолжают текущий разговор с черновиком (UX09 ТЗ v1.1);
// новый чат — только кнопкой «Новый чат». Незаконченный запрос прерывается.
let assistantWasHidden = false;
function assistantAppState(active) {
  if (!active) {
    saveChat(); assistantWasHidden = route.name === "assistant";
    if (assistantWasHidden) { deviceSpeech?.cancel(); assistantRequest?.abort(); }
  } else if (assistantWasHidden) {
    assistantWasHidden = false;
    if (route.name === "assistant" && session) render();
  }
}
// iOS reports actual background transitions, rather than temporary permission sheets.
window.addEventListener("mark:app-state", e => assistantAppState(e.detail?.active === true));
document.addEventListener("visibilitychange", () => {
  if (document.documentElement.dataset.platform !== "ios") assistantAppState(document.visibilityState !== "hidden");
});
function saveChat() {
  const a = ui.assistant, owner = session?.user?.id;
  if (!owner || !a.book) return false;
  const thread = a.book.threads.find(t => t.id === a.threadId);
  if (thread) {
    thread.messages = a.chat; thread.input = a.input; thread.updatedAt = Date.now();
    thread.title = a.chat.find(m => m.role === "user")?.content?.slice(0, 64) || "Новый чат";
  }
  const ok = writeChats(localStorage, owner, a.book);
  a.storageError = ok ? "" : "Не удалось сохранить чаты на устройстве. Проверь свободное место.";
  return ok;
}

// Загрузка дня — тем же расчётом, что и календарь: помощник и календарь не расходятся.
function loadFacts() {
  const out = {};
  for (const [key, day] of [["today", todayIso()], ["tomorrow", addDays(todayIso(), 1)]]) {
    const l = dayLoad(rows, day, settings.workday);
    out[key] = { date: day, busy: l.busy, unknown: l.unknown, free: l.free, workday: l.workday };
  }
  return out;
}

// ------------------------------------------- предложения помощника (пакет A) --

// Каждое действие черновика получает постоянные ID сразу при показе: action_id,
// operation_id и ID объекта (для новой задачи — выданный сервером). Они
// сохраняются в чате, поэтому повторное «Применить» — то же предложение, а не
// новое: копий не будет ни при двойном нажатии, ни после перезапуска.
function withActionIds(drafts) {
  return drafts.map((d) => ({
    ...d,
    action_id: d.action_id || crypto.randomUUID(),
    operation_id: d.operation_id || crypto.randomUUID(),
    id: d.id || (d.type === "create" ? crypto.randomUUID() : d.id),
  }));
}

const applying = new Set();

async function applyProposal(m) {
  if (!m || m.state !== "pending" || !m.drafts?.length) return;
  const owner = session?.user?.id;
  // Сообщение, сохранённое до появления ID (старые чаты), получает их сейчас —
  // и они должны попасть на устройство раньше, чем операции в очередь.
  if (!m.proposal_id || m.drafts.some((d) => !d.action_id || !d.operation_id)) {
    m.proposal_id = m.proposal_id || crypto.randomUUID();
    m.drafts = withActionIds(m.drafts);
  }
  const chosen = m.drafts.filter((d) => !d.skip);
  if (!chosen.length || applying.has(m.proposal_id)) return;
  applying.add(m.proposal_id);
  m.state = "saving";
  m.applyError = "";
  if (!saveChat()) {
    m.state = "pending";
    m.applyError = "Не удалось сохранить чат на устройстве — ничего не применено. Освободите место и повторите.";
    applying.delete(m.proposal_id);
    render();
    return;
  }
  render();
  try {
    await store.applyProposal({
      proposal_id: m.proposal_id,
      actions: chosen.map((d) => ({ action_id: d.action_id, operation_id: d.operation_id, type: d.type,
        entity_id: d.id, base_revision: d.base_revision ?? null, fields: d.fields || {} })),
    }, { timezone: settings.timezone });
    if (owner !== session?.user?.id) return;
    m.state = "submitted"; // дальше статус берётся из операций (store.proposalStatus)
  } catch {
    if (owner !== session?.user?.id) return;
    m.state = "pending";
    m.applyError = "Не удалось сохранить изменения на устройстве — ничего не применено. Попробуйте ещё раз.";
  } finally {
    applying.delete(m.proposal_id);
  }
  saveChat();
  render();
}

async function askAssistant(text) {
  text = String(text || "").trim();
  const a = ui.assistant;
  if (!text || a.busy || !settings.assistant_consent_at || (a.voice?.phase || "idle") !== "idle") return;
  const owner = session?.user?.id;
  const current = () => owner === session?.user?.id && a === ui.assistant && !!settings.assistant_consent_at;
  const at = Date.now(), timezone = settings.timezone || deviceTimezone() || "UTC";
  const request = memoryRequest(text);
  if (request && !request.fact) {
    a.chat.push({ role: "user", content: text, at }, { role: "assistant", content: "Что именно мне запомнить? Напиши само решение или предпочтение — я сохраню его для новых чатов.", at });
    a.input = ""; a.scrollEnd = true; saveChat(); render(); return;
  }
  let memoryNote = null;
  if (request?.fact && a.book) {
    memoryNote = scopedNote(request.fact, at, timezone);
    const memory = appendMemory(a.book.memory, memoryNote);
    if (!memory) { a.storageError = "Память заполнена: удали ненужные заметки в меню → Память."; render(); return; }
    const previous = a.book.memory; a.book.memory = memory;
    if (!saveChat()) { a.book.memory = previous; render(); return; }
  }
  assistantRequest = new AbortController();
  const controller = assistantRequest;
  const timeout = setTimeout(() => controller.abort(), 90000);
  a.scrollEnd = true;
  a.chat.push({ role: "user", content: text, at, ...(memoryNote ? { memoryNote, memoryNotice: noteDate(memoryNote) ? "Сохранено на " + shortDate(noteDate(memoryNote)) : "Сохранено в память" } : {}) });
  a.input = "";
  a.busy = true;
  saveChat();
  render();
  const history = a.chat.slice(-7, -1).map((m) => ({ role: m.role, content: [m.content || "", ...(m.sections || []).map((s) => s.title + ": " + s.items.join("; "))].join("\n").slice(0, 1500) }));
  let reply;
  try {
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    if (!current()) { clearTimeout(timeout); return; }
    const res = await apiFetch(`${SUPABASE_URL}/functions/v1/mark-assistant`, {
      signal: controller.signal,
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message: text, history, memory: activeMemory(a.book?.memory, memoryDay(at, timezone)), recall: recallChats(a.book, a.threadId, text, at, timezone), facts: loadFacts() }),
    });
    const body = await res.json().catch(() => null);
    if (!current()) { clearTimeout(timeout); return; }
    if (!res.ok) {
      const error = res.status === 401 ? "Нужно войти снова."
        : res.status === 403 && body?.error === "consent_required" ? "Помощник выключен. Включите его заново на экране «Помощник», чтобы разрешить передачу данных ИИ-провайдеру."
        : res.status === 429 ? "Лимит ИИ-провайдера на сейчас исчерпан — попробуйте позже. Задачи работают как обычно."
        : "Помощник не ответил. Задачи работают как обычно — попробуйте ещё раз.";
      reply = { role: "assistant", error, at: Date.now() };
      if (!a.input) a.input = text; // черновик сообщения не теряется
    } else {
      const drafts = withActionIds((body.drafts || []).map((d) => ({ ...d, skip: false })));
      reply = { role: "assistant", sections: body.sections || [], content: body.answer || (body.sections?.length ? "" : drafts.length ? "Вот что предлагаю:" : "Не получилось составить ответ. Попробуй уточнить вопрос."), refs: body.refs || [], drafts, rejected: body.rejected || [], state: drafts.length ? "pending" : "none", at: Date.now(),
        ...(drafts.length ? { proposal_id: crypto.randomUUID() } : {}) };

    }
  } catch {
    reply = { role: "assistant", error: "Нет связи с помощником. Задачи работают как обычно.", at: Date.now() };
    if (!a.input) a.input = text;
  }
  clearTimeout(timeout);
  if (assistantRequest === controller) assistantRequest = null;
  a.busy = false;
  if (!current()) return;
  if (!reply.error) {
    // текст проявляется по словам (views.js); по окончании — обычная перерисовка
    reply.revealAt = Date.now(); a.scrollToReply = true;
    setTimeout(() => { if (route.name === "assistant") render(); }, 3100);
  }
  a.chat.push(reply);
  saveChat();
  render();
}

// ---------------------------------------------------------------- экспорт --

async function download(name, type, text) {
  if (ui.profile.exportBusy) return;
  ui.profile.exportBusy = true;
  ui.saved.export = { cls: "", text: "Подготавливаем файл…" };
  render();
  try {
    const result = await exportFile(name, type, text);
    ui.saved.export = { cls: "ok", text: result.kind === "shared" ? "Файл передан выбранному приложению" : result.kind === "download" ? "Файл подготовлен для скачивания" : "" };
  } catch {
    ui.saved.export = { cls: "bad", text: "Не удалось экспортировать файл. Попробуйте снова." };
  } finally {
    ui.profile.exportBusy = false;
    render();
  }
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
    updateIphoneReminders();
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
  "assistant-send": (form) => askAssistant(new FormData(form).get("message") || ""),
  "save-structure": () => saveStructure(),
  "project-save": () => {
    const f = ui.projectForm;
    const name = String(f?.name || "").trim();
    if (!f || !name) return;
    const taken = rows.groups.some((g) => g.id !== f.id && g.name.trim().toLowerCase() === name.toLowerCase());
    if (taken) { f.error = "Проект с таким названием уже есть. Выберите другое название."; render(); return; }
    if (f.id) store.updateGroup(f.id, { name });
    else {
      const id = store.createGroupV2({ name, section_id: null });
      if (!id) { f.error = "Хранилище на телефоне ещё не готово. Попробуйте через пару секунд."; render(); return; }
      ui.projectForm = null;
      go(`#/tasks?project=${encodeURIComponent(id)}`);
      return;
    }
    ui.projectForm = null;
    render();
  },
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
    if (ui.auth.busy) return;
    const fd = new FormData(form);
    const email = String(fd.get("email") || "").trim();
    const password = String(fd.get("password") || "");
    const mode = ui.auth.mode;
    if (!email || (mode !== "recover" && !password)) return;
    Object.assign(ui.auth, { email, error: "", message: "", busy: true });
    render();
    try {
      const { data, error } = mode === "recover" ? await requestPasswordReset(email)
        : mode === "signup" ? await signUp(email, password) : await signIn(email, password);
      if (error) ui.auth.error = mode === "recover" ? "Не удалось отправить письмо. Проверьте соединение и попробуйте позже." : error.message;
      else if (mode === "recover") ui.auth.message = "Если аккаунт с этим email существует, придёт письмо. Откройте ссылку в браузере, задайте новый пароль и вернитесь в Mark для входа.";
      else if (mode === "signup" && !data.session) ui.auth.message = "Проверьте почту и перейдите по ссылке для подтверждения, потом войдите.";
    } catch {
      ui.auth.error = "Не удалось связаться с сервером. Проверьте соединение и попробуйте снова.";
    } finally {
      ui.auth.busy = false;
      render();
    }
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
  if (el.dataset?.action === "draft-pick") {
    const m = ui.assistant.chat[Number(el.dataset.msg)];
    if (m?.state === "pending" && m.drafts?.[Number(el.dataset.i)]) { m.drafts[Number(el.dataset.i)].skip = !el.checked; render(); }
    return;
  }
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
  else if (ui.assistant.panel) ui.assistant.panel = null;
  else if (ui.manage) ui.manage = null;
  else if (ui.mainPick) ui.mainPick = false;
  else if (ui.projectForm) ui.projectForm = null;
  else if (ui.tasksMenu || ui.tasksFilters || ui.projectMenu) { ui.tasksMenu = ui.tasksFilters = ui.projectMenu = false; }
  else if (ui.editor) { closeEditor(); return; }
  else return;
  render();
});

root.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.shiftKey || e.isComposing || e.target.id !== "quick-title") return;
  e.preventDefault();
  e.target.form?.requestSubmit();
});

DESKTOP.addEventListener("change", () => render());

// День и «сейчас» меняются сами: раз в минуту — перерисовка (ввод не теряется).
setInterval(() => { if (session) render(); }, 60000);

// Замеры и отладка — только на локальном стенде разработчика, не в опубликованной версии.
if (location.hostname === "localhost" || location.hostname === "127.0.0.1") window.__mark = { store, render, ui };

render();
tryTelegramAutoLogin();
