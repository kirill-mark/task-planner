// Экраны интерфейса этапа 2 (макеты «MARK — макеты этапа 2»). Каждая
// функция — данные контекста → разметка; состояние и события живут в app.js.
//
// ctx: { rows, status, today, nowMin, route, ui, session, settings, telegram,
//        tz, isDesktop }

import { esc, plural, longDate, shortDate, relativeDay, hhmm, minutesOf, timeOf, durationText,
  weekHeader, monthTitle, addDays, parseIso, capitalize } from "./lib.js";
import { tasksOfDay, dayProgress, overdue, overdueKind, inbox, nextDays, upcoming, monthMarks,
  monthGrid, dayLoad, pathOf, hasTime, isOpen, dayOrder } from "./derive.js";
import { icons, blob } from "./icons.js";

const NAV = [
  { id: "home", label: "Главная", href: "#/home", icon: icons.home },
  { id: "tasks", label: "Задачи", href: "#/tasks", icon: icons.tasks },
  { id: "calendar", label: "Календарь", href: "#/calendar", icon: icons.calendar },
  { id: "assistant", label: "Помощник", href: "#/assistant", icon: icons.spark },
];

export const VIEWS = [
  { id: "all", label: "Все" },
  { id: "inbox", label: "Входящие" },
  { id: "today", label: "Сегодня" },
  { id: "week", label: "7 дней" },
  { id: "overdue", label: "Просроченные" },
  { id: "done", label: "Завершённые" },
  { id: "trash", label: "Корзина" },
];

// Поиск по названиям и описаниям; «ё» и «е» не различаются.
export function matchesSearch(t, q) {
  const norm = (x) => String(x || "").toLowerCase().replace(/ё/g, "е");
  const words = norm(q).split(/\s+/).filter(Boolean);
  const hay = norm(t.title) + " " + norm(t.notes);
  return words.every((w) => hay.includes(w));
}

// ------------------------------------------------------------------ общее --

export function firstName(session) {
  const raw = session?.user?.user_metadata?.display_name || session?.user?.email || "";
  const name = raw.split(/[\s@.]/)[0];
  return name ? capitalize(name) : "";
}

function greeting(nowMin) {
  if (nowMin < 5 * 60) return "Доброй ночи";
  if (nowMin < 12 * 60) return "Доброе утро";
  if (nowMin < 18 * 60) return "Добрый день";
  return "Добрый вечер";
}

export function syncLabel(status) {
  const n = status?.unconfirmed || 0;
  switch (status?.state) {
    case "synced": return { cls: "ok", text: "Синхронизировано" + (status.lastSyncedAt ? " · " + new Date(status.lastSyncedAt).toTimeString().slice(0, 5) : "") };
    case "saving": return { cls: "", text: n ? `Сохраняю ${n} ${plural(n, "изменение", "изменения", "изменений")}` : "Сохраняю…" };
    case "offline": return { cls: "warn", text: n ? `Нет сети · ${n} ${plural(n, "изменение", "изменения", "изменений")} на устройстве` : "Нет сети" };
    case "conflict": return { cls: "bad", text: "Нужно разрешить конфликт" };
    case "failed": case "error": return { cls: "bad", text: "Не удалось сохранить" };
    case "auth": return { cls: "warn", text: "Войдите снова — изменения сохранены" };
    case "outdated": return { cls: "warn", text: "Обновите приложение — изменения сохранены" };
    default: return { cls: "", text: "Загрузка…" };
  }
}

function statusButton(status) {
  const s = syncLabel(status);
  return `<button type="button" class="status ${s.cls}" data-action="sync-now" title="Сверить сейчас"><span class="dot"></span>${esc(s.text)}</button>`;
}

function counts(ctx) {
  const { rows, today, nowMin } = ctx;
  return {
    inbox: inbox(rows).length,
    today: tasksOfDay(rows, today).filter(isOpen).length,
    week: nextDays(rows, today).length,
    overdue: overdue(rows, today, nowMin).length,
  };
}

// ------------------------------------------------------------------ каркас --

export function renderShell(ctx, content) {
  const c = counts(ctx);
  const route = ctx.route.name;
  const view = ctx.route.params.view;
  const navItem = (n) => `<a class="nav-item" href="${n.href}" ${route === n.id && !(n.id === "tasks" && view) ? 'aria-current="page"' : ""}>${n.icon(20)}${n.label}</a>`;
  const sub = (id, label, count, danger) => `<a class="nav-item nav-sub" href="#/tasks?view=${id}" ${route === "tasks" && view === id ? 'aria-current="page"' : ""}><span>${label}</span><span class="count ${danger && count ? "danger" : ""}">${count || ""}</span></a>`;
  const sections = ctx.rows.sections.map((s) =>
    `<a class="nav-item nav-sub" href="#/tasks?section=${esc(s.id)}" ${ctx.route.params.section === s.id ? 'aria-current="page"' : ""}><span class="row" style="gap:10px"><span class="sq" style="background:${esc(s.color)}"></span>${esc(s.name)}</span></a>`).join("");
  return `
  <div class="shell">
    <nav class="sidebar" aria-label="Основная навигация">
      <div class="brand"><span class="brand-mark">M</span>MARK</div>
      <button type="button" class="btn primary" data-action="new-task">${icons.plus(18)}Добавить задачу</button>
      <div class="nav-list">${NAV.map(navItem).join("")}</div>
      <div class="nav-list">
        <div class="nav-label">Представления</div>
        ${sub("inbox", "Входящие", c.inbox)}${sub("today", "Сегодня", c.today)}${sub("week", "Ближайшие 7 дней", c.week)}${sub("overdue", "Просроченные", c.overdue, true)}${sub("done", "Завершённые", 0)}${sub("trash", "Корзина", 0)}
      </div>
      <div class="nav-list">
        <div class="nav-label">Разделы</div>
        ${sections || '<span class="muted" style="padding:0 12px;font-size:13px">Пока нет разделов</span>'}
      </div>
      <a class="nav-account" href="#/profile" aria-label="Личный кабинет">
        <span class="avatar">${esc((firstName(ctx.session) || "?")[0])}</span>
        <span style="display:flex;flex-direction:column;gap:2px;min-width:0">
          <span style="font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis">${esc(firstName(ctx.session) || ctx.session?.user?.email || "")}</span>
          <span class="status ${syncLabel(ctx.status).cls}" style="padding:0"><span class="dot"></span>${esc(syncLabel(ctx.status).text)}</span>
        </span>
      </a>
    </nav>
    <main class="main" id="main">${content}</main>
    <nav class="bottom-nav" aria-label="Основная навигация">
      ${NAV.slice(0, 2).map((n) => `<a href="${n.href}" ${route === n.id ? 'aria-current="page"' : ""}>${n.icon(22)}${n.label}</a>`).join("")}
      <button type="button" class="nav-add" data-action="new-task" aria-label="Добавить задачу"><span>${icons.plus(24)}</span></button>
      ${NAV.slice(2).map((n) => `<a href="${n.href}" ${route === n.id ? 'aria-current="page"' : ""}>${n.icon(22)}${n.label}</a>`).join("")}
    </nav>
    ${ctx.ui.editor && !(ctx.isDesktop && route === "tasks") ? renderEditorSheet(ctx) : ""}
    ${ctx.ui.manage ? renderManageSheet(ctx) : ""}
    ${ctx.ui.confirm ? renderConfirm(ctx.ui.confirm) : ""}
  </div>`;
}

// Вопросы о поясе и конфликты показываются на всех экранах.
export function renderNotices(ctx) {
  let out = "";
  if (ctx.tz?.prompt) {
    const p = ctx.tz.prompt;
    out += `<div class="alert info" role="status"><div class="grow">
      <span>Напоминания приходят по поясу <b>${esc(p.account)}</b>, а это устройство сейчас в <b>${esc(p.device)}</b>.</span></div>
      <div class="chips"><button type="button" class="btn small" data-action="tz-use-device">Перейти на ${esc(p.device)}</button>
      <button type="button" class="btn small quiet" data-action="tz-keep">Оставить</button></div></div>`;
  }
  for (const op of ctx.status?.conflicts || []) out += renderConflict(ctx, op, true);
  for (const op of ctx.status?.failed || []) out += renderConflict(ctx, op, false);
  return out;
}

const FIELD_LABELS = {
  title: "название", notes: "описание", completed: "выполнено", group_id: "группа",
  planned_date: "дата «на»", planned_time: "время «на»", due_date: "срок «до»", due_time: "время «до»",
  duration_minutes: "длительность", priority: "приоритет", name: "название", color: "цвет", section_id: "раздел", position: "порядок",
};

function fieldValue(ctx, key, v) {
  if (v === null || v === undefined || v === "") return "—";
  if (key === "completed") return v ? "да" : "нет";
  if (key === "group_id") return ctx.rows.groups.find((g) => g.id === v)?.name || v;
  if (key.endsWith("_time")) return hhmm(v);
  if (key.endsWith("_date")) return shortDate(v, { today: ctx.today });
  if (key === "duration_minutes") return durationText(v);
  if (key === "priority") return { low: "низкий", normal: "обычный", high: "высокий" }[v] || v;
  return String(v);
}

function renderConflict(ctx, op, isConflict) {
  const cur = op.result?.current;
  const list = op.entity === "task" ? ctx.rows.tasks : op.entity === "group" ? ctx.rows.groups : ctx.rows.sections;
  const local = list.find((x) => x.id === op.entity_id);
  const name = cur?.title || cur?.name || local?.title || local?.name || op.changes?.title || op.changes?.name || "без названия";
  const kind = { task: "Задача", group: "Группа", section: "Раздел" }[op.entity] || "Объект";
  const rows = Object.entries(op.changes || {}).filter(([k]) => k !== "timezone").map(([k, mine]) =>
    `<span class="h">${esc(FIELD_LABELS[k] || k)}</span><span>${esc(fieldValue(ctx, k, mine))}</span><span>${cur ? esc(fieldValue(ctx, k, cur[k])) : "?"}</span>`).join("");
  const why = isConflict
    ? (cur?.deleted_at ? "удалена на другом устройстве" : op.type === "delete" ? "удаление расходится с версией на сервере" : "изменена на другом устройстве")
    : "сервер не принял изменение" + (op.result?.reason ? ` (${op.result.reason})` : "");
  return `<section class="alert" aria-label="Конфликт"><div class="grow">
    <b>${kind} «${esc(name)}»: ${esc(why)}</b>
    ${isConflict && rows ? `<div class="conflict-grid" style="margin-top:6px"><span></span><span class="h">Здесь</span><span class="h">На сервере</span>${rows}</div>` : ""}
    <div class="chips" style="margin-top:8px">
      ${isConflict && cur?.deleted_at ? `
        <button type="button" class="btn small" data-action="restore-apply" data-seq="${op.seq}">Восстановить и применить</button>
        ${op.entity === "task" ? `<button type="button" class="btn small" data-action="save-new" data-seq="${op.seq}">Сохранить как новую</button>` : ""}
        <button type="button" class="btn small quiet" data-action="discard-mine" data-seq="${op.seq}">Оставить удалённой</button>`
      : `${isConflict ? `<button type="button" class="btn small" data-action="keep-mine" data-seq="${op.seq}">Оставить моё</button>` : ""}
        <button type="button" class="btn small quiet" data-action="discard-mine" data-seq="${op.seq}">${isConflict ? "Взять с сервера" : "Отменить изменение"}</button>`}
    </div></div></section>`;
}

// ------------------------------------------------------------- строка задачи --

function planPill(t, today) {
  if (!t.planned_date) return "";
  const time = hhmm(t.planned_time);
  if (t.planned_date === today) return `<span class="pill plan">${time ? time : "сегодня"}</span>`;
  return `<span class="pill plan">на ${esc(shortDate(t.planned_date, { today }))}${time ? " · " + time : ""}</span>`;
}

function duePill(t, today) {
  if (!t.due_date) return "";
  const time = hhmm(t.due_time);
  if (!t.completed && t.due_date < today) return `<span class="pill late">просрочено с ${esc(shortDate(t.due_date, { today }))}</span>`;
  const when = t.due_date === today ? "сегодня" : shortDate(t.due_date, { weekday: true, today });
  return `<span class="pill due">до ${esc(when)}${time ? " " + time : ""}</span>`;
}

export function taskRow(ctx, t, { showPath = true, when = null, selected = false } = {}) {
  const today = ctx.today;
  const path = pathOf(ctx.rows, t);
  const missed = !t.completed && !t.due_date && t.planned_date && t.planned_date < today;
  return `<div class="task ${t.completed ? "done" : ""} ${selected ? "selected" : ""}">
    ${when !== null ? `<span class="when ${when.cls || ""}">${esc(when.text)}</span>` : ""}
    <button type="button" class="check ${t.completed ? "done" : ""}" data-action="toggle" data-id="${esc(t.id)}" aria-pressed="${t.completed ? "true" : "false"}" aria-label="${t.completed ? "Вернуть в работу" : "Отметить выполненной"}: ${esc(t.title)}">${t.completed ? icons.check() : ""}</button>
    <button type="button" class="task-body" data-action="open-task" data-id="${esc(t.id)}">
      <span class="task-title">${esc(t.title)}</span>
      <span class="task-meta">
        ${showPath ? `${path.color ? `<span class="sq" style="background:${esc(path.color)}"></span>` : ""}<span>${esc(path.label)}</span>` : ""}
        ${missed ? `<span class="pill late">не выполнено ${esc(shortDate(t.planned_date, { today }))}</span>` : when !== null && t.planned_date === ctx.today ? "" : planPill(t, today)}
        ${duePill(t, today)}
        ${t.duration_minutes ? `<span>${esc(durationText(t.duration_minutes))}</span>` : ""}
        ${t.priority === "high" ? '<span class="pill due">важно</span>' : ""}
        ${t._pending ? '<span class="pill pending" title="Сохранено на устройстве, ещё не подтверждено сервером">не отправлено</span>' : ""}
      </span>
    </button>
  </div>`;
}

function whenOfDay(t, day) {
  if (t.planned_date === day && t.planned_time) return { text: hhmm(t.planned_time), cls: "strong" };
  if (t.due_date === day) return { text: t.due_time ? "до " + hhmm(t.due_time) : "срок", cls: "warn" };
  return { text: "—", cls: "" };
}

// ------------------------------------------------------------------- главная --

export function summaryOf(ctx) {
  const { rows, today, nowMin } = ctx;
  const day = tasksOfDay(rows, today);
  const open = day.filter(isOpen);
  const timed = open.filter((t) => t.planned_date === today && hasTime(t));
  const late = overdue(rows, today, nowMin);
  const next = timed.filter((t) => minutesOf(t.planned_time) >= nowMin).sort(dayOrder)[0];
  const load = dayLoad(rows, today, ctx.settings.workday);
  const nIn = inbox(rows).length;

  let title;
  if (!open.length) title = day.length ? "На сегодня всё выполнено." : "На сегодня задач нет.";
  else title = `Сегодня ${open.length} ${plural(open.length, "дело", "дела", "дел")}` +
    (timed.length ? `, ${timed.length} со временем` : "") + ".";
  if (late.length) title += ` ${late.length} ${plural(late.length, "просроченное ждёт", "просроченных ждут", "просроченных ждут")} решения.`;

  const parts = [];
  if (next) parts.push(`Ближайшее — «${next.title}» в ${hhmm(next.planned_time)}.`);
  const nowFree = load.free.find((f) => f.end > nowMin && f.end - Math.max(f.start, nowMin) >= 30);
  if (nowFree && open.length && nowMin < load.workday.end) {
    const from = Math.max(nowFree.start, nowMin);
    parts.push(`Свободно с ${timeOf(from)} до ${timeOf(nowFree.end)}.`);
  }
  if (load.unknown) parts.push(`У ${load.unknown} ${plural(load.unknown, "дела", "дел", "дел")} не указана длительность, поэтому точную загрузку дня назвать нельзя.`);
  if (nIn) parts.push(`Во входящих ${nIn} — ${plural(nIn, "ждёт", "ждут", "ждут")} разбора.`);
  return { title, text: parts.join(" "), late: late.length, inbox: nIn };
}

function renderSummaryCard(ctx) {
  const s = summaryOf(ctx);
  return `<section class="card" aria-label="Сводка дня">
    <div class="summary">${blob()}
      <div style="display:flex;flex-direction:column;gap:8px;min-width:0">
        <span class="eyebrow">Сводка · по вашим задачам</span>
        <span class="summary-title">${esc(s.title)}</span>
        ${s.text && ctx.wsize !== "S" ? `<span class="summary-text">${esc(s.text)}</span>` : ""}
      </div>
    </div>
    <div class="chips">
      <a class="chip-btn" style="display:inline-flex;align-items:center;color:var(--text)" href="#/calendar?date=${ctx.today}">Весь день</a>
      ${s.inbox ? `<a class="chip-btn" style="display:inline-flex;align-items:center;color:var(--text)" href="#/tasks?view=inbox">Входящие · ${s.inbox}</a>` : ""}
      ${ctx.route.name === "assistant" ? "" : `<a class="chip-btn" style="display:inline-flex;align-items:center;color:var(--accent)" href="#/assistant">Спросить помощника</a>`}
      ${s.late ? `<a class="chip-btn" style="display:inline-flex;align-items:center;color:var(--danger)" href="#/tasks?view=overdue">Просроченное · ${s.late}</a>` : ""}
    </div>
  </section>`;
}

function renderQuickAdd(ctx, placeholder) {
  return `<form class="quick-add" data-action="quick-add">
    ${icons.plus(18)}
    <input name="title" data-key="quick" data-draft="quick" value="${esc(ctx.ui.quick || "")}" aria-label="Новая задача" placeholder="${esc(placeholder)}" maxlength="200" autocomplete="off" enterkeyhint="done">
    <span class="hint">Enter — добавить</span>
  </form>`;
}

function renderPlanToday(ctx) {
  const { rows, today } = ctx;
  const list = tasksOfDay(rows, today);
  const p = dayProgress(rows, today);
  const n = limitOf(ctx);
  const shown = list.filter(isOpen).slice(0, n);
  return `<section class="card" aria-label="План на сегодня">
    <div class="card-head"><div class="row" style="align-items:baseline"><h2>План на сегодня</h2><span class="meta">${p.done} из ${p.total} выполнено</span></div>
      <a href="#/calendar?date=${today}" style="font-size:14px;white-space:nowrap">Весь день →</a></div>
    ${shown.length ? `<div class="task-list">${shown.map((t) => taskRow(ctx, t, { when: ctx.isDesktop ? whenOfDay(t, today) : null })).join("")}</div>`
      : `<div class="empty">${p.total ? "Всё на сегодня выполнено." : "На этот день пока нет задач."}<button type="button" class="btn small" data-action="new-task" data-date="${today}">Добавить задачу</button></div>`}
    ${list.filter(isOpen).length > n ? `<a href="#/tasks?view=today" style="font-size:14px">Ещё ${list.filter(isOpen).length - n}</a>` : ""}
  </section>`;
}

function renderMiniMonth(ctx) {
  const [y, m] = ctx.ui.calMonth.split("-").map(Number);
  const grid = monthGrid(y, m - 1, ctx.settings.week_start);
  const marks = monthMarks(ctx.rows, grid[0].iso, grid[grid.length - 1].iso);
  const sel = ctx.ui.selectedDate || ctx.today;
  const count = marks[sel]?.count || 0;
  return `<section class="card" aria-label="Календарь">
    <div class="card-head"><h2>${esc(monthTitle(y, m - 1))}</h2>
      <div class="row" style="gap:4px">
        <button type="button" class="icon-btn small" data-action="cal-prev" aria-label="Предыдущий месяц">${icons.left(16)}</button>
        <button type="button" class="icon-btn small" data-action="cal-next" aria-label="Следующий месяц">${icons.right(16)}</button>
      </div></div>
    <div class="cal-grid">
      ${weekHeader(ctx.settings.week_start).map((w) => `<span class="cal-wd">${w}</span>`).join("")}
      ${grid.map((c) => dayCell(ctx, c, marks[c.iso], sel, ctx.wsize === "L")).join("")}
    </div>
    <a href="#/calendar?date=${sel}" class="row" style="justify-content:space-between;border-top:1px solid var(--divider);padding-top:10px;font-size:14px">
      <span style="color:var(--text)">${esc(relativeDay(sel, ctx.today))} · ${count} ${plural(count, "дело", "дела", "дел")}</span><span>Открыть день →</span></a>
  </section>`;
}

function dayCell(ctx, c, mark, sel, big = false) {
  const cls = ["cal-day", c.inMonth ? "" : "out", c.iso === ctx.today ? "today" : "", c.iso === sel ? "selected" : ""].join(" ");
  const d = parseIso(c.iso);
  const label = `${d.getDate()} ${["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"][d.getMonth()]}` +
    (mark ? `, ${mark.count} ${plural(mark.count, "дело", "дела", "дел")}` : "");
  const dots = mark ? mark.colors.map((col) => `<i style="background:${esc(col)}"></i>`).join("") + (mark.overflow ? `<em class="more">+${mark.overflow}</em>` : "") : "";
  return `<button type="button" class="${cls}" data-action="pick-date" data-date="${c.iso}" aria-label="${esc(label)}" ${c.iso === sel ? 'aria-current="date"' : ""}>
    <span>${c.day}</span><span class="dots">${dots}</span>${big && mark ? `<span class="count">${mark.count} ${plural(mark.count, "дело", "дела", "дел")}</span>` : ""}</button>`;
}

function renderUpcoming(ctx) {
  const u = upcoming(ctx.rows, ctx.today, ctx.nowMin), n = limitOf(ctx);
  const ev = u.events.slice(0, n).map((t) => `<button type="button" class="up-item" data-action="open-task" data-id="${esc(t.id)}">
      <span style="width:64px;flex-shrink:0;display:flex;flex-direction:column"><span class="muted" style="font-size:12px">${esc(relativeDay(t.planned_date, ctx.today))}</span><span style="font-weight:600;font-variant-numeric:tabular-nums">${hhmm(t.planned_time)}</span></span>
      <span class="task-title">${esc(t.title)}</span></button>`).join("");
  const dl = u.deadlines.slice(0, n).map((t) => `<button type="button" class="up-item" style="justify-content:space-between" data-action="open-task" data-id="${esc(t.id)}">
      <span class="task-title">${esc(t.title)}</span><span style="color:var(--warn);white-space:nowrap;font-size:14px">до ${esc(t.due_date === ctx.today ? "сегодня" : shortDate(t.due_date, { today: ctx.today }))}${t.due_time ? " " + hhmm(t.due_time) : ""}</span></button>`).join("");
  return `<section class="card" aria-label="Ближайшие дела">
    <div class="card-head"><h2>Ближайшие дела</h2><a href="#/tasks?view=week" style="font-size:14px">Все</a></div>
    ${ev || '<div class="empty">На неделю событий со временем нет.</div>'}
    ${dl ? `<span class="eyebrow" style="border-top:1px solid var(--divider);padding-top:10px">Дедлайны</span>${dl}` : ""}
  </section>`;
}

function renderWeekStrip(ctx) {
  const start = ctx.today;
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const marks = monthMarks(ctx.rows, days[0], days[6]);
  const wd = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
  return `<section class="card" aria-label="Неделя" style="padding:12px">
    <div class="week-strip">${days.map((d) => {
      const m = marks[d];
      return `<button type="button" class="${d === ctx.today ? "today" : ""}" data-action="pick-date" data-date="${d}" data-go="calendar" aria-label="${esc(longDate(d))}${m ? ", " + m.count + " " + plural(m.count, "дело", "дела", "дел") : ""}">
        <span class="wd">${wd[parseIso(d).getDay()]}</span><span class="n">${parseIso(d).getDate()}</span>
        <span class="dots">${m ? m.colors.map((c) => `<i style="background:${esc(c)}"></i>`).join("") : ""}</span></button>`;
    }).join("")}</div></section>`;
}

// ----------------------------------------------------- рабочий стол (раздел 5) --

// Размер виджета (раздел 5): на компьютере S, M, L в пределах колонки, на
// телефоне — плотность (компактно = S). Меняет, сколько виджет показывает.
const LIMIT = { S: 3, M: 5, L: 12 };
const limitOf = (ctx) => LIMIT[ctx.wsize] || LIMIT.M;

export const WIDGETS = {
  summary: "Сводка дня",
  plan: "План на сегодня",
  upcoming: "Ближайшие дела",
  calendar: "Календарь",
  focus: "Фокус дня",
  progress: "Прогресс",
  overdue: "Просроченное",
  inbox: "Входящие",
};

// Первые четыре включены по умолчанию; порядок телефона — из раздела 5:
// сводка → ближайшие → календарь → прогресс.
export function defaultLayout(kind) {
  return kind === "desktop"
    ? [{ type: "summary", col: "main" }, { type: "plan", col: "main" }, { type: "calendar", col: "side" }, { type: "upcoming", col: "side" }]
    : [{ type: "summary" }, { type: "upcoming" }, { type: "calendar" }, { type: "plan" }, { type: "progress" }];
}

export function layoutOf(ctx) {
  const kind = ctx.isDesktop ? "desktop" : "phone";
  const saved = ctx.ui.layoutDraft?.[kind] || ctx.settings.home_layout?.[kind];
  const list = Array.isArray(saved) && saved.length ? saved.filter((w) => WIDGETS[w.type]) : defaultLayout(kind);
  return { kind, list };
}

function renderFocus(ctx) {
  const f = ctx.settings.focus;
  const ids = f?.date === ctx.today ? f.ids || [] : [];
  const tasks = ids.map((id) => ctx.rows.tasks.find((t) => t.id === id)).filter(Boolean);
  const picking = ctx.ui.focusPick;
  const candidates = tasksOfDay(ctx.rows, ctx.today).filter(isOpen).concat(overdue(ctx.rows, ctx.today, ctx.nowMin)).filter((t, i, a) => a.findIndex((x) => x.id === t.id) === i);
  return `<section class="card" aria-label="Фокус дня">
    <div class="card-head"><h2>Фокус дня</h2><button type="button" class="btn small quiet" data-action="focus-pick">${picking ? "Готово" : tasks.length ? "Изменить" : "Выбрать"}</button></div>
    ${picking ? `<span class="muted" style="font-size:13px">До трёх задач, на которых сосредоточиться сегодня.</span>
      <div class="task-list">${candidates.map((t) => `<label class="switch-row"><span class="grow"><span>${esc(t.title)}</span></span>
        <input type="checkbox" class="switch" data-action="focus-toggle" data-id="${esc(t.id)}" ${ids.includes(t.id) ? "checked" : ""} ${!ids.includes(t.id) && ids.length >= 3 ? "disabled" : ""}></label>`).join("") || '<div class="empty">На сегодня открытых задач нет.</div>'}</div>`
    : tasks.length ? `<div class="task-list">${tasks.map((t) => taskRow(ctx, t)).join("")}</div>`
    : '<div class="empty">Выберите до трёх главных задач дня.</div>'}
  </section>`;
}

function renderProgressWidget(ctx) {
  const p = dayProgress(ctx.rows, ctx.today);
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  return `<section class="card" aria-label="Прогресс" style="padding:12px 16px">
    <div class="row"><span class="muted" style="font-size:13px;white-space:nowrap">Сегодня ${p.done} из ${p.total}</span>
      <span style="flex:1;height:6px;border-radius:3px;background:var(--divider);overflow:hidden" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Выполнено сегодня"><span style="display:block;height:100%;width:${pct}%;background:var(--accent)"></span></span></div>
  </section>`;
}

function renderOverdueWidget(ctx) {
  const list = overdue(ctx.rows, ctx.today, ctx.nowMin), n = limitOf(ctx);
  return `<section class="card" aria-label="Просроченное">
    <div class="card-head"><h2>Просроченное</h2><span class="meta" style="color:${list.length ? "var(--danger)" : "var(--text-dim)"}">${list.length}</span></div>
    ${list.length ? `<div class="task-list">${list.slice(0, n).map((t) => `${taskRow(ctx, t)}
      <div class="chips" style="padding:0 0 8px 36px"><button type="button" class="btn small" data-action="move-today" data-id="${esc(t.id)}">Перенести на сегодня</button>
      <button type="button" class="btn small quiet" data-action="toggle" data-id="${esc(t.id)}">Завершить</button>
      <button type="button" class="btn small quiet" data-action="delete-task" data-id="${esc(t.id)}">В корзину</button></div>`).join("")}</div>
      ${list.length > n ? `<a href="#/tasks?view=overdue" style="font-size:14px">Все ${list.length}</a>` : ""}` : '<div class="empty">Просроченного нет.</div>'}
  </section>`;
}

function renderInboxWidget(ctx) {
  const list = inbox(ctx.rows), n = limitOf(ctx);
  return `<section class="card" aria-label="Входящие">
    <div class="card-head"><h2>Входящие</h2><a href="#/tasks?view=inbox" style="font-size:14px">Разобрать</a></div>
    ${list.length ? `<div class="task-list">${list.slice(0, n).map((t) => taskRow(ctx, t)).join("")}</div>` : '<div class="empty">Входящие пусты.</div>'}
  </section>`;
}

function widgetHtml(ctx, type) {
  switch (type) {
    case "summary": return renderSummaryCard(ctx);
    case "plan": return renderPlanToday(ctx);
    case "upcoming": return renderUpcoming(ctx);
    case "calendar": return ctx.isDesktop ? renderMiniMonth(ctx) : renderWeekStrip(ctx);
    case "focus": return renderFocus(ctx);
    case "progress": return renderProgressWidget(ctx);
    case "overdue": return renderOverdueWidget(ctx);
    case "inbox": return renderInboxWidget(ctx);
    default: return "";
  }
}

// В режиме настройки у каждого виджета — «Выше», «Ниже», колонка, размер и
// «Скрыть»: перестановка без перетаскивания (раздел 5).
function editFrame(ctx, w, i, n, inner) {
  if (!ctx.ui.layoutDraft) return inner;
  return `<div class="widget-edit">
    <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:6px">
      <b style="font-size:14px">${esc(WIDGETS[w.type])}</b>
      <div class="chips">
        <button type="button" class="btn small" data-action="w-move" data-i="${i}" data-dir="-1" ${i === 0 ? "disabled" : ""} aria-label="Выше">↑ Выше</button>
        <button type="button" class="btn small" data-action="w-move" data-i="${i}" data-dir="1" ${i === n - 1 ? "disabled" : ""} aria-label="Ниже">↓ Ниже</button>
        ${ctx.isDesktop ? `<button type="button" class="btn small" data-action="w-col" data-i="${i}">${w.col === "side" ? "← В основную колонку" : "В боковую колонку →"}</button>` : ""}
        <button type="button" class="btn small danger" data-action="w-hide" data-i="${i}">Скрыть</button>
      </div></div>
    <div class="row" style="gap:6px;flex-wrap:wrap" role="radiogroup" aria-label="${ctx.isDesktop ? "Размер" : "Плотность"}">
      <span class="muted" style="font-size:13px">${ctx.isDesktop ? "Размер" : "Плотность"}</span>
      ${(ctx.isDesktop ? [["S", "S"], ["M", "M"], ["L", "L"]] : [["M", "Обычная"], ["S", "Компактная"]]).map(([v, label]) =>
        `<button type="button" class="chip-btn" role="radio" aria-checked="${(w.size || "M") === v}" data-action="w-size" data-i="${i}" data-size="${v}"${(w.size || "M") === v ? ' style="border-color:var(--accent);color:var(--accent)"' : ""}>${label}</button>`).join("")}
    </div>
    <div class="widget-preview" aria-hidden="true">${inner}</div></div>`;
}

export function renderHome(ctx) {
  const name = firstName(ctx.session);
  const { kind, list } = layoutOf(ctx);
  const editing = !!ctx.ui.layoutDraft;
  const head = `<header class="page-head"><div style="display:flex;flex-direction:column;gap:4px">
      <span class="eyebrow">${esc(longDate(ctx.today))}</span>
      <h1>${esc(greeting(ctx.nowMin))}${name ? ", " + esc(name) : ""}</h1></div>
      <div class="row" style="gap:8px">
        ${editing ? "" : `<button type="button" class="btn small quiet" data-action="layout-edit">Настроить</button>`}
        <span class="hide-desktop">${statusButton(ctx.status)}</span></div></header>`;
  const quick = renderQuickAdd(ctx, ctx.isDesktop ? "Новая задача — Enter добавит её во «Входящие»" : "Новая задача — во «Входящие»");
  const editBar = editing ? `<section class="alert info" role="status"><div class="grow"><b>Настройка главной — ${kind === "desktop" ? "для компьютера" : "для телефона"}</b>
      <span class="muted">Удаление виджета не удаляет задачи. Раскладка сохранится в аккаунте.</span>${ctx.ui.layoutMsg ? `<span class="form-msg bad">${esc(ctx.ui.layoutMsg)}</span>` : ""}</div>
      <div class="chips"><button type="button" class="btn small primary" data-action="layout-save">Готово</button>
      <button type="button" class="btn small quiet" data-action="layout-cancel">Отмена</button>
      <button type="button" class="btn small quiet" data-action="layout-reset">По умолчанию</button></div></section>` : "";
  const hidden = Object.keys(WIDGETS).filter((t) => !list.some((w) => w.type === t && !w.hidden));
  const library = editing && hidden.length ? `<section class="card" aria-label="Библиотека виджетов"><div class="card-head"><h2>Добавить виджет</h2></div>
      <div class="chips">${hidden.map((t) => `<button type="button" class="chip-btn" data-action="w-add" data-type="${t}">+ ${esc(WIDGETS[t])}</button>`).join("")}</div></section>` : "";
  const shown = list.map((w, i) => ({ w, i })).filter(({ w }) => !w.hidden);
  const render = (items) => items.map(({ w, i }) => editFrame(ctx, w, i, list.length,
    `<div class="w-size-${w.size || "M"}">${widgetHtml({ ...ctx, wsize: ctx.isDesktop || w.size === "S" ? w.size || "M" : "M" }, w.type)}</div>`)).join("");
  if (!ctx.isDesktop) {
    return `${head}${renderNotices(ctx)}${editBar}${quick}${render(shown)}${library}`;
  }
  const main = shown.filter(({ w }) => w.col !== "side"), side = shown.filter(({ w }) => w.col === "side");
  return `${head}${renderNotices(ctx)}${editBar}
    <div class="grid-home">
      <div class="col">${quick}${render(main)}</div>
      <div class="col">${render(side)}</div>
    </div>${library}`;
}

// -------------------------------------------------------------------- задачи --

export function renderTasks(ctx0) {
  const q = (ctx0.ui.search || "").trim();
  // поиск сужает текущее представление, поэтому сочетается с датой, разделом и группой
  const ctx = q ? { ...ctx0, rows: { ...ctx0.rows, tasks: ctx0.rows.tasks.filter((t) => matchesSearch(t, q)) } } : ctx0;
  const { rows, today, nowMin } = ctx;
  const params = ctx.route.params;
  const view = params.view || (params.section || params.group ? "all" : "all");
  const c = counts(ctx);
  const tabCount = { inbox: c.inbox, today: c.today, week: c.week, overdue: c.overdue };
  const tabs = VIEWS.map((v) => `<a class="tab" role="tab" href="#/tasks?view=${v.id}" aria-selected="${view === v.id && !params.section ? "true" : "false"}" style="display:inline-flex;align-items:center">${v.label}${tabCount[v.id] ? " · " + tabCount[v.id] : ""}</a>`).join("");
  const selectedId = ctx.ui.editor?.id;
  let body = "";

  if (view === "today") {
    const list = tasksOfDay(rows, today);
    const late = overdue(rows, today, nowMin);
    body = (late.length ? `<div class="alert"><div class="grow"><b>Просрочено · ${late.length}</b><span class="muted">Не переносится само — решите по каждой задаче</span></div><a class="btn small" href="#/tasks?view=overdue">Разобрать</a></div>` : "") +
      (() => { const pg = paged(ctx, "today", list, 100);
        return card(list.length ? `<div class="task-list">${pg.shown.map((t) => taskRow(ctx, t, { when: whenOfDay(t, today), selected: t.id === selectedId })).join("")}</div>${pg.more}` : emptyDay(today), `Сегодня · ${longDate(today)}`); })();
  } else if (view === "inbox") {
    const list = inbox(rows);
    const pg = paged(ctx, "inbox", list);
    body = card(list.length ? `<div class="task-list">${pg.shown.map((t) => taskRow(ctx, t, { selected: t.id === selectedId })).join("")}</div>${pg.more}`
      : '<div class="empty">Входящие пусты: у всех задач есть дата и группа.</div>', "Входящие", "Задачи без даты или без группы — разберите: назначьте день или группу");
  } else if (view === "week") {
    const list = nextDays(rows, today);
    const byDay = {};
    for (const t of list) {
      const d = [t.planned_date, t.due_date].filter((x) => x && x >= today).sort()[0];
      (byDay[d] ||= []).push(t);
    }
    body = Object.keys(byDay).sort().map((d) => { const pg = paged(ctx, "week:" + d, byDay[d]);
      return card(`<div class="task-list">${pg.shown.map((t) => taskRow(ctx, t, { when: whenOfDay(t, d), selected: t.id === selectedId })).join("")}</div>${pg.more}`, relativeDay(d, today), longDate(d)); }).join("")
      || card('<div class="empty">На ближайшие 7 дней задач нет.</div>', "Ближайшие 7 дней");
  } else if (view === "overdue") {
    const list = overdue(rows, today, nowMin);
    const pg = paged(ctx, "overdue", list);
    body = card(list.length ? `<div class="task-list">${pg.shown.map((t) => `${taskRow(ctx, t, { selected: t.id === selectedId })}
      <div class="chips" style="padding:0 0 10px 36px"><button type="button" class="btn small" data-action="move-today" data-id="${esc(t.id)}">На сегодня</button>
      <button type="button" class="btn small quiet" data-action="open-task" data-id="${esc(t.id)}">Перенести…</button></div>`).join("")}</div>${pg.more}`
      : '<div class="empty">Просроченных задач нет.</div>', "Просроченные", "Ничего не переносится автоматически");
  } else if (view === "trash") {
    body = renderTrash(ctx, q);
  } else if (view === "done") {
    const list = rows.tasks.filter((t) => t.completed).sort((a, b) => String(b.completed_at || "").localeCompare(String(a.completed_at || "")));
    const pg = paged(ctx, "done", list);
    body = card(list.length ? `<div class="task-list">${pg.shown.map((t) => taskRow(ctx, t, { selected: t.id === selectedId })).join("")}</div>${pg.more}` : '<div class="empty">Завершённых задач пока нет.</div>', "Завершённые");
  } else {
    body = renderGrouped(ctx, params.section || null, selectedId);
  }

  const main = `
    <header class="page-head"><h1>Задачи</h1>
      <div class="row" style="gap:8px"><button type="button" class="btn small" data-action="manage">Разделы и группы</button>${ctx.isDesktop ? "" : statusButton(ctx.status)}</div></header>
    <div class="chips scroll" role="tablist" aria-label="Представления">${tabs}</div>
    <label class="quick-add" style="min-height:44px"><span aria-hidden="true">${icons.search(18)}</span>
      <input type="search" data-key="search" data-draft="search" value="${esc(ctx.ui.search || "")}" aria-label="Поиск по названиям и описаниям" placeholder="Поиск по названиям и описаниям" autocomplete="off">
      ${q ? `<button type="button" class="btn small quiet" data-action="clear-search">Сбросить</button>` : ""}</label>
    ${renderNotices(ctx)}
    ${renderQuickAdd(ctx, view === "today" ? "Новая задача на сегодня" : "Новая задача — Enter добавит её во «Входящие»")}
    <div class="col">${body}</div>`;
  if (ctx.isDesktop && ctx.ui.editor) {
    return `<div class="layout-split"><div class="col">${main}</div><aside class="editor">${renderEditorPanel(ctx)}</aside></div>`;
  }
  return main;
}

function renderTrash(ctx, q) {
  const tr = ctx.trash || { status: "loading" };
  if (tr.status === "loading") return card('<div class="skeleton" style="width:60%"></div><div class="skeleton" style="width:40%"></div>', "Корзина");
  if (tr.status === "error") return card(`<div class="empty">Не удалось загрузить корзину — ничего не потеряно.<button type="button" class="btn small" data-action="reload-trash">Повторить</button></div>`, "Корзина");
  const list = tr.tasks.filter((t) => !q || matchesSearch(t, q));
  const until = (t) => {
    const d = new Date(t.deleted_at);
    d.setDate(d.getDate() + (tr.keep_days || 30));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  return card(list.length ? `<div class="task-list">${list.map((t) => `<div class="task">
      <div class="task-body"><span class="task-title">${esc(t.title)}</span>
        <span class="task-meta"><span>${esc(pathOf(ctx.rows, t).label)}</span><span>удалится окончательно ${esc(shortDate(until(t), { today: ctx.today }))}</span></span></div>
      <button type="button" class="btn small" data-action="restore-task" data-id="${esc(t.id)}">Восстановить</button></div>`).join("")}</div>`
    : '<div class="empty">Корзина пуста.</div>', "Корзина", `Удалённое хранится ${tr.keep_days || 30} дней`);
}

// Постраничный вывод длинных списков (раздел 15: 10 000 задач не должны
// тормозить): первые step, затем «Показать ещё» — по ключу списка.
function paged(ctx, key, list, step = 50) {
  const n = (ctx.ui.more?.[key] || 0) + step;
  const shown = list.slice(0, n);
  const rest = list.length - shown.length;
  const more = rest > 0 ? `<button type="button" class="btn small quiet" style="align-self:flex-start" data-action="show-more" data-key="${esc(key)}" data-step="${step}">Показать ещё ${Math.min(rest, step)} из ${rest}</button>` : "";
  return { shown, more };
}

function card(inner, title, meta) {
  return `<section class="card">${title ? `<div class="card-head"><h2>${esc(title)}</h2>${meta ? `<span class="meta">${esc(meta)}</span>` : ""}</div>` : ""}${inner}</section>`;
}

function emptyDay(day) {
  return `<div class="empty">На этот день пока нет задач.<button type="button" class="btn small" data-action="new-task" data-date="${day}">Добавить задачу</button></div>`;
}

function renderGrouped(ctx, sectionFilter, selectedId) {
  const { rows } = ctx;
  const showDone = ctx.ui.showDone;
  const sections = rows.sections.filter((s) => !sectionFilter || s.id === sectionFilter);
  let out = "";
  const inboxNoGroup = rows.tasks.filter((t) => !t.group_id && (showDone || isOpen(t)));
  if (!sectionFilter && inboxNoGroup.length) {
    out += `<section class="card"><div class="group-head"><h2>Входящие</h2><span class="path">без группы</span><span class="right">${inboxNoGroup.length}</span></div>
      ${(() => { const pg = paged(ctx, "g:inbox", inboxNoGroup.sort(dayOrder), 20); return `<div class="task-list">${pg.shown.map((t) => taskRow(ctx, t, { showPath: false, selected: t.id === selectedId })).join("")}</div>${pg.more}`; })()}</section>`;
  }
  // группы — тоже порциями: сотня групп по двадцать задач — это 2000 строк сразу
  const allGroups = sections.flatMap((sec) => rows.groups.filter((x) => x.section_id === sec.id).map((g) => ({ s: sec, g })));
  const gp = paged(ctx, "groups", allGroups, 15);
  for (const { s, g } of gp.shown) {
    {
      const all = rows.tasks.filter((t) => t.group_id === g.id);
      const list0 = all.filter((t) => showDone || isOpen(t)).sort(sortForList);
      const pg = paged(ctx, "g:" + g.id, list0, 10);
      const list = pg.shown;
      const done = all.filter((t) => t.completed).length;
      out += `<section class="card" aria-label="${esc(g.name)}">
        <div class="group-head"><span class="sq" style="background:${esc(s.color)}"></span><span class="path">${esc(s.name)} /</span><h2>${esc(g.name)}</h2><span class="right">${done} / ${all.length}</span></div>
        ${list.length ? `<div class="task-list">${list.map((t) => taskRow(ctx, t, { showPath: false, selected: t.id === selectedId })).join("")}</div>${pg.more}` : '<div class="empty">Открытых задач нет.</div>'}
        <button type="button" class="btn small quiet" style="align-self:flex-start" data-action="new-task" data-group="${esc(g.id)}">${icons.plus(16)}Задача в «${esc(g.name)}»</button>
      </section>`;
    }
  }
  if (gp.more) out += gp.more.replace(/Показать ещё/, "Показать ещё группы:");
  const orphanGroups = rows.groups.filter((g) => !rows.sections.some((s) => s.id === g.section_id));
  for (const g of sectionFilter ? [] : orphanGroups) {
    const list = rows.tasks.filter((t) => t.group_id === g.id && (showDone || isOpen(t))).sort(sortForList);
    out += `<section class="card"><div class="group-head"><h2>${esc(g.name)}</h2><span class="path">без раздела</span></div>
      ${list.length ? `<div class="task-list">${list.map((t) => taskRow(ctx, t, { showPath: false, selected: t.id === selectedId })).join("")}</div>` : '<div class="empty">Открытых задач нет.</div>'}</section>`;
  }
  const doneCount = rows.tasks.filter((t) => t.completed).length;
  out += `<button type="button" class="collapse" data-action="toggle-done">${showDone ? "Скрыть выполненные" : `Показать выполненные · ${doneCount}`}</button>`;
  return out || '<div class="empty">Разделов пока нет. Создайте первый в «Разделы и группы».</div>';
}

// Внутри группы: открытые по ближайшей дате, без даты — после, выполненные в конце.
function sortForList(a, b) {
  if (a.completed !== b.completed) return a.completed ? 1 : -1;
  const da = a.planned_date || a.due_date || "9999", db = b.planned_date || b.due_date || "9999";
  return da.localeCompare(db) || (a.position ?? 0) - (b.position ?? 0);
}

// ----------------------------------------------------------------- календарь --

export function renderCalendar(ctx) {
  const [y, m] = ctx.ui.calMonth.split("-").map(Number);
  const grid = monthGrid(y, m - 1, ctx.settings.week_start);
  const marks = monthMarks(ctx.rows, grid[0].iso, grid[grid.length - 1].iso);
  const sel = ctx.ui.selectedDate || ctx.today;
  const legend = ctx.rows.sections.map((s) => `<span class="row" style="gap:6px"><span class="sq" style="background:${esc(s.color)};width:6px;height:6px"></span>${esc(s.name)}</span>`).join("");
  const month = `<section class="card cal-big" aria-label="Месяц">
      <div class="cal-grid">${weekHeader(ctx.settings.week_start).map((w) => `<span class="cal-wd">${w}</span>`).join("")}${grid.map((c) => dayCell(ctx, c, marks[c.iso], sel, true)).join("")}</div>
      <div class="row muted" style="flex-wrap:wrap;gap:14px;font-size:12px">${legend}<span style="margin-left:auto">Точки — есть открытые дела, не часы занятости</span></div>
    </section>`;
  return `<header class="page-head">
      <div class="row" style="flex-wrap:wrap"><h1>Календарь</h1>
        <div class="row" style="gap:4px"><button type="button" class="icon-btn small" data-action="cal-prev" aria-label="Предыдущий месяц">${icons.left(16)}</button>
        <button type="button" class="icon-btn small" data-action="cal-next" aria-label="Следующий месяц">${icons.right(16)}</button></div>
        <span style="font-size:18px;font-weight:600">${esc(monthTitle(y, m - 1))}</span>
        <button type="button" class="btn small" data-action="cal-today">Сегодня</button></div>
      ${ctx.isDesktop ? "" : statusButton(ctx.status)}</header>
    ${renderNotices(ctx)}
    <div class="grid-home"><div class="col">${month}</div><div class="col">${renderDayPanel(ctx, sel)}</div></div>`;
}

function renderDayPanel(ctx, day) {
  const { rows } = ctx;
  const list = tasksOfDay(rows, day);
  const load = dayLoad(rows, day, ctx.settings.workday);
  const ws = load.workday.start, we = load.workday.end;
  const startH = Math.floor(Math.min(ws, ...load.blocks.map((b) => b.start)) / 60);
  const endH = Math.ceil(Math.max(we, ...load.blocks.map((b) => b.end)) / 60);
  const H = 34;
  const hours = [];
  for (let h = startH; h <= endH; h++) hours.push(`<div class="hour" style="top:${(h - startH) * H}px"><span>${String(h).padStart(2, "0")}:00</span><i></i></div>`);
  const blocks = load.blocks.map((b) => {
    const top = ((b.start - startH * 60) / 60) * H;
    const height = Math.max(22, (b.task.duration_minutes / 60) * H - 2);
    return `<button type="button" class="block" style="top:${top}px;height:${height}px" data-action="open-task" data-id="${esc(b.task.id)}">
      <b>${esc(b.task.title)}</b>${height > 34 ? `<small>${timeOf(b.start)}–${timeOf(b.end)}</small>` : ""}</button>`;
  }).join("");
  const timedNoDur = list.filter((t) => isOpen(t) && t.planned_date === day && t.planned_time && !t.duration_minutes);
  const noTime = list.filter((t) => isOpen(t) && t.planned_date === day && !t.planned_time);
  const dues = list.filter((t) => isOpen(t) && t.due_date === day && t.planned_date !== day);
  const done = list.filter((t) => t.completed);
  const openCount = list.length - done.length; // то же число, что в ячейке месяца (A33)
  const freeText = load.free.length ? load.free.map((f) => `${timeOf(f.start)}–${timeOf(f.end)}`).join(" · ") : "нет";
  const busyText = load.busy ? `Занято ${load.unknown ? "минимум " : ""}${durationText(load.busy)}` : load.unknown ? "Занятость неизвестна" : "Ничего не запланировано по времени";
  const sectionList = (title, items, fmt) => items.length ? `<div style="display:flex;flex-direction:column;gap:4px;border-top:1px solid var(--divider);padding-top:10px">
      <span class="eyebrow">${title}</span>${items.map((t) => `<button type="button" class="up-item" style="justify-content:space-between;min-height:36px" data-action="open-task" data-id="${esc(t.id)}"><span class="task-title">${esc(t.title)}</span><span class="muted" style="font-size:13px;white-space:nowrap">${esc(fmt(t))}</span></button>`).join("")}</div>` : "";
  return `<section class="card" aria-label="${esc(longDate(day))}">
    <div class="card-head"><h2>${esc(longDate(day))}</h2><span class="meta">${openCount} ${plural(openCount, "открытое", "открытых", "открытых")}${done.length ? ` · ${done.length} ${plural(done.length, "выполнено", "выполнено", "выполнено")}` : ""}</span></div>
    <div class="free-box"><span>Рабочий день ${timeOf(ws)}–${timeOf(we)}. ${esc(busyText)}${load.unknown ? `; у ${load.unknown} ${plural(load.unknown, "дела", "дел", "дел")} длительность не указана` : ""}.</span>
      <span class="ok">Свободно: ${esc(freeText)}${load.unknown ? " — без учёта дел без длительности" : ""}</span></div>
    ${load.blocks.length ? `<div class="timeline" style="height:${(endH - startH) * H + 8}px">${hours.join("")}${blocks}</div>` : ""}
    ${sectionList("Время есть, длительность не указана", timedNoDur, (t) => hhmm(t.planned_time))}
    ${sectionList("Без времени", noTime, (t) => t.duration_minutes ? durationText(t.duration_minutes) : "длительность не указана")}
    ${sectionList("Дедлайны — время не занимают", dues, (t) => t.due_time ? "до " + hhmm(t.due_time) : "до конца дня")}
    ${sectionList("Выполнено", done, () => "")}
    ${list.length ? "" : '<div class="empty">На этот день пока нет задач.</div>'}
    <button type="button" class="btn small" style="align-self:flex-start" data-action="new-task" data-date="${day}">${icons.plus(16)}Задача на этот день</button>
  </section>`;
}

// ----------------------------------------------------------------- помощник --

const DRAFT_FIELD = {
  title: "название", notes: "описание", planned_date: "на", planned_time: "время", due_date: "до", due_time: "время дедлайна",
  duration_minutes: "длительность", group_id: "группа", priority: "приоритет", completed: "выполнено",
};

function draftValue(ctx, k, v) {
  if (v === null || v === undefined || v === "") return "—";
  if (k.endsWith("_date")) return shortDate(v, { weekday: true, today: ctx.today });
  if (k.endsWith("_time")) return hhmm(v);
  if (k === "duration_minutes") return durationText(v);
  if (k === "group_id") return ctx.rows.groups.find((g) => g.id === v)?.name || "—";
  if (k === "priority") return { low: "низкий", normal: "обычный", high: "высокий" }[v] || v;
  if (k === "completed") return v ? "да" : "нет";
  return String(v);
}

function renderDraft(ctx, d, i, msgIndex, locked) {
  let body;
  if (d.type === "create") {
    const f = d.fields;
    const bits = [f.planned_date ? `на ${draftValue(ctx, "planned_date", f.planned_date)}${f.planned_time ? " · " + hhmm(f.planned_time) : ""}` : "",
      f.due_date ? `до ${draftValue(ctx, "due_date", f.due_date)}${f.due_time ? " " + hhmm(f.due_time) : ""}` : "",
      f.duration_minutes ? durationText(f.duration_minutes) : "", f.group_id ? draftValue(ctx, "group_id", f.group_id) : "Входящие"].filter(Boolean);
    body = `<b>Новая задача:</b> ${esc(f.title)}<span class="muted" style="font-size:13px">${esc(bits.join(" · "))}</span>`;
  } else if (d.type === "delete") {
    body = `<b>Удалить:</b> ${esc(d.before?.title || "")}<span class="muted" style="font-size:13px">уйдёт в корзину на 30 дней</span>`;
  } else if (d.fields.completed === true && Object.keys(d.fields).length === 1) {
    body = `<b>Отметить выполненной:</b> ${esc(d.before?.title || "")}`;
  } else {
    const rows = Object.entries(d.fields).map(([k, v]) => `<span class="h">${esc(DRAFT_FIELD[k] || k)}</span><span>${esc(draftValue(ctx, k, d.before?.[k]))}</span><span>${esc(draftValue(ctx, k, v))}</span>`).join("");
    body = `<b>Изменить:</b> ${esc(d.before?.title || "")}<div class="conflict-grid"><span></span><span class="h">Было</span><span class="h">Станет</span>${rows}</div>`;
  }
  return `<label class="draft ${d.type === "delete" ? "danger" : ""}">
    ${locked ? "" : `<input type="checkbox" data-action="draft-pick" data-msg="${msgIndex}" data-i="${i}" ${d.skip ? "" : "checked"} aria-label="Применить это изменение">`}
    <span style="display:flex;flex-direction:column;gap:4px;min-width:0">${body}</span></label>`;
}

function renderChatMessage(ctx, m, idx) {
  if (m.role === "user") return `<div class="bubble user">${esc(m.content)}</div>`;
  const refs = (m.refs || []).map((id) => ctx.rows.tasks.find((t) => t.id === id)).filter(Boolean);
  const drafts = m.drafts || [];
  const locked = m.state === "applied" || m.state === "cancelled" || m.state === "auto";
  const chosen = drafts.filter((d) => !d.skip).length;
  return `<div class="bubble bot">
    ${m.error ? `<span class="form-msg bad">${esc(m.error)}</span>` : `<span style="white-space:pre-line">${esc(m.content)}</span>`}
    ${refs.length ? `<div class="chips">${refs.map((t) => `<button type="button" class="chip-btn" data-action="open-task" data-id="${esc(t.id)}">${esc(t.title.length > 40 ? t.title.slice(0, 39) + "…" : t.title)}</button>`).join("")}</div>` : ""}
    ${drafts.length && m.state === "pending" ? `<span class="eyebrow">Предлагаю — проверьте перед применением</span>` : ""}
    ${drafts.length ? `<div style="display:flex;flex-direction:column;gap:8px">${drafts.map((d, i) => renderDraft(ctx, d, i, idx, locked)).join("")}</div>
      ${m.state === "pending" ? `<div class="chips"><button type="button" class="btn small primary" data-action="draft-apply" data-msg="${idx}" ${chosen ? "" : "disabled"}>Применить${drafts.length > 1 ? ` (${chosen})` : ""}</button>
        <button type="button" class="btn small quiet" data-action="draft-cancel" data-msg="${idx}">Отмена</button></div>`
      : m.state === "auto" ? `<div class="row"><span class="form-msg ok">Добавлено</span><button type="button" class="btn small quiet" data-action="draft-undo" data-msg="${idx}">Отменить</button></div>`
      : `<span class="form-msg ${m.state === "applied" ? "ok" : ""}">${m.state === "applied" ? "Применено — изменения ушли в очередь" : "Отменено, ничего не изменено"}</span>`}` : ""}
    ${m.rejected?.length ? `<span class="muted" style="font-size:12px">Не принято сервером: ${esc(m.rejected.join("; "))}</span>` : ""}
  </div>`;
}

export function renderAssistant(ctx) {
  const s = ctx.settings;
  const a = ctx.ui.assistant;
  if (!s.assistant_consent_at) {
    return `<header class="page-head"><h1>Помощник</h1></header>
      ${renderNotices(ctx)}
      <section class="card" aria-label="Включение помощника"><div class="summary">${blob()}<div style="display:flex;flex-direction:column;gap:10px">
        <span class="summary-title">Помощник планирует день по вашим задачам</span>
        <span class="summary-text">Собирает день, подсказывает, что дальше, разбирает входящие, находит окно нужной длительности, переносит и добавляет задачи — всё, что меняет данные, только после вашего подтверждения.</span>
        <span class="summary-text"><b>Что передаётся.</b> Для ответа ваш вопрос, до 60 задач, относящихся к нему (названия, описания, даты), названия групп и расчёт загрузки дня уходят на сервер MARK и ИИ-провайдеру Groq. Весь аккаунт не отправляется; пароль и ключи — никогда. Без помощника всё остальное работает как прежде.</span>
        <div class="chips"><button type="button" class="btn primary" data-action="assistant-consent">Включить помощника</button></div>
      </div></div></section>
      ${renderSummaryCard(ctx)}`;
  }
  const offline = ctx.status?.state === "offline";
  const stale = ctx.status?.unconfirmed || 0;
  const chips = ["Собери мне день", "Что дальше?", "Разбери входящие", "Что у меня завтра?", "У меня 2 часа — что успею?"];
  return `<header class="page-head"><h1>Помощник</h1>
      <div class="row" style="gap:8px">${a.chat.length ? `<button type="button" class="btn small quiet" data-action="assistant-clear">Очистить историю</button>` : ""}${ctx.isDesktop ? "" : statusButton(ctx.status)}</div></header>
    ${renderNotices(ctx)}
    <div class="layout-split">
      <div class="col">
        <section class="card chat" aria-label="Диалог" aria-live="polite">
          ${a.chat.length ? a.chat.map((m, i) => renderChatMessage(ctx, m, i)).join("") : `<div class="empty">Спросите о дне или поручите: «перенеси незавершённое на завтра», «добавь созвон в пятницу в 11».</div>`}
          ${a.busy ? '<div class="bubble bot"><span class="muted">Думаю…</span></div>' : ""}
        </section>
        ${offline ? '<div class="alert warn"><div class="grow">Нет сети — помощнику нужна связь. Задачи по-прежнему можно менять вручную.</div></div>'
          : stale ? `<div class="alert info"><div class="grow">${stale} ${plural(stale, "изменение ещё не отправлено", "изменения ещё не отправлены", "изменений ещё не отправлены")} — ответ может не учитывать их.</div></div>` : ""}
        <div class="chips">${chips.map((c) => `<button type="button" class="chip-btn" data-action="assistant-ask" data-text="${esc(c)}" ${a.busy || offline ? "disabled" : ""}>${esc(c)}</button>`).join("")}</div>
        <form class="quick-add" data-action="assistant-send">
          <input name="message" data-key="assistant" data-draft="assistantInput" value="${esc(a.input)}" maxlength="2000" autocomplete="off" aria-label="Сообщение помощнику" placeholder="Спросите или поручите — черновик не пропадёт">
          <button type="submit" class="btn small primary" ${a.busy || offline ? "disabled" : ""} aria-label="Отправить">${icons.send(16)}</button>
        </form>
      </div>
      <aside class="col">
        ${renderSummaryCard(ctx)}
        <section class="card"><div class="card-head"><h2>Правила</h2></div>
          <span class="summary-text">Несколько задач, удаление, перенос дедлайна — только после подтверждения. Если задачу изменили на другом устройстве, пока вы смотрели черновик, изменение не применится молча — покажем конфликт.</span>
          <span class="muted" style="font-size:13px">История диалога хранится на этом устройстве 30 дней.</span></section>
      </aside>
    </div>`;
}

// ------------------------------------------------------------------ редактор --

function groupOptions(ctx, selected) {
  const opts = [`<option value="" ${!selected ? "selected" : ""}>Входящие — без группы</option>`];
  for (const s of ctx.rows.sections) {
    const gs = ctx.rows.groups.filter((g) => g.section_id === s.id);
    if (!gs.length) continue;
    opts.push(`<optgroup label="${esc(s.name)}">${gs.map((g) => `<option value="${esc(g.id)}" ${g.id === selected ? "selected" : ""}>${esc(g.name)}</option>`).join("")}</optgroup>`);
  }
  const orphan = ctx.rows.groups.filter((g) => !ctx.rows.sections.some((s) => s.id === g.section_id));
  if (orphan.length) opts.push(`<optgroup label="Без раздела">${orphan.map((g) => `<option value="${esc(g.id)}" ${g.id === selected ? "selected" : ""}>${esc(g.name)}</option>`).join("")}</optgroup>`);
  return opts.join("");
}

function editorFields(ctx) {
  const ed = ctx.ui.editor;
  const d = ed.draft;
  const task = ed.id ? ctx.rows.tasks.find((t) => t.id === ed.id) : null;
  const dur = [["", "не указана"], ["15", "15 мин"], ["30", "30 мин"], ["45", "45 мин"], ["60", "1 ч"], ["90", "1 ч 30 мин"], ["120", "2 ч"], ["180", "3 ч"], ["240", "4 ч"]];
  if (d.duration_minutes && !dur.some(([v]) => v === String(d.duration_minutes))) dur.push([String(d.duration_minutes), durationText(d.duration_minutes)]);
  return `
    ${task ? `<div class="row" style="justify-content:space-between;font-size:12px"><span class="muted">${esc(pathOf(ctx.rows, task).label)}</span>${task._pending ? '<span class="muted">не отправлено</span>' : '<span style="color:var(--accent)">Сохранено</span>'}</div>` : ""}
    <label class="field"><span>Название</span>
      <input class="input" name="title" data-key="ed-title" data-draft="editor.title" value="${esc(d.title)}" required maxlength="200" autocomplete="off" ${ed.id ? "" : "autofocus"}></label>
    <label class="field"><span>Описание</span>
      <textarea class="textarea" name="notes" data-key="ed-notes" data-draft="editor.notes" maxlength="5000" rows="3">${esc(d.notes)}</textarea></label>
    <label class="field"><span>Раздел и группа</span><select class="select" name="group_id" data-draft="editor.group_id">${groupOptions(ctx, d.group_id)}</select></label>
    <div class="two">
      <div class="date-box plan"><span class="t">Запланировать на</span>
        <input class="input" type="date" name="planned_date" data-key="ed-pd" data-draft="editor.planned_date" value="${esc(d.planned_date || "")}" aria-label="Дата, на которую запланировано">
        <input class="input" type="time" name="planned_time" data-key="ed-pt" data-draft="editor.planned_time" value="${esc(hhmm(d.planned_time))}" aria-label="Время, на которое запланировано"></div>
      <div class="date-box due"><span class="t">Выполнить до</span>
        <input class="input" type="date" name="due_date" data-key="ed-dd" data-draft="editor.due_date" value="${esc(d.due_date || "")}" aria-label="Крайний срок">
        <input class="input" type="time" name="due_time" data-key="ed-dt" data-draft="editor.due_time" value="${esc(hhmm(d.due_time))}" aria-label="Время крайнего срока"></div>
    </div>
    <span class="muted" style="font-size:13px">Перенос работы на другой день не сдвигает дедлайн. Без даты задача попадёт во «Входящие».</span>
    <div class="two">
      <label class="field"><span>Длительность</span><select class="select" name="duration_minutes" data-draft="editor.duration_minutes">${dur.map(([v, l]) => `<option value="${v}" ${String(d.duration_minutes || "") === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label class="field"><span>Приоритет</span><select class="select" name="priority" data-draft="editor.priority">${[["normal", "Обычный"], ["high", "Высокий"], ["low", "Низкий"]].map(([v, l]) => `<option value="${v}" ${d.priority === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
    </div>
    ${ed.error ? `<div class="form-msg bad" role="alert">${esc(ed.error)}</div>` : ""}
    <div class="row" style="flex-wrap:wrap;gap:8px">
      <button type="submit" class="btn primary" style="flex:1">${ed.id ? "Сохранить" : "Добавить"}</button>
      ${task ? `<button type="button" class="btn" data-action="toggle" data-id="${esc(task.id)}" data-close="1">${task.completed ? "Вернуть в работу" : "Выполнено"}</button>
        <button type="button" class="btn danger" data-action="delete-task" data-id="${esc(task.id)}" aria-label="Удалить задачу">${icons.trash()}</button>` : ""}
    </div>`;
}

function renderEditorPanel(ctx) {
  const ed = ctx.ui.editor;
  return `<form class="card" data-action="save-task" aria-label="${ed.id ? "Задача" : "Новая задача"}">
    <div class="card-head"><h2>${ed.id ? "Задача" : "Новая задача"}</h2>
      <button type="button" class="icon-btn small" data-action="close-editor" aria-label="Закрыть">${icons.close(16)}</button></div>
    ${editorFields(ctx)}</form>`;
}

function renderEditorSheet(ctx) {
  const ed = ctx.ui.editor;
  return `<div class="sheet-scrim" data-action="close-editor"></div>
    <form class="sheet" role="dialog" aria-modal="true" aria-label="${ed.id ? "Задача" : "Новая задача"}" data-action="save-task">
      <span class="handle"></span>
      <div class="row" style="justify-content:space-between"><button type="button" class="btn quiet small" data-action="close-editor">Отмена</button>
        <h2 style="font-size:17px">${ed.id ? "Задача" : "Новая задача"}</h2><span style="width:72px"></span></div>
      ${editorFields(ctx)}
    </form>`;
}

// ------------------------------------------------- разделы и группы, диалог --

function renderManageSheet(ctx) {
  const { rows } = ctx;
  const mg = ctx.ui.manage;
  const colors = ["#7FA7D9", "#6ED6A0", "#F2B861", "#E0698E", "#9B6BDB", "#4FB3BF", "#E05C5C", "#7D8CA3"];
  const colorPick = (key, cur) => `<div class="chips" role="radiogroup" aria-label="Цвет">${colors.map((c) =>
    `<button type="button" role="radio" aria-checked="${c.toLowerCase() === String(cur || "").toLowerCase()}" aria-label="Цвет ${c}" data-action="pick-color" data-key="${key}" data-color="${c}" style="width:32px;height:32px;border-radius:16px;border:2px solid ${c.toLowerCase() === String(cur || "").toLowerCase() ? "var(--text)" : "transparent"};background:${c}"></button>`).join("")}</div>`;
  const sectionsHtml = rows.sections.map((s) => {
    const groups = rows.groups.filter((g) => g.section_id === s.id);
    return `<div style="display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--divider);padding-top:10px">
      <div class="row"><span class="sq" style="background:${esc(s.color)}"></span><b style="flex:1">${esc(s.name)}</b>
        <button type="button" class="icon-btn small" data-action="edit-section" data-id="${esc(s.id)}" aria-label="Изменить раздел ${esc(s.name)}">${icons.edit()}</button>
        <button type="button" class="icon-btn small" data-action="delete-section" data-id="${esc(s.id)}" aria-label="Удалить раздел ${esc(s.name)}">${icons.trash()}</button></div>
      ${groups.map((g) => `<div class="row" style="padding-left:18px"><span style="flex:1">${esc(g.name)} <span class="muted" style="font-size:12px">${rows.tasks.filter((t) => t.group_id === g.id && isOpen(t)).length}</span></span>
        <button type="button" class="icon-btn small" data-action="edit-group" data-id="${esc(g.id)}" aria-label="Изменить группу ${esc(g.name)}">${icons.edit()}</button>
        <button type="button" class="icon-btn small" data-action="delete-group" data-id="${esc(g.id)}" aria-label="Удалить группу ${esc(g.name)}">${icons.trash()}</button></div>`).join("")}
      <button type="button" class="btn small quiet" style="align-self:flex-start;margin-left:10px" data-action="new-group" data-section="${esc(s.id)}">${icons.plus(14)}Группа</button>
    </div>`;
  }).join("");

  let form = "";
  if (mg.form) {
    const f = mg.form;
    const isGroup = f.kind === "group";
    form = `<form class="card" data-action="save-structure" style="background:var(--bg)">
      <b>${f.id ? (isGroup ? "Группа" : "Раздел") : isGroup ? "Новая группа" : "Новый раздел"}</b>
      <label class="field"><span>Название</span><input class="input" name="name" data-key="mg-name" data-draft="manage.form.name" value="${esc(f.name || "")}" maxlength="80" required autofocus></label>
      ${isGroup ? `<label class="field"><span>Раздел</span><select class="select" name="section_id" data-draft="manage.form.section_id">${rows.sections.map((s) => `<option value="${esc(s.id)}" ${s.id === f.section_id ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></label>` : ""}
      ${colorPick("manage.form.color", f.color)}
      <div class="row"><button type="submit" class="btn primary">${f.id ? "Сохранить" : "Создать"}</button><button type="button" class="btn quiet" data-action="cancel-structure">Отмена</button></div>
    </form>`;
  }
  return `<div class="sheet-scrim" data-action="close-manage"></div>
    <div class="sheet" role="dialog" aria-modal="true" aria-label="Разделы и группы">
      <span class="handle"></span>
      <div class="row" style="justify-content:space-between"><h2 style="font-size:17px">Разделы и группы</h2>
        <button type="button" class="icon-btn small" data-action="close-manage" aria-label="Закрыть">${icons.close(16)}</button></div>
      ${form}
      ${sectionsHtml || '<div class="empty">Разделов пока нет.</div>'}
      <button type="button" class="btn" data-action="new-section">${icons.plus(16)}Раздел</button>
    </div>`;
}

// Подтверждение необратимых и массовых действий: удаление раздела или
// группы показывает число задач и предлагает перенос (раздел 3 ТЗ).
function renderConfirm(cf) {
  return `<div class="sheet-scrim" data-action="cancel-confirm"></div>
    <form class="sheet" role="alertdialog" aria-modal="true" aria-label="${esc(cf.title)}" data-action="confirm-submit">
      <h2 style="font-size:17px">${esc(cf.title)}</h2>
      <span class="soft" style="font-size:14px;line-height:1.5">${esc(cf.text)}</span>
      ${cf.moveOptions ? `<label class="field"><span>Перенести задачи в</span><select class="select" name="move_to" data-draft="confirm.moveTo">
        ${cf.moveOptions.map((o) => `<option value="${esc(o.value)}" ${o.value === cf.moveTo ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select></label>` : ""}
      <div class="row" style="flex-wrap:wrap"><button type="submit" class="btn ${cf.danger ? "danger" : "primary"}">${esc(cf.ok)}</button>
        <button type="button" class="btn quiet" data-action="cancel-confirm">Отмена</button></div>
    </form>`;
}

// ------------------------------------------------------------------- кабинет --

const ZONES = ["Europe/Kaliningrad", "Europe/Moscow", "Europe/Samara", "Asia/Yekaterinburg", "Asia/Omsk", "Asia/Novosibirsk",
  "Asia/Krasnoyarsk", "Asia/Irkutsk", "Asia/Yakutsk", "Asia/Vladivostok", "Asia/Magadan", "Asia/Kamchatka",
  "Asia/Almaty", "Asia/Tashkent", "Asia/Tbilisi", "Asia/Yerevan", "Asia/Baku", "Europe/Minsk", "Europe/Kiev",
  "Europe/Istanbul", "Asia/Dubai", "Europe/Berlin", "Europe/London", "America/New_York"];

export function renderProfile(ctx) {
  const s = ctx.settings;
  const msg = (key) => ctx.ui.saved[key] ? `<span class="form-msg ${ctx.ui.saved[key].cls}">${esc(ctx.ui.saved[key].text)}</span>` : "";
  const zones = [...new Set([s.timezone, ctx.tz?.device, ...ZONES].filter(Boolean))];
  const tg = ctx.telegram;
  let tgBlock;
  if (tg.status === "loading") tgBlock = '<span class="muted">Проверяю связь с Telegram…</span>';
  else if (tg.status === "error") tgBlock = '<span>Не удалось проверить связь с Telegram — привязка, если она была, не пострадала.</span><button type="button" class="btn small" data-action="retry-telegram">Проверить ещё раз</button>';
  else if (tg.status === "linked") tgBlock = `<div class="row"><span class="status ${tg.link.blocked_at ? "bad" : "ok"}" style="padding:0"><span class="dot"></span></span><span style="flex:1">Подключено: ${tg.link.telegram_username ? "@" + esc(tg.link.telegram_username) : "аккаунт привязан"}</span><button type="button" class="btn small quiet" data-action="unlink-telegram">Отвязать</button></div>
      ${tg.link.blocked_at ? '<span class="form-msg bad">Бот заблокирован в Telegram — сводки и напоминания не доставляются. Напишите боту любое сообщение, чтобы возобновить.</span>' : ""}`;
  else if (ctx.ui.linkCode) tgBlock = `<span class="soft" style="font-size:14px">Откройте бота и нажмите «Запустить» — привяжется автоматически. Код действует 10 минут.</span>
      <a class="btn primary" href="${esc(ctx.ui.linkCode.url)}" target="_blank" rel="noopener">Открыть @markplanner_bot</a>
      <span class="muted" style="font-size:13px">Или отправьте боту: <code>/start ${esc(ctx.ui.linkCode.code)}</code></span>`;
  else tgBlock = '<button type="button" class="btn" data-action="link-telegram">Подключить Telegram</button>';

  const toggle = (key, title, detail) => `<label class="switch-row"><span class="grow"><span>${title}</span><span class="muted" style="font-size:12px">${detail}</span></span>
    <input type="checkbox" class="switch" data-action="set-setting" data-setting="${key}" ${s[key] ? "checked" : ""}></label>`;
  const n = ctx.status?.unconfirmed || 0;

  return `<header class="page-head"><div class="row" style="gap:8px">${ctx.ui.profileFrom ? `<a class="icon-btn" href="${esc(ctx.ui.profileFrom)}" aria-label="Назад">${icons.left(20)}</a>` : ""}<h1>Кабинет</h1></div>${statusButton(ctx.status)}</header>
    ${renderNotices(ctx)}
    <div class="profile-grid">
      <section class="card" aria-label="Профиль">
        <div class="card-head"><h2>Профиль</h2></div>
        <span class="muted" style="font-size:14px">${esc(ctx.session.user.email)}</span>
        <form class="row" data-action="save-name" style="align-items:flex-end">
          <label class="field" style="flex:1"><span>Имя</span><input class="input" name="name" data-key="pf-name" data-draft="profile.name" value="${esc(ctx.ui.profile?.name ?? ctx.session.user.user_metadata?.display_name ?? "")}" maxlength="40" placeholder="Как к вам обращаться"></label>
          <button type="submit" class="btn">Сохранить</button></form>
        ${msg("name")}
        <form class="row" data-action="save-password" style="align-items:flex-end">
          <label class="field" style="flex:1"><span>Новый пароль</span><input class="input" type="password" name="password" data-key="pf-pass" minlength="6" autocomplete="new-password" placeholder="Минимум 6 символов"></label>
          <button type="submit" class="btn">Сменить</button></form>
        ${msg("password")}
      </section>

      <section class="card" aria-label="Оформление">
        <div class="card-head"><h2>Оформление</h2>${msg("theme")}</div>
        <div class="seg" role="radiogroup" aria-label="Тема">
          ${[["light", "Светлая"], ["dark", "Тёмная"], ["system", "Как в системе"]].map(([v, l]) => `<button type="button" role="radio" aria-checked="${s.theme === v}" data-action="set-theme" data-theme="${v}">${l}</button>`).join("")}
        </div>
        <span class="muted" style="font-size:13px">«Как в системе» — светлая или тёмная по настройке устройства. Выбор сохраняется в аккаунте.</span>
      </section>

      <section class="card" aria-label="Часовой пояс">
        <div class="card-head"><h2>Часовой пояс</h2>${msg("timezone")}</div>
        <label class="field"><span>Напоминания и сводки приходят по поясу</span>
          <select class="select" data-action="set-timezone">${zones.map((z) => `<option value="${esc(z)}" ${z === s.timezone ? "selected" : ""}>${esc(z)}${z === ctx.tz?.device ? " — это устройство" : ""}</option>`).join("")}</select></label>
        <span class="muted" style="font-size:13px">Если устройство окажется в другом поясе, приложение спросит — само не поменяет.</span>
      </section>

      <section class="card" aria-label="Уведомления">
        <div class="card-head"><h2>Уведомления в Telegram</h2>${msg("notify")}</div>
        <div>${toggle("morning_digest", "Утренняя сводка", "план на сегодня, дедлайны и просроченное")}${toggle("evening_digest", "Вечерняя сводка", "план на завтра")}${toggle("task_reminders", "Напоминание о задаче", "перед плановым временем, иначе — перед дедлайном со временем")}</div>
        <div class="two">
          <label class="field"><span>Утренняя сводка в</span><input class="input" type="time" data-notify-input="morning_time" value="${esc(hhmm(s.morning_time))}"></label>
          <label class="field"><span>Вечерняя сводка в</span><input class="input" type="time" data-notify-input="evening_time" value="${esc(hhmm(s.evening_time))}"></label>
        </div>
        <label class="field"><span>Напоминать за</span><select class="select" data-notify-input="reminder_lead">${[5, 15, 30, 60].map((v) => `<option value="${v}" ${Number(s.reminder_lead) === v ? "selected" : ""}>${v === 60 ? "1 час" : v + " минут"}</option>`).join("")}</select></label>
        <label class="switch-row"><span class="grow"><span>Тихие часы</span><span class="muted" style="font-size:12px">сводка — после них; напоминание — только если задача ещё впереди</span></span>
          <input type="checkbox" class="switch" data-action="set-setting" data-setting="quiet_enabled" ${s.quiet_enabled ? "checked" : ""}></label>
        ${s.quiet_enabled ? `<div class="two">
          <label class="field"><span>С</span><input class="input" type="time" data-notify-input="quiet_start" value="${esc(hhmm(s.quiet_start))}"></label>
          <label class="field"><span>До</span><input class="input" type="time" data-notify-input="quiet_end" value="${esc(hhmm(s.quiet_end))}"></label></div>` : ""}
      </section>

      <section class="card" aria-label="Telegram и синхронизация">
        <div class="card-head"><h2>Telegram и синхронизация</h2></div>
        <div style="display:flex;flex-direction:column;gap:10px">${tgBlock}${ctx.ui.telegramMsg ? `<span class="form-msg bad">${esc(ctx.ui.telegramMsg)}</span>` : ""}</div>
        <div class="two">
          <div class="kv"><span>Последняя сверка</span><span>${ctx.status?.lastSyncedAt ? esc(relativeDay(isoFromMs(ctx.status.lastSyncedAt), ctx.today) + ", " + new Date(ctx.status.lastSyncedAt).toTimeString().slice(0, 5)) : "—"}</span></div>
          <div class="kv"><span>В очереди на устройстве</span><span>${n} ${plural(n, "изменение", "изменения", "изменений")}</span></div>
        </div>
        <button type="button" class="btn small" style="align-self:flex-start" data-action="sync-now">${icons.sync()}Сверить сейчас</button>
      </section>

      <section class="card" aria-label="Планирование">
        <div class="card-head"><h2>Планирование</h2>${msg("planning")}</div>
        <div class="two">
          <label class="field"><span>Начало рабочего дня</span><input class="input" type="time" data-setting-input="workday_start" value="${esc(hhmm(s.workday_start))}"></label>
          <label class="field"><span>Конец рабочего дня</span><input class="input" type="time" data-setting-input="workday_end" value="${esc(hhmm(s.workday_end))}"></label>
        </div>
        <label class="field"><span>Буфер между делами</span><select class="select" data-setting-input="buffer_minutes">${[0, 5, 10, 15, 30].map((v) => `<option value="${v}" ${Number(s.buffer_minutes) === v ? "selected" : ""}>${v ? v + " мин" : "без буфера"}</option>`).join("")}</select></label>
        <div class="field"><span>Неделя начинается</span><div class="seg" role="radiogroup" aria-label="Первый день недели">
          ${[[1, "с понедельника"], [7, "с воскресенья"]].map(([v, l]) => `<button type="button" role="radio" aria-checked="${Number(s.week_start) === v}" data-action="set-week-start" data-value="${v}">${l}</button>`).join("")}</div></div>
        <div class="field"><span>Задача без названной даты</span><div class="seg" role="radiogroup" aria-label="Куда попадает задача без даты">
          ${[["inbox", "во «Входящие»"], ["today", "на сегодня"]].map(([v, l]) => `<button type="button" role="radio" aria-checked="${s.new_task_date === v}" data-action="set-new-task-date" data-value="${v}">${l}</button>`).join("")}</div></div>
        <span class="muted" style="font-size:13px">Рабочие часы и буфер используются в расчёте свободного времени календаря.</span>
      </section>

      <section class="card" aria-label="Помощник">
        <div class="card-head"><h2>Помощник</h2>${msg("assistant")}</div>
        ${s.assistant_consent_at ? `<div>
          <label class="switch-row"><span class="grow"><span>Краткие ответы</span><span class="muted" style="font-size:12px">вывод, основание, действие</span></span><input type="checkbox" class="switch" data-action="set-setting" data-setting="assistant_brief" ${s.assistant_brief !== false ? "checked" : ""}></label>
          <label class="switch-row"><span class="grow"><span>Всегда показывать черновик</span><span class="muted" style="font-size:12px">даже для одной понятной задачи</span></span><input type="checkbox" class="switch" data-action="set-setting" data-setting="assistant_confirm_all" ${s.assistant_confirm_all ? "checked" : ""}></label></div>
          <button type="button" class="btn small quiet" style="align-self:flex-start" data-action="assistant-revoke">Выключить помощника</button>`
        : `<span class="soft" style="font-size:14px">Выключен. Включается на экране «Помощник» — там же сказано, какие данные передаются.</span>`}
      </section>

      <section class="card" aria-label="Данные">
        <div class="card-head"><h2>Данные</h2></div>
        <span class="soft" style="font-size:14px">Все ваши разделы, группы и задачи. JSON — полная копия с версией схемы; CSV — список задач для таблиц.</span>
        <div class="chips"><button type="button" class="btn small" data-action="export-json">Скачать JSON</button><button type="button" class="btn small" data-action="export-csv">Скачать CSV</button>
          <a class="btn small quiet" href="#/tasks?view=trash">Корзина</a></div>
      </section>

      <section class="card" aria-label="Выход">
        <div class="card-head"><h2>Выход</h2></div>
        ${n ? `<span class="soft" style="font-size:14px">${n} ${plural(n, "изменение ещё не отправлено", "изменения ещё не отправлены", "изменений ещё не отправлены")}. Они останутся на этом устройстве и уйдут при следующем входе в этот аккаунт.</span>` : ""}
        <button type="button" class="btn danger" style="align-self:flex-start" data-action="logout">Выйти из аккаунта</button>
      </section>
    </div>`;
}

function isoFromMs(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ------------------------------------------------------------ вход, заставка --

export function renderSplash() {
  return `<div class="center-screen"><div class="brand" style="font-size:22px"><span class="brand-mark">M</span>MARK</div></div>`;
}

export function renderAuth(a) {
  return `<div class="center-screen"><section class="card auth-card" aria-label="${a.mode === "signup" ? "Регистрация" : "Вход"}">
    <div class="brand"><span class="brand-mark">M</span>MARK</div>
    <span class="muted" style="text-align:center;font-size:14px">Планировщик задач</span>
    <form data-action="auth-submit">
      <label class="field"><span>Email</span><input class="input" type="email" name="email" data-key="au-email" data-draft="auth.email" value="${esc(a.email || "")}" autocomplete="username" required></label>
      <label class="field"><span>Пароль</span><input class="input" type="password" name="password" data-key="au-pass" autocomplete="${a.mode === "signup" ? "new-password" : "current-password"}" minlength="6" required></label>
      ${a.error ? `<div class="form-msg bad" role="alert">${esc(a.error)}</div>` : ""}
      ${a.message ? `<div class="form-msg" role="status">${esc(a.message)}</div>` : ""}
      <button type="submit" class="btn primary" ${a.busy ? "disabled" : ""}>${a.busy ? "Подождите…" : a.mode === "signup" ? "Зарегистрироваться" : "Войти"}</button>
    </form>
    <button type="button" class="link-btn" data-action="auth-toggle">${a.mode === "signup" ? "Уже есть аккаунт? Войти" : "Нет аккаунта? Зарегистрироваться"}</button>
  </section></div>`;
}
