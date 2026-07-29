/* Toasts — the app's only notification surface. Announced politely for
   screen readers, with an optional single action (used by delete + undo). */

import { h, icon } from './dom.js';

let host = null;

export function initToasts(node) {
  host = node;
}

const DEFAULT_MS = 4200;

export function toast(message, options = {}) {
  if (!host) return () => {};
  const {
    tone = 'info', iconName = null, action = null, duration = DEFAULT_MS, detail = null,
  } = options;

  let timer = null;
  const node = h('div', { class: `toast toast--${tone}`, role: 'status' },
    iconName ? h('span', { class: 'toast__icon' }, icon(iconName, { size: 18 })) : null,
    h('div', { class: 'toast__body' },
      h('span', { class: 'toast__msg' }, message),
      detail ? h('span', { class: 'toast__detail' }, detail) : null),
    action ? h('button', {
      type: 'button',
      class: 'toast__action',
      onClick: () => {
        action.onClick();
        dismiss();
      },
    }, action.label) : null,
  );

  function dismiss() {
    if (timer) clearTimeout(timer);
    node.classList.add('toast--out');
    setTimeout(() => node.remove(), 220);
  }

  host.appendChild(node);
  requestAnimationFrame(() => node.classList.add('toast--in'));
  timer = setTimeout(dismiss, duration);
  return dismiss;
}

export function celebrate(message, detail) {
  return toast(message, { tone: 'win', iconName: 'star', detail, duration: 5200 });
}
