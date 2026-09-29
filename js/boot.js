// Какой интерфейс загрузить. Аккаунты живут в новой модели, и для них —
// интерфейс этапа 2 (js/ui). Прежний интерфейс (js/app.js) нужен только
// аккаунту, откаченному на planner_state: по разделу 13 ТЗ при откате должна
// оставаться совместимая версия интерфейса. Режим известен из прошлого входа;
// новый интерфейс сам проверяет его на сервере и перезагружает страницу, если
// аккаунт откатили.

import { getSession } from "./sync.js?v=13";

function remembered(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}

// Тема — до первой отрисовки, чтобы не мигало.
document.documentElement.dataset.theme = remembered("mark:theme", "system");

const session = await getSession();
const mode = session ? remembered("mark:mode:" + session.user.id, "v2") : "v2";

if (mode === "legacy") {
  document.getElementById("app-css")?.setAttribute("href", "css/style.css?v=13");
  document.documentElement.removeAttribute("data-theme");
  await import("./app.js?v=13");
} else {
  await import("./ui/app.js");
}
