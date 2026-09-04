import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY")!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function sendMessage(chatId: number, text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

async function transcribeVoice(fileId: string): Promise<string> {
  const fileRes = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`
  );
  const fileJson = await fileRes.json();
  const filePath = fileJson.result.file_path;
  const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`;
  const audioRes = await fetch(fileUrl);
  const audioBlob = await audioRes.blob();

  const form = new FormData();
  form.append("file", audioBlob, "voice.oga");
  form.append("model", "whisper-large-v3-turbo");
  form.append("language", "ru");

  const groqRes = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
    body: form,
  });
  const groqJson = await groqRes.json();
  return groqJson.text || "";
}

type GroupInfo = { id: string; name: string; sectionName: string };

async function parseTaskWithClaude(text: string, groups: GroupInfo[]) {
  const today = new Date().toISOString().slice(0, 10);
  const groupList = groups.map((g) => `${g.id}: ${g.sectionName} / ${g.name}`).join("\n");
  const system =
    `Ты помощник планировщика задач. Сегодня ${today}. Вот группы пользователя (id: раздел / группа):\n${groupList}\n\n` +
    `Пользователь прислал сообщение с задачей (возможно, расшифровку голосового, там могут быть огрехи распознавания). ` +
    `Извлеки: title (короткое ёмкое название), notes (детали, если явно есть, иначе пустая строка), ` +
    `date (в формате YYYY-MM-DD; понимай "завтра", "в пятницу", "через неделю" относительно сегодняшней даты; если дата вообще не упоминается — ставь сегодняшнюю), ` +
    `groupId (выбери максимально подходящий id группы из списка по смыслу; если неясно — возьми первый). ` +
    `Ответь СТРОГО в формате JSON без пояснений и без markdown: {"title": "...", "notes": "...", "date": "YYYY-MM-DD", "groupId": "..."}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      system,
      messages: [{ role: "user", content: text }],
    }),
  });
  const json = await res.json();
  const raw = json.content?.[0]?.text || "{}";
  const match = raw.match(/\{[\s\S]*\}/);
  return JSON.parse(match ? match[0] : raw);
}

Deno.serve(async (req) => {
  try {
    const update = await req.json();
    const message = update.message;
    if (!message) return new Response("ok");

    const chatId = message.chat.id;
    const username: string | null = message.from?.username || null;

    // --- linking flow: /start <code> ---
    if (typeof message.text === "string" && message.text.startsWith("/start")) {
      const code = message.text.split(" ")[1];
      if (!code) {
        await sendMessage(
          chatId,
          "Привет! Я помогу добавлять задачи в MARK голосом или текстом.\n\n" +
            "Чтобы начать: открой приложение → «Личный кабинет» → «Привязать Telegram» и перейди по ссылке оттуда."
        );
        return new Response("ok");
      }
      const { data: codeRow } = await supabase
        .from("link_codes")
        .select("*")
        .eq("code", code)
        .eq("used", false)
        .maybeSingle();
      if (!codeRow) {
        await sendMessage(chatId, "Код недействителен или уже использован. Сгенерируй новый в приложении.");
        return new Response("ok");
      }
      await supabase
        .from("telegram_links")
        .upsert({ telegram_chat_id: chatId, user_id: codeRow.user_id, telegram_username: username });
      await supabase.from("link_codes").update({ used: true }).eq("code", code);
      await sendMessage(chatId, "Готово! Аккаунт привязан ✅ Теперь просто присылай мне задачи текстом или голосом.");
      return new Response("ok");
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
      return new Response("ok");
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
      return new Response("ok");
    }

    // --- load this users planner state ---
    const { data: stateRow } = await supabase
      .from("planner_state")
      .select("data")
      .eq("user_id", userId)
      .maybeSingle();
    const state = stateRow?.data || { sections: [], groups: [], tasks: [], updatedAt: 0 };

    let groups = state.groups || [];
    if (groups.length === 0) {
      const sectionId = crypto.randomUUID();
      const groupId = crypto.randomUUID();
      state.sections = [...(state.sections || []), { id: sectionId, name: "Общее", color: "#7d8ca3" }];
      groups = [{ id: groupId, name: "Входящие", color: "#16a34a", sectionId }];
      state.groups = groups;
    }

    const groupInfo: GroupInfo[] = groups.map((g: any) => ({
      id: g.id,
      name: g.name,
      sectionName: (state.sections || []).find((s: any) => s.id === g.sectionId)?.name || "",
    }));

    const parsed = await parseTaskWithClaude(inputText, groupInfo);

    const newTask = {
      id: crypto.randomUUID(),
      title: parsed.title || inputText.slice(0, 100),
      notes: parsed.notes || "",
      date: parsed.date || new Date().toISOString().slice(0, 10),
      groupId: groups.some((g: any) => g.id === parsed.groupId) ? parsed.groupId : groups[0].id,
      completed: false,
      createdAt: Date.now(),
    };

    state.tasks = [...(state.tasks || []), newTask];
    state.updatedAt = Date.now();

    await supabase
      .from("planner_state")
      .upsert({ user_id: userId, data: state, updated_at: new Date().toISOString() }, { onConflict: "user_id" });

    await sendMessage(chatId, `Добавил ✅\n«${newTask.title}»\nдо ${newTask.date}`);
    return new Response("ok");
  } catch (e) {
    console.error(e);
    return new Response("ok");
  }
});
