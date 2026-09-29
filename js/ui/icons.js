// Единый набор иконок: тонкая обводка, currentColor. У кнопки-иконки всегда
// есть aria-label рядом, сама иконка скрыта от экранного чтения.

const svg = (body, size = 20, width = 1.8) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icons = {
  home: (s) => svg('<path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z"/>', s),
  tasks: (s) => svg('<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/>', s),
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
  sync: (s = 16) => svg('<path d="M20 11a8 8 0 0 0-14.3-4.3L4 9"/><path d="M4 4v5h5"/><path d="M4 13a8 8 0 0 0 14.3 4.3L20 15"/><path d="M20 20v-5h-5"/>', s),
};

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
