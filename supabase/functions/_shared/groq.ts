// Вызов модели разбора сообщений — один для бота и для контрольной оценки
// (eval), чтобы оценивалось ровно то, что работает в боте.

export const PARSE_MODEL = "openai/gpt-oss-20b";

export async function callParseModel(system: string, user: string, apiKey = Deno.env.get("GROQ_API_KEY") || ""): Promise<string> {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: PARSE_MODEL,
      max_tokens: 900,
      reasoning_effort: "low",
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
    signal: AbortSignal.timeout(20000),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(`Groq: ${json?.error?.message || res.status}`), { status: res.status });
  return json?.choices?.[0]?.message?.content || "";
}

// Календарь на две недели от заданного дня — модель путает дни недели. Две,
// а не три: подсказка короче, а лимит провайдера считается в токенах в минуту.
export function calendarFrom(today: string, days = 14): string {
  const WD = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
  const [y, m, d] = today.split("-").map(Number);
  return Array.from({ length: days }, (_, i) => {
    const dt = new Date(Date.UTC(y, m - 1, d + i));
    const label = i === 0 ? " (сегодня)" : i === 1 ? " (завтра)" : i === 2 ? " (послезавтра)" : "";
    return `${dt.toISOString().slice(0, 10)} — ${WD[dt.getUTCDay()]}${label}`;
  }).join("\n");
}
