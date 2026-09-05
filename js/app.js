import { store } from "./state.js";
import { hasSeenWelcome, markWelcomeSeen } from "./storage.js";
import {
  todayISO, addDays, weekDates, formatDayLabel, formatShort,
  weekDayName, isToday,
} from "./dates.js";
import {
  onAuthChange, signUp, signIn, signOut, updateDisplayName, updatePassword,
  fetchTelegramLink, createLinkCode, unlinkTelegram, subscribeTelegramLink,
  telegramMiniAppSignIn, getSession,
} from "./sync.js";

const ui = {
  view: "list",       // 'list' | 'week' | 'day' | 'profile'
  refDate: todayISO(),
  filter: { type: "all" }, // {type:'all'} | {type:'section', id} | {type:'group', id}
  editingGroupId: null,
  editingSectionId: null,
  editingTaskId: null,
  openForms: new Set(),
  showWelcome: false,
};

let session = null;
let authMode = "signin"; // 'signin' | 'signup'
let authError = "";
let authMessage = "";
let authBusy = false;
let profileNameMsg = "";
let profilePasswordMsg = "";
let telegramLink = null;      // { telegram_username, linked_at } | null
let telegramLinkChecked = false;
let telegramPendingCode = null; // { code, url } while waiting for user to open the bot
let tgAutoLoginDone = false;
let telegramChannel = null;

const root = document.getElementById("app");

function initials(text) {
  return (text || "?").trim().slice(0, 1).toUpperCase();
}

function displayNameOf(sess) {
  return sess.user.user_metadata?.display_name || sess.user.email;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function defaultGroupId() {
  if (ui.filter.type === "group") return ui.filter.id;
  if (ui.filter.type === "section") {
    const g = store.state.groups.find((g) => g.sectionId === ui.filter.id);
    if (g) return g.id;
  }
  return store.state.groups[0]?.id;
}

function groupOptions(selectedId) {
  return store.state.sections.map((sec) => {
    const opts = store.state.groups.filter((g) => g.sectionId === sec.id)
      .map((g) => `<option value="${g.id}" ${g.id === selectedId ? "selected" : ""}>${escapeHtml(g.name)}</option>`)
      .join("");
    return opts ? `<optgroup label="${escapeHtml(sec.name)}">${opts}</optgroup>` : "";
  }).join("");
}

function isGroupVisible(groupId) {
  if (ui.filter.type === "all") return true;
  const g = store.groupById(groupId);
  if (!g) return true;
  if (ui.filter.type === "section") return g.sectionId === ui.filter.id;
  if (ui.filter.type === "group") return g.id === ui.filter.id;
  return true;
}

function progressOf(tasks) {
  const total = tasks.length;
  const done = tasks.filter((t) => t.completed).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  return { total, done, pct };
}

function renderProgressBar(tasks, size = "") {
  const { total, done, pct } = progressOf(tasks);
  if (!total) return `<div class="progress-empty">нет задач</div>`;
  return `
    <div class="progress ${size}">
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
      <span class="progress-label">${done}/${total}</span>
    </div>`;
}

function byTimeThenCreated(a, b) {
  return (a.time || "").localeCompare(b.time || "") || a.createdAt - b.createdAt;
}

function taskGroup(task) {
  return store.groupById(task.groupId) || { name: "Без группы", color: "#7d8ca3" };
}

function renderTaskEditForm(task) {
  return `
    <li class="task editing" data-id="${task.id}">
      <form class="task-edit-form" data-action="save-task-form" data-id="${task.id}">
        <input type="text" name="title" value="${escapeHtml(task.title)}" required maxlength="200" autofocus />
        <input type="text" name="notes" value="${escapeHtml(task.notes || "")}" placeholder="Описание (необязательно)" maxlength="500" />
        <select name="groupId">${groupOptions(task.groupId)}</select>
        <div class="field-row">
          <label class="field-label">дедлайн</label>
          <input type="date" name="date" value="${task.date}" />
          <input type="time" name="time" value="${task.time || ""}" />
        </div>
        <div class="form-actions">
          <button type="submit">Сохранить</button>
          <button type="button" class="add-form-cancel" data-action="cancel-edit-task">Отмена</button>
        </div>
      </form>
    </li>`;
}

function renderTaskItem(task, { showGroupChip = true, showDate = false } = {}) {
  if (ui.editingTaskId === task.id) return renderTaskEditForm(task);
  const g = taskGroup(task);
  const overdue = !task.completed && task.date < todayISO();
  return `
    <li class="task ${task.completed ? "completed" : ""}" data-id="${task.id}">
      <button class="task-check" data-action="toggle-task" data-id="${task.id}" aria-label="Отметить выполненной">
        ${task.completed ? "✓" : ""}
      </button>
      <div class="task-body">
        <div class="task-title">${escapeHtml(task.title)}${task.time ? `<span class="task-time">${task.time}</span>` : ""}</div>
        ${task.notes ? `<div class="task-notes">${escapeHtml(task.notes)}</div>` : ""}
        <div class="task-meta">
          ${showGroupChip ? `<span class="chip" style="--chip-color:${g.color}">${escapeHtml(g.name)}</span>` : ""}
          ${showDate ? `<span class="task-date ${overdue ? "overdue" : ""}">до ${formatShort(task.date)}${task.time ? `, ${task.time}` : ""}</span>` : ""}
        </div>
      </div>
      <button class="task-edit" data-action="edit-task" data-id="${task.id}" aria-label="Редактировать">✎</button>
      <button class="task-delete" data-action="delete-task" data-id="${task.id}" aria-label="Удалить">✕</button>
    </li>`;
}

function renderTaskList(tasks, opts) {
  if (!tasks.length) return `<p class="empty-hint">Пусто. Добавь задачу ниже.</p>`;
  return `<ul class="task-list">${tasks.map((t) => renderTaskItem(t, opts)).join("")}</ul>`;
}

function renderAddForm(defaultDate, formId) {
  if (!ui.openForms.has(formId)) {
    return `
      <button type="button" class="add-form-trigger" data-action="open-add-form" data-form="${formId}">
        + Добавить задачу
      </button>`;
  }
  return `
    <form class="add-form" data-action="add-task-form" id="${formId}" data-date="${defaultDate}">
      <input type="text" name="title" placeholder="Новая задача…" required maxlength="200" autofocus />
      <input type="text" name="notes" placeholder="Описание (необязательно)" maxlength="500" />
      <select name="groupId">${groupOptions(defaultGroupId())}</select>
      <div class="field-row">
        <label class="field-label" for="${formId}-date">дедлайн</label>
        <input type="date" id="${formId}-date" name="date" value="${defaultDate}" />
        <input type="time" id="${formId}-time" name="time" />
      </div>
      <div class="form-actions">
        <button type="submit">Добавить</button>
        <button type="button" class="add-form-cancel" data-action="close-add-form" data-form="${formId}">Отмена</button>
      </div>
    </form>`;
}

// ---------- Views ----------

function renderWeekView() {
  const dates = weekDates(ui.refDate);
  const label = `${formatShort(dates[0])} – ${formatShort(dates[6])}`;
  const cols = dates.map((iso) => {
    const tasks = store.state.tasks
      .filter((t) => t.date === iso && isGroupVisible(t.groupId))
      .sort(byTimeThenCreated);
    return `
      <div class="day-col ${isToday(iso) ? "is-today" : ""}">
        <div class="day-col-header">
          <span class="day-name">${weekDayName(iso)}</span>
          <span class="day-num">${formatShort(iso)}</span>
        </div>
        ${renderProgressBar(tasks, "small")}
        ${renderTaskList(tasks)}
        ${renderAddForm(iso, `wk-${iso}`)}
      </div>`;
  }).join("");

  return `
    <div class="view-toolbar">
      <div class="nav">
        <button data-action="nav-prev">‹</button>
        <strong>${label}</strong>
        <button data-action="nav-next">›</button>
      </div>
      <button class="today-btn" data-action="nav-today">Сегодня</button>
    </div>
    <div class="week-grid">${cols}</div>`;
}

function renderDayView() {
  const tasks = store.state.tasks
    .filter((t) => t.date === ui.refDate && isGroupVisible(t.groupId))
    .sort(byTimeThenCreated);

  return `
    <div class="view-toolbar">
      <div class="nav">
        <button data-action="nav-prev">‹</button>
        <strong>${formatDayLabel(ui.refDate)}</strong>
        <button data-action="nav-next">›</button>
      </div>
      <button class="today-btn" data-action="nav-today">Сегодня</button>
    </div>
    <div class="day-panel">
      ${renderProgressBar(tasks)}
      ${renderAddForm(ui.refDate, "day-form")}
      ${renderTaskList(tasks)}
    </div>`;
}

function sortByDeadline(tasks) {
  return [...tasks].sort((a, b) =>
    (a.completed === b.completed ? 0 : a.completed ? 1 : -1) ||
    a.date.localeCompare(b.date) ||
    byTimeThenCreated(a, b)
  );
}

function renderGroupSection(group, tasks) {
  const { total, done } = progressOf(tasks);
  return `
    <div class="list-section">
      <h3 class="list-section-header">
        <span class="group-dot" style="background:${group.color}"></span>
        ${escapeHtml(group.name)}
        <span class="section-count">${done}/${total}</span>
      </h3>
      ${renderTaskList(sortByDeadline(tasks), { showGroupChip: false, showDate: true })}
    </div>`;
}

function renderListView() {
  const visibleTasks = store.state.tasks.filter((t) => isGroupVisible(t.groupId));

  const sectionsToShow = ui.filter.type === "section"
    ? store.state.sections.filter((s) => s.id === ui.filter.id)
    : ui.filter.type === "group"
      ? store.state.sections.filter((s) => s.id === store.groupById(ui.filter.id)?.sectionId)
      : store.state.sections;

  const blocks = sectionsToShow.map((sec) => {
    const groupsInSection = store.state.groups.filter((g) =>
      g.sectionId === sec.id && (ui.filter.type !== "group" || g.id === ui.filter.id));
    const groupBlocks = groupsInSection
      .map((g) => renderGroupSection(g, visibleTasks.filter((t) => t.groupId === g.id)))
      .join("");
    const sectionTasks = visibleTasks.filter((t) => groupsInSection.some((g) => g.id === t.groupId));
    return `
      <div class="section-block-list">
        <div class="section-block-header">
          <span class="group-dot" style="background:${sec.color}"></span>
          <h2>${escapeHtml(sec.name)}</h2>
          ${renderProgressBar(sectionTasks, "small")}
        </div>
        ${groupBlocks || `<p class="empty-hint">В разделе пока нет групп.</p>`}
      </div>`;
  }).join("");

  const knownGroupIds = new Set(store.state.groups.map((g) => g.id));
  const orphan = visibleTasks.filter((t) => !knownGroupIds.has(t.groupId));
  const orphanBlock = orphan.length
    ? renderGroupSection({ name: "Без группы", color: "#7d8ca3" }, orphan)
    : "";

  return `
    <div class="view-toolbar">
      <strong>Список задач</strong>
    </div>
    <div class="day-panel wide">
      ${renderProgressBar(visibleTasks)}
      ${renderAddForm(todayISO(), "list-form")}
      ${blocks}${orphanBlock}
    </div>`;
}

// ---------- Sidebar ----------

function renderGroupEditForm(g) {
  return `
    <li class="group-item editing">
      <form class="group-edit-form" data-action="save-group-form" data-group="${g.id}">
        <input type="color" name="color" value="${g.color}" title="Цвет группы" />
        <input type="text" name="name" value="${escapeHtml(g.name)}" maxlength="40" required autofocus />
        <button type="submit" class="group-edit-save" title="Сохранить">✓</button>
        <button type="button" class="group-edit-cancel" data-action="cancel-edit-group" title="Отмена">✕</button>
      </form>
    </li>`;
}

function renderSectionEditForm(sec) {
  return `
    <li class="section-block">
      <form class="group-edit-form section-edit-form" data-action="save-section-form" data-section="${sec.id}">
        <input type="color" name="color" value="${sec.color}" title="Цвет раздела" />
        <input type="text" name="name" value="${escapeHtml(sec.name)}" maxlength="40" required autofocus />
        <button type="submit" class="group-edit-save" title="Сохранить">✓</button>
        <button type="button" class="group-edit-cancel" data-action="cancel-edit-section" title="Отмена">✕</button>
      </form>
    </li>`;
}

function renderGroupRow(g) {
  if (ui.editingGroupId === g.id) return renderGroupEditForm(g);
  const gTasks = store.state.tasks.filter((t) => t.groupId === g.id);
  const { total, done } = progressOf(gTasks);
  const active = ui.filter.type === "all" ||
    (ui.filter.type === "group" && ui.filter.id === g.id) ||
    (ui.filter.type === "section" && ui.filter.id === g.sectionId);
  return `
    <li class="group-item nested ${active ? "active" : ""}" data-action="toggle-group-filter" data-group="${g.id}">
      <span class="group-dot" style="background:${g.color}"></span>
      <span class="group-name">${escapeHtml(g.name)}</span>
      <span class="group-count">${done}/${total}</span>
      <button class="group-edit" data-action="edit-group" data-group="${g.id}" title="Изменить">✎</button>
      <button class="group-delete" data-action="delete-group" data-group="${g.id}" title="Удалить группу">✕</button>
    </li>`;
}

function renderSectionRow(sec) {
  if (ui.editingSectionId === sec.id) return renderSectionEditForm(sec);
  const groups = store.state.groups.filter((g) => g.sectionId === sec.id);
  const active = ui.filter.type === "all" ||
    (ui.filter.type === "section" && ui.filter.id === sec.id) ||
    (ui.filter.type === "group" && store.groupById(ui.filter.id)?.sectionId === sec.id);
  return `
    <li class="section-block">
      <div class="section-row ${active ? "active" : ""}" data-action="toggle-section-filter" data-section="${sec.id}">
        <span class="group-dot" style="background:${sec.color}"></span>
        <span class="section-name">${escapeHtml(sec.name)}</span>
        <button class="group-edit" data-action="edit-section" data-section="${sec.id}" title="Изменить">✎</button>
        <button class="group-delete" data-action="delete-section" data-section="${sec.id}" title="Удалить раздел">✕</button>
      </div>
      <ul class="group-list nested-list">
        ${groups.map(renderGroupRow).join("") || `<li class="empty-hint small">Нет групп</li>`}
        <li class="add-group-inline">
          <form data-action="add-group-form" data-section="${sec.id}">
            <input type="text" name="name" placeholder="+ группа" maxlength="40" required />
            <button type="submit" title="Добавить группу">+</button>
          </form>
        </li>
      </ul>
    </li>`;
}

function renderSidebar() {
  const sections = store.state.sections.map(renderSectionRow).join("");

  return `
    <div class="sidebar-section">
      <h2>Разделы</h2>
      <ul class="section-list">
        <li class="section-row ${ui.filter.type === "all" ? "active" : ""}" data-action="show-all-groups">
          <span class="group-dot" style="background:#aaa"></span>
          <span class="section-name">Все разделы</span>
        </li>
        ${sections}
      </ul>
      <form class="add-group-form" data-action="add-section-form">
        <input type="text" name="name" placeholder="Новый раздел…" maxlength="40" required />
        <button type="submit">+</button>
      </form>
    </div>
    <div class="sidebar-section">
      <h2>Прогресс всего</h2>
      ${renderProgressBar(store.state.tasks)}
    </div>`;
}

// ---------- Auth & profile screens ----------

function renderAuthScreen() {
  const isSignup = authMode === "signup";
  return `
    <div class="auth-screen">
      <div class="auth-card">
        <h1><img src="icons/icon-192.png?v=6" alt="" class="logo" />MARK</h1>
        <p class="auth-subtitle">Планировщик задач</p>
        <form class="auth-form" data-action="auth-submit">
          <input type="email" name="email" placeholder="Email" required autocomplete="email" />
          <input type="password" name="password" placeholder="Пароль" required minlength="6"
            autocomplete="${isSignup ? "new-password" : "current-password"}" />
          ${authError ? `<div class="auth-error">${escapeHtml(authError)}</div>` : ""}
          ${authMessage ? `<div class="auth-message">${escapeHtml(authMessage)}</div>` : ""}
          <button type="submit" ${authBusy ? "disabled" : ""}>${isSignup ? "Зарегистрироваться" : "Войти"}</button>
        </form>
        <button type="button" class="auth-toggle" data-action="toggle-auth-mode">
          ${isSignup ? "Уже есть аккаунт? Войти" : "Нет аккаунта? Зарегистрироваться"}
        </button>
      </div>
    </div>`;
}

// Inline so the welcome screen needs no extra network round-trips.
const svg = (body, opts = "") =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
    stroke-linecap="round" stroke-linejoin="round" ${opts}>${body}</svg>`;

const ICON_MIC = svg(`<rect x="9" y="3" width="6" height="10" rx="3" />
  <path d="M5 11a7 7 0 0 0 14 0" /><path d="M12 18v3" />`);
const ICON_CALENDAR = svg(`<rect x="3" y="5" width="18" height="16" rx="3" />
  <path d="M8 3v4M16 3v4M3 10h18" />`);
const ICON_SPARKLE = svg(`<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
  <path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />`);
const ICON_CHECKBOX = svg(`<rect x="3" y="3" width="18" height="18" rx="4" />
  <path d="M8 12.5l2.8 2.8L16.5 9.5" />`);
const ICON_CHECK = svg(`<path d="M5 12.5l4.5 4.5L19 7.5" stroke-width="2.6" />`);
const ICON_DONUT = svg(`<circle cx="12" cy="12" r="8.5" stroke-opacity=".18" stroke-width="3" />
  <path d="M12 3.5a8.5 8.5 0 0 1 6.6 13.8" stroke-width="3" />`);
const ICON_TREND = svg(`<path d="M4 16.5L10 10l3.5 3.5L20 7" /><path d="M15 7h5v5" />`);
const ICON_BOLT = svg(`<path d="M13 3L5.5 13.5H11L10 21l7.5-10.5H12z" />`);
const ICON_LIST = svg(`<path d="M9 6h11M9 12h11M9 18h11" /><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" stroke-width="2.6" />`);
const ICON_BARS = svg(`<path d="M6 20v-6M12 20V6M18 20v-9" stroke-width="2.4" />`);

function renderWelcomeScreen() {
  return `
    <div class="welcome">
      <div class="welcome-glow welcome-glow-a"></div>
      <div class="welcome-glow welcome-glow-b"></div>
      <div class="welcome-glow welcome-glow-c"></div>

      <div class="welcome-inner">
        <div class="welcome-topbar">
          <div class="welcome-kicker">
            <strong>MARK</strong>
            <span>your ideas</span>
            <span>into actions</span>
          </div>
          <div class="welcome-kicker right">
            <span>AI</span>
            <span>task manager</span>
            <span>for a better you</span>
          </div>
        </div>

        <div class="welcome-hero">
          <img class="welcome-logo" src="icons/icon-512.png?v=6" alt="MARK" />

          <div class="wcard wcard-voice">
            <div class="wcard-row">
              <span class="wcard-ico">${ICON_MIC}</span>
              <span class="wcard-text">Собери план<br />на сегодня</span>
            </div>
            <div class="wave">${Array.from({ length: 22 }, (_, i) =>
              `<i style="height:${[30, 62, 44, 80, 52, 34, 70, 46, 88, 40, 58, 30, 74, 50, 36, 66, 42, 78, 54, 32, 60, 38][i]}%"></i>`
            ).join("")}</div>
          </div>

          <div class="wcard wcard-meet">
            <div class="wcard-row">
              <span class="wcard-ico">${ICON_CALENDAR}</span>
              <span class="wcard-text">Встреча<br />с командой
                <em class="wcard-sub">11:00 – 12:00</em>
              </span>
              <span class="wcard-check">${ICON_CHECK}</span>
            </div>
          </div>

          <div class="wcard wcard-idea">
            <div class="wcard-row">
              <span class="wcard-ico bare">${ICON_SPARKLE}</span>
              <span class="wcard-text">Идея<br />в задачу</span>
            </div>
          </div>

          <div class="wcard wcard-strategy">
            <div class="wcard-row">
              <span class="wcard-ico">${ICON_CHECKBOX}</span>
              <span class="wcard-text">Стратегия<br />на Q4</span>
            </div>
            <div class="wcard-lines"><i></i><i></i></div>
          </div>

          <div class="wcard wcard-results">
            <div class="wcard-row">
              <span class="wcard-donut">${ICON_DONUT}</span>
              <span class="wcard-text dim">Больше<br />результатов</span>
              <span class="wcard-trend">${ICON_TREND}</span>
            </div>
          </div>
        </div>

        <h1 class="welcome-title">Добро пожаловать<br />в <span>MARK</span></h1>
        <p class="welcome-sub">
          Ваш AI-помощник, который превращает идеи, голос и заметки
          в понятные задачи и помогает доводить их до результата.
        </p>

        <div class="welcome-features">
          <div class="wfeature">
            <span class="wfeature-ico">${ICON_BOLT}</span>
            <span>Быстро<br />добавляйте задачи</span>
          </div>
          <div class="wfeature">
            <span class="wfeature-ico">${ICON_LIST}</span>
            <span>Планируйте<br />с умом</span>
          </div>
          <div class="wfeature">
            <span class="wfeature-ico">${ICON_BARS}</span>
            <span>Достигайте<br />больше</span>
          </div>
        </div>

        <button type="button" class="welcome-cta" data-action="welcome-start">
          Привести дела в порядок <span aria-hidden="true">→</span>
        </button>
      </div>
    </div>`;
}

function renderProfileScreen() {
  const email = session.user.email;
  const name = session.user.user_metadata?.display_name || "";
  return `
    <header class="app-header">
      <button class="back-btn" data-action="back-to-app" aria-label="Назад">←</button>
      <h1>Личный кабинет</h1>
    </header>
    <div class="profile-screen">
      <div class="profile-section">
        <label class="field-label">Email</label>
        <div class="profile-static">${escapeHtml(email)}</div>
      </div>
      <form class="profile-form" data-action="save-display-name">
        <label class="field-label">Имя</label>
        <input type="text" name="displayName" value="${escapeHtml(name)}" placeholder="Как тебя называть" maxlength="40" />
        <button type="submit">Сохранить имя</button>
        ${profileNameMsg ? `<div class="profile-msg">${escapeHtml(profileNameMsg)}</div>` : ""}
      </form>
      <form class="profile-form" data-action="save-password">
        <label class="field-label">Новый пароль</label>
        <input type="password" name="password" placeholder="Минимум 6 символов" minlength="6" />
        <button type="submit">Сменить пароль</button>
        ${profilePasswordMsg ? `<div class="profile-msg">${escapeHtml(profilePasswordMsg)}</div>` : ""}
      </form>
      <div class="profile-section">
        <label class="field-label">Telegram</label>
        ${renderTelegramBlock()}
      </div>
      <button type="button" class="logout-btn" data-action="logout">Выйти из аккаунта</button>
    </div>`;
}

async function loadTelegramLink() {
  telegramLink = await fetchTelegramLink(session.user.id);
  telegramLinkChecked = true;
  if (telegramLink) telegramPendingCode = null;
  render();
  if (!telegramChannel) {
    telegramChannel = subscribeTelegramLink(session.user.id, async () => {
      telegramLink = await fetchTelegramLink(session.user.id);
      if (telegramLink) telegramPendingCode = null;
      render();
    });
  }
}

function renderTelegramBlock() {
  if (telegramLink) {
    const who = telegramLink.telegram_username ? `@${escapeHtml(telegramLink.telegram_username)}` : "аккаунт привязан";
    return `
      <div class="profile-static">Подключено: ${who}</div>
      <button type="button" class="add-form-cancel" data-action="unlink-telegram" style="margin-top:8px;">Отвязать</button>`;
  }
  if (telegramPendingCode) {
    return `
      <div class="telegram-pending">
        <p class="empty-hint">Открой бота и нажми «Запустить» — привяжется автоматически:</p>
        <a class="auth-form-link" href="${telegramPendingCode.url}" target="_blank" rel="noopener">
          <button type="button">Открыть @markplanner_bot</button>
        </a>
        <p class="empty-hint">Или пришли боту в чате: <code>/start ${telegramPendingCode.code}</code></p>
      </div>`;
  }
  return `<button type="button" data-action="link-telegram">Подключить Telegram</button>`;
}

// ---------- Root render ----------

function render() {
  if (!session) {
    root.innerHTML = renderAuthScreen();
    return;
  }
  if (ui.showWelcome) {
    root.innerHTML = renderWelcomeScreen();
    return;
  }
  if (ui.view === "profile") {
    root.innerHTML = renderProfileScreen();
    return;
  }
  const viewLabel = { list: "Список", week: "Неделя", day: "День" };
  root.innerHTML = `
    <header class="app-header">
      <h1><img src="icons/icon-192.png?v=6" alt="" class="logo" />MARK</h1>
      <nav class="view-switch">
        ${["list", "week", "day"].map((v) => `
          <button data-action="switch-view" data-view="${v}" class="${ui.view === v ? "active" : ""}">
            ${viewLabel[v]}
          </button>`).join("")}
      </nav>
      <button class="profile-btn" data-action="open-profile" title="${escapeHtml(displayNameOf(session))}">
        ${escapeHtml(initials(displayNameOf(session)))}
      </button>
    </header>
    <div class="app-body">
      <aside class="sidebar">${renderSidebar()}</aside>
      <main class="content">
        ${ui.view === "week" ? renderWeekView() : ui.view === "day" ? renderDayView() : renderListView()}
      </main>
    </div>`;
}

// ---------- Event delegation ----------

root.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const action = el.dataset.action;

  if (action === "welcome-start") {
    if (session) markWelcomeSeen(session.user.id);
    ui.showWelcome = false;
    render();
  }
  else if (action === "toggle-task") store.toggleTask(el.dataset.id);
  else if (action === "delete-task") store.deleteTask(el.dataset.id);
  else if (action === "edit-task") { ui.editingTaskId = el.dataset.id; render(); }
  else if (action === "cancel-edit-task") { ui.editingTaskId = null; render(); }
  else if (action === "switch-view") { ui.view = el.dataset.view; render(); }
  else if (action === "nav-prev") { ui.refDate = addDays(ui.refDate, ui.view === "week" ? -7 : -1); render(); }
  else if (action === "nav-next") { ui.refDate = addDays(ui.refDate, ui.view === "week" ? 7 : 1); render(); }
  else if (action === "nav-today") { ui.refDate = todayISO(); render(); }
  else if (action === "show-all-groups") { ui.filter = { type: "all" }; render(); }
  else if (action === "toggle-section-filter") {
    const id = el.dataset.section;
    ui.filter = (ui.filter.type === "section" && ui.filter.id === id) ? { type: "all" } : { type: "section", id };
    render();
  } else if (action === "toggle-group-filter") {
    const id = el.dataset.group;
    ui.filter = (ui.filter.type === "group" && ui.filter.id === id) ? { type: "all" } : { type: "group", id };
    render();
  } else if (action === "delete-group") {
    if (store.state.groups.length <= 1) { alert("Должна остаться хотя бы одна группа."); return; }
    if (confirm("Удалить группу и все её задачи?")) store.deleteGroup(el.dataset.group);
  } else if (action === "edit-group") {
    ui.editingGroupId = el.dataset.group;
    render();
  } else if (action === "cancel-edit-group") {
    ui.editingGroupId = null;
    render();
  } else if (action === "delete-section") {
    if (store.state.sections.length <= 1) { alert("Должен остаться хотя бы один раздел."); return; }
    if (confirm("Удалить раздел вместе со всеми его группами и задачами?")) store.deleteSection(el.dataset.section);
  } else if (action === "edit-section") {
    ui.editingSectionId = el.dataset.section;
    render();
  } else if (action === "cancel-edit-section") {
    ui.editingSectionId = null;
    render();
  } else if (action === "open-add-form") {
    ui.openForms.add(el.dataset.form);
    render();
  } else if (action === "close-add-form") {
    ui.openForms.delete(el.dataset.form);
    render();
  } else if (action === "toggle-auth-mode") {
    authMode = authMode === "signin" ? "signup" : "signin";
    authError = "";
    authMessage = "";
    render();
  } else if (action === "open-profile") {
    profileNameMsg = "";
    profilePasswordMsg = "";
    telegramPendingCode = null;
    ui.view = "profile";
    render();
    loadTelegramLink();
  } else if (action === "back-to-app") {
    if (telegramChannel) { telegramChannel.unsubscribe(); telegramChannel = null; }
    ui.view = "list";
    render();
  } else if (action === "logout") {
    if (telegramChannel) { telegramChannel.unsubscribe(); telegramChannel = null; }
    signOut();
  } else if (action === "link-telegram") {
    (async () => {
      telegramPendingCode = await createLinkCode(session.user.id);
      render();
    })();
  } else if (action === "unlink-telegram") {
    (async () => {
      await unlinkTelegram(session.user.id);
      telegramLink = null;
      render();
    })();
  }
});

root.addEventListener("submit", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  e.preventDefault();
  const action = el.dataset.action;
  const data = new FormData(el);

  if (action === "add-task-form") {
    const title = data.get("title")?.toString().trim();
    if (!title) return;
    ui.openForms.delete(el.id);
    store.addTask({
      title,
      notes: data.get("notes"),
      date: data.get("date") || el.dataset.date,
      time: data.get("time")?.toString().trim() || "",
      groupId: data.get("groupId"),
    });
  } else if (action === "add-group-form") {
    const name = data.get("name")?.toString().trim();
    if (!name) return;
    store.addGroup(name, el.dataset.section);
  } else if (action === "save-group-form") {
    const name = data.get("name")?.toString().trim();
    if (!name) return;
    ui.editingGroupId = null;
    store.updateGroup(el.dataset.group, { name, color: data.get("color") });
  } else if (action === "add-section-form") {
    const name = data.get("name")?.toString().trim();
    if (!name) return;
    store.addSection(name);
  } else if (action === "save-section-form") {
    const name = data.get("name")?.toString().trim();
    if (!name) return;
    ui.editingSectionId = null;
    store.updateSection(el.dataset.section, { name, color: data.get("color") });
  } else if (action === "save-task-form") {
    const title = data.get("title")?.toString().trim();
    if (!title) return;
    ui.editingTaskId = null;
    store.updateTask(el.dataset.id, {
      title,
      notes: data.get("notes")?.toString().trim() || "",
      date: data.get("date"),
      time: data.get("time")?.toString().trim() || "",
      groupId: data.get("groupId"),
    });
  } else if (action === "auth-submit") {
    const email = data.get("email")?.toString().trim();
    const password = data.get("password")?.toString();
    if (!email || !password) return;
    authError = "";
    authMessage = "";
    authBusy = true;
    render();
    (async () => {
      const { data: result, error } = authMode === "signup"
        ? await signUp(email, password)
        : await signIn(email, password);
      authBusy = false;
      if (error) {
        authError = error.message;
      } else if (authMode === "signup" && !result.session) {
        authMessage = "Проверь почту и перейди по ссылке для подтверждения, потом сможешь войти.";
      }
      render();
    })();
  } else if (action === "save-display-name") {
    const name = data.get("displayName")?.toString().trim();
    (async () => {
      const { data: result, error } = await updateDisplayName(name);
      if (result?.user) session.user = result.user;
      profileNameMsg = error ? error.message : "Сохранено";
      render();
    })();
  } else if (action === "save-password") {
    const password = data.get("password")?.toString();
    if (!password || password.length < 6) {
      profilePasswordMsg = "Минимум 6 символов";
      render();
      return;
    }
    (async () => {
      const { error } = await updatePassword(password);
      profilePasswordMsg = error ? error.message : "Пароль изменён";
      el.reset();
      render();
    })();
  }
});

// ---------- Auth bootstrap ----------

store.subscribe(render);

onAuthChange((newSession) => {
  const wasLoggedIn = !!session;
  const isLoggedIn = !!newSession;
  session = newSession;
  if (isLoggedIn && (!wasLoggedIn || store.userId !== newSession.user.id)) {
    ui.showWelcome = !hasSeenWelcome(newSession.user.id);
    store.attachUser(newSession.user.id);
  } else if (!isLoggedIn && wasLoggedIn) {
    store.detachUser();
    ui.view = "list";
    ui.showWelcome = false;
  }
  render();
});

// ---------- Telegram Mini App ----------

function initTelegramWebApp() {
  const tg = window.Telegram?.WebApp;
  if (!tg) return null;
  tg.ready();
  tg.expand();
  try {
    tg.setHeaderColor("#16a34a");
    tg.setBackgroundColor("#f4f5f7");
  } catch {}
  return tg;
}

async function tryTelegramAutoLogin(tg) {
  if (tgAutoLoginDone || !tg?.initData) return;
  tgAutoLoginDone = true;
  const existing = await getSession();
  if (existing) return;
  authBusy = true;
  render();
  const result = await telegramMiniAppSignIn(tg.initData);
  authBusy = false;
  if (!result.ok && result.reason === "not_linked") {
    authMessage = "Этот Telegram ещё не привязан к аккаунту MARK. Войди по email, затем в «Личный кабинет» → «Привязать Telegram».";
  }
  render();
}

render();

const tgWebApp = initTelegramWebApp();
if (tgWebApp) tryTelegramAutoLogin(tgWebApp);
