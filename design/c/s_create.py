"""Создание и редактирование задачи."""
from ds import *

SCREENS = []
LONG = "Забрать оборудование из проката на Старом Арбате и вернуть залог"
VERY_LONG = ("Подготовить к пятнице подробный план съёмки для Palmira Istra: список локаций, свет, звук, "
             "кто отвечает за реквизит, во сколько приезжает грим, где обедаем и какой запасной план на случай дождя")


def add(code, name, title, c, body, interactive=False):
    SCREENS.append(dict(file=f"C-{code}-{name}.dc.html", title=f"{code}. {title}", c=c,
                        html=page(f"{code}. {title}", c, body), page="create", interactive=interactive))


def add_btn(c, state="ready", href="C-C13-Added.dc.html"):
    t = c.t
    if state == "disabled":
        return f'<a href="#" aria-disabled="true" class="btn" style="background: {t["raised"]}; color: {t["disabled"]}">Добавить</a>'
    if state == "saving":
        return (f'<a href="#" aria-disabled="true" class="btn" style="opacity: .75">'
                f'<span aria-hidden="true" style="width: 16px; height: 16px; border-radius: 50%; border: 2px solid {t["on_green"]}; border-right-color: transparent; box-sizing: border-box"></span>Сохраняю…</a>')
    return f'<a href="{href}" class="btn">Добавить</a>'


def add_form(c, text="", caps_items=None, hint="Задача попадёт во «Входящие».", btn="ready", top_extra="",
             label="Новая задача", max_lines=None, err="", bg=None, btn_href="C-C13-Added.dc.html", label_right=""):
    t, s = c.t, c.s
    caps_items = caps_items if caps_items is not None else [("cal", "Без даты", False), ("bell", "Напомнить", False), ("more", "Ещё", False)]
    lab = title_field(c, text, label=label, max_lines=max_lines, err=err)
    if label_right:
        lab = lab.replace(f'<span id="nt-label" style="font-size: {s["form_title"]}px; font-weight: 600">{label}</span>',
                          f'<span style="display: flex; justify-content: space-between; align-items: center"><span id="nt-label" style="font-size: {s["form_title"]}px; font-weight: 600">{label}</span>{label_right}</span>')
    inner = f'''{top_extra}
    {lab}
    {caps(c, caps_items)}
    <span style="font-size: {s['small']}px; color: {t['text2']}">{hint}</span>
    {add_btn(c, btn, btn_href)}'''
    return (bg if bg is not None else ghost_home(c)) + scrim(c) + sheet(c, inner, c.kb_h, "Новая задача") + keyboard(c)


def frame(c, overlay):
    t, s = c.t, c.s
    return f'''<div style="width: {c.w}px; height: {c.h}px; box-sizing: border-box; background: {t['bg']}; color: {t['text']}; font-family: {FONT}; font-size: {s['base']}px; line-height: 1.4; position: relative; overflow: hidden">
{overlay}
</div>'''


def detail_rows(c, rows):
    t = c.t
    out = []
    for ic, label, value, tone, href in rows:
        col = t["text"] if not tone else t[tone]
        v = f'<span style="color: {col if value else t["text2"]}">{value or "Не задано"}</span>'
        out.append(f'<a href="{href}" class="li"><span style="color: {t["text2"]}; display: flex">{icon(ic, 20)}</span><span style="flex: 1; display: flex; flex-direction: column; padding: 9px 0"><span style="font-size: {c.s["small"]}px; color: {t["text2"]}">{label}</span>{v}</span><span style="color: {t["text2"]}; display: flex">{icon("chev", 18)}</span></a>')
    return "".join(out)


def build():
    D = Ctx()
    add("C01", "AddEmpty", "Пустая форма, клавиатура открыта", D, frame(D, add_form(D, "", btn="disabled")), True)
    add("C02", "AddShort", "Короткое название", D, frame(D, add_form(D, "Купить корм коту")), True)
    add("C03", "AddLong", "Длинное название", D, frame(D, add_form(D, LONG)), True)
    add("C04", "AddVeryLong", "Много текста — поле прокручивается", D, frame(D, add_form(D, VERY_LONG, max_lines=5)))
    add("C05", "AddDate", "Выбрана дата", D, frame(D, add_form(
        D, LONG, [("cal", "Завтра", True), ("bell", "Напомнить", False), ("more", "Ещё", False)],
        "Задача появится в плане на завтра, 21 октября.")), True)
    add("C06", "AddReminder", "Выбрано напоминание", D, frame(D, add_form(
        D, LONG, [("cal", "Завтра, 10:00", True), ("bell", "Напомнить в 9:00", True), ("more", "Ещё", False)],
        "Напоминание придёт завтра в 9:00.")))

    # Добавление внутри проекта: проект подставлен съёмной плашкой
    c = Ctx()
    t = c.t
    chip = (f'<a href="#" aria-label="Убрать проект KINOMARK" class="cap sel" style="align-self: flex-start; padding-right: 6px">'
            f'{icon("folder")}KINOMARK<span style="display: flex; width: 28px; height: 28px; align-items: center; justify-content: center; color: {t["text2"]}">{icon("close", 14, 2)}</span></a>')
    bg = f'''<div aria-hidden="true" style="position: absolute; inset: 0; padding: 56px 20px 0; display: flex; flex-direction: column; gap: 8px; opacity: {t['ghost']}">
    <span style="font-size: {c.s['title']}px; font-weight: 700">KINOMARK</span><span class="lbl">12 задач</span></div>'''
    body = add_form(c, "Согласовать с Палмирой дату выезда на площадку", top_extra=chip,
                    hint="Задача попадёт в проект KINOMARK. Проект можно убрать.", bg=bg)
    add("C07", "AddInProject", "Добавление внутри проекта", c, frame(c, body))

    # Подробная форма
    c = Ctx()
    t, s = c.t, c.s

    def more_form(c, scrolled=False):
        t, s = c.t, c.s
        g1 = group(c, [
            setting_row(c, "Дата", "Завтра, 21 окт", "cal", "C-D01-QuickDate.dc.html"),
            setting_row(c, "Время", "10:00", "clock", "C-D04-Time.dc.html"),
            setting_row(c, "Длительность", "30 мин", "repeat"),
        ], "Когда сделать")
        g2 = group(c, [setting_row(c, "Выполнить до", "Не задано", "flag", "C-D09-Deadline.dc.html")], "Крайний срок")
        g3 = group(c, [setting_row(c, "Напоминание", "Завтра, 9:00", "bell", "C-D06-Reminder.dc.html")])
        g4 = group(c, [
            setting_row(c, "Проект", "Без проекта", "folder", "C-P05-PickProject.dc.html"),
            setting_row(c, "Приоритет", "Обычный", "flag"),
        ])
        desc = f'''<label style="display: flex; flex-direction: column; gap: 6px"><span class="flabel">Описание</span>
      <span class="field" style="min-height: 96px; align-items: flex-start; color: {t['text2']}">Подробности, ссылки, адрес</span></label>'''
        note = f'<span class="lbl">Обязательно только название. Остальное можно заполнить позже.</span>'
        sc = "justify-content: flex-end;" if scrolled else ""
        return f'''<div style="width: {c.w}px; height: {c.h}px; box-sizing: border-box; background: {t['overlay']}; color: {t['text']}; font-family: {FONT}; font-size: {s['base']}px; line-height: 1.4; position: relative; overflow: hidden">
  <section role="dialog" aria-label="Новая задача" style="position: absolute; left: 0; right: 0; top: 48px; bottom: 0; background: {t['bg']}; border-radius: 20px 20px 0 0; overflow: hidden; display: flex; flex-direction: column">
    <div style="position: sticky; top: 0; background: {t['bg']}; padding: 8px 20px 4px; display: flex; flex-direction: column; gap: 6px; border-bottom: 1px solid {t['divider'] if scrolled else 'transparent'}; z-index: 1">
      <div aria-hidden="true" style="width: 36px; height: 5px; border-radius: 3px; background: {t['handle']}; align-self: center"></div>
      {sheet_head(c, "Новая задача", "Отмена", "Добавить", "C-C02-AddShort.dc.html", "C-C13-Added.dc.html")}
    </div>
    <div style="flex: 1; min-height: 0; overflow: hidden; display: flex; flex-direction: column; {sc}">
      <div style="padding: 8px 20px 40px; display: flex; flex-direction: column; gap: 18px">
        {title_field(c, LONG, label="Название", focus=False)}
        {g1}{g2}{g3}{g4}{desc}{note}
      </div>
    </div>
  </section>
</div>'''
    add("C08", "More", "«Ещё» — подробная форма", c, more_form(c), True)
    c = Ctx()
    add("C09", "MoreEnd", "Подробная форма — конец прокрутки", c, more_form(c, True))

    # Просмотр задачи
    c = Ctx()
    t, s = c.t, c.s
    rows = detail_rows(c, [
        ("cal", "Когда сделать", "Сегодня, 14:00 · 1 ч", None, "C-E02-EditTime.dc.html"),
        ("flag", "Выполнить до", "Срок сегодня, 15:00", "yellow", "C-D09-Deadline.dc.html"),
        ("bell", "Напоминание", "Сегодня, 13:30", None, "C-D06-Reminder.dc.html"),
        ("folder", "Проект", "KINOMARK", None, "C-P06-TaskProject.dc.html"),
        ("flag", "Приоритет", "Высокий", None, "#"),
    ])
    body = f'''{back_bar(c, "", "Главная", "C-H01-Home.dc.html", icon_btn(c, "more", "Ещё действия", "C-E03-Menu.dc.html"))}
    <div style="display: flex; gap: 12px; align-items: flex-start">
      {check(c).replace('class="chk', 'style="margin-top: 4px" class="chk')}
      <div style="display: flex; flex-direction: column; gap: 6px; min-width: 0">
        <span class="lbl" style="color: {t['green_text']}; font-weight: 600">Главная задача</span>
        <h1 style="margin: 0; font-size: {s['main'] + 3}px; font-weight: 600; line-height: 1.25">Смета для Palmira Istra</h1>
      </div>
    </div>
    <div style="background: {t['surface']}; border-radius: 16px; overflow: hidden">{rows}</div>
    <div style="display: flex; flex-direction: column; gap: 6px"><span class="flabel">Описание</span>
      <p style="margin: 0; color: {t['text3']}">Свет, звук и транспорт отдельными строками. Прислать Никите до встречи.</p></div>
    <span class="lbl">Изменено сегодня в 11:02 · Сохранено</span>'''
    add("E01", "TaskView", "Открытая задача", c, root(c, body, nav="home"), True)

    # Изменение времени без изменения срока
    c = Ctx()
    t, s = c.t, c.s
    times = "".join(f'<button type="button" class="cap{" sel" if v == "16:00" else ""}" aria-pressed="{str(v == "16:00").lower()}">{v}</button>' for v in ["Без времени", "13:00", "14:00", "16:00", "18:00", "Другое…"])
    inner = f'''{sheet_head(c, "Когда сделать", "Отмена", "Готово", "C-E01-TaskView.dc.html", "C-E01-TaskView.dc.html")}
    <div style="display: flex; flex-direction: column; gap: 8px"><span class="flabel">Дата</span>{caps(c, [("cal", "Сегодня", True), (None, "Завтра", False), (None, "Другая дата", False)])}</div>
    <div style="display: flex; flex-direction: column; gap: 8px"><span class="flabel">Время</span><div style="display: flex; gap: 6px; flex-wrap: wrap">{times}</div></div>
    {banner(c, "Крайний срок не изменится", "neutral", "flag", sub="Выполнить до: сегодня, 15:00. Новое время 16:00 позже срока.")}'''
    add("E02", "EditTime", "Перенос времени, срок сохраняется", c, root(c, body, nav="home", overlay=scrim(c) + sheet(c, inner, 0, "Когда сделать", pad="8px 20px 34px", gap=16)), True)

    # Меню задачи
    c = Ctx()
    m = menu(c, [("check", "Выполнить", "C-H10-Completed.dc.html", None), ("spark", "Не делать главной", "C-H02-NoMain.dc.html", None),
                 ("edit", "Переименовать", "C-E04-EditTitle.dc.html", None), ("folder", "Перенести в проект", "C-P05-PickProject.dc.html", None),
                 ("trash", "Удалить", "#", "danger")], top=100, right=16, width=250)
    add("E03", "Menu", "Меню задачи", c, root(c, body, nav="home", overlay=m), True)

    # Редактирование названия с клавиатурой
    c = Ctx()
    t = c.t
    inner = f'''{sheet_head(c, "Название", "Отмена", "Сохранить", "C-E01-TaskView.dc.html", "C-E01-TaskView.dc.html")}
    {title_field(c, "Смета для Palmira Istra — свет и звук отдельно", label="Название")}'''
    add("E04", "EditTitle", "Редактирование названия", c, frame(c, f'<div aria-hidden="true" style="position: absolute; inset: 0; opacity: .35">{root(c, body)}</div>' + scrim(c) + sheet(c, inner, c.kb_h, "Название") + keyboard(c)))

    # Сохранение, ошибка, повтор
    c = Ctx()
    add("C11", "Saving", "Сохранение", c, frame(c, add_form(c, LONG, btn="saving")))
    c = Ctx()
    err_top = banner(c, "Задача не сохранилась", "red", "alert", "Повторить", "C-C11-Saving.dc.html", "Текст остался в форме. Попробуйте ещё раз.")
    add("C12", "SaveError", "Ошибка сохранения и повтор", c, frame(c, add_form(c, LONG, top_extra=err_top, btn_href="C-C11-Saving.dc.html")), True)

    # Задача добавлена
    from s_home import home_body
    c = Ctx()
    ov = toast(c, "Задача добавлена во «Входящие»", "Отменить", "C-H01-Home.dc.html", ic="check")
    add("C13", "Added", "«Задача добавлена» — «Отменить»", c, root(c, home_body(c, chips=chips_row(c, [("Входящие · 5", "C-T09-Inbox.dc.html", None), (f'{icon("alert", 14, 2)}Просрочено · 2', "C-T08-Overdue.dc.html", "red")])), nav="home", overlay=ov), True)

    # Закрытие незавершённой записи: черновик
    c = Ctx()
    ov = toast(c, "Черновик сохранён", "Продолжить", "C-C15-Draft.dc.html", ic="edit")
    add("C14", "DraftSaved", "Закрыли форму — черновик сохранён", c, root(c, home_body(c), nav="home", overlay=ov), True)
    c = Ctx()
    clear = f'<a href="C-C01-AddEmpty.dc.html" style="font-size: {c.s["small"]}px; color: {c.t["text2"]}; min-height: 32px; display: flex; align-items: center">Черновик · Очистить</a>'
    add("C15", "Draft", "Форма открыта с черновиком", c, frame(c, add_form(c, "Купить подарок на день рождения Ане", label_right=clear)), True)

    # Распознавание фразы
    c = Ctx()
    t, s = c.t, c.s
    rec = f'''<div style="display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border-radius: 12px; background: {t['raised']}">
      <span style="font-size: {s['small']}px; color: {t['text2']}">Распознано — проверьте перед сохранением</span>
      <div style="display: flex; gap: 6px; flex-wrap: wrap">
        <a href="#" class="cap sel">{icon("text")}Позвонить в банк</a>
        <a href="#" class="cap sel">{icon("cal")}Завтра, 10:00</a>
        <a href="#" class="cap sel">{icon("bell")}За 1 час</a>
      </div>
      <span style="font-size: {s['small']}px; color: {t['text2']}">Нажмите на значение, чтобы исправить.</span>
    </div>'''
    body = add_form(c, "Завтра в 10 позвонить в банк, напомни за час", [("more", "Ещё", False)], "Сохранится задача «Позвонить в банк» на завтра, 10:00.", top_extra="")
    body = body.replace(f'<span style="font-size: {s["small"]}px; color: {t["text2"]}">Сохранится', rec + f'\n    <span style="font-size: {s["small"]}px; color: {t["text2"]}">Сохранится', 1)
    add("C16", "Phrase", "Распознавание фразы (после готовности функции)", c, frame(c, body))

    # Темы и размеры
    L = Ctx(LIGHT)
    add("C17", "AddLight", "Светлая тема — длинное название", L, frame(L, add_form(L, LONG)))
    n = Ctx(w=360, h=780)
    add("C18", "AddNarrow", "360 × 780 — длинное название", n, frame(n, add_form(n, LONG)))
    g = Ctx(s=LARGE)
    add("C19", "AddLarge", "Крупный текст — длинное название", g, frame(g, add_form(g, LONG)))
    L = Ctx(LIGHT)
    add("C20", "MoreLight", "Светлая тема — подробная форма", L, more_form(L))
