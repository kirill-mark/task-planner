// Какое хранилище получает интерфейс, решает сервер: mark_account_mode. Веб,
// PWA, Mini App, бот и напоминания одного аккаунта обязаны работать с одной
// моделью, иначе задача из бота не появится на компьютере.
//
//   legacy — прежнее хранилище (planner_state целиком);
//   v2     — новая модель с локальной базой и очередью операций.
//
// Интерфейс видит один объект store; за ним — то хранилище, в котором живёт
// вошедший аккаунт. Смена модели во время работы (переключение или откат)
// перезагружает страницу: так ни одно хранилище не продолжает писать туда,
// куда уже нельзя.

import { store as legacyStore } from "./state.js?v=13";
import { supabase } from "./sync.js?v=13";
import { ModelStore } from "./mark/store.js";

const MODE_KEY = "mark:mode:";

const modelStore = new ModelStore({
  supabase,
  source: window.Telegram?.WebApp?.initData ? "miniapp" : "web",
});

function rememberedMode(userId) {
  try { return localStorage.getItem(MODE_KEY + userId); } catch { return null; }
}
function rememberMode(userId, mode) {
  try { localStorage.setItem(MODE_KEY + userId, mode); } catch { /* только память вкладки */ }
}

// null — сервер не ответил; решение тогда принимается по последнему известному.
// Нет записи — новая модель: все аккаунты переключены, новые создаются в ней,
// а legacy бывает только явным состоянием после отката.
async function serverMode(userId) {
  const { data, error } = await supabase.from("mark_account_mode").select("mode").eq("user_id", userId).maybeSingle();
  if (error) return null;
  return data?.mode === "legacy" ? "legacy" : "v2";
}

class StoreSwitch {
  constructor() {
    this.impl = legacyStore;
    this.mode = null;
    this.listeners = new Set();
    this.statusListeners = new Set();
    for (const s of [legacyStore, modelStore]) {
      s.subscribe((state) => { if (this.impl === s) this.listeners.forEach((fn) => fn(state)); });
      s.onStatus((st) => {
        if (this.impl !== s) return;
        this.statusListeners.forEach((fn) => fn(st));
        // запись упёрлась в модель аккаунта — значит, её сменили на сервере
        if (st.state === "error" || st.state === "failed" || (st.mode && st.mode !== this.mode)) this.recheckMode();
      });
    }
    const recheck = () => this.recheckMode();
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") recheck(); });
    globalThis.addEventListener("online", recheck);
  }

  get state() { return this.impl.state; }
  get userId() { return this.impl.userId; }
  get status() { return this.impl.status; }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onStatus(fn) {
    this.statusListeners.add(fn);
    fn(this.impl.status);
    return () => this.statusListeners.delete(fn);
  }

  async attachUser(userId) {
    this.attachingFor = userId;
    // Без ответа сервера — последняя известная модель этого аккаунта, иначе
    // новая: её очередь сама ничего не пишет, пока не сверится с сервером.
    const mode = (await serverMode(userId)) || rememberedMode(userId) || "v2";
    if (this.attachingFor !== userId) return;
    rememberMode(userId, mode);
    this.mode = mode;
    this.impl = mode === "v2" ? modelStore : legacyStore;
    this.statusListeners.forEach((fn) => fn(this.impl.status));
    await this.impl.attachUser(userId);
  }

  detachUser() {
    this.attachingFor = null;
    legacyStore.detachUser();
    modelStore.detachUser();
    this.impl = legacyStore;
    this.mode = null;
  }

  async recheckMode() {
    const userId = this.impl.userId;
    if (!userId || !this.mode || this.rechecking) return;
    this.rechecking = true;
    try {
      const mode = await serverMode(userId);
      if (mode && mode !== this.mode) {
        rememberMode(userId, mode);
        location.reload();
      }
    } finally {
      this.rechecking = false;
    }
  }

  addTask(...a) { return this.impl.addTask(...a); }
  toggleTask(...a) { return this.impl.toggleTask(...a); }
  deleteTask(...a) { return this.impl.deleteTask(...a); }
  updateTask(...a) { return this.impl.updateTask(...a); }
  addGroup(...a) { return this.impl.addGroup(...a); }
  deleteGroup(...a) { return this.impl.deleteGroup(...a); }
  updateGroup(...a) { return this.impl.updateGroup(...a); }
  groupById(...a) { return this.impl.groupById(...a); }
  addSection(...a) { return this.impl.addSection(...a); }
  deleteSection(...a) { return this.impl.deleteSection(...a); }
  updateSection(...a) { return this.impl.updateSection(...a); }
  sectionById(...a) { return this.impl.sectionById(...a); }
  keepMine(...a) { return this.impl.keepMine?.(...a); }
  discard(...a) { return this.impl.discard?.(...a); }
}

export const store = new StoreSwitch();
