// Правила контроля работы (раздел 14 ТЗ): что в сводке mark_health_report
// считается остановкой обработки. Только счётчики и технические признаки —
// ни текста задач, ни сообщений пользователей.

export type HealthReport = {
  since: string;
  now: string;
  ops: Record<string, number>;
  active_users: number;
  updates: Record<string, number>;
  stuck_updates: number;
  notifications: Record<string, number>;
  stuck_notifications: number;
  events: Record<string, number>;
  reminder_runs: number;
  reminder_runs_failed: number;
  reminder_last_run: string | null;
  reminder_max_gap_min: number;
  http_failed: number;
  backup_last_ok: string | null;
};

export type Problem = { key: string; text: string };

const sum = (o: Record<string, number>, pred: (k: string) => boolean) =>
  Object.entries(o || {}).filter(([k]) => pred(k)).reduce((a, [, n]) => a + n, 0);

export function problemsOf(r: HealthReport): Problem[] {
  const out: Problem[] = [];
  const now = Date.parse(r.now);
  if (!r.reminder_last_run || now - Date.parse(r.reminder_last_run) > 3 * 60000 || r.reminder_max_gap_min > 3) {
    out.push({ key: "reminders-stopped", text: `Планировщик напоминаний останавливался: наибольший перерыв ${r.reminder_max_gap_min} мин.` });
  }
  if (r.reminder_runs_failed > 0) out.push({ key: "reminders-failed", text: `Запуски напоминаний с ошибкой: ${r.reminder_runs_failed}.` });
  if (r.http_failed > 2) out.push({ key: "http-failed", text: `Обработчики по расписанию не ответили или ответили ошибкой: ${r.http_failed}.` });
  if (r.stuck_updates > 0) out.push({ key: "bot-stuck", text: `Сообщения боту зависли в обработке: ${r.stuck_updates}.` });
  const failedUpdates = r.updates?.failed || 0;
  if (failedUpdates > 2) out.push({ key: "bot-failed", text: `Сообщения боту завершились ошибкой: ${failedUpdates}.` });
  if (r.stuck_notifications > 0) out.push({ key: "notify-stuck", text: `Уведомления зависли в отправке: ${r.stuck_notifications}.` });
  const unknown = r.notifications?.unknown || 0;
  if (unknown > 2) out.push({ key: "notify-unknown", text: `Уведомления с неизвестной доставкой: ${unknown}.` });
  const rejected = sum(r.ops, (k) => k.endsWith(":rejected"));
  if (rejected > 0) out.push({ key: "ops-rejected", text: `Операции, отклонённые сервером: ${rejected}.` });
  const limits = sum(r.events, (k) => k.endsWith(":provider_limit"));
  if (limits >= 5) out.push({ key: "ai-limit", text: `ИИ-провайдер упирался в лимит: ${limits} раз.` });
  const aiFail = sum(r.events, (k) => k.endsWith(":provider") || k.endsWith(":voice") || k.endsWith(":parse"));
  if (aiFail >= 5) out.push({ key: "ai-failed", text: `Сбои разбора, речи или ИИ-провайдера: ${aiFail}.` });
  if (sum(r.events, (k) => k === "reminders:read") > 0) out.push({ key: "reminders-read", text: "Рассылка не смогла прочитать задачи части аккаунтов." });
  return out;
}

// Суточная сводка добавляет проверку резервной копии: её расписание — раз в сутки.
export function dailyProblems(r: HealthReport): Problem[] {
  const out = problemsOf(r);
  if (!r.backup_last_ok || Date.parse(r.now) - Date.parse(r.backup_last_ok) > 26 * 3600000) {
    out.push({ key: "backup", text: "Резервная копия не делалась больше суток." });
  }
  return out;
}

export function dailyText(r: HealthReport, problems: Problem[]): string {
  const ops = r.ops || {};
  const applied = sum(ops, (k) => k.endsWith(":applied")), conflicts = sum(ops, (k) => k.endsWith(":conflict"));
  const bySource = ["web", "miniapp", "bot", "assistant"].map((s) => [s, sum(ops, (k) => k.startsWith(s + ":"))] as const).filter(([, n]) => n);
  const n = r.notifications || {};
  const ev = Object.entries(r.events || {}).map(([k, v]) => `${k} ${v}`).join(", ");
  return [
    problems.length ? "⚠️ <b>MARK: есть проблемы за сутки</b>" : "✅ <b>MARK: сутки без сбоев</b>",
    ...problems.map((p) => "• " + p.text),
    "",
    `Операции: ${applied} применено, ${conflicts} конфликтов${bySource.length ? " (" + bySource.map(([s, v]) => `${s} ${v}`).join(", ") + ")" : ""}; активных аккаунтов ${r.active_users}.`,
    `Бот: ${r.updates?.done || 0} обновлений, ошибок ${r.updates?.failed || 0}.`,
    `Уведомления: отправлено ${n.sent || 0}, не доставлено ${n.failed || 0}, неизвестно ${n.unknown || 0}, просрочено ${n.expired || 0}.`,
    `Планировщик: ${r.reminder_runs} запусков, наибольший перерыв ${r.reminder_max_gap_min} мин.`,
    `ИИ и речь: ${ev || "сбоев нет"}.`,
    `Резервная копия: ${r.backup_last_ok ? r.backup_last_ok.slice(0, 16).replace("T", " ") + " UTC" : "нет"}.`,
  ].join("\n");
}
