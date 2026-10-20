import { validDate, validTime, zonedToUtc } from "../supabase/functions/_shared/time.ts";

export const REMINDER_LEAD = 30;
export const REMINDER_LIMIT = 60; // iOS has a limited pending queue; leave space for the test.
const KIND = "mark-task-reminder-v1";
const TEST_ID = 2147483647;
const keyFor = (userId) => `mark:iphone-reminders:v1:${userId}`;
const hhmm = (time) => typeof time === "string" ? time.slice(0, 5) : "";
const owned = (n) => n.extra?.kind === KIND;

// One reminder per task: plan first, timed deadline as a fallback.
export function taskReminder(task, userId, timezone) {
  if (!task.id || task.completed || task.deleted_at || (task.user_id && task.user_id !== userId)) return null;
  let date, time, label;
  if (validDate(task.planned_date) && validTime(hhmm(task.planned_time))) {
    date = task.planned_date; time = hhmm(task.planned_time); label = "Начало";
  } else if (validDate(task.due_date) && validTime(hhmm(task.due_time))) {
    date = task.due_date; time = hhmm(task.due_time); label = "Дедлайн";
  } else return null;
  const zone = task.timezone || timezone;
  let eventAt;
  try { eventAt = zonedToUtc(date, time, zone).getTime(); } catch { return null; }
  if (!Number.isFinite(eventAt)) return null;
  const title = String(task.title || "Задача");
  const fireAt = eventAt - REMINDER_LEAD * 60000;
  const fingerprint = JSON.stringify([userId, task.id, title, eventAt, label]);
  return { title, body: `${label} через 30 минут · ${time}`, sound: "default",
    schedule: { at: new Date(fireAt) }, threadIdentifier: "mark-tasks",
    extra: { kind: KIND, userId, taskId: task.id, fireAt, fingerprint } };
}

export function reminderPlan(tasks, userId, timezone, now = Date.now(), limit = REMINDER_LIMIT) {
  const all = tasks.map((t) => taskReminder(t, userId, timezone)).filter(Boolean);
  const future = all.filter((n) => n.extra.fireAt > now)
    .sort((a, b) => a.extra.fireAt - b.extra.fireAt || a.extra.taskId.localeCompare(b.extra.taskId));
  // Deterministic positive IDs; resolve collisions across the complete task set.
  const ids = new Map(), used = new Set([TEST_ID]);
  for (const n of [...all].sort((a, b) => a.extra.taskId.localeCompare(b.extra.taskId))) {
    let hash = 2166136261;
    for (const c of `${userId}:${n.extra.taskId}`) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619) >>> 0;
    let id = (hash % (TEST_ID - 1)) + 1;
    while (used.has(id)) id = id === TEST_ID - 1 ? 1 : id + 1;
    used.add(id); ids.set(n.extra.taskId, id);
  }
  return { notifications: future.slice(0, limit).map((n) => ({ ...n, id: ids.get(n.extra.taskId) })),
    activeFingerprints: new Set(all.map((n) => n.extra.fingerprint)), total: future.length };
}

export function createDeviceNotifications({ plugin, storage, now = Date.now }) {
  let context = { userId: null, tasks: [], ready: false, timezone: "UTC" };
  let revision = 0, chain = Promise.resolve(), action = null, openTask = null;
  let state = { available: true, enabled: false, permission: "prompt", busy: false, pending: 0, total: 0, error: "", message: "" };
  const listeners = new Set();
  function publish(patch) {
    const next = { ...state, ...patch };
    if (JSON.stringify(next) === JSON.stringify(state)) return;
    state = next; listeners.forEach((fn) => fn({ ...state }));
  }
  function enabled(userId = context.userId) { return !!userId && storage.getItem(keyFor(userId)) === "on"; }
  function enqueue(fn) {
    chain = chain.then(fn).catch(() => publish({ busy: false, error: "Не удалось обновить напоминания. Проверьте разрешение и повторите попытку." }));
    return chain;
  }
  function dispatchAction() {
    if (!action || !context.userId || !context.ready || !openTask) return;
    const n = action; action = null;
    if (n.extra?.userId === context.userId && context.tasks.some((t) => t.id === n.extra.taskId && !t.deleted_at)) openTask(n.extra.taskId);
  }
  async function reconcile() {
    const c = context, rev = revision;
    const on = enabled(c.userId);
    publish({ enabled: on, error: "" });
    const pending = (await plugin.getPending()).notifications.filter(owned);
    if (revision !== rev) return;
    const permission = (await plugin.checkPermissions()).display;
    if (revision !== rev) return;
    publish({ permission });
    const plan = c.ready && c.userId && on && permission === "granted"
      ? reminderPlan(c.tasks, c.userId, c.timezone, now()) : { notifications: [], activeFingerprints: new Set(), total: 0 };
    const wanted = new Map(plan.notifications.map((n) => [n.id, n]));
    const stale = pending.filter((n) => {
      if (!on || n.extra.userId !== c.userId || permission !== "granted") return true;
      if (!c.ready || n.extra.test) return false;
      return wanted.get(n.id)?.extra.fingerprint !== n.extra.fingerprint;
    });
    if (stale.length) await plugin.cancel({ notifications: stale.map(({ id }) => ({ id })) });
    if (revision !== rev) return;
    // Leave delivered reminders visible until completion, removal, edit, or logout.
    const delivered = (await plugin.getDeliveredNotifications()).notifications.filter(owned);
    if (revision !== rev) return;
    const remove = delivered.filter((n) => !on || n.extra.userId !== c.userId ||
      (c.ready && !n.extra.test && !plan.activeFingerprints.has(n.extra.fingerprint)));
    if (remove.length) await plugin.removeDeliveredNotifications({ notifications: remove });
    if (revision !== rev) return;
    if (!c.ready || !on || permission !== "granted") {
      publish({ pending: 0, total: 0 }); dispatchAction(); return;
    }
    const keep = new Map(pending.filter((n) => !stale.includes(n)).map((n) => [n.id, n]));
    const additions = plan.notifications.filter((n) => keep.get(n.id)?.extra.fingerprint !== n.extra.fingerprint && n.extra.fireAt > now());
    if (additions.length) await plugin.schedule({ notifications: additions });
    if (revision !== rev) return; // a queued reconciliation cleans up an account change during schedule
    const confirmed = (await plugin.getPending()).notifications;
    if (revision !== rev) return;
    const count = confirmed.filter((n) => owned(n) && n.extra.userId === c.userId && !n.extra.test &&
      wanted.get(n.id)?.extra.fingerprint === n.extra.fingerprint).length;
    publish({ pending: count, total: plan.total, error: count < plan.notifications.filter((n) => n.extra.fireAt > now()).length
      ? "Часть напоминаний не удалось запланировать. Попробуйте ещё раз." : "" });
    dispatchAction();
  }
  const service = {
    getState: () => ({ ...state }),
    subscribe(fn) { listeners.add(fn); fn({ ...state }); return () => listeners.delete(fn); },
    update(next) {
      context = { ...next, tasks: (next.tasks || []).map((t) => ({ ...t })) };
      revision++; publish({ enabled: enabled(), pending: 0, total: 0, message: "", error: "" });
      return enqueue(reconcile);
    },
    refresh: () => enqueue(reconcile),
    enable() {
      const userId = context.userId;
      if (!userId) return Promise.resolve();
      publish({ busy: true, message: "", error: "" });
      return enqueue(async () => {
        try {
          const result = await plugin.requestPermissions();
          if (context.userId !== userId) return;
          publish({ permission: result.display });
          if (result.display === "granted") storage.setItem(keyFor(userId), "on");
          else publish({ message: "Разрешите уведомления: Настройки iPhone → Уведомления → MARK." });
          await reconcile();
        } finally { publish({ busy: false }); }
      });
    },
    disable() {
      if (context.userId) storage.setItem(keyFor(context.userId), "off");
      revision++; publish({ enabled: false, message: "", error: "" });
      return enqueue(reconcile);
    },
    test() {
      const userId = context.userId;
      publish({ busy: true, message: "", error: "" });
      return enqueue(async () => {
        try {
          if (!userId || userId !== context.userId || !enabled()) return;
          if ((await plugin.checkPermissions()).display !== "granted") { await reconcile(); return; }
          if (userId !== context.userId || !enabled()) return;
          await plugin.schedule({ notifications: [{ id: TEST_ID, title: "MARK · Проверка уведомлений",
            body: "Напоминания на iPhone работают. Задачи будут напоминать о себе за 30 минут.", sound: "default",
            schedule: { at: new Date(now() + 10000) }, extra: { kind: KIND, userId, test: true } }] });
          if (userId === context.userId) publish({ message: "Проверка запланирована. Заблокируйте iPhone — уведомление придёт через 10 секунд." });
        } finally { publish({ busy: false }); }
      });
    },
    onOpenTask(fn) { openTask = fn; dispatchAction(); },
    async listen() {
      await plugin.addListener("localNotificationActionPerformed", ({ notification }) => {
        if (owned(notification) && !notification.extra.test) { action = notification; dispatchAction(); }
      });
    },
  };
  return service;
}
