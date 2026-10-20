"""Задачи, фильтры, поиск, входящие, выполненные и корзина."""
from ds import *

SCREENS = []
FILTERS = ["Все", "Сегодня", "Входящие · 4"]


def add(code, name, title, c, body, interactive=False):
    SCREENS.append(dict(file=f"C-{code}-{name}.dc.html", title=f"{code}. {title}", c=c,
                        html=page(f"{code}. {title}", c, body), page="tasks", interactive=interactive))


def head(c, sub="23 задачи"):
    right = (icon_btn(c, "search", "Поиск", "C-T06-Search.dc.html") + icon_btn(c, "layers", "Вид списка", "C-T03-ViewMenu.dc.html"))
    return screen_title(c, "Задачи", right, sub)


def filter_bar(c, sel):
    t = c.t
    f = filters(c, FILTERS, sel)
    more = f'<a href="C-T05-MoreFilters.dc.html" class="pill" aria-label="Другие фильтры" style="width: 44px; padding: 0; justify-content: center">{icon("filter", 18)}</a>'
    return f.replace("</div>", more + "</div>", 1) if f.endswith("</div>") else f


def inbox_badge(c):
    t = c.t
    return f'<span class="badge" style="color: {t["text3"]}; background: {t["raised"]}; font-weight: 500">{icon("inbox", 13)}Входящие</span>'


def main_badge(c):
    t = c.t
    return f'<span class="badge" style="color: {t["green_text"]}; background: {t["green_soft"]}">Главная</span>'


def sec(c, title, count, items, tone=None):
    t = c.t
    col = f"color: {t[tone]};" if tone else ""
    rows = "\n".join("      " + r for r in items)
    return f'''    <section aria-label="{title}" style="display: flex; flex-direction: column">
      <div style="display: flex; justify-content: space-between; align-items: baseline"><h2 class="sec" style="font-size: {c.s['base']}px; {col}">{title}</h2><span class="lbl">{count}</span></div>
{rows}
    </section>'''


def all_list(c, completed=(), long=False):
    T = lambda title, meta, **k: task_row(c, title, meta, href="C-E01-TaskView.dc.html", **k)
    overdue = sec(c, "Просрочено", 2, [
        T("Отправить акт за сентябрь", when(c, None, "18 окт", "overdue", ["KINOMARK"])),
        T("Записаться к стоматологу", when(c, None, "вчера", "overdue", ["Здоровье"])),
    ], "red")
    gym_done = "gym" in completed
    today = sec(c, "Сегодня", 5, [
        T("Смета для Palmira Istra", main_badge(c) + "<span>·</span>" + when(c, None, "15:00", "today", ["KINOMARK"])),
        T("Тренировка", when(c, "19:00 · 1 ч", extra=["Здоровье"]) if not gym_done else when(c, "19:00", extra=["выполнено"]), done=gym_done),
        T("Разобрать почту", when(c, "Без времени")),
        T("Оплатить аренду студии за ноябрь и отправить чек бухгалтеру" if long else "Оплатить аренду студии", when(c, None, "до конца дня", "today", ["KINOMARK"])),
        f'<a href="C-T12-Done.dc.html" class="lbl" style="min-height: 40px; display: flex; align-items: center; gap: 6px; border-top: 1px solid {c.t["divider"]}">{icon("check", 14, 2)}Выполнено сегодня · {2 if gym_done else 1}</a>',
    ])
    tomorrow = sec(c, "Завтра, 21 октября", 3, [
        T("Забрать оборудование из проката на Старом Арбате и вернуть залог", when(c, "10:00", extra=["напомнить в 9:00"])),
        T("Созвон с монтажёром", when(c, "12:00 · 30 мин", extra=["KINOMARK"])),
        T("Купить продукты", when(c, "Без времени", extra=["Дом"])),
    ])
    later = sec(c, "Позже", 4, [
        T("Отчёт для Palmira Istra", when(c, "пт, 23 окт", "23 окт", "future", ["KINOMARK"])),
    ])
    nodate = sec(c, "Без даты", 9, [
        T("Купить корм коту", inbox_badge(c)),
        T("Идея: подкаст про кино", inbox_badge(c)),
        T("Починить полку в коридоре", when(c, None, extra=["Дом"])),
    ])
    return "\n".join([overdue, today, tomorrow, later, nodate])


def tasks_screen(c, sel="Все", body=None, overlay="", scroll_end=False):
    inner = f"{head(c)}\n{filter_bar(c, sel)}\n{body if body is not None else all_list(c)}"
    return root(c, inner, nav="tasks", overlay=overlay, scroll_end=scroll_end, add_href="C-C01-AddEmpty.dc.html")


def build():
    D = Ctx()
    add("T01", "Tasks", "Задачи — список по умолчанию", D, tasks_screen(D), True)

    c = Ctx()
    T = lambda title, meta, **k: task_row(c, title, meta, href="C-E01-TaskView.dc.html", **k)
    today = "\n".join([
        sec(c, "Просрочено", 2, [T("Отправить акт за сентябрь", when(c, None, "18 окт", "overdue", ["KINOMARK"])),
                                  T("Записаться к стоматологу", when(c, None, "вчера", "overdue", ["Здоровье"]))], "red"),
        sec(c, "Сегодня · выполнено 1 из 5", "", [
            T("Смета для Palmira Istra", main_badge(c) + "<span>·</span>" + when(c, None, "15:00", "today", ["KINOMARK"])),
            T("Позвонить Никите", when(c, "11:30", extra=["выполнено"]), done=True),
            T("Тренировка", when(c, "19:00 · 1 ч", extra=["Здоровье"])),
            T("Разобрать почту", when(c, "Без времени")),
            T("Оплатить аренду студии", when(c, None, "до конца дня", "today", ["KINOMARK"]))]),
        f'<span class="lbl">Встреча с заказчиком в 15:00 — в календаре, в счётчик задач не входит.</span>'])
    add("T02", "Today", "Фильтр «Сегодня»", c, tasks_screen(c, "Сегодня", today))

    c = Ctx()
    m = menu(c, [("list", "Списком", "C-T01-Tasks.dc.html", "sel"), ("folder", "По проектам", "C-T04-ByProject.dc.html", None)], top=104, right=16, width=230)
    add("T03", "ViewMenu", "Меню выбора вида", c, tasks_screen(c, overlay=m), True)

    c = Ctx()
    T = lambda title, meta, **k: task_row(c, title, meta, href="C-E01-TaskView.dc.html", **k)
    t = c.t

    def proj(name, count, rows, href="C-P04-Project.dc.html"):
        r = "\n".join("      " + x for x in rows)
        return f'''    <section aria-label="{name}" style="display: flex; flex-direction: column">
      <a href="{href}" style="display: flex; align-items: center; gap: 8px; min-height: 40px"><span style="color: {t['text2']}; display: flex">{icon("folder", 18)}</span><h2 class="sec" style="font-size: {c.s['base']}px; flex: 1">{name}</h2><span class="lbl">{count}</span><span style="color: {t['text2']}; display: flex">{icon("chev", 16)}</span></a>
{r}
    </section>'''
    body = "\n".join([
        proj("KINOMARK", 12, [T("Отправить акт за сентябрь", when(c, None, "18 окт", "overdue")),
                              T("Смета для Palmira Istra", main_badge(c) + "<span>·</span>" + when(c, None, "15:00", "today")),
                              T("Оплатить аренду студии", when(c, None, "до конца дня", "today")),
                              f'<a href="C-P04-Project.dc.html" class="tbtn" style="font-size: {c.s["small"] + 1}px">Ещё 9 задач</a>']),
        proj("Здоровье", 3, [T("Записаться к стоматологу", when(c, None, "вчера", "overdue")),
                             T("Тренировка", when(c, "сегодня, 19:00 · 1 ч"))]),
        proj("Без проекта", 7, [T("Разобрать почту", when(c, "сегодня, без времени")),
                                T("Купить корм коту", inbox_badge(c))], "C-T09-Inbox.dc.html"),
    ])
    add("T04", "ByProject", "Вид «По проектам»", c, tasks_screen(c, "Все", body), True)

    c = Ctx()
    t = c.t
    inner = f'''{sheet_head(c, "Фильтры", "Сбросить", "Готово", "C-T01-Tasks.dc.html", "C-T01-Tasks.dc.html")}
    {group(c, [setting_row(c, "Ближайшие 7 дней", "14", "cal", "#"), setting_row(c, "Без даты", "9", "inbox", "#"),
               setting_row(c, "Просроченные", "2", "alert", "C-T08-Overdue.dc.html"), setting_row(c, "Выполненные", "", "check", "C-T12-Done.dc.html"),
               setting_row(c, "Корзина", "3", "trash", "C-T13-Trash.dc.html")], "Показать")}
    {group(c, [setting_row(c, "Только важные", "", "flag", toggle=False), setting_row(c, "Проект", "Любой", "folder")], "Уточнить")}'''
    add("T05", "MoreFilters", "Дополнительные фильтры", c, tasks_screen(c, overlay=scrim(c) + sheet(c, inner, 0, "Фильтры", pad="8px 20px 34px", gap=14)), True)

    # Поиск
    def search_screen(c, q, results):
        t = c.t
        bar = f'''    <div style="display: flex; gap: 8px; align-items: center">
      <span class="field focus" style="flex: 1"><span style="color: {t['text2']}; display: flex">{icon("search", 18)}</span><span style="flex: 1">{esc(q)}<span class="caret" aria-hidden="true"></span></span><span aria-label="Очистить" style="color: {t['text2']}; display: flex">{icon("close", 16)}</span></span>
      <a href="C-T01-Tasks.dc.html" style="color: {t['green_text']}; min-height: 44px; display: flex; align-items: center">Отмена</a>
    </div>'''
        return f'''<div style="width: {c.w}px; height: {c.h}px; box-sizing: border-box; background: {t['bg']}; color: {t['text']}; font-family: {FONT}; font-size: {c.s['base']}px; line-height: 1.4; position: relative; overflow: hidden">
  <div style="padding: 56px 20px 0; display: flex; flex-direction: column; gap: 14px">
{bar}
{results}
  </div>
  {keyboard(c)}
</div>'''
    c = Ctx()
    t = c.t
    hl = lambda s: s.replace("смет", f'<mark style="background: {t["yellow_soft"]}; color: inherit; border-radius: 3px">смет</mark>').replace("Смет", f'<mark style="background: {t["yellow_soft"]}; color: inherit; border-radius: 3px">Смет</mark>')
    res = f'''    <span class="lbl">Найдено 3 · в названиях и описаниях</span>
    <div>
      <a href="C-E01-TaskView.dc.html" class="row"><span style="flex: 1">{hl("Смета для Palmira Istra")}<span class="meta">{when(c, None, "15:00", "today", ["KINOMARK"])}</span></span></a>
      <a href="#" class="row"><span style="flex: 1">Отправить {hl("смету")} подрядчику<span class="meta">{when(c, "пт, 23 окт", extra=["KINOMARK"])}</span></span></a>
      <a href="#" class="row"><span style="flex: 1">Созвон с монтажёром<span class="meta"><span>в описании: «…обсудить {hl("смету")} на звук…»</span></span></span></a>
    </div>'''
    add("T06", "Search", "Поиск с результатами", c, search_screen(c, "смет", res), True)
    c = Ctx()
    res = empty(c, "search", "Ничего не нашлось", "По запросу «подарок маме» задач нет. Поиск идёт по названиям и описаниям, включая выполненные.", "Создать задачу «подарок маме»", "C-C02-AddShort.dc.html").replace("padding: 36px 12px", "padding: 20px 12px")
    add("T07", "SearchEmpty", "Поиск без результатов", c, search_screen(c, "подарок маме", res))

    # Просроченные
    c = Ctx()
    t = c.t
    T = lambda title, meta: task_row(c, title, meta, href="C-E01-TaskView.dc.html")
    body = f'''{back_bar(c, "Просроченные", "Задачи", "C-T01-Tasks.dc.html")}
    <p style="margin: 0; color: {t['text2']}">Крайний срок этих задач прошёл. Задачу можно выполнить, перенести срок или удалить.</p>
    <div>
      {T("Отправить акт за сентябрь", when(c, None, "18 окт", "overdue", ["KINOMARK"]))}
      {T("Записаться к стоматологу", when(c, None, "вчера", "overdue", ["Здоровье"]))}
    </div>
    <span class="lbl">Задачи, у которых прошло только время «Когда сделать», сюда не попадают — они остаются в плане.</span>
    <a href="#" class="btn2" style="color: {t['red']}; align-self: flex-start">{icon("trash", 18)}Убрать все в корзину</a>'''
    add("T08", "Overdue", "Просроченные задачи", c, root(c, body, nav="tasks"), True)

    # Входящие
    c = Ctx()
    t = c.t

    def inbox_row(title, sub, href="C-T10-Review.dc.html"):
        return f'<div class="row" style="align-items: center">{check(c)}<div style="flex: 1; min-width: 0"><div>{esc(title)}</div><div class="meta">{sub}</div></div><a href="{href}" class="cap">Разобрать</a></div>'
    body = f'''{back_bar(c, "Входящие", "Задачи", "C-T01-Tasks.dc.html")}
    <p style="margin: 0; color: {t['text2']}">Сюда попадает всё, что записано без даты и проекта. Разобрать — значит решить, что с задачей делать. Дату и проект указывать не обязательно.</p>
    <div>
      {inbox_row("Купить корм коту", "добавлено сегодня")}
      {inbox_row("Идея: подкаст про кино", "добавлено вчера", "C-T11-ReviewNoDate.dc.html")}
      {inbox_row("Вернуть книгу Ане", "добавлено 18 октября")}
      {inbox_row("Посмотреть тарифы на хостинг", "добавлено 16 октября")}
    </div>'''
    add("T09", "Inbox", "Входящие", c, root(c, body, nav="tasks"), True)

    def review(c, title, date_sel, proj_sel, note, btn):
        t = c.t
        inner = f'''{sheet_head(c, "Разбор", "Отмена", "", "C-T09-Inbox.dc.html")}
    <span style="font-size: {c.s['main']}px; font-weight: 600">{title}</span>
    <div style="display: flex; flex-direction: column; gap: 8px"><span class="flabel">Когда сделать</span>{caps(c, [("cal", "Сегодня", date_sel == "Сегодня"), (None, "Завтра", date_sel == "Завтра"), (None, "Другая дата", False)])}</div>
    <div style="display: flex; flex-direction: column; gap: 8px"><span class="flabel">Проект</span>{caps(c, [("folder", "KINOMARK", proj_sel == "KINOMARK"), (None, "Дом", proj_sel == "Дом"), (None, "Здоровье", False), (None, "Другой…", False)])}</div>
    <span class="lbl">{note}</span>
    <a href="C-T09-Inbox.dc.html" class="btn">{btn}</a>
    <div style="display: flex; justify-content: space-between"><a href="#" class="tbtn" style="color: {t['text3']}">Пропустить</a><a href="#" class="tbtn" style="color: {t['red']}">{icon("trash", 16)}Удалить</a></div>'''
        return inner
    c = Ctx()
    inner = review(c, "Вернуть книгу Ане", "Завтра", None, "Задача уйдёт из входящих и появится в плане на завтра. Проект можно не выбирать.", "Готово")
    add("T10", "Review", "Разбор входящей задачи с датой", c, root(c, body, nav="tasks", overlay=scrim(c) + sheet(c, inner, 0, "Разбор", pad="8px 20px 34px", gap=14)), True)
    c = Ctx()
    inner = review(c, "Идея: подкаст про кино", None, None, "Без даты и проекта задача уйдёт из входящих и останется в общем списке, в разделе «Без даты».", "Готово, без даты и проекта")
    add("T11", "ReviewNoDate", "Разбор без даты и проекта", c, root(c, body, nav="tasks", overlay=scrim(c) + sheet(c, inner, 0, "Разбор", pad="8px 20px 34px", gap=14)), True)

    # Выполненные
    c = Ctx()
    T = lambda title, meta: task_row(c, title, meta, done=True)
    body = f'''{back_bar(c, "Выполненные", "Задачи", "C-T01-Tasks.dc.html")}
{sec(c, "Сегодня", 1, [T("Позвонить Никите", when(c, "выполнено в 11:40"))])}
{sec(c, "Вчера", 3, [T("Отправить черновик договора", when(c, "выполнено в 18:05", extra=["KINOMARK"])), T("Купить лампочки", when(c, "выполнено в 14:20", extra=["Дом"])), T("Пробежка", when(c, "выполнено в 8:10", extra=["Здоровье"]))])}
    <span class="lbl">Нажмите на отметку, чтобы вернуть задачу в работу.</span>'''
    add("T12", "Done", "Выполненные задачи", c, root(c, body, nav="tasks"))

    # Корзина
    c = Ctx()
    t = c.t

    def trash_row(title, sub):
        return f'<div class="row" style="align-items: center"><div style="flex: 1; min-width: 0"><div style="color: {t["text3"]}">{esc(title)}</div><div class="meta">{sub}</div></div><a href="#" class="cap">{icon("undo")}Восстановить</a></div>'
    body = f'''{back_bar(c, "Корзина", "Задачи", "C-T01-Tasks.dc.html")}
    <p style="margin: 0; color: {t['text2']}">Удалённые задачи хранятся здесь, пока вы их не восстановите или не очистите корзину.</p>
    <div>
      {trash_row("Старый список покупок", "удалено сегодня")}
      {trash_row("Позвонить в автосервис", "удалено 17 октября")}
      {trash_row("Черновик поста", "удалено 12 октября")}
    </div>
    <a href="#" class="btn2" style="color: {t['red']}; align-self: flex-start">{icon("trash", 18)}Очистить корзину</a>
    <span class="lbl">Перед очисткой появится подтверждение с числом задач.</span>'''
    ov = toast(c, "«Позвонить в автосервис» восстановлена", "Открыть", "#", ic="undo")
    add("T13", "Trash", "Корзина и восстановление", c, root(c, body, nav="tasks", overlay=ov))

    # Выполнение не меняет шапку
    c = Ctx()
    ov = toast(c, "Задача «Тренировка» выполнена", "Отменить", "C-T01-Tasks.dc.html", ic="check")
    add("T14", "Completed", "Задача выполнена — шапка не меняется", c, tasks_screen(c, body=all_list(c, ("gym",)), overlay=ov), True)

    L = Ctx(LIGHT)
    add("T15", "Light", "Светлая тема", L, tasks_screen(L))
    n = Ctx(w=360, h=780)
    add("T16", "Narrow", "360 × 780, длинные названия", n, tasks_screen(n, body=all_list(n, long=True)))
    g = Ctx(s=LARGE)
    add("T17", "LargeEnd", "Крупный текст — конец прокрутки", g, tasks_screen(g, scroll_end=True))
