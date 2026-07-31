/* A bottom sheet for touch. On a phone the five inline row buttons leave a task
   title about 67px of width, so on narrow screens the row keeps only the
   checkbox and a single menu button, and everything else lives here — thumb
   height, full width, one-handed. */

import { h, icon } from '../dom.js';

let host = null;
let openInvoker = null;
let onKeydown = null;
/* The close animation clears the host 200ms later. If a sheet opens inside that
   window — naming a section, then adding a task to it — the stale timer wiped
   the new one out from under it. */
let closeTimer = null;

export function initSheet(node) {
  host = node;
}

/** Past this the sheet is going away; below it, it springs back. */
const DISMISS_PX = 90;
const DISMISS_VELOCITY = 0.5; // px per ms — a flick counts even if it is short

/**
 * The grip is a handle, not a decoration.
 *
 * It looked draggable and did nothing, which on a phone is worse than not
 * drawing it: the gesture everyone tries first failed silently. Dragging starts
 * on the grip or the header — never on the list — so a sheet full of buttons
 * still scrolls and taps normally.
 */
function makeDraggable(panel, scrim) {
  const handles = [panel.querySelector('.sheet__grip'), panel.querySelector('.sheet__head')];
  let startY = 0;
  let startAt = 0;
  let dy = 0;
  let dragging = false;

  const move = (event) => {
    if (!dragging) return;
    // Upward drag resists: the sheet is already as far up as it goes.
    const raw = event.clientY - startY;
    dy = raw < 0 ? raw / 4 : raw;
    panel.style.transform = `translate(-50%, ${dy}px)`;
    scrim.style.opacity = String(Math.max(0, 1 - dy / 320));
  };

  const end = (event) => {
    if (!dragging) return;
    dragging = false;
    panel.releasePointerCapture?.(event.pointerId);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    panel.style.transition = '';
    scrim.style.opacity = '';
    const velocity = dy / Math.max(1, performance.now() - startAt);
    // Either way the inline transform has to go: it would outrank the class
    // that slides the sheet out, and the exit would freeze mid-drag.
    panel.style.transform = '';
    if (dy > DISMISS_PX || velocity > DISMISS_VELOCITY) closeSheet();
  };

  for (const handle of handles) {
    if (!handle) continue;
    handle.style.touchAction = 'none';
    handle.addEventListener('pointerdown', (event) => {
      // Let a real control inside the header keep its click.
      if (event.target.closest('button, input, a')) return;
      dragging = true;
      startY = event.clientY;
      startAt = performance.now();
      dy = 0;
      panel.style.transition = 'none';
      panel.setPointerCapture?.(event.pointerId);
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
    });
  }
}

export function closeSheet() {
  if (!host || !host.firstChild) return;
  const panel = host.querySelector('.sheet');
  const scrim = host.querySelector('.sheet-scrim');
  if (panel) {
    panel.style.transform = '';
    panel.style.transition = '';
  }
  panel?.classList.add('sheet--out');
  scrim?.classList.remove('sheet-scrim--in');
  if (onKeydown) {
    document.removeEventListener('keydown', onKeydown, true);
    onKeydown = null;
  }
  const invoker = openInvoker;
  openInvoker = null;
  if (closeTimer) clearTimeout(closeTimer);
  closeTimer = setTimeout(() => {
    closeTimer = null;
    if (host) host.replaceChildren();
    document.body.classList.remove('has-sheet');
  }, 200);
  if (invoker && document.contains(invoker)) invoker.focus({ preventScroll: true });
}

export function isSheetOpen() {
  return Boolean(host && host.firstChild);
}

/**
 * items: [{ icon, label, hint, onClick, danger, disabled }]
 * `content` is any node to place above the items — used by the add-a-task form.
 */
export function openSheet({ title, subtitle, items = [], content = null, invoker = null, onOpen = null }) {
  if (!host) return;
  closeSheet();
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
  openInvoker = invoker || (document.activeElement instanceof HTMLElement ? document.activeElement : null);

  // `static: true` is read-only content, not an inactive control. Rendering it
  // as a disabled button dimmed it to 0.4 — the phone quest description landed
  // at 2.2:1 — and took it out of the tab ring, so the one thing the sheet
  // existed to say could be neither read comfortably nor reached by keyboard.
  const buttons = items.filter(Boolean).map((item) => h(item.static ? 'div' : 'button', item.static ? {
    class: 'sheet__item sheet__item--static',
  } : {
    type: 'button',
    class: `sheet__item ${item.danger ? 'sheet__item--danger' : ''}`.trim(),
    disabled: item.disabled || false,
    onClick: () => {
      closeSheet();
      // Let the sheet start closing before the list re-renders underneath it —
      // unless the action puts the caret in a field. iOS raises the software
      // keyboard only for a focus() inside the gesture's own task, and a rAF
      // callback is a separate one: Rename lit the field up and left you
      // tapping it again to get a keyboard.
      if (item.immediate) item.onClick();
      else requestAnimationFrame(() => item.onClick());
    },
  },
  h('span', { class: 'sheet__item-icon' }, icon(item.icon, { size: 19 })),
  h('span', { class: 'sheet__item-body' },
    h('span', { class: 'sheet__item-label' }, item.label),
    item.hint ? h('span', { class: 'sheet__item-hint' }, item.hint) : null)));

  const panel = h('div', {
    class: 'sheet',
    role: 'dialog',
    tabIndex: -1, // so it can hold focus when every item is disabled
    'aria-modal': 'true',
    'aria-label': title ? `Actions for ${title}` : 'Actions',
  },
  h('span', { class: 'sheet__grip', 'aria-hidden': 'true' }),
  // A div, not a <header>. HTML-AAM maps <header> to `banner` unless its
  // nearest sectioning ancestor is article/aside/main/nav/section — a div with
  // role=dialog is none of those, so this announced as a second page banner.
  h('div', { class: 'sheet__head' },
    h('h2', { class: 'sheet__title' }, title || 'Actions'),
    subtitle ? h('p', { class: 'sheet__subtitle' }, subtitle) : null),
  content ? h('div', { class: 'sheet__content' }, content) : null,
  buttons.length ? h('div', { class: 'sheet__items' }, ...buttons) : null,
  h('button', { type: 'button', class: 'sheet__cancel', onClick: () => closeSheet() }, content ? 'Done' : 'Cancel'));

  const scrim = h('div', { class: 'sheet-scrim', onClick: () => closeSheet() });

  makeDraggable(panel, scrim);

  host.replaceChildren(scrim, panel);
  document.body.classList.add('has-sheet');
  requestAnimationFrame(() => {
    scrim.classList.add('sheet-scrim--in');
    panel.classList.add('sheet--in');
  });
  if (onOpen) onOpen(panel);
  // The first *enabled* control, falling back to the panel. `buttons[0].focus()`
  // is a no-op on a disabled button, and the phone quest sheet's only item is
  // disabled until the quest is claimable — so focus stayed on the invoker
  // behind the scrim and Tab walked straight out of the trap into the app.
  else (buttons.find((b) => b.tagName === 'BUTTON' && !b.disabled) || panel.querySelector('.sheet__cancel') || panel)
    .focus({ preventScroll: true });

  // Modal semantics without <dialog>: trap the tab ring, swallow app shortcuts.
  onKeydown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeSheet();
      return;
    }
    // Only Tab is ours. Swallowing everything else stopped Enter from ever
    // reaching a form field inside the sheet.
    if (event.key !== 'Tab') return;
    const focusables = Array.from(panel.querySelectorAll('button:not([disabled]), input:not([disabled])'));
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  document.addEventListener('keydown', onKeydown, true);
}

/**
 * Publish how much of the viewport the software keyboard is eating.
 *
 * `dvh` is the viewport minus browser chrome and does not shrink when the iOS
 * keyboard opens, so a `bottom: 0` fixed panel stays pinned to the layout
 * bottom with the keyboard drawn over it. `visualViewport` is the only thing
 * that actually knows, and it is the one surface in this app that hosts a text
 * field at the bottom of a small screen.
 */
function trackKeyboard() {
  const vv = window.visualViewport;
  if (!vv) return;
  const sync = () => {
    const eaten = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    document.documentElement.style.setProperty('--kb-height', `${eaten}px`);
  };
  vv.addEventListener('resize', sync, { passive: true });
  vv.addEventListener('scroll', sync, { passive: true });
  sync();
}

if (typeof window !== 'undefined') trackKeyboard();
