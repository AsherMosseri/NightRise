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
import { toast } from '../toast.js';
import {
  plural, formatMinutesShort, formatMinutesClock, roundMinutes, stepMinutes,
} from '../util.js';

/**
 * Rounded, human durations. Most things you do at night land on one of these,
 * and picking one is a tap. But some things genuinely take thirty seconds and
 * some take seven minutes, so "Other" opens a stepper rather than pretending
 * every chore rounds to five.
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

  const readout = h('span', { class: 'stepper__readout', role: 'status', 'aria-live': 'polite' },
    formatMinutesClock(minutes));

  const customInput = h('input', {
    class: 'stepper__input',
    type: 'number',
    min: '0',
    max: '600',
    step: '0.5',
    inputMode: 'decimal',
    'aria-label': 'Minutes — 0.5 is thirty seconds',
    value: String(minutes),
  });

  const bump = (direction) => {
    minutes = stepMinutes(minutes, direction);
    customInput.value = String(minutes);
    readout.textContent = formatMinutesClock(minutes);
  };

  const customRow = h('div', { class: 'stepper' },
    h('button', {
      type: 'button', class: 'stepper__btn', 'aria-label': 'Less time', onClick: () => bump(-1),
    }, icon('minus', { size: 16 })),
    customInput,
    h('span', { class: 'stepper__unit' }, 'min'),
    h('button', {
      type: 'button', class: 'stepper__btn', 'aria-label': 'More time', onClick: () => bump(1),
    }, icon('plus', { size: 16 })),
    readout);

  customInput.addEventListener('input', () => {
    const next = roundMinutes(customInput.value);
    if (next !== null) minutes = next;
    readout.textContent = formatMinutesClock(minutes);
  });
  // Only tidy the field once they stop typing — rewriting it mid-keystroke
  // turns "7.5" into "7" under your thumb.
  customInput.addEventListener('blur', () => { customInput.value = String(minutes); });
  customInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); submit(); }
    event.stopPropagation();
  });

  const syncTime = () => {
    for (const [i, b] of timeButtons.entries()) {
      const on = !custom && TIME_CHOICES[i] === minutes;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    otherButton.classList.toggle('is-on', custom);
    otherButton.setAttribute('aria-pressed', custom ? 'true' : 'false');
    // Added and removed rather than hidden: a hidden input still answers the
    // sheet's tab trap, and focus would vanish into it.
    customSlot.replaceChildren(...(custom ? [customRow] : []));
  };

  const timeButtons = TIME_CHOICES.map((value) => h('button', {
    type: 'button',
    class: `chip-toggle ${value === minutes ? 'is-on' : ''}`.trim(),
    'aria-pressed': value === minutes ? 'true' : 'false',
    onClick: () => {
      minutes = value;
      custom = false;
      customInput.value = String(minutes);
      readout.textContent = formatMinutesClock(minutes);
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
      if (custom) customInput.focus();
      else input.focus();
    },
  }, 'Other…');

  timeRow.append(...timeButtons, otherButton);

  const sectionRow = h('div', { class: 'chipset', role: 'group', 'aria-label': 'Which part of the night?' });
  const sectionButtons = sections.map((section) => {
    const button = h('button', {
      type: 'button',
      class: `chip-toggle ${section.id === target ? 'is-on' : ''}`.trim(),
      'aria-pressed': section.id === target ? 'true' : 'false',
      onClick: () => {
        target = section.id;
        for (const [i, b] of sectionButtons.entries()) {
          const on = sections[i].id === target;
          b.classList.toggle('is-on', on);
          b.setAttribute('aria-pressed', on ? 'true' : 'false');
        }
        input.focus();
      },
    }, section.title);
    return button;
  });
  sectionRow.append(...sectionButtons);

  const submit = () => {
    const title = input.value.trim();
    if (!title) {
      input.focus();
      return;
    }
    if (!target) target = addSection('Tonight').id;
    addTask(target, title, minutes);
    added += 1;
    input.value = '';
    // Stay open: adding three things in a row should not cost three trips.
    status.textContent = `${plural(added, 'task', 'tasks')} added. Another?`;
    input.focus();
  };

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
    }
    event.stopPropagation();
  });

  const content = h('div', { class: 'addsheet' },
    input,
    h('p', { class: 'addsheet__label' }, 'How long?'),
    timeRow,
    customSlot,
    sections.length > 1 ? h('p', { class: 'addsheet__label' }, 'Where?') : null,
    sections.length > 1 ? sectionRow : null,
    h('button', { type: 'button', class: 'btn btn--primary addsheet__go', onClick: submit },
      icon('plus', { size: 16 }), 'Add it'),
    status);

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

/** Used by the empty state, where there is nowhere to put a task yet. */
export function openFirstTask() {
  if (!getState().template.order.length) {
    const section = addSection('Tonight');
    toast('Made you a section', { tone: 'info', iconName: 'plus', detail: 'Rename it whenever you like.' });
    openAddTask({ sectionId: section.id });
    return;
  }
  openAddTask();
}

export { closeSheet };
