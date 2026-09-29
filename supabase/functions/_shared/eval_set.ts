// Контрольный набор разбора сообщений (раздел 15 ТЗ): 50 текстовых примеров.
// «Сегодня» зафиксировано — вторник, 29 сентября 2026, — чтобы ожидаемые даты
// не зависели от дня прогона. Номера задач — из FIXTURE_TASKS, с единицы.

export const EVAL_TODAY = "2026-09-29";

export const FIXTURE_GROUPS = [
  { id: "g-sales", name: "Продажи", sectionName: "KINOMARK" },
  { id: "g-ops", name: "Операционка", sectionName: "KINOMARK" },
  { id: "g-health", name: "Здоровье", sectionName: "Личное" },
];

export const FIXTURE_TASKS = [
  { id: "t1", title: "Встреча с Олегом", date: "2026-09-30", time: "11:00", dateMode: "on" },
  { id: "t2", title: "Встреча с Анной", date: "2026-10-01", time: "15:00", dateMode: "on" },
  { id: "t3", title: "Отчёт по проекту Метка", date: "2026-10-02", time: "", dateMode: "due" },
  { id: "t4", title: "Позвонить маме", date: "", time: "", dateMode: "due" },
  { id: "t5", title: "Купить подарок Лике", date: "2026-10-03", time: "", dateMode: "on" },
  { id: "t6", title: "Смета для Palmira Istra", date: "2026-10-05", time: "", dateMode: "due" },
  { id: "t7", title: "Тренировка", date: "2026-09-29", time: "19:00", dateMode: "on" },
  { id: "t8", title: "Оплатить аренду студии", date: "2026-10-01", time: "", dateMode: "due" },
];

// Ожидание: kind; для add — список задач с датой, временем и (если сказано
// явно) режимом; для delete/done/move — набор целей и дата/время переноса.
export type Expect =
  | { kind: "add"; tasks: { date: string; time?: string; mode?: "on" | "due" }[] }
  | { kind: "delete" | "done"; targets: string[] }
  | { kind: "move"; targets: string[]; date: string; time?: string }
  | { kind: "unclear" };

export const EVAL_SET: { text: string; expect: Expect }[] = [
  { text: "созвон с клиентом завтра в 11", expect: { kind: "add", tasks: [{ date: "2026-09-30", time: "11:00" }] } },
  { text: "отчёт по налогам до пятницы", expect: { kind: "add", tasks: [{ date: "2026-10-02", time: "", mode: "due" }] } },
  { text: "купить хлеб", expect: { kind: "add", tasks: [{ date: "", time: "" }] } },
  { text: "в понедельник в 10:30 встреча с юристом", expect: { kind: "add", tasks: [{ date: "2026-10-05", time: "10:30", mode: "on" }] } },
  { text: "до 15 октября подать документы", expect: { kind: "add", tasks: [{ date: "2026-10-15", time: "", mode: "due" }] } },
  { text: "послезавтра забрать посылку", expect: { kind: "add", tasks: [{ date: "2026-10-01", time: "" }] } },
  { text: "позвонить Ольге в среду в 9 утра", expect: { kind: "add", tasks: [{ date: "2026-09-30", time: "09:00" }] } },
  { text: "купить хлеб, позвонить маме и написать Олегу", expect: { kind: "add", tasks: [{ date: "" }, { date: "" }, { date: "" }] } },
  { text: "завтра в 14:00 созвон с Лерой и в пятницу сдать макеты", expect: { kind: "add", tasks: [{ date: "2026-09-30", time: "14:00" }, { date: "2026-10-02" }] } },
  { text: "сегодня вечером разобрать почту", expect: { kind: "add", tasks: [{ date: "2026-09-29", time: "" }] } },
  { text: "удали встречу с Олегом", expect: { kind: "delete", targets: ["t1"] } },
  { text: "встреча с Анной отменилась, удали её", expect: { kind: "delete", targets: ["t2"] } },
  { text: "позвонил маме", expect: { kind: "done", targets: ["t4"] } },
  { text: "отчёт по проекту Метка готов", expect: { kind: "done", targets: ["t3"] } },
  { text: "перенеси встречу с Олегом на пятницу", expect: { kind: "move", targets: ["t1"], date: "2026-10-02" } },
  { text: "перенеси тренировку на завтра", expect: { kind: "move", targets: ["t7"], date: "2026-09-30" } },
  { text: "удали встречу", expect: { kind: "delete", targets: ["t1", "t2"] } },
  { text: "перенеси встречу на понедельник", expect: { kind: "move", targets: ["t1", "t2"], date: "2026-10-05" } },
  { text: "аренду студии оплатил", expect: { kind: "done", targets: ["t8"] } },
  { text: "смету для Palmira перенеси на 7 октября", expect: { kind: "move", targets: ["t6"], date: "2026-10-07" } },
  { text: "асдфыва", expect: { kind: "unclear" } },
  { text: "ээээ ну это самое", expect: { kind: "unclear" } },
  { text: "подготовить презентацию для KINOMARK к среде", expect: { kind: "add", tasks: [{ date: "2026-09-30", time: "", mode: "due" }] } },
  { text: "через неделю продлить домен", expect: { kind: "add", tasks: [{ date: "2026-10-06", time: "" }] } },
  { text: "12 октября в 16:00 стоматолог", expect: { kind: "add", tasks: [{ date: "2026-10-12", time: "16:00" }] } },
  { text: "записаться к врачу утром", expect: { kind: "add", tasks: [{ time: "" } as any] } },
  { text: "3 октября день рождения Лики", expect: { kind: "add", tasks: [{ date: "2026-10-03", time: "" }] } },
  { text: "в субботу в 12 уборка", expect: { kind: "add", tasks: [{ date: "2026-10-03", time: "12:00" }] } },
  { text: "удали задачу про подарок Лике", expect: { kind: "delete", targets: ["t5"] } },
  { text: "подарок Лике купил", expect: { kind: "done", targets: ["t5"] } },
  { text: "перенеси звонок маме на субботу", expect: { kind: "move", targets: ["t4"], date: "2026-10-03" } },
  { text: "созвон с Анной перенеси на завтра на 16:00", expect: { kind: "move", targets: ["t2"], date: "2026-09-30", time: "16:00" } },
  { text: "Завтра: 1) созвон в 10; 2) отправить счёт; 3) тренировка в 19", expect: { kind: "add", tasks: [{ date: "2026-09-30", time: "10:00" }, { date: "2026-09-30", time: "" }, { date: "2026-09-30", time: "19:00" }] } },
  { text: "не забыть оплатить интернет до конца месяца", expect: { kind: "add", tasks: [{ date: "2026-09-30", mode: "due" }] } },
  { text: "в четверг весь день съёмка", expect: { kind: "add", tasks: [{ date: "2026-10-01", time: "" }] } },
  { text: "встречу с Олегом провёл", expect: { kind: "done", targets: ["t1"] } },
  { text: "удали отчёт", expect: { kind: "delete", targets: ["t3"] } },
  { text: "найти подрядчика на ремонт", expect: { kind: "add", tasks: [{ date: "", time: "" }] } },
  { text: "20 октября в 13:00 созвон с партнёрами", expect: { kind: "add", tasks: [{ date: "2026-10-20", time: "13:00" }] } },
  { text: "сдать отчёт в налоговую до 25.10", expect: { kind: "add", tasks: [{ date: "2026-10-25", time: "", mode: "due" }] } },
  { text: "перенеси смету на завтра", expect: { kind: "move", targets: ["t6"], date: "2026-09-30" } },
  { text: "тренировку отмени", expect: { kind: "delete", targets: ["t7"] } },
  { text: "завтра в 25:00 созвон", expect: { kind: "add", tasks: [{ date: "2026-09-30", time: "" }] } },
  { text: "обед с командой в пятницу в 13:30", expect: { kind: "add", tasks: [{ date: "2026-10-02", time: "13:30", mode: "on" }] } },
  { text: "к понедельнику подготовить КП", expect: { kind: "add", tasks: [{ date: "2026-10-05", time: "", mode: "due" }] } },
  { text: "в среду и в четверг тренировка в 19", expect: { kind: "add", tasks: [{ date: "2026-09-30", time: "19:00" }, { date: "2026-10-01", time: "19:00" }] } },
  { text: "перенеси тренировку на 20:00", expect: { kind: "move", targets: ["t7"], date: "2026-09-29", time: "20:00" } },
  { text: "запиши: забрать ключи у Олега в понедельник", expect: { kind: "add", tasks: [{ date: "2026-10-05" }] } },
  { text: "в пятницу до 18:00 отправить договор", expect: { kind: "add", tasks: [{ date: "2026-10-02", time: "18:00", mode: "due" }] } },
  { text: "полить цветы", expect: { kind: "add", tasks: [{ date: "", time: "" }] } },
];

// Сравнение разбора с ожиданием: общий итог и по полям.
export function scoreOne(parsed: any, expect: Expect) {
  const r = { intent: parsed.kind === expect.kind, count: true, dates: true, times: true, modes: true, targets: true };
  if (!r.intent) return { ...r, ok: false };
  if (expect.kind === "add") {
    const got = parsed.drafts || [];
    r.count = got.length === expect.tasks.length;
    expect.tasks.forEach((e, i) => {
      const g = got[i] || {};
      if ("date" in e && (g.date || "") !== e.date) r.dates = false;
      if ("time" in e && (g.time || "") !== (e.time || "")) r.times = false;
      if (e.mode && g.dateMode !== e.mode) r.modes = false;
    });
  } else if (expect.kind !== "unclear") {
    const ids = (parsed.targets || []).map((t: any) => t.id).sort();
    r.targets = JSON.stringify(ids) === JSON.stringify([...expect.targets].sort());
    if (expect.kind === "move") {
      r.dates = parsed.date === expect.date;
      if ("time" in expect && expect.time) r.times = parsed.time === expect.time;
    }
  }
  return { ...r, ok: r.intent && r.count && r.dates && r.times && r.modes && r.targets };
}
