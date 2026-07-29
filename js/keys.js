/* Global keyboard shortcuts and the quick-add mini language.
   Row-level keys (space, e, delete, alt+arrows) live with the checklist. */

export function slugify(str) {
  return String(str).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * Parse "Brush teeth #wind-down !5" into its parts.
 * `#hint` picks a section (slug, prefix or substring match), `!n` sets minutes,
 * and a trailing "5m" works too.
 */
export function parseQuickAdd(text, sections = []) {
  let rest = String(text || '').trim();
  let minutes = null;
  let sectionHint = null;

  rest = rest.replace(/(^|\s)#([\w-]+)/g, (_, space, hint) => {
    sectionHint = hint;
    return space ? ' ' : '';
  });

  rest = rest.replace(/(^|\s)[!~](\d{1,3})m?\b/g, (_, space, value) => {
    minutes = Number(value);
    return space ? ' ' : '';
  });

  if (minutes === null) {
    const trailing = /(^|\s)(\d{1,3})\s?(m|min|mins|minutes)$/i.exec(rest);
    if (trailing) {
      minutes = Number(trailing[2]);
      rest = rest.slice(0, trailing.index);
    }
  }

  const title = rest.replace(/\s+/g, ' ').trim();
  let sectionId = null;
  if (sectionHint) {
    const hint = slugify(sectionHint);
    const candidates = sections.map((s) => ({ id: s.id, slug: slugify(s.title) }));
    const match = candidates.find((c) => c.slug === hint)
      || candidates.find((c) => c.slug.startsWith(hint))
      || candidates.find((c) => c.slug.includes(hint));
    sectionId = match ? match.id : null;
  }

  return { title, minutes, sectionId, sectionHint };
}

export const SHORTCUTS = [
  ['N', 'Add a task to the first section'],
  ['S', 'Add a section'],
  ['/', 'Jump to quick add'],
  ['B', 'Open the Night Market'],
  ['G', 'Open the star map'],
  ['H', 'Open night history'],
  ['I', 'Open insights'],
  [',', 'Open settings'],
  ['M', 'Mute or unmute sounds'],
  ['D', 'Toggle sleep-safe dim'],
  ['?', 'Show this list'],
  ['Space', 'Check off the focused task'],
  ['E', 'Rename the focused task or section'],
  ['Delete', 'Delete the focused task or section'],
  ['Alt + ↑ / ↓', 'Move the focused task or section'],
  ['↑ / ↓', 'Move between tasks'],
  ['Esc', 'Close a dialog or cancel an edit'],
];

function isTypingTarget(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export function initKeys(handlers) {
  window.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey) return;
    if (isTypingTarget(event.target)) return;
    if (document.querySelector('dialog[open]') && event.key !== 'Escape') return;

    const key = event.key.toLowerCase();
    const map = {
      n: handlers.onNewTask,
      s: handlers.onNewSection,
      '/': handlers.onQuickAdd,
      b: handlers.onShop,
      g: handlers.onStarMap,
      h: handlers.onHistory,
      i: handlers.onInsights,
      ',': handlers.onSettings,
      m: handlers.onToggleMute,
      d: handlers.onToggleDim,
      '?': handlers.onHelp,
    };
    const fn = map[key] || (event.key === '?' ? handlers.onHelp : null);
    if (fn) {
      event.preventDefault();
      fn();
    }
  });
}
