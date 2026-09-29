// deno test supabase/functions/_shared/time_test.ts

import { assert, assertEquals } from "jsr:@std/assert@1";
import { reminderWindow, validDate, validTime, zonedToUtc } from "./time.ts";

Deno.test("время: только настоящие ЧЧ:ММ", () => {
  for (const ok of ["00:00", "09:30", "23:59"]) assert(validTime(ok), ok);
  for (const bad of ["24:00", "99:99", "9:30", "12:60", "", null, "12:30:00"]) assert(!validTime(bad), String(bad));
});

Deno.test("дата: только существующие", () => {
  assert(validDate("2026-09-29"));
  assert(validDate("2028-02-29"));
  for (const bad of ["2026-02-30", "2026-13-01", "29.09.2026", "", "2026-9-1"]) assert(!validDate(bad), bad);
});

Deno.test("Москва и Алматы без перехода времени", () => {
  assertEquals(zonedToUtc("2026-09-29", "11:00", "Europe/Moscow").toISOString(), "2026-09-29T08:00:00.000Z");
  assertEquals(zonedToUtc("2026-09-29", "11:00", "Asia/Almaty").toISOString(), "2026-09-29T06:00:00.000Z");
});

Deno.test("A29: задача на 00:10 — напоминание в 23:40 предыдущего дня, через месяц и год", () => {
  const { fireAt, eventAt } = reminderWindow("2027-01-01", "00:10", "Europe/Moscow", 30);
  assertEquals(new Date(eventAt).toISOString(), "2026-12-31T21:10:00.000Z");
  assertEquals(new Date(fireAt).toISOString(), "2026-12-31T20:40:00.000Z"); // 23:40 31 декабря по Москве
});

Deno.test("пояс с переходом времени: Берлин летом и зимой", () => {
  assertEquals(zonedToUtc("2026-07-01", "10:00", "Europe/Berlin").toISOString(), "2026-07-01T08:00:00.000Z");
  assertEquals(zonedToUtc("2026-12-01", "10:00", "Europe/Berlin").toISOString(), "2026-12-01T09:00:00.000Z");
});

Deno.test("несуществующее время при переводе вперёд сдвигается, а не пропадает", () => {
  // 29 марта 2026 в Берлине 02:00 → 03:00; 02:30 не существует
  const t = zonedToUtc("2026-03-29", "02:30", "Europe/Berlin").toISOString();
  assertEquals(t, "2026-03-29T01:30:00.000Z"); // = 03:30 по летнему времени
});

Deno.test("двусмысленное время при переводе назад — первое из двух", () => {
  // 25 октября 2026 в Берлине 03:00 → 02:00; 02:30 бывает дважды
  assertEquals(zonedToUtc("2026-10-25", "02:30", "Europe/Berlin").toISOString(), "2026-10-25T00:30:00.000Z");
});
