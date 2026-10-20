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
