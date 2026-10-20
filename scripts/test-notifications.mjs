import assert from "node:assert/strict";
import { test } from "node:test";
import { createDeviceNotifications, reminderPlan, taskReminder } from "../js/local-reminders.js";
import { renderIphoneReminders } from "../js/ui/views.js";

const NOW = Date.parse("2026-10-09T08:00:00Z"); // 11:00 Moscow
const task = (changes = {}) => ({ id: "synthetic-task", user_id: "alice", title: "Созвон", planned_date: "2026-10-09",
  planned_time: "12:00:00", timezone: "Europe/Moscow", ...changes });
const ctx = (tasks = [task()], changes = {}) => ({ userId: "alice", ready: true, tasks, timezone: "Europe/Moscow", ...changes });
function fixture(changes = {}) {
  const calls = [], pending = new Map(), delivered = new Map(), values = new Map(), handlers = {};
  let permission = "granted";
  const plugin = {
    async getPending() { return { notifications: [...pending.values()] }; },
    async checkPermissions() { return { display: permission }; },
    async requestPermissions() { calls.push(["request"]); return { display: permission }; },
    async cancel({ notifications }) { calls.push(["cancel", notifications]); notifications.forEach((n) => pending.delete(n.id)); },
    async schedule({ notifications }) { calls.push(["schedule", notifications]); notifications.forEach((n) => pending.set(n.id, n)); },
    async getDeliveredNotifications() { return { notifications: [...delivered.values()] }; },
    async removeDeliveredNotifications({ notifications }) { notifications.forEach((n) => delivered.delete(n.id)); },
    async addListener(name, fn) { handlers[name] = fn; return { remove() {} }; },
    ...changes,
  };
  const storage = { getItem: (k) => values.get(k), setItem: (k, v) => values.set(k, v) };
  const create = () => createDeviceNotifications({ plugin, storage, now: () => NOW });
  return { calls, pending, delivered, handlers, storage, plugin, create, service: create(),
    permission(value) { permission = value; } };
}

test("30 minutes before plan; no duplicate timed deadline reminder", () => {
  const n = taskReminder(task({ due_date: "2026-10-09", due_time: "15:00" }), "alice", "UTC");
  assert.equal(n.schedule.at.toISOString(), "2026-10-09T08:30:00.000Z");
  assert.equal(n.body, "Начало через 30 минут · 12:00");
  assert.equal(n.title, "Созвон"); assert.equal(n.sound, "default");
});
test("timed deadline fallback; date-only plan does not hide it", () => {
  const n = taskReminder(task({ planned_time: null, due_date: "2026-10-10", due_time: "09:00" }), "alice", "UTC");
  assert.equal(n.schedule.at.toISOString(), "2026-10-10T05:30:00.000Z");
  assert.equal(n.body, "Дедлайн через 30 минут · 09:00");
});
test("completed, deleted, foreign, undated and invalid tasks do not notify", () => {
  for (const changes of [{ completed: true }, { deleted_at: "2026-10-09" }, { user_id: "bob" }, { planned_date: null },
    { planned_time: null }, { planned_time: "99:99" }, { planned_date: "2026-02-30" }, { timezone: "not/a/zone" }]) {
    assert.equal(taskReminder(task(changes), "alice", "Europe/Moscow"), null);
  }
});
test("midnight/year boundary and task timezone override device timezone", () => {
  const n = taskReminder(task({ planned_date: "2027-01-01", planned_time: "00:10" }), "alice", "America/New_York");
  assert.equal(n.schedule.at.toISOString(), "2026-12-31T20:40:00.000Z");
  const almaty = taskReminder(task({ timezone: "Asia/Almaty" }), "alice", "Europe/Moscow");
  assert.equal(almaty.schedule.at.toISOString(), "2026-10-09T06:30:00.000Z");
});
test("DST fold and gap use the existing server time contract", () => {
  const n = taskReminder(task({ planned_date: "2026-10-25", planned_time: "02:30", timezone: "Europe/Berlin" }), "alice", "UTC");
  assert.equal(n.schedule.at.toISOString(), "2026-10-25T00:00:00.000Z");
  const gap = taskReminder(task({ planned_date: "2026-03-29", planned_time: "02:30", timezone: "Europe/Berlin" }), "alice", "UTC");
  assert.equal(gap.schedule.at.toISOString(), "2026-03-29T01:00:00.000Z");
});
test("no catch-up flood for overdue or already-passed reminder times", () => {
  const r = reminderPlan([task({ planned_time: "11:20" }), task({ planned_date: "2026-10-08" }), task()], "alice", "UTC", NOW);
  assert.equal(r.notifications.length, 1); assert.equal(r.notifications[0].schedule.at.getTime(), NOW + 1800000);
});
test("schedule nearest 60, deterministic IDs across ordering and accounts", () => {
  const tasks = Array.from({ length: 100 }, (_, i) => task({ id: `t${i}`, planned_date: "2026-10-10",
    planned_time: `${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}` }));
  const a = reminderPlan(tasks, "alice", "UTC", NOW), b = reminderPlan([...tasks].reverse(), "alice", "UTC", NOW);
  assert.equal(a.notifications.length, 60); assert.equal(a.total, 100);
  assert.deepEqual(a.notifications, b.notifications);
  assert.equal(new Set(a.notifications.map((n) => n.id)).size, 60);
  assert(a.notifications.every((n) => n.id > 0 && n.id < 2147483647));
  assert(a.notifications.every((n, i) => i === 0 || n.extra.fireAt >= a.notifications[i - 1].extra.fireAt));
});
test("permission is requested only by explicit enable; denied never schedules", async () => {
  const f = fixture(); f.permission("prompt");
  await f.service.update(ctx()); assert.deepEqual(f.calls, []);
  f.permission("denied"); await f.service.enable();
  assert.equal(f.pending.size, 0); assert.equal(f.service.getState().permission, "denied");
  assert.equal(f.calls.filter(([kind]) => kind === "request").length, 1);
});
test("enable survives restart and refreshing unchanged tasks does not reschedule", async () => {
  const f = fixture(); await f.service.update(ctx()); await f.service.enable();
  assert.equal(f.pending.size, 1); assert.equal(f.service.getState().pending, 1);
  await f.service.refresh(); await f.create().update(ctx());
  assert.equal(f.calls.filter(([kind]) => kind === "schedule").length, 1);
});
test("time/title edits replace old reminder; completion/delete cancels; restoration re-adds", async () => {
  const f = fixture(); await f.service.update(ctx()); await f.service.enable();
  await f.service.update(ctx([task({ title: "Перенесённый созвон", planned_time: "13:00" })]));
  assert.equal(f.pending.size, 1);
  assert.equal([...f.pending.values()][0].schedule.at.toISOString(), "2026-10-09T09:30:00.000Z");
  assert.equal([...f.pending.values()][0].title, "Перенесённый созвон");
  await f.service.update(ctx([task({ completed: true })])); assert.equal(f.pending.size, 0);
  await f.service.update(ctx()); assert.equal(f.pending.size, 1);
  await f.service.update(ctx([])); assert.equal(f.pending.size, 0);
});
test("logout/disable clears owned pending and delivered, preserves unrelated notifications", async () => {
  const f = fixture(); await f.service.update(ctx()); await f.service.enable();
  const delivered = [...f.pending.values()][0]; f.delivered.set(delivered.id, delivered);
  f.pending.set(123, { id: 123, extra: { kind: "another-feature" } });
  await f.service.disable(); assert.equal(f.pending.size, 1); assert.equal(f.delivered.size, 0);
  await f.service.enable(); await f.service.update(ctx([], { userId: null, ready: false }));
  assert.deepEqual([...f.pending.keys()], [123]);
});
test("startup preserves this account's queue until IndexedDB is ready; account switch clears old queue", async () => {
  const f = fixture(); await f.service.update(ctx()); await f.service.enable();
  await f.create().update(ctx([], { ready: false })); assert.equal(f.pending.size, 1);
  await f.service.update(ctx([], { userId: "bob", ready: false })); assert.equal(f.pending.size, 0);
});
test("account switch during permission request cannot enable or schedule wrong account", async () => {
  let release;
  const f = fixture({ requestPermissions: () => new Promise((r) => { release = r; }) });
  await f.service.update(ctx()); const enabling = f.service.enable();
  await new Promise((r) => setImmediate(r));
  const switched = f.service.update(ctx([], { userId: "bob" }));
  release({ display: "granted" }); await enabling; await switched;
  assert.equal(f.pending.size, 0); assert.equal(f.service.getState().enabled, false);
});
test("account switch while native scheduling is in flight is cleaned by the queued reconciliation", async () => {
  const f = fixture(); let release;
  const original = f.plugin.schedule;
  f.plugin.schedule = async (options) => { await new Promise((r) => { release = r; }); return original(options); };
  await f.service.update(ctx()); const enabling = f.service.enable();
  await new Promise((r) => setImmediate(r));
  const switched = f.service.update(ctx([], { userId: "bob" })); release();
  await enabling; await switched; assert.equal(f.pending.size, 0);
});
test("native scheduling failure is visible and retry can recover", async () => {
  const f = fixture(); const original = f.plugin.schedule;
  f.plugin.schedule = async () => { throw new Error("synthetic failure"); };
  await f.service.update(ctx()); await f.service.enable();
  assert(f.service.getState().error); assert.equal(f.service.getState().busy, false);
  f.plugin.schedule = original; await f.service.refresh();
  assert.equal(f.service.getState().error, ""); assert.equal(f.pending.size, 1);
});
test("lost OS permission removes pending without asking again", async () => {
  const f = fixture(); await f.service.update(ctx()); await f.service.enable();
  f.permission("denied"); await f.service.refresh(); assert.equal(f.pending.size, 0);
  assert.equal(f.calls.filter(([k]) => k === "request").length, 1);
});
test("test notification waits 10 seconds, does not alter tasks, survives ordinary refresh", async () => {
  const f = fixture(); const tasks = [task()]; await f.service.update(ctx(tasks)); await f.service.enable();
  await f.service.test(); await f.service.refresh();
  const testNotification = [...f.pending.values()].find((n) => n.extra.test);
  assert.equal(testNotification.schedule.at.getTime(), NOW + 10000);
  assert.equal(f.pending.size, 2); assert.deepEqual(tasks, [task()]);
});
test("cold notification tap waits for loaded task and never opens another account's task", async () => {
  const f = fixture(); const opened = []; await f.service.listen(); f.service.onOpenTask((id) => opened.push(id));
  f.handlers.localNotificationActionPerformed({ notification: taskReminder(task(), "alice", "UTC") });
  await f.service.update(ctx([], { ready: false })); assert.deepEqual(opened, []);
  await f.service.update(ctx()); assert.deepEqual(opened, ["synthetic-task"]);
  await f.service.update(ctx([], { userId: "bob" }));
  f.handlers.localNotificationActionPerformed({ notification: taskReminder(task(), "alice", "UTC") });
  assert.deepEqual(opened, ["synthetic-task"]);
});
test("native card hidden in PWA, permission/error states and Cyrillic title escaped", () => {
  assert.equal(renderIphoneReminders(null), "");
  const enabled = renderIphoneReminders({ available: true, enabled: true, permission: "granted", pending: 3, total: 3 });
  assert.match(enabled, /за 30 минут/); assert.match(enabled, /Проверить уведомление/);
  const denied = renderIphoneReminders({ available: true, permission: "denied", error: "<bad>" });
  assert.match(denied, /Настройки iPhone/); assert.match(denied, /&lt;bad&gt;/);
});
