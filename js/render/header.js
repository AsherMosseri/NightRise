/* Top bar stats and the "tonight" panel: progress, bedtime pacing, quest,
   tokens and the companion in the corner. */

import { h, svg, icon, clear, replace, withFocus } from '../dom.js';
import { getState } from '../state.js';
import { computeStats, effectiveStreak, effectiveLightsOutStreak } from '../night.js';
import { momentumWindow } from '../game.js';
import { evaluateQuest } from '../quests.js';
import { levelFromXp, titleForLevel, nextTitle } from '../game.js';
import {
  formatNightLabel, minutesUntilBedtime, pacingStatus, PACING_COPY, formatClockLabel,
} from '../time.js';
import { formatDuration, formatNumber, plural, formatMinutesShort, roundMinutes } from '../util.js';
import { grow, countTo, still, forgetGrow, growTo } from './motion.js';
import { topNudge } from '../insights.js';
import { claimQuest, setTaskMinutes, moveTaskTo, deleteTask, undo } from '../actions.js';
import { openEnvelope, pendingEnvelopes, dropById } from '../envelope.js';
import { lightsOut } from './goodnight.js';
import { confirmAction } from './confirm.js';
import { enterCards } from './cards.js';
import { update, emit } from '../state.js';
import { companionSvg, TIER_NAMES, feedsToNextTier } from '../companion.js';
import { toast } from '../toast.js';
import { openSheet } from './sheet.js';

let statsHost = null;
let tonightHost = null;
let companionHost = null;
let nightEndHost = null;

export function initHeader({ stats, tonight, companion, nightEnd }) {
  statsHost = stats;
  tonightHost = tonight;
  companionHost = companion;
  nightEndHost = nightEnd;
}

/* ------------------------------------------------------------- stat chips */

/** True only while the current chain would actually still be honoured. */
function momentumLive(state) {
  const { lastDoneAt, lastMinutes } = state.night;
  if (!lastDoneAt) return false;
  return Date.now() - lastDoneAt <= momentumWindow(lastMinutes || 0);
}

function statChip({ iconName, value, label, title, className = '' }) {
  return h('div', { class: `stat ${className}`.trim(), title },
    icon(iconName, { size: 15 }),
    h('span', { class: 'stat__value' }, value),
    h('span', { class: 'stat__label' }, label));
}

let lastLevel = null;

/**
 * The XP bar, actually moving.
 *
 * Levelling resets `pct` to a small number, so simply transitioning the width
 * slid the bar *backwards* at the exact moment you gained something — a win
 * rendered as a loss. Crossing a boundary fills to the top first, then starts
 * the new level from empty with the transition suppressed for that one frame,
 * so the wrap reads as an overflow rather than a reset.
 */
function xpFill(level) {
  const node = h('span', { class: 'xpbar__fill' });
  const width = `${Math.min(100, level.pct)}%`;
  const levelled = lastLevel !== null && level.level > lastLevel;
  lastLevel = level.level;

  if (levelled && !still()) {
    // Forgotten now, not inside the timeout. If anything re-renders in the next
    // 200ms the node this closure holds is gone, its `isConnected` guard bails,
    // and the *new* bar's grow() reads a remembered '100%' — so a fresh level
    // opens by animating from full down to a small percentage.
    forgetGrow('xp:fill');
    node.style.width = '100%';
    setTimeout(() => {
      if (!node.isConnected) return;
      node.style.transition = 'none';
      node.style.width = '0%';
      requestAnimationFrame(() => {
        node.style.transition = '';
        forgetGrow('xp:fill');
        grow(node, 'xp:fill', 'width', width);
      });
    }, 200);
    return node;
  }
  grow(node, 'xp:fill', 'width', width);
  return node;
}

export function renderStats() {
  if (!statsHost) return;
  const state = getState();
  const { profile } = state;
  const level = levelFromXp(profile.xp);
  const title = titleForLevel(level.level);
  const upcoming = nextTitle(level.level);

  replace(statsHost,
    h('div', { class: 'level' },
      // Label above value: the small word frames the number before you read it.
      // The level a new title arrives at, never which one — that is the surprise.
      h('div', { class: 'level__badge', title: upcoming ? `A new title at level ${upcoming.level}` : 'Maximum title' },
        h('span', { class: 'level__word' }, 'lvl'),
        h('span', { class: 'level__num' }, String(level.level))),
      h('div', { class: 'level__meta' },
        h('span', { class: 'level__title' }, title),
        h('div', {
          class: 'xpbar',
          role: 'progressbar',
          'aria-valuenow': String(level.pct),
          'aria-valuemin': '0',
          'aria-valuemax': '100',
          'aria-label': `${level.into} of ${level.need} XP toward level ${level.level + 1}`,
          title: `${formatNumber(level.into)} / ${formatNumber(level.need)} XP`,
        }, xpFill(level)))),
    (() => {
      // The headline streak is the one about the clock, not the one about the
      // list. This app's whole argument is that going to bed early should beat
      // scrolling, and a flame that counts nights you got 60% through a list
      // goes up just as happily at 2am — which is the same mistake as pricing
      // rows instead of evenings, in the number people actually watch.
      const nights = effectiveLightsOutStreak(state);
      const best = state.profile.lightsOut?.best || 0;
      return statChip({
        iconName: 'moon',
        value: String(nights),
        label: 'clean nights',
        title: `Nights in a row you finished everything that counted and were done`
          + ` before ${profile.settings.bedtime}. A rain check takes a task out of`
          + ` "everything", which is what rain checks are for. Pressing Lights out`
          + ` counts, and so does simply finishing and closing the app.`
          + ` Best: ${best}.`,
        className: `stat--streak ${nights > 0 ? 'stat--hot' : ''}`.trim(),
      });
    })(),
    statChip({
      iconName: 'star',
      value: formatNumber(profile.stardust),
      label: 'stardust',
      title: 'Spend it in the Night Market and on the star map',
      className: 'stat--stardust stat--dust',
    }));
}

/* ---------------------------------------------------------- tonight panel */

function progressDial(pct, stats) {
  const radius = 50;
  const circumference = 2 * Math.PI * radius;
  // Ink the first `dash` of the path, gap the rest: unambiguously clockwise from 12.
  const dash = (Math.min(100, Math.max(0, pct)) / 100) * circumference;
  return h('div', {
    class: 'dial',
    role: 'progressbar',
    'aria-valuenow': String(pct),
    'aria-valuemin': '0',
    'aria-valuemax': '100',
    'aria-label': 'Tonight’s completion',
    // `progressbar` is children-presentational, so `.dial__pct` and `.dial__sub`
    // are stripped from the tree — the "3/8" printed in the middle of the dial
    // was announced nowhere. valuetext is where it has to live.
    'aria-valuetext': `${pct}%, ${stats.done} of ${stats.counted || stats.total} done`,
  },
  svg('svg', { class: 'dial__svg', viewBox: '0 0 118 118', 'aria-hidden': 'true' },
    svg('circle', { class: 'dial__track', cx: 59, cy: 59, r: radius }),
    // The dasharray goes on `style`, not on the attribute, and through grow():
    // layout.css has declared a 600ms transition on it since the beginning and
    // it had never once run, because every render builds a brand new circle and
    // a transition needs a previous value to travel from.
    dialArc(svg('circle', { class: 'dial__fill', cx: 59, cy: 59, r: radius }), dash, circumference)),
  h('div', { class: 'dial__inner' },
    dialPct(h('span', { class: 'dial__pct' }), pct),
    h('span', { class: 'dial__sub' }, `${stats.done}/${stats.counted || stats.total}`)));
}

function dialArc(circle, dash, circumference) {
  grow(circle, 'dial:arc', 'stroke-dasharray', `${dash} ${circumference - dash}`);
  return circle;
}

let lastPct = null;

function dialPct(node, pct) {
  countTo(node, lastPct === null ? pct : lastPct, pct, { ms: 520, format: (n) => `${n}%` });
  lastPct = pct;
  return node;
}

/**
 * The full card on a wide screen; a one-line chip on a phone that opens the
 * detail in the bottom sheet. Both are rendered, CSS picks one — the quest is
 * a bonus, and on a phone it should not push the checklist off the screen.
 */
function questCompact(quest) {
  const claimable = quest.complete && !quest.claimed;
  const button = h('button', {
    type: 'button',
    class: ['quest-compact', claimable && 'quest-compact--claim', quest.claimed && 'quest-compact--claimed'].filter(Boolean).join(' '),
    onClick: () => {
      if (claimable) {
        claimQuest();
        return;
      }
      openSheet({
        title: quest.name,
        subtitle: `Tonight’s bonus quest · +${quest.def.xp} XP · +${quest.def.dust} stardust`,
        invoker: button,
        items: [{
          icon: 'star',
          label: quest.claimed ? 'Already claimed' : quest.description,
          hint: quest.claimed ? 'Come back tomorrow for a new one' : `Progress ${quest.label}`,
          static: true,
        }],
      });
    },
  },
  icon('star', { size: 14 }),
  h('span', { class: 'quest-compact__name' }, quest.name),
  h('span', { class: 'quest-compact__progress' }, quest.claimed ? 'claimed' : quest.label),
  claimable ? h('span', { class: 'quest-compact__cta' }, 'Claim') : null);
  return button;
}

function questCard(state, stats) {
  const quest = evaluateQuest(state, stats);
  if (!quest) return null;
  const pct = Math.round((quest.progress / quest.goal) * 100);
  return [questCompact(quest), h('div', { class: ['quest', 'quest--full', quest.complete && 'quest--done', quest.claimed && 'quest--claimed'].filter(Boolean).join(' ') },
    h('div', { class: 'quest__head' },
      icon('star', { size: 14 }),
      h('span', { class: 'quest__name' }, quest.name),
      h('span', { class: 'quest__reward' }, `+${quest.def.xp} XP · +${quest.def.dust} stardust`)),
    h('p', { class: 'quest__desc' }, quest.description),
    h('div', { class: 'quest__bar' }, growTo(h('span', {}), 'quest:bar', `${Math.min(100, pct)}%`)),
    h('div', { class: 'quest__foot' },
      h('span', { class: 'quest__progress' }, quest.label),
      quest.claimed
        ? h('span', { class: 'quest__claimed' }, 'Claimed')
        : h('button', {
          type: 'button',
          class: 'btn btn--primary btn--sm',
          disabled: !quest.complete,
          onClick: () => claimQuest(),
        }, quest.complete ? 'Claim reward' : 'In progress')))];
}

function bedtimeChip(state, stats) {
  const { bedtime } = state.profile.settings;
  const minutesLeft = minutesUntilBedtime(state.night.key, bedtime, new Date());
  const status = pacingStatus(stats.minutesRemaining, minutesLeft);
  const copy = PACING_COPY[status];
  const countdown = minutesLeft === null
    ? '—'
    : minutesLeft >= 0
      ? `${formatDuration(minutesLeft)} left`
      : `${formatDuration(minutesLeft)} over`;

  return h('div', { class: `pacing pacing--${status}`, title: copy.hint },
    h('div', { class: 'pacing__top' },
      icon('moon', { size: 14 }),
      h('span', { class: 'pacing__count' }, countdown),
      h('span', { class: 'pacing__bed' }, `bed ${formatClockLabel(bedtime)}`)),
    h('div', { class: 'pacing__bottom' },
      h('span', { class: 'pacing__label' }, copy.label),
      h('span', { class: 'pacing__work' }, stats.minutesRemaining > 0
        ? `${formatDuration(stats.minutesRemaining)} of tasks left`
        : 'nothing left to do')));
}

/**
 * The nudge, with something to do about it.
 *
 * A task that has slipped six nights running is usually not a task, it is a
 * monument — and no todo app will ever suggest you delete it, so it sits there
 * taxing every glance at the list. Offering that as maintenance rather than as
 * giving up is the cheapest reduction in felt cost available here, and the data
 * that triggers it was already collected and previously only used to make you
 * feel bad.
 *
 * Only ever on a deliberate tap. Four options unprompted at 11:40pm is a menu,
 * which is the thing One Card exists to avoid.
 */
function nudgeButton(state, nudge) {
  const button = h('button', {
    type: 'button',
    class: 'tonight__nudge',
    onClick: () => openSheet({
      title: nudge.title,
      subtitle: `Missed ${plural(nudge.missStreak, 'night', 'nights')} running · done ${nudge.done} of ${nudge.seen}`,
      invoker: button,
      items: [
        {
          icon: 'play',
          label: 'Do it first tonight',
          hint: 'Move it to the top and go one at a time',
          onClick: () => {
            const state = getState();
            const home = Object.values(state.template.sections).find((sec) => sec.taskIds.includes(nudge.id));
            if (home) moveTaskTo(nudge.id, home.id, 0);
            enterCards();
          },
        },
        // Nothing to halve on a task already down at half a minute.
        halved(nudge) < nudge.minutes ? {
          icon: 'minus',
          label: 'Say it takes less',
          // Not "make it smaller". Halving the estimate does not halve the
          // work, and copy that claims otherwise is this project's own
          // recurring failure mode wearing a friendly face.
          hint: `You’ll be told it takes ${formatMinutesShort(halved(nudge))}, not ${formatMinutesShort(nudge.minutes)}. The job is the same size.`,
          onClick: () => setTaskMinutes(nudge.id, halved(nudge)),
        } : null,
        {
          icon: 'trash',
          label: 'Retire it',
          hint: 'Six nights of not doing it is an answer',
          danger: true,
          onClick: () => removeNudgedTask(nudge),
        },
        { icon: 'moon', label: 'Leave it', hint: 'It can keep waiting', onClick: () => {} },
      ],
    }),
  }, icon('bulb', { size: 13 }), h('span', {}, nudge.text));
  return button;
}

function halved(nudge) {
  return Math.max(0.5, roundMinutes(nudge.minutes / 2) ?? 0.5);
}

function removeNudgedTask(nudge) {
  const undoId = deleteTask(nudge.id);
  toast(`Retired “${nudge.title}”`, {
    tone: 'info',
    iconName: 'trash',
    detail: 'Your list is one thing shorter.',
    action: { label: 'Undo', onClick: () => undo(undoId) },
  });
}

/** Sealed until you tap it; then it is the first thing that happens tonight. */
function envelopeCard(state) {
  const waiting = pendingEnvelopes(state);
  if (!waiting.length) {
    const opened = state.night.envelope;
    const drop = dropById(opened?.id);
    if (!drop) return null;
    return h('p', { class: 'envelope envelope--opened' },
      icon('star', { size: 13 }),
      h('span', {}, drop.label),
      h('span', { class: 'muted small' }, drop.detail(opened.amount)));
  }
  // The pulse picks up where the last one left off. `.envelope--sealed` carries
  // a 2.8s infinite breathe, and this button is rebuilt on every state change —
  // so the cycle restarted from 0% every time and on an active night it never
  // once completed. A negative delay against a fixed epoch is the cheap version
  // of the node-caching the companion does two hundred lines below.
  const phase = -((Date.now() - ENVELOPE_EPOCH) % 2800);
  return h('button', {
    type: 'button',
    class: 'envelope envelope--sealed',
    style: { animationDelay: `${phase}ms` },
    onPointerdown: (event) => {
      // Couple the press to the finger, not to the click. Fifty milliseconds of
      // perceived latency for one class.
      event.currentTarget.classList.add('is-pressing');
    },
    onClick: (event) => {
      // Measured now: update() notifies synchronously and this button is gone
      // by the next statement, so there is nothing left to fly out of.
      const rect = event.currentTarget.getBoundingClientRect();
      const result = update((s) => openEnvelope(s));
      if (result) emit('envelope', { ...result, rect, key: result.key });
    },
  },
  icon('star', { size: 15 }),
  // A returning user's first sight used to be a red streak chip and a reset
  // notice. It is a small pile on the doormat instead: the nights you were away
  // are the reason there is something to open, capped so it never pays to stay.
  h('span', { class: 'envelope__label' }, waiting.length > 1
    ? `${waiting.length} envelopes waiting`
    : 'Tonight’s envelope'),
  h('span', { class: 'envelope__cta' }, waiting.length > 1 ? 'Open one' : 'Open'));
}

/** The ending. Always available — stopping is the thing being rewarded. */
function lightsOutButton(state, stats) {
  // "I'm still up" used to be a one-way door: it set a flag nothing ever read,
  // and the button stayed replaced by the stamp — so having reopened the app
  // there was no way to say good night again and the screen never went dark.
  // Ending twice costs nothing; the reward is guarded by its own date key.
  if (state.night.lightsOutAt && !state.night.reopenedAfterLightsOut) {
    return h('p', { class: 'lightsout lightsout--done' },
      icon('moon', { size: 13 }),
      `Lights out at ${new Date(state.night.lightsOutAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`);
  }
  const done = stats.total > 0 && stats.remaining === 0 && stats.done > 0;
  // Permission to stop.
  //
  // The exit used to be at its most inviting exactly when it mattered least —
  // after you had cleared a twelve-item list, which is usually the latest
  // moment of the night. Meanwhile the app already knows when you cannot
  // finish: `pacingStatus` computes `over` — more work left than time left —
  // and the only way out it offered was "Rain check something?". On a night
  // that is not going to happen, the honest suggestion is to stop, and the app
  // whose whole argument is that you should go to bed should be the one making
  // it. Never after bedtime, where "call it here" would read as a scolding, and
  // never while the list is still winnable.
  const left = minutesUntilBedtime(state.night.key, state.profile.settings?.bedtime);
  const overrun = !done
    && stats.remaining > 0
    && left !== null
    && left > 0
    && pacingStatus(stats.minutesRemaining, left) === 'over';
  const button = h('button', {
    type: 'button',
    class: `lightsout ${done || overrun ? 'lightsout--ready' : ''}`.trim(),
    dataset: { focus: 'lightsout' },
    'aria-label': 'Lights out — press and hold to end the night',
  },
  h('span', { class: 'lightsout__fill', 'aria-hidden': 'true' }),
  icon('moon', { size: 15 }),
  h('span', { class: 'lightsout__label' }, overrun ? 'Call it here' : 'Lights out'),
  h('span', { class: 'lightsout__hint' }, overrun ? 'the rest can wait' : 'hold to end'));
  return holdToEnd(button);
}

/**
 * Ending the night is the best thing you can do in this app and the worst thing
 * to do by accident, and it lives under your thumb at the bottom of a list you
 * scroll. A dialog every time would tax the good outcome, so it takes a hold
 * instead: one deliberate gesture, impossible to produce with a stray tap, and
 * no decision to read at midnight.
 */
const HOLD_MS = 650;

function holdToEnd(button) {
  let timer = null;

  const stop = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    button.classList.remove('is-holding');
  };

  button.addEventListener('pointerdown', (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    button.setPointerCapture?.(event.pointerId);
    button.classList.add('is-holding');
    timer = setTimeout(() => {
      stop();
      // A re-render — the 30-second tick is enough — replaces this button
      // mid-hold. The detached node never receives the pointerup that would
      // have cancelled it, so lifting your finger did nothing and the night
      // ended anyway, 650ms later, from a button no longer on the page.
      if (!button.isConnected) return;
      lightsOut();
    }, HOLD_MS);
  });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
    button.addEventListener(type, stop);
  }

  button.addEventListener('click', async (event) => {
    // `detail` is 0 only for a click the keyboard synthesised. A pointer click
    // is the tail of a hold that either finished or was abandoned, and either
    // way it has already been answered.
    if (event.detail !== 0) return;
    const go = await confirmAction({
      title: 'End the night here?',
      // Not "banked" — banking happens at 4am and this does not do it. What it
      // actually does is stamp the time you stopped and pay for stopping.
      body: 'The time you stopped is written down, the screen goes dark, and the biggest reward is for stopping early.',
      confirmLabel: 'Lights out',
      cancelLabel: 'Not yet',
      iconName: 'moon',
    });
    if (go) lightsOut();
  });

  return button;
}

export function renderTonight() {
  if (!tonightHost) return;
  withFocus(tonightHost, () => renderTonightInner());
}

function renderTonightInner() {
  const state = getState();
  const stats = computeStats(state);
  const nudge = topNudge(state);
  const combo = state.night.combo > 1;

  replace(tonightHost,
    h('div', { class: 'tonight__main' },
      progressDial(stats.pct, stats),
      h('div', { class: 'tonight__info' },
        h('p', { class: 'tonight__eyebrow' }, 'Tonight'),
        h('h1', { class: 'tonight__date' }, formatNightLabel(state.night.key)),
        h('p', { class: 'tonight__summary' },
          stats.total === 0
            ? 'Nothing on the list yet.'
            : stats.remaining === 0
              ? (stats.done > 0
                ? 'Everything is done. Go to bed.'
                // Rain-checking the whole list leaves nothing remaining and
                // nothing done. Saying "everything is done" beside a dial
                // reading 0% is the app disagreeing with itself on one screen.
                : 'Nothing left to count tonight.')
              : `${plural(stats.remaining, 'task', 'tasks')} to go${stats.skipped ? `, ${stats.skipped} rain-checked` : ''}.`),
        stats.remaining > 0
          ? h('button', {
            type: 'button',
            class: 'focus-btn',
            title: 'Show one task at a time (F)',
            dataset: { focus: 'focus-mode' },
            onClick: (event) => enterCards(event.currentTarget),
          }, icon('skip', { size: 14 }), `One at a time · ${stats.remaining} left`)
          : null,
        h('div', { class: 'tonight__chips' },
          // The streak that belongs next to the bedtime countdown, not the one
          // about the list. It only appears once there is one to show.
          // The list streak, demoted. It is a real thing to have kept up and it
          // still shows — but "nights you got through the list" is not what the
          // app is for, so it is not the number in the top bar any more.
          (() => {
            const live = effectiveStreak(state);
            if (!live.streak) return null;
            return h('span', {
              class: `chip chip--ontime ${live.atRisk ? 'chip--risk' : ''}`.trim(),
              // A rain check leaves a task out of the denominator entirely, so
              // this is 60% of what counted, not 60% of what you wrote down.
              title: `Nights running you reached 60% of what counted — rain checks are`
                + ` left out of the sum. About the list, not the clock.`
                + ` Best: ${state.profile.bestStreak}.`,
            }, icon('flame', { size: 13 }), `${live.streak} on the list`);
          })(),
          combo && momentumLive(state)
            ? h('span', {
              class: 'chip chip--combo',
              title: 'Momentum rises when you work through the list at a real pace.',
            }, icon('flame', { size: 13 }), `${formatMultiplier(state.night.combo)} momentum`)
            : null,
          h('span', { class: 'chip', title: 'Rain checks excuse a task from tonight’s percentage' },
            icon('skip', { size: 13 }), `${state.profile.tokens.raincheck} rain ${state.profile.tokens.raincheck === 1 ? 'check' : 'checks'}`),
          h('span', { class: 'chip', title: 'Streak freezes cover a missed night' },
            icon('flame', { size: 13 }), `${state.profile.tokens.freeze} ${state.profile.tokens.freeze === 1 ? 'freeze' : 'freezes'}`)),
        nudge ? nudgeButton(state, nudge) : null)),
    h('div', { class: 'tonight__side' },
      bedtimeChip(state, stats),
      envelopeCard(state),
      questCard(state, stats)));

  // A sibling of #tonight, so `withFocus(tonightHost, …)` never covered it:
  // every 30-second countdown tick rebuilt this button and dropped a keyboard
  // user onto <body>. Its own host, its own focus key.
  if (nightEndHost) withFocus(nightEndHost, () => replace(nightEndHost, lightsOutButton(state, stats)));
}

/* -------------------------------------------------------------- companion */

const COMPANION_LINES = {
  idle: ['Still awake, then.', 'The list is not going to check itself.', 'I like this hour.'],
  progress: ['Good. Keep going.', 'That is the hard one done.', 'Nearly there.'],
  done: ['All of it. Every one. Go to sleep.', 'Nothing left. Rest.', 'A clean night.'],
  empty: ['An empty list is suspicious.', 'Give me something to watch you do.'],
};

function pickLine(list, seed) {
  return list[seed % list.length];
}

/** Fixed reference point for the sealed envelope's breathing phase. */
const ENVELOPE_EPOCH = Date.now();

/** What the drawn companion depends on. Anything else must not rebuild it. */
let companionKey = null;

export function renderCompanion() {
  if (!companionHost) return;
  const state = getState();
  const companion = state.profile.companion;
  if (!companion?.type || !state.profile.equipped.companion) {
    clear(companionHost);
    companionHost.hidden = true;
    companionKey = null;
    return;
  }
  companionHost.hidden = false;

  const stats = computeStats(state);
  // The only thing in the app that can be company at midnight, and it was
  // being destroyed and redrawn on every single check-off — which restarted
  // its 22s ring and its 4s breathing from zero, so on an active night neither
  // ever completed a cycle. It only gets rebuilt when it actually looks
  // different.
  const mood0 = stats.total === 0 ? 'sleepy' : stats.remaining === 0 ? 'happy' : stats.done > 0 ? 'happy' : 'idle';
  const key = `${companion.type}:${companion.tier || 1}:${mood0}:${companion.name}`;
  if (key === companionKey && companionHost.firstChild) return;
  companionKey = key;
  clear(companionHost);
  const mood = mood0;
  const tierName = TIER_NAMES[Math.min(TIER_NAMES.length - 1, (companion.tier || 1) - 1)];
  const toNext = feedsToNextTier(companion.fed || 0);

  const button = h('button', {
    type: 'button',
    class: `companion companion--tier${companion.tier || 1}`,
    title: `${companion.name} · ${tierName}${toNext ? ` · ${toNext} more feeds to grow` : ' · fully grown'}`,
    'aria-label': `${companion.name}, your companion. Click for a word.`,
    onClick: () => {
      const bucket = stats.total === 0 ? 'empty' : stats.remaining === 0 ? 'done' : stats.done > 0 ? 'progress' : 'idle';
      toast(pickLine(COMPANION_LINES[bucket], stats.done + stats.total), {
        tone: 'info',
        detail: `${companion.name} · ${tierName}`,
        duration: 3200,
      });
    },
  }, companionSvg(companion.type, companion.tier || 1, mood),
  h('span', { class: 'companion__name' }, companion.name));

  companionHost.appendChild(button);
}

export function renderNightEnd() {
  if (!nightEndHost) return;
  const state = getState();
  withFocus(nightEndHost, () => replace(nightEndHost, lightsOutButton(state, computeStats(state))));
}

export function renderHeader() {
  renderStats();
  renderTonight();
  renderCompanion();
}
