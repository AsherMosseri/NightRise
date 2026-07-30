/* Global keyboard shortcuts and the quick-add mini language.
   Row-level keys (space, e, delete, alt+arrows) live with the checklist. */

import { roundMinutes } from './util.js';

/** "7" / "7.5" / "90s" → minutes. Seconds are allowed because tasks are. */
export function minutesFromToken(value, unit) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return roundMinutes(/^s/i.test(unit || '') ? n / 60 : n);
}

export function slugify(str) {
  return String(str).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * Parse "Brush teeth #wind-down !5" into its parts.
 * `#hint` picks a section (slug, prefix or substring match), `!n` sets minutes
 * (`!7.5` and `!30s` both work), and a trailing "5m" or "30 sec" works too.
 */
export function parseQuickAdd(text, sections = []) {
  let rest = String(text || '').trim();
  let minutes = null;
  let sectionHint = null;

  rest = rest.replace(/(^|\s)#([\w-]+)/g, (_, space, hint) => {
    sectionHint = hint;
    return space ? ' ' : '';
  });

  rest = rest.replace(/(^|\s)[!~](\d{1,3}(?:\.\d+)?)\s?(m|min|mins|minutes|s|sec|secs|seconds)?(?=\s|$)/gi, (whole, space, value, unit) => {
    const parsed = minutesFromToken(value, unit);
    if (parsed === null) return whole;
    minutes = parsed;
    return space ? ' ' : '';
  });

  if (minutes === null) {
    // A bare trailing "s" is deliberately not a unit here: "Sort the 90s
    // records" is a task, not a ninety-second one.
    const trailing = /(^|\s)(\d{1,3}(?:\.\d+)?)\s?(m|min|mins|minutes|sec|secs|seconds)$/i.exec(rest);
    if (trailing) {
      minutes = minutesFromToken(trailing[2], trailing[3]);
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
  ['F', 'One task at a time'],
  ['N', 'Add a task to the first section'],
  ['S', 'Add a section'],
  ['/', 'Jump to quick add'],
  ['→', 'In one-at-a-time: leave this one for later'],
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
    // Any modal surface owns the keyboard while it is up.
    if (document.querySelector('dialog[open], .sheet, .goodnight__panel') && event.key !== 'Escape') return;

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
      f: handlers.onFocusMode,
    };
    const fn = map[key] || (event.key === '?' ? handlers.onHelp : null);
    if (fn) {
      event.preventDefault();
      fn();
    }
  });
}
