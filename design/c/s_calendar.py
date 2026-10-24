"""Календарь: неделя, день, задачи без времени, сроки и встречи."""
from ds import *
from s_create import frame
from s_date import month

SCREENS = []
DAYS = [("Пн", 19), ("Вт", 20), ("Ср", 21), ("Чт", 22), ("Пт", 23), ("Сб", 24), ("Вс", 25)]


def add(code, name, title, c, body, interactive=False):
    SCREENS.append(dict(file=f"C-{code}-{name}.dc.html", title=f"{code}. {title}", c=c,
                        html=page(f"{code}. {title}", c, body), page="calendar", interactive=interactive))


def week(c, sel=20, today=20, dots=(19, 20, 21, 22, 23)):
    t, s = c.t, c.s
    cells = []
    for wd, d in DAYS:
        if d == sel:
            st = f"background: {t['green']}; color: {t['on_green']};"
        elif d == today:
            st = f"color: {t['green_text']}; border: 1.5px solid {t['green']};"
        else:
            st = ""
        dot = f'<span aria-hidden="true" style="width: 4px; height: 4px; border-radius: 2px; background: {t["text2"] if d != sel else t["on_green"]}"></span>' if d in dots else '<span style="height: 4px"></span>'
        cur = ' aria-pressed="true"' if d == sel else ""
        cells.append(f'<button type="button"{cur} aria-label="{wd}, {d} октября" style="border: 0; background: none; padding: 0; display: flex; flex-direction: column; align-items: center; gap: 4px; min-height: 64px; justify-content: flex-start"><span style="font-size: {s["small"]}px; color: {t["text2"]}">{wd}</span><span style="width: 36px; height: 36px; border-radius: 18px; display: flex; align-items: center; justify-content: center; font-weight: 600; box-sizing: border-box; {st}">{d}</span>{dot}</button>')
    return f'<div role="group" aria-label="Неделя 19–25 октября" style="display: grid; grid-template-columns: repeat(7, minmax(0, 1fr))">{"".join(cells)}</div>'


def cal_head(c):
    t = c.t
    right = (icon_btn(c, "back", "Предыдущая неделя") + icon_btn(c, "chev", "Следующая неделя") + icon_btn(c, "cal", "Выбрать дату", "C-K02-PickDate.dc.html"))
    return screen_title(c, "Календарь", right, "Октябрь 2026")


def untimed(c, items, title="Без времени и сроки"):
    t = c.t
    rows = "".join(f'<a href="C-E01-TaskView.dc.html" class="row" style="align-items: center">{check(c)}<span style="flex: 1; min-width: 0"><span style="display: block">{esc(n)}</span><span class="meta">{m}</span></span></a>' for n, m in items)
    return f'''    <section aria-label="{title}" style="background: {t['surface']}; border-radius: 16px; padding: 4px 14px">
      <span class="lbl" style="font-weight: 600; display: block; padding-top: 8px">{title}</span>
      {rows}
    </section>'''


def timeline(c, start, end, blocks, now=None, hour_px=56, note=""):
    t, s = c.t, c.s
    h = (end - start) * hour_px
    lines = []
    for i, hr in enumerate(range(start, end + 1)):
        y = i * hour_px
        lines.append(f'<span style="position: absolute; left: 0; top: {y - 8}px; width: 40px; font-size: {s["small"]}px; color: {t["text2"]}; font-variant-numeric: tabular-nums">{hr}:00</span>'
                     f'<span aria-hidden="true" style="position: absolute; left: 48px; right: 0; top: {y}px; border-top: 1px solid {t["divider"]}"></span>')
    bl = []
    for st_m, en_m, title, sub, kind, col, cols in blocks:
        y = (st_m / 60 - start) * hour_px
        hh = max((en_m - st_m) / 60 * hour_px - 3, 30)
        if kind == "event":
            bg, bd, tc = t["blue_soft"], t["blue"], t["text"]
        elif kind == "done":
            bg, bd, tc = t["raised"], t["outline"], t["text2"]
        else:
            bg, bd, tc = t["surface"], t["green"], t["text"]
        width = f"calc((100% - 52px) / {cols} - 3px)"
        left = f"calc(52px + (100% - 52px) / {cols} * {col})"
        strike = "text-decoration: line-through;" if kind == "done" else ""
        lbl = "Встреча" if kind == "event" else "Задача"
        short = hh < 44
        head_txt = esc(title) + (" · " + sub if short else "")
        sub_html = "" if short else f'<span style="display: block; color: {t["text2"]}; font-size: {s["small"]}px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis">{sub}</span>'
        bl.append(f'<a href="C-K06-Open.dc.html" aria-label="{lbl}: {esc(title)}, {sub}" style="position: absolute; top: {y + 1}px; left: {left}; width: {width}; height: {hh}px; background: {bg}; border-left: 3px solid {bd}; border-radius: 8px; padding: 4px 8px; box-sizing: border-box; overflow: hidden; color: {tc}; font-size: {s["small"] + 1}px; line-height: 1.3"><span style="display: block; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; {strike}">{head_txt}</span>{sub_html}</a>')
    nw = ""
    if now is not None:
        y = (now / 60 - start) * hour_px
        nw = f'<span aria-label="Сейчас 12:50" style="position: absolute; left: 44px; right: 0; top: {y}px; border-top: 2px solid {t["green"]}"><span style="position: absolute; left: -4px; top: -5px; width: 8px; height: 8px; border-radius: 4px; background: {t["green"]}"></span></span>'
    nt = f'<span class="lbl">{note}</span>' if note else ""
    return f'''    {nt}
    <div style="position: relative; height: {h}px; margin-top: 8px">{"".join(lines)}{"".join(bl)}{nw}</div>'''


DAY20 = [
    (11 * 60 + 30, 12 * 60, "Позвонить Никите", "11:30 · выполнено", "done", 0, 1),
    (14 * 60, 15 * 60, "Смета для Palmira Istra", "14:00–15:00 · срок 15:00", "task", 0, 1),
    (15 * 60, 16 * 60, "Встреча с заказчиком", "15:00–16:00", "event", 0, 1),
    (19 * 60, 20 * 60, "Тренировка", "19:00–20:00", "task", 0, 1),
]


def day20(c, scroll_end=False, overlay="", nav=True):
    t = c.t
    unt = untimed(c, [("Разобрать почту", when(c, "Без времени")),
                      ("Оплатить аренду студии", when(c, None, "до конца дня", "today", ["KINOMARK"]))])
    tl = timeline(c, 11, 21, DAY20, now=12 * 60 + 50, note="Вторник, 20 октября · 4 задачи и 1 встреча. 2 задачи без времени ещё не распределены.")
    inner = f"{cal_head(c)}\n    {week(c)}\n{unt}\n{tl}"
    return root(c, inner, nav="cal" if nav else None, overlay=overlay, scroll_end=scroll_end, add_href="C-C01-AddEmpty.dc.html")


def build():
    c = Ctx()
    add("K01", "Week", "Неделя и выбранный день", c, day20(c), True)

    c = Ctx()
    inner = f'''{sheet_head(c, "Перейти к дате", "Отмена", "Готово", "C-K01-Week.dc.html", "C-K01-Week.dc.html")}
    {month(c, 2026, 10, 23, 20, marks=(19, 20, 21, 22, 23, 27))}
    <a href="C-K01-Week.dc.html" class="tbtn" style="align-self: flex-start">Сегодня</a>'''
    add("K02", "PickDate", "Переход к другой неделе и дате", c, day20(c, overlay=scrim(c) + sheet(c, inner, 0, "Перейти к дате", pad="8px 20px 34px")), True)

    c = Ctx()
    body = f'''{cal_head(c)}
    {week(c, 25)}
{empty(c, "cal", "Воскресенье, 25 октября — пусто", "Задач и встреч на этот день нет.", "Добавить задачу на 25 октября", "C-C05-AddDate.dc.html")}'''
    add("K03", "EmptyDay", "Пустой день", c, root(c, body, nav="cal"))

    c = Ctx()
    t = c.t
    unt = untimed(c, [("Отчёт для Palmira Istra", when(c, None, "23 окт", "future", ["KINOMARK"])),
                      ("Сдать показания счётчиков", when(c, None, "23 окт, до конца дня", "future", ["Дом"])),
                      ("Купить подарок Ане", when(c, "Без времени"))], "Сроки и задачи без времени")
    tl = timeline(c, 9, 15, [(10 * 60, 11 * 60, "Планёрка KINOMARK", "10:00–11:00", "event", 0, 1),
                             (12 * 60, 12 * 60 + 30, "Созвон с монтажёром", "12:00–12:30", "task", 0, 1)],
                  note="Пятница, 23 октября. Крайние сроки не занимают время в расписании — они показаны отдельно.")
    add("K04", "Deadlines", "Задачи без времени и крайние сроки", c, root(c, f"{cal_head(c)}\n    {week(c, 23)}\n{unt}\n{tl}", nav="cal"))

    c = Ctx()
    tl = timeline(c, 10, 17, [(11 * 60, 12 * 60, "Созвон с монтажёром", "11:00–12:00", "task", 0, 1),
                              (12 * 60 + 30, 14 * 60, "Обед с Аней", "12:30–14:00", "event", 0, 2),
                              (13 * 60, 14 * 60, "Проверить договор", "13:00–14:00", "task", 1, 2),
                              (15 * 60, 16 * 60 + 30, "Монтаж ролика", "15:00–16:30", "task", 0, 1)],
                  note="Четверг, 22 октября. С 13:00 до 14:00 две записи пересекаются — они стоят рядом.")
    add("K05", "Overlap", "Пересекающиеся события", c, root(c, f"{cal_head(c)}\n    {week(c, 22)}\n{tl}", nav="cal"))

    c = Ctx()
    t = c.t
    times = "".join(f'<button type="button" class="cap{" sel" if v == "20:00" else ""}" aria-pressed="{str(v == "20:00").lower()}">{v}</button>' for v in ["Без времени", "18:00", "19:00", "20:00", "Другое…"])
    inner = f'''{sheet_head(c, "Тренировка", "Закрыть", "Сохранить", "C-K01-Week.dc.html", "C-K01-Week.dc.html")}
    <div class="meta" style="margin: -4px 0 0">{when(c, "сегодня, 19:00–20:00", extra=["Здоровье"])}</div>
    <div style="display: flex; flex-direction: column; gap: 8px"><span class="flabel">Начало</span><div style="display: flex; gap: 6px; flex-wrap: wrap">{times}</div></div>
    {group(c, [setting_row(c, "Длительность", "1 ч", "repeat"), setting_row(c, "Дата", "Сегодня", "cal")])}
    <a href="C-E01-TaskView.dc.html" class="tbtn">Открыть задачу полностью</a>'''
    add("K06", "Open", "Открытая запись и изменение времени", c, day20(c, overlay=scrim(c) + sheet(c, inner, 0, "Тренировка", pad="8px 20px 34px", gap=14)), True)

    c = Ctx()
    add("K07", "End", "Конец прокрутки", c, day20(c, scroll_end=True))
    L = Ctx(LIGHT)
    add("K08", "Light", "Светлая тема", L, day20(L))
    n = Ctx(w=360, h=780)
    add("K09", "Narrow", "360 × 780", n, day20(n))

    # Выбранный день, упрощённый (ТЗ «упростить отображение задач в календаре»)
    build_day_list()


# Данные со скриншота владельца: суббота, 24 октября
TIMED = [("13:30", None, "Созвон The Religion", []), ("16:00", "17:30", "Выкладка шестой серии «МАЖОРЧИК»", ["KINOMARK"])]
ALLDAY = [("Посмотреть договор «МАЖОРЧИК»", [], None), ("Обложка 6-ая серия «МАЖОРЧИК»", ["KINOMARK"], None),
          ("написать сценаристам под проекты Herbalife и The Religion", [], None),
          ("Отправить договор The Religion", ["The Religion"], ("today", "до 15:00")),
          ("Закрыть акт за сентябрь", ["KINOMARK"], ("overdue", "22 окт"))]
DONE = ["Упаковать идею The Religion", "Созвон с Жазирой"]


def day_row(c, title, extra=(), time=None, end=None, due=None, done=False):
    t, s = c.t, c.s
    tm = ""
    if time:
        small = f'<small style="font-size: {s["small"]}px; color: {t["text2"]}">{end}</small>' if end else ""
        tm = f'<span aria-hidden="true" style="width: {round(s["base"] * 3)}px; flex-shrink: 0; display: flex; flex-direction: column; font-variant-numeric: tabular-nums; line-height: 1.35"><b style="font-weight: 600">{time}</b>{small}</span>'
    meta_parts = []
    if due:
        kind, val = due
        meta_parts.append(when(c, None, val, kind))
    meta_parts += [f"<span>{esc(x)}</span>" for x in extra]
    meta = f'<div class="meta">{"".join(meta_parts)}</div>' if meta_parts else ""
    ttl_style = f"color: {t['text2']};" if done else ""
    return f'<div class="row" style="align-items: flex-start">{tm}{check(c, done)}<div style="flex: 1; min-width: 0"><div style="{ttl_style}">{esc(title)}</div>{meta}</div></div>'


def day_list(c, timed=TIMED, allday=ALLDAY, done=DONE, done_open=False, state=None, date="Суббота, 24 октября"):
    t, s = c.t, c.s
    n_open = len(timed) + len(allday)
    sub = " · ".join(x for x in [f"{n_open} {'задача осталась' if n_open == 1 else 'задачи осталось' if 2 <= n_open <= 4 else 'задач осталось'}" if n_open else "", f"{len(done)} выполнено" if done else ""] if x)
    sec = lambda title, rows: f'<section style="display: flex; flex-direction: column"><h2 class="sec" style="font-size: {s["base"]}px">{title}</h2><div>{"".join(rows)}</div></section>' if rows else ""
    head = f'<div style="display: flex; flex-direction: column; gap: 2px"><h2 style="margin: 0; font-size: {s["h2"] + 3}px; font-weight: 700">{date}</h2>{f"<span class=lbl>{sub}</span>" if sub else ""}</div>'
    st = ""
    if state == "empty":
        st = f'<div style="text-align: center; padding: 28px 0 8px; font-weight: 600; font-size: {s["h2"]}px">На этот день пока нет задач</div>'
    elif state == "alldone":
        st = f'<div style="text-align: center; padding: 28px 0 8px; font-weight: 600; font-size: {s["h2"]}px">Все задачи на сегодня выполнены</div>'
    done_rows = "".join(day_row(c, x, done=True) for x in done) if done_open else ""
    done_html = (f'<div style="border-top: 1px solid {t["divider"]}"><div style="display: flex; justify-content: space-between; align-items: center; min-height: 48px; font-weight: 600; color: {t["text2"]}">'
                 f'<span>Выполнено · {len(done)}</span><span style="display: flex; transform: rotate({90 if done_open else 0}deg)">{icon("chev", 16)}</span></div>{done_rows}</div>') if done else ""
    add_btn = f'<a href="C-C05-AddDate.dc.html" style="align-self: flex-start; min-height: 40px; padding: 0 14px; border-radius: 20px; background: {t["surface"]}; border: 1px solid {t["border"]}; display: flex; align-items: center; gap: 6px; font-size: {s["pill"]}px">{icon("plus", 16)}Добавить задачу</a>'
    return f'''{cal_head(c)}
    {week(c, 24, 24, dots=(19, 20, 21, 22, 23, 24))}
    {head}
    {st}
    {sec("По времени", [day_row(c, n, e, tm, en) for tm, en, n, e in timed])}
    {sec("В течение дня", [day_row(c, n, e, due=d) for n, e, d in allday])}
    {done_html}
    {add_btn}'''


def build_day_list():
    D = Ctx()
    add("K10", "DayList", "День — по времени и в течение дня", D, root(D, day_list(D), nav="cal"), True)
    L = Ctx(LIGHT)
    add("K11", "DayListLight", "День — светлая тема", L, root(L, day_list(L), nav="cal"))
    c = Ctx()
    add("K12", "DayDoneOpen", "День — раскрыто «Выполнено»", c, root(c, day_list(c, done_open=True), nav="cal", scroll_end=True))
    c = Ctx()
    ov = toast(c, "Задача выполнена", "Отменить", "C-K10-DayList.dc.html", ic="check")
    add("K13", "DayCompleted", "День — задача выполнена, «Отменить»", c, root(c, day_list(c, allday=ALLDAY[1:], done=["Посмотреть договор «МАЖОРЧИК»"] + DONE), nav="cal", overlay=ov), True)
    c = Ctx()
    add("K14", "DayEmpty", "День — задач нет", c, root(c, day_list(c, [], [], [], state="empty", date="Воскресенье, 25 октября"), nav="cal"))
    c = Ctx()
    add("K15", "DayAllDone", "День — всё выполнено", c, root(c, day_list(c, [], [], DONE + ["Отправить договор The Religion"], state="alldone"), nav="cal"))
    L = Ctx(LIGHT)
    add("K16", "DayAllDoneLight", "День — всё выполнено, светлая тема", L, root(L, day_list(L, [], [], DONE, done_open=True, state="alldone"), nav="cal"))
    n = Ctx(w=360, h=780)
    add("K17", "DayNarrow", "День — 360 × 780, длинные названия", n, root(n, day_list(n), nav="cal", scroll_end=True))
    g = Ctx(s=LARGE)
    add("K18", "DayLarge", "День — крупный текст", g, root(g, day_list(g), nav="cal", scroll_end=True))
    gl = Ctx(LIGHT, LARGE)
    add("K19", "DayLargeLight", "День — крупный текст, светлая тема", gl, root(gl, day_list(gl), nav="cal"))
