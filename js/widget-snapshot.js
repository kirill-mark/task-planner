import { tasksOfDay } from "./ui/derive.js";
import { addDays, hhmm } from "./ui/lib.js";

export function widgetDay(now, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (name) => parts.find((p) => p.type === name).value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

// Only titles and scheduling fields cross into the App Group, never notes or auth data.
export function buildWidgetSnapshot({ userId, tasks = [], timezone = "UTC" }, now = new Date()) {
  try { widgetDay(now, timezone); } catch { timezone = "UTC"; }
  const today = widgetDay(now, timezone);
  const days = userId ? Array.from({ length: 8 }, (_, offset) => {
    const date = addDays(today, offset);
    const list = tasksOfDay({ tasks: tasks.filter((t) => !t.deleted_at && (!t.user_id || t.user_id === userId)) }, date);
    return { date, total: list.length, done: list.filter((t) => t.completed).length,
      tasks: list.filter((t) => !t.completed).slice(0, 100).map((t) => {
        const planned = t.planned_date === date;
        const time = hhmm(planned ? t.planned_time : t.due_time) || null;
        return { id: t.id, title: String(t.title || "Без названия").slice(0, 120), time,
          deadline: !planned, label: time ? (planned ? time : `до ${time}`) : (planned ? "Без времени" : "До конца дня") };
      }) };
  }) : [];
  return { version: 1, userId: userId || null, timezone, updatedAt: now.toISOString(), days };
}

export function createDeviceWidget({ plugin, now = () => new Date() }) {
  let preparedUser, latest = null, signature = null, chain = Promise.resolve(), openHandler = null, pending = null;
  let state = { status: "loading", error: null };
  const subscribers = new Set();
  const emit = (next) => { state = next; for (const fn of subscribers) fn(state); };
  function update(input) {
    latest = input;
    // Serialize account transitions: an old save must never finish after logout/new user.
    chain = chain.catch(() => {}).then(async () => {
      if (input !== latest) return;
      try {
        await plugin.prepare({ userId: input.userId || "" });
        if (preparedUser !== input.userId) { preparedUser = input.userId; signature = null; }
        if (input !== latest) return;
        if (input.userId && !input.ready) return;
        const snapshot = buildWidgetSnapshot(input, now());
        const key = JSON.stringify({ ...snapshot, updatedAt: "" });
        if (key === signature) return;
        await plugin.save({ snapshot: JSON.stringify(snapshot) });
        signature = key;
        emit({ status: input.userId ? "ready" : "signedOut", error: null });
      } catch (e) { signature = null; emit({ status: "error", error: "Не удалось обновить виджет. Открой MARK ещё раз." }); }
    });
    return chain;
  }
  const deliver = () => { if (pending && openHandler) { const value = pending; pending = null; openHandler(value); } };
  async function consume() {
    try { const value = await plugin.consumeOpen(); if (value.userId) { pending = value; deliver(); } } catch { /* opening MARK normally remains available */ }
  }
  return { update, refresh: () => latest ? update(latest) : Promise.resolve(), getState: () => state,
    subscribe(fn) { subscribers.add(fn); fn(state); return () => subscribers.delete(fn); },
    onOpen(fn) { openHandler = fn; deliver(); },
    async listen() {
      try { await plugin.addListener("widgetOpen", consume); await consume(); }
      catch { emit({ status: "error", error: "Не удалось подключить виджет. Открой MARK ещё раз." }); }
    } };
}

export function routeForWidgetOpen(value, userId) {
  if (!userId || value?.userId !== userId) return null;
  if (value.screen === "assistant") return "#/assistant";
  if (value.screen != null) return null;
  return value.taskId ? `#/tasks?view=today&open=${encodeURIComponent(value.taskId)}` : "#/tasks?view=today";
}
