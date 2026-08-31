const DAY_NAMES = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MONTH_NAMES = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

export function toISO(date) {
  const d = new Date(date);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

export function todayISO() {
  return toISO(new Date());
}

export function addDays(iso, n) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return toISO(d);
}

// Monday-based start of week
export function startOfWeek(iso) {
  const d = new Date(iso + "T00:00:00");
  const day = d.getDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return toISO(d);
}

export function weekDates(iso) {
  const start = startOfWeek(iso);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function formatDayLabel(iso) {
  const d = new Date(iso + "T00:00:00");
  return `${DAY_NAMES[d.getDay() === 0 ? 6 : d.getDay() - 1]}, ${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
}

export function formatShort(iso) {
  const d = new Date(iso + "T00:00:00");
  return `${d.getDate()} ${MONTH_NAMES[d.getMonth()].slice(0, 3)}`;
}

export function weekDayName(iso) {
  const d = new Date(iso + "T00:00:00");
  return DAY_NAMES[d.getDay() === 0 ? 6 : d.getDay() - 1];
}

export function isToday(iso) {
  return iso === todayISO();
}
