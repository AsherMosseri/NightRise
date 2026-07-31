/* Toasts — the app's only notification surface. Announced politely for
   screen readers, with an optional single action (used by delete + undo). */

import { h, icon } from './dom.js';

let host = null;
let modalHost = null;

export function initToasts(node, inModal = null) {
  host = node;
  modalHost = inModal;
}

/**
 * A <dialog> opened with showModal() lives in the top layer, where no z-index
 * can reach it — toasts fired behind one were invisible and never announced.
 */
function activeHost() {
  const dialog = document.querySelector('dialog[open]');
  return dialog && modalHost && dialog.contains(modalHost) ? modalHost : host;
}

const DEFAULT_MS = 4200;

export function toast(message, options = {}) {
  const host = activeHost();
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

  // A burst of level-ups and badges could stack toasts over the whole screen
  // and swallow taps for several seconds. Oldest ones make way.
  const MAX_VISIBLE = 3;
  const live = host.querySelectorAll('.toast:not(.toast--out)');
  for (let i = 0; i <= live.length - MAX_VISIBLE; i += 1) {
    live[i].classList.add('toast--out');
    setTimeout(((n) => () => n.remove())(live[i]), 200);
  }

  host.appendChild(node);
  requestAnimationFrame(() => node.classList.add('toast--in'));
  // duration 0 means "stay until dismissed" — for the one message you must not
  // miss because you happened to be looking away for five seconds.
  if (duration > 0) timer = setTimeout(dismiss, duration);
  return dismiss;
}

export function celebrate(message, detail) {
  return toast(message, { tone: 'win', iconName: 'star', detail, duration: 5200 });
}
