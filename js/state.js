import { loadState, saveState } from "./storage.js";

const GROUP_COLORS = [
  "#5b8def", "#e0698e", "#3fb98c", "#f2a541",
  "#9b6bdb", "#4fb3bf", "#e05c5c", "#7d8ca3",
];

class Store {
  constructor() {
    this.state = loadState();
    this.listeners = new Set();
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    saveState(this.state);
    this.listeners.forEach((fn) => fn(this.state));
  }

  // --- tasks ---
  addTask({ title, notes, date, groupId }) {
    this.state.tasks.push({
      id: crypto.randomUUID(),
      title: title.trim(),
      notes: (notes || "").trim(),
      date,
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
