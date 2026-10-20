// Fix the page in place while a sheet is open, including iOS touch scrolling.
// The sheet keeps its own scroll; closing it restores the underlying page.
let locked = null;

function updateOffset() {
  document.body.style.setProperty("--dialog-scroll-top", `${-locked.y}px`);
}

export function syncModalScroll(root) {
  const open = !!root?.querySelector('.sheet[aria-modal="true"]');
  if (open && !locked) {
    locked = { x: window.scrollX, y: window.scrollY };
    const gutter = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.setProperty("--dialog-scrollbar-width", `${gutter}px`);
    updateOffset();
    document.documentElement.classList.add("dialog-open");
  } else if (!open && locked) {
    const previous = locked;
    locked = null;
    document.documentElement.classList.remove("dialog-open");
    document.body.style.removeProperty("--dialog-scroll-top");
    document.body.style.removeProperty("--dialog-scrollbar-width");
    window.scrollTo(previous.x, previous.y);
  }
}

export function pageScrollY() {
  return locked?.y ?? window.scrollY;
}

export function scrollPageTo(y) {
  if (locked) {
    locked.y = y;
    updateOffset();
  } else {
    window.scrollTo(0, y);
  }
}
