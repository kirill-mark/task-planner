"""Помощник: диалог, предложения изменений, применение и ошибки."""
from ds import *

SCREENS = []


def add(code, name, title, c, body, interactive=False):
    SCREENS.append(dict(file=f"C-{code}-{name}.dc.html", title=f"{code}. {title}", c=c,
                        html=page(f"{code}. {title}", c, body), page="assistant", interactive=interactive))


def a_head(c):
    t = c.t
    right = icon_btn(c, "list", "Мои чаты", "C-A14-Chats.dc.html")
    return f'''    <header style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: -8px -8px 0">
      <a href="C-H01-Home.dc.html" style="min-height: 44px; display: flex; align-items: center; gap: 4px; color: {t['green_text']}">{icon("back", 22)}{symbol(c, 16, label=None)}Mark</a>
      <span style="font-weight: 600">Помощник</span>
      {right}
    </header>'''


def composer(c, text="", focus=False, busy=False, offline=False):
    t, s = c.t, c.s
    v = (esc(text) + ('<span class="caret" aria-hidden="true"></span>' if focus else "")) if text else (f'<span style="color: {t["text2"]}">Сообщение помощнику</span>' + ('<span class="caret" aria-hidden="true"></span>' if focus else ""))
    if busy:
        btn = f'<a href="#" aria-label="Остановить ответ" style="width: 44px; height: 44px; border-radius: 22px; background: {t["raised"]}; display: flex; align-items: center; justify-content: center"><span style="width: 12px; height: 12px; border-radius: 2px; background: {t["text"]}"></span></a>'
    elif text:
        btn = f'<a href="C-A03-Waiting.dc.html" aria-label="Отправить" style="width: 44px; height: 44px; border-radius: 22px; background: {t["green"]}; color: {t["on_green"]}; display: flex; align-items: center; justify-content: center">{icon("send", 20, 2.2)}</a>'
    else:
        btn = f'<a href="#" aria-label="Голосовой ввод" style="width: 44px; height: 44px; border-radius: 22px; background: {t["raised"]}; display: flex; align-items: center; justify-content: center">{icon("mic", 20)}</a>'
    bd = t["green"] if focus else t["border"]
    return f'''<div style="display: flex; gap: 8px; align-items: flex-end">
      <div style="flex: 1; background: {t['field']}; border: 1px solid {bd}; border-radius: 22px; padding: 11px 16px; min-height: 44px; box-sizing: border-box">{v}</div>{btn}
    </div>'''


def chat(c, msgs, comp="", kb=False, overlay=""):
    """msgs: HTML блоков сообщений; comp: поле ввода внизу."""
    t, s = c.t, c.s
    bottom = c.kb_h if kb else 0
    pad = 34 if not kb else 10
    comp_html = comp or composer(c)
    return f'''<div style="width: {c.w}px; height: {c.h}px; box-sizing: border-box; background: {t['bg']}; color: {t['text']}; font-family: {FONT}; font-size: {s['base']}px; line-height: 1.45; position: relative; overflow: hidden; display: flex; flex-direction: column">
  <div style="padding: 56px 20px 8px; flex-shrink: 0">{a_head(c)}</div>
  <div style="flex: 1; min-height: 0; overflow: hidden; display: flex; flex-direction: column; justify-content: flex-end">
    <div style="padding: 8px 20px 12px; display: flex; flex-direction: column; gap: 14px">
{msgs}
    </div>
  </div>
  <div style="flex-shrink: 0; padding: 8px 16px {pad}px; border-top: 1px solid {t['divider']}; background: {t['bg']}; margin-bottom: {bottom}px">{comp_html}</div>
  {keyboard(c) if kb else ""}
  {overlay}
</div>'''


def me(c, text, status=""):
    t, s = c.t, c.s
    st = f'<span style="font-size: {s["small"]}px; color: {t["red"] if "Не" in status else t["text2"]}; align-self: flex-end">{status}</span>' if status else ""
    return f'''      <div style="align-self: flex-end; max-width: 82%; display: flex; flex-direction: column; gap: 4px"><div style="background: {t['raised']}; border-radius: 18px 18px 6px 18px; padding: 10px 14px">{text}</div>{st}</div>'''


def bot(c, text):
    return f'''      <div style="max-width: 92%; display: flex; flex-direction: column; gap: 8px">{text}</div>'''


def change_row(c, kind, title, before="", after="", state="", on=True):
    """Одно действие предложения. state: ''|applied|failed|conflict|cancelled."""
    t, s = c.t, c.s
    kinds = {"move": "Перенести", "create": "Создать", "deadline": "Изменить срок", "done": "Отметить выполненной"}
    det = ""
    if before or after:
        det = f'<span style="font-size: {s["small"]}px; color: {t["text2"]}"><s>{before}</s> → <span style="color: {t["text"]}">{after}</span></span>' if before else f'<span style="font-size: {s["small"]}px; color: {t["text2"]}">{after}</span>'
    badges = {
        "applied": (t["green_text"], t["green_soft"], "check", "Применено"),
        "failed": (t["red"], t["red_soft"], "alert", "Не применено"),
        "conflict": (t["yellow"], t["yellow_soft"], "layers", "Две версии"),
        "cancelled": (t["text2"], t["raised"], "undo", "Отменено"),
    }
    b = ""
    if state:
        col, bg, ic, txt = badges[state]
        b = f'<span class="badge" style="color: {col}; background: {bg}; align-self: flex-start">{icon(ic, 13, 2)}{txt}</span>'
    box = ""
    if not state:
        box = (f'<span role="checkbox" aria-checked="{str(on).lower()}" style="width: 22px; height: 22px; border-radius: 6px; flex-shrink: 0; box-sizing: border-box; display: flex; align-items: center; justify-content: center; '
               + (f'background: {t["green"]}; color: {t["on_green"]}' if on else f'border: 1.5px solid {t["check"]}') + f'">{icon("check", 14, 3) if on else ""}</span>')
    return f'''<div style="display: flex; gap: 10px; align-items: flex-start; padding: 10px 0; border-top: 1px solid {t['divider']}">
          {box}<div style="flex: 1; display: flex; flex-direction: column; gap: 2px"><span><span style="color: {t['text2']}">{kinds[kind]}</span> «{esc(title)}»</span>{det}{b}</div>
        </div>'''


ROWS = [("move", "Тренировка", "сегодня, 19:00", "завтра, 19:00"),
        ("create", "Купить корм коту", "", "завтра, без времени"),
        ("deadline", "Отчёт для Palmira Istra", "до 23 окт", "до 24 окт")]


def proposal(c, states=("", "", ""), footer="", head="Предлагаю 3 изменения", sub="Ничего не изменится, пока вы не нажмёте «Применить»."):
    t, s = c.t, c.s
    rows = "".join(change_row(c, k, n, b, a, st) for (k, n, b, a), st in zip(ROWS, states))
    return f'''<section aria-label="Предложение помощника" style="background: {t['surface']}; border: 1px solid {t['border']}; border-radius: 16px; padding: 12px 14px; display: flex; flex-direction: column; gap: 2px">
        <span style="font-weight: 600">{head}</span><span style="font-size: {s['small']}px; color: {t['text2']}; margin-bottom: 6px">{sub}</span>
        {rows}
        {footer}
      </section>'''


def build():
    t = None
    # Начальный экран
    c = Ctx()
    t, s = c.t, c.s
    sug = "".join(f'<a href="C-A02-Typing.dc.html" class="cap" style="justify-content: flex-start">{x}</a>' for x in ["Собери план на сегодня", "Что у меня просрочено?", "Перенеси тренировку на завтра"])
    msgs = f'''      <div style="display: flex; flex-direction: column; gap: 12px; padding-bottom: 12px">
        {symbol(c, 34, label=None)}
        <h1 style="margin: 0; font-size: {s['title'] - 4}px; font-weight: 700">Чем помочь, Кирилл?</h1>
        <p style="margin: 0; color: {t['text2']}">Могу собрать план дня, найти задачи и предложить изменения. Задачи меняются только после вашего подтверждения.</p>
        <div style="display: flex; flex-direction: column; gap: 8px; align-items: flex-start">{sug}</div>
      </div>'''
    add("A01", "Start", "Начальный экран", c, chat(c, msgs), True)

    c = Ctx()
    add("A02", "Typing", "Ввод сообщения", c, chat(c, "", composer(c, "Перенеси тренировку на завтра и купить корм коту добавь", True), kb=True), True)

    c = Ctx()
    t = c.t
    wait = bot(c, f'<span style="color: {t["text2"]}; display: flex; align-items: center; gap: 8px"><span aria-hidden="true" style="display: flex; gap: 4px">' + "".join(f'<span style="width: 6px; height: 6px; border-radius: 3px; background: {t["text2"]}; opacity: {o}"></span>' for o in (1, .6, .3)) + '</span>Смотрю ваши задачи…</span>')
    add("A03", "Waiting", "Ожидание ответа", c, chat(c, me(c, "Перенеси тренировку на завтра и купить корм коту добавь") + "\n" + wait, composer(c, busy=True)))

    c = Ctx()
    q = bot(c, f'''<span>На какое время перенести тренировку? Завтра в 19:00 у вас свободно, но в 12:00 созвон.</span>
        <div style="display: flex; gap: 6px; flex-wrap: wrap"><a href="C-A06-Proposal.dc.html" class="cap">Завтра, 19:00</a><a href="#" class="cap">Завтра, 8:00</a><a href="#" class="cap">Другое время</a></div>''')
    add("A04", "Question", "Уточняющий вопрос", c, chat(c, me(c, "Перенеси тренировку на завтра") + "\n" + q), True)

    c = Ctx()
    t = c.t
    ans = bot(c, f'''<span>Сегодня 5 задач, одна уже выполнена, и встреча в 15:00.</span>
        <span>Главное — «Смета для Palmira Istra», срок в 15:00. До встречи осталось около двух часов: смету лучше закончить сейчас.</span>
        <span>Просрочены 2 задачи: «Отправить акт за сентябрь» и «Записаться к стоматологу».</span>
        <span style="font-size: {c.s['small']}px; color: {t['text2']}">Ответ без изменений в задачах.</span>''')
    add("A05", "Answer", "Обычный ответ без изменений", c, chat(c, me(c, "Что у меня сегодня?") + "\n" + ans))

    def footer(c, state="ready"):
        t = c.t
        if state == "ready":
            return f'<div style="display: flex; gap: 8px; margin-top: 10px"><a href="C-A07-Applying.dc.html" class="btn" style="flex: 1; min-height: 44px">Применить 3</a><a href="#" class="btn2" style="flex: 0 0 auto">Отклонить</a></div>'
        if state == "applying":
            return f'<div style="display: flex; gap: 8px; margin-top: 10px"><a href="#" aria-disabled="true" class="btn" style="flex: 1; min-height: 44px; opacity: .7"><span aria-hidden="true" style="width: 16px; height: 16px; border-radius: 50%; border: 2px solid {t["on_green"]}; border-right-color: transparent; box-sizing: border-box"></span>Применяю…</a></div><span style="font-size: {c.s["small"]}px; color: {t["text2"]}">Кнопка заблокирована, пока изменения сохраняются, — повторное нажатие ничего не задвоит.</span>'
        return state

    c = Ctx()
    add("A06", "Proposal", "Предложение — просмотр до подтверждения", c, chat(c, me(c, "Перенеси тренировку на завтра, добавь купить корм коту и сдвинь срок отчёта на день") + "\n" + bot(c, proposal(c, footer=footer(c)))), True)
    c = Ctx()
    add("A07", "Applying", "Применение с защитой от повторного нажатия", c, chat(c, me(c, "Перенеси тренировку на завтра, добавь купить корм коту и сдвинь срок отчёта на день") + "\n" + bot(c, proposal(c, footer=footer(c, "applying")))), True)

    c = Ctx()
    t = c.t
    f = f'<div style="display: flex; gap: 8px; margin-top: 10px; align-items: center"><span style="flex: 1; font-size: {c.s["small"]}px; color: {t["text2"]}">Сохранено в 12:52</span><a href="C-A12-Undone.dc.html" class="btn2" style="min-height: 40px">{icon("undo", 16)}Отменить изменения</a></div>'
    add("A08", "Applied", "Успешный результат", c, chat(c, bot(c, proposal(c, ("applied",) * 3, f, "Применено: 3 из 3", "Задачи обновлены на всех устройствах."))), True)

    c = Ctx()
    t = c.t
    f = f'''<div style="font-size: {c.s['small']}px; color: {t['text3']}; margin-top: 6px">«Отчёт для Palmira Istra» удалили на другом устройстве, поэтому срок не изменён. Остальные изменения независимы и сохранены.</div>
        <div style="display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap"><a href="#" class="btn2" style="min-height: 40px; white-space: nowrap">Корзина</a><a href="#" class="btn2" style="min-height: 40px; white-space: nowrap">{icon("undo", 16)}Отменить применённые</a></div>'''
    add("A09", "Partial", "Частичный результат для независимых действий", c, chat(c, bot(c, proposal(c, ("applied", "applied", "failed"), f, "Применено: 2 из 3", "Одно изменение не получилось."))))

    c = Ctx()
    t = c.t
    f = f'''<div style="font-size: {c.s['small']}px; color: {t['text3']}; margin-top: 6px">«Тренировку» изменили на другом устройстве в 12:44, пока вы смотрели предложение. Чтобы не затереть ту правку, перенос не применён.</div>
        <div style="display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap"><a href="C-H09-Versions.dc.html" class="btn2" style="min-height: 40px; white-space: nowrap">Сравнить версии</a><a href="#" class="btn2" style="min-height: 40px; white-space: nowrap">{icon("repeat", 16)}Предложить заново</a></div>'''
    add("A10", "Conflict", "Конфликт", c, chat(c, bot(c, proposal(c, ("conflict", "applied", "applied"), f, "Применено: 2 из 3", "Одно изменение ждёт вашего решения."))), True)

    c = Ctx()
    t = c.t
    off = banner(c, "Нет сети", "neutral", "cloud_off", "Повторить", "C-A03-Waiting.dc.html", "Помощнику нужен интернет. Сообщение сохранено.")
    add("A11", "Offline", "Нет сети и повтор запроса", c, chat(c, me(c, "Что у меня завтра?", "Не отправлено") + "\n" + off), True)

    c = Ctx()
    ov = toast(c, "Изменения отменены — 3 задачи вернулись как были", ic="undo", bottom=110)
    add("A12", "Undone", "Отмена применённых изменений", c, chat(c, bot(c, proposal(c, ("cancelled",) * 3, "", "Отменено: 3 из 3", "Отменить можно, пока задачи не меняли после применения.")), overlay=ov))

    c = Ctx()
    t = c.t
    rows = "".join(change_row(c, "move", n, b, a, "") for n, b, a in [("Смета для Palmira Istra", "14:00", "13:00"), ("Созвон с монтажёром", "завтра 12:00", "сегодня 17:00"), ("Тренировка", "19:00", "20:00")])
    plan = f'''<section style="background: {t['surface']}; border: 1px solid {t['border']}; border-radius: 16px; padding: 12px 14px; display: flex; flex-direction: column; gap: 2px">
        <span style="font-weight: 600">План дня изменился</span><span style="font-size: {c.s['small']}px; color: {t['text2']}">Это связанный план: изменения зависят друг от друга, поэтому применить часть нельзя.</span>
        {rows}
        <div style="font-size: {c.s['small']}px; color: {t['yellow']}; display: flex; gap: 6px; margin-top: 6px">{icon("alert", 16, 2)}Пока вы смотрели, «Созвон с монтажёром» перенесли на 18:00. План нужно пересчитать.</div>
        <div style="display: flex; flex-direction: column; gap: 6px; margin-top: 10px"><a href="C-A03-Waiting.dc.html" class="btn" style="min-height: 44px">{icon("repeat", 18)}Пересчитать план</a><a href="#" class="tbtn" style="align-self: center; color: {t['text3']}">Отклонить</a></div>
      </section>'''
    add("A13", "Replan", "Связанный план — нужен пересчёт", c, chat(c, me(c, "Перестрой мне день, чтобы успеть смету до встречи") + "\n" + bot(c, plan)))

    c = Ctx()
    t = c.t
    rows = [setting_row(c, "Перенести тренировку и купить корм", "сегодня", None, "C-A08-Applied.dc.html"),
            setting_row(c, "План на неделю", "вчера", None),
            setting_row(c, "Что просрочено", "16 окт", None)]
    body = f'''{back_bar(c, "Мои чаты", "Помощник", "C-A01-Start.dc.html")}
    <a href="C-A01-Start.dc.html" class="btn2" style="align-self: flex-start">{icon("plus", 18)}Новый чат</a>
    {group(c, rows, "Недавние")}
    {group(c, [setting_row(c, "Память помощника", "4 заметки", "text")])}
    <span class="lbl">Чаты и память хранятся на этом телефоне.</span>'''
    add("A14", "Chats", "История и переключение чатов", c, root(c, body), True)

    L = Ctx(LIGHT)
    add("A15", "ProposalLight", "Светлая тема — предложение", L, chat(L, me(L, "Перенеси тренировку на завтра, добавь купить корм коту и сдвинь срок отчёта на день") + "\n" + bot(L, proposal(L, footer=footer(L)))))
