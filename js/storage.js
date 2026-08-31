const STORAGE_PREFIX = "task-planner:v1:";
const DEFAULT_SECTION_ID = "general";

const DEFAULT_SECTIONS = [
  { id: DEFAULT_SECTION_ID, name: "Общее", color: "#7d8ca3" },
];

const DEFAULT_GROUPS = [
  { id: "work", name: "Работа", color: "#5b8def", sectionId: DEFAULT_SECTION_ID },
  { id: "personal", name: "Личное", color: "#e0698e", sectionId: DEFAULT_SECTION_ID },
  { id: "study", name: "Учёба", color: "#3fb98c", sectionId: DEFAULT_SECTION_ID },
];

function todayISO() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function seedState() {
  return {
    sections: DEFAULT_SECTIONS,
    groups: DEFAULT_GROUPS,
    tasks: [
      {
        id: crypto.randomUUID(),
        title: "Добавь свою первую задачу",
        notes: "",
        date: todayISO(),
        groupId: "work",
        completed: false,
        createdAt: Date.now(),
      },
    ],
  };
}

// Migrates state saved before "sections" existed: every group lands in one
// default section so existing data keeps working without user action.
function migrate(state) {
  if (!state.sections || !state.sections.length) {
    state.sections = [{ ...DEFAULT_SECTIONS[0] }];
  }
  const sectionIds = new Set(state.sections.map((s) => s.id));
  const fallbackSectionId = state.sections[0].id;
  for (const g of state.groups) {
    if (!g.sectionId || !sectionIds.has(g.sectionId)) g.sectionId = fallbackSectionId;
  }
  return state;
}

export function loadState(userId) {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + userId);
    if (!raw) return seedState();
    const parsed = JSON.parse(raw);
    if (!parsed.groups || !parsed.tasks) return seedState();
    return migrate(parsed);
  } catch {
    return seedState();
  }
}

export function saveState(userId, state) {
  localStorage.setItem(STORAGE_PREFIX + userId, JSON.stringify(state));
}
