// Предпросмотр экранов этапа 2 на тестовых данных: без входа и без сервера.
// ?theme=light|dark|system, маршрут — как в приложении (#/home, #/tasks?view=today, …).

import { renderShell, renderHome, renderTasks, renderCalendar, renderAssistant, renderProfile, renderAuth } from "../js/ui/views.js";
import { todayIso, addDays } from "../js/ui/lib.js";

const q = new URLSearchParams(location.search);
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
  ].map((t) => ({ notes: "", planned_date: null, planned_time: null, due_date: null, due_time: null, duration_minutes: null, priority: "normal", completed: false, position: 0, ...t })),
};

const ui = { quick: "", editor: null, manage: null, confirm: null, showDone: false, calMonth: today.slice(0, 7), selectedDate: today, saved: {}, profile: {}, linkCode: null, telegramMsg: "", auth: { mode: "signin" } };
const session = { user: { email: "kirill@example.com", user_metadata: { display_name: "Кирилл" } } };
const status = { state: q.get("status") || "synced", lastSyncedAt: Date.now(), unconfirmed: q.get("status") === "saving" ? 2 : 0, conflicts: [], failed: [] };
const DESKTOP = window.matchMedia("(min-width: 1024px)");

function route() {
  const h = location.hash.replace(/^#\/?/, "");
  const [name, query] = h.split("?");
  return { name: name || "home", params: Object.fromEntries(new URLSearchParams(query || "")) };
}

function render() {
  const r = route();
  if (r.name === "auth") { document.getElementById("app").innerHTML = renderAuth(ui.auth); return; }
  const ctx = { rows, status, today, nowMin: 10 * 60, route: r, ui, session,
    settings: { theme: document.documentElement.dataset.theme, timezone: "Europe/Moscow", morning_digest: true, evening_digest: true, task_reminders: true, workday: { start: "10:00", end: "19:00" } },
    telegram: { status: "linked", link: { telegram_username: "marchenkokirill" } }, tz: { prompt: q.get("tz") ? { account: "Europe/Moscow", device: "Asia/Almaty" } : null, device: "Europe/Moscow" },
    isDesktop: DESKTOP.matches };
  const page = { home: renderHome, tasks: renderTasks, calendar: renderCalendar, assistant: renderAssistant, profile: renderProfile }[r.name] || renderHome;
  document.getElementById("app").innerHTML = renderShell(ctx, page(ctx));
}

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const a = el.dataset.action;
  if (a === "open-task") { const t = rows.tasks.find((x) => x.id === el.dataset.id); ui.editor = { id: t.id, error: "", draft: { ...t, planned_time: (t.planned_time || "").slice(0, 5), due_time: (t.due_time || "").slice(0, 5), duration_minutes: t.duration_minutes || "", group_id: t.group_id || "" } }; }
  else if (a === "new-task") ui.editor = { id: null, error: "", draft: { title: "", notes: "", group_id: "", planned_date: el.dataset.date || "", planned_time: "", due_date: "", due_time: "", duration_minutes: "", priority: "normal" } };
  else if (a === "close-editor") ui.editor = null;
  else if (a === "toggle") { const t = rows.tasks.find((x) => x.id === el.dataset.id); t.completed = !t.completed; }
  else if (a === "pick-date") { ui.selectedDate = el.dataset.date; ui.calMonth = el.dataset.date.slice(0, 7); }
  else if (a === "toggle-done") ui.showDone = !ui.showDone;
  else if (a === "manage") ui.manage = { form: null };
  else if (a === "new-section") ui.manage.form = { kind: "section", name: "", color: "#6ED6A0" };
  else if (a === "close-manage") ui.manage = null;
  else return;
  e.preventDefault();
render();
});
document.addEventListener("submit", (e) => e.preventDefault());
window.addEventListener("hashchange", render);
DESKTOP.addEventListener("change", render);
if (q.get("edit")) { const t = rows.tasks.find((x) => x.id === q.get("edit")); ui.editor = { id: t.id, error: "", draft: { ...t, planned_time: (t.planned_time || "").slice(0, 5), due_time: (t.due_time || "").slice(0, 5), duration_minutes: t.duration_minutes || "", group_id: t.group_id || "" } }; }
if (q.get("manage")) ui.manage = { form: null };
render();
