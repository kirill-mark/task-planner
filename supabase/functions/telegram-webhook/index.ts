import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY") || "";

const ASCII_ONLY = /^[\x20-\x7E]*$/;
const badSecrets: string[] = [];
for (const [name, val] of Object.entries({
  SUPABASE_URL, SERVICE_ROLE_KEY, TELEGRAM_BOT_TOKEN, GROQ_API_KEY,
})) {
  if (!val) {
    console.error(`missing secret: ${name}`);
    badSecrets.push(`${name} не задан`);
  } else if (!ASCII_ONLY.test(val)) {
    console.error(`secret ${name} contains invalid (non-ASCII) characters, length ${val.length}`);
    badSecrets.push(`${name} содержит недопустимые символы (похоже, скопирован с "умными" кавычками/пробелами)`);
  }
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const TIMEOUT_MS = 20000;
function withTimeout() {
  return AbortSignal.timeout(TIMEOUT_MS);
}

const api = (method: string) => `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`;

type Keyboard = { inline_keyboard: { text: string; callback_data: string }[][] };

async function sendMessage(
  chatId: number,
  text: string,
  opts: { html?: boolean; keyboard?: Keyboard } = {}
) {
  await fetch(api("sendMessage"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: opts.html ? "HTML" : undefined,
      reply_markup: opts.keyboard,
    }),
    signal: withTimeout(),
  });
}

async function editMessage(chatId: number, messageId: number, text: string) {
  await fetch(api("editMessageText"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [] },
    }),
    signal: withTimeout(),
  });
}

async function answerCallback(callbackId: string, text?: string) {
  await fetch(api("answerCallbackQuery"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackId, text }),
    signal: withTimeout(),
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function transcribeVoice(fileId: string): Promise<string> {
  const fileRes = await fetch(api(`getFile?file_id=${fileId}`), { signal: withTimeout() });
  const fileJson = await fileRes.json();
  const filePath = fileJson.result?.file_path;
  if (!filePath) throw new Error("Не удалось получить голосовой файл от Telegram");
  const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`;
  const audioRes = await fetch(fileUrl, { signal: withTimeout() });
  const audioBlob = await audioRes.blob();

  const form = new FormData();
  form.append("file", audioBlob, "voice.ogg");
  form.append("model", "whisper-large-v3");
  form.append("language", "ru");

  const groqRes = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
    body: form,
    signal: AbortSignal.timeout(30000),
  });
  const groqJson = await groqRes.json();
  if (!groqRes.ok) throw new Error(`Groq: ${groqJson.error?.message || groqRes.status}`);
  return groqJson.text || "";
}

// --- planner state helpers ---

type Task = {
  id: string;
  title: string;
  notes: string;
  date: string;
  time: string;
  dateMode: "due" | "on";
  groupId: string;
  completed: boolean;
  createdAt: number;
};

async function loadState(userId: string) {
  const { data } = await supabase
    .from("planner_state")
    .select("data")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.data || { sections: [], groups: [], tasks: [], updatedAt: 0 };
}

async function saveState(userId: string, state: any) {
  state.updatedAt = Date.now();
  await supabase
    .from("planner_state")
    .upsert({ user_id: userId, data: state, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
}

// A brand-new account can reach the bot before it has any groups.
function ensureGroups(state: any) {
  if (!state.groups || state.groups.length === 0) {
    const sectionId = crypto.randomUUID();
    state.sections = [...(state.sections || []), { id: sectionId, name: "Общее", color: "#7d8ca3" }];
    state.groups = [{ id: crypto.randomUUID(), name: "Входящие", color: "#16a34a", sectionId }];
  }
  return state.groups;
}

function taskCard(task: Task, heading: string): string {
  return [
    heading,
    "",
    `<b>Задача:</b> ${escapeHtml(task.title)}`,
    `<b>Описание:</b> ${escapeHtml(task.notes || "")}`,
    `<b>${task.dateMode === "on" ? "Дата" : "Дедлайн"}:</b> ${task.date}`,
    `<b>Время:</b> ${task.time || ""}`,
  ].join("\n");
}

// --- daily plan (the digest the reminders function sends) ---

function planKeyboard(date: string): Keyboard {
  return {
    inline_keyboard: [[
      { text: "➕ Добавить задачу", callback_data: `padd:${date}` },
      { text: "🗑 Удалить задачу", callback_data: `pdel:${date}` },
    ]],
  };
}

function humanDate(date: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  if (date === today) return "сегодня";
  if (date === tomorrow) return "завтра";
  return date;
}

function planText(state: any, date: string, heading: string): string {
  const tasks: Task[] = (state.tasks || [])
    .filter((t: Task) => !t.completed && t.date === date)
    .sort((a: Task, b: Task) => (a.time || "").localeCompare(b.time || ""));
  if (!tasks.length) return `${heading}\n\nЗадач нет.`;
  return (
    `${heading}\n\n` +
    tasks.map((t) => `• ${escapeHtml(t.title)}${t.time ? ` — ${t.time}` : ""}`).join("\n")
  );
}

function taskKeyboard(taskId: string): Keyboard {
  return {
    inline_keyboard: [
      [
        { text: "✅ Выполнено", callback_data: `done:${taskId}` },
        { text: "🗑 Удалить", callback_data: `del:${taskId}` },
      ],
      [{ text: "✏️ Редактировать", callback_data: `edit:${taskId}` }],
    ],
  };
}

// --- intent parsing ---

type GroupInfo = { id: string; name: string; sectionName: string };

const WEEKDAYS = [
  "воскресенье", "понедельник", "вторник", "среда",
  "четверг", "пятница", "суббота",
];

// A small model gets weekday arithmetic wrong ("в пятницу" landed on a
// Wednesday), so hand it a ready-made calendar to look the date up in.
function calendarHint(days = 14): string {
  const today = new Date();
  const lines: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + i));
    const label = i === 0 ? " (сегодня)" : i === 1 ? " (завтра)" : i === 2 ? " (послезавтра)" : "";
    lines.push(`${d.toISOString().slice(0, 10)} — ${WEEKDAYS[d.getUTCDay()]}${label}`);
  }
  return lines.join("\n");
}

type Intent = {
  intent?: "add" | "delete" | "done";
  title?: string;
  notes?: string;
  date?: string;
  time?: string;
  dateMode?: string;
  groupId?: string;
  taskIndex?: number;
};

async function parseIntentWithGroq(
  text: string,
  groups: GroupInfo[],
  openTasks: Task[]
): Promise<Intent> {
  const today = new Date().toISOString().slice(0, 10);
  const groupList = groups.map((g) => `${g.id}: ${g.sectionName} / ${g.name}`).join("\n");
  // Numbered instead of by id: a small model echoes an index far more reliably than a UUID.
  const taskList = openTasks.length
    ? openTasks.map((t, i) => `${i + 1}. ${t.title} (${t.date}${t.time ? " " + t.time : ""})`).join("\n")
    : "(нет открытых задач)";

  const system =
    `Ты помощник планировщика задач. Сегодня ${today}.\n\n` +
    `Календарь ближайших дней — бери даты отсюда, не вычисляй дни недели сам:\n${calendarHint()}\n\n` +
    `Группы пользователя (id: раздел / группа):\n${groupList}\n\n` +
    `Открытые задачи пользователя:\n${taskList}\n\n` +
    `Пользователь прислал сообщение (возможно, расшифровку голосового с огрехами распознавания). ` +
    `Определи намерение:\n` +
    `- "add" — описывает новую задачу;\n` +
    `- "delete" — просит удалить/убрать существующую задачу из списка выше;\n` +
    `- "done" — говорит, что существующая задача уже выполнена.\n\n` +
    `Для "add" верни: {"intent":"add","title":"короткое название без даты и времени","notes":"детали или пустая строка",` +
    `"date":"YYYY-MM-DD","time":"HH:MM или пустая строка","dateMode":"due или on","groupId":"id подходящей группы"}.\n` +
    `Правила для add: понимай "завтра", "в пятницу", "через неделю" относительно сегодня; если дата не упомянута — сегодняшняя. ` +
    `time заполняй, только если время явно названо. dateMode = "due", если это срок ("до пятницы", "к среде"), ` +
    `и "on", если событие привязано к конкретному дню ("в пятницу в 11:00", "во вторник встреча"). ` +
    `groupId выбирай по смыслу из списка; если неясно — первый.\n\n` +
    `Для "delete" и "done" верни: {"intent":"delete","taskIndex":N} или {"intent":"done","taskIndex":N}, ` +
    `где N — номер задачи из списка выше.\n\n` +
    `Ответь СТРОГО одним JSON-объектом, без пояснений и без markdown.`;

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: "openai/gpt-oss-20b",
      max_tokens: 600,
      reasoning_effort: "low",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: text },
      ],
    }),
    signal: withTimeout(),
  });
  const json = await res.json();
  if (!res.ok) {
    console.error("Groq parse failed:", JSON.stringify(json));
    throw new Error(`Groq (parse): ${json.error?.message || res.status}`);
  }
  const raw = json.choices?.[0]?.message?.content || "{}";
  const match = raw.match(/\{[\s\S]*\}/);
  return JSON.parse(match ? match[0] : raw);
}

async function applyEditWithGroq(
  instruction: string,
  task: Task,
  groups: GroupInfo[]
): Promise<Partial<Task>> {
  const today = new Date().toISOString().slice(0, 10);
  const groupList = groups.map((g) => `${g.id}: ${g.sectionName} / ${g.name}`).join("\n");

  const system =
    `Ты редактируешь одну задачу в планировщике. Сегодня ${today}.\n\n` +
    `Календарь ближайших дней — бери даты отсюда, не вычисляй дни недели сам:\n${calendarHint()}\n\n` +
    `Группы пользователя (id: раздел / группа):\n${groupList}\n\n` +
    `Текущая задача:\n` +
    `title: ${task.title}\n` +
    `notes: ${task.notes || ""}\n` +
    `date: ${task.date}\n` +
    `time: ${task.time || ""}\n` +
    `dateMode: ${task.dateMode || "due"}\n` +
    `groupId: ${task.groupId}\n\n` +
    `Пользователь прислал, что нужно изменить (возможно, расшифровку голосового с огрехами распознавания). ` +
    `Верни ПОЛНУЮ задачу после правки: поля, которых правка не касается, оставь ровно такими же. ` +
    `Даты понимай относительно сегодня. dateMode: "due" — это срок ("до пятницы"), "on" — конкретный день ("в пятницу в 11:00"). ` +
    `Если просят убрать время — верни пустую строку в time.\n\n` +
    `Ответь СТРОГО одним JSON-объектом без пояснений и markdown: ` +
    `{"title":"...","notes":"...","date":"YYYY-MM-DD","time":"HH:MM или пустая строка","dateMode":"due или on","groupId":"..."}`;

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: "openai/gpt-oss-20b",
      max_tokens: 600,
      reasoning_effort: "low",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: instruction },
      ],
    }),
    signal: withTimeout(),
  });
  const json = await res.json();
  if (!res.ok) {
    console.error("Groq edit failed:", JSON.stringify(json));
    throw new Error(`Groq (edit): ${json.error?.message || res.status}`);
  }
  const raw = json.choices?.[0]?.message?.content || "{}";
  const match = raw.match(/\{[\s\S]*\}/);
  return JSON.parse(match ? match[0] : raw);
}

// --- update handlers ---

async function handleCallback(cb: any) {
  const chatId: number = cb.message.chat.id;
  const messageId: number = cb.message.message_id;
  const [action, arg, arg2] = String(cb.data || "").split(":");

  const { data: link } = await supabase
    .from("telegram_links")
    .select("user_id")
    .eq("telegram_chat_id", chatId)
    .maybeSingle();
  if (!link) {
    await answerCallback(cb.id, "Аккаунт не привязан");
    return;
  }

  const state = await loadState(link.user_id);

  // --- buttons under a daily plan: they carry a date, not a task ---
  if (action === "padd") {
    await supabase.from("telegram_pending_actions").upsert({
      telegram_chat_id: chatId,
      action: "add_for_date",
      task_id: null,
      payload: arg,
      created_at: new Date().toISOString(),
    });
    await answerCallback(cb.id, "Жду задачу");
    await sendMessage(
      chatId,
      `➕ Что добавить на ${humanDate(arg)}? Пришли текстом или голосовым.`
    );
    return;
  }

  if (action === "pdel") {
    const open: Task[] = (state.tasks || [])
      .filter((t: Task) => !t.completed && t.date === arg)
      .sort((a: Task, b: Task) => (a.time || "").localeCompare(b.time || ""));
    if (!open.length) {
      await answerCallback(cb.id, "Удалять нечего");
      return;
    }
    await answerCallback(cb.id);
    await sendMessage(chatId, `Какую задачу убрать из плана на ${humanDate(arg)}?`, {
      keyboard: {
        inline_keyboard: open.map((t) => [
          { text: `🗑 ${t.title}`.slice(0, 60), callback_data: `pdone:${t.id}:${arg}` },
        ]),
      },
    });
    return;
  }

  if (action === "pdone") {
    const target = (state.tasks || []).find((t: Task) => t.id === arg);
    if (!target) {
      await answerCallback(cb.id, "Задача уже удалена");
      return;
    }
    state.tasks = state.tasks.filter((t: Task) => t.id !== arg);
    await saveState(link.user_id, state);
    await answerCallback(cb.id, "Удалено");
    await editMessage(chatId, messageId, `🗑 Удалено: <s>${escapeHtml(target.title)}</s>`);
    await sendMessage(
      chatId,
      planText(state, arg2, `📋 <b>Обновлённый план на ${humanDate(arg2)}</b>`),
      { html: true, keyboard: planKeyboard(arg2) }
    );
    return;
  }

  const taskId = arg;
  const task = (state.tasks || []).find((t: Task) => t.id === taskId);
  if (!task) {
    await answerCallback(cb.id, "Задача уже удалена");
    await editMessage(chatId, messageId, "Задача больше не найдена в планировщике.");
    return;
  }

  if (action === "del") {
    state.tasks = state.tasks.filter((t: Task) => t.id !== taskId);
    await saveState(link.user_id, state);
    await answerCallback(cb.id, "Удалено");
    await editMessage(chatId, messageId, `🗑 Задача удалена\n\n<s>${escapeHtml(task.title)}</s>`);
    return;
  }

  if (action === "done") {
    task.completed = true;
    await saveState(link.user_id, state);
    await answerCallback(cb.id, "Отмечено выполненной");
    await editMessage(
      chatId,
      messageId,
      `✅ <b>Задача закрыта</b>\n\n<s>${escapeHtml(task.title)}</s>\n\nОтмечена галочкой в планировщике.`
    );
    return;
  }

  if (action === "edit") {
    // The next message from this chat is the edit instruction; the function is
    // stateless, so remember what is being edited in the database.
    await supabase.from("telegram_pending_actions").upsert({
      telegram_chat_id: chatId,
      action: "edit",
      task_id: taskId,
      created_at: new Date().toISOString(),
    });
    await answerCallback(cb.id, "Жду изменения");
    await sendMessage(
      chatId,
      `✏️ Что поменять в задаче «${escapeHtml(task.title)}»?\n\n` +
        "Пришли текстом или голосовым — например «перенеси на пятницу», " +
        "«поставь время 15:00» или «переименуй в созвон с подрядчиком».",
      { html: true }
    );
    return;
  }

  await answerCallback(cb.id);
}

async function handleMessage(message: any) {
  const chatId: number = message.chat.id;
  const username: string | null = message.from?.username || null;

  if (badSecrets.length > 0) {
    await sendMessage(
      chatId,
      `Бот неправильно настроен на сервере:\n${badSecrets.join("\n")}\n\nНужно пересохранить эти секреты в Supabase.`
    );
    return;
  }

  // --- linking flow: /start <code> ---
  if (typeof message.text === "string" && message.text.startsWith("/start")) {
    const code = message.text.split(" ")[1];
    if (!code) {
      await sendMessage(
        chatId,
        "Привет! Я помогу добавлять задачи в MARK голосом или текстом.\n\n" +
          "Чтобы начать: открой приложение → «Личный кабинет» → «Привязать Telegram» и перейди по ссылке оттуда."
      );
      return;
    }
    const { data: codeRow } = await supabase
      .from("link_codes")
      .select("*")
      .eq("code", code)
      .eq("used", false)
      .maybeSingle();
    if (!codeRow) {
      await sendMessage(chatId, "Код недействителен или уже использован. Сгенерируй новый в приложении.");
      return;
    }
    await supabase
      .from("telegram_links")
      .upsert({ telegram_chat_id: chatId, user_id: codeRow.user_id, telegram_username: username });
    await supabase.from("link_codes").update({ used: true }).eq("code", code);
    await sendMessage(chatId, "Готово! Аккаунт привязан ✅ Теперь просто присылай мне задачи текстом или голосом.");
    return;
  }

  // --- must be linked ---
  const { data: link } = await supabase
    .from("telegram_links")
    .select("user_id")
    .eq("telegram_chat_id", chatId)
    .maybeSingle();
  if (!link) {
    await sendMessage(
      chatId,
      "Сначала привяжи аккаунт: в приложении MARK открой «Личный кабинет» → «Привязать Telegram» и перейди по ссылке."
    );
    return;
  }
  const userId = link.user_id as string;

  // --- get input text (typed or transcribed voice) ---
  let inputText: string = message.text || message.caption || "";
  if (message.voice) {
    await sendMessage(chatId, "Слушаю…");
    inputText = await transcribeVoice(message.voice.file_id);
  }
  if (!inputText.trim()) {
    await sendMessage(chatId, "Не понял сообщение — пришли текст или голосовое с описанием задачи.");
    return;
  }

  const state = await loadState(userId);
  const groups = ensureGroups(state);

  const groupInfo: GroupInfo[] = groups.map((g: any) => ({
    id: g.id,
    name: g.name,
    sectionName: (state.sections || []).find((s: any) => s.id === g.sectionId)?.name || "",
  }));

  // --- pending edit: this message is an instruction for a specific task ---
  const { data: pending } = await supabase
    .from("telegram_pending_actions")
    .select("action, task_id, payload, created_at")
    .eq("telegram_chat_id", chatId)
    .maybeSingle();

  // --- pending add: the task goes on the date the plan button carried ---
  if (pending?.action === "add_for_date") {
    await supabase.from("telegram_pending_actions").delete().eq("telegram_chat_id", chatId);
    const targetDate = pending.payload as string;

    let parsedAdd: Intent = {};
    try {
      parsedAdd = await parseIntentWithGroq(inputText, groupInfo, []);
    } catch (err) {
      console.error("parse for dated add failed, using raw text:", err);
    }

    const task: Task = {
      id: crypto.randomUUID(),
      title: parsedAdd.title || inputText.slice(0, 100),
      notes: parsedAdd.notes || "",
      date: targetDate, // the plan's date wins over anything the model inferred
      time: /^\d{2}:\d{2}$/.test(parsedAdd.time || "") ? parsedAdd.time! : "",
      dateMode: parsedAdd.dateMode === "on" ? "on" : "due",
      groupId: groups.some((g: any) => g.id === parsedAdd.groupId) ? parsedAdd.groupId! : groups[0].id,
      completed: false,
      createdAt: Date.now(),
    };
    state.tasks = [...(state.tasks || []), task];
    await saveState(userId, state);

    await sendMessage(chatId, taskCard(task, "Добавил в план ✅"), { html: true });
    await sendMessage(
      chatId,
      planText(state, targetDate, `📋 <b>Обновлённый план на ${humanDate(targetDate)}</b>`),
      { html: true, keyboard: planKeyboard(targetDate) }
    );
    return;
  }

  if (pending?.action === "edit") {
    await supabase.from("telegram_pending_actions").delete().eq("telegram_chat_id", chatId);

    const stale = Date.now() - new Date(pending.created_at).getTime() > 30 * 60 * 1000;
    const task: Task | undefined = (state.tasks || []).find((t: Task) => t.id === pending.task_id);

    if (stale || !task) {
      await sendMessage(
        chatId,
        stale
          ? "Правка отменена — прошло слишком много времени. Нажми «Редактировать» ещё раз."
          : "Эта задача уже удалена, редактировать нечего."
      );
      return;
    }

    const patch = await applyEditWithGroq(inputText, task, groupInfo);
    task.title = patch.title || task.title;
    task.notes = patch.notes ?? task.notes;
    task.date = /^\d{4}-\d{2}-\d{2}$/.test(patch.date || "") ? patch.date! : task.date;
    task.time = /^\d{2}:\d{2}$/.test(patch.time || "") ? patch.time! : "";
    task.dateMode = patch.dateMode === "on" ? "on" : "due";
    if (groups.some((g: any) => g.id === patch.groupId)) task.groupId = patch.groupId!;

    await saveState(userId, state);
    await sendMessage(chatId, taskCard(task, "Задача обновлена ✏️"), {
      html: true,
      keyboard: taskKeyboard(task.id),
    });
    return;
  }

  // Only open tasks can be deleted or completed, and the newest are the likely targets.
  const openTasks: Task[] = (state.tasks || [])
    .filter((t: Task) => !t.completed)
    .slice(-30);

  let parsed: Intent = {};
  try {
    parsed = await parseIntentWithGroq(inputText, groupInfo, openTasks);
  } catch (parseErr) {
    console.error("parseIntentWithGroq failed, falling back to plain add:", parseErr);
  }

  // --- delete / done by plain text ---
  if (parsed.intent === "delete" || parsed.intent === "done") {
    const target = openTasks[Number(parsed.taskIndex) - 1];
    if (!target) {
      await sendMessage(chatId, "Не понял, какую задачу ты имеешь в виду. Напиши её название чуть точнее.");
      return;
    }
    if (parsed.intent === "delete") {
      state.tasks = state.tasks.filter((t: Task) => t.id !== target.id);
      await saveState(userId, state);
      await sendMessage(chatId, `🗑 Задача удалена\n\n<s>${escapeHtml(target.title)}</s>`, { html: true });
    } else {
      const task = state.tasks.find((t: Task) => t.id === target.id);
      if (task) task.completed = true;
      await saveState(userId, state);
      await sendMessage(chatId, `✅ Выполнено\n\n<s>${escapeHtml(target.title)}</s>`, { html: true });
    }
    return;
  }

  // --- add (default) ---
  const newTask: Task = {
    id: crypto.randomUUID(),
    title: parsed.title || inputText.slice(0, 100),
    notes: parsed.notes || "",
    date: parsed.date || new Date().toISOString().slice(0, 10),
    time: /^\d{2}:\d{2}$/.test(parsed.time || "") ? parsed.time! : "",
    dateMode: parsed.dateMode === "on" ? "on" : "due",
    groupId: groups.some((g: any) => g.id === parsed.groupId) ? parsed.groupId! : groups[0].id,
    completed: false,
    createdAt: Date.now(),
  };

  state.tasks = [...(state.tasks || []), newTask];
  await saveState(userId, state);

  await sendMessage(chatId, taskCard(newTask, "Твоя задача добавлена ✅"), {
    html: true,
    keyboard: taskKeyboard(newTask.id),
  });
}

Deno.serve(async (req) => {
  let chatId: number | null = null;
  try {
    const update = await req.json();

    if (update.callback_query) {
      await handleCallback(update.callback_query);
      return new Response("ok");
    }
    if (!update.message) return new Response("ok");

    chatId = update.message.chat.id;
    await handleMessage(update.message);
    return new Response("ok");
  } catch (e) {
    console.error(e);
    if (chatId) {
      const msg = e instanceof Error ? e.message : String(e);
      try {
        await sendMessage(chatId, `Ошибка при обработке: ${msg}\nПопробуй ещё раз или напиши другими словами.`);
      } catch (sendErr) {
        console.error("failed to notify user of error", sendErr);
      }
    }
    return new Response("ok");
  }
});
