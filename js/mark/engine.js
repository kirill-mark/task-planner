// Движок синхронизации: локальная очередь операций поверх подтверждённого
// сервером состояния (раздел 12 ТЗ).
//
// Порядок для каждой правки: операция надёжно записывается в IndexedDB, затем
// экран показывает результат, затем она уходит на сервер. Повторная отправка —
// всегда с тем же operation_id, поэтому закрытие вкладки посреди запроса или
// потерянный ответ не приводят ни к потере, ни к двойному применению (A13).
//
// Экран = подтверждённые строки + операции очереди, наложенные по порядку.
// Поэтому свежий снимок с сервера никогда не стирает неотправленную правку:
// она просто накладывается заново.

import { openLocalDb, ENTITY_STORES } from "./localdb.js";

const MAX_BATCH = 100;
const RETRY_MIN_MS = 2000;
const RETRY_MAX_MS = 60000;

// Состояния операции в очереди:
//   pending  — ждёт отправки (или ответ на отправку не дошёл);
//   applied  — сервер применил, ждёт сверки, после которой исчезнет;
//   conflict — сервер отказал из-за версии; ждёт решения пользователя;
//   rejected — сервер отказал окончательно (поля, доступ); ждёт решения.
// Операции того же объекта, стоящие за conflict/rejected, не отправляются: их
// base_revision рассчитан на то, что предыдущая правка прошла.
const LIVE = new Set(["pending", "applied"]);

const TASK_DEFAULTS = {
  group_id: null, title: "", notes: "", planned_date: null, planned_time: null,
  due_date: null, due_time: null, timezone: null, duration_minutes: null,
  priority: "normal", completed: false, completed_at: null, position: 0,
};
const GROUP_DEFAULTS = { section_id: null, name: "", color: "#5b8def", position: 0 };
const SECTION_DEFAULTS = { name: "", color: "#7d8ca3", position: 0 };
const DEFAULTS = { task: TASK_DEFAULTS, group: GROUP_DEFAULTS, section: SECTION_DEFAULTS };

function newId() {
  return crypto.randomUUID();
}

function byPosition(a, b) {
  return (a.position ?? 0) - (b.position ?? 0) || String(a.id).localeCompare(String(b.id));
}

export class SyncEngine {
  // dbName по умолчанию привязан к владельцу; тесты передают свой, чтобы
  // изобразить второе устройство того же аккаунта.
  constructor({ userId, transport, source = "web", dbName = `mark:${userId}` }) {
    if (!userId) throw new Error("userId is required");
    this.userId = userId;
    this.transport = transport;
    this.source = source;
    this.dbName = dbName;
    this.db = null;
    this.confirmed = { section: new Map(), group: new Map(), task: new Map() };
    this.outbox = [];
    this.meta = {};
    this.view = { sections: [], groups: [], tasks: [] };
    this.net = "unknown"; // unknown | ok | offline | auth | outdated | error
    this.netMessage = "";
    this.listeners = new Set();
    this.statusListeners = new Set();
    this.running = null;
    this.again = false;
    this.retryTimer = null;
    this.retryDelay = RETRY_MIN_MS;
    this.closed = false;
  }

  async open() {
    this.db = await openLocalDb(this.dbName);
    await this.reload();
    return this;
  }

  // Перечитывает базу целиком: нужно при открытии и когда её изменила другая
  // вкладка того же аккаунта.
  async reload() {
    const data = await this.db.loadAll();
    for (const [entity, store] of Object.entries(ENTITY_STORES)) {
      this.confirmed[entity] = new Map(data[store].map((r) => [r.id, r]));
    }
    this.outbox = data.outbox.sort((a, b) => a.seq - b.seq);
    this.meta = data.meta;
    this.recompute();
  }

  close() {
    this.closed = true;
    clearTimeout(this.retryTimer);
    if (this.db) this.db.close();
  }

  // ------------------------------------------------------------ подписки --

  subscribe(fn) {
    this.listeners.add(fn);
    fn(this.view);
    return () => this.listeners.delete(fn);
  }

  onStatus(fn) {
    this.statusListeners.add(fn);
    fn(this.status());
    return () => this.statusListeners.delete(fn);
  }

  notify() {
    this.listeners.forEach((fn) => fn(this.view));
    const s = this.status();
    this.statusListeners.forEach((fn) => fn(s));
  }

  // «Синхронизировано» — только когда очередь пуста и последняя сверка прошла,
  // а не когда просто есть интернет (раздел 12 ТЗ).
  status() {
    const held = this.heldSeqs();
    const unconfirmed = this.outbox.filter((o) => LIVE.has(o.state) && !held.has(o.seq)).length;
    const conflicts = this.outbox.filter((o) => o.state === "conflict");
    const failed = this.outbox.filter((o) => o.state === "rejected");
    let state;
    if (conflicts.length) state = "conflict";
    else if (failed.length) state = "failed";
    else if (this.net === "auth") state = "auth";
    else if (this.net === "outdated") state = "outdated";
    else if (this.net === "offline") state = "offline";
    else if (this.net === "error") state = "error";
    else if (unconfirmed > 0 || this.running) state = "saving";
    else if (this.net === "ok") state = "synced";
    else state = "loading";
    return {
      state,
      unconfirmed,
      conflicts,
      failed,
      message: this.netMessage,
      lastSyncedAt: this.meta.lastSyncedAt ?? null,
      cursor: this.meta.cursor ?? null,
    };
  }

  // ------------------------------------------------------------ экран --

  // Операции объекта, стоящие за conflict/rejected, придержаны.
  heldSeqs() {
    const blocked = new Set();
    const held = new Set();
    for (const op of this.outbox) {
      const key = `${op.entity}:${op.entity_id}`;
      if (blocked.has(key)) { held.add(op.seq); continue; }
      if (!LIVE.has(op.state)) blocked.add(key);
    }
    return held;
  }

  recompute() {
    const rows = {};
    for (const entity of Object.keys(ENTITY_STORES)) {
      rows[entity] = new Map([...this.confirmed[entity]].map(([id, r]) => [id, { ...r }]));
    }
    const held = this.heldSeqs();
    for (const op of this.outbox) {
      if (!LIVE.has(op.state) || held.has(op.seq)) continue;
      const map = rows[op.entity];
      const cur = map.get(op.entity_id);
      if (op.type === "delete") {
        map.delete(op.entity_id);
      } else if (op.type === "create") {
        map.set(op.entity_id, { ...DEFAULTS[op.entity], ...cur, ...op.changes, id: op.entity_id, _pending: true });
      } else if (cur) {
        const next = { ...cur, ...op.changes, _pending: true };
        if (op.entity === "task" && "completed" in op.changes) {
          next.completed_at = op.changes.completed ? (cur.completed_at || op.local_at) : null;
        }
        map.set(op.entity_id, next);
      }
      // правка объекта, которого уже нет на сервере, не воскрешает его на экране
    }
    this.view = {
      sections: [...rows.section.values()].sort(byPosition),
      groups: [...rows.group.values()].sort(byPosition),
      tasks: [...rows.task.values()].sort(byPosition),
    };
  }

  // ------------------------------------------------------------ правки --

  // Ревизия, от которой пользователь правил: подтверждённая плюс число его
  // собственных ещё не сверенных правок этого объекта — каждая поднимет её на 1.
  expectedRevision(entity, id) {
    let rev = this.confirmed[entity].get(id)?.revision ?? 0;
    for (const op of this.outbox) {
      if (op.entity === entity && op.entity_id === id && LIVE.has(op.state)) rev += 1;
    }
    return rev;
  }

  async enqueue(entity, type, entityId, changes = {}) {
    if (!ENTITY_STORES[entity]) throw new Error(`unknown entity ${entity}`);
    const op = {
      operation_id: newId(),
      entity,
      type,
      entity_id: entityId,
      base_revision: type === "create" ? null : this.expectedRevision(entity, entityId),
      changes,
      state: "pending",
      attempts: 0,
      // часы устройства — только для показа; порядок задаёт seq очереди
      local_at: new Date().toISOString(),
    };
    const saved = await this.db.appendOp(op);
    this.outbox.push(saved);
    this.recompute();
    this.notify();
    this.sync("edit");
    return saved;
  }

  // Новый объект получает постоянный id до первой отправки, поэтому повтор
  // создания не может породить копию.
  async createTask(fields) {
    const id = fields.id || newId();
    const { id: _ignored, ...changes } = fields;
    await this.enqueue("task", "create", id, changes);
    return id;
  }
  updateTask(id, changes) { return this.enqueue("task", "update", id, changes); }
  completeTask(id, completed = true) { return this.enqueue("task", "update", id, { completed }); }
  deleteTask(id) { return this.enqueue("task", "delete", id); }

  async createGroup(fields) {
    const id = fields.id || newId();
    const { id: _ignored, ...changes } = fields;
    await this.enqueue("group", "create", id, changes);
    return id;
  }
  updateGroup(id, changes) { return this.enqueue("group", "update", id, changes); }
  deleteGroup(id) { return this.enqueue("group", "delete", id); }

  async createSection(fields) {
    const id = fields.id || newId();
    const { id: _ignored, ...changes } = fields;
    await this.enqueue("section", "create", id, changes);
    return id;
  }
  updateSection(id, changes) { return this.enqueue("section", "update", id, changes); }
  deleteSection(id) { return this.enqueue("section", "delete", id); }

  // Конфликт и отказ не решаются молча: пользователь либо отказывается от своей
  // правки, либо повторяет её поверх актуальной версии — это новая операция.
  async discardOp(seq) {
    const op = this.outbox.find((o) => o.seq === seq);
    if (!op || LIVE.has(op.state)) return;
    const drop = [op.seq];
    // придержанные за ней правки того же объекта теряют основание вместе с ней
    for (const o of this.outbox) {
      if (o.seq > op.seq && o.entity === op.entity && o.entity_id === op.entity_id && o.state === "pending") drop.push(o.seq);
    }
    await this.db.deleteOps(drop);
    this.outbox = this.outbox.filter((o) => !drop.includes(o.seq));
    this.recompute();
    this.notify();
  }

  async reapplyOp(seq) {
    const op = this.outbox.find((o) => o.seq === seq);
    if (!op || op.state !== "conflict") return;
    await this.db.deleteOps([op.seq]);
    this.outbox = this.outbox.filter((o) => o.seq !== op.seq);
    await this.enqueue(op.entity, op.type, op.entity_id, op.changes);
  }

  // ------------------------------------------------------------ сверка --

  // Одна сверка за раз. Запросы, пришедшие во время работы, склеиваются в
  // один следующий проход. Между вкладками одного аккаунта — блокировка Web
  // Locks, чтобы две вкладки не сверялись одновременно.
  sync(reason = "manual") {
    if (this.closed) return Promise.resolve(this.status());
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.again = false;
          await this.withCrossTabLock(() => this.syncOnce(reason));
        } while (this.again && !this.closed);
      } finally {
        this.running = null;
        this.notify();
      }
      return this.status();
    })();
    this.notify();
    return this.running;
  }

  async withCrossTabLock(fn) {
    if (globalThis.navigator?.locks) {
      return navigator.locks.request(`${this.dbName}:sync`, async () => {
        await this.reload(); // другая вкладка могла успеть сверить очередь
        return fn();
      });
    }
    return fn();
  }

  async syncOnce() {
    clearTimeout(this.retryTimer);
    // Сначала отправка, потом чтение: иначе прочитанное состояние уже включало
    // бы применённые, но ещё не отмеченные операции, и новая правка получила бы
    // неверное основание.
    const flushed = await this.flush();
    if (flushed !== "ok") return this.scheduleRetry();
    const pulled = await this.pull();
    if (pulled !== "ok") return this.scheduleRetry();
    this.retryDelay = RETRY_MIN_MS;
    this.recompute();
    this.notify();
  }

  // Временный сбой сервера и окончательный отказ пакета оба показываются как
  // «Не удалось сохранить»; первый при этом продолжает повторяться сам.
  setNet(kind, message = "") {
    this.net = kind === "retry" || kind === "fatal" ? "error" : kind;
    this.netMessage = message;
  }

  async flush() {
    for (;;) {
      const held = this.heldSeqs();
      const batch = this.outbox.filter((o) => o.state === "pending" && !held.has(o.seq)).slice(0, MAX_BATCH);
      if (!batch.length) return "ok";

      const r = await this.transport.sendOps(
        batch.map(({ operation_id, entity, type, entity_id, base_revision, changes }) =>
          ({ operation_id, entity, type, entity_id, base_revision, changes })),
        this.source
      );
      if (r.kind !== "ok") {
        this.setNet(r.kind, r.message || "");
        const touched = batch.map((o) => ({ ...o, attempts: (o.attempts || 0) + 1 }));
        await this.db.putOps(touched);
        this.mergeOps(touched);
        this.notify();
        return r.kind;
      }

      const byId = new Map(r.results.map((x) => [x.operation_id, x]));
      const updated = [];
      for (const op of batch) {
        const res = byId.get(op.operation_id);
        if (!res) continue; // сервер не ответил по этой операции — повторится
        const state = res.status === "applied" ? "applied" : res.status === "conflict" ? "conflict" : "rejected";
        updated.push({ ...op, state, result: res.result ?? { reason: res.reason }, attempts: (op.attempts || 0) + 1 });
      }
      await this.db.putOps(updated);
      this.mergeOps(updated);
      this.setNet("ok");
      this.recompute();
      this.notify();
    }
  }

  mergeOps(ops) {
    const bySeq = new Map(ops.map((o) => [o.seq, o]));
    this.outbox = this.outbox.map((o) => bySeq.get(o.seq) || o);
  }

  async pull() {
    const since = this.meta.cursor ?? null;
    const r = await this.transport.getState(this.userId, since);
    if (r.kind !== "ok") {
      this.setNet(r.kind, r.message || "");
      return r.kind;
    }
    const state = r.state;
    // Применённые операции уже отражены в прочитанном состоянии: они уходят из
    // очереди той же транзакцией, в которой записываются строки.
    const dropOpSeqs = this.outbox.filter((o) => o.state === "applied").map((o) => o.seq);
    const meta = {
      cursor: Math.max(state.cursor, since ?? 0),
      lastSyncedAt: Date.now(),
      userId: this.userId,
    };
    await this.db.applyServerState(state, { dropOpSeqs, meta });

    for (const [entity, key] of [["section", "sections"], ["group", "groups"], ["task", "tasks"]]) {
      const map = this.confirmed[entity];
      if (state.full) map.clear();
      for (const row of state[key] || []) {
        if (row.deleted_at) map.delete(row.id);
        else map.set(row.id, row);
      }
    }
    this.outbox = this.outbox.filter((o) => !dropOpSeqs.includes(o.seq));
    this.meta = { ...this.meta, ...meta };
    this.setNet("ok");
    return "ok";
  }

  scheduleRetry() {
    if (this.closed) return;
    // Нужна повторная авторизация или новая версия — повторять вслепую нечего.
    if (this.net === "auth" || this.net === "outdated") return;
    clearTimeout(this.retryTimer);
    const delay = this.retryDelay;
    this.retryDelay = Math.min(this.retryDelay * 2, RETRY_MAX_MS);
    this.retryTimer = setTimeout(() => this.sync("retry"), delay);
  }

  // Сверка по событиям, которые Realtime не покрывает: возврат во вкладку,
  // восстановление сети, фокус. Вызывается приложением один раз.
  installTriggers() {
    const run = (why) => () => this.sync(why);
    const onVisible = () => { if (document.visibilityState === "visible") this.sync("visible"); };
    document.addEventListener("visibilitychange", onVisible);
    globalThis.addEventListener("online", run("online"));
    globalThis.addEventListener("focus", run("focus"));
  }
}
