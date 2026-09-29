// Быстрая проверка движка без сервера: поддельный сервер с той же семантикой
// ревизий, курсора, повторов и номера пересборки, что у mark_apply_operations
// и mark_get_state. Запуск в браузере со страницы стенда:
//   const { run } = await import('./engine-smoke.js'); await run()

import { SyncEngine } from "../js/mark/engine.js";
import { deleteLocalDb } from "../js/mark/localdb.js";

function fakeServer() {
  const srv = { seq: 0, epoch: 1, offline: false, rows: { task: new Map(), group: new Map(), section: new Map() }, ops: new Map() };
  const keyOf = { task: "tasks", group: "groups", section: "sections" };
  srv.transport = {
    async sendOps(ops) {
      if (srv.offline) return { kind: "offline" };
      return {
        kind: "ok",
        results: ops.map((op) => {
          if (srv.ops.has(op.operation_id)) return { ...srv.ops.get(op.operation_id), repeat: true };
          const m = srv.rows[op.entity];
          const cur = m.get(op.entity_id);
          let res;
          if (op.type === "create") {
            m.set(op.entity_id, { id: op.entity_id, ...op.changes, revision: 1, seq: ++srv.seq, deleted_at: null, created_at: new Date().toISOString() });
            res = { status: "applied", result: { revision: 1 } };
          } else if (!cur || (op.base_revision != null && op.base_revision !== cur.revision)) {
            res = { status: "conflict", result: { revision: cur?.revision, current: cur && { ...cur } } };
          } else if (op.type === "delete") {
            Object.assign(cur, { deleted_at: "x", revision: cur.revision + 1, seq: ++srv.seq });
            res = { status: "applied", result: { revision: cur.revision } };
          } else {
            Object.assign(cur, op.changes, { revision: cur.revision + 1, seq: ++srv.seq });
            res = { status: "applied", result: { revision: cur.revision } };
          }
          const r = { operation_id: op.operation_id, ...res };
          srv.ops.set(op.operation_id, r);
          return r;
        }),
      };
    },
    async getState(_uid, since) {
      if (srv.offline) return { kind: "offline" };
      const st = { cursor: srv.seq, full: since == null, epoch: srv.epoch, mode: "v2" };
      for (const [e, k] of Object.entries(keyOf)) {
        st[k] = [...srv.rows[e].values()].filter((r) => (since == null ? !r.deleted_at : r.seq > since)).map((r) => ({ ...r }));
      }
      return { kind: "ok", state: st };
    },
  };
  return srv;
}

export async function run() {
  const out = [];
  const ok = (n, c, d) => out.push(`${c ? "OK  " : "FAIL"} ${n}${d !== undefined ? " " + JSON.stringify(d) : ""}`);
  const open = (srv, name) => new SyncEngine({ userId: "u", transport: srv.transport, dbName: name }).open();

  // --- очередь, переоткрытие, два устройства, конфликт одного поля ---
  {
    const srv = fakeServer();
    await deleteLocalDb("smoke:A"); await deleteLocalDb("smoke:B");
    let A = await open(srv, "smoke:A");
    await A.sync();
    const g = await A.createGroup({ name: "g" });
    const x = await A.createTask({ title: "x", group_id: g });
    await A.sync();
    ok("синхронизировано после создания", A.status().state === "synced" && A.outbox.length === 0);
    srv.offline = true;
    const n = await A.createTask({ title: "n", group_id: g });
    await A.updateTask(x, { title: "x2" }); await A.completeTask(x); await A.updateTask(n, { notes: "nn" });
    await A.sync();
    ok("без сети: статус offline, 4 операции", A.status().state === "offline" && A.outbox.length === 4, A.outbox.map((o) => [o.type, o.base_revision]));
    ok("у ещё не отправленной задачи есть created_at", !!A.view.tasks.find((t) => t.id === n)?.created_at);
    A.close();
    A = await open(srv, "smoke:A");
    ok("очередь пережила переоткрытие", A.outbox.length === 4);
    srv.offline = false;
    await A.sync(); await A.sync();
    ok("применено без конфликтов", A.outbox.length === 0 && A.status().state === "synced");
    ok("ревизии на сервере: x=3, n=2", srv.rows.task.get(x).revision === 3 && srv.rows.task.get(n).revision === 2);
    const B = await open(srv, "smoke:B");
    await B.sync();
    await Promise.all([A.updateTask(x, { title: "fromA" }), B.updateTask(n, { title: "fromB" })]);
    await Promise.all([A.sync(), B.sync()]); await Promise.all([A.sync(), B.sync()]);
    const sig = (e) => JSON.stringify(e.view.tasks.map((t) => [t.id, t.title, t.revision]));
    ok("разные задачи с двух устройств сходятся", sig(A) === sig(B));
    await A.updateTask(x, { title: "A?" }); await B.updateTask(x, { title: "B?" });
    await A.sync(); await B.sync();
    ok("одно поле с двух устройств — конфликт у второго, первое не затёрто", B.status().state === "conflict" && srv.rows.task.get(x).title === "A?");
    await B.discardOp(B.status().conflicts[0].seq); await B.sync();
    ok("«взять с сервера» снимает конфликт", B.status().state === "synced" && B.view.tasks.find((t) => t.id === x).title === "A?");
    A.close(); B.close();
  }

  // --- пересборка данных аккаунта на сервере ---
  {
    const srv = fakeServer();
    await deleteLocalDb("smoke:R");
    const A = await open(srv, "smoke:R");
    await A.sync();
    const x = await A.createTask({ title: "x" });
    const y = await A.createTask({ title: "y" });
    await A.updateTask(x, { title: "x2" });
    await A.sync();
    ok("сохранён номер сборки", A.meta.epoch === 1);
    srv.rows.task.delete(y); // пересборка: строка исчезла без пометки об удалении
    srv.rows.task.set(x, { ...srv.rows.task.get(x), revision: 1, seq: ++srv.seq, title: "x-rebuilt" });
    srv.epoch = 2;
    srv.offline = true; await A.updateTask(x, { notes: "offline edit" }); srv.offline = false;
    await A.sync();
    ok("после пересборки взят полный снимок: исчезнувшей строки нет", !A.view.tasks.some((t) => t.id === y));
    ok("номер сборки обновлён", A.meta.epoch === 2);
    ok("правка от прежней версии — конфликт, серверное значение цело",
      A.status().state === "conflict" && srv.rows.task.get(x).notes !== "offline edit");
    ok("конфликт несёт серверную версию", A.status().conflicts[0]?.result?.current?.title === "x-rebuilt");
    await A.reapplyOp(A.status().conflicts[0].seq); await A.sync(); await A.sync();
    ok("«оставить моё» применяет правку поверх актуальной версии",
      srv.rows.task.get(x).notes === "offline edit" && srv.rows.task.get(x).title === "x-rebuilt" && A.status().state === "synced");
    ok("модель аккаунта видна в статусе", A.status().mode === "v2");
    A.close();
  }

  // --- другая вкладка удаляет или обновляет базу ---
  {
    const srv = fakeServer();
    await deleteLocalDb("smoke:V");
    const A = await open(srv, "smoke:V");
    await A.sync();
    await A.createTask({ title: "before" });
    await A.sync();
    const t0 = Date.now();
    await deleteLocalDb("smoke:V"); // уступили соединение — не зависло
    ok("чужое удаление базы не зависает", Date.now() - t0 < 2000);
    await A.createTask({ title: "after" });
    await A.sync();
    ok("после этого движок сам переоткрыл базу и работает", A.status().state === "synced" && srv.rows.task.size === 2);
    A.close();
  }

  for (const n of ["smoke:A", "smoke:B", "smoke:R", "smoke:V"]) await deleteLocalDb(n);
  return out.join("\n");
}
