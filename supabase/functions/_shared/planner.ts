// Данные планировщика для серверных обработчиков (бот, напоминания) в той
// форме, с которой они работают давно: { sections, groups, tasks } с полями
// date/time/dateMode/groupId/sectionId.
//
// Откуда читать и куда писать, решает модель аккаунта на сервере:
//   legacy — planner_state целиком, как раньше;
//   v2     — новая модель: чтение через mark_get_state, запись — разницей между
//            прочитанным и изменённым, операциями через mark_apply_operations с
//            версиями прочитанных строк. Правка, столкнувшаяся с правкой из
//            другого канала, получает конфликт, а не затирает её.
//
// Любая ошибка чтения бросается: пустой планировщик вместо ошибки однажды
// записался бы поверх настоящих данных (D02).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type Mode = "legacy" | "v2";

type Loaded = {
  mode: Mode;
  original: any; // глубокая копия прочитанного — основа для разницы
  revisions: { section: Map<string, number>; group: Map<string, number>; task: Map<string, number> };
  timezone: string | null;
};

const loaded = new WeakMap<object, Loaded>();

export async function accountMode(db: SupabaseClient, userId: string): Promise<Mode> {
  const { data, error } = await db.from("mark_account_mode").select("mode").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(`не удалось узнать модель аккаунта: ${error.message}`);
  // нет записи — новая модель; legacy бывает только явным, после отката
  return data?.mode === "legacy" ? "legacy" : "v2";
}

const hhmm = (t: string | null) => (t ? String(t).slice(0, 5) : "");

function toLegacy(state: any) {
  return {
    sections: state.sections.map((s: any) => ({ id: s.id, name: s.name, color: s.color })),
    groups: state.groups.map((g: any) => ({ id: g.id, name: g.name, color: g.color, sectionId: g.section_id })),
    tasks: state.tasks.map((t: any) => {
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
      };
    }),
  };
}

export async function loadPlanner(db: SupabaseClient, userId: string, timezone: string | null = null) {
  const mode = await accountMode(db, userId);

  if (mode === "legacy") {
    const { data, error } = await db.from("planner_state").select("data").eq("user_id", userId).maybeSingle();
    if (error) throw new Error(`не удалось прочитать планировщик: ${error.message}`);
    const state = data?.data || { sections: [], groups: [], tasks: [], updatedAt: 0 };
    loaded.set(state, { mode, original: null, revisions: emptyRevisions(), timezone });
    return state;
  }

  const { data, error } = await db.rpc("mark_get_state", { p_user: userId, p_since: null });
  if (error || !data) throw new Error(`не удалось прочитать планировщик: ${error?.message || "пустой ответ"}`);
  const state = toLegacy(data);
  const revisions = emptyRevisions();
  for (const s of data.sections) revisions.section.set(s.id, s.revision);
  for (const g of data.groups) revisions.group.set(g.id, g.revision);
  for (const t of data.tasks) revisions.task.set(t.id, t.revision);
  loaded.set(state, { mode, original: structuredClone(state), revisions, timezone });
  return state;
}

function emptyRevisions() {
  return { section: new Map<string, number>(), group: new Map<string, number>(), task: new Map<string, number>() };
}

// ------------------------------------------------------------------ запись --

function taskFields(t: any, timezone: string | null) {
  const date = t.date || null;
  const time = date && /^\d{2}:\d{2}$/.test(t.time || "") ? t.time : null;
  const on = t.dateMode === "on";
  return {
    title: t.title,
    notes: t.notes || "",
    group_id: t.groupId || null,
    completed: !!t.completed,
    planned_date: on ? date : null,
    planned_time: on ? time : null,
    due_date: on ? null : date,
    due_time: on ? null : time,
    timezone: time ? timezone : null,
  };
}

function changed(before: Record<string, unknown>, after: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(after)) {
    if (k === "timezone") continue;
    if ((before[k] ?? null) !== (v ?? null)) out[k] = v ?? null;
  }
  // пояс меняется только вместе с датой или временем
  if (Object.keys(out).some((k) => k.endsWith("_date") || k.endsWith("_time"))) out.timezone = after.timezone ?? null;
  return out;
}

type Op = { operation_id: string; entity: string; type: string; entity_id: string; base_revision: number | null; changes: Record<string, unknown> };

function diffOps(meta: Loaded, next: any): Op[] {
  const prev = meta.original;
  const ops: Op[] = [];
  const op = (entity: "section" | "group" | "task", type: string, id: string, changes: Record<string, unknown> = {}) =>
    ops.push({
      operation_id: crypto.randomUUID(), entity, type, entity_id: id,
      base_revision: type === "create" ? null : meta.revisions[entity].get(id) ?? null,
      changes,
    });

  const byId = (list: any[]) => new Map((list || []).map((x: any) => [x.id, x]));
  const [ps, pg, pt] = [byId(prev.sections), byId(prev.groups), byId(prev.tasks)];
  const [ns, ng, nt] = [byId(next.sections), byId(next.groups), byId(next.tasks)];

  // создание — от родителей к детям, удаление — от детей к родителям
  (next.sections || []).forEach((s: any, i: number) => {
    const fields = { name: s.name, color: s.color };
    if (!ps.has(s.id)) op("section", "create", s.id, { ...fields, position: i });
    else { const c = changed(ps.get(s.id), fields); if (Object.keys(c).length) op("section", "update", s.id, c); }
  });
  (next.groups || []).forEach((g: any, i: number) => {
    const fields = { name: g.name, color: g.color, section_id: g.sectionId || null };
    const before = pg.get(g.id);
    if (!before) op("group", "create", g.id, { ...fields, position: i });
    else {
      const c = changed({ name: before.name, color: before.color, section_id: before.sectionId || null }, fields);
      if (Object.keys(c).length) op("group", "update", g.id, c);
    }
  });
  (next.tasks || []).forEach((t: any) => {
    const fields = taskFields(t, meta.timezone);
    const before = pt.get(t.id);
    if (!before) op("task", "create", t.id, fields);
    else {
      const c = changed(taskFields(before, meta.timezone), fields);
      if (Object.keys(c).length) op("task", "update", t.id, c);
    }
  });
  for (const id of pt.keys()) if (!nt.has(id)) op("task", "delete", id);
  for (const id of pg.keys()) if (!ng.has(id)) op("group", "delete", id);
  for (const id of ps.keys()) if (!ns.has(id)) op("section", "delete", id);
  return ops;
}

// Бросает при любой неудаче, в том числе при конфликте: обработчик не должен
// отвечать «Добавил ✅» на запись, которую база не приняла (D05).
export async function savePlanner(db: SupabaseClient, userId: string, state: any, source: "bot" = "bot") {
  const meta = loaded.get(state);
  if (!meta) throw new Error("savePlanner: состояние не было прочитано через loadPlanner");

  if (meta.mode === "legacy") {
    state.updatedAt = Date.now();
    const { error } = await db
      .from("planner_state")
      .upsert({ user_id: userId, data: state, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (error) throw new Error(`не удалось сохранить: ${error.message}`);
    return;
  }

  const ops = diffOps(meta, state);
  if (!ops.length) return;
  const { data, error } = await db.rpc("mark_apply_operations", { p_user: userId, p_source: source, p_ops: ops });
  if (error) throw new Error(`не удалось сохранить: ${error.message}`);
  const bad = (data?.results || []).filter((r: any) => r.status !== "applied");
  if (bad.length) {
    const conflict = bad.some((r: any) => r.status === "conflict");
    throw new Error(conflict
      ? "задачу только что изменили в другом месте — открой её заново и повтори"
      : `не удалось сохранить: ${bad[0].result?.reason || bad[0].reason || bad[0].status}`);
  }
  // следующее сохранение того же объекта считает разницу от уже записанного
  meta.original = structuredClone(state);
  for (const r of data.results) {
    const o = ops.find((x) => x.operation_id === r.operation_id);
    if (o && r.result?.revision) meta.revisions[o.entity as "task"].set(o.entity_id, r.result.revision);
  }
}
