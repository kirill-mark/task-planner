// Единый набор иконок: тонкая обводка, currentColor. У кнопки-иконки всегда
// есть aria-label рядом, сама иконка скрыта от экранного чтения.

const svg = (body, size = 20, width = 1.8) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icons = {
  home: (s) => svg('<path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z"/>', s),
  tasks: (s) => svg('<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1" fill="currentColor"/><circle cx="4.5" cy="12" r="1" fill="currentColor"/><circle cx="4.5" cy="18" r="1" fill="currentColor"/>', s),
  calendar: (s) => svg('<rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>', s),
  spark: (s) => svg('<path d="M12 3l1.8 4.6L18.5 9l-4.7 1.4L12 15l-1.8-4.6L5.5 9l4.7-1.4z"/><path d="M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z"/>', s),
  plus: (s = 20) => svg('<path d="M12 5v14M5 12h14"/>', s, 2.2),
  search: (s) => svg('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/>', s),
  check: (s = 14) => svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', s, 2.6),
  close: (s = 20) => svg('<path d="M6 6l12 12M18 6L6 18"/>', s, 2),
  left: (s = 18) => svg('<path d="M15 6l-6 6 6 6"/>', s, 2),
  right: (s = 18) => svg('<path d="M9 6l6 6-6 6"/>', s, 2),
  send: (s = 18) => svg('<path d="M5 12h14M13 6l6 6-6 6"/>', s, 2.2),
  edit: (s = 16) => svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>', s),
  trash: (s = 16) => svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>', s),
  alert: (s = 14) => svg('<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17.2v.3"/>', s, 2),
  flag: (s = 14) => svg('<path d="M6 21V4M6 4h11l-2 4 2 4H6"/>', s, 2),
  inbox: (s = 14) => svg('<path d="M4 13l2.5-7h11L20 13v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path d="M4 13h5l1 2h4l1-2h5"/>', s),
  more: (s = 18) => svg('<circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none"/>', s),
  folder: (s = 16) => svg('<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>', s),
  layers: (s = 20) => svg('<path d="m12 4 8 4-8 4-8-4z"/><path d="m4 12 8 4 8-4M4 16l8 4 8-4"/>', s),
  filter: (s = 18) => svg('<path d="M4 6h16M7 12h10M10 18h4"/>', s),
  clock: (s = 16) => svg('<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>', s),
  cal: (s = 16) => svg('<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>', s),
  sync: (s = 16) => svg('<path d="M20 11a8 8 0 0 0-14.3-4.3L4 9"/><path d="M4 4v5h5"/><path d="M4 13a8 8 0 0 0 14.3 4.3L20 15"/><path d="M20 20v-5h-5"/>', s),
};

// Знак Mark — линия-буква M из иконки приложения (design/brand). Цвет —
// фирменный градиент темы (--logo-a → --logo-b) или заданный цвет.
const SYMBOL = "M 387.01,239.80 C 402.19,238.88 417.95,241.02 432.54,245.35 C 442.37,248.27 451.90,252.27 460.50,257.94 C 529.68,303.58 499.51,403.85 479.77,468.27 C 475.22,483.09 471.06,498.02 466.24,512.76 C 458.25,537.16 450.33,562.12 444.82,587.24 C 442.87,596.14 439.67,610.01 449.09,615.93 C 456.72,620.74 466.28,616.84 473.37,613.08 C 489.88,604.33 505.52,593.18 520.60,582.16 C 583.00,536.59 648.85,486.57 721.41,459.04 C 739.28,452.26 757.26,448.48 776.37,448.34 C 790.11,448.24 803.65,449.24 816.83,453.39 C 909.55,482.61 918.18,593.18 918.19,675.74 C 918.19,705.96 921.86,739.15 911.68,768.13 C 898.40,805.90 847.69,817.87 818.96,789.72 C 801.56,772.67 802.68,749.44 801.94,726.88 C 800.97,697.91 799.42,668.00 795.87,639.23 C 793.56,620.49 791.28,594.72 774.49,582.86 C 764.69,575.93 751.32,575.54 739.90,577.24 C 712.34,581.33 685.67,601.79 662.79,616.80 C 614.50,648.50 566.98,684.14 515.44,710.23 C 490.82,722.70 466.82,735.24 439.25,739.43 C 390.42,746.85 334.89,728.24 316.15,678.43 C 310.61,663.70 310.56,648.06 310.67,632.53 C 310.83,608.41 314.87,584.35 321.81,561.26 C 334.69,518.39 350.37,476.37 363.72,433.64 C 369.41,415.42 382.77,379.60 363.54,365.29 C 347.66,353.47 320.56,366.90 304.99,373.58 C 249.89,397.22 198.19,427.40 145.24,455.37 C 123.65,466.78 89.84,469.83 78.89,441.92 C 63.94,403.76 114.08,379.44 138.83,362.77 C 185.80,331.14 232.51,299.76 283.08,274.21 C 315.87,257.66 349.80,242.07 387.01,239.80 Z";

export function markSymbol(height = 22, { color = null, label = "Mark" } = {}) {
  const width = Math.round(height * 860 / 590);
  const a11y = label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"';
  const defs = color ? "" : '<defs><linearGradient id="mark-symbol-fill" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--logo-a)"/><stop offset="1" style="stop-color:var(--logo-b)"/></linearGradient></defs>';
  return `<svg class="mark-symbol" width="${width}" height="${height}" viewBox="70 230 860 590" ${a11y}>${defs}<path fill="${color || "url(#mark-symbol-fill)"}" d="${SYMBOL}"/></svg>`;
}

// Небольшой абстрактный индикатор сводки — неподвижный, без бесконечного
// свечения (раздел 4 ТЗ).
export function blob(cls = "blob") {
  return `<svg class="${cls}" viewBox="0 0 76 76" aria-hidden="true">
    <defs><radialGradient id="mark-blob" cx="45%" cy="40%" r="60%">
      <stop offset="0%" stop-color="#B8F2D2"/><stop offset="55%" stop-color="#6ED6A0"/><stop offset="100%" stop-color="#1E5A3F"/>
    </radialGradient></defs>
    <path d="M38 6c11 0 17 7 22 14s11 13 9 24-11 21-24 25-24 0-30-9-7-20-3-30S27 6 38 6z" fill="url(#mark-blob)" opacity="0.9"/>
  </svg>`;
}
