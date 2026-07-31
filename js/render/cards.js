/* One Card — the whole night as a single next thing.
 *
 * A twelve-row checklist at 11:40pm is twelve decisions, and decisions are what
 * this app loses to scrolling: a feed asks nothing of you. One card asks nothing
 * either. It is a prompt, not a menu — big target, no aiming, one hand.
 */

import { h, icon, iconButton } from '../dom.js';
import { getState } from '../state.js';
import { toggleTask, toggleSkip, startTask } from '../actions.js';
import { taskXp, comboMultiplier, chainLengthFor } from '../game.js';
import { computeStats } from '../night.js';
import { plural, formatMinutesLong } from '../util.js';
import { openSheet } from './sheet.js';
import { toast } from '../toast.js';
import { setSkyPaused } from '../sky.js';
import { still, fx, rectOf, growTo } from './motion.js';
import { lightsOut } from './goodnight.js';
import { openAddTask } from './add-task.js';
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
/** The task the previous card checked off, so it can be put back. */
let lastChecked = null;
let returnFocus = null;
let lastRenderedId = null;
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

export function enterCards(invoker = null) {
  if (!host) return;
  // Where to put the keyboard back when this mode ends. Leaving used to drop
  // focus to <body> on every exit path — Escape, the ✕, "Back to the list", F
  // — because renderTonight only restores focus that was already inside
  // #tonight, and by then it is inside a layer that no longer exists.
  returnFocus = invoker instanceof HTMLElement
    ? invoker
    : (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  active = true;
  deferred = new Set();
  timer = null;
  lastChecked = null;
  lastRenderedId = null;
  document.documentElement.classList.add('is-onecard');
  // The card layer is a near-opaque scrim with a 14px backdrop-filter over the
  // whole screen, so the sky underneath is invisible — and was still being
  // drawn, and re-blurred, sixty times a second for the entire session. This
  // mode is where the phone has the least patience and was paying the most.
  setSkyPaused(true);
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
  setSkyPaused(false);
  if (host) host.replaceChildren();
  if (onExit) onExit();
  // After onExit(), because that re-renders the panel the invoker lives in.
  const target = returnFocus;
  returnFocus = null;
  if (target && target.isConnected) target.focus({ preventScroll: true });
  else if (target?.dataset?.focus) {
    document.querySelector(`[data-focus="${CSS.escape(target.dataset.focus)}"]`)?.focus({ preventScroll: true });
  }
}

/**
 * The reward beat for One Card mode, which has never once been seen.
 *
 * It used to append to the check button — but toggleTask() notifies
 * synchronously, so renderCards() has already replaced the whole card and the
 * button being appended to is detached. It goes on the body layer instead,
 * measured before the toggle, exactly like the list's floating XP.
 */
function flash(rect, text) {
  if (!rect || still()) return;
  const bubble = h('span', { class: 'onecard__flash' }, text);
  bubble.style.left = `${Math.round(rect.left + rect.width / 2)}px`;
  bubble.style.top = `${Math.round(rect.top)}px`;
  fx(bubble, [
    { transform: 'translate(-50%, 0) scale(0.85)', opacity: 0 },
    { transform: 'translate(-50%, -18px) scale(1)', opacity: 1, offset: 0.25 },
    { transform: 'translate(-50%, -54px) scale(1)', opacity: 0 },
  ], { duration: 900, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }, 1100);
}

/**
 * What finishing this task pays right now, at the momentum you are carrying.
 *
 * The same call chain `applyTaskCompletion` uses, so the number shown before
 * the tap and the number paid after it cannot drift — the house rule the README
 * states for achievement hints, applied to the card.
 */
export function worthOf(state, task) {
  const chain = chainLengthFor(state.night, Date.now(), state.night.lastMinutes || 0);
  return taskXp(task.minutes, comboMultiplier(chain));
}

/* --------------------------------------------------------------- the timer */

/** Repaints the clock in place. Re-rendering the card every second would
    destroy the entry animation and the focus on the check button. */
function paintTimer() {
  if (!face || !timer || !face.root.isConnected) return;
  const elapsed = elapsedOf(timer);
  const running = isRunning(timer);
  const label = timerLabel(timer.plannedMs, elapsed);
  // A clock that has never run is not "nearly out of time" — a two-minute task
  // would open in amber. The colours describe a clock in motion.
  const started = running || elapsed > 0;
  const phase = started ? timerPhase(timer.plannedMs, elapsed) : 'idle';
  // This runs four times a second for the whole session, and on a card whose
  // timer was never started every one of those writes was identical to the last
  // — including a fresh <svg> built from scratch, 240 times an hour.
  if (face.painted === `${label}|${phase}|${running}|${elapsed >= 1000}`) return;
  face.painted = `${label}|${phase}|${running}|${elapsed >= 1000}`;
  face.value.textContent = label;
  face.caption.textContent = timerCaption(timer.plannedMs, elapsed, face.spoken);
  face.bar.style.width = `${(timerProgress(timer.plannedMs, elapsed) * 100).toFixed(2)}%`;
  face.root.dataset.phase = phase;
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

function timerFace(state, task, { started = false } = {}) {
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
    // Before you have started, the big button below is the one way in and this
    // row would be a second Start beside it. After, it is the pause.
    h('div', { class: 'onecard__timer-actions' }, started ? toggle : null, started ? reset : null));

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
      : stats.done > 0
        ? `${plural(stats.done, 'task', 'tasks')} done. Time to stop.`
        : 'Every task was rain-checked. Nothing counted tonight.'),
    h('div', { class: 'onecard__done-actions' },
      // An empty list here used to be a dead end: this mode hides the whole app
      // including quick-add, and the only two ways out were "go to bed" and
      // "leave". Offer the thing you actually came to do.
      stats.total === 0 ? h('button', {
        type: 'button',
        class: 'btn btn--primary',
        onClick: () => openAddTask(),
      }, icon('plus', { size: 16 }), 'Add a task') : null,
      state.night.lightsOutAt || stats.total === 0 ? null : h('button', {
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

  // A div for the same reason the sheet's head is one: <header> inside a plain
  // div maps to `banner`, and there is only one page banner.
  const head = h('div', { class: 'onecard__head' },
    h('span', { class: 'onecard__count' }, pending.length
      ? `${Math.min(position, stats.total)} of ${stats.total}`
      : `${stats.done} of ${stats.total}`),
    h('div', { class: 'onecard__bar', 'aria-hidden': 'true' },
      growTo(h('span', {}), 'onecard:bar', `${stats.pct}%`)),
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

  const started = state.night.started[task.id];

  const check = h('button', {
    type: 'button',
    class: 'onecard__check',
    onClick: () => {
      // Measured first: this button does not survive the toggle.
      const rect = rectOf(check);
      // Set BEFORE the toggle. toggleTask notifies synchronously, so the
      // re-render that builds the next card runs inside it — assigning after
      // meant the new card was built while this was still null and the Undo
      // never appeared. The one mistake this mode is built to invite deserves
      // better than a mode that quietly cannot undo it.
      lastChecked = { id: task.id, title: task.title };
      const result = toggleTask(task.id);
      if (result?.award) flash(rect, `+${result.award.xp} XP`);
    },
  }, icon('check', { size: 30 }), h('span', {}, 'Done'));

  /**
   * The button that asks for three seconds instead of fifteen minutes.
   *
   * Deliberately the same size as Done and sitting above it, never instead of
   * it: a night that ends with nine started tasks and nothing finished is a
   * person who feels busy and is not in bed, which is the failure this mode
   * exists to prevent. Once you have started, it is gone and Done is all there
   * is.
   */
  const startButton = started ? null : h('button', {
    type: 'button',
    class: 'onecard__start',
    onClick: (event) => {
      const rect = rectOf(event.currentTarget);
      const result = startTask(task.id);
      if (result) flash(rect, `+${result.xp} XP`);
      if (!isRunning(timer)) timer = toggleTimer(timer);
      renderCards();
    },
  }, icon('play', { size: 20 }), h('span', {}, 'Start it'));

  const body = h('div', { class: 'onecard__body' },
    h('p', { class: 'onecard__section' }, section.title),
    h('h2', { class: 'onecard__title' }, task.title),
    // What this one pays, before you do it. Computed with the identical call
    // chain applyTaskCompletion uses, so the promise and the payment cannot
    // drift. Rendered once and left stale on purpose: the multiplier decays
    // with wall-clock time, and a number ticking down while you decide is a
    // pressure clock at midnight, which is the wrong instrument entirely.
    h('p', { class: 'onecard__worth' },
      started
        ? `+${Math.max(1, worthOf(state, task) - started.xp)} XP left on this one`
        : `+${worthOf(state, task)} XP`),
    timerFace(state, task, { started: Boolean(started) }));

  const undoable = lastChecked && state.night.done[lastChecked.id] !== undefined
    ? lastChecked
    : null;

  const row = h('div', { class: 'onecard__row' },
    undoable
      ? h('button', {
        type: 'button',
        class: 'onecard__minor',
        title: `Put “${undoable.title}” back`,
        onClick: () => { toggleTask(undoable.id); lastChecked = null; renderCards(); },
      }, icon('undo', { size: 15 }), 'Undo')
      : h('button', {
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

  const inner = h('div', { class: 'onecard__inner' }, head, body, startButton, check, row);
  host.replaceChildren(inner);
  // renderCards is wired into the global subscriber, so it runs on every store
  // notification — including ones raised from a modal or a sheet layered over
  // this card. Focusing (and replaying the entry animation) unconditionally
  // meant buying something in the shop threw the keyboard out of the dialog and
  // onto a button nobody could see. Only when the card itself changed, and only
  // when nothing is layered above it.
  const changed = lastRenderedId !== task.id;
  lastRenderedId = task.id;
  const layered = document.querySelector('dialog[open], .sheet');
  if (changed && !layered) requestAnimationFrame(() => inner.classList.add('onecard__inner--in'));
  else inner.classList.add('onecard__inner--in');
  if (changed && !layered) check.focus({ preventScroll: true });
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
