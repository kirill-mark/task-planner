"""Проекты: необязательная группировка задач в один уровень."""
from ds import *
from s_create import frame, detail_rows
from s_tasks import sec, main_badge

SCREENS = []
PROJECTS = [("KINOMARK", 12, "2 просрочено"), ("Дом", 5, ""), ("Здоровье", 3, "1 просрочено"), ("Учёба английского", 0, "")]


def add(code, name, title, c, body, interactive=False):
    SCREENS.append(dict(file=f"C-{code}-{name}.dc.html", title=f"{code}. {title}", c=c,
                        html=page(f"{code}. {title}", c, body), page="projects", interactive=interactive))


def projects_list(c):
    t = c.t
    rows = []
    for name, n, note in PROJECTS:
        sub = f"{n} задач" if n else "нет задач"
        if note:
            sub += f' · <span style="color: {t["red"]}">{note}</span>'
        rows.append(f'<a href="C-P04-Project.dc.html" class="li"><span style="color: {t["text2"]}; display: flex">{icon("folder", 20)}</span><span style="flex: 1; display: flex; flex-direction: column; padding: 9px 0"><span>{name}</span><span style="font-size: {c.s["small"]}px; color: {t["text2"]}">{sub}</span></span><span style="color: {t["text2"]}; display: flex">{icon("chev", 18)}</span></a>')
    return f'<div style="background: {t["surface"]}; border-radius: 16px; overflow: hidden">{"".join(rows)}</div>'


def list_body(c):
    t = c.t
    return f'''{back_bar(c, "", "Задачи", "C-T04-ByProject.dc.html")}
{screen_title(c, "Проекты", "", "4 проекта")}
    {field(c, "", "", "Найти проект", ic="search")}
    {projects_list(c)}
    <a href="C-P03-Create.dc.html" class="btn2" style="align-self: flex-start">{icon("plus", 18)}Новый проект</a>
    <span class="lbl">Проект — необязательная группа задач. Задачи без проекта видны в общем списке.</span>'''


def project_body(c):
    T = lambda title, meta: task_row(c, title, meta, href="C-E01-TaskView.dc.html")
    right = icon_btn(c, "more", "Действия с проектом", "C-P09-Menu.dc.html")
    return f'''{back_bar(c, "", "Проекты", "C-P01-Projects.dc.html", right)}
{screen_title(c, "KINOMARK", "", "12 задач · 2 выполнено за неделю")}
{sec(c, "Просрочено", 1, [T("Отправить акт за сентябрь", when(c, None, "18 окт", "overdue"))], "red")}
{sec(c, "Сегодня", 2, [T("Смета для Palmira Istra", main_badge(c) + "<span>·</span>" + when(c, None, "15:00", "today")), T("Оплатить аренду студии", when(c, None, "до конца дня", "today"))])}
{sec(c, "Позже", 6, [T("Созвон с монтажёром", when(c, "завтра, 12:00 · 30 мин")), T("Отчёт для Palmira Istra", when(c, "пт, 23 окт", "23 окт"))])}
{sec(c, "Без даты", 3, [T("Собрать референсы для ролика", "")])}'''


def build():
    c = Ctx()
    add("P01", "Projects", "Список проектов с поиском", c, root(c, list_body(c), nav="tasks"), True)

    c = Ctx()
    body = f'''{back_bar(c, "", "Задачи", "C-T04-ByProject.dc.html")}
{screen_title(c, "Проекты")}
{empty(c, "folder", "Проектов пока нет", "Проект помогает собрать задачи по одной теме: работа, дом, учёба. Можно обойтись и без проектов.", "Создать проект", "C-P03-Create.dc.html")}'''
    add("P02", "Empty", "Проектов ещё нет", c, root(c, body, nav="tasks"), True)

    c = Ctx()
    inner = f'''{sheet_head(c, "Новый проект", "Отмена", "Создать", "C-P01-Projects.dc.html", "C-P04-Project.dc.html")}
    {title_field(c, "Ремонт на даче", label="Название")}
    <span class="lbl">Обязательно только название.</span>'''
    add("P03", "Create", "Создание проекта", c, frame(c, f'<div aria-hidden="true" style="position: absolute; inset: 0; opacity: .35">{root(c, list_body(c))}</div>' + scrim(c) + sheet(c, inner, c.kb_h, "Новый проект") + keyboard(c)), True)

    c = Ctx()
    add("P04", "Project", "Внутри проекта", c, root(c, project_body(c), nav="tasks", add_href="C-C07-AddInProject.dc.html"), True)

    c = Ctx()
    t = c.t
    opts = [("Без проекта", "", False), ("KINOMARK", "12 задач", True), ("Дом", "5 задач", False), ("Здоровье", "3 задачи", False), ("Учёба английского", "нет задач", False)]
    from s_date import option
    rows = "".join(option(c, n, sub, sel, "C-C08-More.dc.html") for n, sub, sel in opts)
    inner = f'''{sheet_head(c, "Проект", "Отмена", "Готово", "C-C08-More.dc.html", "C-C08-More.dc.html")}
    {field(c, "", "", "Найти проект", ic="search")}
    <div role="radiogroup" aria-label="Проект">{rows}</div>
    <a href="C-P03-Create.dc.html" class="tbtn">{icon("plus", 18)}Новый проект</a>'''
    under = f'<div aria-hidden="true" style="position: absolute; inset: 0; opacity: .35">{root(c, project_body(c))}</div>'
    add("P05", "PickProject", "Выбор проекта в задаче", c, frame(c, under + scrim(c) + sheet(c, inner, 0, "Проект", pad="8px 20px 34px")), True)

    c = Ctx()
    t = c.t
    rows = detail_rows(c, [("cal", "Когда сделать", "Сегодня, 19:00 · 1 ч", None, "#"), ("flag", "Выполнить до", "", None, "#"),
                           ("folder", "Проект", "", None, "C-P05-PickProject.dc.html")])
    body = f'''{back_bar(c, "", "Задачи", "C-T01-Tasks.dc.html", icon_btn(c, "more", "Ещё действия"))}
    <div style="display: flex; gap: 12px; align-items: flex-start">{check(c)}<h1 style="margin: 0; font-size: {c.s['main'] + 3}px; font-weight: 600; line-height: 1.25">Тренировка</h1></div>
    <div style="background: {t['surface']}; border-radius: 16px; overflow: hidden">{rows}</div>
    <span class="lbl">Задача без проекта видна в общем списке. Во входящие она не возвращается.</span>'''
    ov = toast(c, "Задача убрана из проекта «Здоровье»", "Отменить", "#", ic="folder")
    add("P06", "TaskProject", "Проект убран из задачи", c, root(c, body, nav="tasks", overlay=ov))

    c = Ctx()
    inner = f'''{sheet_head(c, "Переименовать", "Отмена", "Сохранить", "C-P04-Project.dc.html", "C-P04-Project.dc.html")}
    {title_field(c, "KINOMARK — студия", label="Название проекта")}'''
    add("P07", "Rename", "Переименование проекта", c, frame(c, f'<div aria-hidden="true" style="position: absolute; inset: 0; opacity: .35">{root(c, project_body(c))}</div>' + scrim(c) + sheet(c, inner, c.kb_h, "Переименовать") + keyboard(c)))

    c = Ctx()
    t, s = c.t, c.s
    inner = f'''<h2 style="margin: 0; font-size: {s['h2'] + 1}px">Удалить проект «Дом»?</h2>
    <p style="margin: 0; color: {t['text3']}">Удалится только проект. Его 5 задач останутся и будут без проекта — их можно найти в общем списке.</p>
    <p style="margin: 0; color: {t['text2']}; font-size: {s['small']}px">Чтобы удалить сами задачи, выберите их в списке отдельно.</p>
    <a href="C-P01-Projects.dc.html" class="btn" style="background: {t['red']}; color: {t['bg']}">Удалить проект</a>
    <a href="C-P04-Project.dc.html" class="btn2">Отмена</a>'''
    add("P08", "Delete", "Удаление проекта — последствия", c, frame(c, f'<div aria-hidden="true" style="position: absolute; inset: 0; opacity: .35">{root(c, project_body(c))}</div>' + scrim(c) + sheet(c, inner, 0, "Удалить проект", pad="8px 20px 34px", gap=12)), True)

    c = Ctx()
    m = menu(c, [("edit", "Переименовать", "C-P07-Rename.dc.html", None), ("trash", "Удалить проект", "C-P08-Delete.dc.html", "danger")], top=100, right=16, width=230)
    add("P09", "Menu", "Меню проекта", c, root(c, project_body(c), nav="tasks", overlay=m), True)

    L = Ctx(LIGHT)
    add("P10", "ProjectLight", "Светлая тема — внутри проекта", L, root(L, project_body(L), nav="tasks"))
