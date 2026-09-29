// Telegram-бот MARK (раздел 9 ТЗ).
//
// Порядок обработки одного обновления:
//   1. секрет webhook — до разбора тела (R2);
//   2. update_id захватывается в журнале: повтор от Telegram не обрабатывается
//      второй раз (D07, A25);
//   3. сообщение или кнопка: разбор намерения моделью, проверка ответа
//      сервером (_shared/intent.ts), запись через слой операций
//      (_shared/planner.ts). «Добавлено» — только после принятой записи (A24).
//
// Одна понятная задача сохраняется сразу — с кнопкой «Отменить добавление».
// Несколько задач, удаление и перенос дедлайна — только после подтверждения.
// Сбой разбора не превращается в задачу: текст ждёт черновиком (D06, A23).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { loadPlanner, savePlanner, restoreTask } from "../_shared/planner.ts";
import { validDate, validTime } from "../_shared/time.ts";
import { buildEditPrompt, normalizeEdit, parseMessage, type Draft, type GroupInfo, type ParseContext, type TaskRef } from "../_shared/intent.ts";
import { buttonLabel, esc, relDay, splitMessage, taskCard, transcriptBlock } from "../_shared/botfmt.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY") || "";
// Shared with Telegram via setWebhook(secret_token). The function is deployed
// without JWT verification, so without this anyone knowing the URL could post
// a forged update.
const WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") || "";
const MINI_APP_URL = "https://kirill-mark.github.io/task-planner/";

const ASCII_ONLY = /^[\x20-\x7E]*$/;
const badSecrets: string[] = [];
for (const [name, val] of Object.entries({ SUPABASE_URL, SERVICE_ROLE_KEY, TELEGRAM_BOT_TOKEN, GROQ_API_KEY })) {
  if (!val) {
    console.error(`missing secret: ${name}`);
    badSecrets.push(`${name} не задан`);
  } else if (!ASCII_ONLY.test(val)) {
    console.error(`secret ${name} contains invalid (non-ASCII) characters, length ${val.length}`);
    badSecrets.push(`${name} содержит недопустимые символы`);
  }
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const withTimeout = () => AbortSignal.timeout(20000);
const api = (method: string) => `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`;

type Button = { text: string; callback_data?: string; web_app?: { url: string } };
type Keyboard = { inline_keyboard: Button[][] };
type ReplyKeyboard = { keyboard: { text: string }[][]; resize_keyboard: boolean; is_persistent: boolean };

type Task = {
  id: string;
  title: string;
  notes: string;
  date: string;
  time: string;
  dateMode: "due" | "on";
  groupId: string | null;
  completed: boolean;
  createdAt: number;
};

// ------------------------------------------------------------ Telegram API --

async function tg(method: string, body: unknown): Promise<any> {
  const res = await fetch(api(method), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: withTimeout(),
  });
  // Telegram отвечает 200 и с ok:false — проверяются оба признака
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) console.error(`${method} failed`, res.status, json?.description);
  return json;
}

async function sendMessage(chatId: number, text: string, opts: { html?: boolean; keyboard?: Keyboard | ReplyKeyboard } = {}) {
  const parts = splitMessage(text);
  let last: any = null;
  for (let i = 0; i < parts.length; i++) {
    last = await tg("sendMessage", {
      chat_id: chatId,
      text: parts[i],
      parse_mode: opts.html ? "HTML" : undefined,
      reply_markup: i === parts.length - 1 ? opts.keyboard : undefined,
      link_preview_options: { is_disabled: true },
    });
  }
  return last?.result?.message_id as number | undefined;
}

async function editMessage(chatId: number, messageId: number, text: string, keyboard?: Keyboard) {
  return tg("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: splitMessage(text)[0],
    parse_mode: "HTML",
    reply_markup: keyboard || { inline_keyboard: [] },
    link_preview_options: { is_disabled: true },
  });
}

const answerCallback = (id: string, text?: string) => tg("answerCallbackQuery", { callback_query_id: id, text });

// ------------------------------------------------------------- клавиатуры --

const BTN_ADD = "➕ Добавить задачу";
const BTN_UPCOMING = "📋 Ближайшие задачи";
const BTN_SECTION = "🗂 Добавить раздел";
const BTN_TOMORROW = "🌙 Задачи на завтра";
const BTN_TODAY = "☀️ План на сегодня";

function mainKeyboard(): ReplyKeyboard {
  return {
    keyboard: [
      [{ text: BTN_ADD }, { text: BTN_UPCOMING }],
      [{ text: BTN_SECTION }, { text: BTN_TOMORROW }],
      [{ text: BTN_TODAY }], // alone in its row, so Telegram renders it full width
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

const openButton = (taskId?: string): Button => ({
  text: "📱 Открыть",
  web_app: { url: MINI_APP_URL + (taskId ? `#/tasks?open=${encodeURIComponent(taskId)}` : "") },
});

// Карточка задачи: «Выполнено · Изменить · Открыть»; сразу после добавления —
// ещё «В корзину · Отменить добавление» (раздел 9).
function taskKeyboard(task: Task, justAdded = false): Keyboard {
  const rows: Button[][] = [[
    task.completed
      ? { text: "↩️ Вернуть в работу", callback_data: `undone:${task.id}` }
      : { text: "✅ Выполнено", callback_data: `done:${task.id}` },
    { text: "✏️ Изменить", callback_data: `edit:${task.id}` },
    openButton(task.id),
  ]];
  rows.push(justAdded
    ? [{ text: "🗑 В корзину", callback_data: `del:${task.id}` }, { text: "↩️ Отменить добавление", callback_data: `undo:${task.id}` }]
    : [{ text: "🗑 В корзину", callback_data: `del:${task.id}` }]);
  return { inline_keyboard: rows };
}

function planKeyboard(date: string): Keyboard {
  return {
    inline_keyboard: [[
      { text: "➕ Добавить задачу", callback_data: `padd:${date}` },
      { text: "🗑 Удалить задачу", callback_data: `pdel:${date}` },
    ]],
  };
}

// ---------------------------------------------------------------- контекст --

function localDate(tz: string, offsetDays = 0): string {
  const base = new Date(Date.now() + offsetDays * 86400000);
  const parts: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(base)) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }
  return `${parts.year}-${parts.month}-${parts.day}`;
}

const WEEKDAYS = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];

// Небольшая модель путает дни недели — ей даётся готовый календарь.
function calendarHint(tz: string, days = 21): string {
  const [y, m, d] = localDate(tz).split("-").map(Number);
  const lines: string[] = [];
  for (let i = 0; i < days; i++) {
    const dt = new Date(Date.UTC(y, m - 1, d + i));
    const label = i === 0 ? " (сегодня)" : i === 1 ? " (завтра)" : i === 2 ? " (послезавтра)" : "";
    lines.push(`${dt.toISOString().slice(0, 10)} — ${WEEKDAYS[dt.getUTCDay()]}${label}`);
  }
  return lines.join("\n");
}

type Ctx = {
  userId: string;
  state: any;
  tz: string;
  today: string;
  tomorrow: string;
  groups: GroupInfo[];
  newTaskDate: "inbox" | "today";
};

async function loadCtx(userId: string): Promise<Ctx> {
  const { data: s } = await supabase.from("user_settings").select("timezone, new_task_date").eq("user_id", userId).maybeSingle();
  let tz = s?.timezone || "Europe/Moscow";
  try { localDate(tz); } catch { tz = "Europe/Moscow"; }
  const state = await loadPlanner(supabase, userId, tz);
  const groups: GroupInfo[] = (state.groups || []).map((g: any) => ({
    id: g.id, name: g.name,
    sectionName: (state.sections || []).find((x: any) => x.id === g.sectionId)?.name || "",
  }));
  return {
    userId, state, tz, today: localDate(tz), tomorrow: localDate(tz, 1), groups,
    newTaskDate: s?.new_task_date === "today" ? "today" : "inbox",
  };
}

async function save(ctx: Ctx) {
  await savePlanner(supabase, ctx.userId, ctx.state, "bot");
}

function pathOf(ctx: Ctx, groupId: string | null): string {
  const g = ctx.groups.find((x) => x.id === groupId);
  if (!g) return "Входящие";
  return g.sectionName ? `${g.sectionName} → ${g.name}` : g.name;
}

const findTask = (ctx: Ctx, id: string): Task | undefined => (ctx.state.tasks || []).find((t: Task) => t.id === id);

function card(ctx: Ctx, heading: string, t: Task, extra: string[] = []) {
  return taskCard(heading, t, pathOf(ctx, t.groupId), ctx.today, extra);
}

function parseCtx(ctx: Ctx): ParseContext {
  return {
    today: ctx.today,
    calendar: calendarHint(ctx.tz),
    groups: ctx.groups,
    openTasks: (ctx.state.tasks || []).filter((t: Task) => !t.completed)
      .map((t: Task) => ({ id: t.id, title: t.title, notes: t.notes, date: t.date, time: t.time, dateMode: t.dateMode })),
    newTaskDate: ctx.newTaskDate,
  };
}

async function callModel(system: string, user: string): Promise<string> {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROQ_API_KEY}` },
    body: JSON.stringify({
      model: "openai/gpt-oss-20b",
      max_tokens: 900,
      reasoning_effort: "low",
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
    signal: withTimeout(),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Groq: ${json?.error?.message || res.status}`);
  return json?.choices?.[0]?.message?.content || "";
}

async function transcribeVoice(fileId: string): Promise<string> {
  const fileJson = await (await fetch(api(`getFile?file_id=${fileId}`), { signal: withTimeout() })).json();
  const filePath = fileJson.result?.file_path;
  if (!filePath) throw new Error("Не удалось получить голосовой файл от Telegram");
  if ((fileJson.result?.file_size || 0) > 20 * 1024 * 1024) throw new Error("Голосовое слишком длинное");
  const audio = await (await fetch(`https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`, { signal: withTimeout() })).blob();
  const form = new FormData();
  form.append("file", audio, "voice.ogg");
  form.append("model", "whisper-large-v3");
  form.append("language", "ru");
  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST", headers: { Authorization: `Bearer ${GROQ_API_KEY}` }, body: form, signal: AbortSignal.timeout(30000),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`распознавание речи: ${json?.error?.message || res.status}`);
  return String(json?.text || "").trim();
}

// ---------------------------------------------------------- отложенные шаги --

async function setPending(chatId: number, action: string, taskId: string | null = null, payload: unknown = null) {
  await supabase.from("telegram_pending_actions").upsert({
    telegram_chat_id: chatId, action, task_id: taskId,
    payload: payload === null ? null : typeof payload === "string" ? payload : JSON.stringify(payload),
    created_at: new Date().toISOString(),
  });
}

async function getPending(chatId: number) {
  const { data } = await supabase.from("telegram_pending_actions").select("action, task_id, payload, created_at").eq("telegram_chat_id", chatId).maybeSingle();
  // общий срок ожидания — 30 минут: истёкшее не применяется к случайному сообщению
  if (data && Date.now() - new Date(data.created_at).getTime() > 30 * 60 * 1000) {
    await clearPending(chatId);
    return { ...data, expired: true };
  }
  return data;
}

const clearPending = (chatId: number) => supabase.from("telegram_pending_actions").delete().eq("telegram_chat_id", chatId);

// ------------------------------------------------------------------ задачи --

function taskFromDraft(d: Draft): Task {
  return {
    id: crypto.randomUUID(), title: d.title, notes: d.notes, date: d.date, time: d.date ? d.time : "",
    dateMode: d.dateMode, groupId: d.groupId, completed: false, createdAt: Date.now(),
  };
}

function draftsText(ctx: Ctx, drafts: Draft[], heading: string) {
  const lines = drafts.map((d, i) => `${i + 1}. <b>${esc(d.title)}</b>\n    ${esc(d.date ? relDay(d.date, ctx.today, ctx.tomorrow) + (d.time ? " · " + d.time : "") + (d.dateMode === "due" ? " (дедлайн)" : "") : "без даты")} · ${esc(pathOf(ctx, d.groupId))}`);
  return `<b>${esc(heading)}</b>\n\n${lines.join("\n")}`;
}

function draftsKeyboard(drafts: Draft[]): Keyboard {
  const rows: Button[][] = [[{ text: `✅ Добавить ${drafts.length > 1 ? "все (" + drafts.length + ")" : ""}`.trim(), callback_data: "dr:add" }, { text: "✖️ Отмена", callback_data: "dr:cancel" }]];
  drafts.forEach((d, i) => rows.push([
    { text: `✏️ ${i + 1}. ${buttonLabel(d.title, 28)}`, callback_data: `dr:ed:${i}` },
    { text: `🗑 ${i + 1}`, callback_data: `dr:rm:${i}` },
  ]));
  return { inline_keyboard: rows };
}

function whenShort(ctx: Ctx, t: Task) {
  return t.date ? relDay(t.date, ctx.today, ctx.tomorrow) + (t.time ? " · " + t.time : "") : "без даты";
}

function choiceKeyboard(ctx: Ctx, action: string, targets: TaskRef[]): Keyboard {
  const rows = targets.slice(0, 8).map((t) => {
    const task = findTask(ctx, t.id)!;
    return [{ text: buttonLabel(`${task.title} — ${whenShort(ctx, task)}`, 60), callback_data: `pick:${action}:${t.id}` }];
  });
  rows.push([{ text: "✖️ Отмена", callback_data: "pick:cancel:-" }]);
  return { inline_keyboard: rows };
}

function planText(ctx: Ctx, date: string, heading: string): string {
  const tasks: Task[] = (ctx.state.tasks || []).filter((t: Task) => !t.completed && t.date === date)
    .sort((a: Task, b: Task) => (a.time || "99").localeCompare(b.time || "99"));
  if (!tasks.length) return `${heading}\n\nЗадач нет.`;
  return `${heading}\n\n` + tasks.map((t) => `• ${t.time ? `<b>${t.time}</b> ` : ""}${esc(t.title)}${t.dateMode === "due" ? " <i>(дедлайн)</i>" : ""}`).join("\n");
}

async function addDrafts(chatId: number, ctx: Ctx, drafts: Draft[], extra: string[] = [], editId?: number) {
  const tasks = drafts.map(taskFromDraft);
  ctx.state.tasks = [...(ctx.state.tasks || []), ...tasks];
  await save(ctx); // бросает при отказе базы: «Добавлено» без записи не бывает (A24)
  for (const t of tasks) {
    const text = card(ctx, tasks.length > 1 ? "Добавлено" : "Добавлено", t, extra);
    if (editId && tasks.length === 1) await editMessage(chatId, editId, text, taskKeyboard(t, true));
    else await sendMessage(chatId, text, { html: true, keyboard: taskKeyboard(t, true) });
  }
}

// ---------------------------------------------------------------- сообщения --

const HELP = [
  "<b>Как пользоваться</b>",
  "Пишите или говорите задачами — бот разберёт дату, время и группу:",
  "• «созвон с клиентом завтра в 11»",
  "• «отчёт до пятницы»",
  "• «купить хлеб, позвонить маме и написать Олегу» — три задачи, покажу черновики",
  "• «перенеси встречу с Олегом на пятницу», «встреча с Олегом готова», «удали отчёт»",
  "Без даты задача попадает во «Входящие».",
  "",
  "/cancel — отменить текущий диалог",
  "/menu — показать кнопки",
].join("\n");

async function handleMessage(message: any) {
  const chatId: number = message.chat.id;
  const username: string | null = message.from?.username || null;
  if (message.chat?.type && message.chat.type !== "private") return; // групповые чаты не обслуживаются

  if (badSecrets.length > 0) {
    await sendMessage(chatId, `Бот неправильно настроен на сервере:\n${badSecrets.join("\n")}`);
    return;
  }

  const text0: string = typeof message.text === "string" ? message.text.trim() : "";

  // --- привязка: /start <код> ---
  if (text0.startsWith("/start")) {
    const code = text0.split(" ")[1];
    if (!code) {
      await sendMessage(chatId, "Привет! Я добавляю задачи в MARK текстом и голосом.\n\nЧтобы начать: откройте приложение → кабинет → «Подключить Telegram» и перейдите по ссылке оттуда.", { keyboard: mainKeyboard() });
      return;
    }
    // Проверка, погашение и привязка — одна транзакция в базе (R4, R6).
    const { data: redeemed, error } = await supabase.rpc("mark_redeem_link_code", { p_code: code, p_chat_id: chatId, p_username: username });
    if (error) throw new Error(`не удалось привязать: ${error.message}`);
    const status = redeemed?.status;
    if (status === "invalid" || status === "expired") {
      await sendMessage(chatId, status === "expired" ? "Срок действия кода истёк — он живёт 10 минут. Создайте новый в приложении." : "Код недействителен или уже использован. Создайте новый в приложении.");
      return;
    }
    if (status === "chat_taken") {
      await sendMessage(chatId, "Этот Telegram уже привязан к другому аккаунту MARK. Чтобы привязать его сюда, сначала отвяжите его в том аккаунте: кабинет → Telegram → «Отвязать».");
      return;
    }
    await sendMessage(chatId, (status === "already" ? "Этот чат уже привязан к аккаунту ✅" : "Готово! Аккаунт привязан ✅") +
      (redeemed?.replaced ? " Прежний чат от аккаунта отвязан." : "") + "\n\nПрисылайте задачи текстом или голосом. /help — примеры.", { keyboard: mainKeyboard() });
    return;
  }

  if (text0 === "/menu") { await sendMessage(chatId, "Кнопки внизу 👇", { keyboard: mainKeyboard() }); return; }
  if (text0 === "/help") { await sendMessage(chatId, HELP, { html: true, keyboard: mainKeyboard() }); return; }
  if (text0 === "/cancel") {
    await clearPending(chatId);
    await sendMessage(chatId, "Отменено. Можно начинать заново.", { keyboard: mainKeyboard() });
    return;
  }

  // --- аккаунт ---
  const { data: link } = await supabase.from("telegram_links").select("user_id, blocked_at").eq("telegram_chat_id", chatId).maybeSingle();
  if (!link) {
    await sendMessage(chatId, "Сначала привяжите аккаунт: в приложении MARK откройте кабинет → «Подключить Telegram» и перейдите по ссылке.");
    return;
  }
  const userId = link.user_id as string;
  // человек снова пишет боту — значит, разблокировал: доставка возобновляется
  if (link.blocked_at) await supabase.from("telegram_links").update({ blocked_at: null }).eq("telegram_chat_id", chatId);

  // --- текст или голос ---
  let input = typeof message.text === "string" ? message.text : message.caption || "";
  let transcript: string | null = null;
  let statusMsgId: number | undefined;
  if (message.voice) {
    statusMsgId = await sendMessage(chatId, "Распознаю…");
    try {
      transcript = await transcribeVoice(message.voice.file_id);
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      if (statusMsgId) await editMessage(chatId, statusMsgId, `Не удалось распознать голосовое (${esc(why)}). Задача не создана — повторите или напишите текстом.`);
      return;
    }
    // тишина и неразборчивая запись задачу не создают
    if (transcript.replace(/[^\p{L}\p{N}]/gu, "").length < 2) {
      if (statusMsgId) await editMessage(chatId, statusMsgId, "Не расслышал слов в записи — задача не создана. Повторите или напишите текстом.");
      return;
    }
    input = transcript;
  }
  input = input.trim();
  if (!input) {
    await sendMessage(chatId, "Пришлите задачу текстом или голосовым.");
    return;
  }
  const reply = async (text: string, keyboard?: Keyboard | ReplyKeyboard) => {
    if (statusMsgId && (!keyboard || "inline_keyboard" in keyboard)) {
      await editMessage(chatId, statusMsgId, text, keyboard as Keyboard | undefined);
      statusMsgId = undefined;
    } else await sendMessage(chatId, text, { html: true, keyboard });
  };
  const extra = transcript ? [transcriptBlock(transcript)] : [];

  const ctx = await loadCtx(userId);

  // --- кнопки меню: всегда команда, а не ответ на прежний вопрос ---
  if ([BTN_ADD, BTN_UPCOMING, BTN_SECTION, BTN_TOMORROW, BTN_TODAY].includes(input)) {
    await clearPending(chatId);
    if (input === BTN_ADD) {
      await sendMessage(chatId, "➕ Пришлите задачу текстом или голосовым — например «созвон с клиентом завтра в 11:00».", { keyboard: mainKeyboard() });
    } else if (input === BTN_UPCOMING) {
      const upcoming: Task[] = (ctx.state.tasks || []).filter((t: Task) => !t.completed && t.date)
        .sort((a: Task, b: Task) => a.date.localeCompare(b.date) || (a.time || "99").localeCompare(b.time || "99")).slice(0, 20);
      const inbox = (ctx.state.tasks || []).filter((t: Task) => !t.completed && !t.date).length;
      const lines = upcoming.map((t) => `${t.date < ctx.today ? "❗️ " : "• "}${esc(t.title)} — ${esc(whenShort(ctx, t))}${t.dateMode === "due" ? " <i>(дедлайн)</i>" : ""}`);
      await sendMessage(chatId, (lines.length ? `📋 <b>Ближайшие задачи</b>\n\n${lines.join("\n")}` : "Задач с датой нет.") +
        (inbox ? `\n\nВо «Входящих» без даты: ${inbox}.` : ""), { html: true, keyboard: mainKeyboard() });
    } else if (input === BTN_SECTION) {
      await setPending(chatId, "add_section");
      await sendMessage(chatId, "🗂 Как назвать новый раздел? /cancel — отменить.", { keyboard: mainKeyboard() });
    } else if (input === BTN_TOMORROW) {
      await sendMessage(chatId, planText(ctx, ctx.tomorrow, "🌙 <b>Задачи на завтра</b>"), { html: true, keyboard: planKeyboard(ctx.tomorrow) });
    } else {
      await sendMessage(chatId, planText(ctx, ctx.today, "☀️ <b>План на сегодня</b>"), { html: true, keyboard: planKeyboard(ctx.today) });
    }
    return;
  }

  const pending = await getPending(chatId);
  if (pending && (pending as any).expired) {
    await sendMessage(chatId, "Предыдущее ожидание истекло (прошло больше 30 минут) — разбираю это сообщение как новое.");
  }
  const active = pending && !(pending as any).expired ? pending : null;

  // --- новый раздел, затем предложение добавить в него группу ---
  if (active?.action === "add_section") {
    const name = input.slice(0, 80);
    const palette = ["#7FA7D9", "#6ED6A0", "#F2B861", "#E0698E", "#9B6BDB", "#4FB3BF", "#E05C5C", "#7D8CA3"];
    const id = crypto.randomUUID();
    ctx.state.sections = [...(ctx.state.sections || []), { id, name, color: palette[(ctx.state.sections || []).length % palette.length] }];
    await save(ctx);
    await setPending(chatId, "add_group", null, id);
    await sendMessage(chatId, `🗂 Раздел «${esc(name)}» создан.\n\nКак назвать первую группу в нём? /cancel — не сейчас.`, { html: true });
    return;
  }
  if (active?.action === "add_group" && active.payload) {
    const name = input.slice(0, 80);
    ctx.state.groups = [...(ctx.state.groups || []), { id: crypto.randomUUID(), name, color: "#7FA7D9", sectionId: active.payload }];
    await save(ctx);
    await clearPending(chatId);
    const sec = (ctx.state.sections || []).find((s: any) => s.id === active.payload);
    await sendMessage(chatId, `Группа «${esc(name)}» добавлена в раздел «${esc(sec?.name || "")}». Теперь задачи могут попадать в неё.`, { html: true, keyboard: mainKeyboard() });
    return;
  }

  // --- правка задачи ---
  if (active?.action === "edit" && active.task_id) {
    await clearPending(chatId);
    const task = findTask(ctx, active.task_id);
    if (!task) { await reply("Эта задача уже удалена — изменять нечего."); return; }
    await applyEdit(chatId, ctx, task, input, reply, extra);
    return;
  }

  // --- правка одного из черновиков ---
  if (active?.action === "draft_edit" && active.payload) {
    const st = JSON.parse(active.payload);
    const d: Draft = st.drafts[st.index];
    const pc = parseCtx(ctx);
    const patch = normalizeEdit(JSON.parse((await callModel(buildEditPrompt(pc, { id: "draft", title: d.title, notes: d.notes, date: d.date, time: d.time, dateMode: d.dateMode, groupId: d.groupId }), input)).match(/\{[\s\S]*\}/)?.[0] || "{}"), pc);
    Object.assign(d, {
      ...(patch.title ? { title: patch.title } : {}), ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      ...(patch.date ? { date: patch.date } : {}), ...(patch.time ? { time: patch.time } : {}),
      ...(patch.dateMode ? { dateMode: patch.dateMode } : {}), ...("groupId" in patch ? { groupId: patch.groupId } : {}),
      ...(patch.clearTime ? { time: "" } : {}),
    });
    await setPending(chatId, "drafts", null, { drafts: st.drafts });
    await reply(draftsText(ctx, st.drafts, "Черновики обновлены — проверьте:"), draftsKeyboard(st.drafts));
    return;
  }

  // --- добавление на день из кнопки плана ---
  const forDate = active?.action === "add_for_date" && validDate(active.payload) ? active.payload as string : null;
  if (forDate) await clearPending(chatId);

  // --- разбор ---
  let parsed;
  try {
    parsed = await parseMessage(input, parseCtx(ctx), callModel);
  } catch (e) {
    console.error("parse failed:", e instanceof Error ? e.message : e);
    parsed = { kind: "unclear" as const, reason: "сбой разбора" };
  }

  if (parsed.kind === "unclear") {
    // Сбой или непонятное — задача не создаётся; текст ждёт решения (D06, A23).
    await setPending(chatId, "draft", null, input.slice(0, 2000));
    await reply(`Не смог разобрать (${esc(parsed.reason)}) — задача не создана, текст сохранён черновиком:\n\n«${esc(input.slice(0, 300))}»`, {
      inline_keyboard: [[{ text: "🔁 Повторить", callback_data: "draft:retry" }, { text: "➕ Добавить как есть", callback_data: "draft:asis" }], [{ text: "✖️ Отмена", callback_data: "draft:cancel" }]],
    });
    return;
  }

  if (parsed.kind === "add") {
    const drafts = parsed.drafts.map((d) => forDate ? { ...d, date: forDate } : d);
    if (drafts.length === 1) {
      await clearPending(chatId);
      const tasks0 = drafts.map(taskFromDraft);
      ctx.state.tasks = [...(ctx.state.tasks || []), ...tasks0];
      await save(ctx);
      await reply(card(ctx, "Добавлено", tasks0[0], extra), taskKeyboard(tasks0[0], true));
      return;
    }
    // несколько задач — только после подтверждения (A19)
    await setPending(chatId, "drafts", null, { drafts });
    await reply(draftsText(ctx, drafts, `Нашёл ${drafts.length} задачи — проверьте перед сохранением:`) + (transcript ? "\n" + transcriptBlock(transcript) : ""), draftsKeyboard(drafts));
    return;
  }

  // удалить / выполнить / перенести
  const targets = parsed.targets;
  if (targets.length > 1) {
    const action = parsed.kind === "move" ? "mv" : parsed.kind === "delete" ? "del" : "done";
    if (parsed.kind === "move") await setPending(chatId, "move", null, { date: parsed.date, time: parsed.time, dateMode: parsed.dateMode });
    await reply(`Нашёл несколько похожих задач. Какую ${parsed.kind === "move" ? "перенести" : parsed.kind === "delete" ? "удалить" : "отметить выполненной"}?`, choiceKeyboard(ctx, action, targets));
    return;
  }
  const task = findTask(ctx, targets[0].id);
  if (!task) { await reply("Задача не найдена — возможно, её уже удалили."); return; }
  if (parsed.kind === "done") {
    task.completed = true;
    await save(ctx);
    await reply(card(ctx, "Выполнено ✅", task, extra), taskKeyboard(task));
  } else if (parsed.kind === "delete") {
    // удаление — с подтверждением (раздел 8, A22)
    await reply(card(ctx, "Удалить эту задачу?", task), { inline_keyboard: [[{ text: "🗑 Да, в корзину", callback_data: `cdel:${task.id}` }, { text: "✖️ Нет", callback_data: "pick:cancel:-" }]] });
  } else if (parsed.kind === "move") {
    await applyMove(chatId, ctx, task, parsed, reply, extra);
  }
}

// Перенос меняет только дату (и время, если названо); описание, группа и
// второй срок не трогаются (A21). Дедлайн переносится только после подтверждения.
async function applyMove(chatId: number, ctx: Ctx, task: Task, mv: { date: string; time: string | null; dateMode: "on" | "due" | null }, reply: (t: string, k?: Keyboard) => Promise<void>, extra: string[] = []) {
  const mode = mv.dateMode || task.dateMode;
  if (mode === "due" && task.date && task.dateMode === "due") {
    await setPending(chatId, "move_confirm", task.id, mv);
    await reply(card(ctx, `Перенести дедлайн на ${relDay(mv.date, ctx.today, ctx.tomorrow)}${mv.time ? " · " + mv.time : ""}?`, task), {
      inline_keyboard: [[{ text: "✅ Перенести", callback_data: `mvok:${task.id}` }, { text: "✖️ Нет", callback_data: "pick:cancel:-" }]],
    });
    return;
  }
  task.date = mv.date;
  if (mv.time) task.time = mv.time;
  task.dateMode = mode;
  await save(ctx);
  await reply(card(ctx, "Перенесено", task, extra), taskKeyboard(task));
}

async function applyEdit(chatId: number, ctx: Ctx, task: Task, instruction: string, reply: (t: string, k?: Keyboard) => Promise<void>, extra: string[] = []) {
  const pc = parseCtx(ctx);
  const raw = await callModel(buildEditPrompt(pc, { id: task.id, title: task.title, notes: task.notes, date: task.date, time: task.time, dateMode: task.dateMode, groupId: task.groupId }), instruction);
  let json: any = {};
  try { json = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || "{}"); } catch { /* пустая правка ниже */ }
  const patch = normalizeEdit(json, pc);
  if (!Object.keys(patch).length) {
    await reply("Не понял, что изменить — задача осталась прежней. Попробуйте ещё раз: «перенеси на пятницу», «время 15:00».", taskKeyboard(task));
    return;
  }
  if (patch.title) task.title = patch.title;
  if (patch.notes !== undefined) task.notes = patch.notes;
  if (patch.date) task.date = patch.date;
  if (patch.time && task.date) task.time = patch.time;
  if (patch.clearTime) task.time = "";
  if (patch.dateMode) task.dateMode = patch.dateMode;
  if (patch.groupId) task.groupId = patch.groupId;
  await save(ctx);
  await reply(card(ctx, "Изменено ✏️", task, extra), taskKeyboard(task));
}

// ------------------------------------------------------------------ кнопки --

async function handleCallback(cb: any) {
  const chatId: number = cb.message.chat.id;
  const messageId: number = cb.message.message_id;
  const [action, arg, arg2] = String(cb.data || "").split(":");

  const { data: link } = await supabase.from("telegram_links").select("user_id").eq("telegram_chat_id", chatId).maybeSingle();
  if (!link) { await answerCallback(cb.id, "Аккаунт не привязан"); return; }
  const userId = link.user_id as string;
  const ctx = await loadCtx(userId);
  const edit = (text: string, kb?: Keyboard) => editMessage(chatId, messageId, text, kb);

  // --- черновик после сбоя разбора ---
  if (action === "draft") {
    const pending = await getPending(chatId);
    if (pending?.action !== "draft" || typeof pending.payload !== "string") {
      await answerCallback(cb.id, "Черновик уже неактуален");
      await edit("Черновик уже обработан или заменён новым сообщением.");
      return;
    }
    await clearPending(chatId);
    const text = pending.payload;
    if (arg === "cancel") { await answerCallback(cb.id, "Отменено"); await edit(`Черновик удалён, ничего не сохранено:\n<s>${esc(text.slice(0, 300))}</s>`); return; }
    if (arg === "retry") {
      await answerCallback(cb.id, "Пробую ещё раз");
      await edit(`🔁 Разбираю ещё раз:\n«${esc(text.slice(0, 300))}»`);
      await handleMessage({ chat: { id: chatId, type: "private" }, from: cb.from, text });
      return;
    }
    if (arg === "asis") {
      const d: Draft = { title: text.trim().slice(0, 200), notes: "", date: ctx.newTaskDate === "today" ? ctx.today : "", time: "", dateMode: "due", groupId: null };
      await answerCallback(cb.id, "Добавлено");
      await addDrafts(chatId, ctx, [d], [], messageId);
      return;
    }
  }

  // --- несколько черновиков ---
  if (action === "dr") {
    const pending = await getPending(chatId);
    if (pending?.action !== "drafts" || !pending.payload) { await answerCallback(cb.id, "Черновики уже неактуальны"); await edit("Черновики уже обработаны."); return; }
    const st = JSON.parse(pending.payload);
    if (arg === "cancel") { await clearPending(chatId); await answerCallback(cb.id, "Отменено"); await edit("Черновики отменены, ничего не сохранено."); return; }
    if (arg === "rm") {
      st.drafts.splice(Number(arg2), 1);
      if (!st.drafts.length) { await clearPending(chatId); await edit("Все черновики убраны, ничего не сохранено."); await answerCallback(cb.id); return; }
      await setPending(chatId, "drafts", null, st);
      await answerCallback(cb.id, "Убрано");
      await edit(draftsText(ctx, st.drafts, "Проверьте перед сохранением:"), draftsKeyboard(st.drafts));
      return;
    }
    if (arg === "ed") {
      await setPending(chatId, "draft_edit", null, { drafts: st.drafts, index: Number(arg2) });
      await answerCallback(cb.id, "Жду правку");
      await sendMessage(chatId, `✏️ Что поменять в черновике ${Number(arg2) + 1} «${esc(st.drafts[Number(arg2)]?.title || "")}»? Например «на пятницу в 10» или «в группу Продажи».`, { html: true });
      return;
    }
    if (arg === "add") {
      await clearPending(chatId);
      await answerCallback(cb.id, "Сохраняю");
      await edit(`Добавляю ${st.drafts.length}…`);
      await addDrafts(chatId, ctx, st.drafts);
      await edit(`Добавлено задач: ${st.drafts.length} ✅`);
      return;
    }
  }

  // --- выбор среди похожих задач ---
  if (action === "pick") {
    if (arg === "cancel") { await clearPending(chatId); await answerCallback(cb.id, "Отменено"); await edit("Отменено — ничего не изменилось."); return; }
    const task = findTask(ctx, arg2);
    if (!task) { await answerCallback(cb.id, "Задача уже удалена"); await edit("Эта задача уже удалена."); return; }
    if (arg === "del") {
      await answerCallback(cb.id);
      await edit(card(ctx, "Удалить эту задачу?", task), { inline_keyboard: [[{ text: "🗑 Да, в корзину", callback_data: `cdel:${task.id}` }, { text: "✖️ Нет", callback_data: "pick:cancel:-" }]] });
      return;
    }
    if (arg === "done") { task.completed = true; await save(ctx); await answerCallback(cb.id, "Выполнено"); await edit(card(ctx, "Выполнено ✅", task), taskKeyboard(task)); return; }
    if (arg === "mv") {
      const pending = await getPending(chatId);
      if (pending?.action !== "move" || !pending.payload) { await answerCallback(cb.id, "Устарело"); await edit("Запрос на перенос устарел — повторите его."); return; }
      await clearPending(chatId);
      await answerCallback(cb.id);
      await applyMove(chatId, ctx, task, JSON.parse(pending.payload), (t, k) => edit(t, k));
      return;
    }
  }

  // --- план дня: кнопки из сводок ---
  if (action === "padd") {
    await setPending(chatId, "add_for_date", null, arg);
    await answerCallback(cb.id, "Жду задачу");
    await sendMessage(chatId, `➕ Что добавить на ${relDay(arg, ctx.today, ctx.tomorrow)}? Пришлите текстом или голосовым.`);
    return;
  }
  if (action === "pdel") {
    const open: Task[] = (ctx.state.tasks || []).filter((t: Task) => !t.completed && t.date === arg).sort((a: Task, b: Task) => (a.time || "").localeCompare(b.time || ""));
    if (!open.length) { await answerCallback(cb.id, "Удалять нечего"); return; }
    await answerCallback(cb.id);
    await sendMessage(chatId, `Какую задачу убрать из плана на ${relDay(arg, ctx.today, ctx.tomorrow)}?`, {
      keyboard: { inline_keyboard: open.map((t) => [{ text: buttonLabel(`🗑 ${t.title}`, 60), callback_data: `pdone:${t.id}:${arg}` }]) },
    });
    return;
  }
  if (action === "pdone") {
    const target = findTask(ctx, arg);
    if (!target) { await answerCallback(cb.id, "Задача уже удалена"); return; }
    ctx.state.tasks = ctx.state.tasks.filter((t: Task) => t.id !== arg);
    await save(ctx);
    await answerCallback(cb.id, "В корзине");
    await edit(`🗑 В корзине: <s>${esc(target.title)}</s>`, { inline_keyboard: [[{ text: "↩️ Восстановить", callback_data: `rst:${target.id}` }]] });
    if (validDate(arg2)) await sendMessage(chatId, planText(await loadCtx(userId), arg2, `📋 <b>Обновлённый план на ${relDay(arg2, ctx.today, ctx.tomorrow)}</b>`), { html: true, keyboard: planKeyboard(arg2) });
    return;
  }

  // --- восстановление из корзины ---
  if (action === "rst") {
    try {
      await restoreTask(supabase, userId, arg);
    } catch (e) {
      await answerCallback(cb.id, "Не удалось");
      await sendMessage(chatId, `Не удалось восстановить: ${esc(e instanceof Error ? e.message : String(e))}`);
      return;
    }
    const fresh = await loadCtx(userId);
    const task = findTask(fresh, arg);
    await answerCallback(cb.id, "Восстановлено");
    await edit(task ? card(fresh, "Восстановлено ↩️", task) : "Восстановлено ↩️", task ? taskKeyboard(task) : undefined);
    return;
  }

  // --- кнопки карточки задачи: сверяются с актуальным состоянием ---
  const task = findTask(ctx, arg);
  if (!task) {
    await answerCallback(cb.id, "Задача уже удалена");
    await edit("Эта задача больше не найдена в планировщике — возможно, её удалили в другом месте.");
    return;
  }
  if (action === "done" || action === "undone") {
    const want = action === "done";
    if (task.completed === want) { await answerCallback(cb.id, want ? "Уже выполнена" : "Уже в работе"); await edit(card(ctx, want ? "Выполнено ✅" : "В работе", task), taskKeyboard(task)); return; }
    task.completed = want;
    await save(ctx);
    await answerCallback(cb.id, want ? "Отмечено выполненной" : "Возвращено в работу");
    await edit(card(ctx, want ? "Выполнено ✅" : "Снова в работе", task), taskKeyboard(task));
    return;
  }
  if (action === "del" || action === "cdel" || action === "undo") {
    ctx.state.tasks = ctx.state.tasks.filter((t: Task) => t.id !== task.id);
    await save(ctx);
    await answerCallback(cb.id, action === "undo" ? "Добавление отменено" : "В корзине");
    await edit(action === "undo" ? `Добавление отменено:\n<s>${esc(task.title)}</s>` : `🗑 В корзине:\n<s>${esc(task.title)}</s>`,
      { inline_keyboard: [[{ text: "↩️ Восстановить", callback_data: `rst:${task.id}` }]] });
    return;
  }
  if (action === "mvok") {
    const pending = await getPending(chatId);
    if (pending?.action !== "move_confirm" || pending.task_id !== task.id || !pending.payload) { await answerCallback(cb.id, "Устарело"); await edit("Запрос на перенос устарел — повторите его."); return; }
    await clearPending(chatId);
    const mv = JSON.parse(pending.payload);
    task.date = mv.date;
    if (mv.time) task.time = mv.time;
    if (mv.dateMode) task.dateMode = mv.dateMode;
    await save(ctx);
    await answerCallback(cb.id, "Перенесено");
    await edit(card(ctx, "Перенесено", task), taskKeyboard(task));
    return;
  }
  if (action === "edit") {
    await setPending(chatId, "edit", task.id);
    await answerCallback(cb.id, "Жду изменения");
    await sendMessage(chatId, `✏️ Что поменять в задаче «${esc(task.title)}»?\n\nНапример «перенеси на пятницу», «время 15:00», «в группу Продажи». /cancel — отменить.`, { html: true });
    return;
  }
  await answerCallback(cb.id);
}

// ------------------------------------------------------------------ вход --

async function finishUpdate(updateId: number | null, status: "done" | "failed", error?: string) {
  if (updateId === null) return;
  const { error: err } = await supabase.from("telegram_updates")
    .update({ status, error: error ? error.slice(0, 300) : null, finished_at: new Date().toISOString() }).eq("update_id", updateId);
  if (err) console.error("update finish failed", err.message);
}

Deno.serve(async (req) => {
  // Checked before the body is even parsed, so a forged request costs nothing.
  if (WEBHOOK_SECRET && req.headers.get("x-telegram-bot-api-secret-token") !== WEBHOOK_SECRET) {
    console.error("telegram-webhook: rejected request with a wrong or missing secret token");
    return new Response("forbidden", { status: 403 });
  }

  let chatId: number | null = null;
  let updateId: number | null = null;
  try {
    const update = await req.json();

    // Telegram redelivers an update it did not see answered in time. The first
    // delivery is claimed in the database; a repeat is acknowledged and not
    // processed again (D07).
    if (typeof update.update_id === "number") {
      updateId = update.update_id;
      const { data: fresh, error: claimErr } = await supabase.rpc("mark_claim_telegram_update", {
        p_update_id: update.update_id,
        p_chat_id: update.message?.chat?.id ?? update.callback_query?.message?.chat?.id ?? null,
        p_kind: update.callback_query ? "callback" : update.message ? "message" : "other",
      });
      if (claimErr) console.error("update claim failed, processing anyway:", claimErr.message);
      else if (fresh === false) return new Response("ok");
    }

    if (update.callback_query) {
      chatId = update.callback_query.message?.chat?.id ?? null;
      await handleCallback(update.callback_query);
    } else if (update.message) {
      chatId = update.message.chat.id;
      await handleMessage(update.message);
    }
    await finishUpdate(updateId, "done");
    return new Response("ok");
  } catch (e) {
    console.error(e);
    const msg = e instanceof Error ? e.message : String(e);
    await finishUpdate(updateId, "failed", msg);
    if (chatId) {
      try {
        // «Добавлено» не отправляется, если запись не прошла (A24)
        await sendMessage(chatId, `Не получилось: ${msg}\nДанные не сохранены — попробуйте ещё раз.`);
      } catch (sendErr) {
        console.error("failed to notify user of error", sendErr);
      }
    }
    return new Response("ok");
  }
});
