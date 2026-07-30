/* Our own "are you sure" and "which of these", because the browser's are not.
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

/* -------------------------------------------------------------- the chooser */

let chooser = null;

function ensureChooser() {
  if (chooser) return chooser;
  chooser = h('dialog', { class: 'confirm confirm--wide' });
  document.body.appendChild(chooser);
  return chooser;
}

/**
 * Pick from a list of things. `options` is `[{ id, label, hint }]`.
 *
 * @returns {Promise<string[]|null>} the chosen ids, or null if they backed out.
 */
export function chooseAction({
  title,
  body = '',
  options = [],
  confirmLabel = 'Continue',
  cancelLabel = 'Cancel',
  danger = false,
  iconName = null,
} = {}) {
  const dialog = ensureChooser();

  return new Promise((resolve) => {
    let answered = false;
    const chosen = new Set();

    const finish = (value) => {
      if (answered) return;
      answered = true;
      resolve(value);
      if (dialog.open) dialog.close();
    };

    const go = h('button', {
      type: 'button',
      class: `btn ${danger ? 'btn--danger' : 'btn--primary'}`,
      disabled: true,
      onClick: () => finish([...chosen]),
    }, confirmLabel);

    const rows = options.map((option) => {
      const box = h('input', { type: 'checkbox' });
      box.addEventListener('change', () => {
        if (box.checked) chosen.add(option.id);
        else chosen.delete(option.id);
        // Nothing ticked is not a request, so there is nothing to confirm.
        go.disabled = chosen.size === 0;
      });
      return h('label', { class: 'picker__row' },
        box,
        h('span', { class: 'picker__mark', 'aria-hidden': 'true' }, icon('check', { size: 13 })),
        h('span', { class: 'picker__body' },
          h('span', { class: 'picker__label' }, option.label),
          option.hint ? h('span', { class: 'picker__hint' }, option.hint) : null));
    });

    dialog.className = `confirm confirm--wide ${danger ? 'confirm--danger' : ''}`.trim();
    dialog.replaceChildren(h('div', { class: 'confirm__inner' },
      iconName ? h('span', { class: 'confirm__icon' }, icon(iconName, { size: 22 })) : null,
      h('h2', { class: 'confirm__title' }, title),
      body ? h('p', { class: 'confirm__body' }, body) : null,
      h('div', { class: 'picker' }, ...rows),
      h('div', { class: 'confirm__actions' },
        h('button', { type: 'button', class: 'btn', onClick: () => finish(null) }, cancelLabel),
        go)));

    dialog.addEventListener('close', () => finish(null), { once: true });
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) finish(null);
    }, { once: true });

    dialog.showModal();
    rows[0]?.querySelector('input')?.focus({ preventScroll: true });
  });
}
