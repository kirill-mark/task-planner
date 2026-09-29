// Контрольная оценка разбора сообщений (раздел 15 ТЗ): прогоняет набор
// _shared/eval_set.ts через тот же разбор и ту же модель, что и бот, и
// возвращает итог по примерам и полям. Ничего не пишет. Запуск — только
// владельцем проекта (расходует лимит ИИ-провайдера).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { parseMessage } from "../_shared/intent.ts";
import { callParseModel, calendarFrom, PARSE_MODEL } from "../_shared/groq.ts";
import { EVAL_SET, EVAL_TODAY, FIXTURE_GROUPS, FIXTURE_TASKS, scoreOne } from "../_shared/eval_set.ts";

const OWNER = "bd24e42b-16ba-4a98-90cb-209e1adf19f8";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const auth = req.headers.get("Authorization") || "";
  const caller = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: u } = await caller.auth.getUser();
  if (u?.user?.id !== OWNER) return json({ error: "forbidden" }, 403);

  const body = await req.json().catch(() => ({}));
  // Порциями и с паузой: лимит провайдера — 8000 токенов в минуту на весь
  // проект, а оценка не должна отнимать его у живого бота.
  const offset = Math.max(0, Number(body.offset) || 0), limit = Math.min(4, Math.max(1, Number(body.limit) || 4));
  const ctx = { today: EVAL_TODAY, calendar: calendarFrom(EVAL_TODAY), groups: FIXTURE_GROUPS, openTasks: FIXTURE_TASKS, newTaskDate: "inbox" as const };
  const results = [];
  // only — номера примеров для повторной проверки; ответ модели тогда
  // возвращается как есть (в наборе нет данных пользователей)
  const only: number[] = Array.isArray(body.only) ? body.only.filter((n: any) => Number.isInteger(n) && n >= 0 && n < EVAL_SET.length).slice(0, 4) : [];
  const picked = only.length ? only.map((i) => EVAL_SET[i]) : EVAL_SET.slice(offset, offset + limit);
  for (const [n, ex] of picked.entries()) {
    if (n > 0) await new Promise((r) => setTimeout(r, 12000));
    let parsed: any, error = null, raw = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      try { parsed = await parseMessage(ex.text, ctx, async (s, t) => (raw = await callParseModel(s, t))); error = null; break; }
      catch (e: any) { error = String(e?.message || e); if (e?.status === 429) await new Promise((r) => setTimeout(r, 15000)); else break; }
    }
    if (!parsed) parsed = { kind: "unclear", reason: error };
    const score = scoreOne(parsed, ex.expect);
    results.push({ text: ex.text, expect: ex.expect, got: parsed.kind === "add" ? { kind: "add", drafts: parsed.drafts.map((d: any) => ({ date: d.date, time: d.time, mode: d.dateMode })) }
      : parsed.kind === "unclear" ? { kind: "unclear", reason: parsed.reason } : { kind: parsed.kind, targets: parsed.targets.map((t: any) => t.id), date: parsed.date, time: parsed.time }, score, error, ...(only.length ? { raw } : {}) });
  }
  return json({ model: PARSE_MODEL, total: EVAL_SET.length, offset, results });
});
