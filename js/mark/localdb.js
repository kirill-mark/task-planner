// Локальная база одного аккаунта на одном устройстве.
//
// Имя базы включает владельца, поэтому данные разных аккаунтов в одном браузере
// физически разнесены: выход и вход другим пользователем не показывает чужие
// задачи и не смешивает очереди (A16).
//
// Хранилища:
//   sections, groups, tasks — последнее подтверждённое сервером состояние;
//   outbox — операции пользователя в порядке создания, ещё не подтверждённые
//            сверкой. Экран = подтверждённое состояние + очередь поверх;
//   meta   — курсор изменений и время последней успешной сверки.

const VERSION = 1;
export const ENTITY_STORES = { section: "sections", group: "groups", task: "tasks" };
const ALL_STORES = ["sections", "groups", "tasks", "outbox", "meta"];

function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function openLocalDb(name) {
  return new LocalDb(name, await openRaw(name));
}

function openRaw(name) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const store of ["sections", "groups", "tasks"]) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("outbox")) {
        // seq задаёт порядок отправки и не зависит от часов устройства
        db.createObjectStore("outbox", { keyPath: "seq", autoIncrement: true });
      }
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error(`local db ${name} is blocked by another tab`));
  });
}

export function deleteLocalDb(name) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

class LocalDb {
  constructor(name, db) {
    this.name = name;
    this.shut = false;
    this.adopt(db);
  }

  // Другая вкладка обновляет схему или удаляет базу: соединение уступает,
  // иначе та вкладка ждала бы вечно. Следующая операция откроет базу заново.
  adopt(db) {
    this.db = db;
    this.stale = false;
    db.onversionchange = () => { db.close(); this.stale = true; };
    db.onclose = () => { this.stale = true; };
  }

  async ready() {
    if (this.shut) throw new Error("local db is closed");
    if (this.stale) this.adopt(await openRaw(this.name));
  }

  close() {
    this.shut = true;
    this.db.close();
  }

  // Результат считается записанным только по oncomplete всей транзакции, а не по
  // успеху отдельного запроса: до этого момента браузер может её откатить.
  // strict просит дождаться сброса на диск там, где браузер это различает.
  async transact(stores, mode, fn) {
    await this.ready();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(stores, mode, { durability: "strict" });
      let result;
      Promise.resolve()
        .then(() => fn(tx))
        .then((r) => { result = r; })
        .catch((e) => { try { tx.abort(); } catch { /* уже завершена */ } reject(e); });
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("transaction aborted"));
    });
  }

  async loadAll() {
    return this.transact(ALL_STORES, "readonly", async (tx) => {
      const [sections, groups, tasks, outbox, meta] = await Promise.all(
        ALL_STORES.map((s) => promisify(tx.objectStore(s).getAll()))
      );
      return {
        sections, groups, tasks, outbox,
        meta: Object.fromEntries(meta.map((m) => [m.key, m.value])),
      };
    });
  }

  // Операция попадает в базу до того, как её увидит экран или сервер.
  appendOp(op) {
    return this.transact(["outbox"], "readwrite", async (tx) => {
      const seq = await promisify(tx.objectStore("outbox").add(op));
      return { ...op, seq };
    });
  }

  putOps(ops) {
    return this.transact(["outbox"], "readwrite", (tx) => {
      const store = tx.objectStore("outbox");
      for (const op of ops) store.put(op);
    });
  }

  deleteOps(seqs) {
    return this.transact(["outbox"], "readwrite", (tx) => {
      const store = tx.objectStore("outbox");
      for (const seq of seqs) store.delete(seq);
    });
  }

  // Ответ сервера накладывается одной транзакцией вместе с удалением операций,
  // которые он уже учёл: иначе между двумя шагами экран на мгновение показал бы
  // старое значение, а после сбоя посередине — потерял бы правку.
  applyServerState(state, { dropOpSeqs = [], meta = {} } = {}) {
    return this.transact(ALL_STORES, "readwrite", (tx) => {
      for (const [key, store] of [["sections", "sections"], ["groups", "groups"], ["tasks", "tasks"]]) {
        const os = tx.objectStore(store);
        if (state.full) os.clear();
        for (const row of state[key] || []) {
          if (row.deleted_at) os.delete(row.id);
          else os.put(row);
        }
      }
      const outbox = tx.objectStore("outbox");
      for (const seq of dropOpSeqs) outbox.delete(seq);
      const metaStore = tx.objectStore("meta");
      for (const [key, value] of Object.entries(meta)) metaStore.put({ key, value });
    });
  }
}
