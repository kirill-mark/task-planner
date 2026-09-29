// Даты, названные словами, считает сервер, а не модель (раздел 15 ТЗ):
// на контрольном наборе модель сдвигала «завтра» на день и ставила «пятницу»
// на среду следующей недели. Модель решает, что это за поручения; какой это
// день — решает этот разбор, если выражение в тексте однозначно.
//
// Правила:
//   * «сегодня», «завтра», «послезавтра», «через N дней / неделю / N недель»;
//   * день недели («в пятницу», «до пятницы», «к среде») — ближайший после
//     сегодня; «следующий» — ещё на неделю позже; названный сегодняшний день
//     недели — через неделю («в среду», сказанное в среду);
//   * «25.10», «25.10.2027», «15 октября», «3-го декабря» — в этом году, а если
//     дата уже прошла — в следующем;
//   * «до конца месяца» — последний день месяца, «до конца недели» — воскресенье.

export type DatePhrase = { index: number; date: string };

const DAY = 86400000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

const MONTHS: [string, number][] = [
  ["январ", 1], ["феврал", 2], ["март", 3], ["апрел", 4], ["ма[йя]", 5], ["июн", 6],
  ["июл", 7], ["август", 8], ["сентябр", 9], ["октябр", 10], ["ноябр", 11], ["декабр", 12],
];
const WEEKDAYS: [string, number][] = [
  ["понедельник", 1], ["вторник", 2], ["сред[аыуе]", 3], ["четверг", 4],
  ["пятниц[аыуе]", 5], ["суббот[аыуе]", 6], ["воскресень[еяю]", 0],
];

function validYmd(y: number, m: number, d: number): boolean {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

// Число с месяцем без года: в этом году, прошедшее — в следующем.
function dayMonth(base: number, d: number, m: number, y?: number): string | null {
  const today = new Date(base);
  if (y !== undefined) {
    if (y < 100) y += 2000;
    return validYmd(y, m, d) ? iso(Date.UTC(y, m - 1, d)) : null;
  }
  let yy = today.getUTCFullYear();
  if (!validYmd(yy, m, d)) return null;
  if (Date.UTC(yy, m - 1, d) < base) yy += 1;
  return validYmd(yy, m, d) ? iso(Date.UTC(yy, m - 1, d)) : null;
}

export function datePhrases(text: string, today: string): DatePhrase[] {
  const t = text.toLowerCase().replace(/ё/g, "е");
  const base = Date.parse(today + "T00:00:00Z");
  const wdToday = new Date(base).getUTCDay();
  const found: DatePhrase[] = [];
  const taken: [number, number][] = [];
  const add = (index: number, len: number, date: string | null) => {
    if (!date || taken.some(([a, b]) => index < b && a < index + len)) return;
    taken.push([index, index + len]);
    found.push({ index, date });
  };
  const L = "(?<![\\p{L}\\d])";          // граница слова, понятная и для кириллицы
  const scan = (re: string, fn: (m: RegExpExecArray) => string | null) => {
    const rx = new RegExp(re, "gu");
    for (let m; (m = rx.exec(t));) add(m.index, m[0].length, fn(m));
  };

  scan(`${L}послезавтра`, () => iso(base + 2 * DAY));
  scan(`${L}(?:сегодня|сегодняшн)`, () => iso(base));
  scan(`${L}(?:завтра|завтрашн)`, () => iso(base + DAY));
  scan(`${L}через\\s+(\\d{1,3}|одну|один|две|два|три|четыре|пять)?\\s*(дн[еяй]*|день|недел[юиь]*)`, (m) => {
    const words: Record<string, number> = { один: 1, одну: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5 };
    const n = m[1] ? (words[m[1]] ?? Number(m[1])) : 1;
    if (m[2].startsWith("недел")) return iso(base + n * 7 * DAY);
    return iso(base + (m[1] ? n : 2) * DAY); // «через день» — послезавтра
  });
  scan(`${L}(?:до\\s+)?конц[аеу]\\s+месяца`, () => {
    const d = new Date(base);
    return iso(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  });
  scan(`${L}(?:до\\s+)?конц[аеу]\\s+недели`, () => iso(base + ((7 - wdToday) % 7) * DAY));
  for (const [stem, wd] of WEEKDAYS) {
    scan(`${L}(следующ\\p{L}*\\s+)?${stem}`, (m) => {
      let ahead = (wd - wdToday + 7) % 7;
      if (ahead === 0) ahead = 7;
      if (m[1]) ahead += 7;
      return iso(base + ahead * DAY);
    });
  }
  // «в 10.05» — скорее время, чем 10 мая: такое оставляем модели
  scan(`${L}(?:(в|к|до|с|около)\\s*)?(\\d{1,2})\\.(\\d{1,2})(?:\\.(\\d{2}|\\d{4}))?(?![\\d:])`, (m) =>
    m[1] && !m[4] && Number(m[2]) <= 23 && m[3].length === 2 ? null
      : dayMonth(base, Number(m[2]), Number(m[3]), m[4] ? Number(m[4]) : undefined));
  for (const [stem, mm] of MONTHS) {
    scan(`${L}(\\d{1,2})(?:-?го)?\\s+${stem}\\p{L}*(?:\\s+(\\d{4}))?`, (m) =>
      dayMonth(base, Number(m[1]), mm, m[2] ? Number(m[2]) : undefined));
  }
  return found.sort((a, b) => a.index - b.index);
}
