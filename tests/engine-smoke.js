// Быстрая проверка движка без сервера: поддельный сервер с той же семантикой
// ревизий, курсора, повторов и номера пересборки, что у mark_apply_operations
// и mark_get_state. Запуск в браузере со страницы стенда:
//   const { run } = await import('./engine-smoke.js'); await run()

import { SyncEngine } from "../js/mark/engine.js";
import { deleteLocalDb } from "../js/mark/localdb.js";
import { clearOverdue } from "../js/ui/clear-overdue.js";

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

  // Bulk cleanup must use the full account, survive an offline restart,
  // and leave completed, undated and future-deadline tasks intact.
  {
    const srv = fakeServer();
    await deleteLocalDb("smoke:cleanup");
    const tasks = [
      { id: "late", due_date: "2026-10-08" },
      { id: "missed", planned_date: "2026-10-08" },
      { id: "pastTime", due_date: "2026-10-09", due_time: "09:00" },
      { id: "done", due_date: "2026-10-08", completed: true },
      { id: "future", planned_date: "2026-10-08", due_date: "2026-10-10" },
      { id: "undated" },
      { id: "later", due_date: "2026-10-09", due_time: "18:00" },
    ];
    for (const t of tasks) srv.rows.task.set(t.id, { title: t.id, completed: false, ...t, revision: 1, seq: ++srv.seq, deleted_at: null });
    let A = await open(srv, "smoke:cleanup");
    await A.sync();
    srv.offline = true;
    const adapter = { userId: "u", get rows() { return A.view; }, deleteTask: (id) => A.deleteTask(id) };
    const result = await clearOverdue(adapter, "2026-10-09", 600);
    await A.sync();
    ok("массовая очистка убрала только две задачи с прошедшим сроком; пропущенный план — нет", result.moved === 2 && !result.failed && A.view.tasks.length === 5);
    A.close();
    A = await open(srv, "smoke:cleanup");
    ok("массовая очистка без сети переживает переоткрытие", A.outbox.length === 2 && A.view.tasks.length === 5);
    srv.offline = false;
    await A.sync(); await A.sync();
    ok("очистка синхронизирует мягкое удаление и сохраняет остальные задачи", A.outbox.length === 0 && ["late", "pastTime"].every((id) => srv.rows.task.get(id).deleted_at) && ["missed", "done", "future", "undated", "later"].every((id) => !srv.rows.task.get(id).deleted_at));
    A.close();
  }

  // --- предложения помощника (пакет A ТЗ v1.1: T02–T05, статусы) ---
  {
    const uid = () => crypto.randomUUID();
    const proposal = (actions) => ({ proposal_id: uid(), actions: actions.map((a) => ({ action_id: uid(), operation_id: uid(), entity: "task", ...a })) });
    const srv = fakeServer();
    for (const id of ["P1", "P2"]) await deleteLocalDb(id === "P1" ? "smoke:P" : "smoke:P2");
    let A = await open(srv, "smoke:P");
    await A.sync();

    // AI01: возврат — только после записи на устройство
    const p1 = proposal([{ type: "create", entity_id: uid(), changes: { title: "Смета" } }, { type: "create", entity_id: uid(), changes: { title: "Звонок" } }]);
    srv.offline = true;
    await A.applyProposal(p1);
    const peek = await open(srv, "smoke:P"); // второй экземпляр видит записанное
    ok("AI01: после ожидания весь набор уже в очереди на устройстве", peek.outbox.length === 2 && peek.proposals.has(p1.proposal_id));
    peek.close();
    ok("без сети предложение — «ждёт отправки», не «применено»", A.proposalStatus(p1.proposal_id).state === "queued");

    // T02: двойное подтверждение одного набора
    await Promise.all([A.applyProposal(p1), A.applyProposal(p1)]);
    ok("T02: двойное подтверждение не удваивает операции", A.outbox.length === 2);

    // T03: закрыть приложение после сохранения — после открытия набор на месте, повтор не пишет копий
    A.close();
    A = await open(srv, "smoke:P");
    const again = await A.applyProposal(p1);
    ok("T03: после перезапуска предложение восстановлено, повтор — без копий", again.repeat && A.outbox.length === 2);
    srv.offline = false;
    await A.sync(); await A.sync();
    ok("после связи — «применено», задач ровно две", A.proposalStatus(p1.proposal_id).state === "applied" && srv.rows.task.size === 2);
    A.close();
    A = await open(srv, "smoke:P");
    ok("итог «применено» переживает уход операций из очереди и перезапуск", A.outbox.length === 0 && A.proposalStatus(p1.proposal_id).state === "applied");

    // T04: отказ записи на устройстве — нет ложного успеха, повтор возможен
    const p2 = proposal([{ type: "create", entity_id: uid(), changes: { title: "Тренировка" } }]);
    const real = A.db.appendProposal.bind(A.db);
    A.db.appendProposal = async () => { throw new Error("QuotaExceededError"); };
    let threw = false;
    try { await A.applyProposal(p2); } catch { threw = true; }
    ok("T04: отказ хранилища — ошибка, а не успех; ничего не записано", threw && A.outbox.length === 0 && !A.proposalStatus(p2.proposal_id));
    A.db.appendProposal = real;
    await A.applyProposal(p2); await A.sync(); await A.sync();
    ok("T04: повтор после отказа применяет один раз", A.proposalStatus(p2.proposal_id).state === "applied" && srv.rows.task.size === 3);

    // T05: ответ сервера потерян после записи — повтор с теми же ID без второй записи
    const p3 = proposal([{ type: "create", entity_id: uid(), changes: { title: "Отчёт" } }]);
    const send = srv.transport.sendOps;
    srv.transport.sendOps = async (ops, source) => { await send(ops, source); return { kind: "retry", message: "lost" }; };
    await A.applyProposal(p3); await A.sync();
    ok("T05: пока ответ не дошёл — не «применено»", A.proposalStatus(p3.proposal_id).state !== "applied" && srv.rows.task.size === 4);
    srv.transport.sendOps = send;
    await A.sync(); await A.sync();
    ok("T05: повтор узнан сервером, задача одна, итог «применено»", A.proposalStatus(p3.proposal_id).state === "applied" && srv.rows.task.size === 4);

    // T06 и частичный итог: одну из задач успели изменить на другом устройстве
    const [t1, t2] = [...srv.rows.task.values()].slice(0, 2);
    srv.rows.task.set(t2.id, { ...t2, title: "чужая правка", revision: t2.revision + 1, seq: ++srv.seq });
    const p4 = proposal([
      { type: "update", entity_id: t1.id, base_revision: t1.revision, changes: { notes: "a" } },
      { type: "update", entity_id: t2.id, base_revision: t2.revision, changes: { notes: "b" } },
    ]);
    await A.applyProposal(p4); await A.sync();
    const st4 = A.proposalStatus(p4.proposal_id);
    ok("T06: конфликт виден у нужной задачи, чужая правка не затёрта", st4.state === "conflict" && st4.applied === 1
      && st4.actions.find((x) => x.entity_id === t2.id).status === "conflict" && srv.rows.task.get(t2.id).title === "чужая правка");
    await A.discardOp(A.status().conflicts[0].seq); await A.sync();
    ok("отказ от конфликтной правки — частичный итог «1 из 2», не «применено»", A.proposalStatus(p4.proposal_id).state === "partial");
    A.close();
    await deleteLocalDb("smoke:P");
  }

  // «Отменить» после добавления (решение владельца 30.10): удерживаемое создание
  // не уходит на сервер, отмена убирает его без следа; без отмены — уходит.
  {
    const srv = fakeServer();
    let H = await open(srv, "smoke:H");
    const kept = await H.createTask({ title: "Купить корм коту" }, { holdMs: 300 });
    const gone = await H.createTask({ title: "Ошибочная задача" }, { holdMs: 300 });
    await H.sync();
    ok("удержание: пока доступна отмена, на сервер ничего не ушло", srv.rows.task.size === 0 && H.view.tasks.length === 2);
    ok("удержание: отмена убирает задачу без следа", await H.cancelHeld(gone) && H.view.tasks.length === 1 && !H.outbox.some((o) => o.entity_id === gone));
    H.close();
    H = await open(srv, "smoke:H");
    await new Promise((r) => setTimeout(r, 350));
    await H.sync();
    ok("удержание: после перезапуска и конца удержания задача на сервере, отменённой нет",
      srv.rows.task.size === 1 && srv.rows.task.has(kept) && !srv.rows.task.has(gone));
    ok("удержание: после отправки отмена без следа уже невозможна", !(await H.cancelHeld(kept)));
    H.close();
    await deleteLocalDb("smoke:H");
  }

  for (const n of ["smoke:A", "smoke:B", "smoke:R", "smoke:V", "smoke:cleanup"]) await deleteLocalDb(n);
  return out.join("\n");
}
