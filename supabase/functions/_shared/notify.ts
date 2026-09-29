// Что и когда отправлять (раздел 10 ТЗ) — без сети и базы, чтобы проверялось
// тестами (notify_test.ts). Отправкой и журналом занимается send-reminders.

import { reminderWindow, validDate, validTime } from "./time.ts";
import { esc, relDay } from "./botfmt.ts";

export type NTask = {
  id: string;
  title: string;
  notes?: string;
  planned_date: string | null;
  planned_time: string | null;
  due_date: string | null;
  due_time: string | null;
  completed: boolean;
};

export type NSettings = {
  morning: string;   // «09:00»
  evening: string;
  lead: number;      // минут до задачи
  quiet: { enabled: boolean; start: string; end: string };
};

const hhmm = (t: string | null | undefined) => (t ? String(t).slice(0, 5) : "");
const mins = (t: string) => { const [h, m] = hhmm(t).split(":").map(Number); return h * 60 + m; };

// Тихие часы могут переходить через полночь (23:00–08:00).
export function inQuiet(minute: number, q: NSettings["quiet"]): boolean {
  if (!q.enabled) return false;
  const s = mins(q.start), e = mins(q.end);
  if (s === e) return false;
  return s < e ? minute >= s && minute < e : minute >= s || minute < e;
}

// Сводка, попавшая в тихие часы, переносится на их конец.
export function digestMinute(target: string, q: NSettings["quiet"]): number {
  return inQuiet(mins(target), q) ? mins(q.end) : mins(target);
}

// Сводку можно догнать в пределах часа после её момента.
export function digestDue(nowMin: number, target: string, q: NSettings["quiet"], catchUp = 60): boolean {
  const at = digestMinute(target, q);
  return nowMin >= at && nowMin < at + catchUp && !inQuiet(nowMin, q);
}

// Момент напоминания: плановое время, иначе дедлайн с явным временем. Дата без
// времени автоматического напоминания не получает.
export function reminderAnchor(t: NTask): { date: string; time: string; kind: "plan" | "due" } | null {
  if (t.completed) return null;
  if (validDate(t.planned_date) && validTime(hhmm(t.planned_time))) return { date: t.planned_date!, time: hhmm(t.planned_time), kind: "plan" };
  if (validDate(t.due_date) && validTime(hhmm(t.due_time))) return { date: t.due_date!, time: hhmm(t.due_time), kind: "due" };
  return null;
}

// send — пора; wait — рано или тихие часы, а событие ещё впереди; skip —
// событие уже началось (после тихих часов о прошедшем не напоминаем).
export function reminderDecision(t: NTask, nowMs: number, nowLocalMin: number, tz: string, s: NSettings): { action: "send" | "wait" | "skip"; eventAt?: number; anchor?: ReturnType<typeof reminderAnchor> } {
  const anchor = reminderAnchor(t);
  if (!anchor) return { action: "skip" };
  const win = reminderWindow(anchor.date, anchor.time, tz, s.lead);
  if (nowMs >= win.eventAt) return { action: "skip", eventAt: win.eventAt, anchor };
  if (nowMs < win.fireAt || inQuiet(nowLocalMin, s.quiet)) return { action: "wait", eventAt: win.eventAt, anchor };
  return { action: "send", eventAt: win.eventAt, anchor };
}

const onDay = (t: NTask, d: string) => t.planned_date === d || t.due_date === d;

// Утренняя сводка: события по времени, дела без времени, дедлайны дня и
// короткий блок просроченного. Выполненное и корзина не попадают.
export function morningDigest(tasks: NTask[], today: string, tomorrow: string): string {
  const open = tasks.filter((t) => !t.completed);
  const day = open.filter((t) => onDay(t, today));
  const events = day.filter((t) => t.planned_date === today && hhmm(t.planned_time)).sort((a, b) => hhmm(a.planned_time).localeCompare(hhmm(b.planned_time)));
  const plain = day.filter((t) => t.planned_date === today && !hhmm(t.planned_time));
  const dues = day.filter((t) => t.due_date === today && t.planned_date !== today);
  const late = open.filter((t) => (t.due_date && t.due_date < today) || (!t.due_date && t.planned_date && t.planned_date < today));
  const lines = ["☀️ <b>План на сегодня</b>"];
  if (!day.length) lines.push("", "На сегодня задач нет.");
  if (events.length) lines.push("", ...events.map((t) => `<b>${hhmm(t.planned_time)}</b> ${esc(t.title)}`));
  if (plain.length) lines.push("", "<i>Без времени</i>", ...plain.map((t) => `• ${esc(t.title)}`));
  if (dues.length) lines.push("", "<i>Дедлайны сегодня</i>", ...dues.map((t) => `• ${esc(t.title)}${hhmm(t.due_time) ? " — до " + hhmm(t.due_time) : ""}`));
  if (late.length) {
    lines.push("", `❗️ <i>Просрочено: ${late.length}</i>`, ...late.slice(0, 3).map((t) => `• ${esc(t.title)}`));
    if (late.length > 3) lines.push(`… и ещё ${late.length - 3}`);
  }
  return lines.join("\n");
}

export function eveningDigest(tasks: NTask[], today: string, tomorrow: string): string {
  const day = tasks.filter((t) => !t.completed && onDay(t, tomorrow));
  const events = day.filter((t) => t.planned_date === tomorrow && hhmm(t.planned_time)).sort((a, b) => hhmm(a.planned_time).localeCompare(hhmm(b.planned_time)));
  const plain = day.filter((t) => t.planned_date === tomorrow && !hhmm(t.planned_time));
  const dues = day.filter((t) => t.due_date === tomorrow && t.planned_date !== tomorrow);
  const lines = [`🌙 <b>План на ${relDay(tomorrow, today, tomorrow)}</b>`];
  if (!day.length) lines.push("", "На завтра пока ничего не запланировано.");
  if (events.length) lines.push("", ...events.map((t) => `<b>${hhmm(t.planned_time)}</b> ${esc(t.title)}`));
  if (plain.length) lines.push("", "<i>Без времени</i>", ...plain.map((t) => `• ${esc(t.title)}`));
  if (dues.length) lines.push("", "<i>Дедлайны</i>", ...dues.map((t) => `• ${esc(t.title)}${hhmm(t.due_time) ? " — до " + hhmm(t.due_time) : ""}`));
  return lines.join("\n");
}

export function reminderText(t: NTask, anchor: NonNullable<ReturnType<typeof reminderAnchor>>, minutesLeft: number): string {
  const lines = [`⏰ <b>Через ${Math.max(1, minutesLeft)} мин${anchor.kind === "due" ? " — дедлайн" : ""}</b>`, esc(t.title), `${anchor.kind === "due" ? "До" : "В"} ${anchor.time}`];
  if (t.notes && t.notes.trim()) lines.push(`<i>${esc(t.notes.trim().slice(0, 300))}</i>`);
  return lines.join("\n");
}
