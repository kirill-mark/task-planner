// Контроль работы (раздел 14 ТЗ). Вызывается по расписанию:
//   {"mode":"check"} — раз в час; при остановке обработки владелец получает
//     оповещение в Telegram, одно на вид проблемы в сутки;
//   {"mode":"daily"} — раз в сутки сводка за 24 часа.
// Правила — _shared/health.ts, данные — mark_health_report (миграция 0013).
// В сообщениях только счётчики, без текста задач и сообщений пользователей.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { dailyProblems, dailyText, problemsOf, type HealthReport } from "../_shared/health.ts";

const OWNER = "bd24e42b-16ba-4a98-90cb-209e1adf19f8";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

async function ownerChat(): Promise<number | null> {
  const { data } = await supabase.from("telegram_links").select("telegram_chat_id, blocked_at").eq("user_id", OWNER).maybeSingle();
  return data && !data.blocked_at ? Number(data.telegram_chat_id) : null;
}

// Захват в sent_notifications — как у напоминаний: одно сообщение на вид в сутки.
async function claim(kind: string, ref: string): Promise<boolean> {
  const { error } = await supabase.from("sent_notifications").insert({
    user_id: OWNER, kind, ref, local_date: new Date().toISOString().slice(0, 10), status: "processing",
  });
  return !error;
}

async function send(chatId: number, text: string): Promise<boolean> {
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }), signal: AbortSignal.timeout(15000),
  }).catch(() => null);
  return !!res?.ok;
}

// Не ушло — захват снимается, и следующий запуск повторит.
async function mark(kind: string, ref: string, ok: boolean) {
  const t = supabase.from("sent_notifications");
  const q = ok ? t.update({ status: "sent" }) : t.delete();
  await q.eq("user_id", OWNER).eq("kind", kind).eq("ref", ref).eq("local_date", new Date().toISOString().slice(0, 10));
}

Deno.serve(async (req) => {
  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) return new Response("forbidden", { status: 403 });
  const body = await req.json().catch(() => ({}));
  const daily = body?.mode === "daily";
  const since = new Date(Date.now() - (daily ? 24 * 3600000 : 3600000)).toISOString();
  const { data, error } = await supabase.rpc("mark_health_report", { p_since: since });
  if (error || !data) {
    console.error("health report failed", error?.message);
    return new Response(JSON.stringify({ ok: false }), { status: 500 });
  }
  const report = data as HealthReport;
  const chat = await ownerChat();
  const problems = daily ? dailyProblems(report) : problemsOf(report);
  const sent: string[] = [];
  if (chat && daily) {
    if (await claim("health-daily", "daily")) {
      const ok = await send(chat, dailyText(report, problems));
      await mark("health-daily", "daily", ok);
      if (ok) sent.push("daily");
    }
  } else if (chat) {
    for (const p of problems) {
      if (!(await claim("health", p.key))) continue;
      const ok = await send(chat, `⚠️ <b>MARK: ${p.text}</b>\nПроверка за последний час. Подробности — в журнале функций Supabase.`);
      await mark("health", p.key, ok);
      if (ok) sent.push(p.key);
    }
  }
  return new Response(JSON.stringify({ ok: true, problems: problems.map((p) => p.key), sent, owner_linked: !!chat }), { headers: { "Content-Type": "application/json" } });
});
