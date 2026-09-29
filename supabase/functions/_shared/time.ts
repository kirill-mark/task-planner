// Даты и время задач: проверка значений и перевод местного времени события в
// момент UTC по поясу аккаунта. Без библиотек — только Intl.

// «ЧЧ:ММ» с допустимыми часами и минутами: /^\d{2}:\d{2}$/ пропускал 99:99.
export function validTime(s: unknown): s is string {
  return typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

// Календарная дата, которая действительно существует (не 2026-02-30).
export function validDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Смещение пояса в минутах для данного момента (Москва: +180).
function offsetMinutes(at: number, tz: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p: Record<string, number> = {};
  for (const part of fmt.formatToParts(new Date(at))) if (part.type !== "literal") p[part.type] = Number(part.value);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(at / 1000) * 1000) / 60000);
}

// Момент UTC для местных даты и времени в поясе. Время, которого нет из-за
// перевода часов вперёд, сдвигается на величину перевода; двусмысленное при
// переводе назад берётся в первом (более раннем) из двух вариантов.
export function zonedToUtc(date: string, time: string, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  const DAY = 86400000;
  // смещения по обе стороны возможного перехода; момент подходит, если в
  // своём поясе он показывает именно эти дату и время
  const before = offsetMinutes(wall - DAY, tz);
  const after = offsetMinutes(wall + DAY, tz);
  const fits = [wall - before * 60000, wall - after * 60000]
    .filter((t) => t + offsetMinutes(t, tz) * 60000 === wall);
  if (fits.length) return new Date(Math.min(...fits));
  // такого местного времени нет (перевод вперёд): берётся смещение до
  // перехода, что даёт тот же момент, сдвинутый на величину перевода
  return new Date(wall - before * 60000);
}

// Напоминание уместно с момента «за lead минут» и до начала события: запуск
// планировщика может опоздать, но напоминание о прошедшем событии бессмысленно.
export function reminderWindow(date: string, time: string, tz: string, leadMin: number) {
  const event = zonedToUtc(date, time, tz).getTime();
  return { fireAt: event - leadMin * 60000, eventAt: event };
}
