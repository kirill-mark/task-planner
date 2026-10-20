import assert from "node:assert/strict";
import { ModelStore } from "../js/mark/store.js";
import { clearOverdue } from "../js/ui/clear-overdue.js";

let checks = 0;
async function test(name, fn) { await fn(); checks++; console.log(`PASS ${name}`); }
function fixture({ state = "synced", response = { data: { tasks: 2 }, error: null }, sync } = {}) {
  const calls = [];
  const store = new ModelStore({ supabase: { rpc: async (...args) => { calls.push(args); return response; } } });
  let syncs = 0;
  store.userId = "own";
  store.engine = { sync: async () => { syncs++; await sync?.(store); }, status: () => ({ state }) };
  return { store, calls, syncs: () => syncs };
}
const tasks = [{ id: "a", deleted_at: "2026-10-09T09:00:00Z", title: "Private title" }];
await test("purge flushes queue, sends deletion snapshot, then resynchronizes", async () => {
  const f = fixture(); const result = await f.store.emptyTrash(tasks);
  assert.deepEqual(result, { ok: true, count: 2 });
  assert.equal(f.syncs(), 2);
  assert.deepEqual(f.calls, [["mark_empty_trash", { p_tasks: [{ id: "a", deleted_at: tasks[0].deleted_at }], p_expected_user: "own" }]]);
});
await test("offline purge makes no destructive RPC call", async () => {
  const f = fixture({ state: "offline" });
  assert.equal((await f.store.emptyTrash(tasks)).ok, false); assert.equal(f.calls.length, 0);
});
await test("account switch during sync prevents purge", async () => {
  const f = fixture({ sync: (store) => { store.userId = "other"; } });
  assert.equal((await f.store.emptyTrash(tasks)).ok, false); assert.equal(f.calls.length, 0);
});
await test("missing server function never reports successful cleanup", async () => {
  const f = fixture({ response: { data: null, error: { code: "PGRST202" } } });
  const result = await f.store.emptyTrash(tasks);
  assert.equal(result.ok, false); assert.match(result.message, /сервере/);
});
await test("server failure preserves the unsuccessful result", async () => {
  const f = fixture({ response: { data: null, error: { code: "500" } } });
  assert.equal((await f.store.emptyTrash(tasks)).ok, false);
});
await test("partial overdue cleanup reports saved count and failure", async () => {
  const store = { userId: "own", rows: { tasks: [{ id: "a", due_date: "2026-10-08" }, { id: "b", due_date: "2026-10-08" }] }, deleteTask: async (id) => { if (id === "b") throw new Error("disk full"); } };
  assert.deepEqual(await clearOverdue(store, "2026-10-09", 600), { moved: 1, failed: true });
});
console.log(`${checks}/${checks} trash client checks passed`);
