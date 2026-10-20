import assert from "node:assert/strict";
import { build } from "esbuild";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

// Exercise the real request handlers with a fake SDK and provider.
// No credentials, database operations, Telegram messages or external requests.
const sdk = `
export function createClient() {
  const t = globalThis.__edgeTest;
  return {
    auth: { getUser: async () => t.auth },
    rpc: async (name) => { t.calls.push(name); return { data: t.state, error: null }; },
    from: (table) => {
      t.calls.push(table);
      const q = {
        select() { if (t.backupReadError) throw new Error("test backup read marker"); return q; },
        eq() { return q; },
        maybeSingle: async () => t.settings,
        insert: async () => ({ error: null })
      };
      return q;
    }
  };
}`;

async function bundled(name) {
  const result = await build({
    entryPoints: [`supabase/functions/${name}/index.ts`],
    bundle: true, write: false, format: "iife", platform: "neutral",
    plugins: [{ name: "fake-sdk", setup(b) {
      b.onResolve({ filter: /^https:\/\/esm\.sh\/@supabase\/supabase-js@2$/ }, () => ({ path: "sdk", namespace: "test-sdk" }));
      b.onLoad({ filter: /.*/, namespace: "test-sdk" }, () => ({ contents: sdk, loader: "js" }));
    } }],
  });
  return result.outputFiles[0].text;
}

const code = {
  assistant: await bundled("mark-assistant"),
  backup: await bundled("backup-export"),
};
const user = { id: "00000000-0000-4000-8000-000000000001" };

async function request(which, overrides = {}, headers = {}) {
  const t = {
    auth: { data: { user }, error: null },
    settings: { data: { timezone: "Europe/Moscow", assistant_consent_at: null }, error: null },
    state: { tasks: [], groups: [], sections: [] },
    calls: [], providerCalls: 0,
    ...overrides,
  };
  let handler;
  const env = { SUPABASE_URL: "https://mark-tests.invalid", SUPABASE_ANON_KEY: "test-anon",
    SUPABASE_SERVICE_ROLE_KEY: "test-service", GROQ_API_KEY: "test-provider", ...t.env };
  vm.runInNewContext(code[which], {
    __edgeTest: t,
    Deno: { env: { get: (name) => env[name] || "" }, serve: (cb) => { handler = cb; } },
    console: { log() {}, warn() {}, error() {} },
    Request, Response, Headers, URL, AbortSignal, setTimeout, clearTimeout, crypto: webcrypto,
    fetch: async (url, init) => {
      t.providerRequest = JSON.parse(init.body);
      assert.equal(String(url), "https://api.groq.com/openai/v1/chat/completions");
      t.providerCalls++;
      return Response.json({ choices: [{ message: { content: JSON.stringify(t.modelReply || { answer: "Нет задач", refs: [], actions: [] }) } }] });
    },
  });
  assert.equal(typeof handler, "function");
  const res = await handler(new Request("https://mark-tests.invalid/functions/v1/test", {
    method: "POST", headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ message: t.message || "План на сегодня", memory: t.memory || [], recall: t.recall || [] }),
  }));
  return { res, t };
}

const tests = [
  ["Daily choice survives another chat while expired and future notes are excluded", async () => {
    const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Moscow",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
    const {res,t}=await request("assistant",{
      settings:{data:{timezone:"Europe/Moscow",assistant_consent_at:"yes"},error:null},
      message:"С какой задачи я начинаю сегодня день?",
      memory:[`[На ${today}] Начну со Smolenka`,"[На 2000-01-01] expired-choice","[На 2099-01-01] future-choice"],
      recall:[{date:today,content:`[На ${today}] Я выбрал Smolenka`},{date:"2099-01-01",content:"future-recall"},{date:"invalid",content:"invalid-recall"}],
    },{Authorization:"Bearer test"});
    assert.equal(res.status,200);
    const system=t.providerRequest.messages[0].content;
    assert.match(system,/Я выбрал Smolenka/); assert.match(system,/Начну со Smolenka/);
    assert.match(system,/Учитывай последнюю запись/); assert.match(system,/Не выводи зависимость/);
    for(const marker of ["expired-choice","future-choice","future-recall","invalid-recall"]) assert.ok(!system.includes(marker));
  }],
  ["Suffix memory request cannot mutate tasks", async () => {
    const {res}=await request("assistant",{
      settings:{data:{assistant_consent_at:"yes"},error:null},
      message:"Сначала добавь один главный шаг запомни это",
      modelReply:{answer:"Учту",actions:[{type:"add",title:"Unrequested mutation"}]},
    },{Authorization:"Bearer test"});
    assert.equal(res.status,200); assert.deepEqual((await res.json()).drafts,[]);
  }],
  ["Remembering a preference excludes tasks and task mutations", async () => {
    const { res, t } = await request("assistant", {
      settings: { data: { assistant_consent_at: "yes" }, error: null },
      message: "Запомни: сначала добавь один главный шаг",
      state: { tasks: [{ id: "private", title: "Private title", notes: "Private note" }], groups: [], sections: [] },
      memory: ["сначала добавь один главный шаг"],
      modelReply: { answer: "Учту", actions: [{ type: "add", title: "Must not be created" }] },
    }, { Authorization: "Bearer test" });
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).drafts, []);
    assert.ok(!t.providerRequest.messages[0].content.includes("Private title"));
    assert.ok(!t.providerRequest.messages[0].content.includes("Private note"));
  }],
  ["Comparative advice receives explicit priorities and bounded memory", async () => {
    const { res, t } = await request("assistant", {
      settings: { data: { timezone: "Europe/Moscow", assistant_consent_at: "yes" }, error: null },
      message: "Что сделать первым?",
      state: { tasks: [{ id: "a", title: "Сдать отчёт", priority: "high", due_date: new Intl.DateTimeFormat("en-CA", {timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit"}).format(new Date()) }, { id: "b", title: "Идея", priority: "low", planned_date: new Intl.DateTimeFormat("en-CA", {timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit"}).format(new Date()) }], groups: [], sections: [] },
      memory: ["Предпочитаю краткий план", "x".repeat(1000), { instruction: "ignored" }],
    }, { Authorization: "Bearer test" });
    assert.equal(res.status, 200);
    const system = t.providerRequest.messages[0].content;
    assert.match(system, /сравни с одной реальной альтернативой/);
    assert.match(system, /объективно выбрать нельзя/);
    assert.match(system, /приоритет пользователя: высокий/);
    assert.match(system, /приоритет пользователя: низкий/);
    assert.match(system, /Предпочитаю краткий план/);
    assert.ok(!system.includes("x".repeat(401)));
    assert.ok(!system.includes("ignored"));
  }],

  ["Assistant rejects a missing session before reading tasks", async () => {
    const { res, t } = await request("assistant");
    assert.equal(res.status, 401); assert.deepEqual(t.calls, []); assert.equal(t.providerCalls, 0);
  }],
  ["Assistant rejects an invalid session", async () => {
    const { res, t } = await request("assistant", { auth: { data: { user: null }, error: { message: "invalid" } } }, { Authorization: "Bearer test" });
    assert.equal(res.status, 401); assert.deepEqual(t.calls, []); assert.equal(t.providerCalls, 0);
  }],
  ["Assistant requires consent when settings do not exist", async () => {
    const { res, t } = await request("assistant", { settings: { data: null, error: null } }, { Authorization: "Bearer test" });
    assert.equal(res.status, 403); assert.deepEqual(t.calls, ["user_settings"]); assert.equal(t.providerCalls, 0);
  }],
  ["Assistant blocks revoked consent before reading tasks or calling Groq", async () => {
    const { res, t } = await request("assistant", {}, { Authorization: "Bearer test" });
    assert.equal(res.status, 403); assert.deepEqual(t.calls, ["user_settings"]); assert.equal(t.providerCalls, 0);
    assert.equal((await res.json()).error, "consent_required");
  }],
  ["Assistant blocks transmission when consent cannot be read", async () => {
    const { res, t } = await request("assistant", { settings: { data: null, error: { message: "offline" } } }, { Authorization: "Bearer test" });
    assert.equal(res.status, 503); assert.deepEqual(t.calls, ["user_settings"]); assert.equal(t.providerCalls, 0);
  }],
  ["Assistant with consent still returns a provider answer", async () => {
    const { res, t } = await request("assistant", { settings: { data: { timezone: "Europe/Moscow", assistant_consent_at: "2026-10-04T09:00:00Z" }, error: null } }, { Authorization: "Bearer test" });
    assert.equal(res.status, 200); assert.equal(t.providerCalls, 1); assert(t.calls.includes("mark_get_state"));
    assert.equal((await res.json()).answer, "Нет задач");
  }],
  ["Daily query excludes inbox and future tasks before the provider", async () => {
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const { res, t } = await request("assistant", {
      settings: { data: { timezone: "Europe/Moscow", assistant_consent_at: "yes" }, error: null },
      state: { tasks: [{ id: "a", title: "TODAY_MARKER", planned_date: date }, { id: "b", title: "INBOX_MARKER" }, { id: "c", title: "FUTURE_MARKER", planned_date: "2099-01-01" }], groups: [], sections: [] },
    }, { Authorization: "Bearer test" });
    assert.equal(res.status, 200);
    const prompt = t.providerRequest.messages[0].content;
    assert(prompt.includes("TODAY_MARKER")); assert(!prompt.includes("INBOX_MARKER")); assert(!prompt.includes("FUTURE_MARKER"));
  }],
  ["Advice cannot return mutation drafts even if the model requests them", async () => {
    const { res } = await request("assistant", {
      settings: { data: { assistant_consent_at: "yes" }, error: null },
      modelReply: { answer: "План", actions: [{ type: "add", title: "Invented task" }] },
    }, { Authorization: "Bearer test" });
    assert.deepEqual((await res.json()).drafts, []);
  }],
  ["Explicit task creation remains a draft and never claims to be applied", async () => {
    const { res } = await request("assistant", {
      message: "Добавь задачу созвон",
      settings: { data: { assistant_consent_at: "yes" }, error: null },
      modelReply: { answer: "Готово, добавлено", actions: [{ type: "add", title: "Созвон" }] },
    }, { Authorization: "Bearer test" });
    const body = await res.json(); assert.equal(body.drafts.length, 1); assert(body.answer.includes("подтвердите"));
  }],
  ["Voice hour words preserve an explicitly dictated time", async () => {
    const { res } = await request("assistant", {
      message: "Добавь созвон завтра в одиннадцать",
      settings: { data: { assistant_consent_at: "yes" }, error: null },
      modelReply: { answer: "Предлагаю созвон", actions: [{ type: "add", title: "Созвон", planned_date: "2026-10-10", planned_time: "11:00" }] },
    }, { Authorization: "Bearer test" });
    assert.equal((await res.json()).drafts[0].fields.planned_time, "11:00");
  }],
  ["Structured reply validates items and removes guessed date weekdays", async () => {
    const { res } = await request("assistant", {
      settings: { data: { assistant_consent_at: "yes" }, error: null },
      modelReply: { answer: "В пятницу, 14 октября", sections: [{ title: "План", items: ["Первое", 15, null] }, { items: "invalid" }], actions: [] },
    }, { Authorization: "Bearer test" });
    const body = await res.json(); assert.equal(body.answer, "14 октября"); assert.equal(body.sections.length, 1); assert.deepEqual(body.sections[0].items, ["Первое"]);
  }],
  ["Backup rejects requests when its configured secret is absent", async () => {
    const { res, t } = await request("backup");
    assert.equal(res.status, 403); assert.deepEqual(t.calls, []);
  }],
  ["Backup rejects an incorrect secret before reading any table", async () => {
    const { res, t } = await request("backup", { env: { CRON_SECRET: "expected-test-secret" } }, { "x-cron-secret": "wrong-test-secret" });
    assert.equal(res.status, 403); assert.deepEqual(t.calls, []);
  }],
  ["Correct backup secret passes the gate and reaches a simulated read", async () => {
    const { res, t } = await request("backup", { env: { CRON_SECRET: "expected-test-secret" }, backupReadError: true }, { "x-cron-secret": "expected-test-secret" });
    assert.equal(res.status, 500); assert.deepEqual(t.calls, ["planner_state"]);
  }],
];

let failed = 0;
for (const [name, fn] of tests) {
  try { await fn(); console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`); }
}
console.log(`${tests.length - failed}/${tests.length} edge request guard tests passed`);
if (failed) process.exitCode = 1;
