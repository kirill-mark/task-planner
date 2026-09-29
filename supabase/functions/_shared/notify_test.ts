// deno test supabase/functions/_shared/notify_test.ts — раздел 10, A29, A31, A35.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { digestDue, digestMinute, eveningDigest, inQuiet, morningDigest, reminderDecision, type NSettings, type NTask } from "./notify.ts";
import { zonedToUtc } from "./time.ts";

const S = (quiet = false): NSettings => ({ morning: "09:00", evening: "21:00", lead: 30, quiet: { enabled: quiet, start: "23:00", end: "08:00" } });
const T = (o: Partial<NTask>): NTask => ({ id: "t", title: "Задача", planned_date: null, planned_time: null, due_date: null, due_time: null, completed: false, ...o });
const at = (date: string, time: string) => zonedToUtc(date, time, "Europe/Moscow").getTime();
const min = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

Deno.test("тихие часы через полночь", () => {
  const q = S(true).quiet;
  assert(inQuiet(min("23:30"), q));
  assert(inQuiet(min("07:59"), q));
  assert(!inQuiet(min("08:00"), q));
  assert(!inQuiet(min("22:59"), q));
  assert(!inQuiet(min("23:30"), S(false).quiet));
});

Deno.test("сводка в тихие часы переносится на их конец и догоняется в пределах часа", () => {
  const q = { enabled: true, start: "22:00", end: "09:30" };
  assertEquals(digestMinute("09:00", q), min("09:30"));
  assert(!digestDue(min("09:00"), "09:00", q));
  assert(digestDue(min("09:30"), "09:00", q));
  assert(digestDue(min("10:29"), "09:00", q));
  assert(!digestDue(min("10:30"), "09:00", q));
});

Deno.test("A29: задача на 00:10 — напоминание в 23:40 накануне при выключенных тихих часах", () => {
  const t = T({ planned_date: "2027-01-01", planned_time: "00:10:00" });
  assertEquals(reminderDecision(t, at("2026-12-31", "23:39"), min("23:39"), "Europe/Moscow", S()).action, "wait");
  assertEquals(reminderDecision(t, at("2026-12-31", "23:40"), min("23:40"), "Europe/Moscow", S()).action, "send");
  assertEquals(reminderDecision(t, at("2027-01-01", "00:10"), min("00:10"), "Europe/Moscow", S()).action, "skip");
});

Deno.test("A35: в тихие часы напоминание ждёт; после — только если событие ещё впереди", () => {
  const early = T({ planned_date: "2026-10-01", planned_time: "08:10" });
  assertEquals(reminderDecision(early, at("2026-10-01", "07:45"), min("07:45"), "Europe/Moscow", S(true)).action, "wait");
  assertEquals(reminderDecision(early, at("2026-10-01", "08:00"), min("08:00"), "Europe/Moscow", S(true)).action, "send");
  const night = T({ planned_date: "2026-10-01", planned_time: "03:00" });
  assertEquals(reminderDecision(night, at("2026-10-01", "08:00"), min("08:00"), "Europe/Moscow", S(true)).action, "skip");
});

Deno.test("напоминание — по плановому времени, иначе по дедлайну со временем; дата без времени — нет", () => {
  const both = T({ planned_date: "2026-10-01", planned_time: "11:00", due_date: "2026-10-02", due_time: "18:00" });
  assertEquals(reminderDecision(both, at("2026-10-01", "10:30"), min("10:30"), "Europe/Moscow", S()).anchor?.kind, "plan");
  const due = T({ due_date: "2026-10-02", due_time: "18:00" });
  assertEquals(reminderDecision(due, at("2026-10-02", "17:30"), min("17:30"), "Europe/Moscow", S()).action, "send");
  assertEquals(reminderDecision(T({ planned_date: "2026-10-01" }), at("2026-10-01", "00:00"), 0, "Europe/Moscow", S()).action, "skip");
  assertEquals(reminderDecision(T({ planned_date: "2026-10-01", planned_time: "11:00", completed: true }), at("2026-10-01", "10:40"), min("10:40"), "Europe/Moscow", S()).action, "skip");
});

Deno.test("интервал 5/15/60 минут", () => {
  const t = T({ planned_date: "2026-10-01", planned_time: "11:00" });
  assertEquals(reminderDecision(t, at("2026-10-01", "10:54"), 0, "Europe/Moscow", { ...S(), lead: 5 }).action, "wait");
  assertEquals(reminderDecision(t, at("2026-10-01", "10:55"), 0, "Europe/Moscow", { ...S(), lead: 5 }).action, "send");
  assertEquals(reminderDecision(t, at("2026-10-01", "10:00"), 0, "Europe/Moscow", { ...S(), lead: 60 }).action, "send");
});

Deno.test("утренняя сводка: события по времени, без времени, дедлайны, просроченное; без выполненного", () => {
  const text = morningDigest([
    T({ id: "1", title: "Созвон", planned_date: "2026-09-29", planned_time: "15:00" }),
    T({ id: "2", title: "Тренировка", planned_date: "2026-09-29", planned_time: "12:00" }),
    T({ id: "3", title: "Финансы", planned_date: "2026-09-29" }),
    T({ id: "4", title: "КП", due_date: "2026-09-29", due_time: "18:00" }),
    T({ id: "5", title: "Старое", due_date: "2026-09-20" }),
    T({ id: "6", title: "Готово", planned_date: "2026-09-29", completed: true }),
    T({ id: "7", title: "<script>", planned_date: "2026-09-29", planned_time: "09:00" }),
  ], "2026-09-29", "2026-09-30");
  assert(text.indexOf("09:00") < text.indexOf("12:00") && text.indexOf("12:00") < text.indexOf("15:00"));
  assert(text.includes("Без времени") && text.includes("Финансы"));
  assert(text.includes("Дедлайны сегодня") && text.includes("КП — до 18:00"));
  assert(text.includes("Просрочено: 1") && text.includes("Старое"));
  assert(!text.includes("Готово"));
  assert(text.includes("&lt;script&gt;"));
});

Deno.test("A35: пустой день — короткая сводка", () => {
  assert(morningDigest([], "2026-09-29", "2026-09-30").includes("На сегодня задач нет"));
  assert(eveningDigest([], "2026-09-29", "2026-09-30").includes("ничего не запланировано"));
});
