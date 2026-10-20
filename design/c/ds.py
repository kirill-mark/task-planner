"""Система оформления Mark, концепция C: цвета, размеры и общие компоненты макетов.

Каждый экран собирается из функций этого модуля, поэтому одинаковые элементы
выглядят одинаково на всех макетах. Генератор пишет файлы .dc.html для холста.
"""
import html as _html

FONT = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif"

DARK = dict(
    name="dark", bg="#101316", surface="#191E23", raised="#20262C", text="#F3F5F7", text2="#A8B1BA",
    text3="#C9D0D6", disabled="#6B747C", green="#6ED6A0", green_text="#6ED6A0", on_green="#101316",
    green_soft="rgba(110,214,160,0.12)", yellow="#F2B861", yellow_soft="rgba(242,184,97,0.12)",
    red="#FF8F87", red_soft="rgba(255,143,135,0.12)", blue="#8DB4E0", blue_soft="rgba(141,180,224,0.14)",
    divider="rgba(255,255,255,0.07)", border="rgba(255,255,255,0.09)", outline="#30373D",
    card_border="rgba(110,214,160,0.28)", nav="#14181C", nav_border="rgba(255,255,255,0.07)",
    overlay="rgba(0,0,0,0.6)", field="#101316", check="#7D8790", handle="#30373D",
    kb="#2B2F33", key="#4A535B", key_text="#F3F5F7", toast="#E9EDF0", toast_text="#101316",
    logo_a="#8BE3B4", logo_b="#3FAF76", ghost=".35",
)
LIGHT = dict(
    name="light", bg="#F5F6F8", surface="#FFFFFF", raised="#EEF0F3", text="#18212B", text2="#5B6570",
    text3="#3A4652", disabled="#9AA3AB", green="#18794E", green_text="#18794E", on_green="#FFFFFF",
    green_soft="#E3F3EA", yellow="#8A5300", yellow_soft="#FDF1DE", red="#B42318", red_soft="#FDECEA",
    blue="#2F6DB5", blue_soft="#E4EEF9", divider="#EAEDF0", border="#DCE1E5", outline="#C9D0D6",
    card_border="rgba(24,121,78,0.30)", nav="#FFFFFF", nav_border="#E3E7EB", overlay="rgba(16,19,22,0.35)",
    field="#F5F6F8", check="#7A848E", handle="#DCE1E5", kb="#D1D4D9", key="#FFFFFF", key_text="#18212B",
    toast="#1F262C", toast_text="#F3F5F7", logo_a="#2E9A62", logo_b="#07563A", ghost=".5",
)

NORMAL = dict(scale="normal", base=16, small=13, tiny=11, h1=22, title=28, main=19, h2=17, event=20,
              check=22, pill=14, field=18, act=14, act_h=36, btn=16, btn_h=48, form_title=15, avatar=40,
              gap=16, row_pad=10, tab=11)
LARGE = dict(scale="large", base=21, small=17, tiny=13, h1=28, title=34, main=24, h2=21, event=25,
             check=28, pill=18, field=23, act=18, act_h=44, btn=21, btn_h=54, form_title=19, avatar=48,
             gap=18, row_pad=12, tab=12)

# Знак Mark: линия-буква M из утверждённой иконки (design/brand/mark-symbol-white.svg).
SYMBOL_PATH = "M 387.01,239.80 C 402.19,238.88 417.95,241.02 432.54,245.35 C 442.37,248.27 451.90,252.27 460.50,257.94 C 529.68,303.58 499.51,403.85 479.77,468.27 C 475.22,483.09 471.06,498.02 466.24,512.76 C 458.25,537.16 450.33,562.12 444.82,587.24 C 442.87,596.14 439.67,610.01 449.09,615.93 C 456.72,620.74 466.28,616.84 473.37,613.08 C 489.88,604.33 505.52,593.18 520.60,582.16 C 583.00,536.59 648.85,486.57 721.41,459.04 C 739.28,452.26 757.26,448.48 776.37,448.34 C 790.11,448.24 803.65,449.24 816.83,453.39 C 909.55,482.61 918.18,593.18 918.19,675.74 C 918.19,705.96 921.86,739.15 911.68,768.13 C 898.40,805.90 847.69,817.87 818.96,789.72 C 801.56,772.67 802.68,749.44 801.94,726.88 C 800.97,697.91 799.42,668.00 795.87,639.23 C 793.56,620.49 791.28,594.72 774.49,582.86 C 764.69,575.93 751.32,575.54 739.90,577.24 C 712.34,581.33 685.67,601.79 662.79,616.80 C 614.50,648.50 566.98,684.14 515.44,710.23 C 490.82,722.70 466.82,735.24 439.25,739.43 C 390.42,746.85 334.89,728.24 316.15,678.43 C 310.61,663.70 310.56,648.06 310.67,632.53 C 310.83,608.41 314.87,584.35 321.81,561.26 C 334.69,518.39 350.37,476.37 363.72,433.64 C 369.41,415.42 382.77,379.60 363.54,365.29 C 347.66,353.47 320.56,366.90 304.99,373.58 C 249.89,397.22 198.19,427.40 145.24,455.37 C 123.65,466.78 89.84,469.83 78.89,441.92 C 63.94,403.76 114.08,379.44 138.83,362.77 C 185.80,331.14 232.51,299.76 283.08,274.21 C 315.87,257.66 349.80,242.07 387.01,239.80 Z"
_uid = [0]


def esc(s):
    return _html.escape(str(s), quote=True)


class Ctx:
    """Тема, масштаб текста и размер экрана для одного макета."""

    def __init__(self, t=DARK, s=NORMAL, w=390, h=844):
        self.t, self.s, self.w, self.h = t, s, w, h

    @property
    def kb_h(self):
        return 291 if self.h >= 844 else 262


def symbol(c, height=22, color=None, label="Mark"):
    """Знак Mark. Без color — фирменный зелёный градиент текущей темы."""
    _uid[0] += 1
    gid = f"mk{_uid[0]}"
    w = round(height * 860 / 590)
    fill = color or f"url(#{gid})"
    defs = "" if color else (f'<defs><linearGradient id="{gid}" x1="0" y1="0" x2="1" y2="1">'
                             f'<stop offset="0" stop-color="{c.t["logo_a"]}"/><stop offset="1" stop-color="{c.t["logo_b"]}"/></linearGradient></defs>')
    role = f'role="img" aria-label="{esc(label)}"' if label else 'aria-hidden="true"'
    return f'<svg width="{w}" height="{height}" viewBox="70 230 860 590" {role} style="flex-shrink: 0; display: block">{defs}<path fill="{fill}" d="{SYMBOL_PATH}"/></svg>'


def app_icon(size=120, radius_ratio=0.2265):
    """Иконка приложения: зелёная плитка с белым знаком (design/brand/mark-icon.svg)."""
    _uid[0] += 1
    i = _uid[0]
    r = round(1024 * radius_ratio)
    return (f'<svg width="{size}" height="{size}" viewBox="0 0 1024 1024" role="img" aria-label="Иконка Mark" style="display: block; flex-shrink: 0">'
            f'<defs><linearGradient id="ib{i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#07563A"/><stop offset=".58" stop-color="#003B26"/><stop offset="1" stop-color="#003923"/></linearGradient>'
            f'<radialGradient id="il{i}" cx=".5" cy=".015" r=".64" gradientTransform="translate(0 -.004) scale(1 .74)"><stop offset="0" stop-color="#329A61"/><stop offset=".34" stop-color="#268453" stop-opacity=".85"/><stop offset=".72" stop-color="#147347" stop-opacity=".3"/><stop offset="1" stop-color="#147347" stop-opacity="0"/></radialGradient>'
            f'<clipPath id="ic{i}"><rect width="1024" height="1024" rx="{r}"/></clipPath></defs>'
            f'<g clip-path="url(#ic{i})"><rect width="1024" height="1024" fill="url(#ib{i})"/><rect width="1024" height="1024" fill="url(#il{i})"/>'
            f'<path fill="#FFFFFF" d="{SYMBOL_PATH}"/></g></svg>')


# ----------------------------------------------------------------- иконки --
_I = {
    "home": '<path d="M4 11 12 4l8 7v9H4z"/>',
    "list": '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1" fill="currentColor"/><circle cx="4.5" cy="12" r="1" fill="currentColor"/><circle cx="4.5" cy="18" r="1" fill="currentColor"/>',
    "cal": '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
    "spark": '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/>',
    "plus": '<path d="M12 5v14M5 12h14"/>',
    "bell": '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4"/>',
    "bell_off": '<path d="M6 16V11a6 6 0 0 1 9.5-4.9M18 11v5l2 2H8M10 21h4M4 4l16 16"/>',
    "more": '<circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none"/>',
    "back": '<path d="M15 5l-7 7 7 7"/>',
    "close": '<path d="M6 6l12 12M18 6 6 18"/>',
    "search": '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
    "filter": '<path d="M4 6h16M7 12h10M10 18h4"/>',
    "folder": '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
    "inbox": '<path d="M4 13l2.5-7h11L20 13v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path d="M4 13h5l1 2h4l1-2h5"/>',
    "clock": '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
    "flag": '<path d="M6 21V4M6 4h11l-2 4 2 4H6"/>',
    "alert": '<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17.2v.3"/>',
    "check": '<path d="m5 12 5 5 9-10"/>',
    "trash": '<path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13"/>',
    "edit": '<path d="M5 19h4L19 9l-4-4L5 15z"/>',
    "undo": '<path d="M9 7 4 12l5 5"/><path d="M4 12h10a6 6 0 0 1 0 12"/>',
    "cloud_off": '<path d="M7 18h10a4 4 0 0 0 1-7.9A6 6 0 0 0 7.2 8.4 4.5 4.5 0 0 0 7 18zM4 4l16 16"/>',
    "phone": '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/>',
    "send": '<path d="M5 12h12M12 6l6 6-6 6"/>',
    "mic": '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 11a6 6 0 0 0 12 0M12 17v4"/>',
    "chev": '<path d="m9 6 6 6-6 6"/>',
    "chev_down": '<path d="m6 9 6 6 6-6"/>',
    "repeat": '<path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3"/><path d="M18 3v4h-4M6 21v-4h4"/>',
    "layers": '<path d="m12 4 8 4-8 4-8-4z"/><path d="m4 12 8 4 8-4M4 16l8 4 8-4"/>',
    "text": '<path d="M5 7h14M5 12h14M5 17h9"/>',
    "user": '<circle cx="12" cy="8" r="4"/><path d="M4 20a8 8 0 0 1 16 0"/>',
    "lock": '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    "download": '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    "globe": '<circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4a12 12 0 0 1 0 16M12 4a12 12 0 0 0 0 16"/>',
    "moon": '<path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z"/>',
    "tg": '<path d="M20 5 3.5 11.5l5 1.8M20 5l-3 14-8.5-5.7M20 5 8.5 13.3V19l3-3.2"/>',
    "widget": '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="16" height="7" rx="1.5"/>',
    "out": '<path d="M14 5h4a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-4M10 16l-4-4 4-4M6 12h10"/>',
    "people": '<circle cx="9" cy="9" r="3"/><path d="M3 19a6 6 0 0 1 12 0M16 6a3 3 0 0 1 0 6M18 19a6 6 0 0 0-3-5.2"/>',
}


def icon(name, size=16, sw=1.8, label=None):
    a = f'role="img" aria-label="{esc(label)}"' if label else 'aria-hidden="true"'
    return (f'<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="{sw}" '
            f'stroke-linecap="round" stroke-linejoin="round" {a} style="flex-shrink: 0">{_I[name]}</svg>')


# -------------------------------------------------------- общие стили экрана --
def base_style(c):
    t, s = c.t, c.s
    return f"""body{{margin:0}}
a{{color:inherit;text-decoration:none}}
button{{font:inherit;color:inherit}}
.row{{display:flex;align-items:flex-start;gap:12px;padding:{s['row_pad']}px 0}}
.row + .row{{border-top:1px solid {t['divider']}}}
.chk{{width:{s['check']}px;height:{s['check']}px;border-radius:50%;border:1.5px solid {t['check']};flex-shrink:0;margin-top:1px;background:none;padding:0;display:flex;align-items:center;justify-content:center;box-sizing:border-box;color:{t['on_green']}}}
.chk.on{{background:{t['green']};border-color:{t['green']}}}
.meta{{font-size:{s['small']}px;color:{t['text2']};margin-top:2px;display:flex;flex-wrap:wrap;align-items:center;gap:0 6px}}
.lbl{{font-size:{s['small']}px;color:{t['text2']}}}
.cap{{min-height:{s['act_h']}px;padding:0 12px;border-radius:{s['act_h'] // 2}px;border:1px solid {t['outline']};background:none;color:{t['text3']};font-size:{s['act']}px;display:inline-flex;align-items:center;gap:6px;white-space:nowrap;box-sizing:border-box}}
.cap.sel{{border-color:{t['green']};color:{t['text']};background:{t['green_soft']}}}
.pill{{min-height:36px;padding:0 14px;border-radius:18px;background:{t['surface']};display:inline-flex;align-items:center;gap:6px;font-size:{s['pill']}px;color:{t['text3']};white-space:nowrap;box-sizing:border-box;border:1px solid transparent}}
.pill.sel{{background:{t['text']};color:{t['bg']}}}
.btn{{min-height:{s['btn_h']}px;border-radius:14px;background:{t['green']};color:{t['on_green']};font-size:{s['btn']}px;font-weight:600;display:flex;align-items:center;justify-content:center;gap:8px;border:0;box-sizing:border-box;padding:0 18px}}
.btn2{{min-height:44px;border-radius:14px;background:{t['surface']};border:1px solid {t['border']};color:{t['text']};font-size:{s['pill'] + 1}px;font-weight:500;display:flex;align-items:center;justify-content:center;gap:8px;box-sizing:border-box;padding:0 16px}}
.tbtn{{min-height:44px;display:inline-flex;align-items:center;gap:6px;color:{t['green_text']};font-size:{s['pill'] + 1}px;font-weight:500;background:none;border:0;padding:0}}
.danger{{color:{t['red']}}}
.card{{background:{t['surface']};border-radius:20px;padding:14px 16px}}
.field{{background:{t['field']};border:1px solid {t['border']};border-radius:12px;padding:11px 12px;font-size:{s['base']}px;color:{t['text']};display:flex;align-items:center;gap:10px;min-height:46px;box-sizing:border-box}}
.field.focus{{border-color:{t['green']}}}
.field.err{{border-color:{t['red']}}}
.flabel{{font-size:{s['small']}px;color:{t['text2']};font-weight:500}}
.sec{{font-size:{s['h2']}px;font-weight:600;margin:0}}
.tab{{display:flex;flex-direction:column;align-items:center;gap:3px;font-size:{s['tab']}px;color:{t['text2']};min-width:56px;padding-top:2px}}
.key{{background:{t['key']};border-radius:6px;height:42px;flex:1;color:{t['key_text']};display:flex;align-items:center;justify-content:center;font-size:20px;box-shadow:0 1px 0 rgba(0,0,0,0.25)}}
.caret{{display:inline-block;width:2px;height:1.1em;background:{t['green']};vertical-align:-0.18em;margin-left:1px;border-radius:1px}}
.li{{display:flex;align-items:center;gap:12px;min-height:52px;padding:0 16px;box-sizing:border-box}}
.li + .li{{border-top:1px solid {t['divider']}}}
.badge{{display:inline-flex;align-items:center;gap:4px;border-radius:7px;padding:1px 7px;font-size:{s['small']}px;font-weight:600;line-height:1.45}}
.sk{{background:{t['raised']};border-radius:8px}}"""


def page(title, c, body, extra_style=""):
    """Полный .dc.html одного экрана."""
    return f'''<!doctype html>
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
{base_style(c)}
{extra_style}
</style>
</helmet>
{body}
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{{"$preview":{{"width":{c.w},"height":{c.h}}}}}'>
class Component extends DCLogic {{
  renderVals() {{ return {{}}; }}
}}
</script>
</body>
</html>
'''


def root(c, inner, scroll_end=False, nav=None, add_href="#", overlay=""):
    """Экран: прокручиваемая область, нижняя панель и слои поверх."""
    t, s = c.t, c.s
    sc = "justify-content: flex-end;" if scroll_end else ""
    nav_html = bottom_nav(c, nav, add_href) if nav else ""
    return f'''<div style="width: {c.w}px; height: {c.h}px; box-sizing: border-box; background: {t['bg']}; color: {t['text']}; font-family: {FONT}; font-size: {s['base']}px; line-height: 1.4; display: flex; flex-direction: column; overflow: hidden; position: relative">
  <div style="flex: 1; min-height: 0; overflow: hidden; display: flex; flex-direction: column; {sc}">
  <div style="padding: 56px 20px 28px; display: flex; flex-direction: column; gap: {s['gap']}px; flex-shrink: 0">
{inner}
  </div>
  </div>
{nav_html}
{overlay}
</div>'''


def bottom_nav(c, active, add_href="#"):
    t = c.t
    items = [("home", "Главная", "home", "C-H01-Home.dc.html"), ("tasks", "Задачи", "list", "C-T01-Tasks.dc.html"), None,
             ("cal", "Календарь", "cal", "C-K01-Week.dc.html"), ("asst", "Помощник", "spark", "C-A01-Start.dc.html")]
    out = []
    for it in items:
        if it is None:
            out.append(f'<a href="{add_href}" aria-label="Добавить задачу" style="width: 52px; height: 52px; border-radius: 26px; background: {t["green"]}; color: {t["on_green"]}; display: flex; align-items: center; justify-content: center; margin-top: -6px">{icon("plus", 24, 2.2)}</a>')
            continue
        key, label, ic, href = it
        cur = ' aria-current="page"' if key == active else ""
        col = f' style="color: {t["green_text"]}"' if key == active else ""
        out.append(f'<a href="{href}" class="tab"{col}{cur}>{icon(ic, 24)}{label}</a>')
    return f'''  <nav aria-label="Разделы" style="height: 84px; flex-shrink: 0; background: {t['nav']}; display: flex; align-items: flex-start; justify-content: space-around; padding-top: 8px; box-sizing: border-box; border-top: 1px solid {t['nav_border']}">
    {"".join(out)}
  </nav>'''


# ------------------------------------------------------------ сроки и даты --
def when(c, planned=None, deadline=None, deadline_state="future", extra=()):
    """Подпись задачи по единому правилу сроков.

    planned — «Когда сделать» (нейтрально); deadline — «Выполнить до»;
    deadline_state: future (нейтрально), today (жёлтый + «Срок сегодня»),
    overdue (красный + «Просрочено»). Цвет всегда дублируется словами.
    """
    t = c.t
    parts = []
    if deadline and deadline_state == "overdue":
        parts.append(f'<span class="badge" style="color: {t["red"]}; background: {t["red_soft"]}">{icon("alert", 13, 2)}Просрочено</span><span>срок {esc(deadline)}</span>')
    elif deadline and deadline_state == "today":
        parts.append(f'<span class="badge" style="color: {t["yellow"]}; background: {t["yellow_soft"]}">{icon("flag", 13, 2)}Срок сегодня</span><span>{esc(deadline)}</span>')
    if planned:
        parts.insert(0, f'<span style="color: {t["text3"]}">{esc(planned)}</span>')
    if deadline and deadline_state == "future":
        parts.append(f'<span>до {esc(deadline)}</span>')
    parts += [f'<span>{esc(e)}</span>' for e in extra if e]
    return "<span>·</span>".join(parts)


def check(c, done=False, label="Отметить выполненной"):
    if done:
        return f'<button type="button" class="chk on" aria-label="Вернуть в работу">{icon("check", 14, 3)}</button>'
    return f'<button type="button" class="chk" aria-label="{esc(label)}"></button>'


def task_row(c, title, meta="", done=False, href=None, trailing="", important=False):
    t = c.t
    ttl = f'<div style="color: {t["text2"]}; text-decoration: line-through">{esc(title)}</div>' if done else f'<div>{esc(title)}</div>'
    if important and not done:
        ttl = f'<div style="display: flex; gap: 6px; align-items: baseline"><span>{esc(title)}</span><span class="badge" style="color: {t["text3"]}; background: {t["raised"]}; font-weight: 500">Важно</span></div>'
    m = f'<div class="meta">{meta}</div>' if meta else ""
    body = f'<div style="flex: 1; min-width: 0">{ttl}{m}</div>'
    if href:
        body = f'<a href="{href}" style="flex: 1; min-width: 0">{ttl}{m}</a>'
    return f'<div class="row">{check(c, done)}{body}{trailing}</div>'


# ------------------------------------------------------------ блоки главной --
def home_header(c, greeting="Доброе утро, Кирилл", date="Вторник, 20 октября"):
    t, s = c.t, c.s
    return f'''    <header style="display: flex; align-items: center; gap: 12px">
      {symbol(c, round(s['h1'] * 1.0))}
      <div style="display: flex; flex-direction: column; flex: 1; min-width: 0">
        <span class="lbl">{date}</span>
        <h1 style="margin: 0; font-size: {s['h1']}px; font-weight: 700; line-height: 1.25">{greeting}</h1>
      </div>
      <a href="C-O05-Account.dc.html" aria-label="Кабинет" style="width: {s['avatar']}px; height: {s['avatar']}px; flex-shrink: 0; border-radius: 50%; background: {t['raised']}; display: flex; align-items: center; justify-content: center; font-weight: 600">К</a>
    </header>'''


def main_card(c, title="Смета для Palmira Istra", meta=None, change_href="C-H03-PickMain.dc.html", href="C-E01-TaskView.dc.html", done=False):
    t, s = c.t, c.s
    meta = meta if meta is not None else when(c, None, "15:00", "today", ["KINOMARK"])
    ttl_style = f"color: {t['text2']}; text-decoration: line-through;" if done else ""
    return f'''    <section aria-label="Главная задача" style="background: {t['surface']}; border: 1px solid {t['card_border']}; border-radius: 20px; padding: 12px 16px 14px; display: flex; flex-direction: column; gap: 6px">
      <div style="display: flex; align-items: center; justify-content: space-between">
        <span style="font-size: {s['small']}px; font-weight: 600; color: {t['green_text']}">Главная задача</span>
        <a href="{change_href}" style="color: {t['text2']}; font-size: {s['small']}px; min-height: 44px; margin: -12px -4px; padding: 0 4px; display: flex; align-items: center">Сменить</a>
      </div>
      <div style="display: flex; gap: 12px; align-items: flex-start">
        {check(c, done).replace('class="chk', 'style="margin-top: 2px" class="chk')}
        <a href="{href}" style="display: flex; flex-direction: column; gap: 4px; min-width: 0">
          <span style="font-size: {s['main']}px; font-weight: 600; line-height: 1.3; {ttl_style}">{esc(title)}</span>
          <span class="meta" style="margin: 0">{meta}</span>
        </a>
      </div>
    </section>'''


def event_block(c, time="15:00", title="Встреча с заказчиком", sub="через 2 ч 10 мин · до 16:00"):
    s = c.s
    return f'''    <section aria-label="Ближайшая встреча" style="display: flex; flex-direction: column; gap: 4px; padding: 0 2px">
      <span class="lbl">Ближайшая встреча</span>
      <div style="display: flex; align-items: baseline; gap: 12px">
        <span style="font-size: {s['event']}px; font-weight: 700; font-variant-numeric: tabular-nums">{time}</span>
        <div style="display: flex; flex-direction: column; min-width: 0">
          <span style="font-weight: 500">{esc(title)}</span>
          <span class="meta" style="margin: 0">{sub}</span>
        </div>
      </div>
    </section>'''


def plan_head(c, done=1, total=5, discuss_href="C-A01-Start.dc.html"):
    t, s = c.t, c.s
    return f'''      <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap">
        <div style="display: flex; flex-direction: column">
          <h2 class="sec">План дня</h2>
          <span class="lbl">Выполнено {done} из {total}</span>
        </div>
        <a href="{discuss_href}" style="min-height: 36px; padding: 0 14px; border-radius: 18px; background: {t['surface']}; border: 1px solid {t['border']}; display: flex; align-items: center; gap: 6px; font-size: {s['pill']}px">{icon("spark")}Обсудить план</a>
      </div>'''


def chips_row(c, items):
    """Плашки-переходы: [(text, href, tone)] tone: None|yellow|red."""
    t = c.t
    out = []
    for text, href, tone in items:
        col = t["text3"] if not tone else t[tone]
        out.append(f'<a href="{href}" class="pill" style="color: {col}">{text}</a>')
    return f'    <nav aria-label="Другие задачи" style="display: flex; gap: 8px; flex-wrap: wrap">{"".join(out)}</nav>'


# -------------------------------------------------------- шапки и разделы --
def screen_title(c, title, right="", sub=""):
    s = c.s
    sub_html = f'<span class="lbl">{sub}</span>' if sub else ""
    return f'''    <header style="display: flex; align-items: center; justify-content: space-between; gap: 12px">
      <div style="display: flex; flex-direction: column; min-width: 0"><h1 style="margin: 0; font-size: {s['title']}px; font-weight: 700; line-height: 1.2">{title}</h1>{sub_html}</div>
      <div style="display: flex; gap: 4px; align-items: center">{right}</div>
    </header>'''


def icon_btn(c, name, label, href="#", size=22, color=None):
    t = c.t
    col = f"color: {color};" if color else ""
    return f'<a href="{href}" aria-label="{esc(label)}" style="width: 44px; height: 44px; border-radius: 22px; display: flex; align-items: center; justify-content: center; {col}">{icon(name, size)}</a>'


def back_bar(c, title="", back_label="Назад", back_href="#", right=""):
    s, t = c.s, c.t
    return f'''    <header style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: -8px -8px 0">
      <a href="{back_href}" style="min-height: 44px; display: flex; align-items: center; gap: 2px; color: {t['green_text']}; font-size: {s['base']}px; padding-right: 8px">{icon("back", 22)}{back_label}</a>
      <span style="font-weight: 600; font-size: {s['base']}px; flex: 1; text-align: center; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">{title}</span>
      <div style="display: flex; align-items: center; min-width: 60px; justify-content: flex-end">{right}</div>
    </header>'''


def filters(c, items, sel):
    out = []
    for name in items:
        cls = "pill sel" if name == sel else "pill"
        cur = ' aria-pressed="true"' if name == sel else ' aria-pressed="false"'
        out.append(f'<button type="button" class="{cls}"{cur}>{name}</button>')
    return f'    <div role="group" aria-label="Фильтр" style="display: flex; gap: 8px; flex-wrap: wrap">{"".join(out)}</div>'


def group_label(c, text, right=""):
    return f'<div style="display: flex; justify-content: space-between; align-items: baseline; margin-top: 4px"><span class="lbl" style="font-weight: 600">{text}</span>{right}</div>'


# -------------------------------------------------------- слои поверх экрана --
def scrim(c):
    return f'<div aria-hidden="true" style="position: absolute; inset: 0; background: {c.t["overlay"]}"></div>'


def ghost_home(c):
    """Приглушённая главная под всплывающей формой."""
    s, t = c.s, c.t
    return f'''<div aria-hidden="true" style="position: absolute; inset: 0; padding: 56px 20px 0; display: flex; flex-direction: column; gap: 16px; opacity: {t['ghost']}">
    <div style="display: flex; align-items: center; gap: 12px">{symbol(c, s['h1'], label=None)}<div style="display: flex; flex-direction: column"><span style="font-size: {s['small']}px; color: {t['text2']}">Вторник, 20 октября</span><span style="font-size: {s['h1']}px; font-weight: 700">Доброе утро, Кирилл</span></div></div>
  </div>'''


def sheet(c, inner, bottom=0, label="Окно", gap=12, pad="8px 20px 16px", handle=True, max_h=None):
    t = c.t
    h = f'<div aria-hidden="true" style="width: 36px; height: 5px; border-radius: 3px; background: {t["handle"]}; align-self: center; flex-shrink: 0"></div>' if handle else ""
    mh = f"max-height: {max_h}px; overflow: hidden;" if max_h else ""
    return f'''<section role="dialog" aria-label="{esc(label)}" style="position: absolute; left: 0; right: 0; bottom: {bottom}px; background: {t['surface']}; border-radius: 20px 20px 0 0; padding: {pad}; display: flex; flex-direction: column; gap: {gap}px; {mh} box-sizing: border-box">
    {h}
    {inner}
  </section>'''


def sheet_head(c, title, left="Отмена", right="", left_href="#", right_href="#", right_disabled=False):
    t, s = c.t, c.s
    r = ""
    if right:
        col = t["disabled"] if right_disabled else t["green_text"]
        dis = ' aria-disabled="true"' if right_disabled else ""
        r = f'<a href="{right_href}"{dis} style="min-height: 44px; display: flex; align-items: center; color: {col}; font-weight: 600">{right}</a>'
    l = f'<a href="{left_href}" style="min-height: 44px; display: flex; align-items: center; color: {t["text3"]}">{left}</a>' if left else "<span></span>"
    return f'''<div style="display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 8px; margin-top: -6px">
      <div style="justify-self: start">{l}</div><h2 style="margin: 0; font-size: {s['base'] + 1}px; font-weight: 600; text-align: center">{title}</h2><div style="justify-self: end">{r}</div>
    </div>'''


def keyboard(c):
    t = c.t
    rows = ["йцукенгшщзх", "фывапролджэ", "ячсмитьбю"]
    compact = c.h < 844
    kh, fs = (40, 19) if compact else (42, 20)
    r = "".join('<div style="display: flex; gap: 5px">' + "".join(f'<span class="key" style="height: {kh}px; font-size: {fs}px">{ch}</span>' for ch in row) + "</div>" for row in rows)
    return f'''<div aria-label="Клавиатура телефона (для масштаба)" style="position: absolute; left: 0; right: 0; bottom: 0; height: {c.kb_h}px; background: {t['kb']}; padding: 10px 4px 0; box-sizing: border-box; display: flex; flex-direction: column; gap: 10px">
    {r}
    <div style="display: flex; gap: 5px"><span class="key" style="flex: 4; font-size: 15px; height: {kh}px">пробел</span><span class="key" style="flex: 1.6; font-size: 15px; height: {kh}px">Готово</span></div>
  </div>'''


def toast(c, text, action="", action_href="#", tone=None, bottom=96, ic=None):
    t = c.t
    a = f'<a href="{action_href}" style="font-weight: 600; color: {t["toast_text"]}; min-height: 44px; display: flex; align-items: center; padding: 0 4px; text-decoration: underline; text-underline-offset: 3px">{action}</a>' if action else ""
    i = icon(ic, 18) if ic else ""
    return f'''<div role="status" style="position: absolute; left: 16px; right: 16px; bottom: {bottom}px; background: {t['toast']}; color: {t['toast_text']}; border-radius: 14px; padding: 4px 12px 4px 16px; min-height: 52px; display: flex; align-items: center; gap: 10px; box-sizing: border-box; font-size: {c.s['pill'] + 1}px">
    {i}<span style="flex: 1">{text}</span>{a}
  </div>'''


def banner(c, text, tone="neutral", ic="cloud_off", action="", action_href="#", sub=""):
    t = c.t
    col = {"neutral": t["text3"], "yellow": t["yellow"], "red": t["red"], "blue": t["blue"]}[tone]
    bg = {"neutral": t["raised"], "yellow": t["yellow_soft"], "red": t["red_soft"], "blue": t["blue_soft"]}[tone]
    a = f'<a href="{action_href}" style="font-weight: 600; color: {t["text"]}; min-height: 44px; display: flex; align-items: center; white-space: nowrap">{action}</a>' if action else ""
    sb = f'<span style="font-size: {c.s["small"]}px; color: {t["text2"]}">{sub}</span>' if sub else ""
    return f'''    <div role="status" style="background: {bg}; border-radius: 14px; padding: 6px 14px; display: flex; align-items: center; gap: 10px; min-height: 52px; box-sizing: border-box">
      <span style="color: {col}; display: flex">{icon(ic, 20)}</span><div style="flex: 1; display: flex; flex-direction: column; font-size: {c.s['pill'] + 1}px"><span>{text}</span>{sb}</div>{a}
    </div>'''


def field(c, label, value="", placeholder="", focus=False, err="", ic=None, right="", multiline=False, hint=""):
    t, s = c.t, c.s
    cls = "field focus" if focus else ("field err" if err else "field")
    v = esc(value) + ('<span class="caret" aria-hidden="true"></span>' if focus else "") if value else (f'<span style="color: {t["text2"]}">{esc(placeholder)}</span>' + ('<span class="caret" aria-hidden="true"></span>' if focus else ""))
    i = f'<span style="color: {t["text2"]}; display: flex">{icon(ic, 18)}</span>' if ic else ""
    e = f'<span style="font-size: {s["small"]}px; color: {t["red"]}; display: flex; gap: 6px; align-items: center">{icon("alert", 14, 2)}{err}</span>' if err else ""
    h = f'<span style="font-size: {s["small"]}px; color: {t["text2"]}">{hint}</span>' if hint else ""
    lab = f'<span class="flabel">{label}</span>' if label else ""
    align = "align-items: flex-start;" if multiline else ""
    return f'<label style="display: flex; flex-direction: column; gap: 6px">{lab}<span class="{cls}" style="{align}">{i}<span style="flex: 1; min-width: 0">{v}</span>{right}</span>{e}{h}</label>'


def setting_row(c, label, value="", ic=None, href="#", chevron=True, toggle=None, danger=False, sub=""):
    t, s = c.t, c.s
    i = f'<span style="color: {t["red"] if danger else t["text2"]}; display: flex">{icon(ic, 20)}</span>' if ic else ""
    v = f'<span style="color: {t["text2"]}; font-size: {s["pill"] + 1}px; text-align: right">{value}</span>' if value else ""
    ch = f'<span style="color: {t["text2"]}; display: flex">{icon("chev", 18)}</span>' if chevron and toggle is None else ""
    tg = ""
    if toggle is not None:
        on = toggle
        tg = f'<span role="switch" aria-checked="{str(on).lower()}" style="width: 51px; height: 31px; border-radius: 16px; background: {t["green"] if on else t["outline"]}; position: relative; flex-shrink: 0"><span style="position: absolute; top: 2px; {"right" if on else "left"}: 2px; width: 27px; height: 27px; border-radius: 50%; background: #FFFFFF"></span></span>'
    lc = f"color: {t['red']};" if danger else ""
    sb = f'<span style="font-size: {s["small"]}px; color: {t["text2"]}">{sub}</span>' if sub else ""
    return f'<a href="{href}" class="li" style="{lc}">{i}<span style="flex: 1; display: flex; flex-direction: column; padding: 10px 0">{label}{sb}</span>{v}{ch}{tg}</a>'


def group(c, rows, title=""):
    t, s = c.t, c.s
    tl = f'<span class="lbl" style="font-weight: 600; padding: 0 4px">{title}</span>' if title else ""
    return f'<div style="display: flex; flex-direction: column; gap: 6px">{tl}<div style="background: {t["surface"]}; border-radius: 16px; overflow: hidden">{"".join(rows)}</div></div>'


def empty(c, ic, title, text, action="", action_href="#"):
    t, s = c.t, c.s
    a = f'<a href="{action_href}" class="btn2" style="align-self: center">{action}</a>' if action else ""
    return f'''    <div style="display: flex; flex-direction: column; align-items: center; text-align: center; gap: 10px; padding: 36px 12px">
      <span style="width: 56px; height: 56px; border-radius: 28px; background: {t['raised']}; color: {t['text2']}; display: flex; align-items: center; justify-content: center">{icon(ic, 26)}</span>
      <h2 style="margin: 0; font-size: {s['h2']}px; font-weight: 600">{title}</h2>
      <p style="margin: 0; color: {t['text2']}; font-size: {s['pill'] + 1}px; max-width: 300px">{text}</p>
      {a}
    </div>'''


def menu(c, items, top=None, right=16, bottom=None, width=240):
    """Всплывающее меню: [(icon, text, href, state)] state: None|sel|danger|disabled."""
    t, s = c.t, c.s
    pos = f"top: {top}px;" if top is not None else f"bottom: {bottom}px;"
    rows = []
    for ic, text, href, st in items:
        col = t["red"] if st == "danger" else (t["disabled"] if st == "disabled" else t["text"])
        mark = f'<span style="color: {t["green_text"]}; display: flex">{icon("check", 18, 2.2)}</span>' if st == "sel" else ""
        dis = ' aria-disabled="true"' if st == "disabled" else ""
        i = f'<span style="display: flex; color: {col}">{icon(ic, 18)}</span>' if ic else ""
        rows.append(f'<a href="{href}"{dis} class="li" style="color: {col}; min-height: 48px">{i}<span style="flex: 1">{text}</span>{mark}</a>')
    return f'<div role="menu" style="position: absolute; {pos} right: {right}px; width: {width}px; background: {t["surface"]}; border: 1px solid {t["border"]}; border-radius: 14px; overflow: hidden; box-shadow: 0 12px 32px rgba(0,0,0,0.28)">{"".join(rows)}</div>'


def caps(c, items):
    """Капсулы действий формы: [(icon, text, selected)]."""
    out = []
    for ic, text, sel in items:
        cls = "cap sel" if sel else "cap"
        out.append(f'<a href="#" class="{cls}">{icon(ic) if ic else ""}{text}</a>')
    return f'<div style="display: flex; gap: 6px; flex-wrap: wrap">{"".join(out)}</div>'


def title_field(c, text, placeholder="Что нужно сделать?", label="Новая задача", focus=True, max_lines=None, err=""):
    t, s = c.t, c.s
    lead, _, last = text.rpartition(" ")
    lead = lead + " " if lead else ""
    caret = '<span class="caret" aria-hidden="true"></span>' if focus else ""
    content = (f'{esc(lead)}<span style="white-space: nowrap">{esc(last)}{caret}</span>' if text
               else f'<span style="color: {t["text2"]}">{placeholder}</span>{caret}')
    border = t["green"] if focus else (t["red"] if err else t["border"])
    clamp = ""
    if max_lines:
        clamp = f"max-height: {round(s['field'] * 1.35 * max_lines)}px; overflow: hidden; position: relative;"
    fade = ""
    if max_lines:
        fade = f'<span aria-hidden="true" style="position: absolute; right: 6px; top: 8px; bottom: 8px; width: 3px; border-radius: 2px; background: {t["outline"]}"></span>'
    e = f'<span style="font-size: {s["small"]}px; color: {t["red"]}">{err}</span>' if err else ""
    return f'''<div style="display: flex; flex-direction: column; gap: 6px">
      <span id="nt-label" style="font-size: {s['form_title']}px; font-weight: 600">{label}</span>
      <div style="position: relative; background: {t['field']}; border: 1px solid {border}; border-radius: 12px; padding: 10px 14px 10px 12px">
        <div role="textbox" aria-multiline="true" aria-labelledby="nt-label" contenteditable="true" style="font-size: {s['field']}px; line-height: 1.35; color: {t['text']}; outline: none; {clamp}">{content}</div>{fade}
      </div>{e}
    </div>'''
