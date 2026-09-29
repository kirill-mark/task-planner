// Общие мелочи интерфейса: экранирование, склонения, даты по-русски.
//
// Календарные даты — строки YYYY-MM-DD и считаются без UTC: дата без времени
// хранится как календарная дата (раздел 3 ТЗ), и «сегодня» — это местный день
// устройства, а не сутки по Гринвичу.

export function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export const pad = (n) => String(n).padStart(2, "0");

export function isoOf(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayIso(now = new Date()) {
  return isoOf(now);
}

export function parseIso(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(iso, n) {
  const d = parseIso(iso);
  d.setDate(d.getDate() + n);
  return isoOf(d);
}

export function daysBetween(a, b) {
  return Math.round((parseIso(b) - parseIso(a)) / 86400000);
}

const WEEKDAYS = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
const WEEKDAYS_SHORT = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

export const WEEK_HEADER = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

export function weekdayOf(iso) {
  return WEEKDAYS[parseIso(iso).getDay()];
}

export function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

// «Вторник, 29 сентября»
export function longDate(iso) {
  const d = parseIso(iso);
  return `${capitalize(WEEKDAYS[d.getDay()])}, ${d.getDate()} ${MONTHS_GEN[d.getMonth()]}`;
}

// «29 сен», «вт, 29 сен» — с годом, если он не текущий
export function shortDate(iso, { weekday = false, today = todayIso() } = {}) {
  const d = parseIso(iso);
  const sameYear = iso.slice(0, 4) === today.slice(0, 4);
  const base = `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}${sameYear ? "" : " " + d.getFullYear()}`;
  return weekday ? `${WEEKDAYS_SHORT[d.getDay()]}, ${base}` : base;
}

// «Сегодня», «Завтра», «Вчера», иначе «ср, 30 сен»
export function relativeDay(iso, today = todayIso()) {
  const diff = daysBetween(today, iso);
  if (diff === 0) return "Сегодня";
  if (diff === 1) return "Завтра";
  if (diff === -1) return "Вчера";
  return capitalize(shortDate(iso, { weekday: true, today }));
}

export function monthTitle(year, monthIndex) {
  return `${MONTHS[monthIndex]} ${year}`;
}

export const hhmm = (t) => (t ? String(t).slice(0, 5) : "");

export function minutesOf(time) {
  const [h, m] = hhmm(time).split(":").map(Number);
  return h * 60 + m;
}

export function timeOf(minutes) {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

export function durationText(min) {
  if (!min) return "";
  const h = Math.floor(min / 60), m = min % 60;
  if (!h) return `${m} мин`;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}

export function deviceTimezone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { return null; }
}
