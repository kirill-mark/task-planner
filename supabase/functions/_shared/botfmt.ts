// Сообщения бота (раздел 9 ТЗ): короткий заголовок, название, понятная дата с
// днём недели, время при наличии, путь раздела и группы, непустое описание.
// Пустых строк «Описание» и «Время» нет; «Запланировано на» и «Дедлайн до»
// различаются. Всё, что пришло от пользователя, экранируется.

export function esc(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const WEEKDAYS = ["Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];
const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

// «Вторник, 29 сентября» (+ год, если не текущий)
export function humanDay(iso: string, today: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${wd}, ${d} ${MONTHS[m - 1]}${iso.slice(0, 4) !== today.slice(0, 4) ? " " + y : ""}`;
}

// «сегодня», «завтра», иначе «вторник, 29 сентября»
export function relDay(iso: string, today: string, tomorrow: string): string {
  if (iso === today) return "сегодня";
  if (iso === tomorrow) return "завтра";
  const h = humanDay(iso, today);
  return h[0].toLowerCase() + h.slice(1);
}

export type CardTask = {
  title: string;
  notes?: string;
  date?: string;
  time?: string;
  dateMode?: string;
  completed?: boolean;
};

export function whenLine(t: CardTask, today: string): string {
  if (!t.date) return "Без даты — во «Входящих»";
  const day = humanDay(t.date, today) + (t.time ? ` · ${t.time}` : "");
  return t.dateMode === "on" ? day : `Дедлайн до: ${day[0].toLowerCase()}${day.slice(1)}`;
}

export function taskCard(heading: string, t: CardTask, path: string, today: string, extra: string[] = []): string {
  const lines = [
    `<b>${esc(heading)}</b>`,
    t.completed ? `<s>${esc(t.title)}</s>` : esc(t.title),
    esc(whenLine(t, today)),
    esc(path),
  ];
  if (t.notes && t.notes.trim()) lines.push(`<i>${esc(t.notes.trim().slice(0, 500))}</i>`);
  return [...lines, ...extra].join("\n");
}

// Расшифровка голосового — свёрнутой цитатой: видна по нажатию, место не занимает.
export function transcriptBlock(text: string): string {
  return `<blockquote expandable>Что распознано: ${esc(text.slice(0, 900))}</blockquote>`;
}

// Длинный текст режется по строкам в пределах лимита Telegram (4096). Разметка
// строится так, что тег не пересекает конец строки, поэтому разрез не рвёт HTML.
export function splitMessage(text: string, limit = 3900): string[] {
  if (text.length <= limit) return [text];
  const parts: string[] = [];
  let cur = "";
  for (const line of text.split("\n")) {
    const piece = line.length > limit ? line.slice(0, limit - 1) + "…" : line;
    if (cur && cur.length + 1 + piece.length > limit) {
      parts.push(cur);
      cur = piece;
    } else {
      cur = cur ? cur + "\n" + piece : piece;
    }
  }
  if (cur) parts.push(cur);
  return parts;
}

// Кнопки — не длиннее, чем Telegram покажет целиком.
export function buttonLabel(s: string, max = 40): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}
