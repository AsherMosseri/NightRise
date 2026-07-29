/* One Card — the whole night as a single next thing.
 *
 * A twelve-row checklist at 11:40pm is twelve decisions, and decisions are what
 * this app loses to scrolling: a feed asks nothing of you. One card asks nothing
 * either. It is a prompt, not a menu — big target, no aiming, one hand.
 */

import { h, icon, iconButton } from '../dom.js';
import { getState } from '../state.js';
import { toggleTask, toggleSkip } from '../actions.js';
import { computeStats } from '../night.js';
import { plural } from '../util.js';
import { openSheet } from './sheet.js';
import { toast } from '../toast.js';
import { lightsOut } from './goodnight.js';

let host = null;
let active = false;
let deferred = new Set(); // "later" only reorders this sitting, never the list
let onExit = null;

export function initCards(node, { onClose } = {}) {
  host = node;
  onExit = onClose;
}

export function cardsActive() {
  return active;
}

/** Undone tasks in list order, with anything you pushed back at the end. */
function queue(state) {
  const front = [];
  const back = [];
  for (const sectionId of state.template.order) {
    const section = state.template.sections[sectionId];
    if (!section) continue;
    for (const taskId of section.taskIds) {
      const task = state.template.tasks[taskId];
      if (!task) continue;
      if (state.night.done[taskId] !== undefined || state.night.skipped[taskId]) continue;
      (deferred.has(taskId) ? back : front).push({ task, section });
    }
  }
  return [...front, ...back];
}

export function enterCards() {
  if (!host) return;
  active = true;
  deferred = new Set();
  document.documentElement.classList.add('is-cards');
  renderCards();
}

export function exitCards() {
  if (!active) return;
  active = false;
  deferred = new Set();
  document.documentElement.classList.remove('is-cards');
  if (host) host.replaceChildren();
  if (onExit) onExit();
}

function flash(node, text) {
  const bubble = h('span', { class: 'cards__flash' }, text);
  node.appendChild(bubble);
  setTimeout(() => bubble.remove(), 900);
}

function finishedCard(state, stats) {
  return h('div', { class: 'cards__done' },
    icon('check', { size: 40 }),
    h('h2', {}, stats.total === 0 ? 'Nothing on the list' : 'That’s everything.'),
    h('p', { class: 'muted' }, stats.total === 0
      ? 'Add something to tonight and come back.'
      : `${plural(stats.done, 'task', 'tasks')} done. Time to stop.`),
    h('div', { class: 'cards__done-actions' },
      state.night.lightsOutAt ? null : h('button', {
        type: 'button',
        class: 'btn btn--primary',
        onClick: () => { exitCards(); lightsOut(); },
      }, icon('moon', { size: 16 }), 'Lights out'),
      h('button', { type: 'button', class: 'btn', onClick: () => exitCards() }, 'Back to the list')));
}

export function renderCards() {
  if (!active || !host) return;
  const state = getState();
  const stats = computeStats(state);
  const pending = queue(state);
  const position = stats.done + stats.skipped + 1;

  const head = h('header', { class: 'cards__head' },
    h('span', { class: 'cards__count' }, pending.length
      ? `${Math.min(position, stats.total)} of ${stats.total}`
      : `${stats.done} of ${stats.total}`),
    h('div', { class: 'cards__bar', 'aria-hidden': 'true' },
      h('span', { style: { width: `${stats.pct}%` } })),
    iconButton('close', 'Leave one-at-a-time mode', () => exitCards(), { class: 'cards__exit' }));

  if (!pending.length) {
    host.replaceChildren(h('div', { class: 'cards__inner' }, head, finishedCard(state, stats)));
    return;
  }

  const { task, section } = pending[0];

  const check = h('button', {
    type: 'button',
    class: 'cards__check',
    onClick: () => {
      const result = toggleTask(task.id);
      if (result?.award) flash(check, `+${result.award.xp} XP`);
    },
  }, icon('check', { size: 30 }), h('span', {}, 'Done'));

  const body = h('div', { class: 'cards__body' },
    h('p', { class: 'cards__section' }, section.title),
    h('h2', { class: 'cards__title' }, task.title),
    h('p', { class: 'cards__minutes' }, plural(task.minutes, 'minute', 'minutes')));

  const row = h('div', { class: 'cards__row' },
    h('button', {
      type: 'button',
      class: 'cards__minor',
      disabled: pending.length < 2,
      onClick: () => { deferred.add(task.id); renderCards(); },
    }, icon('down', { size: 15 }), 'Later'),
    h('button', {
      type: 'button',
      class: 'cards__minor',
      onClick: () => {
        const result = toggleSkip(task.id);
        if (result?.blocked) toast('No rain checks left', { tone: 'warn', iconName: 'skip' });
      },
    }, icon('skip', { size: 15 }), 'Rain check'),
    h('button', {
      type: 'button',
      class: 'cards__minor',
      onClick: () => openSheet({
        title: task.title,
        subtitle: 'One at a time',
        items: [
          { icon: 'chart', label: 'Back to the list', hint: 'See everything at once', onClick: () => exitCards() },
          { icon: 'moon', label: 'Lights out', hint: 'Stop here for the night', onClick: () => { exitCards(); lightsOut(); } },
        ],
      }),
    }, icon('more', { size: 15 }), 'More'));

  const inner = h('div', { class: 'cards__inner' }, head, body, check, row);
  host.replaceChildren(inner);
  requestAnimationFrame(() => inner.classList.add('cards__inner--in'));
  check.focus({ preventScroll: true });
}

/** Space or Enter checks, Right defers, Escape leaves. */
export function cardsKeydown(event) {
  if (!active) return false;
  if (event.key === 'Escape') { exitCards(); return true; }
  const state = getState();
  const pending = queue(state);
  if (!pending.length) return false;
  const [{ task }] = pending;
  if (event.key === ' ' || event.key === 'Enter') {
    toggleTask(task.id);
    return true;
  }
  if (event.key === 'ArrowRight') {
    deferred.add(task.id);
    renderCards();
    return true;
  }
  return false;
}
