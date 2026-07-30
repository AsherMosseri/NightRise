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
import { plural, formatMinutesLong } from '../util.js';
import { openSheet } from './sheet.js';
import { toast } from '../toast.js';
import { lightsOut } from './goodnight.js';
import {
  createTimer, elapsedOf, isRunning, toggleTimer, resetTimer,
  timerPhase, timerLabel, timerCaption, timerProgress,
} from '../timer.js';

let host = null;
let active = false;
let deferred = new Set(); // "later" only reorders this sitting, never the list
let onExit = null;

/* The timer belongs to the card on screen, not to the task list: it is a
   sitting, not a record. Leaving one-at-a-time or moving on forgets it. */
let timer = null;
let ticker = null;
let face = null; // the live nodes, so a tick repaints without a re-render

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
  timer = null;
  document.documentElement.classList.add('is-onecard');
  // A quarter second is under the eye's patience for a clock that should tick
  // on the second, and costs nothing: it only repaints two nodes.
  if (!ticker) ticker = setInterval(paintTimer, 250);
  renderCards();
}

export function exitCards() {
  if (!active) return;
  active = false;
  deferred = new Set();
  timer = null;
  face = null;
  if (ticker) {
    clearInterval(ticker);
    ticker = null;
  }
  document.documentElement.classList.remove('is-onecard');
  if (host) host.replaceChildren();
  if (onExit) onExit();
}

function flash(node, text) {
  const bubble = h('span', { class: 'onecard__flash' }, text);
  node.appendChild(bubble);
  setTimeout(() => bubble.remove(), 900);
}

/* --------------------------------------------------------------- the timer */

/** Repaints the clock in place. Re-rendering the card every second would
    destroy the entry animation and the focus on the check button. */
function paintTimer() {
  if (!face || !timer || !face.root.isConnected) return;
  const elapsed = elapsedOf(timer);
  const running = isRunning(timer);
  face.value.textContent = timerLabel(timer.plannedMs, elapsed);
  face.caption.textContent = timerCaption(timer.plannedMs, elapsed, face.spoken);
  face.bar.style.width = `${(timerProgress(timer.plannedMs, elapsed) * 100).toFixed(2)}%`;
  // A clock that has never run is not "nearly out of time" — a two-minute task
  // would open in amber. The colours describe a clock in motion.
  const started = running || elapsed > 0;
  face.root.dataset.phase = started ? timerPhase(timer.plannedMs, elapsed) : 'idle';
  face.root.dataset.state = running ? 'running' : 'paused';
  face.toggle.replaceChildren(
    icon(running ? 'pause' : 'play', { size: 16 }),
    h('span', {}, running ? 'Pause' : (elapsed > 0 ? 'Resume' : 'Start')),
  );
  face.toggle.setAttribute('aria-label', running ? 'Pause the timer' : 'Start the timer');
  face.reset.hidden = elapsed < 1000;
}

/** Space and Enter are the check button's; the timer answers to T. */
export function toggleCardTimer() {
  if (!timer) return false;
  toggleTimer(timer);
  paintTimer();
  return true;
}

function timerFace(state, task) {
  const spoken = formatMinutesLong(task.minutes);
  const value = h('span', { class: 'onecard__clock' }, '');
  const caption = h('span', { class: 'onecard__clock-note' }, '');
  const bar = h('span', { class: 'onecard__clock-fill' });

  const toggle = h('button', {
    type: 'button',
    class: 'onecard__timer-btn',
    onClick: () => { toggleTimer(timer); paintTimer(); },
  });

  const reset = h('button', {
    type: 'button',
    class: 'onecard__timer-btn onecard__timer-btn--quiet',
    'aria-label': 'Start the timer over',
    hidden: true,
    onClick: () => { resetTimer(timer, isRunning(timer)); paintTimer(); },
  }, icon('undo', { size: 15 }));

  const root = h('div', { class: 'onecard__timer' },
    h('div', { class: 'onecard__clock-row' }, value),
    caption,
    h('span', { class: 'onecard__clock-track', 'aria-hidden': 'true' }, bar),
    h('div', { class: 'onecard__timer-actions' }, toggle, reset));

  face = { root, value, caption, bar, toggle, reset, spoken };
  paintTimer();
  return root;
}

function finishedCard(state, stats) {
  return h('div', { class: 'onecard__done' },
    icon('check', { size: 40 }),
    h('h2', {}, stats.total === 0 ? 'Nothing on the list' : 'That’s everything.'),
    h('p', { class: 'muted' }, stats.total === 0
      ? 'Add something to tonight and come back.'
      : `${plural(stats.done, 'task', 'tasks')} done. Time to stop.`),
    h('div', { class: 'onecard__done-actions' },
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

  const head = h('header', { class: 'onecard__head' },
    h('span', { class: 'onecard__count' }, pending.length
      ? `${Math.min(position, stats.total)} of ${stats.total}`
      : `${stats.done} of ${stats.total}`),
    h('div', { class: 'onecard__bar', 'aria-hidden': 'true' },
      h('span', { style: { width: `${stats.pct}%` } })),
    iconButton('close', 'Leave one-at-a-time mode', () => exitCards(), { class: 'onecard__exit' }));

  if (!pending.length) {
    timer = null;
    face = null;
    host.replaceChildren(h('div', { class: 'onecard__inner' }, head, finishedCard(state, stats)));
    return;
  }

  const { task, section } = pending[0];

  // A new card gets a new clock. The same card re-rendering — because a task
  // elsewhere changed, or the sky ticked — keeps the one that is running.
  if (!timer || timer.taskId !== task.id) {
    timer = createTimer(task.id, task.minutes, Boolean(state.profile.settings.autoTimer));
  }

  const check = h('button', {
    type: 'button',
    class: 'onecard__check',
    onClick: () => {
      const result = toggleTask(task.id);
      if (result?.award) flash(check, `+${result.award.xp} XP`);
    },
  }, icon('check', { size: 30 }), h('span', {}, 'Done'));

  const body = h('div', { class: 'onecard__body' },
    h('p', { class: 'onecard__section' }, section.title),
    h('h2', { class: 'onecard__title' }, task.title),
    timerFace(state, task));

  const row = h('div', { class: 'onecard__row' },
    h('button', {
      type: 'button',
      class: 'onecard__minor',
      disabled: pending.length < 2,
      onClick: () => { deferred.add(task.id); renderCards(); },
    }, icon('down', { size: 15 }), 'Later'),
    h('button', {
      type: 'button',
      class: 'onecard__minor',
      onClick: () => {
        const result = toggleSkip(task.id);
        if (result?.blocked) toast('No rain checks left', { tone: 'warn', iconName: 'skip' });
      },
    }, icon('skip', { size: 15 }), 'Rain check'),
    h('button', {
      type: 'button',
      class: 'onecard__minor',
      onClick: () => openSheet({
        title: task.title,
        subtitle: 'One at a time',
        items: [
          { icon: 'chart', label: 'Back to the list', hint: 'See everything at once', onClick: () => exitCards() },
          { icon: 'moon', label: 'Lights out', hint: 'Stop here for the night', onClick: () => { exitCards(); lightsOut(); } },
        ],
      }),
    }, icon('more', { size: 15 }), 'More'));

  const inner = h('div', { class: 'onecard__inner' }, head, body, check, row);
  host.replaceChildren(inner);
  requestAnimationFrame(() => inner.classList.add('onecard__inner--in'));
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
  if (event.key.toLowerCase() === 't') return toggleCardTimer();
  return false;
}
