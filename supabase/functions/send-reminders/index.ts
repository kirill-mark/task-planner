// Runs every minute (pg_cron) and sends, in each user's own timezone and
// settings (раздел 10 ТЗ):
//   - a morning digest: timed events, tasks without time, today's deadlines
//     and a short overdue block;
//   - an evening digest with tomorrow's plan;
//   - a reminder 5/15/30/60 minutes before a task's planned time, or before a
//     deadline that has a time; a date without a time gets none.
// Quiet hours move a digest to their end and hold reminders; after them a
// reminder goes out only if the task is still ahead. Decisions live in
// _shared/notify.ts and are tested there.
// Everything is evaluated in each user's own timezone. Every send is claimed in
// sent_notifications first, so overlapping runs can't deliver it twice, and is
// marked sent only once Telegram confirms it (D08): an explicit refusal
// releases the claim for the next run, a lost reply is marked unknown rather
// than retried blindly. A late run still catches up - digests within an hour,
// reminders until the task starts.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { loadTasksV2 } from "../_shared/planner.ts";
import { digestDue, eveningDigest, morningDigest, reminderDecision, reminderText, type NSettings } from "../_shared/notify.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// sent — Telegram confirmed; refused — it answered with an error, so nothing was
// delivered and a retry is safe; unknown — no answer, it may or may not have
// arrived, so a retry could duplicate it.
type SendResult = "sent" | "refused" | "unknown";

async function sendMessage(chatId: number, text: string, keyboard?: unknown): Promise<{ result: SendResult; detail?: string }> {
  let res: Response;
  try {
    res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", reply_markup: keyboard }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    return { result: "unknown", detail: String(e instanceof Error ? e.message : e).slice(0, 200) };
  }
  const body = await res.json().catch(() => null);
  if (res.ok && body?.ok) return { result: "sent" };
  const detail = `${res.status} ${body?.description || ""}`.trim().slice(0, 200);
  console.error("telegram send failed", chatId, detail);
  return { result: res.status >= 500 ? "unknown" : "refused", detail };
}

// Lets the digest be acted on straight from the chat; the webhook handles these.
function planKeyboard(date: string) {
  return {
    inline_keyboard: [[
      { text: "➕ Добавить задачу", callback_data: `padd:${date}` },
      { text: "🗑 Удалить задачу", callback_data: `pdel:${date}` },
    ]],
  };
}

// Local wall-clock parts for a timezone, without pulling in a date library.
function localParts(tz: string, now: Date) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(now)) if (p.type !== "literal") parts[p.type] = p.value;
  const hour = parseInt(parts.hour === "24" ? "0" : parts.hour, 10);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour,
    minute: parseInt(parts.minute, 10),
    minutes: hour * 60 + parseInt(parts.minute, 10),
  };
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Returns true when this run owns the notification (nobody claimed it yet).
async function claim(userId: string, kind: string, ref: string, localDate: string): Promise<boolean> {
  const { error } = await supabase
    .from("sent_notifications")
    .insert({ user_id: userId, kind, ref, local_date: localDate, status: "processing" });
  if (error) {
    if (error.code === "23505") return false; // unique violation: already claimed
    console.error("claim failed", error);
    return false;
  }
  return true;
}

// Sends a claimed notification and records the outcome.
async function deliver(
  userId: string, kind: string, ref: string, localDate: string,
  chatId: number, text: string, keyboard?: unknown,
): Promise<boolean> {
  if (!(await claim(userId, kind, ref, localDate))) return false;
  const { result, detail } = await sendMessage(chatId, text, keyboard);
  const key = { user_id: userId, kind, ref, local_date: localDate };
  if (result === "refused" && /blocked|deactivated|chat not found/i.test(detail || "")) {
    // бота заблокировали: повторять бессмысленно — доставка останавливается,
    // кабинет показывает причину; снимается, когда человек снова пишет боту
    await supabase.from("telegram_links").update({ blocked_at: new Date().toISOString() }).eq("telegram_chat_id", chatId);
    await supabase.from("sent_notifications").update({ status: "failed", detail: detail || null }).match({ user_id: userId, kind, ref, local_date: localDate });
    return false;
  }
  if (result === "refused") {
    // nothing was delivered: release the claim so the next run can retry
    const { error } = await supabase.from("sent_notifications").delete().match(key);
    if (error) console.error("release failed", error);
    return false;
  }
  const { error } = await supabase
    .from("sent_notifications")
    .update({ status: result, detail: detail || null, sent_at: new Date().toISOString() })
    .match(key);
  if (error) console.error("mark failed", error);
  return result === "sent";
}

// Reminders were keyed by task id alone before; one already sent under the old
// key must not go out again right after this deploy.
async function sentUnderOldKey(userId: string, taskId: string, localDate: string): Promise<boolean> {
  const { data } = await supabase
    .from("sent_notifications")
    .select("id")
    .match({ user_id: userId, kind: "task", ref: taskId, local_date: localDate })
    .maybeSingle();
  return !!data;
}

Deno.serve(async (req) => {
  if (CRON_SECRET && req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response("forbidden", { status: 403 });
  }

  const now = new Date();
  let sent = 0;

  try {
    const { data: links, error } = await supabase
      .from("telegram_links")
      .select("telegram_chat_id, user_id, blocked_at");
    if (error) throw error;

    for (const link of links || []) {
      const userId = link.user_id as string;
      const chatId = link.telegram_chat_id as number;
      // бот заблокирован пользователем — доставка остановлена до его возвращения
      if (link.blocked_at) continue;

      const { data: st } = await supabase
        .from("user_settings")
        .select("timezone, morning_digest, evening_digest, task_reminders, morning_time, evening_time, reminder_lead, quiet_enabled, quiet_start, quiet_end")
        .eq("user_id", userId)
        .maybeSingle();

      let tz = st?.timezone || "Europe/Moscow";
      let local;
      try {
        local = localParts(tz, now);
      } catch {
        tz = "Europe/Moscow"; // unknown tz stored: don't skip the user
        local = localParts(tz, now);
      }
      const ns: NSettings = {
        morning: String(st?.morning_time || "09:00").slice(0, 5),
        evening: String(st?.evening_time || "21:00").slice(0, 5),
        lead: [5, 15, 30, 60].includes(st?.reminder_lead) ? st!.reminder_lead : 30,
        quiet: { enabled: !!st?.quiet_enabled, start: String(st?.quiet_start || "23:00").slice(0, 5), end: String(st?.quiet_end || "08:00").slice(0, 5) },
      };

      // Не прочитали — пропускаем пользователя в этот запуск, а не считаем,
      // что задач нет.
      let tasks: any[];
      try {
        tasks = await loadTasksV2(supabase, userId);
      } catch (e) {
        console.error("reminders: read failed for", userId, e instanceof Error ? e.message : e);
        continue;
      }
      const tomorrow = addDays(local.date, 1);
      const deliverTo = (kind: string, ref: string, date: string, text: string, kb?: unknown) => deliver(userId, kind, ref, date, chatId, text, kb);

      if ((st?.morning_digest ?? true) && digestDue(local.minutes, ns.morning, ns.quiet)) {
        if (await deliverTo("morning", "digest", local.date, morningDigest(tasks, local.date, tomorrow), planKeyboard(local.date))) sent++;
      }
      if ((st?.evening_digest ?? true) && digestDue(local.minutes, ns.evening, ns.quiet)) {
        if (await deliverTo("evening", "digest", local.date, eveningDigest(tasks, local.date, tomorrow), planKeyboard(tomorrow))) sent++;
      }

      if (st?.task_reminders ?? true) {
        const nowMs = now.getTime();
        for (const t of tasks) {
          let d;
          try { d = reminderDecision(t, nowMs, local.minutes, tz, ns); } catch { continue; }
          if (d.action !== "send" || !d.anchor) continue;
          if (await sentUnderOldKey(userId, t.id, d.anchor.date)) continue;
          // ключ включает момент: перенесённая задача получает своё напоминание,
          // прежнее для неё больше не срабатывает
          const ref = `${t.id}@${d.anchor.date}T${d.anchor.time}`;
          if (await deliverTo("task", ref, d.anchor.date, reminderText(t, d.anchor, Math.round((d.eventAt! - nowMs) / 60000)))) sent++;
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, sent }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
