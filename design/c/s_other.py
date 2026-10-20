"""Экран загрузки, иконка, вход, регистрация, восстановление пароля и кабинет."""
from ds import *

SCREENS = []


def add(code, name, title, c, body, interactive=False):
    SCREENS.append(dict(file=f"C-{code}-{name}.dc.html", title=f"{code}. {title}", c=c,
                        html=page(f"{code}. {title}", c, body), page="other", interactive=interactive))


def splash(c):
    return f'''<div style="width: {c.w}px; height: {c.h}px; position: relative; overflow: hidden; font-family: {FONT}; background: #003B26">
  <div aria-hidden="true" style="position: absolute; inset: 0; background: linear-gradient(180deg, #07563A 0%, #003B26 58%, #003923 100%)"></div>
  <div aria-hidden="true" style="position: absolute; inset: 0; background: radial-gradient(120% 60% at 50% 0%, rgba(50,154,97,0.85) 0%, rgba(38,132,83,0.5) 30%, rgba(20,115,71,0) 70%)"></div>
  <div style="position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px">
    {symbol(c, 84, "#FFFFFF", "Mark")}
  </div>
</div>'''


def auth(c, mode="signin", err="", sent=False):
    t, s = c.t, c.s
    title = {"signin": "Вход", "signup": "Регистрация", "recover": "Восстановление пароля"}[mode]
    fields = field(c, "Почта", "kirill@example.com", focus=(mode == "recover" and not sent), ic="user")
    if mode != "recover":
        fields += field(c, "Пароль", "••••••••", err=err, ic="lock", hint="Не меньше 6 символов" if mode == "signup" else "")
    btn = {"signin": "Войти", "signup": "Зарегистрироваться", "recover": "Отправить письмо"}[mode]
    links = {
        "signin": f'<a href="C-O10-Recover.dc.html" class="tbtn" style="align-self: center">Забыли пароль?</a><a href="C-O04-Signup.dc.html" class="tbtn" style="align-self: center; color: {t["text3"]}">Нет аккаунта? Зарегистрироваться</a>',
        "signup": f'<a href="C-O03-Login.dc.html" class="tbtn" style="align-self: center; color: {t["text3"]}">Уже есть аккаунт? Войти</a>',
        "recover": f'<a href="C-O03-Login.dc.html" class="tbtn" style="align-self: center; color: {t["text3"]}">Вернуться ко входу</a>',
    }[mode]
    msg = ""
    if sent:
        msg = banner(c, "Письмо отправлено", "neutral", "check", sub="Откройте ссылку из письма на этом телефоне, чтобы задать новый пароль.")
    href = "C-H13-Loading.dc.html" if mode != "recover" else "C-O10b-RecoverSent.dc.html"
    return f'''<div style="width: {c.w}px; height: {c.h}px; box-sizing: border-box; background: {t['bg']}; color: {t['text']}; font-family: {FONT}; font-size: {s['base']}px; line-height: 1.4; padding: 96px 24px 34px; display: flex; flex-direction: column; gap: 16px">
  <div style="display: flex; flex-direction: column; align-items: center; gap: 12px; margin-bottom: 12px">
    {app_icon(72)}
    <span style="font-size: {s['title']}px; font-weight: 700">Mark</span>
    <span class="lbl" style="font-size: {s['base']}px">{title}</span>
  </div>
  <form style="display: flex; flex-direction: column; gap: 14px" aria-label="{title}">
    {fields}
    {msg}
    <a href="{href}" class="btn">{btn}</a>
  </form>
  {links}
</div>'''


def account_body(c):
    t, s = c.t, c.s
    head = f'''    <div style="display: flex; align-items: center; gap: 14px">
      <span style="width: 56px; height: 56px; border-radius: 28px; background: {t['raised']}; display: flex; align-items: center; justify-content: center; font-size: 22px; font-weight: 600">К</span>
      <div style="display: flex; flex-direction: column; flex: 1; min-width: 0"><span style="font-size: {s['h2'] + 1}px; font-weight: 600">Кирилл</span><span class="lbl">kirill@example.com</span></div>
    </div>
    <div style="display: flex; align-items: center; gap: 8px; color: {t['text2']}; font-size: {s['small']}px"><span style="width: 8px; height: 8px; border-radius: 4px; background: {t['green']}"></span>Всё сохранено · последняя сверка в 12:51</div>'''
    g1 = group(c, [setting_row(c, "Тема", "Как в системе", "moon"), setting_row(c, "Часовой пояс", "Москва", "globe")], "Оформление")
    g2 = group(c, [setting_row(c, "Уведомления и напоминания", "", "bell", "C-O06-Notifications.dc.html"),
                   setting_row(c, "Telegram", "Подключён", "tg", "C-O06-Notifications.dc.html"),
                   setting_row(c, "Виджет на iPhone", "", "widget")], "Связь")
    g3 = group(c, [setting_row(c, "Планирование", "9:00–19:00", "clock", "C-O07-Planning.dc.html"),
                   setting_row(c, "Помощник", "Включён", "spark", "C-O08-Assistant.dc.html"),
                   setting_row(c, "Проекты", "4", "folder", "C-P01-Projects.dc.html")], "Работа")
    g4 = group(c, [setting_row(c, "Экспорт задач", "JSON, CSV", "download", "C-O09-Data.dc.html"),
                   setting_row(c, "Корзина", "3", "trash", "C-T13-Trash.dc.html")], "Данные")
    g5 = group(c, [setting_row(c, "Сменить пароль", "", "lock"), setting_row(c, "Выйти из аккаунта", "", "out", chevron=False, danger=True)])
    return f'''{back_bar(c, "Кабинет", "Главная", "C-H01-Home.dc.html")}
{head}
    {g1}
    {g2}
    {g3}
    {g4}
    {g5}
    <span class="lbl" style="text-align: center">Mark · тестовая сборка</span>'''


def build():
    c = Ctx()
    add("O01", "Splash", "Экран загрузки", c, splash(c))

    # Иконка на экране «Домой»
    c = Ctx()
    t = c.t

    def tile(label, color, glyph=""):
        return f'<div style="display: flex; flex-direction: column; align-items: center; gap: 6px; width: 64px"><span aria-hidden="true" style="width: 62px; height: 62px; border-radius: 14px; background: {color}; display: flex; align-items: center; justify-content: center; color: #FFFFFF">{glyph}</span><span style="font-size: 12px; color: #FFFFFF">{label}</span></div>'
    mark_tile = f'<div style="display: flex; flex-direction: column; align-items: center; gap: 6px; width: 64px">{app_icon(62)}<span style="font-size: 12px; color: #FFFFFF; font-weight: 600">Mark</span></div>'
    grid = "".join([tile("Календарь", "#E9EDF0", f'<span style="color: #D9443B; font-weight: 600; font-size: 24px">20</span>'), tile("Заметки", "#F4C84A", icon("text", 28)), mark_tile, tile("Почта", "#3E87E6", icon("send", 26)),
                    tile("Фото", "#C77BDB", icon("spark", 26)), tile("Карты", "#5FB57A", icon("globe", 26)), tile("Музыка", "#E2546D", icon("mic", 26)), tile("Настройки", "#8E979F", icon("repeat", 26))])
    body = f'''<div style="width: {c.w}px; height: {c.h}px; overflow: hidden; font-family: {FONT}; background: linear-gradient(160deg, #2B3A45 0%, #1B2229 60%, #13181D 100%); padding: 96px 28px 0; box-sizing: border-box; display: flex; flex-direction: column; gap: 32px">
  <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); row-gap: 26px; justify-items: center">{grid}</div>
  <div style="margin-top: auto; margin-bottom: 120px; display: flex; flex-direction: column; align-items: center; gap: 18px">
    {app_icon(180)}
    <span style="color: #E9EDF0; font-size: 14px; text-align: center">Иконка Mark: белый знак на зелёной плитке. Подпись под иконкой — «Mark».</span>
  </div>
</div>'''
    add("O02", "IconHome", "Иконка приложения на iPhone", c, body)

    c = Ctx()
    add("O03", "Login", "Вход", c, auth(c), True)
    c = Ctx()
    add("O04", "Signup", "Регистрация", c, auth(c, "signup"), True)
    c = Ctx()
    add("O04b", "LoginError", "Ошибка входа", c, auth(c, err="Неверная почта или пароль. Проверьте раскладку и попробуйте ещё раз."))
    c = Ctx()
    add("O05", "Account", "Кабинет", c, root(c, account_body(c)), True)

    c = Ctx()
    t = c.t
    body = f'''{back_bar(c, "Уведомления", "Кабинет", "C-O05-Account.dc.html")}
    {group(c, [setting_row(c, "Уведомления на iPhone", "Включены", "phone"), setting_row(c, "Звук", "", None, toggle=True)], "На этом телефоне")}
    <span class="lbl" style="padding: 0 4px; margin-top: -8px">Напоминание приходит, только если оно задано в задаче. Время задачи само его не включает.</span>
    {group(c, [setting_row(c, "Telegram", "@kirill · подключён", "tg"), setting_row(c, "Утренняя сводка", "8:30", "clock"),
               setting_row(c, "Вечерняя сводка", "21:00", "clock"), setting_row(c, "Тихие часы", "23:00–8:00", "moon")], "Telegram")}
    <a href="#" class="tbtn" style="color: {t['red']}">Отвязать Telegram</a>'''
    add("O06", "Notifications", "Уведомления и напоминания", c, root(c, body))

    c = Ctx()
    body = f'''{back_bar(c, "Планирование", "Кабинет", "C-O05-Account.dc.html")}
    {group(c, [setting_row(c, "Начало дня", "9:00", "clock"), setting_row(c, "Конец дня", "19:00", "clock"), setting_row(c, "Перерыв между задачами", "10 мин", "repeat"), setting_row(c, "Неделя начинается", "С понедельника", "cal")])}
    <span class="lbl" style="padding: 0 4px">Эти настройки помогают помощнику предлагать план дня. Календарь не называет время «свободным», пока есть задачи без времени.</span>'''
    add("O07", "Planning", "Планирование", c, root(c, body))

    c = Ctx()
    body = f'''{back_bar(c, "Помощник", "Кабинет", "C-O05-Account.dc.html")}
    {group(c, [setting_row(c, "Помощник включён", "", "spark", toggle=True), setting_row(c, "Короткие ответы", "", "text", toggle=False), setting_row(c, "Память помощника", "4 заметки", "text", "C-A14-Chats.dc.html")])}
    <span class="lbl" style="padding: 0 4px">Помощник меняет задачи только после вашего подтверждения. Чаты и память хранятся на этом телефоне.</span>'''
    add("O08", "Assistant", "Настройки помощника", c, root(c, body))

    c = Ctx()
    t = c.t
    body = f'''{back_bar(c, "Данные", "Кабинет", "C-O05-Account.dc.html")}
    {group(c, [setting_row(c, "Скачать задачи в JSON", "", "download"), setting_row(c, "Скачать задачи в CSV", "", "download")], "Экспорт")}
    {group(c, [setting_row(c, "Корзина", "3 задачи", "trash", "C-T13-Trash.dc.html")])}
    <span class="lbl" style="padding: 0 4px">В файл попадают все задачи, проекты и выполненные. Файл сохраняется на телефоне.</span>'''
    add("O09", "Data", "Данные и экспорт", c, root(c, body))

    c = Ctx()
    add("O10", "Recover", "Восстановление пароля", c, auth(c, "recover"), True)
    c = Ctx()
    add("O10b", "RecoverSent", "Письмо для восстановления отправлено", c, auth(c, "recover", sent=True))

    L = Ctx(LIGHT)
    add("O11", "AccountLight", "Светлая тема — кабинет", L, root(L, account_body(L)))
    L = Ctx(LIGHT)
    add("O12", "LoginLight", "Светлая тема — вход", L, auth(L))
