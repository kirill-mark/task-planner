// Animate navigation, never a data refresh. Keep timing across innerHTML renders.
export function createMotion(root, onExit = () => {}) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const ease = 'cubic-bezier(.3, .65, .25, 1)';
  let previous = {}, records = new Map(), running = [], exits = [], hasShownPage = false;
  const clearExits = () => { exits.forEach(el => el.remove()); exits = []; };
  const stop = () => { running.forEach(a => a.cancel()); running = []; };
  const copy = el => {
    if (!el) return null;
    const clone = el.cloneNode(true);
    clone.inert = true; clone.setAttribute('aria-hidden', 'true');
    clone.removeAttribute('aria-modal'); clone.dataset.motionExit = '';
    for (const child of [clone, ...clone.querySelectorAll('*')]) {
      child.removeAttribute('id'); child.removeAttribute('autofocus');
      child.removeAttribute('data-action'); child.removeAttribute('data-key');
    }
    clone.style.pointerEvents = 'none';
    return clone;
  };
  const play = (el, frames, duration, elapsed = 0, complete) => {
    if (!el?.animate || elapsed >= duration) { complete?.(); return; }
    const a = el.animate(frames, { duration, easing: ease, fill: 'both' });
    a.currentTime = elapsed; running.push(a);
    a.onfinish = () => { a.cancel(); complete?.(); };
  };
  const enter = (id, el, frames, duration, changed) => {
    if (changed) records.set(id, { started: performance.now(), frames, duration });
    const record = records.get(id);
    if (!record) return;
    const elapsed = performance.now() - record.started;
    if (elapsed >= record.duration) { records.delete(id); return; }
    play(el, record.frames, record.duration, elapsed);
  };
  reduced.addEventListener('change', () => {
    if (reduced.matches) { stop(); clearExits(); records.clear(); onExit(); }
  });
  return {
    // Capture the departing sheet/screen before the caller replaces its DOM.
    before(next) {
      const changed = previous.route && previous.route !== next.route;
      const sheet = previous.editor && !next.editor ? root.querySelector('.sheet.task-editor') : null;
      const scrim = root.querySelector('.sheet-scrim');
      // A quick dismissal starts at the current visual position, without jumping open.
      const closing = sheet ? { sheet: copy(sheet), scrim: copy(scrim),
        scroll: sheet.scrollTop, transform: getComputedStyle(sheet).transform,
        opacity: scrim ? getComputedStyle(scrim).opacity : 1 } : null;
      const assistant = hasShownPage && changed && (previous.route === 'assistant' || next.route === 'assistant')
        ? copy(root.firstElementChild) : null;
      if (assistant) {
        assistant.classList.add('motion-screen-snapshot');
        if (previous.route !== 'assistant') {
          assistant.style.position = 'absolute'; assistant.style.top = `${-window.scrollY}px`;
        }
      }
      stop(); clearExits();
      return { next, changed, closing, assistant, from: previous.route };
    },
    after({ next, changed, closing, assistant, from }) {
      const page = root.querySelector('#main');
      const entering = !!page && !hasShownPage;
      if (page) hasShownPage = true;
      if (reduced.matches) { previous = next; records.clear(); return; }
      if (entering || changed) {
        // Only the first real screen reveals; navigation cancels any unfinished launch reveal.
        for (const id of records.keys()) if (id.startsWith('page:')) records.delete(id);
      }
      const blocks = [...(page?.children || [])].filter(el =>
        !el.matches('.mobile-account-bar, .assistant-panel') && getComputedStyle(el).display !== 'none');
      const reveal = [
        { opacity: 0, transform: 'translateY(10px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ];
      blocks.forEach((el, i) => {
        const id = `page:${i}`;
        // Stagger only the first three beats so long pages do not feel slow to load.
        if (entering) records.set(id, {
          started: performance.now() + Math.min(i, 2) * 80,
          frames: reveal, duration: 720,
        });
        enter(id, el, reveal, 720, false);
      });
      // The route reveal already animates the welcome. New chats still use its own greeting.
      if (entering || [...records.keys()].some(id => id.startsWith('page:'))) {
        root.querySelector('.assistant-welcome-enter')?.classList.remove('assistant-welcome-enter');
      }
      const returning = from === 'assistant' && changed;
      const fromX = next.route === 'assistant' ? '100%' : returning ? '-24px' : '36px';
      enter('navigation', next.route === 'assistant' ? root.querySelector('.assistant-shell') : page, [
        { transform: `translateX(${fromX})`, opacity: next.route === 'assistant' ? 1 : .35 },
        { transform: 'translateX(0)', opacity: 1 },
      ], next.route === 'assistant' ? 620 : returning ? 480 : 680, !!changed && !entering);
      if (assistant) {
        const layer = document.createElement('div'); layer.className = 'motion-screen-layer';
        layer.inert = true; layer.setAttribute('aria-hidden', 'true');
        layer.style.zIndex = returning ? '16' : '14';
        layer.append(assistant); document.body.append(layer); exits.push(layer);
        play(layer, returning ? [{ transform: 'translateX(0)' }, { transform: 'translateX(100%)' }]
          : [{ opacity: 1 }, { opacity: .65 }], 620, 0, () => layer.remove());
      }
      const sheet = root.querySelector('.sheet.task-editor');
      const narrow = window.matchMedia('(max-width: 767px)').matches;
      const base = sheet ? getComputedStyle(sheet).transform : 'none';
      enter('editor', sheet, [
        { transform: narrow ? 'translateY(100%)' : `${base === 'none' ? '' : base} translateY(20px)`, opacity: narrow ? 1 : .3 },
        { transform: base, opacity: 1 },
      ], 550, !!next.editor && next.editor !== previous.editor);
      enter('scrim', root.querySelector('.sheet-scrim'), [{ opacity: 0 }, { opacity: 1 }], 420,
        !!next.editor && !previous.editor);
      if (closing?.sheet) {
        // Keep the body scroll lock until the departing sheet is fully offscreen.
        closing.sheet.setAttribute('aria-modal', 'true');
        if (closing.scrim) { root.append(closing.scrim); exits.push(closing.scrim); }
        root.append(closing.sheet); exits.push(closing.sheet); closing.sheet.scrollTop = closing.scroll;
        const transform = closing.transform;
        play(closing.scrim, [{ opacity: closing.opacity }, { opacity: 0 }], 360);
        play(closing.sheet, [{ transform, opacity: 1 }, {
          transform: narrow ? 'translateY(100%)' : `${transform === 'none' ? '' : transform} translateY(18px)`,
          opacity: narrow ? 1 : 0,
        }], 420, 0, () => { clearExits(); onExit(); });
      }
      enter('panel', root.querySelector('.assistant-panel'), [
        { transform: 'translateX(48px)', opacity: 0 }, { transform: 'translateX(0)', opacity: 1 },
      ], 440, !!next.panel && next.panel !== previous.panel);
      enter('thread', root.querySelector('.assistant-transcript'), [
        { transform: 'translateX(24px)', opacity: 0 }, { transform: 'translateX(0)', opacity: 1 },
      ], 400, !changed && !!previous.thread && next.thread !== previous.thread);
      previous = next;
    },
  };
}
