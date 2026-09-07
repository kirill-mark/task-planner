// Runs on a schedule (pg_cron, every 5 minutes) and sends:
//   - a morning digest with today's tasks,
//   - an evening digest with tomorrow's tasks,
//   - a per-task reminder 30 minutes before a task's own time.
// Everything is evaluated in each user's own timezone, and every send is
// recorded in sent_notifications so a retry or an overlapping run can't
// deliver the same message twice.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const MORNING_HOUR = 9;   // digest with today's plan
const EVENING_HOUR = 21;  // preview of tomorrow
const REMINDER_LEAD_MIN = 30;
const WINDOW_MIN = 5;     // cron cadence: how wide a match window we accept

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

async function sendMessage(chatId: number, text: string) {
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) console.error("telegram send failed", chatId, await res.text());
  return res.ok;
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

// Returns true when the send was recorded (i.e. it had not been sent yet).
async function claim(userId: string, kind: string, ref: string, localDate: string): Promise<boolean> {
  const { error } = await supabase
    .from("sent_notifications")
    .insert({ user_id: userId, kind, ref, local_date: localDate });
  if (error) {
    if (error.code === "23505") return false; // unique violation: already sent
    console.error("claim failed", error);
    return false;
  }
  return true;
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

      const tz = settings?.timezone || "Europe/Moscow";
      let local;
      try {
        local = localParts(tz, now);
      } catch {
        local = localParts("Europe/Moscow", now); // unknown tz stored: don't skip the user
      }

      const { data: stateRow } = await supabase
        .from("planner_state")
        .select("data")
        .eq("user_id", userId)
        .maybeSingle();
      const tasks: Task[] = stateRow?.data?.tasks || [];
      const open = tasks.filter((t) => !t.completed);

      // --- morning digest ---
      const morningTarget = MORNING_HOUR * 60;
      if (
        (settings?.morning_digest ?? true) &&
        local.minutes >= morningTarget && local.minutes < morningTarget + WINDOW_MIN
      ) {
        if (await claim(userId, "morning", "digest", local.date)) {
          const todays = open.filter((t) => t.date === local.date);
          const text = digestText(
            "☀️ <b>План на сегодня</b>",
            todays,
            "На сегодня задач нет — можно спокойно выдохнуть."
          );
          if (await sendMessage(chatId, text)) sent++;
        }
      }

      // --- evening digest (tomorrow's plan) ---
      const eveningTarget = EVENING_HOUR * 60;
      if (
        (settings?.evening_digest ?? true) &&
        local.minutes >= eveningTarget && local.minutes < eveningTarget + WINDOW_MIN
      ) {
        if (await claim(userId, "evening", "digest", local.date)) {
          const tomorrow = addDays(local.date, 1);
          const next = open.filter((t) => t.date === tomorrow);
          const text = digestText(
            "🌙 <b>Что запланировано на завтра</b>",
            next,
            "На завтра пока ничего не запланировано."
          );
          if (await sendMessage(chatId, text)) sent++;
        }
      }

      // --- per-task reminders, 30 minutes before ---
      if (settings?.task_reminders ?? true) {
        for (const task of open) {
          if (task.date !== local.date || !task.time) continue;
          const [h, m] = task.time.split(":").map(Number);
          if (Number.isNaN(h) || Number.isNaN(m)) continue;
          const fireAt = h * 60 + m - REMINDER_LEAD_MIN;
          if (local.minutes < fireAt || local.minutes >= fireAt + WINDOW_MIN) continue;

          if (await claim(userId, "task", task.id, local.date)) {
            const text =
              `⏰ <b>Через ${REMINDER_LEAD_MIN} минут</b>\n\n` +
              `<b>Задача:</b> ${escapeHtml(task.title)}\n` +
              `<b>Время:</b> ${task.time}` +
              (task.notes ? `\n<b>Описание:</b> ${escapeHtml(task.notes)}` : "");
            if (await sendMessage(chatId, text)) sent++;
          }
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
