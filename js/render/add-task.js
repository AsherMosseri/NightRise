/* Adding a task, for someone who is tired.
 *
 * The old flow asked you to type `Floss #wind-down !2` — a syntax you have to
 * remember, at the hour when remembering things is the whole problem. This is
 * the same three decisions as taps: what, how long, where. The syntax still
 * works for anyone who wants it, but nothing in the UI asks for it.
 */

import { h, icon } from '../dom.js';
import { getState } from '../state.js';
import { addTask, addSection } from '../actions.js';
import { openSheet, closeSheet } from './sheet.js';
import {
  plural, formatMinutesShort, formatMinutesClock, roundMinutes, keypadPress,
} from '../util.js';

/**
 * Rounded, human durations. Most things you do at night land on one of these,
 * and picking one is a tap. But some things genuinely take thirty seconds and
 * some take seven, so "Other…" opens a number pad rather than pretending every
 * chore rounds to five.
 */
export const TIME_CHOICES = [0.5, 1, 2, 5, 10, 15, 30];
const DEFAULT_MINUTES = 5;

export function openAddTask({ sectionId = null, invoker = null } = {}) {
  const state = getState();
  const sections = state.template.order
    .map((id) => state.template.sections[id])
    .filter(Boolean);

  let minutes = DEFAULT_MINUTES;
  let target = sectionId && state.template.sections[sectionId] ? sectionId : sections[0]?.id || null;
  let added = 0;

  const input = h('input', {
    class: 'addsheet__input',
    type: 'text',
    placeholder: 'Wash the dishes',
    'aria-label': 'What needs doing?',
    autocomplete: 'off',
    autocapitalize: 'sentences',
    spellcheck: 'false',
    enterkeyhint: 'done',
  });

  const status = h('p', { class: 'addsheet__status', role: 'status', 'aria-live': 'polite' }, '');

  let custom = false;

  const timeRow = h('div', { class: 'chipset', role: 'group', 'aria-label': 'How long will it take?' });
  const customSlot = h('div', { class: 'addsheet__slot' });
  const pad = buildKeypad(minutes, (value) => {
    minutes = value;
    syncTime({ keepPad: true });
  });

  const syncTime = ({ keepPad = false } = {}) => {
    for (const [i, b] of timeButtons.entries()) {
      const on = !custom && TIME_CHOICES[i] === minutes;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    otherButton.classList.toggle('is-on', custom);
    otherButton.setAttribute('aria-pressed', custom ? 'true' : 'false');
    // Added and removed rather than hidden: hidden controls still answer the
    // sheet's tab trap, and focus would vanish into them.
    customSlot.replaceChildren(...(custom ? [pad.node] : []));
    if (custom && !keepPad) pad.set(minutes);
  };

  const timeButtons = TIME_CHOICES.map((value) => h('button', {
    type: 'button',
    class: `chip-toggle ${value === minutes ? 'is-on' : ''}`.trim(),
    'aria-pressed': value === minutes ? 'true' : 'false',
    onClick: () => {
      minutes = value;
      custom = false;
      syncTime();
      input.focus();
    },
  }, formatMinutesShort(value)));

  const otherButton = h('button', {
    type: 'button',
    class: 'chip-toggle',
    'aria-pressed': 'false',
    onClick: () => {
      custom = !custom;
      syncTime();
      if (!custom) input.focus();
    },
  }, 'Other…');

  timeRow.append(...timeButtons, otherButton);

  /* Where. With no sections yet this is a name to type, not a list to pick
     from: the app used to invent "Tonight" behind your back and tell you about
     it in a toast, which is a decision made for you about your own night. */
  const nameInput = h('input', {
    class: 'addsheet__input addsheet__input--section',
    type: 'text',
    placeholder: 'Tonight',
    'aria-label': 'Name this part of the night',
    autocomplete: 'off',
    autocapitalize: 'words',
    spellcheck: 'false',
  });

  const sectionSlot = h('div', { class: 'addsheet__slot' });
  const sectionLabel = h('p', { class: 'addsheet__label' }, 'Where?');

  const renderWhere = () => {
    const live = getState();
    const list = live.template.order.map((id) => live.template.sections[id]).filter(Boolean);
    if (!list.length) {
      sectionLabel.textContent = 'Call this part of the night…';
      sectionSlot.replaceChildren(nameInput);
      return;
    }
    if (list.length === 1) {
      sectionLabel.textContent = 'Where?';
      sectionSlot.replaceChildren(h('p', { class: 'addsheet__where' }, list[0].title));
      return;
    }
    sectionLabel.textContent = 'Where?';
    const row = h('div', { class: 'chipset', role: 'group', 'aria-label': 'Which part of the night?' });
    const buttons = list.map((section) => h('button', {
      type: 'button',
      class: `chip-toggle ${section.id === target ? 'is-on' : ''}`.trim(),
      'aria-pressed': section.id === target ? 'true' : 'false',
      onClick: () => {
        target = section.id;
        for (const [i, other] of buttons.entries()) {
          const on = list[i].id === target;
          other.classList.toggle('is-on', on);
          other.setAttribute('aria-pressed', on ? 'true' : 'false');
        }
        input.focus();
      },
    }, section.title));
    row.append(...buttons);
    sectionSlot.replaceChildren(row);
  };

  const submit = () => {
    const title = input.value.trim();
    if (!title) {
      input.focus();
      return;
    }
    if (!target) target = addSection(nameInput.value.trim() || 'Tonight').id;
    addTask(target, title, minutes);
    added += 1;
    input.value = '';
    // Stay open: adding three things in a row should not cost three trips.
    status.textContent = `${plural(added, 'task', 'tasks')} added. Another?`;
    renderWhere();
    input.focus();
  };

  for (const field of [input, nameInput]) {
    field.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        if (field === nameInput) input.focus();
        else submit();
      }
      event.stopPropagation();
    });
  }

  const content = h('div', { class: 'addsheet' },
    input,
    h('p', { class: 'addsheet__label' }, 'How long?'),
    timeRow,
    customSlot,
    sectionLabel,
    sectionSlot,
    h('button', { type: 'button', class: 'btn btn--primary addsheet__go', onClick: submit },
      icon('plus', { size: 16 }), 'Add it'),
    status);

  renderWhere();

  openSheet({
    title: 'Add a task',
    subtitle: 'Type it, tap how long, done.',
    content,
    invoker,
    onOpen: () => {
      // A phone keyboard should be up before you have to think about it.
      setTimeout(() => input.focus(), 60);
    },
  });
}

/* ------------------------------------------------------------------ keypad */

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0'];

/**
 * A number pad of our own rather than the phone's keyboard. The system keypad
 * is a spreadsheet tool: small keys, a caret to place, and it shoves the sheet
 * halfway off the screen. This is eleven big targets and a delete, and it costs
 * nothing at midnight.
 */
export function buildKeypad(initial, onChange) {
  let typed = String(initial);
  // The pad opens showing whatever was already chosen. The first key you press
  // should replace it, the way a calculator does — not append to it.
  let fresh = true;

  const value = h('span', { class: 'keypad__value' }, typed);
  const unit = h('span', { class: 'keypad__unit' }, 'min');
  const hint = h('span', { class: 'keypad__hint', role: 'status', 'aria-live': 'polite' },
    formatMinutesClock(initial));

  const commit = () => {
    const parsed = roundMinutes(typed === '' || typed === '.' ? 0 : typed) ?? 0;
    value.textContent = typed === '' ? '0' : typed;
    hint.textContent = formatMinutesClock(parsed);
    onChange(parsed);
  };

  const press = (key) => {
    if (fresh && key !== 'del') typed = '';
    fresh = false;
    typed = keypadPress(typed, key);
    commit();
  };

  const keyButtons = KEYS.map((key) => h('button', {
    type: 'button',
    class: `keypad__key ${key === '.' ? 'keypad__key--dot' : ''}`.trim(),
    'aria-label': key === '.' ? 'Decimal point' : key,
    onClick: () => press(key),
  }, key));

  const del = h('button', {
    type: 'button',
    class: 'keypad__key keypad__key--del',
    'aria-label': 'Delete a digit',
    onClick: () => press('del'),
  }, icon('back', { size: 18 }));

  const grid = h('div', { class: 'keypad__grid' }, ...keyButtons, del);

  const node = h('div', { class: 'keypad' },
    h('div', { class: 'keypad__display' }, value, unit, hint),
    grid);

  // A hardware keyboard should reach the same pad, not a second code path.
  node.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (/^[0-9]$/.test(event.key)) press(event.key);
    else if (event.key === '.') press('.');
    else if (event.key === 'Backspace') press('del');
    else return;
    event.preventDefault();
    event.stopPropagation();
  });

  return {
    node,
    set(next) {
      typed = String(next);
      fresh = true;
      commit();
    },
  };
}

/** Used by the empty state, where there is nowhere to put a task yet. */
export function openFirstTask() {
  openAddTask();
}

/* ----------------------------------------------------------- new section */

/**
 * Naming it up front, rather than dropping a row called "New section" into the
 * list and hoping you notice the rename box. You are the one who knows whether
 * this is Wind Down or Kitchen.
 */
export function openAddSection({ invoker = null, onCreated = null } = {}) {
  const input = h('input', {
    class: 'addsheet__input',
    type: 'text',
    placeholder: 'Wind Down',
    'aria-label': 'Name this section',
    autocomplete: 'off',
    autocapitalize: 'words',
    spellcheck: 'false',
    enterkeyhint: 'done',
  });

  const submit = () => {
    const section = addSection(input.value.trim() || 'Tonight');
    closeSheet();
    if (onCreated) onCreated(section);
  };

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
    }
    event.stopPropagation();
  });

  openSheet({
    title: 'New section',
    subtitle: 'A part of the night — Wind Down, Tidy Up, whatever suits.',
    content: h('div', { class: 'addsheet' },
      input,
      h('button', { type: 'button', class: 'btn btn--primary addsheet__go', onClick: submit },
        icon('plus', { size: 16 }), 'Create it')),
    invoker,
    onOpen: () => setTimeout(() => input.focus(), 60),
  });
}

export { closeSheet };
