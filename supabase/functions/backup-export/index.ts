// Nightly data backup, run by pg_cron.
//
// The project is on a plan with no automatic backups and no PITR, so until this
// existed the working database was the only copy. Each run writes one JSON
// snapshot of every MARK table to a private Storage bucket and, when a chat is
// configured, also sends it to Telegram so a copy lives outside the project.
//
// What it deliberately does NOT cover: passwords. auth.users is exported
// without credentials, so this restores data, not the ability to sign in.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
const BACKUP_CHAT_ID = Deno.env.get("BACKUP_TELEGRAM_CHAT_ID") || "";

const BUCKET = "mark-backups";
const KEEP_DAYS = 30;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Only MARK's own tables. The same database hosts an unrelated financial app
// (cfo_*), which this must never touch.
const TABLES = [
  "planner_state",
  "user_settings",
  "telegram_links",
  "link_codes",
  "sent_notifications",
  "telegram_pending_actions",
  // новая модель: после переключения аккаунта источник истины здесь
  "mark_account_mode",
  "mark_sections",
  "mark_groups",
  "mark_tasks",
  "mark_operations",
  "mark_legacy_snapshots",
  "mark_migration_runs",
  "mark_migration_quarantine",
];

// Первичный ключ каждой таблицы: без устойчивого порядка страницы могли бы
// потерять или повторить строку на стыке.
const ORDER_BY: Record<string, string[]> = {
  planner_state: ["id"],
  user_settings: ["user_id"],
  telegram_links: ["telegram_chat_id"],
  link_codes: ["code"],
  sent_notifications: ["id"],
  telegram_pending_actions: ["telegram_chat_id"],
  mark_account_mode: ["user_id"],
  mark_sections: ["user_id", "id"],
  mark_groups: ["user_id", "id"],
  mark_tasks: ["user_id", "id"],
  mark_operations: ["operation_id"],
  mark_legacy_snapshots: ["id"],
  mark_migration_runs: ["id"],
  mark_migration_quarantine: ["id"],
};

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sendToTelegram(fileName: string, body: string, caption: string) {
  if (!BACKUP_CHAT_ID || !TELEGRAM_BOT_TOKEN) return "skipped";
  const form = new FormData();
  form.append("chat_id", BACKUP_CHAT_ID);
  form.append("caption", caption);
  form.append("document", new Blob([body], { type: "application/json" }), fileName);
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    console.error("backup-export: telegram delivery failed", await res.text());
    return "failed";
  }
  return "sent";
}

// Keeps the bucket from growing without bound; the window matches the spec's
// 30-day retention for pre-migration snapshots.
async function pruneOld() {
  const { data, error } = await supabase.storage.from(BUCKET).list("", { limit: 1000 });
  if (error || !data) return 0;
  const cutoff = Date.now() - KEEP_DAYS * 86400000;
  const stale = data
    .filter((f) => new Date(f.created_at || f.updated_at || Date.now()).getTime() < cutoff)
    .map((f) => f.name);
  if (!stale.length) return 0;
  await supabase.storage.from(BUCKET).remove(stale);
  return stale.length;
}

Deno.serve(async (req) => {
  if (CRON_SECRET && req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response("forbidden", { status: 403 });
  }

  try {
    const snapshot: Record<string, unknown> = {};
    const counts: Record<string, number> = {};

    // Постранично: API отдаёт не больше 1000 строк за запрос, и копия большой
    // таблицы (журнал операций, отправленные уведомления) иначе обрезалась бы
    // молча. Итог сверяется с точным числом строк.
    const PAGE = 1000;
    for (const table of TABLES) {
      // число строк — до выгрузки: добавленное во время неё проверку не ломает
      const { count, error: countErr } = await supabase.from(table).select("*", { count: "exact", head: true });
      if (countErr) throw new Error(`${table}: ${countErr.message}`);
      const rows: unknown[] = [];
      for (let from = 0; ; from += PAGE) {
        let q = supabase.from(table).select("*");
        for (const col of ORDER_BY[table] || []) q = q.order(col, { ascending: true });
        const { data, error } = await q.range(from, from + PAGE - 1);
        if (error) throw new Error(`${table}: ${error.message}`);
        rows.push(...(data || []));
        if (!data || data.length < PAGE) break;
      }
      if (count !== null && count > rows.length) throw new Error(`${table}: выгружено ${rows.length} из ${count}`);
      snapshot[table] = rows;
      counts[table] = rows.length;
    }

    // Identity without credentials: enough to know who existed, not to log in.
    const { data: userList, error: userErr } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    if (userErr) throw new Error(`auth: ${userErr.message}`);
    snapshot["auth_users_safe"] = (userList?.users || []).map((u) => ({
      id: u.id,
      email: u.email,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at,
      user_metadata: u.user_metadata,
    }));
    counts["auth_users_safe"] = (userList?.users || []).length;

    const tasksTotal = ((snapshot["planner_state"] as any[]) || [])
      .reduce((n, row) => n + ((row?.data?.tasks || []).length), 0);

    const now = new Date();
    const payload = {
      created_at: now.toISOString(),
      project_ref: "ofgicgqsmjvpsrvzefib",
      schema_version: 1,
      note: "Экспорт данных MARK. Пароли и возможность входа сюда не входят.",
      counts: { ...counts, tasks_total: tasksTotal },
      data: snapshot,
    };
    const body = JSON.stringify(payload, null, 1);
    const checksum = await sha256Hex(body);
    const fileName = `mark-${now.toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;

    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(fileName, new Blob([body], { type: "application/json" }), { upsert: false });
    if (upErr) throw new Error(`storage: ${upErr.message}`);

    const caption =
      `Копия MARK от ${now.toISOString().slice(0, 16).replace("T", " ")} UTC\n` +
      `Задач: ${tasksTotal} · пользователей: ${counts["auth_users_safe"]}\n` +
      `SHA-256: ${checksum.slice(0, 16)}…`;
    const delivery = await sendToTelegram(fileName, body, caption);

    const pruned = await pruneOld();

    console.log(
      `backup-export: ${fileName} bytes=${body.length} tasks=${tasksTotal} ` +
        `telegram=${delivery} pruned=${pruned}`
    );
    return new Response(
      JSON.stringify({ ok: true, file: fileName, bytes: body.length, counts: payload.counts, checksum, telegram: delivery, pruned }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("backup-export failed:", e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
