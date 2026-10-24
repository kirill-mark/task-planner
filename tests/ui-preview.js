// Предпросмотр экранов этапа 2 на тестовых данных: без входа и без сервера.
// ?theme=light|dark|system, маршрут — как в приложении (#/home, #/tasks?view=today, …).

import { newThread } from "../js/assistant-chats.js";
import { renderShell, renderHome, renderTasks, renderCalendar, renderAssistant, renderProfile, renderAuth } from "../js/ui/views.js";
import { todayIso, addDays } from "../js/ui/lib.js";
import { syncModalScroll } from "../js/ui/modal-scroll.js";
import { createMotion } from "../js/ui/motion.js";
import { clearOverdue } from "../js/ui/clear-overdue.js";

const q = new URLSearchParams(location.search);
if (q.has('reduce-motion')) {
  const nativeMatchMedia = window.matchMedia.bind(window);
  window.matchMedia = query => query === '(prefers-reduced-motion: reduce)'
    ? { matches: true, addEventListener() {} } : nativeMatchMedia(query);
  const style = document.createElement('style');
  style.textContent = '*,*::before,*::after{animation:none!important;transition:none!important}';
  document.head.append(style);
}
// Opt-in browser evidence for the real Web Animations calls; synthetic data only.
if (q.has('motion-check')) {
  const nativeAnimate = Element.prototype.animate, events = [];
  const report = document.createElement('output');
  report.id = 'motion-report'; report.style.cssText = 'position:fixed;left:0;top:0;z-index:99;font-size:9px;max-height:20px;overflow:hidden;pointer-events:none';
  document.body.append(report);
  const refresh = document.createElement('button');
  refresh.textContent = 'Проверить обновление'; refresh.dataset.action = 'motion-refresh';
  refresh.style.cssText = 'position:fixed;left:0;bottom:8px;z-index:100;font-size:9px'; document.body.append(refresh);
  const dismiss = document.createElement('button');
  dismiss.textContent = 'Закрыть быстро'; dismiss.dataset.action = 'close-editor';
  dismiss.style.cssText = 'position:fixed;left:0;bottom:32px;z-index:100;font-size:9px'; document.body.append(dismiss);
  const publish = () => { report.textContent = JSON.stringify(events.slice(-30)); };
  Element.prototype.animate = function(frames, options) {
    const animation = nativeAnimate.call(this, frames, options);
    const item = { target: this.className, frames, duration: options.duration };
    events.push(item);
    queueMicrotask(() => { item.elapsed = animation.currentTime; publish(); });
    animation.finished.then(() => { item.finished = true; publish(); }, () => {});
    return animation;
  };
}
document.documentElement.dataset.theme = q.get("theme") || "dark";
const today = todayIso();
const d = (n) => addDays(today, n);

const rows = {
  sections: [{ id: "s1", name: "KINOMARK", color: "#7FA7D9", position: 0 }, { id: "s2", name: "MARK", color: "#6ED6A0", position: 1 }, { id: "s3", name: "Личное", color: "#F2B861", position: 2 }],
  groups: [
    { id: "g1", section_id: "s1", name: "Продажи", position: 0 }, { id: "g2", section_id: "s1", name: "Операционка", position: 1 },
    { id: "g3", section_id: "s2", name: "Продукт", position: 2 }, { id: "g4", section_id: "s3", name: "Здоровье", position: 3 },
  ],
  tasks: [
    { id: "t1", title: "Созвон с клиентом по сайту", group_id: "g1", planned_date: today, planned_time: "15:00:00", duration_minutes: 60 },
    { id: "t2", title: "Отправить КП для Easy Glass", notes: "Три варианта остекления", group_id: "g1", planned_date: today, due_date: d(3), due_time: "18:00:00" },
    { id: "t3", title: "Закрыть сделку по Herbalife", group_id: "g1", due_date: d(-4) },
    { id: "t4", title: "Посчитать финансы по ближайшим проектам", group_id: "g2", planned_date: today },
    { id: "t5", title: "Выписать висячие задачи по KINOMARK", group_id: "g2", planned_date: d(-5) },
    { id: "t6", title: "Доработать планировщик", group_id: "g3", planned_date: today, due_date: d(11) },
    { id: "t7", title: "Съёмка интерьера Palmira Istra", group_id: "g1", planned_date: d(1), planned_time: "12:00:00", duration_minutes: 90 },
    { id: "t8", title: "Мероприятие от МТС", group_id: "g1", planned_date: d(15), planned_time: "17:00:00" },
    { id: "t9", title: "Тренировка", group_id: "g4", planned_date: today, planned_time: "12:00:00", duration_minutes: 60 },
    { id: "t10", title: "Идея: виджет фокуса дня", group_id: null },
    { id: "t11", title: "Купить подарок", group_id: "g4" },
    { id: "t12", title: "Смета для Palmira Istra", group_id: "g2", due_date: d(4) },
    { id: "t13", title: "Отчёт за сентябрь", group_id: "g2", planned_date: today, completed: true, completed_at: new Date().toISOString() },
    { id: "t14", title: "Оплатить аренду студии", group_id: "g2", planned_date: today, due_date: today },
  ].map((t) => ({ notes: "", planned_date: null, planned_time: null, due_date: null, due_time: null, duration_minutes: null, priority: "normal", completed: false, position: 0, ...t })),
};

// ?n=10000 — контрольный объём раздела 15: 10 000 задач, 100 групп, 20 разделов.
const N = Number(q.get("n") || 0);
if (N) {
  rows.sections = Array.from({ length: 20 }, (_, i) => ({ id: "S" + i, name: "Раздел " + (i + 1), color: ["#7FA7D9", "#6ED6A0", "#F2B861", "#E0698E"][i % 4], position: i }));
  rows.groups = Array.from({ length: 100 }, (_, i) => ({ id: "G" + i, section_id: "S" + (i % 20), name: "Группа " + (i + 1), position: i }));
  rows.tasks = Array.from({ length: N }, (_, i) => ({
    id: "T" + i, title: `Задача номер ${i} про ${["отчёт", "созвон", "смету", "съёмку", "договор"][i % 5]}`, notes: i % 7 ? "" : "подробности",
    group_id: i % 50 === 0 ? null : "G" + (i % 100), planned_date: i % 3 ? d((i % 60) - 20) : null, planned_time: i % 4 === 0 ? "1" + (i % 9) + ":00:00" : null,
    due_date: i % 5 === 0 ? d((i % 40) - 10) : null, due_time: null, duration_minutes: i % 6 === 0 ? 60 : null, priority: "normal",
    completed: i % 3 === 0, position: i,
  }));
}

const ui = { more: {}, quick: "", editor: null, manage: null, confirm: null, showDone: false, calMonth: today.slice(0, 7), selectedDate: today, saved: {}, profile: {}, linkCode: null, telegramMsg: "", auth: { mode: "signin" } };
const session = { user: { email: "kirill@example.com", user_metadata: { display_name: "Кирилл" } } };
ui.search = q.get("search") || "";
ui.assistant = { input: "", busy: false, chat: [] };
if (q.get("assistant") === "chat") ui.assistant.chat = [
  { role: "user", content: "Покажи мои задачи на сегодня и предложи порядок выполнения" },
  { role: "assistant", content: "На сегодня два дела. Предлагаю такой порядок:", sections: [
    { title: "Сегодня", items: ["Утвердить материал для второй серии «МАЖОРЧИК»", "Выложить пробное видео в аккаунт"] },
    { title: "С чего начать", items: ["Сначала утвердить материал — если от этого зависит работа команды.", "Затем выложить видео. Время выполнения у задач пока не указано."] },
    { title: "Уточним", items: ["У какой из этих задач жёсткий срок? Тогда точнее расставлю порядок."] }
  ], refs: ["t1", "t2"], drafts: [] }
];
if (q.get("assistant") === "memory-saved") ui.assistant.chat = [{ role: "user", content: "Я хочу начать сегодня с выхода ролика в Smolenka запомни это", memoryNotice: "Сохранено на 10 окт" }, { role: "assistant", content: "Учту твой выбор: сегодня начинаем со Smolenka.", refs: [], drafts: [] }];
if (q.get("assistant") === "voice") { ui.assistant.voice = { phase: "recording" }; ui.assistant.input = "Добавь созвон завтра в одиннадцать"; }

const previewThread = newThread(Number(q.get("greeting") || 0));
previewThread.messages = ui.assistant.chat;
previewThread.title = "План на сегодня";
ui.assistant.book = { threads: [previewThread], memory: ["Предпочитаю один главный шаг за раз"], nextGreeting: 1 };
ui.assistant.threadId = previewThread.id; ui.assistant.greetingIndex = previewThread.greeting;
if (["chats", "memory"].includes(q.get("panel"))) { ui.assistant.panel = q.get("panel"); ui.assistant.memoryDraft = ui.assistant.book.memory.join("\n"); }
const previewTrash = { status: "ok", tasks: [], keep_days: 30 };
const previewStore = {
  userId: "preview", rows,
  async deleteTask(id) {
    const task = rows.tasks.find((t) => t.id === id);
    if (!task) throw new Error("Task is missing");
    previewTrash.tasks.push({ ...task, deleted_at: new Date().toISOString() });
    rows.tasks = rows.tasks.filter((t) => t.id !== id);
  },
};
const status = { state: q.get("status") || "synced", lastSyncedAt: Date.now(), unconfirmed: q.get("status") === "saving" ? 2 : 0, conflicts: [], failed: [] };
const DESKTOP = window.matchMedia("(min-width: 1024px)");
const motion = createMotion(document.getElementById('app'), () => syncModalScroll(document.getElementById('app')));

function route() {
  const h = location.hash.replace(/^#\/?/, "");
  const [name, query] = h.split("?");
  return { name: name || "home", params: Object.fromEntries(new URLSearchParams(query || "")) };
}

function render() {
  const transition = motion.before({ route: route().name, editor: ui.editor ? (ui.editor.id || 'new') : null,
    panel: ui.assistant.panel, thread: ui.assistant.threadId });
  const t0 = performance.now();
  try { renderInner(); } finally {
    motion.after(transition);
    syncModalScroll(document.getElementById("app"));
    window.__lastRender = performance.now() - t0;
  }
  if (route().name === 'assistant') ui.assistant.greetingAnimated = true;
}

// ?assistant=proposal — предложения помощника во всех состояниях (пакет A)
const previewProposals = new Map();
if (q.get("assistant") === "proposal") {
  const c = (title, extra = {}) => ({ type: "create", entity: "task", id: "n-" + title, fields: { title, ...extra }, skip: false });
  const msg = (pid, drafts, state = "submitted") => ({ role: "assistant", content: "Вот что предлагаю:", refs: [], proposal_id: pid, state,
    drafts: drafts.map((d, i) => ({ ...d, action_id: pid + i, operation_id: pid + "o" + i })) });
  const upd = { type: "update", entity: "task", id: "t1", base_revision: 1, fields: { planned_date: "2026-10-23" }, before: { title: "Встреча с Олегом", planned_date: "2026-10-22" }, skip: false };
  ui.assistant.chat = [
    { role: "user", content: "Завтра подготовить смету и позвонить Никите, встречу с Олегом перенеси на пятницу" },
    msg("draft", [c("Смета", { planned_date: "2026-10-21" }), c("Позвонить Никите", { planned_date: "2026-10-21" }), upd], "pending"),
    msg("queued", [c("Купить хлеб")]),
    msg("applied", [c("Смета"), c("Звонок")]),
    msg("conflict", [c("Тренировка"), upd]),
    msg("failed", [c("Отчёт"), c("Счёт"), c("Договор")]),
  ];
  const st = (pid, statuses, state, reason) => previewProposals.set(pid, { proposal_id: pid, state, total: statuses.length,
    applied: statuses.filter((x) => x === "applied").length, actions: statuses.map((status, i) => ({ action_id: pid + i, status, reason: status === "failed" ? reason : null })) });
  st("queued", ["queued"], "queued");
  st("applied", ["applied", "applied"], "applied");
  st("conflict", ["applied", "conflict"], "conflict");
  st("failed", ["applied", "applied", "failed"], "failed", "группа удалена");
}

function renderInner() {
  const r = route();
  if (r.name === "auth") { document.getElementById("app").innerHTML = renderAuth(ui.auth); return; }
  const ctx = { rows, status, today, nowMin: 10 * 60, route: r, ui, session,
    settings: { focus: q.get("main") ? { date: today, ids: [q.get("main")] } : null, assistant_consent_at: q.get("assistant") === "consent" ? null : "preview", theme: document.documentElement.dataset.theme, timezone: "Europe/Moscow", morning_digest: true, evening_digest: true, task_reminders: true, workday: { start: "10:00", end: "19:00" } },
    telegram: { status: "linked", link: { telegram_username: "marchenkokirill" } }, tz: { prompt: q.get("tz") ? { account: "Europe/Moscow", device: "Asia/Almaty" } : null, device: "Europe/Moscow" },
    iphoneReminders: q.has("iphone-reminders") ? { available: true, enabled: true, permission: "granted", pending: 3, total: 3 } : null,
    speechAvailable: true, trash: previewTrash, isDesktop: DESKTOP.matches,
    proposalStatus: (id) => previewProposals.get(id) || null, applyingProposal: () => false };
  const page = { home: renderHome, tasks: renderTasks, calendar: renderCalendar, assistant: renderAssistant, profile: renderProfile }[r.name] || renderHome;
  document.getElementById("app").innerHTML = renderShell(ctx, page(ctx));
}

document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const a = el.dataset.action;
  if (a === 'motion-refresh') { /* exercise a data-only rerender */ }
  else if (a === "assistant-new") { const t = newThread(ui.assistant.book.nextGreeting++); ui.assistant.book.threads.unshift(t); Object.assign(ui.assistant, { threadId: t.id, chat: t.messages, greetingIndex: t.greeting, greetingAnimated: false, input: "", panel: null }); }
  else if (a === "assistant-chats") ui.assistant.panel = "chats";
  else if (a === "assistant-memory") { ui.assistant.panel = "memory"; ui.assistant.memoryDraft = ui.assistant.book.memory.join("\n"); }
  else if (a === "assistant-close-panel") ui.assistant.panel = null;
  else if (a === "assistant-open-chat") { const t = ui.assistant.book.threads.find(t => t.id === el.dataset.id); Object.assign(ui.assistant, { threadId: t.id, chat: t.messages, greetingIndex: t.greeting, panel: null }); }
  else if (a === "assistant-ask") { ui.assistant.input = el.dataset.text; }
  else if (a === "assistant-voice") { ui.assistant.voice = { phase: (ui.assistant.voice?.phase || "idle") === "idle" ? "recording" : "idle" }; }
  else if (a === "open-task") { const t = rows.tasks.find((x) => x.id === el.dataset.id); ui.editor = { id: t.id, error: "", draft: { ...t, planned_time: (t.planned_time || "").slice(0, 5), due_time: (t.due_time || "").slice(0, 5), duration_minutes: t.duration_minutes || "", group_id: t.group_id || "" } }; }
  else if (a === "search-open") ui.searchOpen = true;
  else if (a === "search-close") { ui.searchOpen = false; ui.search = ""; }
  else if (a === "tasks-mode-menu") ui.tasksMenu = !ui.tasksMenu;
  else if (a === "tasks-mode") { ui.tasksMode = el.dataset.mode; ui.tasksMenu = false; }
  else if (a === "tasks-filters") ui.tasksFilters = true;
  else if (a === "tasks-filters-close") { ui.tasksFilters = false; if (el.tagName === "A") { location.hash = el.getAttribute("href"); } }
  else if (a === "project-menu") ui.projectMenu = !ui.projectMenu;
  else if (a === "project-new") ui.projectForm = { id: null, name: "" };
  else if (a === "project-form-close") ui.projectForm = null;
  else if (a === "main-pick") ui.mainPick = true;
  else if (a === "main-pick-close") ui.mainPick = false;
  else if (a === "editor-more") ui.editor.mode = "full";
  else if (a === "quick-date-pick") ui.editor.datePick = !ui.editor.datePick;
  else if (a === "quick-date") { ui.editor.draft.planned_date = el.dataset.date; ui.editor.datePick = false; }
  else if (a === "new-task") ui.editor = { id: null, error: "", mode: "quick", draft: { title: "", notes: "", group_id: "", planned_date: el.dataset.date || "", planned_time: "", due_date: "", due_time: "", duration_minutes: "", priority: "normal" } };
  else if (a === "close-editor") ui.editor = null;
  else if (a === "clear-search") ui.search = "";
  else if (a === "toggle") { const t = rows.tasks.find((x) => x.id === el.dataset.id); t.completed = !t.completed; }
  else if (a === "pick-date") { ui.selectedDate = el.dataset.date; ui.calMonth = el.dataset.date.slice(0, 7); }
  else if (a === "toggle-done") ui.showDone = !ui.showDone;
  else if (a === "show-more") ui.more[el.dataset.key] = (ui.more[el.dataset.key] || 0) + Number(el.dataset.step || 50);
  else if (a === "manage") ui.manage = { form: null };
  else if (a === "new-section") ui.manage.form = { kind: "section", name: "", color: "#6ED6A0" };
  else if (a === "close-manage") ui.manage = null;
  else if (a === "empty-trash") {
    ui.confirm = { title: "Очистить корзину?", text: `Будут окончательно удалены задачи из корзины: ${previewTrash.tasks.length}. Восстановить их будет нельзя.`, ok: "Удалить окончательно", danger: true,
      onOk: () => { const count = previewTrash.tasks.length; previewTrash.tasks = []; ui.trashCleanup = { text: `Удалено окончательно: ${count}.` }; } };
  }
  else if (a === "cancel-confirm") ui.confirm = null;
  else if (a === "clear-overdue") {
    if (ui.overdueCleanup?.busy) return;
    ui.overdueCleanup = { busy: true, text: "Убираем просроченные задачи…" };
    render();
    const result = await clearOverdue(previewStore, today, 10 * 60);
    ui.overdueCleanup = { busy: false, failed: result.failed, text: `Убрано в корзину: ${result.moved}. Задачи можно восстановить в разделе «Корзина».` };
  }
  else if (a === "restore-task") {
    const task = previewTrash.tasks.find((t) => t.id === el.dataset.id);
    if (task) { rows.tasks.push({ ...task, deleted_at: null }); previewTrash.tasks = previewTrash.tasks.filter((t) => t.id !== task.id); }
  }
  else return;
  e.preventDefault();
render();
});
document.addEventListener("submit", (e) => {
  e.preventDefault();
  if (e.target.dataset.action === "confirm-submit") {
    ui.confirm?.onOk?.(); ui.confirm = null; render();
  }
});
window.__render = render;
window.__ui = ui;
window.addEventListener("hashchange", render);
DESKTOP.addEventListener("change", render);
if (q.get("edit")) { const t = rows.tasks.find((x) => x.id === q.get("edit")); ui.editor = { id: t.id, error: "", draft: { ...t, planned_time: (t.planned_time || "").slice(0, 5), due_time: (t.due_time || "").slice(0, 5), duration_minutes: t.duration_minutes || "", group_id: t.group_id || "" } }; }
if (q.get("manage")) ui.manage = { form: null };
if (q.get("layout")) { ui.layoutDraft = { desktop: [{ type: "summary", col: "main" }, { type: "plan", col: "main" }, { type: "calendar", col: "side" }, { type: "upcoming", col: "side" }], phone: [{ type: "summary" }, { type: "upcoming" }, { type: "calendar" }, { type: "plan" }, { type: "progress" }] }; }
if (q.get("focus")) ui.focusPick = true;
if (q.get("mode")) ui.tasksMode = q.get("mode");
if (q.get("searching")) ui.searchOpen = true;
if (q.get("quick")) ui.editor = { id: null, error: "", mode: "quick", restored: q.get("quick") === "draft", draft: { title: q.get("quick") === "empty" ? "" : "Забрать оборудование из проката на Старом Арбате и вернуть залог", notes: "", group_id: q.get("quick") === "draft" ? "g2" : "", planned_date: "", planned_time: "", due_date: "", due_time: "", duration_minutes: "", priority: "normal" } };
render();
