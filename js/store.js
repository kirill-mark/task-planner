// Какое хранилище получает интерфейс: прежнее (planner_state целиком) или новая
// модель с локальной очередью. Пока каналы не переключены вместе, новая модель
// включается только явно на конкретном устройстве: ?model=v2, выключается
// ?model=v1. По умолчанию — прежнее.

import { store as legacyStore } from "./state.js?v=13";
import { supabase } from "./sync.js?v=13";
import { ModelStore } from "./mark/store.js";

const FLAG = "mark:data-model";

function chosenModel() {
  try {
    const fromUrl = new URLSearchParams(location.search).get("model");
    if (fromUrl === "v2" || fromUrl === "v1") localStorage.setItem(FLAG, fromUrl);
    return localStorage.getItem(FLAG) === "v2" ? "v2" : "v1";
  } catch {
    return "v1";
  }
}

export const dataModel = chosenModel();

export const store = dataModel === "v2"
  ? new ModelStore({ supabase, source: window.Telegram?.WebApp?.initData ? "miniapp" : "web" })
  : legacyStore;
