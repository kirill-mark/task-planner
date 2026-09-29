// Представления задач и расчёты по правилам ТЗ — без DOM, чтобы одни и те же
// функции служили главной, списку, календарю и (позже) помощнику и
// проверялись тестами (tests/derive_test.js).
//
// Задача новой модели: planned_date/planned_time — «Запланировать на»,
// due_date/due_time — «Выполнить до», duration_minutes — длительность или
// null (неизвестна), completed.

import { addDays, hhmm, minutesOf } from "./lib.js";

export const isOpen = (t) => !t.completed;
export const hasTime = (t) => !!(t.planned_date && t.planned_time);

// Задача относится ко дню, если на него запланирована или на него дедлайн.
// Совпавшие план и дедлайн — одна задача, а не две (A33).
export function onDay(t, day) {
  return t.planned_date === day || t.due_date === day;
}

export function sectionIdOf(rows, t) {
  return rows.groups.find((g) => g.id === t.group_id)?.section_id ?? null;
}

export function pathOf(rows, t) {
  const g = rows.groups.find((x) => x.id === t.group_id);
  if (!g) return { section: null, group: null, label: "Входящие", color: null };
  const s = rows.sections.find((x) => x.id === g.section_id);
  return {
    section: s || null,
    group: g,
    label: s ? `${s.name} → ${g.name}` : g.name,
    color: s?.color || g.color,
  };
}

// Порядок дня (раздел 3): открытые события со временем, затем дела без
// времени и дедлайны; выполненное — в конце.
export function dayOrder(a, b) {
  const rank = (t) => (t.completed ? 3 : hasTime(t) ? 0 : t.planned_date ? 1 : 2);
  const ra = rank(a), rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (ra === 0) return hhmm(a.planned_time).localeCompare(hhmm(b.planned_time));
  if (ra === 2) return (hhmm(a.due_time) || "99").localeCompare(hhmm(b.due_time) || "99");
  return (a.position ?? 0) - (b.position ?? 0);
}

export function tasksOfDay(rows, day) {
  return rows.tasks.filter((t) => onDay(t, day)).sort(dayOrder);
}

export function dayProgress(rows, day) {
  const list = rows.tasks.filter((t) => onDay(t, day));
  return { done: list.filter((t) => t.completed).length, total: list.length };
}

// Просроченное не переносится само: дедлайн прошёл — «просрочено»; прошёл
// план без дедлайна — «не выполнено в срок». Оба в отдельном блоке.
export function overdue(rows, today, nowMin = null) {
  return rows.tasks.filter((t) => {
    if (t.completed) return false;
    if (t.due_date) {
      if (t.due_date < today) return true;
      return t.due_date === today && t.due_time && nowMin != null && minutesOf(t.due_time) <= nowMin;
    }
    return !!t.planned_date && t.planned_date < today;
  }).sort((a, b) => (a.due_date || a.planned_date).localeCompare(b.due_date || b.planned_date));
}

export function overdueKind(t, today) {
  return t.due_date ? "overdue" : t.planned_date && t.planned_date < today ? "missed" : null;
}

// Входящие — задачи без даты или без группы: их ещё предстоит разобрать.
export function inbox(rows) {
  return rows.tasks.filter((t) => isOpen(t) && ((!t.planned_date && !t.due_date) || !t.group_id));
}

export function nextDays(rows, today, days = 7) {
  const end = addDays(today, days - 1);
  const inRange = (d) => d && d >= today && d <= end;
  return rows.tasks
    .filter((t) => isOpen(t) && (inRange(t.planned_date) || inRange(t.due_date)))
    .sort((a, b) => {
      const da = [a.planned_date, a.due_date].filter(inRange).sort()[0];
      const db = [b.planned_date, b.due_date].filter(inRange).sort()[0];
      return da.localeCompare(db) || dayOrder(a, b);
    });
}

// Виджет «Ближайшие дела»: до limit открытых событий со временем от текущего
// момента на 7 дней; дедлайны — отдельным списком (раздел 5).
export function upcoming(rows, today, nowMin, { limit = 5, days = 7 } = {}) {
  const end = addDays(today, days - 1);
  const events = rows.tasks
    .filter((t) => isOpen(t) && hasTime(t) && t.planned_date >= today && t.planned_date <= end)
    .filter((t) => t.planned_date > today || minutesOf(t.planned_time) >= nowMin)
    .sort((a, b) => a.planned_date.localeCompare(b.planned_date) || hhmm(a.planned_time).localeCompare(hhmm(b.planned_time)))
    .slice(0, limit);
  const deadlines = rows.tasks
    .filter((t) => isOpen(t) && t.due_date && t.due_date >= today && t.due_date <= end)
    .sort((a, b) => a.due_date.localeCompare(b.due_date) || (hhmm(a.due_time) || "99").localeCompare(hhmm(b.due_time) || "99"))
    .slice(0, limit);
  return { events, deadlines };
}

// Точки календаря — наличие открытых дел по разделам, не часы занятости
// (раздел 6): до трёх цветов и признак переполнения; число — уникальные задачи.
export function monthMarks(rows, fromIso, toIso) {
  const marks = {};
  for (const t of rows.tasks) {
    if (!isOpen(t)) continue;
    const dates = new Set([t.planned_date, t.due_date].filter((d) => d && d >= fromIso && d <= toIso));
    const sec = sectionIdOf(rows, t) ?? "inbox";
    for (const d of dates) {
      const m = (marks[d] ||= { count: 0, sections: [] });
      m.count += 1;
      if (!m.sections.includes(sec)) m.sections.push(sec);
    }
  }
  const colorOf = (id) => rows.sections.find((s) => s.id === id)?.color || "#848E96";
  for (const m of Object.values(marks)) {
    m.colors = m.sections.slice(0, 3).map(colorOf);
    m.overflow = Math.max(0, m.sections.length - 3);
  }
  return marks;
}

// Сетка месяца: 5–6 недель с выбранного первого дня (1 — понедельник,
// 7 — воскресенье), дни соседних месяцев помечены.
export function monthGrid(year, monthIndex, weekStart = 1) {
  const first = new Date(year, monthIndex, 1);
  const shift = weekStart === 7 ? first.getDay() : (first.getDay() + 6) % 7;
  const start = new Date(year, monthIndex, 1 - shift);
  const last = new Date(year, monthIndex + 1, 0);
  const cells = Math.ceil((shift + last.getDate()) / 7) * 7;
  const out = [];
  for (let i = 0; i < cells; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    out.push({ iso, day: d.getDate(), inMonth: d.getMonth() === monthIndex });
  }
  return out;
}

// Свободное время дня (раздел 6, A34): из рабочего расписания вычитается
// объединение занятых интервалов с учётом пересечений. Дедлайн время не
// блокирует; дело без длительности не считается ни свободным, ни часом.
export function dayLoad(rows, day, { start = "10:00", end = "19:00", buffer = 0 } = {}) {
  const ws = minutesOf(start), we = minutesOf(end);
  const list = rows.tasks.filter((t) => isOpen(t) && t.planned_date === day);
  const blocks = [];
  let unknown = 0;
  for (const t of list) {
    if (!t.planned_time) { if (!t.duration_minutes) unknown += 1; continue; }
    if (!t.duration_minutes) { unknown += 1; continue; }
    const s = minutesOf(t.planned_time);
    blocks.push({ start: s, end: s + t.duration_minutes, task: t });
  }
  const sorted = blocks.map((b) => ({ start: b.start - buffer, end: b.end + buffer })).sort((a, b) => a.start - b.start);
  const merged = [];
  for (const b of sorted) {
    const last = merged[merged.length - 1];
    if (last && b.start <= last.end) last.end = Math.max(last.end, b.end);
    else merged.push({ ...b });
  }
  // свободные окна считаются с буфером между делами, если он задан
  const free = [];
  let cursor = ws;
  for (const b of merged) {
    const s = Math.max(b.start, ws), e = Math.min(b.end, we);
    if (e <= s) continue;
    if (s > cursor) free.push({ start: cursor, end: s });
    cursor = Math.max(cursor, e);
  }
  if (cursor < we) free.push({ start: cursor, end: we });
  // а занятость — без буфера: это то, что реально стоит в плане
  return { blocks: blocks.sort((a, b) => a.start - b.start), busy: mergedMinutes(blocks, ws, we), free, unknown, workday: { start: ws, end: we } };
}

function mergedMinutes(blocks, ws, we) {
  const sorted = blocks.map((b) => ({ start: Math.max(b.start, ws), end: Math.min(b.end, we) }))
    .filter((b) => b.end > b.start).sort((a, b) => a.start - b.start);
  let total = 0, curS = null, curE = null;
  for (const b of sorted) {
    if (curE != null && b.start <= curE) curE = Math.max(curE, b.end);
    else { if (curE != null) total += curE - curS; curS = b.start; curE = b.end; }
  }
  if (curE != null) total += curE - curS;
  return total;
}
