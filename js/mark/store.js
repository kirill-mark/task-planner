// Хранилище интерфейса поверх новой модели: тот же набор методов, что у
// прежнего store в state.js, но данные живут в IndexedDB и уходят на сервер
// операциями через очередь, а не целым JSON.
//
// Интерфейс пока работает со старой формой задачи (date, time, dateMode,
// groupId, sectionId, createdAt). Здесь она переводится в новую модель и
// обратно по тем же правилам, что и миграция: dateMode = on → плановая дата,
// иначе → дедлайн; пустая дата остаётся пустой.

import { SyncEngine } from "./engine.js";
import { createTransport } from "./transport.js";

const GROUP_COLORS = [
  "#5b8def", "#e0698e", "#3fb98c", "#f2a541",
  "#9b6bdb", "#4fb3bf", "#e05c5c", "#7d8ca3",
];

// Стартовая структура для аккаунта, у которого на сервере подтверждённо нет
// ни одного раздела. ID постоянные — как у прежних стартовых групп, — поэтому
// два устройства, заполнившие пустой аккаунт одновременно, не создадут копий.
const STARTER = {
  sections: [{ id: "general", name: "Общее", color: "#7d8ca3", position: 0 }],
  groups: [
    { id: "work", name: "Работа", color: "#5b8def", section_id: "general", position: 0 },
    { id: "personal", name: "Личное", color: "#e0698e", section_id: "general", position: 1 },
    { id: "study", name: "Учёба", color: "#3fb98c", section_id: "general", position: 2 },
  ],
};

const hhmm = (t) => (t ? String(t).slice(0, 5) : "");

function localTimezone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { return null; }
}

function toLegacyTask(t) {
  const on = !!t.planned_date;
  return {
    id: t.id,
    title: t.title,
    notes: t.notes || "",
    date: (on ? t.planned_date : t.due_date) || "",
    time: hhmm(on ? t.planned_time : t.due_time),
    dateMode: on ? "on" : "due",
    groupId: t.group_id,
    completed: !!t.completed,
    createdAt: Date.parse(t.created_at) || 0,
    pending: !!t._pending,
  };
}

// Даты задачи в новой модели из полей формы. Время без даты не отправляется:
// база его не примет, а хранить его молча ТЗ запрещает.
function datesFrom({ date, time, dateMode }) {
  const d = date || null;
  const tm = d && time ? time : null;
  const on = dateMode === "on";
  return {
    planned_date: on ? d : null,
    planned_time: on ? tm : null,
    due_date: on ? null : d,
    due_time: on ? null : tm,
    timezone: tm ? localTimezone() : null,
  };
}

// Операция несёт только то, что действительно изменилось.
function diff(current, next) {
  const out = {};
  for (const [k, v] of Object.entries(next)) {
    const cur = k.endsWith("_time") ? (current[k] ? hhmm(current[k]) : null) : current[k] ?? null;
    const val = k.endsWith("_time") ? (v ? hhmm(v) : null) : v ?? null;
    if (cur !== val) out[k] = v ?? null;
  }
  return out;
}

export class ModelStore {
  constructor({ supabase, source = "web" }) {
    this.supabase = supabase;
    this.source = source;
    this.userId = null;
    this.engine = null;
    this.rows = { sections: [], groups: [], tasks: [] };
    this.state = { sections: [], groups: [], tasks: [] };
    this.listeners = new Set();
    this.statusListeners = new Set();
    this.status = { state: "idle", message: "", lastSyncedAt: null, unconfirmed: 0 };
    this.channel = null;
    this.starterChecked = false;
    this.triggersInstalled = false;
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onStatus(fn) {
    this.statusListeners.add(fn);
    fn(this.status);
    return () => this.statusListeners.delete(fn);
  }

  setStatus(status) {
    this.status = status;
    this.statusListeners.forEach((fn) => fn(this.status));
  }

  // ------------------------------------------------------ жизненный цикл --

  async attachUser(userId) {
    if (this.userId === userId) return;
    this.detachUser();
    this.userId = userId;
    this.setStatus({ state: "loading", message: "", lastSyncedAt: null, unconfirmed: 0 });

    const transport = createTransport({
      getAccessToken: async () => (await this.supabase.auth.getSession()).data.session?.access_token || null,
    });
    const engine = new SyncEngine({ userId, transport, source: this.source });
    await engine.open();
    if (this.userId !== userId) { engine.close(); return; } // пользователь сменился за время открытия
    this.engine = engine;

    // Сначала своя локальная копия, затем сверка с сервером (раздел 12 ТЗ).
    engine.subscribe((view) => this.applyView(view));
    engine.onStatus((s) => this.onEngineStatus(s));

    // Подписка раньше первого чтения, и сверка после её установки: так
    // изменение, пришедшее между чтением и подпиской, не теряется.
    this.channel = this.supabase.channel(`mark_${userId}`);
    for (const table of ["mark_sections", "mark_groups", "mark_tasks"]) {
      this.channel.on("postgres_changes",
        { event: "*", schema: "public", table, filter: `user_id=eq.${userId}` },
        () => engine.sync("realtime"));
    }
    this.channel.subscribe((st) => { if (st === "SUBSCRIBED") engine.sync("subscribed"); });

    this.installTriggers();
    engine.sync("open");
  }

  detachUser() {
    if (this.channel) { this.supabase.removeChannel(this.channel); this.channel = null; }
    if (this.engine) { this.engine.close(); this.engine = null; }
    this.userId = null;
    this.starterChecked = false;
    this.signature = null;
    this.rows = { sections: [], groups: [], tasks: [] };
    this.state = { sections: [], groups: [], tasks: [] };
    this.setStatus({ state: "idle", message: "", lastSyncedAt: null, unconfirmed: 0 });
  }

  // Движок сам сверяется по возврату сети; здесь добавляются события
  // приложения, а сверка идёт в текущий движок, каким бы он ни был.
  installTriggers() {
    if (this.triggersInstalled) return;
    this.triggersInstalled = true;
    const run = (why) => this.engine?.sync(why);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") run("visible"); });
    globalThis.addEventListener("online", () => run("online"));
    globalThis.addEventListener("focus", () => run("focus"));
    this.supabase.auth.onAuthStateChange((event) => { if (event === "TOKEN_REFRESHED") run("token"); });
  }

  // Интерфейс перерисовывается целиком, и перерисовка стирает недописанный
  // текст в открытой форме. Поэтому слушатели зовутся только когда данные
  // действительно изменились, а не на каждую сверку.
  applyView(view) {
    this.rows = view;
    const next = {
      sections: view.sections.map((s) => ({ id: s.id, name: s.name, color: s.color })),
      groups: view.groups.map((g) => ({ id: g.id, name: g.name, color: g.color, sectionId: g.section_id })),
      tasks: view.tasks.map(toLegacyTask),
    };
    const signature = JSON.stringify(next);
    if (signature === this.signature) return;
    this.signature = signature;
    this.state = next;
    this.listeners.forEach((fn) => fn(this.state));
  }

  onEngineStatus(s) {
    this.setStatus({
      state: s.state,
      message: s.message,
      lastSyncedAt: s.lastSyncedAt,
      unconfirmed: s.unconfirmed,
      conflicts: s.conflicts,
      failed: s.failed,
      mode: s.mode,
    });
    if (s.state === "synced") this.ensureStarter();
    // Стартовую структуру уже создало другое устройство — это не конфликт
    // пользователя, а одно и то же намерение; принимается серверная версия.
    for (const op of s.conflicts || []) if (op.meta?.starter) this.engine?.discardOp(op.seq);
  }

  // Стартовая структура создаётся только при подтверждённо пустом аккаунте:
  // сверка прошла, очередь пуста, разделов нет ни на сервере, ни локально.
  // Ошибка чтения сюда не попадает никогда (D02).
  async ensureStarter() {
    if (this.starterChecked || !this.engine) return;
    this.starterChecked = true;
    const e = this.engine;
    if (e.outbox.length || e.confirmed.section.size || e.confirmed.group.size) return;
    for (const s of STARTER.sections) await e.enqueue("section", "create", s.id, { name: s.name, color: s.color, position: s.position }, { starter: true });
    for (const g of STARTER.groups) await e.enqueue("group", "create", g.id, { name: g.name, color: g.color, section_id: g.section_id, position: g.position }, { starter: true });
  }

  // --------------------------------------------------------------- задачи --

  nextPosition(list) {
    return list.reduce((m, r) => Math.max(m, r.position ?? 0), -1) + 1;
  }

  addTask({ title, notes, date, time, dateMode, groupId }) {
    if (!this.engine) return;
    this.engine.createTask({
      title: title.trim(),
      notes: (notes || "").trim(),
      group_id: groupId || null,
      ...datesFrom({ date, time, dateMode }),
      position: this.nextPosition(this.rows.tasks),
    });
  }

  toggleTask(id) {
    const t = this.rows.tasks.find((t) => t.id === id);
    if (t && this.engine) this.engine.completeTask(id, !t.completed);
  }

  deleteTask(id) {
    if (this.engine) this.engine.deleteTask(id);
  }

  updateTask(id, patch) {
    const t = this.rows.tasks.find((t) => t.id === id);
    if (!t || !this.engine) return;
    const legacy = toLegacyTask(t);
    const merged = { ...legacy, ...patch };
    const next = {
      ...("title" in patch ? { title: (patch.title || "").trim() } : {}),
      ...("notes" in patch ? { notes: patch.notes || "" } : {}),
      ...("groupId" in patch ? { group_id: patch.groupId || null } : {}),
      ...("completed" in patch ? { completed: !!patch.completed } : {}),
      ...(("date" in patch || "time" in patch || "dateMode" in patch) ? datesFrom(merged) : {}),
    };
    const changes = diff(t, next);
    // пояс меняется только вместе со временем, иначе это не правка пользователя
    if (!("planned_time" in changes || "due_time" in changes || "planned_date" in changes || "due_date" in changes)) delete changes.timezone;
    if (Object.keys(changes).length) this.engine.updateTask(id, changes);
  }

  // ---------------------------------------------------------------- группы --

  addGroup(name, sectionId) {
    if (!this.engine) return null;
    const id = crypto.randomUUID();
    const color = GROUP_COLORS[this.rows.groups.length % GROUP_COLORS.length];
    this.engine.createGroup({ id, name: name.trim(), color, section_id: sectionId || null, position: this.nextPosition(this.rows.groups) });
    return id;
  }

  // Как и прежде, группа удаляется вместе со своими задачами — задачи первыми,
  // чтобы ни в какой момент не осталось задач, ссылающихся на удалённую группу.
  async deleteGroup(id) {
    if (!this.engine) return;
    for (const t of this.rows.tasks.filter((t) => t.group_id === id)) await this.engine.deleteTask(t.id);
    await this.engine.deleteGroup(id);
  }

  updateGroup(id, { name, color }) {
    const g = this.rows.groups.find((g) => g.id === id);
    if (!g || !this.engine) return;
    const changes = diff(g, { ...(name ? { name: name.trim() } : {}), ...(color ? { color } : {}) });
    if (Object.keys(changes).length) this.engine.updateGroup(id, changes);
  }

  groupById(id) {
    return this.state.groups.find((g) => g.id === id);
  }

  // --------------------------------------------------------------- разделы --

  addSection(name) {
    if (!this.engine) return null;
    const id = crypto.randomUUID();
    const color = GROUP_COLORS[this.rows.sections.length % GROUP_COLORS.length];
    this.engine.createSection({ id, name: name.trim(), color, position: this.nextPosition(this.rows.sections) });
    return id;
  }

  async deleteSection(id) {
    if (!this.engine) return;
    const groups = this.rows.groups.filter((g) => g.section_id === id);
    for (const g of groups) await this.deleteGroup(g.id);
    await this.engine.deleteSection(id);
  }

  updateSection(id, { name, color }) {
    const s = this.rows.sections.find((s) => s.id === id);
    if (!s || !this.engine) return;
    const changes = diff(s, { ...(name ? { name: name.trim() } : {}), ...(color ? { color } : {}) });
    if (Object.keys(changes).length) this.engine.updateSection(id, changes);
  }

  sectionById(id) {
    return this.state.sections.find((s) => s.id === id);
  }

  // ------------------------------------------------------------ конфликты --

  discard(seq) { return this.engine?.discardOp(seq); }
  keepMine(seq) { return this.engine?.reapplyOp(seq); }
}
