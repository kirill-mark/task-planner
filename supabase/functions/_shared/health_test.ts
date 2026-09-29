// deno test supabase/functions/_shared/health_test.ts — контроль работы (раздел 14).
import { assert, assertEquals } from "jsr:@std/assert@1";
import { dailyProblems, dailyText, problemsOf, type HealthReport } from "./health.ts";

const R = (o: Partial<HealthReport> = {}): HealthReport => ({
  since: "2026-09-29T20:00:00Z", now: "2026-09-29T21:00:00Z",
  ops: { "web:applied": 10 }, active_users: 1, updates: { done: 3 }, stuck_updates: 0,
  notifications: { sent: 4 }, stuck_notifications: 0, events: {},
  reminder_runs: 60, reminder_runs_failed: 0, reminder_last_run: "2026-09-29T20:59:00Z", reminder_max_gap_min: 1,
  http_failed: 0, backup_last_ok: "2026-09-29T03:17:00Z", ...o,
});

Deno.test("спокойный час — проблем нет", () => {
  assertEquals(problemsOf(R()), []);
  assertEquals(dailyProblems(R()), []);
});

Deno.test("остановка планировщика — и по перерыву, и по давности последнего запуска", () => {
  assertEquals(problemsOf(R({ reminder_max_gap_min: 7 })).map((p) => p.key), ["reminders-stopped"]);
  assertEquals(problemsOf(R({ reminder_last_run: "2026-09-29T20:50:00Z" })).map((p) => p.key), ["reminders-stopped"]);
  assertEquals(problemsOf(R({ reminder_last_run: null })).map((p) => p.key), ["reminders-stopped"]);
});

Deno.test("разовые сбои не будят; устойчивые — будят", () => {
  assertEquals(problemsOf(R({ http_failed: 2, updates: { done: 3, failed: 1 }, events: { "bot:provider_limit": 3 } })), []);
  const keys = problemsOf(R({ http_failed: 3, updates: { failed: 3 }, events: { "bot:provider_limit": 5, "bot:voice": 5 }, ops: { "web:rejected": 1 } })).map((p) => p.key);
  assertEquals(keys, ["http-failed", "bot-failed", "ops-rejected", "ai-limit", "ai-failed"]);
});

Deno.test("зависшие сообщения и уведомления — сразу", () => {
  assertEquals(problemsOf(R({ stuck_updates: 1, stuck_notifications: 1 })).map((p) => p.key), ["bot-stuck", "notify-stuck"]);
});

Deno.test("суточная сводка: резервная копия старше суток — проблема; текст без содержимого задач", () => {
  const r = R({ now: "2026-09-30T06:05:00Z", reminder_last_run: "2026-09-30T06:05:00Z", backup_last_ok: "2026-09-29T03:17:00Z" });
  const p = dailyProblems(r);
  assertEquals(p.map((x) => x.key), ["backup"]);
  const text = dailyText(r, p);
  assert(text.startsWith("⚠️"));
  assert(text.includes("Операции: 10 применено, 0 конфликтов (web 10)"));
  assert(dailyText(R(), []).startsWith("✅"));
});
