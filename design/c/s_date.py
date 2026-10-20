"""Дата, время, крайний срок и напоминание."""
from ds import *
from s_create import frame, LONG
import calendar as _cal

SCREENS = []


def add(code, name, title, c, body, interactive=False):
    SCREENS.append(dict(file=f"C-{code}-{name}.dc.html", title=f"{code}. {title}", c=c,
                        html=page(f"{code}. {title}", c, body), page="date", interactive=interactive))


def under_form(c):
    """Приглушённая форма добавления под окном выбора."""
    t, s = c.t, c.s
    return f'''{ghost_home(c)}
  <div aria-hidden="true" style="position: absolute; left: 0; right: 0; bottom: 0; height: 330px; background: {t['surface']}; border-radius: 20px 20px 0 0; opacity: .5; padding: 24px 20px; box-sizing: border-box; font-size: {s['field']}px">{esc(LONG)}</div>'''


def option(c, title, sub="", sel=False, href="#", danger=False, radio=True):
    t, s = c.t, c.s
    mark = ""
    if radio:
        mark = f'<span style="color: {t["green_text"]}; display: flex; width: 22px">{icon("check", 20, 2.2) if sel else ""}</span>'
    col = f"color: {t['red']};" if danger else ""
    sb = f'<span style="font-size: {s["small"]}px; color: {t["text2"]}">{sub}</span>' if sub else ""
    aria = f' role="radio" aria-checked="{str(sel).lower()}"' if radio else ""
    return f'<a href="{href}"{aria} class="li" style="padding: 0 4px; {col}"><span style="flex: 1; display: flex; flex-direction: column; padding: 10px 0">{title}{sb}</span>{mark}</a>'


def month(c, year, mon, sel=None, today=None, marks=()):
    t, s = c.t, c.s
    names = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"]
    head = "".join(f'<span style="text-align: center; font-size: {s["small"]}px; color: {t["text2"]}">{d}</span>' for d in ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"])
    cells = []
    for week in _cal.Calendar(0).monthdayscalendar(year, mon):
        for d in week:
            if not d:
                cells.append("<span></span>")
                continue
            st = "color: " + t["text"] + ";"
            if d == sel:
                st = f"background: {t['green']}; color: {t['on_green']}; font-weight: 700;"
            elif d == today:
                st = f"border: 1.5px solid {t['green']}; color: {t['green_text']}; font-weight: 600;"
            dot = f'<span aria-hidden="true" style="position: absolute; bottom: 5px; width: 4px; height: 4px; border-radius: 2px; background: {t["text2"] if d != sel else t["on_green"]}"></span>' if d in marks else ""
            cur = ' aria-pressed="true"' if d == sel else ""
            cells.append(f'<button type="button"{cur} aria-label="{d} {names[mon - 1].lower()}" style="position: relative; height: 44px; width: 44px; justify-self: center; border-radius: 22px; border: 0; background: none; font-size: {s["base"]}px; display: flex; align-items: center; justify-content: center; box-sizing: border-box; padding: 0; {st}">{d}{dot}</button>')
    return f'''<div style="display: flex; flex-direction: column; gap: 6px">
      <div style="display: flex; align-items: center; justify-content: space-between">
        <span style="font-weight: 600; font-size: {s['h2']}px">{names[mon - 1]} {year}</span>
        <span style="display: flex">{icon_btn(c, "back", "Предыдущий месяц")}{icon_btn(c, "chev", "Следующий месяц")}</span>
      </div>
      <div style="display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); row-gap: 2px">{head}{"".join(cells)}</div>
    </div>'''


def build():
    c = Ctx()
    inner = f'''{sheet_head(c, "Дата", "Отмена", "Готово", "C-C03-AddLong.dc.html", "C-C05-AddDate.dc.html")}
    <div role="radiogroup" aria-label="Дата">
      {option(c, "Сегодня", "вторник, 20 октября")}
      {option(c, "Завтра", "среда, 21 октября", True, "C-C05-AddDate.dc.html")}
      {option(c, "Другая дата…", "", False, "C-D02-Month.dc.html", radio=False)}
    </div>
    {group(c, [setting_row(c, "Время", "Без времени", "clock", "C-D04-Time.dc.html")])}
    <a href="C-C03-AddLong.dc.html" class="tbtn" style="color: {c.t['text3']}">Без даты</a>'''
    add("D01", "QuickDate", "Быстрый выбор: сегодня, завтра, другая дата", c, frame(c, under_form(c) + scrim(c) + sheet(c, inner, 0, "Дата", pad="8px 20px 34px")), True)

    c = Ctx()
    inner = f'''{sheet_head(c, "Другая дата", "Назад", "Готово", "C-D01-QuickDate.dc.html", "C-C05-AddDate.dc.html")}
    {month(c, 2026, 10, 21, 20, marks=(20, 22, 23, 27))}
    <span class="lbl">Точка — в этот день уже есть задачи или встречи.</span>'''
    add("D02", "Month", "Полный календарь месяца", c, frame(c, under_form(c) + scrim(c) + sheet(c, inner, 0, "Другая дата", pad="8px 20px 34px")), True)

    c = Ctx()
    inner = f'''{sheet_head(c, "Другая дата", "Назад", "Готово", "C-D01-QuickDate.dc.html", "C-C05-AddDate.dc.html")}
    {month(c, 2026, 11, 5, None, marks=(2, 12))}
    <a href="C-D02-Month.dc.html" class="tbtn" style="align-self: flex-start">Вернуться к сегодняшнему дню</a>'''
    add("D03", "NextMonth", "Дата в следующем месяце", c, frame(c, under_form(c) + scrim(c) + sheet(c, inner, 0, "Другая дата", pad="8px 20px 34px")))

    c = Ctx()
    times = "".join(f'<button type="button" class="cap{" sel" if v == "10:00" else ""}" aria-pressed="{str(v == "10:00").lower()}">{v}</button>' for v in ["Без времени", "9:00", "10:00", "12:00", "15:00", "18:00", "20:00"])
    inner = f'''{sheet_head(c, "Время", "Назад", "Готово", "C-D01-QuickDate.dc.html", "C-C06-AddReminder.dc.html")}
    <div style="display: flex; gap: 6px; flex-wrap: wrap">{times}</div>
    {field(c, "Точное время", "10:00", ic="clock")}
    {group(c, [setting_row(c, "Длительность", "Не задана", "repeat")])}
    <span class="lbl">Время задачи само по себе не включает напоминание.</span>'''
    add("D04", "Time", "Время и «Без времени»", c, frame(c, under_form(c) + scrim(c) + sheet(c, inner, 0, "Время", pad="8px 20px 34px", gap=14)))

    from s_create import detail_rows
    c = Ctx()
    t = c.t
    rows = detail_rows(c, [("cal", "Когда сделать", "Завтра, 21 окт", None, "#"), ("flag", "Выполнить до", "", None, "#"),
                           ("folder", "Проект", "KINOMARK", None, "#")])
    body = f'''{back_bar(c, "", "Входящие", "C-T09-Inbox.dc.html")}
    <h1 style="margin: 0; font-size: {c.s['main'] + 3}px; font-weight: 600">Вернуть книгу Ане</h1>
    <div style="background: {t['surface']}; border-radius: 16px; overflow: hidden">{rows}</div>'''
    inner = f'''{sheet_head(c, "Когда сделать", "Отмена", "Готово", "#", "#")}
    <div role="radiogroup" aria-label="Дата">
      {option(c, "Сегодня", "вторник, 20 октября")}
      {option(c, "Завтра", "среда, 21 октября", True)}
      {option(c, "Другая дата…", "", False, "C-D02-Month.dc.html", radio=False)}
    </div>
    <a href="#" class="btn2" style="color: {t['red']}">{icon("close", 18)}Убрать дату</a>
    <span class="lbl">Проект и статус разбора не изменятся. Задача останется в общем списке без даты.</span>'''
    add("D05", "RemoveDate", "Удаление даты", c, root(c, body, overlay=scrim(c) + sheet(c, inner, 0, "Когда сделать", pad="8px 20px 34px")))

    c = Ctx()
    inner = f'''{sheet_head(c, "Напоминание", "Отмена", "Готово", "C-C05-AddDate.dc.html", "C-C06-AddReminder.dc.html")}
    <span class="lbl">Задача: завтра, 10:00</span>
    <div role="radiogroup" aria-label="Когда напомнить">
      {option(c, "В 10:00", "в момент начала")}
      {option(c, "В 9:45", "за 15 минут")}
      {option(c, "В 9:00", "за 1 час", True, "C-C06-AddReminder.dc.html")}
      {option(c, "Своё время…", "другой день или время", radio=False)}
      {option(c, "Без напоминания")}
    </div>'''
    add("D06", "Reminder", "Напоминание, у задачи есть время", c, frame(c, under_form(c) + scrim(c) + sheet(c, inner, 0, "Напоминание", pad="8px 20px 34px")), True)

    c = Ctx()
    inner = f'''{sheet_head(c, "Напоминание", "Отмена", "Готово", "#", "C-C06-AddReminder.dc.html")}
    <span class="lbl">Задача: завтра, без времени</span>
    <div role="radiogroup" aria-label="Когда напомнить">
      {option(c, "Утром, в 9:00", "завтра", True)}
      {option(c, "Днём, в 13:00", "завтра")}
      {option(c, "Вечером накануне, в 20:00", "сегодня")}
      {option(c, "Своё время…", radio=False)}
      {option(c, "Без напоминания")}
    </div>'''
    add("D07", "ReminderNoTime", "Напоминание, у задачи нет времени", c, frame(c, under_form(c) + scrim(c) + sheet(c, inner, 0, "Напоминание", pad="8px 20px 34px")))

    c = Ctx()
    t, s = c.t, c.s
    inner = f'''<div style="display: flex; flex-direction: column; align-items: center; text-align: center; gap: 10px; padding-top: 8px">
      <span style="width: 56px; height: 56px; border-radius: 28px; background: {t['raised']}; color: {t['text2']}; display: flex; align-items: center; justify-content: center">{icon("bell_off", 26)}</span>
      <h2 style="margin: 0; font-size: {s['h2'] + 1}px">Уведомления для Mark выключены</h2>
      <p style="margin: 0; color: {t['text2']}">Напоминание сохранится в задаче, но придёт только после включения уведомлений: Настройки iPhone → Уведомления → Mark.</p>
    </div>
    <a href="#" class="btn">Открыть настройки iPhone</a>
    <a href="C-C06-AddReminder.dc.html" class="btn2">Не сейчас</a>'''
    add("D08", "NoPermission", "Нет разрешения на уведомления", c, frame(c, under_form(c) + scrim(c) + sheet(c, inner, 0, "Уведомления выключены", pad="8px 20px 34px", gap=14)))

    c = Ctx()
    inner = f'''{sheet_head(c, "Выполнить до", "Отмена", "Готово", "C-C08-More.dc.html", "C-C08-More.dc.html")}
    <div style="display: flex; flex-direction: column; gap: 8px"><span class="flabel">Крайний срок</span>{caps(c, [("flag", "Сегодня", False), (None, "Завтра", False), (None, "Пятница, 23 окт", True), (None, "Другая дата", False)])}</div>
    <div role="radiogroup" aria-label="Время срока">
      {option(c, "До конца дня", "срок без времени", True)}
      {option(c, "Ко времени…", "например, к 15:00")}
    </div>
    {banner(c, "Срок отдельно от плана", "neutral", "flag", sub="«Когда сделать» — когда вы планируете заняться задачей. Перенос этого времени не меняет крайний срок.")}'''
    add("D09", "Deadline", "Крайний срок и «До конца дня»", c, frame(c, under_form(c) + scrim(c) + sheet(c, inner, 0, "Выполнить до", pad="8px 20px 34px", gap=14)))

    L = Ctx(LIGHT)
    inner = f'''{sheet_head(L, "Другая дата", "Назад", "Готово", "#", "#")}
    {month(L, 2026, 10, 21, 20, marks=(20, 22, 23, 27))}'''
    add("D10", "MonthLight", "Светлая тема — календарь месяца", L, frame(L, under_form(L) + scrim(L) + sheet(L, inner, 0, "Другая дата", pad="8px 20px 34px")))
