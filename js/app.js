import { store } from "./state.js";
import {
  todayISO, addDays, weekDates, formatDayLabel, formatShort,
  weekDayName, isToday,
} from "./dates.js";

const ui = {
  view: "list",       // 'list' | 'week' | 'day'
  refDate: todayISO(),
  filter: { type: "all" }, // {type:'all'} | {type:'section', id} | {type:'group', id}
  editingGroupId: null,
  editingSectionId: null,
  editingTaskId: null,
  openForms: new Set(),
};

const root = document.getElementById("app");

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
        <div class="task-title">${escapeHtml(task.title)}</div>
        ${task.notes ? `<div class="task-notes">${escapeHtml(task.notes)}</div>` : ""}
        <div class="task-meta">
          ${showGroupChip ? `<span class="chip" style="--chip-color:${g.color}">${escapeHtml(g.name)}</span>` : ""}
          ${showDate ? `<span class="task-date ${overdue ? "overdue" : ""}">до ${formatShort(task.date)}</span>` : ""}
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
      .sort((a, b) => a.createdAt - b.createdAt);
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
    .sort((a, b) => a.createdAt - b.createdAt);

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
    a.createdAt - b.createdAt
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

// ---------- Root render ----------

function render() {
  const viewLabel = { list: "Список", week: "Неделя", day: "День" };
  root.innerHTML = `
    <header class="app-header">
      <h1>🌿 План</h1>
      <nav class="view-switch">
        ${["list", "week", "day"].map((v) => `
          <button data-action="switch-view" data-view="${v}" class="${ui.view === v ? "active" : ""}">
            ${viewLabel[v]}
          </button>`).join("")}
      </nav>
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

  if (action === "toggle-task") store.toggleTask(el.dataset.id);
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
      groupId: data.get("groupId"),
    });
  }
});

store.subscribe(render);
render();
