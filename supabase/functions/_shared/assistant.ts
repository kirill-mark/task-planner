import { memoryRequest } from "../../../js/assistant-memory.js";
import { selectCandidates, timeMentioned, type TaskRef } from "./intent.ts";

export function asksForChange(message: string): boolean {
  if (memoryRequest(message)) return false;
  if (/(ничего не меняй|не изменяй|не добавляй|не удаляй|только (покажи|расскажи|посоветуй|предложи))/i.test(message)) return false;
  if (/(?:хочу|можешь|нужно|давай)\s+(?:мне\s+)?(?:добавить|создать|записать|поставить|перенести|изменить|удалить|отметить|запланировать)/i.test(message)) return true;
  return /(?:^|[\s,;.!?])(?:добавь|создай|запиши|поставь|запланируй|перенеси|перенесите|измени|поменяй|удали|убери|отметь|заверши|выполни|переименуй|очисти|сдвинь)(?:[\s,;.!?]|$)/i.test(message);
}

export function assistantContext(tasks: any[], message: string, today: string, tomorrow: string, history: { content: string }[] = []) {
  if (/^запомни(?:\s|[:,—-]|$)|что.{0,15}(помнишь|запомнил)|твоя память|мои предпочтения/i.test(message.trim())) return { tasks: [], daily: null };
  const open = tasks.filter((t) => !t.completed && !t.deleted_at);
  const changing = asksForChange(message);
  const daily = !changing && /сегодня|завтра|план.{0,12}дн|собери.{0,12}день|на день|первым|что дальше/i.test(message)
    && !/входящ|без дат|просроч|все задачи|весь список/i.test(message);
  const date = /завтра/i.test(message) ? tomorrow : today;
  if (daily) return { tasks: open.filter((t) => t.planned_date === date || t.due_date === date).slice(0, 60), daily: date };
  if (/входящ|без дат/i.test(message) && !changing) return { tasks: open.filter((t) => !t.planned_date && !t.due_date).slice(0, 60), daily: null };
  const refs: TaskRef[] = open.map((t) => ({ id: t.id, title: t.title, notes: t.notes, date: t.planned_date || t.due_date || "" }));
  const matched = selectCandidates(message, refs, 30).map((r) => r.id);
  const previous = selectCandidates(history.map((h) => h.content).join(" "), refs, 10).map((r) => r.id);
  const near = open.filter((t) => [t.planned_date, t.due_date].some((d) => d && d <= tomorrow));
  const ids = [...new Set([...matched, ...previous, ...near.map((t) => t.id)])].slice(0, 60);
  return { tasks: ids.map((id) => open.find((t) => t.id === id)).filter(Boolean), daily: null };
}

// A date is useful without a guessed weekday. Keep model-generated date phrases neutral.
export const cleanAnswerText = (s: string) => s.replace(/(?:в\s+)?(?:понедельник|вторник|сред[ау]|четверг|пятниц[ау]|суббот[ау]|воскресенье),?\s+(?=\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря))/gi, "");

export function answerSections(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 4).filter((v) => v && typeof v === "object" && Array.isArray(v.items)).map((v) => ({
    title: typeof v.title === "string" ? cleanAnswerText(v.title.slice(0, 80)) : "",
    items: v.items.filter((i: unknown) => typeof i === "string" && i.trim()).slice(0, 8).map((i: string) => cleanAnswerText(i.slice(0, 500))),
  })).filter((v) => v.items.length);
}

// Dictation may preserve hour words instead of turning them into digits.
export function assistantTimeMentioned(message: string): boolean {
  if (timeMentioned(message)) return true;
  const hours = "двадцать(?: один| два| три)?|одиннадцать|двенадцать|тринадцать|четырнадцать|пятнадцать|шестнадцать|семнадцать|восемнадцать|девятнадцать|десять|девять|восемь|семь|шесть|пять|четыре|три|два|один|час";
  return new RegExp(`(?:^|[^\\p{L}])(?:в|к|до|около)\\s+(?:${hours})(?=$|[,.!?;]|\\s+(?:час|утр|вечер|ноч|тридцать|пятнадцать|сорок|сегодня|завтра))`, "iu").test(message);
}
