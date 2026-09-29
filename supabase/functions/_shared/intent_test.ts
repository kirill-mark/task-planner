// deno test supabase/functions/_shared/intent_test.ts — разбор сообщений бота (A18–A22, A28).
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { normalizeEdit, parseMessage, selectCandidates, type ParseContext } from "./intent.ts";
import { humanDay, splitMessage, taskCard, whenLine } from "./botfmt.ts";

const ctx = (over: Partial<ParseContext> = {}): ParseContext => ({
  today: "2026-09-29",
  calendar: "2026-09-29 — вторник (сегодня)\n2026-09-30 — среда (завтра)\n2026-10-02 — пятница",
  groups: [{ id: "g1", name: "Продажи", sectionName: "KINOMARK" }],
  openTasks: [
    { id: "a", title: "Встреча с Олегом", date: "2026-09-30", time: "11:00", dateMode: "on" },
    { id: "b", title: "Встреча с Анной", date: "2026-10-01", time: "15:00", dateMode: "on" },
    { id: "c", title: "Отчёт по проекту", date: "2026-10-02", dateMode: "due" },
  ],
  newTaskDate: "inbox",
  ...over,
});
const model = (answer: unknown) => async () => JSON.stringify(answer);

Deno.test("A18: «созвон завтра в 11» — плановое время; «до пятницы» — дедлайн", async () => {
  const p = await parseMessage("созвон завтра в 11 и отчёт до пятницы", ctx(), model({ intent: "add", tasks: [
    { title: "Созвон", date: "2026-09-30", time: "11:00", dateMode: "on", groupId: "" },
    { title: "Отчёт", date: "2026-10-02", time: "", dateMode: "due", groupId: "g1" },
  ] }));
  assert(p.kind === "add");
  assertEquals(p.drafts.map((d) => [d.title, d.date, d.time, d.dateMode, d.groupId]), [
    ["Созвон", "2026-09-30", "11:00", "on", null],
    ["Отчёт", "2026-10-02", "", "due", "g1"],
  ]);
});

Deno.test("A19: три поручения — три черновика", async () => {
  const p = await parseMessage("купить хлеб, позвонить маме, написать Олегу", ctx(), model({ intent: "add", tasks: [{ title: "Купить хлеб" }, { title: "Позвонить маме" }, { title: "Написать Олегу" }] }));
  assert(p.kind === "add");
  assertEquals(p.drafts.length, 3);
});

Deno.test("A20: без даты и без ясной группы — «Входящие», время не выдумывается", async () => {
  const p = await parseMessage("разобрать почту вечером", ctx(), model({ intent: "add", tasks: [{ title: "Разобрать почту", date: "", time: "18:00", groupId: "несуществующая" }] }));
  assert(p.kind === "add");
  assertEquals([p.drafts[0].date, p.drafts[0].time, p.drafts[0].groupId], ["", "", null]);
});

Deno.test("A20: настройка «на сегодня» ставит сегодняшнюю дату задаче без даты", async () => {
  const p = await parseMessage("разобрать почту", ctx({ newTaskDate: "today" }), model({ intent: "add", tasks: [{ title: "Разобрать почту" }] }));
  assert(p.kind === "add");
  assertEquals(p.drafts[0].date, "2026-09-29");
});

Deno.test("невалидные дата и время от модели отбрасываются", async () => {
  const p = await parseMessage("x", ctx(), model({ intent: "add", tasks: [{ title: "X", date: "2026-02-30", time: "25:99" }] }));
  assert(p.kind === "add");
  assertEquals([p.drafts[0].date, p.drafts[0].time], ["", ""]);
});

Deno.test("A22: две похожие встречи — обе в кандидатах для выбора", async () => {
  const p = await parseMessage("перенеси встречу на пятницу", ctx(), model({ intent: "move", targets: [1, 2], date: "2026-10-02" }));
  assert(p.kind === "move");
  assertEquals(p.targets.map((t) => t.id).sort(), ["a", "b"]);
  assertEquals(p.date, "2026-10-02");
});

Deno.test("поиск кандидатов не ограничен последними — совпавшие по словам первыми", () => {
  const many = Array.from({ length: 100 }, (_, i) => ({ id: "t" + i, title: "Задача " + i }));
  many.push({ id: "olga", title: "Позвонить Ольге про договор" });
  const c = selectCandidates("позвони ольге", many, 10);
  assertEquals(c[0].id, "olga");
});

Deno.test("номера задач вне списка отбрасываются; ничего не подошло — непонятно", async () => {
  const p = await parseMessage("удали что-нибудь", ctx(), model({ intent: "delete", targets: [99] }));
  assertEquals(p.kind, "unclear");
});

Deno.test("A23: не JSON от модели — ошибка, а не задача", async () => {
  await assertRejects(() => parseMessage("удали встречу", ctx(), async () => "извините, не могу"), Error, "не JSON");
});

Deno.test("A21: перенос — только дата; прочее не меняется; время очищается лишь по прямой просьбе", () => {
  assertEquals(normalizeEdit({ date: "2026-10-02" }, ctx()), { date: "2026-10-02" });
  assertEquals(normalizeEdit({ date: "2026-10-02", time: "", notes: undefined }, ctx()), { date: "2026-10-02" });
  assertEquals(normalizeEdit({ clearTime: true }, ctx()), { clearTime: true });
  assertEquals(normalizeEdit({ groupId: "чужая" }, ctx()), {});
});

Deno.test("карточка: дата с днём недели, путь, без пустых строк; A27 — символы экранированы", () => {
  const card = taskCard("Добавлено", { title: "Созвон <b>&</b>", date: "2026-09-29", time: "11:00", dateMode: "on" }, "KINOMARK → Продажи", "2026-09-29");
  assertEquals(card, "<b>Добавлено</b>\nСозвон &lt;b&gt;&amp;&lt;/b&gt;\nВторник, 29 сентября · 11:00\nKINOMARK → Продажи");
  assertEquals(whenLine({ title: "x", date: "2026-10-02", dateMode: "due" }, "2026-09-29"), "Дедлайн до: пятница, 2 октября");
  assertEquals(humanDay("2027-01-05", "2026-09-29"), "Вторник, 5 января 2027");
});

Deno.test("A27: длинная сводка режется по строкам, в пределах лимита", () => {
  const text = Array.from({ length: 400 }, (_, i) => `• <b>задача ${i}</b> — описание`).join("\n");
  const parts = splitMessage(text, 3900);
  assert(parts.length > 1);
  assert(parts.every((p) => p.length <= 3900));
  assertEquals(parts.join("\n"), text);
});

Deno.test("время названо — можно; не названо — модель его не подставляет", async () => {
  const { timeMentioned } = await import("./intent.ts");
  for (const t of ["созвон в 11", "в 10:00", "к 15 часам", "до 18:00", "утром", "вечером", "через 20 минут", "в 9 утра"]) assert(timeMentioned(t), t);
  for (const t of ["перенеси на пятницу", "поставь длительность 1 час", "добавь задачу без даты", "на 2 октября"]) assert(!timeMentioned(t), t);
});

Deno.test("дата с числом — не время", async () => {
  const { timeMentioned } = await import("./intent.ts");
  for (const t of ["до 5 октября", "в 3-го декабря", "перенеси на 2 октября", "с 1 января"]) assert(!timeMentioned(t), t);
});

Deno.test("день недели без «следующей» — ближайший; сегодняшний и явный «следующий» не трогаются", async () => {
  const add = (date: string) => model({ intent: "add", tasks: [{ title: "Звонок", date, time: "09:00" }] });
  let p = await parseMessage("позвонить Ольге в среду в 9", ctx(), add("2026-10-07"));
  assert(p.kind === "add"); assertEquals(p.drafts[0].date, "2026-09-30");
  p = await parseMessage("позвонить Ольге в следующую среду", ctx(), add("2026-10-07"));
  assert(p.kind === "add"); assertEquals(p.drafts[0].date, "2026-10-07");
  p = await parseMessage("во вторник созвон", ctx(), add("2026-10-06"));
  assert(p.kind === "add"); assertEquals(p.drafts[0].date, "2026-10-06");
  p = await parseMessage("перенеси встречу на пятницу", ctx(), model({ intent: "move", targets: [1], date: "2026-10-09" }));
  assert(p.kind === "move"); assertEquals(p.date, "2026-10-02");
  p = await parseMessage("в пятницу сдать макеты", ctx(), add("2026-10-02"));
  assert(p.kind === "add"); assertEquals(p.drafts[0].date, "2026-10-02");
});

Deno.test("дата из текста важнее даты модели; несколько выражений — по порядку", async () => {
  const add = (tasks: unknown[]) => model({ intent: "add", tasks });
  let p = await parseMessage("перенеси смету на завтра", ctx(), model({ intent: "move", targets: [1], date: "2026-10-01" }));
  assert(p.kind === "move"); assertEquals(p.date, "2026-09-30");
  p = await parseMessage("обед с командой в пятницу в 13:30", ctx(), add([{ title: "Обед", date: "2026-10-07", time: "13:30" }]));
  assert(p.kind === "add"); assertEquals(p.drafts[0].date, "2026-10-02");
  p = await parseMessage("сегодня вечером разобрать почту", ctx(), add([{ title: "Почта", date: "" }]));
  assert(p.kind === "add"); assertEquals([p.drafts[0].date, p.drafts[0].time], ["2026-09-29", ""]);
  p = await parseMessage("в среду и в четверг тренировка в 19", ctx(), add([{ title: "Тренировка", date: "2026-10-01", time: "19:00" }, { title: "Тренировка", date: "2026-10-02", time: "19:00" }]));
  assert(p.kind === "add"); assertEquals(p.drafts.map((x) => x.date), ["2026-09-30", "2026-10-01"]);
  // одно выражение на несколько поручений: дата только там, где её поставила модель
  p = await parseMessage("купить хлеб и завтра позвонить маме", ctx(), add([{ title: "Хлеб", date: "" }, { title: "Маме", date: "2026-10-01" }]));
  assert(p.kind === "add"); assertEquals(p.drafts.map((x) => x.date), ["", "2026-09-30"]);
});
