"""Собирает холст «Mark — концепция C»: пишет project/*.dc.html и project/canvas.json.

Запуск: python3 design/c/build.py
Опубликовать холст: Artifact publish с root=design/c и file_path=project/canvas.json.
"""
import json, os, sys, datetime, importlib
sys.path.insert(0, os.path.dirname(__file__))


PAGES = [
    ("sys", "Система оформления", "s_system"),
    ("home", "Главная", "s_home"),
    ("create", "Создание и редактирование", "s_create"),
    ("date", "Дата и напоминание", "s_date"),
    ("tasks", "Задачи и входящие", "s_tasks"),
    ("projects", "Проекты", "s_projects"),
    ("calendar", "Календарь", "s_calendar"),
    ("assistant", "Помощник", "s_assistant"),
    ("other", "Вход, загрузка, кабинет", "s_other"),
]
PER_ROW = 6
OUT = os.path.join(os.path.dirname(__file__), "project")


def main():
    os.makedirs(OUT, exist_ok=True)
    idx_path = os.path.join(OUT, "canvas.json")
    created = None
    if os.path.exists(idx_path):
        created = json.load(open(idx_path)).get("createdOnFiles")
    boards, order, notes, pages = {}, [], {}, []
    for pid, pname, modname in PAGES:
        mod = importlib.import_module(modname)
        mod.SCREENS.clear()
        mod.build()
        pages.append({"id": pid, "name": pname})
        x = y = 0
        row_h = 0
        col = 0
        for sc in mod.SCREENS:
            w, h = sc.get("w", sc["c"].w), sc.get("h", sc["c"].h)
            if col == PER_ROW or sc.get("newrow"):
                x, col = 0, 0
                y += row_h + 160
                row_h = 0
            entry = {"x": x, "y": y, "w": w, "h": h, "title": sc["title"], "page": pid}
            if sc.get("interactive"):
                entry["is_interactive"] = True
            boards[sc["file"]] = entry
            order.append(sc["file"])
            open(os.path.join(OUT, sc["file"]), "w").write(sc["html"])
            x += w + 80
            col += 1
            row_h = max(row_h, h)
        notes[f"t_{pid}"] = {"x": 0, "y": -300, "text": pname, "kind": "title1", "maxW": 2400, "page": pid}
    # Удалить файлы экранов, которых больше нет
    for f in os.listdir(OUT):
        if f.endswith(".dc.html") and f not in boards:
            os.remove(os.path.join(OUT, f))
    idx = {"v": 3, "createdOnFiles": created or {"v": 1, "at": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")},
           "title": "Mark — концепция C", "launch": {"view": "canvas", "page": "home"}, "pages": pages,
           "boards": boards, "order": order, "notes": notes, "designSystems": []}
    json.dump(idx, open(idx_path, "w"), ensure_ascii=False, indent=1)
    print(len(boards), "экранов")


if __name__ == "__main__":
    only = sys.argv[1:]
    if only:
        PAGES[:] = [p for p in PAGES if p[0] in only]
    main()
