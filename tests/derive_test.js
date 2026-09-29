// deno test tests/derive_test.js — правила подсчёта из ТЗ для интерфейса.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { dayLoad, dayOrder, dayProgress, inbox, monthGrid, monthMarks, overdue, tasksOfDay, upcoming } from "../js/ui/derive.js";
import { longDate, plural, relativeDay, shortDate } from "../js/ui/lib.js";

const T = (id, o = {}) => ({ id, title: id, group_id: "g1", planned_date: null, planned_time: null, due_date: null, due_time: null, duration_minutes: null, completed: false, position: 0, ...o });
const rows = (tasks) => ({
  sections: [{ id: "s1", name: "KINOMARK", color: "#7FA7D9" }, { id: "s2", name: "MARK", color: "#6ED6A0" }],
  groups: [{ id: "g1", section_id: "s1", name: "Продажи" }, { id: "g2", section_id: "s2", name: "Продукт" }],
  tasks,
});

Deno.test("A33: план и дедлайн в один день — одна задача в прогрессе и календаре", () => {
  const r = rows([T("a", { planned_date: "2026-09-29", due_date: "2026-09-29" }), T("b", { planned_date: "2026-09-29", completed: true })]);
  assertEquals(dayProgress(r, "2026-09-29"), { done: 1, total: 2 });
  assertEquals(monthMarks(r, "2026-09-01", "2026-09-30")["2026-09-29"].count, 1);
  assertEquals(tasksOfDay(r, "2026-09-29").length, 2);
});

Deno.test("A34: 10:00–11:00 и 10:30–11:30 занимают 90 минут; без длительности — не интервал", () => {
  const r = rows([
    T("a", { planned_date: "2026-09-29", planned_time: "10:00:00", duration_minutes: 60 }),
    T("b", { planned_date: "2026-09-29", planned_time: "10:30", duration_minutes: 60 }),
    T("c", { planned_date: "2026-09-29", planned_time: "15:00" }),
    T("d", { planned_date: "2026-09-29" }),
    T("e", { due_date: "2026-09-29", due_time: "12:00" }),
  ]);
  const load = dayLoad(r, "2026-09-29", { start: "10:00", end: "19:00" });
  assertEquals(load.busy, 90);
  assertEquals(load.unknown, 2);
  assertEquals(load.free, [{ start: 690, end: 1140 }]); // 11:30–19:00: дедлайн не блокирует
});

Deno.test("буфер между делами сужает свободные окна, но не занятость", () => {
  const r = rows([T("a", { planned_date: "2026-09-29", planned_time: "12:00", duration_minutes: 60 })]);
  const load = dayLoad(r, "2026-09-29", { start: "10:00", end: "19:00", buffer: 15 });
  assertEquals(load.busy, 60);
  assertEquals(load.free, [{ start: 600, end: 705 }, { start: 795, end: 1140 }]);
});

Deno.test("порядок дня: события по времени, дела без времени, дедлайны, выполненное в конце", () => {
  const list = [
    T("done", { planned_date: "d", completed: true }),
    T("due", { due_date: "d", due_time: "18:00" }),
    T("plain", { planned_date: "d" }),
    T("t15", { planned_date: "d", planned_time: "15:00" }),
    T("t09", { planned_date: "d", planned_time: "09:30" }),
  ].sort(dayOrder);
  assertEquals(list.map((t) => t.id), ["t09", "t15", "plain", "due", "done"]);
});

Deno.test("просроченное: прошедший дедлайн и прошедший план без дедлайна; не переносится", () => {
  const r = rows([
    T("late", { due_date: "2026-09-25" }),
    T("missed", { planned_date: "2026-09-28" }),
    T("planWithFutureDue", { planned_date: "2026-09-28", due_date: "2026-10-02" }),
    T("todayPast", { due_date: "2026-09-29", due_time: "09:00" }),
    T("todayLater", { due_date: "2026-09-29", due_time: "18:00" }),
    T("done", { due_date: "2026-09-20", completed: true }),
  ]);
  assertEquals(overdue(r, "2026-09-29", 10 * 60).map((t) => t.id), ["late", "missed", "todayPast"]);
});

Deno.test("входящие: без даты или без группы", () => {
  const r = rows([T("nodate"), T("nogroup", { group_id: null, planned_date: "2026-09-29" }), T("ok", { planned_date: "2026-09-29" })]);
  assertEquals(inbox(r).map((t) => t.id), ["nodate", "nogroup"]);
});

Deno.test("ближайшие дела: только будущие события со временем; дедлайны отдельно", () => {
  const r = rows([
    T("past", { planned_date: "2026-09-29", planned_time: "08:00" }),
    T("soon", { planned_date: "2026-09-29", planned_time: "15:00" }),
    T("tomorrow", { planned_date: "2026-09-30", planned_time: "11:00" }),
    T("far", { planned_date: "2026-10-14", planned_time: "17:00" }),
    T("notime", { planned_date: "2026-09-30" }),
    T("due", { due_date: "2026-10-01" }),
  ]);
  const u = upcoming(r, "2026-09-29", 10 * 60);
  assertEquals(u.events.map((t) => t.id), ["soon", "tomorrow"]);
  assertEquals(u.deadlines.map((t) => t.id), ["due"]);
});

Deno.test("сетка сентября 2026 — с понедельника 31 августа, пять недель", () => {
  const g = monthGrid(2026, 8);
  assertEquals(g.length, 35);
  assertEquals(g[0], { iso: "2026-08-31", day: 31, inMonth: false });
  assertEquals(g[1].iso, "2026-09-01");
  assert(g.filter((c) => c.inMonth).length === 30);
});

Deno.test("точки календаря: до трёх разделов и признак переполнения", () => {
  const r = rows([T("a", { planned_date: "2026-09-29" }), T("b", { group_id: "g2", due_date: "2026-09-29" }), T("c", { group_id: null, planned_date: "2026-09-29" })]);
  const m = monthMarks(r, "2026-09-01", "2026-09-30")["2026-09-29"];
  assertEquals(m.count, 3);
  assertEquals(m.colors.length, 3);
  assertEquals(m.overflow, 0);
});

Deno.test("даты по-русски", () => {
  assertEquals(longDate("2026-09-29"), "Вторник, 29 сентября");
  assertEquals(relativeDay("2026-09-30", "2026-09-29"), "Завтра");
  assertEquals(relativeDay("2026-10-02", "2026-09-29"), "Пт, 2 окт");
  assertEquals(shortDate("2027-01-05", { today: "2026-09-29" }), "5 янв 2027");
  assertEquals([1, 2, 5, 11, 21, 22].map((n) => plural(n, "дело", "дела", "дел")), ["дело", "дела", "дел", "дел", "дело", "дела"]);
});
