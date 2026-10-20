"""Выгружает для вёрстки: tokens.json (цвета и размеры) и icons/*.svg (набор иконок)."""
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
import ds

HERE = os.path.dirname(__file__)
tokens = {"color": {"dark": {k: v for k, v in ds.DARK.items() if k not in ("name", "ghost")},
                    "light": {k: v for k, v in ds.LIGHT.items() if k not in ("name", "ghost")}},
          "size": {"normal": {k: v for k, v in ds.NORMAL.items() if k != "scale"},
                   "large": {k: v for k, v in ds.LARGE.items() if k != "scale"}},
          "radius": {"card": 20, "group": 16, "button": 14, "field": 12, "badge": 7, "capsule": "height / 2", "check": "circle", "fab": "circle"},
          "space": {"screen_x": 20, "screen_top": 56, "block_gap": 16, "row_y": 10, "scroll_end": 28, "touch_min": 44},
          "font": ds.FONT}
json.dump(tokens, open(os.path.join(HERE, "tokens.json"), "w"), ensure_ascii=False, indent=2)
os.makedirs(os.path.join(HERE, "icons"), exist_ok=True)
for name, body in ds._I.items():
    open(os.path.join(HERE, "icons", f"{name}.svg"), "w").write(
        f'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">{body}</svg>\n')
open(os.path.join(HERE, "icons", "mark-symbol.svg"), "w").write(
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="70 230 860 590"><path fill="currentColor" d="{ds.SYMBOL_PATH}"/></svg>\n')
print(len(ds._I) + 1, "иконок")

# Таблица цветов и размеров для docs/design-c/tokens.md
COLOR_USE = {
    "bg": "Фон экрана", "surface": "Карточки, листы, группы", "raised": "Плашки, аватар, заглушки загрузки",
    "text": "Основной текст", "text2": "Вторичный текст, подписи", "text3": "Спокойные кнопки и значения",
    "disabled": "Недоступное", "green": "Акцент: «+», «Добавить», выбор, фокус", "green_text": "Зелёный текст",
    "on_green": "Текст на зелёном", "green_soft": "Фон выбранной капсулы", "yellow": "Срок сегодня",
    "yellow_soft": "Фон метки «Срок сегодня»", "red": "Просрочено, удаление, ошибки", "red_soft": "Фон метки «Просрочено»",
    "blue": "Встречи в календаре", "blue_soft": "Фон встречи", "divider": "Разделители строк",
    "border": "Границы полей и групп", "outline": "Контур капсул", "card_border": "Рамка главной задачи",
    "nav": "Нижняя панель", "nav_border": "Граница над панелью", "overlay": "Затемнение под листом",
    "field": "Фон поля ввода", "check": "Контур отметки", "handle": "Ручка листа", "kb": "Клавиатура (только в макетах)",
    "key": "Клавиши (только в макетах)", "key_text": "Текст клавиш (только в макетах)", "toast": "Всплывающее сообщение",
    "toast_text": "Текст сообщения", "logo_a": "Знак: начало градиента", "logo_b": "Знак: конец градиента",
}
SIZE_USE = {
    "base": "Основной текст", "small": "Подписи, метки", "tiny": "Мелкие подписи", "h1": "Приветствие",
    "title": "Заголовок раздела", "main": "Название главной задачи", "h2": "Подзаголовок", "event": "Время ближайшей встречи",
    "check": "Диаметр отметки", "pill": "Капсулы, плашки", "field": "Поле названия задачи", "act": "Текст капсул формы",
    "act_h": "Высота капсулы формы", "btn": "Текст главной кнопки", "btn_h": "Высота главной кнопки",
    "form_title": "«Новая задача»", "avatar": "Аватар", "gap": "Между блоками главной", "row_pad": "Отступ строки задачи",
    "tab": "Подписи нижней панели",
}
colors = "\n".join(f"| `{k}` | {COLOR_USE.get(k, '')} | `{tokens['color']['dark'][k]}` | `{tokens['color']['light'][k]}` |" for k in tokens["color"]["dark"])
sizes = "\n".join(f"| `{k}` | {SIZE_USE.get(k, '')} | {tokens['size']['normal'][k]} | {tokens['size']['large'][k]} |" for k in tokens["size"]["normal"])
tpl = open(os.path.join(HERE, "tokens.md.in")).read()
out = os.path.join(HERE, "..", "..", "docs", "design-c", "tokens.md")
os.makedirs(os.path.dirname(out), exist_ok=True)
open(out, "w").write(tpl.replace("{{COLORS}}", colors).replace("{{SIZES}}", sizes))
print("docs/design-c/tokens.md")

# Переходы прототипа: ссылки между экранами в собранных макетах
import re, html as _h
idx = json.load(open(os.path.join(HERE, "project", "canvas.json")))
titles = {f: b["title"] for f, b in idx["boards"].items()}
blocks = []
for f in idx["order"]:
    src = open(os.path.join(HERE, "project", f)).read()
    links = []
    for m in re.finditer(r'<a href="([^"]+\.dc\.html)"([^>]*)>(.*?)</a>', src, re.S):
        target, attrs, inner = m.groups()
        lab = re.search(r'aria-label="([^"]+)"', attrs)
        text = lab.group(1) if lab else re.sub(r"<[^>]+>", " ", inner)
        text = _h.unescape(" ".join(text.split()))[:60]
        row = f"- «{text}» → {titles.get(target, target)}"
        if text and row not in links:
            links.append(row)
    if links:
        blocks.append(f"**{titles[f]}**\n\n" + "\n".join(links))
tpl = open(os.path.join(HERE, "behavior.md.in")).read()
open(os.path.join(HERE, "..", "..", "docs", "design-c", "behavior.md"), "w").write(tpl.replace("{{LINKS}}", "\n\n".join(blocks)))
print("docs/design-c/behavior.md")
