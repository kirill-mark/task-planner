// deno test supabase/functions/_shared/planner_test.ts
// Поддельный клиент базы: проверяется, какие операции уходят из бота и что
// ошибки не превращаются в пустой планировщик.

import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { loadPlanner, savePlanner } from "./planner.ts";

type Call = { rpc?: string; args?: any; upsert?: any };

function fakeDb(opts: { mode?: string | null; modeError?: boolean; legacy?: any; legacyError?: boolean; v2?: any; applyResult?: (ops: any[]) => any }) {
  const calls: Call[] = [];
  const db: any = {
    calls,
    from(table: string) {
      const q: any = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => {
          if (table === "mark_account_mode") {
            return opts.modeError ? { data: null, error: { message: "boom" } } : { data: opts.mode ? { mode: opts.mode } : null, error: null };
          }
          if (table === "planner_state") {
            return opts.legacyError ? { data: null, error: { message: "timeout" } } : { data: opts.legacy ? { data: opts.legacy } : null, error: null };
          }
          throw new Error("unexpected table " + table);
        },
        upsert: async (row: any) => { calls.push({ upsert: row }); return { error: null }; },
      };
      return q;
    },
    async rpc(name: string, args: any) {
      calls.push({ rpc: name, args });
      if (name === "mark_get_state") return { data: structuredClone(opts.v2), error: null };
      if (name === "mark_apply_operations") {
        const results = opts.applyResult
          ? opts.applyResult(args.p_ops)
          : args.p_ops.map((o: any) => ({ operation_id: o.operation_id, status: "applied", result: { revision: (o.base_revision ?? 0) + 1 } }));
        return { data: { results }, error: null };
      }
      throw new Error("unexpected rpc " + name);
    },
  };
  return db;
}

const V2 = {
  cursor: 10, epoch: 1, mode: "v2", full: true,
  sections: [{ id: "general", name: "Общее", color: "#7d8ca3", position: 0, revision: 1 }],
  groups: [{ id: "work", name: "Работа", color: "#5b8def", section_id: "general", position: 0, revision: 4 }],
  tasks: [
    { id: "t1", title: "Отчёт", notes: "", group_id: "work", planned_date: null, planned_time: null, due_date: "2026-10-01", due_time: "18:00:00", timezone: "Europe/Moscow", completed: false, created_at: "2026-09-01T10:00:00Z", revision: 3, position: 0 },
    { id: "t2", title: "Звонок", notes: "маме", group_id: "work", planned_date: "2026-09-30", planned_time: null, due_date: null, due_time: null, timezone: null, completed: false, created_at: "2026-09-02T10:00:00Z", revision: 1, position: 1 },
  ],
};

const opsOf = (db: any) => db.calls.filter((c: Call) => c.rpc === "mark_apply_operations").flatMap((c: Call) => c.args.p_ops);

Deno.test("legacy: ошибка чтения бросается, а не даёт пустой планировщик", async () => {
  const db = fakeDb({ mode: null, legacyError: true });
  await assertRejects(() => loadPlanner(db, "u"), Error, "не удалось прочитать");
});

Deno.test("ошибка чтения модели аккаунта бросается", async () => {
  const db = fakeDb({ modeError: true });
  await assertRejects(() => loadPlanner(db, "u"), Error, "модель аккаунта");
});

Deno.test("legacy: чтение и запись целиком, как раньше", async () => {
  const db = fakeDb({ mode: "legacy", legacy: { sections: [], groups: [], tasks: [{ id: "a", title: "x" }] } });
  const st = await loadPlanner(db, "u");
  st.tasks.push({ id: "b", title: "y" });
  await savePlanner(db, "u", st);
  assertEquals(db.calls.length, 1);
  assertEquals(db.calls[0].upsert.data.tasks.length, 2);
});

Deno.test("v2: чтение в прежней форме задачи", async () => {
  const db = fakeDb({ mode: "v2", v2: V2 });
  const st = await loadPlanner(db, "u", "Europe/Moscow");
  assertEquals(st.tasks[0], { id: "t1", title: "Отчёт", notes: "", date: "2026-10-01", time: "18:00", dateMode: "due", groupId: "work", completed: false, createdAt: Date.parse("2026-09-01T10:00:00Z") });
  assertEquals(st.tasks[1].dateMode, "on");
  assertEquals(st.groups[0].sectionId, "general");
});

Deno.test("v2: без изменений — ни одной операции", async () => {
  const db = fakeDb({ mode: "v2", v2: V2 });
  const st = await loadPlanner(db, "u", "Europe/Moscow");
  await savePlanner(db, "u", st);
  assertEquals(opsOf(db).length, 0);
});

Deno.test("v2: добавление, выполнение, удаление — только изменённые поля и прочитанные версии", async () => {
  const db = fakeDb({ mode: "v2", v2: V2 });
  const st = await loadPlanner(db, "u", "Europe/Moscow");
  st.tasks.push({ id: "n1", title: "Новая", notes: "", date: "2026-10-02", time: "09:30", dateMode: "on", groupId: "work", completed: false, createdAt: Date.now() });
  st.tasks.find((t: any) => t.id === "t1").completed = true;
  st.tasks = st.tasks.filter((t: any) => t.id !== "t2");
  await savePlanner(db, "u", st);
  const ops = opsOf(db);
  assertEquals(ops.map((o: any) => [o.entity, o.type, o.entity_id, o.base_revision]), [
    ["task", "update", "t1", 3],
    ["task", "create", "n1", null],
    ["task", "delete", "t2", 1],
  ]);
  assertEquals(ops[0].changes, { completed: true });
  assertEquals(ops[1].changes, { title: "Новая", notes: "", group_id: "work", completed: false, planned_date: "2026-10-02", planned_time: "09:30", due_date: null, due_time: null, timezone: "Europe/Moscow" });
  assert(new Set(ops.map((o: any) => o.operation_id)).size === 3);
});

Deno.test("v2: смена «до» на «на» переносит дату и время, пояс — вместе с ними", async () => {
  const db = fakeDb({ mode: "v2", v2: V2 });
  const st = await loadPlanner(db, "u", "Europe/Moscow");
  const t = st.tasks.find((t: any) => t.id === "t1");
  t.dateMode = "on";
  await savePlanner(db, "u", st);
  assertEquals(opsOf(db)[0].changes, { planned_date: "2026-10-01", planned_time: "18:00", due_date: null, due_time: null, timezone: "Europe/Moscow" });
});

Deno.test("v2: конфликт бросается — бот не скажет «готово» на непринятую правку", async () => {
  const db = fakeDb({
    mode: "v2", v2: V2,
    applyResult: (ops) => ops.map((o: any) => ({ operation_id: o.operation_id, status: "conflict", result: { revision: 9 } })),
  });
  const st = await loadPlanner(db, "u");
  st.tasks[0].title = "Отчёт v2";
  await assertRejects(() => savePlanner(db, "u", st), Error, "изменили в другом месте");
});

Deno.test("v2: второе сохранение считает разницу от уже записанного и с новой версией", async () => {
  const db = fakeDb({ mode: "v2", v2: V2 });
  const st = await loadPlanner(db, "u");
  st.tasks[0].title = "A";
  await savePlanner(db, "u", st);
  st.tasks[0].notes = "B";
  await savePlanner(db, "u", st);
  const ops = opsOf(db);
  assertEquals(ops.length, 2);
  assertEquals(ops[1].changes, { notes: "B" });
  assertEquals(ops[1].base_revision, 4);
});

Deno.test("v2: новый раздел и группа создаются раньше задачи в них", async () => {
  const db = fakeDb({ mode: "v2", v2: { ...V2, sections: [], groups: [], tasks: [] } });
  const st = await loadPlanner(db, "u");
  st.sections.push({ id: "s", name: "Общее", color: "#7d8ca3" });
  st.groups.push({ id: "g", name: "Входящие", color: "#16a34a", sectionId: "s" });
  st.tasks.push({ id: "t", title: "x", notes: "", date: "", time: "", dateMode: "due", groupId: "g", completed: false, createdAt: 0 });
  await savePlanner(db, "u", st);
  assertEquals(opsOf(db).map((o: any) => `${o.entity}:${o.type}`), ["section:create", "group:create", "task:create"]);
  assertEquals(opsOf(db)[2].changes.due_date, null);
});
