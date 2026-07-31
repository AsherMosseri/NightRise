/* Global keyboard shortcuts and the quick-add mini language.
   Row-level keys (space, e, delete, alt+arrows) live with the checklist. */

import { roundMinutes } from './util.js';

/** "7" / "7.5" / "90s" → minutes. Seconds are allowed because tasks are. */
export function minutesFromToken(value, unit) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return roundMinutes(/^s/i.test(unit || '') ? n / 60 : n);
}

/**
 * A section title reduced to something a `#hint` can match.
 *
 * Unicode-aware. Stripping everything outside [a-z0-9] meant a section called
 * "ערב" or "تنظيف" slugified to the empty string, so no hint could ever reach
 * it and two such sections were indistinguishable from each other. NFKD first,
 * so an accented Latin title still matches its unaccented spelling.
 */
export function slugify(str) {
  const slug = String(str)
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '');
  // A title made entirely of things that are neither letters nor numbers — "🌙"
  // — has no slug. Fall back to the raw text so it is at least distinct.
  return slug || String(str).toLowerCase().trim();
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

  // "Everything up to the next space", not `\w`. `#ערב`, `#تنظيف` and `#🌙` did
  // not parse as hints at all, so a literal hash was left sitting in the task's
  // name where a Latin `#wind-down` would have been stripped.
  rest = rest.replace(/(^|\s)#([^\s#!~]+)/gu, (_, space, hint) => {
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
  // N and / are the same key press — both land in quick add, which puts the
  // task in the first section unless the text carries a #hint. Saying "adds a
  // task to the first section" described a thing N does not do on its own.
  ['N or /', 'Jump to quick add'],
  ['S', 'Add a section'],
  ['→', 'In one-at-a-time: leave this one for later'],
  ['T', 'In one-at-a-time: start or pause the timer'],
  ['B', 'Open the Night Market'],
  ['G', 'Open the Star Map'],
  ['H', 'Open Night History'],
  ['I', 'Open insights'],
  [',', 'Open settings'],
  ['M', 'Mute or unmute sounds'],
  ['D', 'Toggle sleep-safe dim'],
  ['?', 'Show this list'],
  ['Space or ⏎', 'Check off the focused task'],
  ['E', 'Rename the focused task or section'],
  // Implemented since the first version and advertised by every row's own
  // aria-keyshortcuts, but never listed here.
  ['X', 'Rain-check the focused task'],
  ['Delete', 'Delete the focused task or section'],
  ['Alt + ↑ / ↓', 'Move the focused task or section'],
  ['↑ / ↓', 'Move between tasks'],
  ['Esc', 'Close a dialog or cancel an edit'],
];

export function isTypingTarget(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export function initKeys(handlers, { enabled = () => true } = {}) {
  window.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey) return;
    if (isTypingTarget(event.target)) return;
    // Escape is not a single-character shortcut and is never turned off — it is
    // the way out of every dialog in the app.
    if (event.key !== 'Escape' && !enabled()) return;
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
