// Экраны интерфейса этапа 2 (макеты «Mark — макеты этапа 2»). Каждая
// функция — данные контекста → разметка; состояние и события живут в app.js.
//
// ctx: { rows, status, today, nowMin, route, ui, session, settings, telegram,
//        tz, isDesktop }

import { esc, plural, longDate, shortDate, relativeDay, hhmm, minutesOf, timeOf, durationText,
  weekHeader, monthTitle, addDays, parseIso, capitalize } from "./lib.js";
import { tasksOfDay, dayProgress, overdue, overdueKind, inbox, nextDays, upcoming, monthMarks,
  monthGrid, dayLoad, pathOf, hasTime, isOpen, dayOrder, isOverdue, missed, onDay } from "./derive.js";
import { greetingText } from "../assistant-chats.js";
import { icons, blob, markSymbol } from "./icons.js";

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
  if (ctx.route.name === "assistant") return `<div class="assistant-shell"><main id="main" class="assistant-main">${content}</main>
    ${ctx.ui.editor ? renderEditorSheet(ctx) : ""}${ctx.ui.confirm ? renderConfirm(ctx.ui.confirm) : ""}</div>`;

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
      <div class="brand">${markSymbol(20, { label: null })}Mark</div>
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
      <a class="nav-account" href="#/profile" aria-label="Профиль">
        <span class="avatar">${esc((firstName(ctx.session) || "?")[0])}</span>
        <span style="display:flex;flex-direction:column;gap:2px;min-width:0">
          <span style="font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis">${esc(firstName(ctx.session) || ctx.session?.user?.email || "")}</span>
          <span class="status ${syncLabel(ctx.status).cls}" style="padding:0"><span class="dot"></span>${esc(syncLabel(ctx.status).text)}</span>
        </span>
      </a>
    </nav>
    <main class="main" id="main">
      ${!["profile", "home", "tasks", "calendar"].includes(route) ? `<div class="mobile-account-bar"><a class="mobile-account" href="#/profile" aria-label="Профиль"><span class="avatar">${esc((firstName(ctx.session) || "?")[0])}</span><span>Профиль</span></a></div>` : ""}
      ${content}
    </main>
    <nav class="bottom-nav" aria-label="Основная навигация">
      ${NAV.slice(0, 2).map((n) => `<a href="${n.href}" ${route === n.id ? 'aria-current="page"' : ""}>${n.icon(22)}${n.label}</a>`).join("")}
      <button type="button" class="nav-add" data-action="new-task" aria-label="Добавить задачу"><span>${icons.plus(24)}</span></button>
      ${NAV.slice(2).map((n) => `<a href="${n.href}" ${route === n.id ? 'aria-current="page"' : ""}>${n.icon(22)}${n.label}</a>`).join("")}
    </nav>
    ${ctx.ui.editor && !(ctx.isDesktop && route === "tasks") ? renderEditorSheet(ctx) : ""}
    ${ctx.ui.manage ? renderManageSheet(ctx) : ""}
    ${ctx.ui.confirm ? renderConfirm(ctx.ui.confirm) : ""}
    ${ctx.ui.toast ? renderToast(ctx.ui.toast) : ""}
  </div>`;
}

// Сообщение об успехе внизу экрана, 5 секунд, с отменой, если она возможна.
function renderToast(t) {
  return `<div class="c-toast" role="status"><span class="grow">${esc(t.text)}</span>
    ${t.action ? `<button type="button" class="c-toast-act" data-action="toast-act">${esc(t.label)}</button>` : ""}</div>`;
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

// Подписи сроков по единому правилу (docs/design-c/rules.md): «Когда сделать» и
// будущий крайний срок — нейтрально; срок сегодня — жёлтая метка со словами;
// прошедший срок — красная «Просрочено». Цвет всегда дублируется словом.
function planPill(t, today, { dayView = false } = {}) {
  if (!t.planned_date) return "";
  const time = hhmm(t.planned_time);
  if (t.planned_date === today) return `<span class="meta-plan">${time || (dayView ? "без времени" : "сегодня")}</span>`;
  if (t.planned_date < today && !t.completed) return `<span>было на ${esc(shortDate(t.planned_date, { today }))}</span>`;
  return `<span class="meta-plan">${esc(shortDate(t.planned_date, { today }))}${time ? " · " + time : ""}</span>`;
}

function duePill(t, today, nowMin = null) {
  if (!t.due_date) return "";
  const time = hhmm(t.due_time);
  const date = shortDate(t.due_date, { today });
  if (isOverdue(t, today, nowMin)) return `<span class="badge bad">${icons.alert(13)}Просрочено</span><span>срок ${esc(t.due_date === today ? "сегодня" : date)}${time ? " " + time : ""}</span>`;
  if (!t.completed && t.due_date === today) return `<span class="badge warn">${icons.flag(13)}Срок сегодня</span><span>${time ? "до " + time : "до конца дня"}</span>`;
  return `<span>до ${esc(t.due_date === today ? "сегодня" : shortDate(t.due_date, { weekday: true, today }))}${time ? " " + time : ""}</span>`;
}

// Проект — название группы. Разделы в интерфейсе не показываются; если две
// группы называются одинаково, к названию добавляется раздел (projects-migration.md).
export function projectName(rows, groupId) {
  const g = rows.groups.find((x) => x.id === groupId);
  if (!g) return "";
  const twins = rows.groups.filter((x) => x.name.trim().toLowerCase() === g.name.trim().toLowerCase());
  if (twins.length < 2) return g.name;
  const s = rows.sections.find((x) => x.id === g.section_id);
  return s ? `${s.name} · ${g.name}` : g.name;
}

const STARTER_GROUPS = { work: "Работа", personal: "Личное", study: "Учёба" };

// Пустые стартовые группы, созданные приложением, не показываются. Пустота
// проверяется и по выполненным задачам, и по корзине; пока корзина не
// загружена, группа остаётся видимой.
export function visibleGroups(ctx) {
  const tr = ctx.trash;
  return ctx.rows.groups.filter((g) => {
    if (STARTER_GROUPS[g.id] !== g.name) return true;
    if (ctx.rows.tasks.some((t) => t.group_id === g.id)) return true;
    if (tr?.status !== "ok") return true;
    return tr.tasks.some((t) => t.group_id === g.id);
  });
}

export function taskRow(ctx, t, { showPath = true, when = null, selected = false, compactDay = false } = {}) {
  const today = ctx.today;
  const project = projectName(ctx.rows, t.group_id);
  const inInbox = !t.group_id && !t.planned_date && !t.due_date && !t.completed;
  const showPlan = !(when !== null && t.planned_date === today);
  return `<div class="task ${t.completed ? "done" : ""} ${selected ? "selected" : ""} ${compactDay ? "task-compact-day" : ""}">
    ${when !== null ? `<span class="when ${when.cls || ""}">${esc(when.text)}</span>` : ""}
    <button type="button" class="check ${t.completed ? "done" : ""}" data-action="toggle" data-id="${esc(t.id)}" aria-pressed="${t.completed ? "true" : "false"}" aria-label="${t.completed ? "Вернуть в работу" : "Отметить выполненной"}: ${esc(t.title)}">${t.completed ? icons.check() : ""}</button>
    <button type="button" class="task-body" data-action="open-task" data-id="${esc(t.id)}">
      <span class="task-title">${esc(t.title)}</span>
      <span class="task-meta">
        ${showPlan ? planPill(t, today, { dayView: compactDay }) : ""}
        ${t.duration_minutes ? `<span>${esc(durationText(t.duration_minutes))}</span>` : ""}
        ${duePill(t, today, ctx.nowMin)}
        ${showPath && project ? `<span>${esc(project)}</span>` : ""}
        ${showPath && inInbox ? `<span class="badge">${icons.inbox(13)}Входящие</span>` : ""}
        ${t.priority === "high" && !t.completed ? '<span class="badge">Важно</span>' : ""}
        ${t._pending ? '<span class="pill pending" title="Сохранено на устройстве, ещё не подтверждено сервером">ждёт синхронизации</span>' : ""}
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

// ------------------------------------------------- главная телефона, концепция C --
// Макеты H01–H15 (docs/design-c). Главная задача — первая из settings.focus на
// сегодня; в плане дня она не дублируется, но в счётчике учитывается один раз.

export function mainTaskOf(ctx) {
  const f = ctx.settings.focus;
  const id = f?.date === ctx.today ? (f.ids || [])[0] : null;
  return id ? ctx.rows.tasks.find((t) => t.id === id) || null : null;
}

function untilText(mins) {
  if (mins < 1) return "сейчас";
  const h = Math.floor(mins / 60), m = mins % 60;
  return "через " + (h ? `${h} ч` : "") + (h && m ? " " : "") + (m ? `${m} мин` : "");
}

function statusBanner(ctx) {
  const st = ctx.status?.state;
  if (!st || st === "synced" || st === "saving" || st === "idle" || st === "loading") return "";
  const s = syncLabel(ctx.status);
  const tone = st === "offline" ? "" : s.cls === "bad" ? "bad" : "warn";
  const sub = st === "offline" ? "Изменения сохранены на телефоне и отправятся, когда появится связь" : "";
  return `<div class="c-banner ${tone}" role="status"><span class="grow"><b>${esc(s.text)}</b>${sub ? `<span>${sub}</span>` : ""}</span>
    ${st === "offline" ? "" : `<button type="button" class="btn small quiet" data-action="sync-now">Повторить</button>`}</div>`;
}

function renderMainPick(ctx, main) {
  const { rows, today, nowMin } = ctx;
  // Главная задача выбирается из задач этого дня (решение владельца 30.10).
  const list = tasksOfDay(rows, today).filter(isOpen);
  const opts = list.map((t) => `<button type="button" class="c-option" role="radio" aria-checked="${main?.id === t.id}" data-action="main-set" data-id="${esc(t.id)}">
      <span class="c-radio" aria-hidden="true"></span><span class="grow"><span class="task-title">${esc(t.title)}</span>
      <span class="task-meta">${planPill(t, today, { dayView: true })}${duePill(t, today, nowMin)}${projectName(rows, t.group_id) ? `<span>${esc(projectName(rows, t.group_id))}</span>` : ""}</span></span></button>`).join("");
  return `<div class="sheet-scrim" data-action="main-pick-close"></div>
    <section class="sheet c-sheet" role="dialog" aria-modal="true" aria-label="Главная задача">
      <span class="handle"></span>
      <div class="sheet-header"><button type="button" class="btn quiet small" data-action="main-pick-close">Отмена</button><h2>Главная задача</h2><span aria-hidden="true"></span></div>
      <p class="c-note">Выберите одну из задач на сегодня. Она показывается первой и не повторяется в плане дня.</p>
      <div role="radiogroup" aria-label="Задачи на сегодня">${opts || '<div class="empty">На сегодня нет открытых задач.</div>'}</div>
      ${main ? `<button type="button" class="btn quiet" data-action="main-clear">Не выбирать главную задачу</button>` : ""}
    </section>`;
}

function renderHomePhone(ctx) {
  const { rows, today, nowMin } = ctx;
  const name = firstName(ctx.session);
  const main = mainTaskOf(ctx);
  const head = `<header class="c-head">${markSymbol(22)}
      <div class="c-head-text"><span class="c-date">${esc(longDate(today))}</span><h1>${esc(greeting(nowMin))}${name ? ", " + esc(name) : ""}</h1></div>
      <a class="c-avatar" href="#/profile" aria-label="Профиль">${esc((name || "?")[0])}</a></header>`;

  const mainHtml = main ? `<section class="c-main" aria-label="Главная задача">
      <div class="c-main-top"><span class="c-main-label">Главная задача</span><button type="button" class="c-link" data-action="main-pick">Сменить</button></div>
      <div class="c-main-row">
        <button type="button" class="check ${main.completed ? "done" : ""}" data-action="toggle" data-id="${esc(main.id)}" aria-pressed="${main.completed}" aria-label="${main.completed ? "Вернуть в работу" : "Отметить выполненной"}: ${esc(main.title)}">${main.completed ? icons.check() : ""}</button>
        <button type="button" class="task-body" data-action="open-task" data-id="${esc(main.id)}">
          <span class="c-main-title ${main.completed ? "done" : ""}">${esc(main.title)}</span>
          <span class="task-meta">${main.completed ? "<span>выполнено</span>" : duePill(main, today, nowMin) || planPill(main, today, { dayView: true })}${projectName(rows, main.group_id) ? `<span>${esc(projectName(rows, main.group_id))}</span>` : ""}</span>
        </button></div></section>`
    : `<section class="c-main empty-main" aria-label="Главная задача">
      <span class="grow"><b>Главная задача не выбрана</b><span>Выберите одну задачу, которую важно сделать сегодня</span></span>
      <button type="button" class="btn small" data-action="main-pick">Выбрать</button></section>`;

  const next = rows.tasks.filter((t) => isOpen(t) && t.planned_date === today && hasTime(t) && minutesOf(t.planned_time) >= nowMin && t.id !== main?.id)
    .sort(dayOrder)[0];
  const nextHtml = next ? `<button type="button" class="c-next" data-action="open-task" data-id="${esc(next.id)}">
      <span class="c-label">Ближайшее по времени</span>
      <span class="c-next-row"><span class="c-next-time">${hhmm(next.planned_time)}</span>
      <span class="grow"><span class="c-next-title">${esc(next.title)}</span><span class="task-meta"><span>${untilText(minutesOf(next.planned_time) - nowMin)}${next.duration_minutes ? " · до " + timeOf(minutesOf(next.planned_time) + next.duration_minutes) : ""}</span></span></span></span></button>` : "";

  const day = tasksOfDay(rows, today).filter((t) => t.id !== main?.id);
  const p = dayProgress(rows, today);
  const late = missed(rows, today, nowMin).filter((t) => t.id !== main?.id);
  const plan = `<section class="c-plan" aria-label="План дня">
      <div class="c-plan-head"><div><h2>План дня</h2><span class="c-label">${p.total ? `Выполнено ${p.done} из ${p.total}` : "Задач на сегодня нет"}</span></div>
        <a class="c-soft-btn" href="#/assistant">${icons.spark(16)}Обсудить план</a></div>
      ${day.length ? `<div class="task-list">${day.map((t) => taskRow(ctx, t, { compactDay: true })).join("")}</div>`
        : !main ? `<div class="empty">На сегодня задач нет. Можно добавить задачу или взять что-то из входящих.<button type="button" class="btn small" data-action="new-task" data-date="${today}">Добавить задачу</button></div>` : ""}
      ${late.length ? `<div class="c-sub"><span class="c-label">С прошлых дней · ${late.length}</span>
        <div class="task-list">${late.slice(0, 5).map((t) => taskRow(ctx, t, { compactDay: true })).join("")}</div>
        ${late.length > 5 ? `<a class="c-link" href="#/tasks?view=overdue">Все ${late.length}</a>` : ""}</div>` : ""}
    </section>`;

  const nIn = inbox(rows).length, nLate = overdue(rows, today, nowMin).length;
  const chips = nIn || nLate ? `<nav class="c-chips" aria-label="Другие задачи">
      ${nIn ? `<a class="c-chip" href="#/tasks?view=inbox">Входящие · ${nIn}</a>` : ""}
      ${nLate ? `<a class="c-chip bad" href="#/tasks?view=overdue">${icons.alert(14)}Просрочено · ${nLate}</a>` : ""}</nav>` : "";

  return `<div class="c-home">${head}${statusBanner(ctx)}${renderNotices(ctx)}${mainHtml}${nextHtml}${plan}${chips}</div>
    ${ctx.ui.mainPick ? renderMainPick(ctx, main) : ""}`;
}

export function renderHome(ctx) {
  if (!ctx.isDesktop) return renderHomePhone(ctx);
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

// ------------------------------------------- задачи и проекты телефона, концепция C --
// Макеты T01–T17 и P01–P10 (docs/design-c). Вид «Списком» или «По проектам»
// сохраняется на телефоне; фильтры — «Все», «Сегодня», «Входящие» и лист «Ещё».

function cSection(title, count, rows, { tone = "", more = "" } = {}) {
  if (!rows) return "";
  return `<section class="c-section" aria-label="${esc(title)}">
    <div class="c-section-head"><h2 class="${tone}">${esc(title)}</h2>${count !== "" ? `<span class="c-label">${count}</span>` : ""}</div>
    <div class="task-list">${rows}</div>${more}</section>`;
}

function rowsOf(ctx, list, key, opts = {}) {
  if (!list.length) return "";
  const pg = paged(ctx, key, list, opts.step || 50);
  return pg.shown.map((t) => taskRow(ctx, t, opts)).join("") + pg.more;
}

function iconBtn(action, label, icon, extra = "") {
  return `<button type="button" class="c-icon-btn" data-action="${action}" aria-label="${esc(label)}" ${extra}>${icon}</button>`;
}

function backBar(href, label, right = "") {
  return `<div class="c-back"><a href="${href}">${icons.left(20)}${esc(label)}</a><span class="grow"></span>${right}</div>`;
}

// Все открытые задачи по датам: просрочено, сегодня, завтра, позже, без даты.
function byDate(ctx) {
  const { rows, today, nowMin } = ctx;
  const tomorrow = addDays(today, 1);
  const open = rows.tasks.filter(isOpen);
  const firstDate = (t) => [t.planned_date, t.due_date].filter((d) => d && d >= today).sort()[0] || null;
  const late = overdue(rows, today, nowMin);
  const lateIds = new Set(late.map((t) => t.id));
  const missedList = missed(rows, today, nowMin);
  const missedIds = new Set(missedList.map((t) => t.id));
  const rest = open.filter((t) => !lateIds.has(t.id) && !missedIds.has(t.id));
  const day = (d) => rest.filter((t) => firstDate(t) === d).sort(dayOrder);
  const later = rest.filter((t) => firstDate(t) && firstDate(t) > tomorrow).sort((a, b) => firstDate(a).localeCompare(firstDate(b)) || dayOrder(a, b));
  const nodate = rest.filter((t) => !t.planned_date && !t.due_date);
  const doneToday = rows.tasks.filter((t) => t.completed && onDayOrDone(t, today)).length;
  return { late, missedList, today: day(today), tomorrow: day(tomorrow), later, nodate, doneToday, tomorrowIso: tomorrow };
}

function onDayOrDone(t, today) {
  return t.planned_date === today || t.due_date === today || String(t.completed_at || "").slice(0, 10) === today;
}

function listByDate(ctx) {
  const g = byDate(ctx);
  const done = g.doneToday ? `<a class="c-done-link" href="#/tasks?view=done">${icons.check(14)}Выполнено сегодня · ${g.doneToday}</a>` : "";
  const out = [
    cSection("Просрочено", g.late.length, rowsOf(ctx, g.late, "c-late"), { tone: "bad" }),
    cSection("Сегодня", g.today.length, rowsOf(ctx, g.today, "c-today", { compactDay: true }), { more: done }),
    cSection(`Завтра, ${shortDate(g.tomorrowIso, { today: ctx.today })}`, g.tomorrow.length, rowsOf(ctx, g.tomorrow, "c-tomorrow")),
    cSection("Позже", g.later.length, rowsOf(ctx, g.later, "c-later")),
    cSection("С прошлых дней", g.missedList.length, rowsOf(ctx, g.missedList, "c-missed")),
    cSection("Без даты", g.nodate.length, rowsOf(ctx, g.nodate, "c-nodate")),
  ].join("");
  return out || (!g.today.length && done ? done : "") || `<div class="empty">Открытых задач нет. Новая задача — кнопкой «+».</div>`;
}

function listByProject(ctx) {
  const { rows } = ctx;
  const open = rows.tasks.filter(isOpen);
  const groups = visibleGroups(ctx).map((g) => ({ g, name: projectName(rows, g.id), list: open.filter((t) => t.group_id === g.id).sort(dayOrder) }))
    .filter((x) => x.list.length).sort((a, b) => a.name.localeCompare(b.name, "ru"));
  const none = open.filter((t) => !t.group_id).sort(dayOrder);
  const block = (href, name, list) => `<section class="c-section" aria-label="${esc(name)}">
      <a class="c-project-head" href="${href}">${icons.folder(18)}<h2>${esc(name)}</h2><span class="c-label">${list.length}</span>${icons.right(16)}</a>
      <div class="task-list">${list.slice(0, 3).map((t) => taskRow(ctx, t, { showPath: false })).join("")}</div>
      ${list.length > 3 ? `<a class="c-link c-more" href="${href}">Ещё ${list.length - 3}</a>` : ""}</section>`;
  return groups.map((x) => block(`#/tasks?project=${encodeURIComponent(x.g.id)}`, x.name, x.list)).join("")
    + (none.length ? block("#/tasks?view=noproject", "Без проекта", none) : "")
    + `<a class="c-soft-btn c-all-projects" href="#/tasks?view=projects">${icons.folder(16)}Все проекты</a>`;
}

function renderFiltersSheet(ctx, c) {
  const row = (href, label, n, icon) => `<a class="c-li" href="${href}" data-action="tasks-filters-close">${icon}<span class="grow">${label}</span>${n !== "" ? `<span class="c-label">${n}</span>` : ""}${icons.right(16)}</a>`;
  return `<div class="sheet-scrim" data-action="tasks-filters-close"></div>
    <section class="sheet c-sheet" role="dialog" aria-modal="true" aria-label="Фильтры">
      <span class="handle"></span>
      <div class="sheet-header"><span></span><h2>Показать</h2><button type="button" class="btn quiet small" data-action="tasks-filters-close">Готово</button></div>
      <div class="c-group">
        ${row("#/tasks?view=week", "Ближайшие 7 дней", c.week, icons.cal(18))}
        ${row("#/tasks?view=nodate", "Без даты", c.nodate, icons.inbox(18))}
        ${row("#/tasks?view=overdue", "Просроченные", c.overdue, icons.alert(18))}
        ${row("#/tasks?view=done", "Выполненные", "", icons.check(18))}
        ${row("#/tasks?view=trash", "Корзина", ctx.trash?.status === "ok" ? ctx.trash.tasks.length : "", icons.trash(18))}
        ${row("#/tasks?view=projects", "Проекты", visibleGroups(ctx).length, icons.folder(18))}
      </div>
    </section>`;
}

function renderSearchPhone(ctx) {
  const q = (ctx.ui.search || "").trim();
  const found = q ? ctx.rows.tasks.filter((t) => matchesSearch(t, q)).sort((a, b) => Number(!!a.completed) - Number(!!b.completed) || dayOrder(a, b)) : [];
  const body = !q ? `<p class="c-note">Поиск по названиям и описаниям, включая выполненные.</p>`
    : found.length ? `<span class="c-label">Найдено ${found.length}</span><div class="task-list">${rowsOf(ctx, found, "c-search")}</div>`
    : `<div class="c-empty"><b>Ничего не нашлось</b><span>По запросу «${esc(q)}» задач нет. Поиск идёт по названиям и описаниям, включая выполненные.</span>
        <button type="button" class="btn small" data-action="new-task" data-title="${esc(q)}">Создать задачу «${esc(q)}»</button></div>`;
  return `<div class="c-page"><div class="c-search-bar">
      <label class="c-search-field">${icons.search(18)}<input type="search" data-key="search" data-draft="search" value="${esc(ctx.ui.search || "")}" aria-label="Поиск по задачам" placeholder="Поиск" autocomplete="off" autofocus enterkeyhint="search"></label>
      <button type="button" class="c-link c-cancel" data-action="search-close">Отмена</button></div>
    ${body}</div>`;
}

function renderProjectsPhone(ctx) {
  const { rows, today, nowMin } = ctx;
  const q = String(ctx.ui.projectQuery || "").trim().toLowerCase().replace(/ё/g, "е");
  const list = visibleGroups(ctx).map((g) => {
    const open = rows.tasks.filter((t) => isOpen(t) && t.group_id === g.id);
    return { g, name: projectName(rows, g.id), n: open.length, late: open.filter((t) => isOverdue(t, today, nowMin)).length };
  }).filter((x) => !q || x.name.toLowerCase().replace(/ё/g, "е").includes(q)).sort((a, b) => a.name.localeCompare(b.name, "ru"));
  const items = list.map((x) => `<a class="c-li" href="#/tasks?project=${encodeURIComponent(x.g.id)}">${icons.folder(18)}
      <span class="grow"><span>${esc(x.name)}</span><span class="c-label">${x.n ? `${x.n} ${plural(x.n, "задача", "задачи", "задач")}` : "нет задач"}${x.late ? ` · <span class="bad">${x.late} просрочено</span>` : ""}</span></span>${icons.right(16)}</a>`).join("");
  const empty = !visibleGroups(ctx).length;
  return `<div class="c-page">${backBar("#/tasks", "Задачи")}
    <header class="c-title"><div><h1>Проекты</h1>${empty ? "" : `<span class="c-label">${visibleGroups(ctx).length} ${plural(visibleGroups(ctx).length, "проект", "проекта", "проектов")}</span>`}</div></header>
    ${empty ? `<div class="c-empty"><b>Проектов пока нет</b><span>Проект помогает собрать задачи по одной теме: работа, дом, учёба. Можно обойтись и без проектов.</span>
        <button type="button" class="btn small" data-action="project-new">Создать проект</button></div>`
      : `<label class="c-search-field">${icons.search(18)}<input type="search" data-key="project-q" data-draft="projectQuery" value="${esc(ctx.ui.projectQuery || "")}" aria-label="Найти проект" placeholder="Найти проект" autocomplete="off"></label>
        ${items ? `<div class="c-group">${items}</div>` : `<p class="c-note">Проектов с таким названием нет.</p>`}
        <button type="button" class="c-soft-btn" data-action="project-new">${icons.plus(16)}Новый проект</button>
        <p class="c-note">Проект — необязательная группа задач. Задачи без проекта видны в общем списке.</p>`}
  </div>${renderProjectSheets(ctx)}`;
}

function renderProjectPhone(ctx, id) {
  const { rows, today, nowMin } = ctx;
  const g = rows.groups.find((x) => x.id === id);
  if (!g) return `<div class="c-page">${backBar("#/tasks?view=projects", "Проекты")}<div class="c-empty"><b>Проект не найден</b><span>Возможно, его удалили на другом устройстве.</span></div></div>`;
  const all = rows.tasks.filter((t) => t.group_id === id);
  const open = all.filter(isOpen);
  const late = open.filter((t) => isOverdue(t, today, nowMin));
  const lateIds = new Set(late.map((t) => t.id));
  const todayList = open.filter((t) => !lateIds.has(t.id) && (t.planned_date === today || t.due_date === today)).sort(dayOrder);
  const todayIds = new Set(todayList.map((t) => t.id));
  const later = open.filter((t) => !lateIds.has(t.id) && !todayIds.has(t.id) && (t.planned_date || t.due_date))
    .sort((a, b) => String(a.planned_date || a.due_date).localeCompare(String(b.planned_date || b.due_date)));
  const nodate = open.filter((t) => !t.planned_date && !t.due_date);
  const done = all.length - open.length;
  const opt = { showPath: false };
  return `<div class="c-page">${backBar("#/tasks?view=projects", "Проекты", iconBtn("project-menu", "Действия с проектом", icons.more(20)))}
    <header class="c-title"><div><h1>${esc(projectName(rows, id))}</h1><span class="c-label">${open.length} ${plural(open.length, "задача", "задачи", "задач")}${done ? ` · ${done} выполнено` : ""}</span></div></header>
    ${open.length ? [cSection("Просрочено", late.length, rowsOf(ctx, late, "p-late", opt), { tone: "bad" }),
      cSection("Сегодня", todayList.length, rowsOf(ctx, todayList, "p-today", { ...opt, compactDay: true })),
      cSection("Позже", later.length, rowsOf(ctx, later, "p-later", opt)),
      cSection("Без даты", nodate.length, rowsOf(ctx, nodate, "p-nodate", opt))].join("")
      : `<div class="c-empty"><b>В проекте нет открытых задач</b><span>Новая задача, добавленная отсюда, попадёт в этот проект.</span></div>`}
    <button type="button" class="c-soft-btn" data-action="new-task" data-group="${esc(id)}">${icons.plus(16)}Задача в этот проект</button>
  </div>
  ${ctx.ui.projectMenu ? `<div class="c-menu-scrim" data-action="project-menu"></div><div class="c-menu" role="menu">
      <button type="button" role="menuitem" data-action="project-rename" data-id="${esc(id)}">${icons.edit(18)}Переименовать</button>
      <button type="button" role="menuitem" class="bad" data-action="project-delete" data-id="${esc(id)}">${icons.trash(18)}Удалить проект</button></div>` : ""}
  ${renderProjectSheets(ctx)}`;
}

// Создание и переименование: обязательно только название, цвета нет (решение 5).
function renderProjectSheets(ctx) {
  const f = ctx.ui.projectForm;
  if (!f) return "";
  const title = f.id ? "Переименовать" : "Новый проект";
  return `<div class="sheet-scrim" data-action="project-form-close"></div>
    <form class="sheet c-sheet" role="dialog" aria-modal="true" aria-label="${title}" data-action="project-save">
      <span class="handle"></span>
      <div class="sheet-header"><button type="button" class="btn quiet small" data-action="project-form-close">Отмена</button><h2>${title}</h2>
        <button type="submit" class="btn quiet small c-sheet-ok" ${String(f.name || "").trim() ? "" : "disabled"}>${f.id ? "Сохранить" : "Создать"}</button></div>
      <label class="c-quick-label" for="project-name">Название проекта</label>
      <input id="project-name" class="c-title-field" name="name" data-key="project-name" data-draft="projectForm.name" value="${esc(f.name || "")}" maxlength="80" autocomplete="off" autofocus enterkeyhint="done">
      ${f.error ? `<span class="c-note bad" role="alert">${esc(f.error)}</span>` : `<span class="c-note">Обязательно только название.</span>`}
    </form>`;
}

function renderTasksPhone(ctx) {
  const params = ctx.route.params;
  if (params.project) return renderProjectPhone(ctx, params.project);
  if (params.view === "projects") return renderProjectsPhone(ctx);
  if (ctx.ui.searchOpen) return renderSearchPhone(ctx);
  const { rows, today, nowMin } = ctx;
  const view = params.view || "all";
  const mode = ctx.ui.tasksMode === "projects" ? "projects" : "list";
  const c = { ...counts(ctx), nodate: rows.tasks.filter((t) => isOpen(t) && !t.planned_date && !t.due_date).length };
  const openCount = rows.tasks.filter(isOpen).length;
  const filter = (id, label) => `<a class="c-filter" href="#/tasks${id === "all" ? "" : "?view=" + id}" aria-current="${view === id}">${label}</a>`;
  const head = `<header class="c-title"><div><h1>Задачи</h1><span class="c-label">${openCount} ${plural(openCount, "открытая", "открытые", "открытых")}</span></div>
      <div class="c-title-actions">${iconBtn("search-open", "Поиск", icons.search(20))}${iconBtn("tasks-mode-menu", "Вид списка", icons.layers(20), `aria-expanded="${!!ctx.ui.tasksMenu}"`)}</div></header>
    <nav class="c-filters" aria-label="Фильтр">${filter("all", "Все")}${filter("today", `Сегодня${c.today ? " · " + c.today : ""}`)}${filter("inbox", `Входящие${c.inbox ? " · " + c.inbox : ""}`)}
      ${iconBtn("tasks-filters", "Другие фильтры", icons.filter(18), `class="c-filter c-filter-icon${["week", "nodate", "overdue", "done", "trash", "noproject"].includes(view) ? " on" : ""}"`)}</nav>`;
  const titled = (title, sub, inner) => `<div class="c-view-head"><h2>${esc(title)}</h2>${sub ? `<p class="c-note">${sub}</p>` : ""}</div>${inner}`;
  let body;
  if (view === "today") {
    const late = overdue(rows, today, nowMin);
    const list = tasksOfDay(rows, today);
    const p = dayProgress(rows, today);
    body = cSection("Просрочено", late.length, rowsOf(ctx, late, "t-late"), { tone: "bad" })
      + (list.length ? cSection(`Сегодня · выполнено ${p.done} из ${p.total}`, "", rowsOf(ctx, list, "t-today", { compactDay: true })) : emptyDay(today));
  } else if (view === "inbox") {
    const list = inbox(rows);
    body = titled("Входящие", "Сюда попадает всё, что записано без даты и проекта. Дата или проект уберут задачу отсюда.",
      list.length ? `<div class="task-list">${rowsOf(ctx, list, "t-inbox", { showPath: false })}</div>` : `<div class="c-empty"><b>Входящие пусты</b><span>Всё записанное уже разобрано.</span></div>`);
  } else if (view === "week") {
    const list = nextDays(rows, today);
    const byDay = {};
    for (const t of list) { const d = [t.planned_date, t.due_date].filter((x) => x && x >= today).sort()[0]; (byDay[d] ||= []).push(t); }
    body = titled("Ближайшие 7 дней", "", Object.keys(byDay).sort().map((d) => cSection(relativeDay(d, today), byDay[d].length, rowsOf(ctx, byDay[d], "w:" + d))).join("") || `<div class="c-empty"><b>На неделю задач нет</b></div>`);
  } else if (view === "nodate") {
    const list = rows.tasks.filter((t) => isOpen(t) && !t.planned_date && !t.due_date);
    body = titled("Без даты", "", list.length ? `<div class="task-list">${rowsOf(ctx, list, "t-nodate")}</div>` : `<div class="c-empty"><b>Задач без даты нет</b></div>`);
  } else if (view === "noproject") {
    const list = rows.tasks.filter((t) => isOpen(t) && !t.group_id).sort(dayOrder);
    body = titled("Без проекта", "", list.length ? `<div class="task-list">${rowsOf(ctx, list, "t-noproject")}</div>` : `<div class="c-empty"><b>Все задачи в проектах</b></div>`);
  } else if (view === "overdue") {
    const late = overdue(rows, today, nowMin), miss = missed(rows, today, nowMin);
    const cleanup = ctx.ui.overdueCleanup;
    const act = (t) => `<div class="c-row-actions"><button type="button" class="cap" data-action="move-today" data-id="${esc(t.id)}">На сегодня</button><button type="button" class="cap" data-action="open-task" data-id="${esc(t.id)}">Перенести…</button></div>`;
    body = titled("Просроченные", "Крайний срок прошёл. Ничего не переносится автоматически.",
      (late.length ? `<div class="task-list">${late.map((t) => taskRow(ctx, t) + act(t)).join("")}</div>` : `<div class="c-empty"><b>Просроченных задач нет</b></div>`)
      + (late.length ? `<button type="button" class="c-soft-btn bad" data-action="clear-overdue" ${cleanup?.busy ? "disabled" : ""}>${icons.trash(16)}${cleanup?.busy ? "Убираем…" : "Убрать все в корзину"}</button>` : "")
      + (cleanup ? `<p class="c-note" role="status">${esc(cleanup.text)}</p>` : "")
      + cSection("Не сделано в запланированный день", miss.length, miss.map((t) => taskRow(ctx, t) + act(t)).join(""))
      + (miss.length ? `<p class="c-note">Это не просрочка: крайнего срока нет или он ещё впереди.</p>` : ""));
  } else if (view === "done") {
    const list = rows.tasks.filter((t) => t.completed).sort((a, b) => String(b.completed_at || "").localeCompare(String(a.completed_at || "")));
    body = titled("Выполненные", "Нажмите на отметку, чтобы вернуть задачу в работу.", list.length ? `<div class="task-list">${rowsOf(ctx, list, "t-done")}</div>` : `<div class="c-empty"><b>Выполненных задач пока нет</b></div>`);
  } else if (view === "trash") {
    body = titled("Корзина", "Удалённые задачи можно восстановить.", renderTrash(ctx, ""));
  } else {
    body = mode === "projects" ? listByProject(ctx) : listByDate(ctx);
  }
  const menu = ctx.ui.tasksMenu ? `<div class="c-menu-scrim" data-action="tasks-mode-menu"></div><div class="c-menu" role="menu">
      <button type="button" role="menuitemradio" aria-checked="${mode === "list"}" data-action="tasks-mode" data-mode="list">${icons.tasks(18)}Списком${mode === "list" ? icons.check(16) : ""}</button>
      <button type="button" role="menuitemradio" aria-checked="${mode === "projects"}" data-action="tasks-mode" data-mode="projects">${icons.folder(18)}По проектам${mode === "projects" ? icons.check(16) : ""}</button>
      <a role="menuitem" href="#/tasks?view=projects" data-action="tasks-mode-menu">${icons.folder(18)}Все проекты</a></div>` : "";
  const back = view !== "all" && !["today", "inbox"].includes(view) ? backBar("#/tasks", "Все задачи") : "";
  return `<div class="c-page">${back}${head}${renderNotices(ctx)}${body}</div>${menu}${ctx.ui.tasksFilters ? renderFiltersSheet(ctx, c) : ""}`;
}

export function renderTasks(ctx0) {
  if (!ctx0.isDesktop) return renderTasksPhone(ctx0);
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
        return card(list.length ? `<div class="task-list">${pg.shown.map((t) => taskRow(ctx, t, { compactDay: true, selected: t.id === selectedId })).join("")}</div>${pg.more}` : emptyDay(today), `Сегодня · ${longDate(today)}`); })();
  } else if (view === "inbox") {
    const list = inbox(rows);
    const pg = paged(ctx, "inbox", list);
    body = card(list.length ? `<div class="task-list">${pg.shown.map((t) => taskRow(ctx, t, { selected: t.id === selectedId })).join("")}</div>${pg.more}`
      : '<div class="empty">Входящие пусты: всё записанное уже разобрано.</div>', "Входящие", "Записано без даты и проекта. Дата или проект уберут задачу отсюда");
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
    const allLate = overdue(ctx0.rows, today, nowMin).length;
    const cleanup = ctx.ui.overdueCleanup;
    const pg = paged(ctx, "overdue", list);
    body = `${allLate ? `<div class="alert info overdue-cleanup"><div class="grow"><b>Убрать просроченные задачи</b><span class="muted">Все ${allLate} попадут в корзину — их можно восстановить.</span></div><button type="button" class="btn danger" data-action="clear-overdue" ${cleanup?.busy ? "disabled" : ""}>${cleanup?.busy ? "Убираем…" : "Убрать все"}</button></div>` : ""}
      ${cleanup ? `<div class="alert ${cleanup.failed ? "warn" : "info"}" role="status"><div class="grow">${esc(cleanup.text)}</div>${cleanup.busy ? "" : '<a class="btn small" href="#/tasks?view=trash">Корзина</a>'}</div>` : ""}` +
      card(list.length ? `<div class="task-list">${pg.shown.map((t) => `${taskRow(ctx, t, { selected: t.id === selectedId })}
      <div class="chips" style="padding:0 0 10px 36px"><button type="button" class="btn small" data-action="move-today" data-id="${esc(t.id)}">На сегодня</button>
      <button type="button" class="btn small quiet" data-action="open-task" data-id="${esc(t.id)}">Перенести…</button></div>`).join("")}</div>${pg.more}`
      : '<div class="empty">Просроченных задач нет.</div>', "Просроченные", "Крайний срок прошёл. Ничего не переносится автоматически") +
      (() => { const late = missed(rows, today, nowMin); const pgm = paged(ctx, "missed", late);
        return late.length ? card(`<div class="task-list">${pgm.shown.map((t) => `${taskRow(ctx, t, { selected: t.id === selectedId })}
      <div class="chips" style="padding:0 0 10px 36px"><button type="button" class="btn small" data-action="move-today" data-id="${esc(t.id)}">На сегодня</button>
      <button type="button" class="btn small quiet" data-action="open-task" data-id="${esc(t.id)}">Перенести…</button></div>`).join("")}</div>${pgm.more}`,
          "Не сделано в запланированный день", "Это не просрочка: крайнего срока нет или он ещё впереди") : ""; })();
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
  const cleanup = ctx.ui.trashCleanup;
  const until = (t) => {
    const d = new Date(t.deleted_at);
    d.setDate(d.getDate() + (tr.keep_days || 30));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  // «Очистить корзину» скрыта, пока на сервере не применена и не проверена
  // миграция 0014_mark_empty_trash (решение владельца, docs/design-c/scope.md).
  return `${cleanup ? `<div class="alert ${cleanup.failed ? "warn" : "info"}" role="status"><div class="grow">${esc(cleanup.text)}</div></div>` : ""}` +
    card(list.length ? `<div class="task-list">${list.map((t) => `<div class="task">
      <div class="task-body"><span class="task-title">${esc(t.title)}</span>
        <span class="task-meta"><span>${esc(pathOf(ctx.rows, t).label)}</span><span>удалится окончательно ${esc(shortDate(until(t), { today: ctx.today }))}</span></span></div>
      <button type="button" class="btn small" data-action="restore-task" data-id="${esc(t.id)}" ${cleanup?.busy ? "disabled" : ""}>Восстановить</button></div>`).join("")}</div>`
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

// Календарь телефона (UX06 ТЗ v1.1): неделя и выбранный день по умолчанию,
// месяц раскрывается нажатием на его название.
function renderCalendarPhone(ctx) {
  const sel = ctx.ui.selectedDate || ctx.today;
  const ws = ctx.settings.week_start || 1;
  const offset = (parseIso(sel).getDay() - (ws % 7) + 7) % 7;
  const start = addDays(sel, -offset);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const marks = monthMarks(ctx.rows, days[0], days[6]);
  const wd = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
  const [y, m] = sel.split("-").map(Number);
  const open = !!ctx.ui.calMonthOpen;
  const week = `<div class="c-week" role="group" aria-label="Неделя">${days.map((d) => {
    const n = marks[d]?.count || 0;
    return `<button type="button" class="c-wday${d === sel ? " sel" : ""}${d === ctx.today ? " today" : ""}" data-action="pick-date" data-date="${d}" aria-pressed="${d === sel}"
      aria-label="${esc(longDate(d))}${n ? ", " + n + " " + plural(n, "задача", "задачи", "задач") : ""}"><span class="wd">${wd[parseIso(d).getDay()]}</span><span class="n">${parseIso(d).getDate()}</span><i aria-hidden="true"${n ? "" : ' class="none"'}></i></button>`;
  }).join("")}</div>`;
  let month = "";
  if (open) {
    const [my, mm] = ctx.ui.calMonth.split("-").map(Number);
    const grid = monthGrid(my, mm - 1, ws);
    const mk = monthMarks(ctx.rows, grid[0].iso, grid[grid.length - 1].iso);
    month = `<section class="c-month" aria-label="Месяц">
      <div class="c-month-nav"><button type="button" class="c-icon-btn" data-action="cal-prev" aria-label="Предыдущий месяц">${icons.left(18)}</button>
        <b>${esc(monthTitle(my, mm - 1))}</b>
        <button type="button" class="c-icon-btn" data-action="cal-next" aria-label="Следующий месяц">${icons.right(18)}</button></div>
      <div class="cal-grid">${weekHeader(ws).map((w) => `<span class="cal-wd">${w}</span>`).join("")}${grid.map((c) => dayCell(ctx, c, mk[c.iso], sel, false)).join("")}</div>
    </section>`;
  }
  return `<div class="c-page">
    <header class="c-title"><div><h1>Календарь</h1>
        <button type="button" class="c-month-btn" data-action="cal-month-toggle" aria-expanded="${open}">${esc(monthTitle(y, m - 1))}${icons.right(14)}</button></div>
      <div class="c-title-actions">${sel !== ctx.today ? `<button type="button" class="c-link c-today-btn" data-action="cal-today">Сегодня</button>` : ""}
        ${iconBtn("cal-week-prev", "Предыдущая неделя", icons.left(20))}${iconBtn("cal-week-next", "Следующая неделя", icons.right(20))}</div></header>
    ${renderNotices(ctx)}
    ${month}
    ${week}
    ${renderDayPanel(ctx, sel)}
  </div>`;
}

export function renderCalendar(ctx) {
  if (!ctx.isDesktop) return renderCalendarPhone(ctx);
  const [y, m] = ctx.ui.calMonth.split("-").map(Number);
  const grid = monthGrid(y, m - 1, ctx.settings.week_start);
  const marks = monthMarks(ctx.rows, grid[0].iso, grid[grid.length - 1].iso);
  const sel = ctx.ui.selectedDate || ctx.today;
  const month = `<section class="card cal-big" aria-label="Месяц">
      <div class="cal-grid">${weekHeader(ctx.settings.week_start).map((w) => `<span class="cal-wd">${w}</span>`).join("")}${grid.map((c) => dayCell(ctx, c, marks[c.iso], sel, true)).join("")}</div>
      <span class="c-note">Точка — в этот день есть открытые задачи.</span>
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

// Выбранный день (ТЗ «упростить отображение задач в календаре»): «По времени» —
// незавершённые задачи с назначенным временем; «В течение дня» — без времени, в
// порядке пользователя; внизу свёрнутое «Выполнено». Без шкалы, расчёта
// свободного времени и подписей о неуказанной длительности.
function calRow(ctx, t, { timed = false } = {}) {
  const today = ctx.today;
  const project = projectName(ctx.rows, t.group_id);
  const start = timed ? minutesOf(t.planned_time) : null;
  const time = timed ? `<span class="c-time" aria-hidden="true"><b>${hhmm(t.planned_time)}</b>${t.duration_minutes ? `<small>${timeOf(start + t.duration_minutes)}</small>` : ""}</span>` : "";
  const meta = [
    duePill(t, today, ctx.nowMin),
    t.duration_minutes && !timed ? `<span>${esc(durationText(t.duration_minutes))}</span>` : "",
    project ? `<span>${esc(project)}</span>` : "",
    t.priority === "high" && !t.completed ? '<span class="badge">Важно</span>' : "",
  ].join("");
  const label = (timed ? hhmm(t.planned_time) + (t.duration_minutes ? "–" + timeOf(start + t.duration_minutes) : "") + ", " : "") + t.title;
  return `<div class="task c-cal-row ${t.completed ? "done" : ""}">${time}
    <button type="button" class="check ${t.completed ? "done" : ""}" data-action="toggle" data-id="${esc(t.id)}" aria-pressed="${t.completed ? "true" : "false"}" aria-label="${t.completed ? "Вернуть в работу" : "Отметить выполненной"}: ${esc(label)}">${t.completed ? icons.check() : ""}</button>
    <button type="button" class="task-body" data-action="open-task" data-id="${esc(t.id)}"><span class="task-title">${esc(t.title)}</span>${meta.trim() ? `<span class="task-meta">${meta}</span>` : ""}</button>
  </div>`;
}

function renderDayPanel(ctx, day) {
  const { rows } = ctx;
  const list = rows.tasks.filter((t) => onDay(t, day));
  const open = list.filter(isOpen);
  const done = list.filter((t) => t.completed);
  const timed = open.filter((t) => t.planned_date === day && t.planned_time)
    .sort((a, b) => hhmm(a.planned_time).localeCompare(hhmm(b.planned_time)) || (a.position ?? 0) - (b.position ?? 0));
  const timedIds = new Set(timed.map((t) => t.id));
  const allDay = open.filter((t) => !timedIds.has(t.id)).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const isToday = day === ctx.today;
  const sub = list.length ? [open.length ? `${open.length} ${plural(open.length, "задача осталась", "задачи осталось", "задач осталось")}` : "",
    done.length ? `${done.length} выполнено` : ""].filter(Boolean).join(" · ") : "";
  const section = (title, rowsHtml) => rowsHtml ? `<section class="c-section" aria-label="${title}"><div class="c-section-head"><h2>${title}</h2></div><div class="task-list">${rowsHtml}</div></section>` : "";
  const state = !list.length ? `<div class="c-empty"><b>На этот день пока нет задач</b></div>`
    : !open.length ? `<div class="c-empty"><b>${isToday ? "Все задачи на сегодня выполнены" : "Все задачи на этот день выполнены"}</b></div>` : "";
  return `<section class="c-day" aria-label="${esc(longDate(day))}">
    <div class="c-day-head"><h2>${esc(longDate(day))}</h2>${sub ? `<span class="c-label">${sub}</span>` : ""}</div>
    ${state}
    ${section("По времени", timed.map((t) => calRow(ctx, t, { timed: true })).join(""))}
    ${section("В течение дня", allDay.map((t) => calRow(ctx, t)).join(""))}
    ${done.length ? `<details class="c-done" data-detail="cal-done-${day}"><summary><span>Выполнено · ${done.length}</span>${icons.right(16)}</summary>
      <div class="task-list">${done.map((t) => calRow(ctx, t)).join("")}</div></details>` : ""}
    <button type="button" class="c-soft-btn c-day-add" data-action="new-task" data-date="${day}">${icons.plus(16)}Добавить задачу</button>
  </section>`;
}

// ----------------------------------------------------------------- помощник --

const DRAFT_FIELD = {
  title: "Название", notes: "Описание", planned_date: "Когда сделать", planned_time: "Время", due_date: "Выполнить до", due_time: "Время срока",
  duration_minutes: "Длительность", group_id: "Проект", priority: "Приоритет", completed: "Выполнено",
};

function draftValue(ctx, k, v) {
  if ((v === null || v === undefined || v === "") && k === "group_id") return "Без проекта";
  if (v === null || v === undefined || v === "") return "—";
  if (k.endsWith("_date")) return shortDate(v, { weekday: true, today: ctx.today });
  if (k.endsWith("_time")) return hhmm(v);
  if (k === "duration_minutes") return durationText(v);
  if (k === "group_id") return projectName(ctx.rows, v) || "—";
  if (k === "priority") return { low: "низкий", normal: "обычный", high: "высокий" }[v] || v;
  if (k === "completed") return v ? "да" : "нет";
  return String(v);
}

// Итог одного действия — по его операции (пакет A ТЗ v1.1).
const ACTION_LABEL = {
  queued: ["", "Ждёт отправки"], syncing: ["", "Отправляется"], applied: ["ok", "Применено"],
  conflict: ["warn", "Две версии"], failed: ["bad", "Не применено"], cancelled: ["", "Отменено"],
};

// Одно действие предложения (макеты A06–A12): глагол, задача, что было → что станет,
// метка итога. Галочка выбора — только пока предложение не отправлено.
function renderDraft(ctx, d, i, msgIndex, locked, result) {
  let verb, title, detail = "";
  if (d.type === "create") {
    const f = d.fields;
    verb = "Создать"; title = f.title;
    detail = [f.planned_date ? `${draftValue(ctx, "planned_date", f.planned_date)}${f.planned_time ? ", " + hhmm(f.planned_time) : ""}` : "без даты",
      f.due_date ? `до ${draftValue(ctx, "due_date", f.due_date)}${f.due_time ? " " + hhmm(f.due_time) : ""}` : "",
      f.duration_minutes ? durationText(f.duration_minutes) : "", f.group_id ? draftValue(ctx, "group_id", f.group_id) : ""].filter(Boolean).map(esc).join(" · ");
  } else if (d.type === "delete") {
    verb = "Удалить"; title = d.before?.title || ""; detail = "уйдёт в корзину";
  } else if (d.fields.completed === true && Object.keys(d.fields).length === 1) {
    verb = "Отметить выполненной"; title = d.before?.title || "";
  } else {
    verb = "Изменить"; title = d.before?.title || "";
    detail = Object.entries(d.fields).map(([k, v]) => `<span class="a-change">${esc(DRAFT_FIELD[k] || k)}: <s>${esc(draftValue(ctx, k, d.before?.[k]))}</s> → <b>${esc(draftValue(ctx, k, v))}</b></span>`).join("");
  }
  const [cls, label] = result ? ACTION_LABEL[result.status] || ["", result.status] : locked && d.skip ? ["", "не выбрано"] : ["", ""];
  const badge = label ? `<span class="badge ${cls === "ok" ? "ok" : cls}">${esc(label)}${result?.reason ? ": " + esc(result.reason) : ""}</span>` : "";
  return `<label class="a-action ${d.type === "delete" ? "danger" : ""}">
    ${locked ? "" : `<input type="checkbox" class="a-pick" data-action="draft-pick" data-msg="${msgIndex}" data-i="${i}" ${d.skip ? "" : "checked"} aria-label="Применить: ${esc(verb)} «${esc(title)}»">`}
    <span class="a-action-body"><span><span class="a-verb">${esc(verb)}</span> «${esc(title)}»</span>${detail ? `<span class="a-detail">${detail}</span>` : ""}${badge}</span></label>`;
}

// Итог предложения целиком: что сохранено на устройстве, что принял сервер,
// что требует решения. «Применено» — только когда сервер принял весь
// выбранный набор; частичный итог называется частичным.
function proposalSummary(st) {
  const n = st.total;
  switch (st.state) {
    case "applied": return ["ok", n > 1 ? `Применено: ${n} из ${n}` : "Применено"];
    case "syncing": return ["", "Сохранено на устройстве, отправляется…"];
    case "queued": return ["", "Сохранено на устройстве — отправится, когда появится связь"];
    case "conflict": return ["warn", `${st.applied ? `Применено ${st.applied} из ${n}. ` : ""}Задачу успели изменить в другом месте — решите конфликт вверху экрана`];
    case "failed": return ["bad", `${st.applied ? `Применено ${st.applied} из ${n}. ` : ""}Сервер не принял часть изменений — подробности у задач ниже`];
    case "partial": return ["", `Применено ${st.applied} из ${n}, остальное отменено`];
    default: return ["", "Отменено, ничего не изменено"];
  }
}

function renderChatMessage(ctx, m, idx) {
  if (m.role === "user") return `<div class="bubble user">${esc(m.content)}${m.memoryNotice ? `<small class="assistant-memory-notice">✓ ${esc(m.memoryNotice)}</small>` : ""}</div>`;
  const refs = (m.refs || []).map((id) => ctx.rows.tasks.find((t) => t.id === id)).filter(Boolean);
  const drafts = m.drafts || [];
  // итог берётся из записи предложения на устройстве, а не из текста чата;
  // «сохраняю» без записи и без идущего сохранения — прерванная попытка, её
  // можно повторить с теми же ID
  const st = m.proposal_id && ctx.proposalStatus ? ctx.proposalStatus(m.proposal_id) : null;
  const saving = m.state === "saving" && !st && ctx.applyingProposal?.(m.proposal_id);
  const pending = !st && (m.state === "pending" || (m.state === "saving" && !saving));
  const locked = !pending;
  const chosen = drafts.filter((d) => !d.skip).length;
  const results = new Map((st?.actions || []).map((a) => [a.action_id, a]));
  let footer = "", head = "", sub = "";
  const n = drafts.length;
  if (drafts.length) {
    head = n > 1 ? `Предлагаю ${n} ${plural(n, "изменение", "изменения", "изменений")}` : "Предлагаю изменение";
    if (pending) {
      sub = "Ничего не изменится, пока вы не нажмёте «Применить».";
      footer = `${m.applyError ? `<span class="a-note bad" role="alert">${esc(m.applyError)}</span>` : ""}<div class="a-buttons"><button type="button" class="btn primary" data-action="draft-apply" data-msg="${idx}" ${chosen ? "" : "disabled"}>${n > 1 ? `Применить ${chosen}` : "Применить"}</button>
        <button type="button" class="btn" data-action="draft-cancel" data-msg="${idx}">Отклонить</button></div>`;
    } else if (saving) {
      footer = `<div class="a-buttons"><button type="button" class="btn primary" disabled><span class="a-spin" aria-hidden="true"></span>Применяю…</button></div>
        <span class="a-note">Повторное нажатие ничего не задвоит.</span>`;
    } else if (st) {
      const [cls, text] = proposalSummary(st);
      head = `<span class="${cls}">${esc(text)}</span>`;
    } else if (m.state === "auto") {
      head = "Добавлено";
      footer = `<div class="a-buttons"><button type="button" class="btn" data-action="draft-undo" data-msg="${idx}">Отменить</button></div>`;
    } else if (m.state === "applied") {
      head = "Применено — изменения ушли в очередь"; // чаты до пакета A
    } else {
      head = "Отменено, ничего не изменено";
    }
  }
  const headHtml = head.startsWith("<span") ? head : esc(head);
  return `<div class="bubble bot">
    ${m.error ? `<span class="a-note bad">${esc(m.error)}</span>` : `${renderAssistantText(m)}`}
    ${refs.length ? `<details class="assistant-refs" data-detail="refs-${idx}"><summary>Связанные задачи · ${refs.length}</summary><div class="a-refs">${refs.map((t) => `<button type="button" class="cap" data-action="open-task" data-id="${esc(t.id)}">${esc(t.title.length > 40 ? t.title.slice(0, 39) + "…" : t.title)}</button>`).join("")}</div></details>` : ""}
    ${drafts.length ? `<section class="a-proposal" aria-label="Предложение помощника">
      <div class="a-proposal-head"><b>${headHtml}</b>${sub ? `<span>${sub}</span>` : ""}</div>
      <div class="a-actions">${drafts.map((d, i) => renderDraft(ctx, d, i, idx, locked, results.get(d.action_id))).join("")}</div>
      ${footer}</section>` : ""}
    ${m.rejected?.length ? `<span class="a-note">Не принято сервером: ${esc(m.rejected.join("; "))}</span>` : ""}
  </div>`;
}

const micIcon = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/></svg>`;

function renderAssistantText(m) {
  if (Array.isArray(m.sections) && m.sections.length) return `<div class="assistant-answer">${m.content ? `<p>${esc(m.content)}</p>` : ""}${m.sections.slice(0, 4).map((s) => `<section>${s.title ? `<h2>${esc(s.title)}</h2>` : ""}${Array.isArray(s.items) ? `<ul>${s.items.slice(0, 12).map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : ""}</section>`).join("")}</div>`;
  // Render a tiny, escaped subset of Markdown, including old saved replies.
  return `<div class="assistant-answer">${(String(m.content || "").length > 320 ? String(m.content || "").replace(/\s+(?=\d{1,2}[.)]\s)/g, "\n\n").replace(/([.!?])\s+([А-ЯA-Z«])/g, "$1\n\n$2") : String(m.content || "")).split(/\n\s*\n/).map((block) => {
    const lines = block.split("\n");
    if (lines.every((l) => /^\s*(?:[-*]|\d+[.)])\s+/.test(l))) return `<ul>${lines.map((l) => `<li>${esc(l.replace(/^\s*(?:[-*]|\d+[.)])\s+/, ""))}</li>`).join("")}</ul>`;
    return `<p>${esc(block).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br>")}</p>`;
  }).join("")}</div>`;
}

// Помощник в общей системе оформления (макеты A01–A15, DS02 и UX07 ТЗ v1.1):
// шапка «‹ Mark · Помощник», спокойный стартовый экран с работающими сценариями,
// поле «Что нужно организовать?». Логика предложений — пакет A, без изменений.
export function renderAssistant(ctx) {
  const a = ctx.ui.assistant || { chat: [], input: "", busy: false };
  const enabled = !!ctx.settings.assistant_consent_at;
  const voice = a.voice || { phase: "idle" };
  const recording = voice.phase !== "idle";
  const offline = ctx.status?.state === "offline";
  const name = firstName(ctx.session);
  const menu = `<details class="assistant-menu" data-detail="menu"><summary class="assistant-icon" aria-label="Меню чата">${icons.more(22)}</summary><div class="assistant-menu-panel">
    <button type="button" data-action="assistant-new">${icons.plus(18)}Новый чат</button>
    <button type="button" data-action="assistant-chats">${icons.tasks(18)}Мои чаты</button>
    <button type="button" data-action="assistant-memory">${icons.edit(18)}Память${a.book?.memory?.length ? " · " + a.book.memory.length : ""}</button>
    <a href="#/profile">${icons.cal(18)}Профиль и настройки</a>
    ${a.chat.length ? `<button type="button" data-action="assistant-clear">${icons.trash(18)}Очистить этот чат</button>` : ""}
    ${enabled ? `<button type="button" class="bad" data-action="assistant-revoke">Выключить помощника</button>` : ""}
    <small>Чаты и память хранятся на этом телефоне.</small></div></details>`;
  const starters = [["План на сегодня", "Покажи мои задачи на сегодня и предложи порядок выполнения"],
    ["Что сделать первым?", "Что мне сделать первым сегодня? Объясни почему"],
    ["Разобрать входящие", "Помоги разобрать входящие: что нужно уточнить?"]];
  const welcome = `<div class="assistant-welcome ${!a.greetingAnimated ? "assistant-welcome-enter" : ""}">
      ${markSymbol(34, { label: null })}
      <h1>${esc(greetingText(a.greetingIndex, name))}</h1>
      ${enabled ? `<p class="a-lead">Помогу разобраться с задачами и предложу изменения. Задачи меняются только после вашего подтверждения.</p>
        <div class="assistant-starters">${starters.map(([label, text]) => `<button type="button" class="cap" data-action="assistant-ask" data-text="${esc(text)}" ${offline || a.busy ? "disabled" : ""}>${label}</button>`).join("")}</div>`
      : `<div class="assistant-consent"><p>Чтобы отвечать по делу, помощник передаёт ваш вопрос, историю текущего чата, подходящие фрагменты прошлых сообщений, сохранённые заметки памяти и до 60 подходящих задач с описаниями на сервер Mark и провайдеру Groq.</p>
        <p>Любые изменения задач — только после вашего подтверждения.</p>
        <button type="button" class="btn primary" data-action="assistant-consent">Включить помощника</button>${ctx.ui.saved?.assistant?.cls === "bad" ? `<p class="bad" role="alert">${esc(ctx.ui.saved.assistant.text)}</p>` : ""}</div>`}
    </div>`;
  const hints = [a.storageError ? `<div class="c-banner bad" role="alert"><span class="grow"><b>${esc(a.storageError)}</b></span></div>` : "",
    offline ? `<div class="c-banner" role="status"><span class="grow"><b>Нет сети</b><span>Помощнику нужен интернет. Черновик останется здесь.</span></span></div>`
      : ctx.status?.unconfirmed ? `<div class="assistant-hint" role="status">Есть изменения, которые ещё не отправлены. Ответ может их не учитывать.</div>` : "",
    voice.error ? `<div class="c-banner bad" role="alert"><span class="grow"><b>${esc(voice.error)}</b></span></div>` : "",
    recording ? `<div class="assistant-recording" role="status"><span class="recording-dot"></span>${voice.phase === "starting" ? "Включаю микрофон…" : voice.phase === "finishing" ? "Завершаю распознавание…" : "Слушаю. Нажмите ■, когда закончите."}</div>` : ""].join("");
  return `<header class="assistant-header" ${a.panel ? 'inert aria-hidden="true"' : ""}>
      <a href="#/home" class="a-back" aria-label="Назад в Mark">${icons.left(22)}${markSymbol(16, { label: null })}<span>Mark</span></a>
      <span class="a-title">Помощник</span>${menu}</header>
    <div class="assistant-transcript" ${a.panel ? 'inert aria-hidden="true"' : ""} role="log" aria-label="Диалог с помощником" aria-live="polite">
      ${renderNotices(ctx)}
      ${a.chat.length && enabled ? `<div class="assistant-messages">${a.chat.map((m, i) => renderChatMessage(ctx, m, i)).join("")}${a.busy ? '<div class="assistant-thinking" role="status"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>Смотрю ваши задачи…</div>' : ""}</div>` : welcome}
    </div>
    ${enabled ? `<div class="assistant-bottom" ${a.panel ? 'inert aria-hidden="true"' : ""}>
      ${hints}
      <form class="assistant-composer" data-action="assistant-send"><textarea name="message" data-key="assistant" data-draft="assistantInput" rows="1" maxlength="2000" autocomplete="off" aria-label="Сообщение помощнику" placeholder="Что нужно организовать?" ${recording ? "readonly" : ""}>${esc(a.input)}</textarea>
        ${ctx.speechAvailable ? `<button type="button" class="assistant-icon a-round ${recording ? "is-recording" : ""}" data-action="assistant-voice" aria-label="${recording ? "Остановить диктовку" : "Надиктовать сообщение"}" ${a.busy || voice.phase === "finishing" ? "disabled" : ""}>${recording ? '<span class="recording-stop">■</span>' : micIcon}</button>` : ""}
        <button type="submit" class="assistant-send" aria-label="Отправить сообщение" ${a.busy || offline || recording || !a.input.trim() ? "disabled" : ""}>${icons.send(20)}</button>
      </form>${recording ? `<p class="assistant-footnote">Распознавание выполняет iPhone или сервис Apple. Текст вы отправляете сами.</p>` : ""}
    </div>` : ""}
    ${a.panel ? `<div class="assistant-panel" role="dialog" aria-modal="true" aria-label="${a.panel === "chats" ? "Мои чаты" : "Память помощника"}">
      <header><button type="button" class="a-back" data-action="assistant-close-panel" data-key="assistant-panel-close" autofocus>${icons.left(22)}Помощник</button><h2>${a.panel === "chats" ? "Мои чаты" : "Память"}</h2></header>
      ${a.panel === "chats" ? `<button type="button" class="c-soft-btn" data-action="assistant-new">${icons.plus(16)}Новый чат</button>
        <div class="c-group assistant-chat-list">${(a.book?.threads || []).map(t => `<button type="button" class="c-li" data-action="assistant-open-chat" data-id="${esc(t.id)}" ${t.id === a.threadId ? 'aria-current="true"' : ""}><span class="grow"><span>${esc(t.title)}</span><span class="c-label">${t.messages.length} ${plural(t.messages.length, "сообщение", "сообщения", "сообщений")}</span></span>${t.id === a.threadId ? icons.check(16) : icons.right(16)}</button>`).join("")}</div>
        <p class="c-note">Чаты и память хранятся на этом телефоне.</p>`
      : `<p class="c-note">Эти заметки помощник учитывает во всех чатах. Решения на сегодня действуют только в указанную дату. Сохраняйте предпочтения фразой «Запомни: …» или добавляйте здесь по одной заметке на строку.</p>
        <textarea class="c-title-field a-memory" data-key="assistant-memory" data-draft="assistantMemory" aria-label="Заметки памяти" rows="8" maxlength="8020">${esc(a.memoryDraft || "")}</textarea>
        ${a.memoryError || a.storageError ? `<p class="c-note bad" role="alert">${esc(a.memoryError || a.storageError)}</p>` : ""}
        <button type="button" class="btn primary" data-action="assistant-memory-save">Сохранить память</button>
        <p class="c-note">Память хранится на этом телефоне и передаётся помощнику вместе с вопросом.</p>`}
    </div>` : ""}`;
}

// ------------------------------------------------------------------ редактор --

// Проекты — группы одним списком, без разделов и цветов (решения владельца,
// docs/design-c/scope.md). Выбранная группа видна всегда, даже скрытая стартовая.
function groupOptions(ctx, selected) {
  const list = visibleGroups(ctx);
  const sel = ctx.rows.groups.find((g) => g.id === selected);
  if (sel && !list.includes(sel)) list.push(sel);
  const named = list.map((g) => ({ id: g.id, name: projectName(ctx.rows, g.id) }))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  return [`<option value="" ${!selected ? "selected" : ""}>Без проекта</option>`]
    .concat(named.map((g) => `<option value="${esc(g.id)}" ${g.id === selected ? "selected" : ""}>${esc(g.name)}</option>`)).join("");
}

function editorFields(ctx) {
  const ed = ctx.ui.editor;
  const d = ed.draft;
  const task = ed.id ? ctx.rows.tasks.find((t) => t.id === ed.id) : null;
  const dur = [["", "не указана"], ["15", "15 мин"], ["30", "30 мин"], ["45", "45 мин"], ["60", "1 ч"], ["90", "1 ч 30 мин"], ["120", "2 ч"], ["180", "3 ч"], ["240", "4 ч"]];
  if (d.duration_minutes && !dur.some(([v]) => v === String(d.duration_minutes))) dur.push([String(d.duration_minutes), durationText(d.duration_minutes)]);
  return `
    ${task ? `<div class="row" style="justify-content:space-between;font-size:12px"><span class="muted">${esc(projectName(ctx.rows, task.group_id) || "Без проекта")}</span>${task._pending ? '<span class="muted" title="Сохранено на устройстве, ещё не подтверждено сервером">Ждёт синхронизации</span>' : '<span style="color:var(--accent)">Сохранено</span>'}</div>` : ""}
    <label class="field"><span>Название</span>
      <input class="input" name="title" data-key="ed-title" data-draft="editor.title" value="${esc(d.title)}" required maxlength="200" autocomplete="off" ${ed.id ? "" : "autofocus"}></label>
    <label class="field"><span>Описание</span>
      <textarea class="textarea" name="notes" data-key="ed-notes" data-draft="editor.notes" maxlength="5000" rows="3">${esc(d.notes)}</textarea></label>
    <label class="field"><span>Проект</span><select class="select" name="group_id" data-draft="editor.group_id">${groupOptions(ctx, d.group_id)}</select></label>
    <div class="two editor-schedule">
      <div class="date-box plan"><span class="t">Когда сделать</span>
        <div class="date-fields">
          <label class="field"><span>Дата</span><input class="input" type="date" name="planned_date" data-key="ed-pd" data-draft="editor.planned_date" value="${esc(d.planned_date || "")}" aria-label="Дата, на которую запланировано"></label>
          <label class="field"><span>Время</span><input class="input" type="time" name="planned_time" data-key="ed-pt" data-draft="editor.planned_time" value="${esc(hhmm(d.planned_time))}" aria-label="Время, на которое запланировано"></label>
        </div></div>
      <div class="date-box due"><span class="t">Выполнить до</span>
        <div class="date-fields">
          <label class="field"><span>Дата</span><input class="input" type="date" name="due_date" data-key="ed-dd" data-draft="editor.due_date" value="${esc(d.due_date || "")}" aria-label="Крайний срок"></label>
          <label class="field"><span>Время</span><input class="input" type="time" name="due_time" data-key="ed-dt" data-draft="editor.due_time" value="${esc(hhmm(d.due_time))}" aria-label="Время крайнего срока"></label>
        </div></div>
    </div>
    <span class="muted" style="font-size:13px">Перенос «Когда сделать» не меняет крайний срок. Без даты и проекта задача попадёт во «Входящие».</span>
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
  return `<form class="card task-editor" data-action="save-task" aria-label="${ed.id ? "Задача" : "Новая задача"}">
    <div class="card-head"><h2>${ed.id ? "Задача" : "Новая задача"}</h2>
      <button type="button" class="icon-btn small" data-action="close-editor" aria-label="Закрыть">${icons.close(16)}</button></div>
    ${editorFields(ctx)}</form>`;
}

// Короткая форма новой задачи (макеты C01–C15): обязательно только название,
// поле растёт по тексту, «Ещё» открывает подробную форму с тем же вводом.
// Черновик живёт на устройстве; восстановленный проект показан плашкой.
function renderQuickSheet(ctx) {
  const ed = ctx.ui.editor, d = ed.draft, today = ctx.today, tomorrow = addDays(today, 1);
  const pd = d.planned_date;
  const dateLabel = !pd ? "Без даты" : pd === today ? "Сегодня" : pd === tomorrow ? "Завтра" : shortDate(pd, { weekday: true, today });
  const project = d.group_id ? projectName(ctx.rows, d.group_id) : "";
  const hint = project ? `Задача попадёт в проект «${esc(project)}».`
    : pd === today ? "Задача появится в плане на сегодня."
    : pd ? `Задача появится в плане на ${esc(pd === tomorrow ? "завтра, " + shortDate(pd, { today }) : shortDate(pd, { weekday: true, today }))}.`
    : "Задача попадёт во «Входящие».";
  const cap = (action, label, on, extra = "") => `<button type="button" class="cap${on ? " sel" : ""}" data-action="${action}" aria-pressed="${on}" ${extra}>${label}</button>`;
  const dates = ed.datePick ? `<div class="c-caps" role="group" aria-label="Дата">
      ${cap("quick-date", "Сегодня", pd === today, `data-date="${today}"`)}${cap("quick-date", "Завтра", pd === tomorrow, `data-date="${tomorrow}"`)}
      ${pd ? cap("quick-date", "Без даты", false, 'data-date=""') : ""}${cap("editor-more", "Другая дата…", false)}</div>` : "";
  return `<div class="sheet-scrim" data-action="close-editor"></div>
    <form class="sheet task-editor c-quick" role="dialog" aria-modal="true" aria-label="Новая задача" data-action="save-task">
      <span class="handle"></span>
      ${ed.error ? `<div class="c-banner bad" role="alert"><span class="grow"><b>Задача не сохранилась</b><span>${esc(ed.error)}</span></span></div>` : ""}
      <div class="c-quick-label"><label for="quick-title">Новая задача</label>
        ${ed.restored ? `<button type="button" class="c-link" data-action="draft-delete">Удалить черновик</button>` : ""}</div>
      <textarea id="quick-title" class="c-title-field" name="title" data-key="ed-title" data-draft="editor.title" rows="1" maxlength="200" placeholder="Что нужно сделать?" autofocus enterkeyhint="done">${esc(d.title)}</textarea>
      ${project ? `<div class="c-caps"><button type="button" class="cap sel" data-action="quick-project-clear" aria-label="Убрать проект ${esc(project)}">${icons.folder(16)}${esc(project)}<span class="cap-x" aria-hidden="true">${icons.close(14)}</span></button></div>` : ""}
      <div class="c-caps">
        ${cap("quick-date-pick", `${icons.cal(16)}${esc(dateLabel)}`, !!pd)}
        ${cap("editor-more", `${icons.more(16)}Ещё`, false)}
      </div>
      ${dates}
      <span class="c-note">${hint}</span>
      <button type="submit" class="btn primary c-add" ${String(d.title || "").trim() ? "" : "disabled"}>Добавить</button>
    </form>`;
}

function renderEditorSheet(ctx) {
  const ed = ctx.ui.editor;
  if (!ed.id && ed.mode === "quick") return renderQuickSheet(ctx);
  return `<div class="sheet-scrim" data-action="close-editor"></div>
    <form class="sheet task-editor" role="dialog" aria-modal="true" aria-label="${ed.id ? "Задача" : "Новая задача"}" data-action="save-task">
      <span class="handle"></span>
      <div class="sheet-header"><button type="button" class="btn quiet small" data-action="close-editor">Отмена</button>
        <h2>${ed.id ? "Задача" : "Новая задача"}</h2><span aria-hidden="true"></span></div>
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

export function renderIphoneReminders(s) {
  if (!s?.available) return "";
  const permitted = s.permission === "granted";
  const text = s.permission === "denied" ? "Разрешите уведомления: Настройки iPhone → Уведомления → Mark."
    : s.enabled && permitted ? `Включены · за 30 минут. Запланировано: ${s.pending}.`
      : "Включите напоминания о задачах на этом iPhone.";
  return `<section class="card" aria-label="Уведомления на iPhone">
    <div class="card-head"><h2>Уведомления на iPhone</h2></div>
    <span class="soft" role="status">${esc(text)}</span>
    <span class="muted" style="font-size:13px">До планового времени задачи, а если его нет — до дедлайна со временем. Задачи без времени не присылают уведомлений.</span>
    <div class="row" style="flex-wrap:wrap;gap:10px">
      <button type="button" class="btn ${s.enabled && permitted ? "quiet" : "primary"}" data-action="${s.enabled && permitted ? "disable" : "enable"}-iphone-reminders" ${s.busy ? "disabled" : ""}>${s.busy ? "Подождите…" : s.enabled && permitted ? "Выключить" : "Включить уведомления"}</button>
      ${s.enabled && permitted ? `<button type="button" class="btn" data-action="test-iphone-reminders" ${s.busy ? "disabled" : ""}>Проверить уведомление</button>` : ""}
    </div>
    ${s.total > s.pending && !s.error ? '<span class="muted" style="font-size:13px">Запланированы ближайшие напоминания. Остальные добавятся при следующем открытии Mark.</span>' : ""}
    ${s.message ? `<span class="form-msg" role="status">${esc(s.message)}</span>` : ""}
    ${s.error ? `<span class="form-msg bad" role="alert">${esc(s.error)}</span><button type="button" class="btn small" data-action="retry-iphone-reminders">Повторить</button>` : ""}
    <span class="muted" style="font-size:13px">Изменения с другого устройства учитываются после синхронизации Mark на этом iPhone. Если до задачи осталось меньше 30 минут, новое напоминание уже не ставится.</span>
  </section>`;
}

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

  return `<header class="page-head"><div class="row" style="gap:8px">${ctx.ui.profileFrom ? `<a class="icon-btn" href="${esc(ctx.ui.profileFrom)}" aria-label="Назад">${icons.left(20)}</a>` : ""}<h1>Профиль</h1></div>${statusButton(ctx.status)}</header>
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

      ${renderIphoneReminders(ctx.iphoneReminders)}
      ${ctx.iphoneWidget ? `<section class="card" aria-label="Виджет на iPhone">
        <div class="card-head"><h2>Виджет на iPhone</h2></div>
        <p class="muted">Зажми свободное место на главном экране iPhone → «Изменить» → «Добавить виджет» → Mark. «Сегодня в Mark» — маленький и средний. «План на день» — большой список задач.</p>
        <p class="muted">Для экрана блокировки: зажми экран → «Настроить» → «Экран блокировки» → область виджетов под часами → Mark → «План на день». Карточка показывает до трёх задач; нажатие открывает весь список.</p>
        <p class="muted">Виджет «Сегодня» показывает задачи и открывает их по нажатию. После изменений открой Mark — iOS обновит виджет.</p>
        ${ctx.iphoneWidget.error ? `<p class="error">${esc(ctx.iphoneWidget.error)}</p>` : ""}
      </section>` : ""}

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
          <p class="muted" style="font-size:13px">Все изменения задач требуют подтверждения в чате.</p></div>
          <button type="button" class="btn small quiet" style="align-self:flex-start" data-action="assistant-revoke">Выключить помощника</button>`
        : `<span class="soft" style="font-size:14px">Выключен. Включается на экране «Помощник» — там же сказано, какие данные передаются.</span>`}
      </section>

      <section class="card" aria-label="Данные">
        <div class="card-head"><h2>Данные</h2></div>
        <span class="soft" style="font-size:14px">Все ваши разделы, группы и задачи. JSON — полная копия с версией схемы; CSV — список задач для таблиц.</span>
        <div class="chips"><button type="button" class="btn small" data-action="export-json" ${ctx.ui.profile.exportBusy ? "disabled" : ""}>Экспорт JSON</button><button type="button" class="btn small" data-action="export-csv" ${ctx.ui.profile.exportBusy ? "disabled" : ""}>Экспорт CSV</button>
          <a class="btn small quiet" href="#/tasks?view=trash">Корзина</a></div>
        ${ctx.ui.saved.export?.text ? `<div class="form-msg ${ctx.ui.saved.export.cls}" role="status">${esc(ctx.ui.saved.export.text)}</div>` : ""}
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
  // Совпадает с экраном загрузки iOS (LaunchScreen): переход незаметен.
  return `<div class="c-splash" role="img" aria-label="Mark">${markSymbol(84, { color: "#FFFFFF", label: null })}</div>`;
}

export function renderAuth(a) {
  const recovery = a.mode === "recover";
  return `<div class="center-screen"><section class="card auth-card" aria-label="${recovery ? "Восстановление пароля" : a.mode === "signup" ? "Регистрация" : "Вход"}">
    <div class="c-auth-brand"><img src="icons/icon-180.png?v=7" alt="" width="72" height="72"><span>Mark</span></div>
    <span class="muted" style="text-align:center;font-size:15px">${recovery ? "Восстановление пароля" : a.mode === "signup" ? "Регистрация" : "Вход"}</span>
    <form data-action="auth-submit">
      <label class="field"><span>Email</span><input class="input" type="email" name="email" data-key="au-email" data-draft="auth.email" value="${esc(a.email || "")}" autocomplete="username" required></label>
      ${recovery ? "" : `<label class="field"><span>Пароль</span><input class="input" type="password" name="password" data-key="au-pass" autocomplete="${a.mode === "signup" ? "new-password" : "current-password"}" minlength="6" required></label>`}
      ${a.error ? `<div class="form-msg bad" role="alert">${esc(a.error)}</div>` : ""}
      ${a.message ? `<div class="form-msg" role="status">${esc(a.message)}</div>` : ""}
      <button type="submit" class="btn primary" ${a.busy ? "disabled" : ""}>${a.busy ? "Подождите…" : recovery ? "Отправить письмо" : a.mode === "signup" ? "Зарегистрироваться" : "Войти"}</button>
    </form>
    ${a.mode === "signin" ? `<button type="button" class="link-btn" data-action="auth-recover" ${a.busy ? "disabled" : ""}>Забыли пароль?</button>` : ""}
    <button type="button" class="link-btn" data-action="auth-toggle" ${a.busy ? "disabled" : ""}>${recovery ? "Вернуться ко входу" : a.mode === "signup" ? "Уже есть аккаунт? Войти" : "Нет аккаунта? Зарегистрироваться"}</button>
  </section></div>`;
}
