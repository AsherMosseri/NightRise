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
import { plural } from '../util.js';

/** Rounded, human durations — nobody estimates 7 minutes at midnight. */
export const TIME_CHOICES = [1, 2, 5, 10, 15, 30];
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

  const timeRow = h('div', { class: 'chipset', role: 'group', 'aria-label': 'How long will it take?' });
  const timeButtons = TIME_CHOICES.map((value) => {
    const button = h('button', {
      type: 'button',
      class: `chip-toggle ${value === minutes ? 'is-on' : ''}`.trim(),
      'aria-pressed': value === minutes ? 'true' : 'false',
      onClick: () => {
        minutes = value;
        for (const [i, b] of timeButtons.entries()) {
          const on = TIME_CHOICES[i] === minutes;
          b.classList.toggle('is-on', on);
          b.setAttribute('aria-pressed', on ? 'true' : 'false');
        }
        input.focus();
      },
    }, `${value}m`);
    return button;
  });
  timeRow.append(...timeButtons);

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
