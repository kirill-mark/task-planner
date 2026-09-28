import { loadState, saveState } from "./storage.js?v=12";
import { fetchRemoteState, pushRemoteState, subscribeRemote } from "./sync.js?v=12";

const GROUP_COLORS = [
  "#5b8def", "#e0698e", "#3fb98c", "#f2a541",
  "#9b6bdb", "#4fb3bf", "#e05c5c", "#7d8ca3",
];

const PUSH_DEBOUNCE_MS = 600;

class Store {
  constructor() {
    this.userId = null;
    this.state = { sections: [], groups: [], tasks: [], updatedAt: 0 };
    this.listeners = new Set();
    this.statusListeners = new Set();
    this.pushTimer = null;
    this.channel = null;
    // Until a read actually succeeds we must not write: a failed read used to be
    // indistinguishable from an empty account, and pushing over it could bury
    // real server data under a stale local copy.
    this.serverRead = false;
    this.pendingPush = false;
    this.status = { state: "idle", lastSyncedAt: null, message: "" };
    this.rechecking = false;
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

  setStatus(state, message = "") {
    this.status = {
      state,
      message,
      lastSyncedAt: state === "synced" ? Date.now() : this.status.lastSyncedAt,
    };
    this.statusListeners.forEach((fn) => fn(this.status));
  }

  emit() {
    this.state.updatedAt = Date.now();
    saveState(this.userId, this.state);
    this.listeners.forEach((fn) => fn(this.state));
    this.scheduleRemotePush();
  }

  // --- user session lifecycle ---
  async attachUser(userId) {
    this.userId = userId;
    this.state = loadState(userId);
    if (!this.state.updatedAt) this.state.updatedAt = 0;
    this.serverRead = false;
    this.pendingPush = false;
    this.listeners.forEach((fn) => fn(this.state));
    this.setStatus("loading");

    // Subscribe before the first read, then re-check: otherwise a change landing
    // between the read and the subscription is lost with nothing to notice it.
    this.channel = subscribeRemote(
      userId,
      (remoteState) => this.applyRemote(remoteState),
      (subStatus) => {
        if (subStatus === "SUBSCRIBED" && this.serverRead) this.recheck("realtime");
      }
    );

    await this.readFromServer(userId);
    this.installRecheckTriggers();
  }

  async readFromServer(userId) {
    const result = await fetchRemoteState(userId);
    if (this.userId !== userId) return; // user switched while awaiting

    if (result.status === "error") {
      this.setStatus("offline", "Не удалось получить данные с сервера");
      return;
    }
    this.serverRead = true;
    if (result.status === "ok") {
      this.applyRemote(result.state);
      this.setStatus("synced");
    } else {
      // Genuinely no row for this account: seeding it is safe.
      const pushed = await pushRemoteState(userId, this.state);
      this.setStatus(pushed.ok ? "synced" : "error", pushed.ok ? "" : pushed.message);
    }
    if (this.pendingPush) this.scheduleRemotePush();
  }

  // Covers the gaps Realtime does not: tab wake-up, network return, reconnect.
  installRecheckTriggers() {
    if (this.triggersInstalled) return;
    this.triggersInstalled = true;
    const recheck = () => this.recheck("wake");
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") recheck();
    });
    globalThis.addEventListener("online", recheck);
    globalThis.addEventListener("focus", recheck);
  }

  async recheck(reason) {
    if (!this.userId || this.rechecking) return;
    this.rechecking = true;
    try {
      const userId = this.userId;
      const result = await fetchRemoteState(userId);
      if (this.userId !== userId) return;
      if (result.status === "error") {
        this.setStatus("offline", "Нет связи с сервером");
        return;
      }
      this.serverRead = true;
      if (result.status === "ok") this.applyRemote(result.state);
      this.setStatus("synced");
      if (this.pendingPush) this.scheduleRemotePush();
      console.debug("sync: rechecked after", reason);
    } finally {
      this.rechecking = false;
    }
  }

  detachUser() {
    clearTimeout(this.pushTimer);
    if (this.channel) { this.channel.unsubscribe(); this.channel = null; }
    this.userId = null;
    this.serverRead = false;
    this.pendingPush = false;
    this.state = { sections: [], groups: [], tasks: [], updatedAt: 0 };
    this.setStatus("idle");
  }

  // --- remote sync ---
  scheduleRemotePush() {
    if (!this.userId) return;
    // Hold the write until we know what is on the server.
    if (!this.serverRead) {
      this.pendingPush = true;
      this.setStatus("pending", "Изменения сохранены локально");
      return;
    }
    clearTimeout(this.pushTimer);
    const userId = this.userId;
    this.setStatus("saving");
    this.pushTimer = setTimeout(async () => {
      const result = await pushRemoteState(userId, this.state);
      if (this.userId !== userId) return;
      this.pendingPush = !result.ok;
      this.setStatus(result.ok ? "synced" : "error", result.ok ? "" : result.message);
    }, PUSH_DEBOUNCE_MS);
  }

  applyRemote(remoteState) {
    if (!remoteState) return;
    if ((remoteState.updatedAt || 0) <= (this.state.updatedAt || 0)) return;
    this.state = remoteState;
    saveState(this.userId, this.state);
    this.listeners.forEach((fn) => fn(this.state));
  }

  // --- tasks ---
  addTask({ title, notes, date, time, dateMode, groupId }) {
    this.state.tasks.push({
      id: crypto.randomUUID(),
      title: title.trim(),
      notes: (notes || "").trim(),
      date,
      time: time || "",
      dateMode: dateMode === "on" ? "on" : "due", // 'due' = до даты, 'on' = на дату
      groupId,
      completed: false,
      createdAt: Date.now(),
    });
    this.emit();
  }

  toggleTask(id) {
    const t = this.state.tasks.find((t) => t.id === id);
    if (t) t.completed = !t.completed;
    this.emit();
  }

  deleteTask(id) {
    this.state.tasks = this.state.tasks.filter((t) => t.id !== id);
    this.emit();
  }

  updateTask(id, patch) {
    const t = this.state.tasks.find((t) => t.id === id);
    if (t) Object.assign(t, patch);
    this.emit();
  }

  // --- groups ---
  addGroup(name, sectionId) {
    const id = crypto.randomUUID();
    const color = GROUP_COLORS[this.state.groups.length % GROUP_COLORS.length];
    this.state.groups.push({ id, name: name.trim(), color, sectionId });
    this.emit();
    return id;
  }

  deleteGroup(id) {
    this.state.groups = this.state.groups.filter((g) => g.id !== id);
    this.state.tasks = this.state.tasks.filter((t) => t.groupId !== id);
    this.emit();
  }

  updateGroup(id, { name, color }) {
    const g = this.state.groups.find((g) => g.id === id);
    if (g) {
      if (name) g.name = name.trim();
      if (color) g.color = color;
    }
    this.emit();
  }

  groupById(id) {
    return this.state.groups.find((g) => g.id === id);
  }

  // --- sections ---
  addSection(name) {
    const id = crypto.randomUUID();
    const color = GROUP_COLORS[this.state.sections.length % GROUP_COLORS.length];
    this.state.sections.push({ id, name: name.trim(), color });
    this.emit();
    return id;
  }

  deleteSection(id) {
    const groupIds = new Set(this.state.groups.filter((g) => g.sectionId === id).map((g) => g.id));
    this.state.sections = this.state.sections.filter((s) => s.id !== id);
    this.state.groups = this.state.groups.filter((g) => g.sectionId !== id);
    this.state.tasks = this.state.tasks.filter((t) => !groupIds.has(t.groupId));
    this.emit();
  }

  updateSection(id, { name, color }) {
    const s = this.state.sections.find((s) => s.id === id);
    if (s) {
      if (name) s.name = name.trim();
      if (color) s.color = color;
    }
    this.emit();
  }

  sectionById(id) {
    return this.state.sections.find((s) => s.id === id);
  }
}

export const store = new Store();
