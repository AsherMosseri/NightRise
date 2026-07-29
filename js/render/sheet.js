/* A bottom sheet for touch. On a phone the five inline row buttons leave a task
   title about 67px of width, so on narrow screens the row keeps only the
   checkbox and a single menu button, and everything else lives here — thumb
   height, full width, one-handed. */

import { h, icon } from '../dom.js';

let host = null;
let openInvoker = null;
let onKeydown = null;

export function initSheet(node) {
  host = node;
}

export function closeSheet() {
  if (!host || !host.firstChild) return;
  const panel = host.querySelector('.sheet');
  const scrim = host.querySelector('.sheet-scrim');
  panel?.classList.add('sheet--out');
  scrim?.classList.remove('sheet-scrim--in');
  if (onKeydown) {
    document.removeEventListener('keydown', onKeydown, true);
    onKeydown = null;
  }
  const invoker = openInvoker;
  openInvoker = null;
  setTimeout(() => {
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
  openInvoker = invoker || (document.activeElement instanceof HTMLElement ? document.activeElement : null);

  const buttons = items.filter(Boolean).map((item) => h('button', {
    type: 'button',
    class: `sheet__item ${item.danger ? 'sheet__item--danger' : ''}`.trim(),
    disabled: item.disabled || false,
    onClick: () => {
      closeSheet();
      // Let the sheet start closing before the list re-renders underneath it.
      requestAnimationFrame(() => item.onClick());
    },
  },
  h('span', { class: 'sheet__item-icon' }, icon(item.icon, { size: 19 })),
  h('span', { class: 'sheet__item-body' },
    h('span', { class: 'sheet__item-label' }, item.label),
    item.hint ? h('span', { class: 'sheet__item-hint' }, item.hint) : null)));

  const panel = h('div', {
    class: 'sheet',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': title ? `Actions for ${title}` : 'Actions',
  },
  h('span', { class: 'sheet__grip', 'aria-hidden': 'true' }),
  h('header', { class: 'sheet__head' },
    h('h2', { class: 'sheet__title' }, title || 'Actions'),
    subtitle ? h('p', { class: 'sheet__subtitle' }, subtitle) : null),
  content ? h('div', { class: 'sheet__content' }, content) : null,
  buttons.length ? h('div', { class: 'sheet__items' }, ...buttons) : null,
  h('button', { type: 'button', class: 'sheet__cancel', onClick: () => closeSheet() }, content ? 'Done' : 'Cancel'));

  const scrim = h('div', { class: 'sheet-scrim', onClick: () => closeSheet() });

  host.replaceChildren(scrim, panel);
  document.body.classList.add('has-sheet');
  requestAnimationFrame(() => {
    scrim.classList.add('sheet-scrim--in');
    panel.classList.add('sheet--in');
  });
  if (onOpen) onOpen(panel);
  else buttons[0]?.focus({ preventScroll: true });

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
