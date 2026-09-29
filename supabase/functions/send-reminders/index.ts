// Runs on a schedule (pg_cron, every 5 minutes) and sends:
//   - a morning digest with today's tasks,
//   - an evening digest with tomorrow's tasks,
//   - a per-task reminder 30 minutes before a task's own time.
// Everything is evaluated in each user's own timezone. Every send is claimed in
// sent_notifications first, so overlapping runs can't deliver it twice, and is
// marked sent only once Telegram confirms it (D08): an explicit refusal
// releases the claim for the next run, a lost reply is marked unknown rather
// than retried blindly. A late run still catches up - digests within an hour,
// reminders until the task starts.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { loadPlanner } from "../_shared/planner.ts";
import { reminderWindow, validDate, validTime } from "../_shared/time.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const MORNING_HOUR = 9;   // digest with today's plan
const EVENING_HOUR = 21;  // preview of tomorrow
const REMINDER_LEAD_MIN = 30;
const DIGEST_CATCH_UP_MIN = 60; // a digest may still go out this late after its hour

type Task = {
  id: string;
  title: string;
  notes?: string;
  date: string;
  time?: string;
  dateMode?: "due" | "on";
  completed?: boolean;
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

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

function formatTaskLine(t: Task): string {
  const when = t.time ? ` — ${t.time}` : "";
  return `• ${escapeHtml(t.title)}${when}`;
}

function digestText(heading: string, tasks: Task[], emptyLine: string): string {
  if (!tasks.length) return `${heading}\n\n${emptyLine}`;
  const sorted = [...tasks].sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  return `${heading}\n\n${sorted.map(formatTaskLine).join("\n")}`;
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
      .select("telegram_chat_id, user_id");
    if (error) throw error;

    for (const link of links || []) {
      const userId = link.user_id as string;
      const chatId = link.telegram_chat_id as number;

      const { data: settings } = await supabase
        .from("user_settings")
        .select("timezone, morning_digest, evening_digest, task_reminders")
        .eq("user_id", userId)
        .maybeSingle();

      let tz = settings?.timezone || "Europe/Moscow";
      let local;
      try {
        local = localParts(tz, now);
      } catch {
        tz = "Europe/Moscow"; // unknown tz stored: don't skip the user
        local = localParts(tz, now);
      }

      // Из той модели, в которой живёт аккаунт. Не прочитали — пропускаем
      // этого пользователя в этот запуск, а не считаем, что задач нет.
      let tasks: Task[];
      try {
        tasks = (await loadPlanner(supabase, userId, tz)).tasks || [];
      } catch (e) {
        console.error("reminders: read failed for", userId, e instanceof Error ? e.message : e);
        continue;
      }
      const open = tasks.filter((t) => !t.completed);

      // --- morning digest ---
      const morningTarget = MORNING_HOUR * 60;
      if (
        (settings?.morning_digest ?? true) &&
        local.minutes >= morningTarget && local.minutes < morningTarget + DIGEST_CATCH_UP_MIN
      ) {
        const todays = open.filter((t) => t.date === local.date);
        const text = digestText(
          "☀️ <b>План на сегодня</b>",
          todays,
          "На сегодня задач нет — можно спокойно выдохнуть."
        );
        if (await deliver(userId, "morning", "digest", local.date, chatId, text, planKeyboard(local.date))) sent++;
      }

      // --- evening digest (tomorrow's plan) ---
      const eveningTarget = EVENING_HOUR * 60;
      if (
        (settings?.evening_digest ?? true) &&
        local.minutes >= eveningTarget && local.minutes < eveningTarget + DIGEST_CATCH_UP_MIN
      ) {
        const tomorrow = addDays(local.date, 1);
        const next = open.filter((t) => t.date === tomorrow);
        const text = digestText(
          "🌙 <b>Что запланировано на завтра</b>",
          next,
          "На завтра пока ничего не запланировано."
        );
        if (await deliver(userId, "evening", "digest", local.date, chatId, text, planKeyboard(tomorrow))) sent++;
      }

      // --- per-task reminders, 30 minutes before the task's own moment ---
      // The moment comes from the task's date, time and the account timezone,
      // so a task at 00:10 is reminded at 23:40 the day before (A29).
      if (settings?.task_reminders ?? true) {
        const nowMs = now.getTime();
        for (const task of open) {
          if (!validDate(task.date) || !validTime(task.time)) continue;
          let win;
          try {
            win = reminderWindow(task.date, task.time, tz, REMINDER_LEAD_MIN);
          } catch {
            continue;
          }
          if (nowMs < win.fireAt || nowMs >= win.eventAt) continue;
          if (await sentUnderOldKey(userId, task.id, task.date)) continue;

          const text =
            `⏰ <b>Через ${Math.max(1, Math.round((win.eventAt - nowMs) / 60000))} мин</b>\n\n` +
            `<b>Задача:</b> ${escapeHtml(task.title)}\n` +
            `<b>Время:</b> ${task.time}` +
            (task.notes ? `\n<b>Описание:</b> ${escapeHtml(task.notes)}` : "");
          // the key includes the moment: a task moved to another time gets its own reminder
          if (await deliver(userId, "task", `${task.id}@${task.date}T${task.time}`, task.date, chatId, text)) sent++;
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, sent }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
