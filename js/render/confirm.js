/* Our own "are you sure", because the browser's is not ours.
 *
 * `window.confirm` hands the moment to the operating system: a grey slab at the
 * top of the screen in a font we do not choose, with buttons labelled OK and
 * Cancel whatever the question was. It also blocks the whole page while it is
 * up. This asks the same question in the app's own voice, names the buttons
 * after the thing that will happen, and returns a promise.
 *
 * It is a real <dialog> opened with showModal(), so it stacks in the top layer
 * above the settings dialog that usually asks the question.
 */

import { h, icon } from '../dom.js';

let node = null;

function ensure() {
  if (node) return node;
  node = h('dialog', { class: 'confirm' });
  document.body.appendChild(node);
  return node;
}

/**
 * @returns {Promise<boolean>} true if they chose to go ahead.
 */
export function confirmAction({
  title,
  body = '',
  confirmLabel = 'Yes',
  cancelLabel = 'Cancel',
  danger = false,
  iconName = null,
} = {}) {
  const dialog = ensure();

  return new Promise((resolve) => {
    let answered = false;
    const finish = (value) => {
      if (answered) return;
      answered = true;
      resolve(value);
      if (dialog.open) dialog.close();
    };

    const confirmButton = h('button', {
      type: 'button',
      class: `btn ${danger ? 'btn--danger' : 'btn--primary'}`,
      onClick: () => finish(true),
    }, confirmLabel);

    dialog.className = `confirm ${danger ? 'confirm--danger' : ''}`.trim();
    dialog.replaceChildren(h('div', { class: 'confirm__inner' },
      iconName ? h('span', { class: 'confirm__icon' }, icon(iconName, { size: 22 })) : null,
      h('h2', { class: 'confirm__title' }, title),
      body ? h('p', { class: 'confirm__body' }, body) : null,
      h('div', { class: 'confirm__actions' },
        h('button', { type: 'button', class: 'btn', onClick: () => finish(false) }, cancelLabel),
        confirmButton)));

    // Escape, the backdrop, and anything else that closes it all mean no.
    dialog.addEventListener('close', () => finish(false), { once: true });
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) finish(false);
    }, { once: true });

    dialog.showModal();
    // The safe choice keeps the focus: a stray Enter should not erase anything.
    (danger ? dialog.querySelector('.btn:not(.btn--danger)') : confirmButton)
      ?.focus({ preventScroll: true });
  });
}
