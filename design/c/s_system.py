"""Система оформления: знак, цвета, текст, размеры, компоненты и состояния."""
import re
from ds import *

SCREENS = []
W = 1280
INK = "#18212B"
PAPER = "#EEF0F2"


def scoped(c, scope):
    """base_style, ограниченный классом scope: так на одной доске уживаются обе темы."""
    out = []
    for line in base_style(c).splitlines():
        m = re.match(r"^([^{]+)\{(.*)\}$", line)
        if not m or m.group(1).strip() in ("body", "a", "button"):
            continue
        sels = ",".join(f".{scope} {x.strip()}" for x in m.group(1).split(","))
        out.append(f"{sels}{{{m.group(2)}}}")
    return "\n".join(out)


def board(code, name, title, h, body, extra=""):
    d, l = Ctx(), Ctx(LIGHT)
    style = f"body{{margin:0}}\na{{color:inherit;text-decoration:none}}\nbutton{{font:inherit;color:inherit}}\n{scoped(d, 'thd')}\n{scoped(l, 'thl')}\n{extra}"
    c = Ctx(w=W, h=h)
    html = f'''<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>{esc(title)}</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<style>
{style}
</style>
</helmet>
<div style="width: {W}px; height: {h}px; box-sizing: border-box; background: {PAPER}; color: {INK}; font-family: {FONT}; font-size: 15px; line-height: 1.45; padding: 40px 48px; display: flex; flex-direction: column; gap: 24px; overflow: hidden">
  <header style="display: flex; flex-direction: column; gap: 4px"><h1 style="margin: 0; font-size: 30px; font-weight: 700">{title}</h1></header>
{body}
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{{"$preview":{{"width":{W},"height":{h}}}}}'>
class Component extends DCLogic {{
  renderVals() {{ return {{}}; }}
}}
</script>
</body>
</html>
'''
    SCREENS.append(dict(file=f"C-{code}-{name}.dc.html", title=f"{code}. {title}", c=c, w=W, h=h, html=html, page="sys"))


def panel(c, scope, inner, label):
    t = c.t
    return f'''<div class="{scope}" style="flex: 1; min-width: 0; background: {t['bg']}; color: {t['text']}; border-radius: 18px; padding: 20px; display: flex; flex-direction: column; gap: 14px; font-size: {c.s['base']}px">
      <span style="font-size: 12px; font-weight: 600; letter-spacing: .06em; color: {t['text2']}">{label}</span>
      {inner}
    </div>'''


def both(fn, label_d="ТЁМНАЯ ТЕМА", label_l="СВЕТЛАЯ ТЕМА"):
    d, l = Ctx(), Ctx(LIGHT)
    return f'<div style="display: flex; gap: 20px">{panel(d, "thd", fn(d), label_d)}{panel(l, "thl", fn(l), label_l)}</div>'


def note(text):
    return f'<p style="margin: 0; color: #4A5561; max-width: 1100px">{text}</p>'


def build():
    # Знак и иконка
    d, l = Ctx(), Ctx(LIGHT)
    body = f'''  {note("Название приложения везде пишется «Mark» — с заглавной буквы, без капса. На главной экран открывает только знак: линия-буква M без надписи.")}
  <div style="display: flex; gap: 20px; align-items: stretch">
    <div style="background: #FFFFFF; border-radius: 18px; padding: 24px; display: flex; flex-direction: column; align-items: center; gap: 12px; width: 260px">{app_icon(180)}<b>Иконка приложения</b><span style="color: #4A5561; text-align: center; font-size: 13px">design/brand/mark-icon.svg · 1024 × 1024</span></div>
    <div style="background: {d.t['bg']}; color: {d.t['text']}; border-radius: 18px; padding: 24px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; flex: 1">{symbol(d, 72)}<b>Знак на тёмной теме</b><span style="color: {d.t['text2']}; font-size: 13px">градиент {d.t['logo_a']} → {d.t['logo_b']}</span></div>
    <div style="background: {l.t['bg']}; color: {l.t['text']}; border-radius: 18px; padding: 24px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; flex: 1">{symbol(l, 72)}<b>Знак на светлой теме</b><span style="color: {l.t['text2']}; font-size: 13px">градиент {l.t['logo_a']} → {l.t['logo_b']}</span></div>
    <div style="background: linear-gradient(180deg, #07563A, #003923); color: #FFFFFF; border-radius: 18px; padding: 24px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; flex: 1">{symbol(d, 72, "#FFFFFF")}<b>Белый знак на зелёном</b><span style="font-size: 13px; opacity: .8">экран загрузки, иконка</span></div>
  </div>
  <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px">
    <div style="background: #FFFFFF; border-radius: 18px; padding: 20px"><b>На главной</b><p style="margin: 6px 0 0; color: #4A5561">Знак высотой с приветствие (22 px; 28 px при крупном тексте) слева от даты и приветствия. Без слова «Mark».</p></div>
    <div style="background: #FFFFFF; border-radius: 18px; padding: 20px"><b>Экран загрузки</b><p style="margin: 6px 0 0; color: #4A5561">Фирменный зелёный градиент и белый знак 84 px по центру. Без текста и индикаторов: экран виден доли секунды.</p></div>
    <div style="background: #FFFFFF; border-radius: 18px; padding: 20px"><b>Охранное поле</b><p style="margin: 6px 0 0; color: #4A5561">Вокруг знака — не меньше четверти его высоты. Знак не вращать, не обводить, не ставить на пёстрый фон.</p></div>
  </div>'''
    board("S01", "Brand", "Знак и иконка Mark", 600, body)

    # Цвета
    def swatches(c):
        t = c.t
        names = [("bg", "Фон экрана"), ("surface", "Карточки, листы"), ("raised", "Плашки, аватар"), ("text", "Основной текст"), ("text2", "Вторичный текст"),
                 ("text3", "Спокойные кнопки"), ("green", "Акцент: «+», «Добавить», выбор"), ("card_border", "Рамка главной задачи"), ("yellow", "Срок сегодня"),
                 ("red", "Просрочено, удаление"), ("blue", "Встречи"), ("divider", "Разделители"), ("outline", "Контур капсул"), ("nav", "Нижняя панель")]
        rows = "".join(f'<div style="display: flex; align-items: center; gap: 12px; min-height: 34px"><span style="width: 34px; height: 26px; border-radius: 7px; background: {t[k]}; border: 1px solid {t["border"]}"></span><span style="flex: 1">{n}</span><span style="font-family: ui-monospace, Menlo, monospace; font-size: 12px; color: {t["text2"]}">{t[k]}</span></div>' for k, n in names)
        return rows
    body = f'''  {note("Палитра пакета B без изменений, кроме новых состояний: красный для просроченных сроков и голубой для встреч. Контраст текста — не ниже 4,5 : 1 на своём фоне.")}
  {both(swatches)}'''
    board("S02", "Colors", "Цвета", 760, body)

    # Текст, отступы, скругления
    rows = [("Заголовок раздела", "28 / 700", "«Задачи», «Календарь»"), ("Приветствие", "22 / 700", "главная"), ("Главная задача", "19 / 600", "название в карточке"),
            ("Подзаголовок", "17 / 600", "«План дня», заголовки листов"), ("Основной текст", "16 / 400", "задачи, поля"), ("Поле названия", "18 / 400", "форма новой задачи"),
            ("Кнопки", "16 / 600", "«Добавить»"), ("Капсулы, плашки", "14 / 400", "«Без даты», фильтры"), ("Подписи", "13 / 400", "время, проект, сроки"), ("Нижняя панель", "11 / 500", "подписи разделов")]
    tr = "".join(f'<tr><td style="padding: 8px 12px; border-top: 1px solid #DCE1E5">{a}</td><td style="padding: 8px 12px; border-top: 1px solid #DCE1E5; font-family: ui-monospace, Menlo, monospace">{b}</td><td style="padding: 8px 12px; border-top: 1px solid #DCE1E5; color: #4A5561">{c_}</td></tr>' for a, b, c_ in rows)
    sp = [("Поля экрана", "20"), ("Между блоками главной", "16"), ("Строка задачи", "10 сверху и снизу"), ("Внутри карточки", "12–16"), ("Между капсулами", "6–8"), ("Отступ сверху", "56 (под системной строкой)"), ("Конец прокрутки", "28 над нижней панелью")]
    rd = [("Карточки, листы", "20"), ("Группы настроек", "16"), ("Кнопки", "14"), ("Поля", "12"), ("Капсулы, плашки", "половина высоты"), ("Отметки, «+»", "круг"), ("Метки сроков", "7")]
    lst = lambda items: "".join(f'<div style="display: flex; justify-content: space-between; gap: 12px; padding: 7px 0; border-top: 1px solid #DCE1E5"><span>{a}</span><span style="font-family: ui-monospace, Menlo, monospace">{b}</span></div>' for a, b in items)
    body = f'''  {note("Системный шрифт iPhone (SF Pro), без своих шрифтов. Размеры — в точках при стандартном размере текста; при крупном тексте всё растёт примерно на треть, области нажатия не уменьшаются. Строка 1,4.")}
  <div style="display: grid; grid-template-columns: 1.4fr 1fr 1fr; gap: 20px; align-items: start">
    <div style="background: #FFFFFF; border-radius: 18px; padding: 8px 8px"><table style="border-collapse: collapse; width: 100%; font-size: 14px"><thead><tr><th style="text-align: left; padding: 8px 12px">Роль</th><th style="text-align: left; padding: 8px 12px">Размер / начертание</th><th style="text-align: left; padding: 8px 12px">Где</th></tr></thead><tbody>{tr}</tbody></table></div>
    <div style="background: #FFFFFF; border-radius: 18px; padding: 16px 20px"><b>Отступы, pt</b>{lst(sp)}</div>
    <div style="background: #FFFFFF; border-radius: 18px; padding: 16px 20px"><b>Скругления, pt</b>{lst(rd)}<div style="margin-top: 14px"><b>Границы</b><p style="margin: 4px 0 0; color: #4A5561">1 pt. Рамка главной задачи — зелёная 28%. Фокус поля — зелёная 1 pt без подсветки вокруг. Теней нет, кроме всплывающего меню.</p></div><div style="margin-top: 14px"><b>Области нажатия</b><p style="margin: 4px 0 0; color: #4A5561">Не меньше 44 × 44 pt. У капсул высотой 36 pt недостающее место — прозрачный отступ.</p></div></div>
  </div>'''
    board("S03", "Type", "Текст, отступы, скругления", 760, body)

    # Кнопки, поля, отметки, фильтры — состояния
    def controls(c):
        t = c.t
        spin = f'<span aria-hidden="true" style="width: 16px; height: 16px; border-radius: 50%; border: 2px solid {t["on_green"]}; border-right-color: transparent; box-sizing: border-box"></span>'
        lab = lambda x: f'<span style="font-size: 12px; color: {t["text2"]}">{x}</span>'
        col = lambda *xs: f'<div style="display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 0">{"".join(xs)}</div>'
        rowx = lambda *xs: f'<div style="display: flex; gap: 10px; align-items: flex-start">{"".join(xs)}</div>'
        sw_on = setting_row(c, "", "", toggle=True).replace('class="li"', 'style="display: flex"')
        sw_off = setting_row(c, "", "", toggle=False).replace('class="li"', 'style="display: flex"')
        return "".join([
            rowx(col(lab("Обычная"), '<a class="btn">Добавить</a>'), col(lab("Нажатая"), f'<a class="btn" style="filter: brightness(.88)">Добавить</a>'),
                 col(lab("Недоступна"), f'<a class="btn" style="background: {t["raised"]}; color: {t["disabled"]}">Добавить</a>'), col(lab("Загрузка"), f'<a class="btn" style="opacity: .75">{spin}Сохраняю…</a>')),
            rowx(col(lab("Вторичная"), '<a class="btn2">Обсудить план</a>'), col(lab("Текстовая"), '<a class="tbtn">Сегодня</a>'), col(lab("Удаление"), f'<a class="btn2" style="color: {t["red"]}">{icon("trash", 18)}Удалить</a>')),
            rowx(col(lab("Поле"), field(c, "", "", "Найти проект", ic="search")), col(lab("Фокус"), field(c, "", "Ремонт", focus=True))),
            rowx(col(lab("Ошибка"), field(c, "", "kirill@", err="Проверьте адрес почты")), col(lab("Недоступно"), f'<span class="field" style="opacity: .5">Только чтение</span>')),
            rowx(col(lab("Капсулы: обычная и выбранная"), f'<div style="display: flex; gap: 6px; flex-wrap: wrap"><a class="cap">{icon("cal")}Без даты</a><a class="cap sel">{icon("cal")}Завтра</a></div>'),
                 col(lab("Фильтры"), f'<div style="display: flex; gap: 6px"><span class="pill sel">Все</span><span class="pill">Сегодня</span></div>')),
            rowx(col(lab("Отметки: открыта, выполнена, нажата"), f'<div style="display: flex; gap: 14px; align-items: center">{check(c)}{check(c, True)}<span class="chk" style="background: {t["green_soft"]}; border-color: {t["green"]}"></span></div>'),
                 col(lab("Переключатель"), '<div style="display: flex; gap: 12px">' + sw_on + sw_off + '</div>')),
        ])
    body = f'''  {note("У каждого элемента одинаковый набор состояний: обычное, нажатое (затемнение на 12%), выбранное, недоступное (без действия, приглушённый цвет), загрузка (индикатор и текст действия), ошибка (красная граница и подпись словами).")}
  {both(controls)}'''
    board("S04", "Controls", "Кнопки, поля, отметки, фильтры", 820, body)

    # Строки задач и правила сроков
    def rows(c):
        T = lambda title, meta, **k: task_row(c, title, meta, **k)
        lab = lambda x: f'<span style="font-size: 12px; color: {c.t["text2"]}; margin-top: 6px">{x}</span>'
        from s_tasks import inbox_badge, main_badge
        return "".join([
            lab("Когда сделать — нейтрально"), T("Тренировка", when(c, "19:00 · 1 ч", extra=["Здоровье"])),
            lab("Без времени"), T("Разобрать почту", when(c, "Без времени")),
            lab("Будущий крайний срок — нейтрально"), T("Отчёт для Palmira Istra", when(c, "пт, 23 окт", "23 окт", "future", ["KINOMARK"])),
            lab("Крайний срок сегодня — жёлтая метка со словами"), T("Оплатить аренду студии", when(c, None, "до конца дня", "today", ["KINOMARK"])),
            lab("Просрочено — красная метка со словами"), T("Отправить акт за сентябрь", when(c, None, "18 окт", "overdue", ["KINOMARK"])),
            lab("Выполнено"), T("Позвонить Никите", when(c, "11:30", extra=["выполнено"]), done=True),
            lab("Метки: главная, входящие, важно"), T("Купить корм коту", main_badge(c) + "<span>·</span>" + inbox_badge(c), important=False),
        ])
    body = f'''  {note("«Когда сделать» и «Выполнить до» — разные поля. Пропущенное время «Когда сделать» не делает задачу просроченной. Срок без времени пишется «до конца дня», 23:59 в интерфейсе не показывается. Перенос времени не меняет крайний срок. Цвет всегда дублируется словом и значком.")}
  {both(rows)}'''
    board("S05", "TaskRows", "Строки задач и правила сроков", 1180, body)

    # Панели, листы, меню, сообщения
    def surfaces(c):
        t = c.t
        lab = lambda x: f'<span style="font-size: 12px; color: {t["text2"]}">{x}</span>'
        nav = bottom_nav(c, "home").replace("height: 84px", "height: 76px").replace('<nav aria-label="Разделы"', '<nav aria-label="Разделы (образец)"')
        tst = lambda txt, act, ic: f'<div role="status" style="background: {t["toast"]}; color: {t["toast_text"]}; border-radius: 14px; padding: 4px 12px 4px 16px; min-height: 52px; display: flex; align-items: center; gap: 10px">{icon(ic, 18)}<span style="flex: 1">{txt}</span><b style="text-decoration: underline">{act}</b></div>'
        return "".join([
            lab("Нижняя панель: тонкая граница сверху, круглый «+» без свечения"), f'<div style="border-radius: 12px; overflow: hidden">{nav}</div>',
            lab("Успех — всплывающее сообщение с отменой"), tst("Задача добавлена во «Входящие»", "Отменить", "check"),
            lab("Нет сети"), banner(c, "Нет сети", "neutral", "cloud_off", sub="Изменения сохранены на телефоне"),
            lab("Две версии"), banner(c, "У задачи две версии", "yellow", "layers", "Сравнить"),
            lab("Ошибка"), banner(c, "Задача не сохранилась", "red", "alert", "Повторить", sub="Текст остался в форме"),
            lab("Заголовок листа"), f'<div style="background: {t["surface"]}; border-radius: 16px; padding: 10px 14px">{sheet_head(c, "Новый проект", "Отмена", "Создать")}</div>',
        ])
    body = f'''  {note("Листы выезжают снизу и закрываются смахиванием или «Отмена». Меню открывается у кнопки «…» и закрывается касанием вне меню. Сообщения об успехе исчезают через 5 секунд; ошибки и «Нет сети» остаются, пока ситуация не изменится.")}
  {both(surfaces)}'''
    board("S06", "Surfaces", "Панели, листы и сообщения", 1000, body)
