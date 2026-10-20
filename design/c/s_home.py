"""Главная: состояния дня."""
from ds import *

SCREENS = []


def add(code, name, title, c, body, interactive=False, page_id="home", style=""):
    SCREENS.append(dict(file=f"C-{code}-{name}.dc.html", title=f"{code}. {title}", c=c,
                        html=page(f"{code}. {title}", c, body, style), page=page_id, interactive=interactive))


def plan_list(c, completed=("call",), extra_overdue=False, long=False):
    rows = []
    t1 = "Позвонить Никите по поводу сметы и графика съёмок на следующую неделю" if long else "Позвонить Никите"
    rows.append(task_row(c, t1, when(c, "11:30", extra=["выполнено"]) if "call" in completed else when(c, "11:30"), done="call" in completed, href="C-E01-TaskView.dc.html"))
    if extra_overdue:
        rows.append(task_row(c, "Отправить смету подрядчику", when(c, None, "сегодня 12:00", "overdue", ["KINOMARK"]), href="C-E01-TaskView.dc.html"))
    t2 = "Тренировка в зале на Профсоюзной" if long else "Тренировка"
    rows.append(task_row(c, t2, when(c, "19:00 · 1 ч", extra=["Здоровье"]), done="gym" in completed))
    rows.append(task_row(c, "Разобрать почту", when(c, "Без времени"), done="mail" in completed))
    t4 = "Оплатить аренду студии за ноябрь и отправить чек бухгалтеру" if long else "Оплатить аренду студии"
    rows.append(task_row(c, t4, when(c, None, "до конца дня", "today", ["KINOMARK"]), done="rent" in completed))
    return "\n".join("      " + r for r in rows)


def home_body(c, main=None, plan=None, chips=None, top="", head_done=1, total=5, after_head=""):
    main = main if main is not None else main_card(c)
    plan = plan if plan is not None else plan_list(c)
    chips = chips if chips is not None else chips_row(c, [("Входящие · 4", "C-T09-Inbox.dc.html", None), (f'{icon("alert", 14, 2)}Просрочено · 2', "C-T08-Overdue.dc.html", "red")])
    return f'''{home_header(c)}
{top}
{main}
{event_block(c)}
    <section aria-label="План дня" style="display: flex; flex-direction: column">
{plan_head(c, head_done, total)}
{after_head}
      <div style="margin-top: 4px"></div>
{plan}
    </section>
{chips}'''


def build():
    D = Ctx()
    add("H01", "Home", "Обычный день", D, root(D, home_body(D), nav="home", add_href="C-C01-AddEmpty.dc.html"), True)

    # Главная задача не выбрана
    c = Ctx()
    nomain = f'''    <section aria-label="Главная задача" style="border: 1px dashed {c.t['outline']}; border-radius: 20px; padding: 14px 16px; display: flex; align-items: center; gap: 12px">
      <div style="flex: 1; display: flex; flex-direction: column; gap: 2px"><span style="font-weight: 600">Главная задача не выбрана</span><span class="lbl">Выберите одну задачу, которую важно сделать сегодня</span></div>
      <a href="C-H03-PickMain.dc.html" class="btn2" style="min-height: 40px">Выбрать</a>
    </section>'''
    plan = task_row(c, "Смета для Palmira Istra", when(c, None, "15:00", "today", ["KINOMARK"]), href="C-E01-TaskView.dc.html") + "\n" + plan_list(c)
    add("H02", "NoMain", "Главная задача не выбрана", c, root(c, home_body(c, nomain, plan), nav="home"), True)

    # Выбор главной задачи
    c = Ctx()
    opts = [("Смета для Palmira Istra", when(c, None, "15:00", "today", ["KINOMARK"]), True),
            ("Тренировка", when(c, "19:00 · 1 ч", extra=["Здоровье"]), False),
            ("Разобрать почту", when(c, "Без времени"), False),
            ("Оплатить аренду студии", when(c, None, "до конца дня", "today", ["KINOMARK"]), False)]
    rows = "".join(f'''<a href="C-H01-Home.dc.html" role="radio" aria-checked="{str(sel).lower()}" class="row" style="align-items: center">
        <span style="width: 22px; height: 22px; border-radius: 50%; border: {"7px solid " + c.t["green"] if sel else "1.5px solid " + c.t["check"]}; box-sizing: border-box; flex-shrink: 0"></span>
        <span style="flex: 1; min-width: 0"><span style="display: block">{esc(n)}</span><span class="meta">{m}</span></span></a>''' for n, m, sel in opts)
    inner = f'''{sheet_head(c, "Главная задача", "Отмена", "Готово", "C-H01-Home.dc.html", "C-H01-Home.dc.html")}
    <p class="lbl" style="margin: 0">Главная задача показывается первой и не дублируется в плане дня. Выполненную задачу выбрать нельзя.</p>
    <div role="radiogroup" aria-label="Задачи на сегодня">{rows}</div>
    <a href="C-H02-NoMain.dc.html" class="tbtn" style="color: {c.t['text3']}">Не выбирать главную задачу</a>'''
    add("H03", "PickMain", "Выбор и смена главной задачи", c, root(c, home_body(c), nav="home", overlay=scrim(c) + sheet(c, inner, 0, "Главная задача", pad="8px 20px 34px")), True)

    # Задач на сегодня нет
    c = Ctx()
    emp = empty(c, "check", "На сегодня задач нет", "Можно добавить задачу или взять что-то из входящих.", "Разобрать входящие · 4", "C-T09-Inbox.dc.html")
    body = f'''{home_header(c)}
{event_block(c)}
    <section aria-label="План дня" style="display: flex; flex-direction: column; gap: 4px">
      <h2 class="sec">План дня</h2>
{emp}
    </section>'''
    add("H04", "Empty", "Задач на сегодня нет", c, root(c, body, nav="home"), True)

    # Все выполнены
    c = Ctx()
    done_main = main_card(c, meta=when(c, "14:00", extra=["выполнено в 14:40", "KINOMARK"]), done=True)
    plan = plan_list(c, ("call", "gym", "mail", "rent"))
    top = banner(c, "Все задачи на сегодня выполнены", "neutral", "check", sub="Завтра 3 задачи и 1 встреча")
    body = home_body(c, done_main, plan, chips_row(c, [("Входящие · 4", "C-T09-Inbox.dc.html", None)]), top, 5, 5)
    add("H05", "AllDone", "Все задачи выполнены", c, root(c, body, nav="home"))

    # Есть просроченные сроки
    c = Ctx()
    plan = plan_list(c, extra_overdue=True)
    body = home_body(c, plan=plan, chips=chips_row(c, [("Входящие · 4", "C-T09-Inbox.dc.html", None), (f'{icon("alert", 14, 2)}Просрочено · 3', "C-T08-Overdue.dc.html", "red")]), total=6)
    add("H06", "Overdue", "Срок задачи прошёл", c, root(c, body, nav="home"), True)

    # Нет сети
    c = Ctx()
    top = banner(c, "Нет сети", "neutral", "cloud_off", sub="Изменения сохранены на телефоне и отправятся, когда появится связь · 2 изменения")
    plan = plan_list(c, ("call", "gym"))
    add("H07", "Offline", "Нет сети, изменения на телефоне", c, root(c, home_body(c, top=top, plan=plan, head_done=2), nav="home"))

    # Две версии
    c = Ctx()
    top = banner(c, "У задачи две версии", "yellow", "layers", "Сравнить", "C-H09-Versions.dc.html", "«Оплатить аренду студии»: срок изменили на двух устройствах")
    add("H08", "Conflict", "У задачи две версии", c, root(c, home_body(c, top=top), nav="home"), True)

    # Сравнение версий
    c = Ctx()
    t = c.t

    def ver(head, sub, rows, href):
        r = "".join(f'<div style="display: flex; justify-content: space-between; gap: 12px; padding: 8px 0; border-top: 1px solid {t["divider"]}"><span class="lbl">{k}</span><span style="text-align: right; {"color: " + t["yellow"] + "; font-weight: 600" if hl else ""}">{v}</span></div>' for k, v, hl in rows)
        return f'''<section class="card" style="display: flex; flex-direction: column; gap: 6px">
        <div style="display: flex; flex-direction: column"><span style="font-weight: 600">{head}</span><span class="lbl">{sub}</span></div>
        {r}
        <a href="{href}" class="btn2" style="margin-top: 6px">Оставить эту версию</a>
      </section>'''
    rows_a = [("Название", "Оплатить аренду студии", False), ("Выполнить до", "сегодня, до конца дня", True), ("Проект", "KINOMARK", False)]
    rows_b = [("Название", "Оплатить аренду студии", False), ("Выполнить до", "21 октября, 18:00", True), ("Проект", "KINOMARK", False)]
    body = f'''{back_bar(c, "Две версии", "Главная", "C-H01-Home.dc.html")}
    <p style="margin: 0; color: {t['text2']}">Задачу изменили на двух устройствах, пока не было связи. Отличается только срок. Выберите, какую версию оставить, — вторая не потеряется до вашего выбора.</p>
    {ver("На этом телефоне", "изменено сегодня в 12:31", rows_a, "C-H01-Home.dc.html")}
    {ver("На другом устройстве", "веб-версия, сегодня в 12:44", rows_b, "C-H01-Home.dc.html")}
    <a href="C-H01-Home.dc.html" class="tbtn" style="align-self: center; color: {t['text3']}">Решить позже</a>'''
    add("H09", "Versions", "Сравнение двух версий", c, root(c, body), True)

    # Завершение и отмена
    c = Ctx()
    plan = plan_list(c, ("call", "gym"))
    ov = toast(c, "Задача «Тренировка» выполнена", "Отменить", "C-H01-Home.dc.html", ic="check")
    add("H10", "Completed", "Задача выполнена — «Отменить»", c, root(c, home_body(c, plan=plan, head_done=2), nav="home", overlay=ov), True)

    # Длинные названия, 360
    c = Ctx(w=360, h=780)
    mc = main_card(c, "Согласовать смету и график съёмок для Palmira Istra с заказчиком")
    add("H11", "Narrow", "360 × 780, длинные названия", c, root(c, home_body(c, mc, plan_list(c, long=True)), nav="home"))

    # Крупный текст
    c = Ctx(s=LARGE)
    add("H12", "LargeText", "Крупный текст", c, root(c, home_body(c), nav="home"))
    c = Ctx(s=LARGE)
    add("H12b", "LargeTextEnd", "Крупный текст — конец прокрутки", c, root(c, home_body(c), nav="home", scroll_end=True))

    # Загрузка
    c = Ctx()
    t = c.t

    def sk(w, h=12, r=6):
        return f'<span class="sk" style="display: block; width: {w}; height: {h}px; border-radius: {r}px"></span>'
    rows = "".join(f'<div class="row" style="align-items: center"><span class="sk" style="width: 22px; height: 22px; border-radius: 50%"></span><div style="flex: 1; display: flex; flex-direction: column; gap: 6px">{sk(w)}{sk("30%", 10)}</div></div>' for w in ("55%", "40%", "62%", "48%"))
    body = f'''{home_header(c)}
    <div aria-busy="true" aria-label="Загрузка задач" style="display: flex; flex-direction: column; gap: 16px">
      <div style="border-radius: 20px; background: {t['surface']}; padding: 16px; display: flex; flex-direction: column; gap: 10px">{sk("35%", 10)}{sk("70%", 16)}{sk("40%", 10)}</div>
      <div style="display: flex; flex-direction: column; gap: 8px">{sk("40%", 10)}{sk("60%", 16)}</div>
      <div>{rows}</div>
      <span class="lbl" style="text-align: center">Загружаю задачи…</span>
    </div>'''
    add("H13", "Loading", "Начальная загрузка", c, root(c, body, nav="home"))

    # Ошибка загрузки
    c = Ctx()
    err = empty(c, "cloud_off", "Не получилось загрузить задачи", "Проверьте интернет и попробуйте ещё раз. Задачи, сохранённые на телефоне, не пропадут.", "Повторить", "C-H13-Loading.dc.html")
    add("H14", "LoadError", "Ошибка получения данных", c, root(c, f"{home_header(c)}\n{err}", nav="home"), True)

    # Светлая тема
    L = Ctx(LIGHT)
    add("H15", "Light", "Светлая тема", L, root(L, home_body(L), nav="home"))
