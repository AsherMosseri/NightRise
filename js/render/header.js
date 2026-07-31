/* Top bar stats and the "tonight" panel: progress, bedtime pacing, quest,
   tokens and the companion in the corner. */

import { h, svg, icon, clear, replace, withFocus } from '../dom.js';
import { getState } from '../state.js';
import { computeStats, effectiveStreak } from '../night.js';
import { momentumWindow } from '../game.js';
import { evaluateQuest } from '../quests.js';
import { levelFromXp, titleForLevel, nextTitle } from '../game.js';
import {
  formatNightLabel, minutesUntilBedtime, pacingStatus, PACING_COPY, formatClockLabel,
} from '../time.js';
import { formatDuration, formatNumber, plural } from '../util.js';
import { grow, countTo, still, forgetGrow } from './motion.js';
import { topNudge } from '../insights.js';
import { claimQuest } from '../actions.js';
import { openEnvelope, envelopeWaiting, dropById } from '../envelope.js';
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
      const live = effectiveStreak(state);
      const title = live.atRisk
        ? `${plural(live.missed, 'night', 'nights')} missed since you last banked one.`
          + (live.covered
            ? ` ${plural(live.covered, 'streak freeze', 'streak freezes')} will cover ${live.covered === live.missed ? 'it' : 'some of it'}.`
            : ' Nothing to cover it, so the streak is gone.')
        : `Nights running you finished at least 60% of your list — this one is about the`
          + ` list, not the clock. Best: ${profile.bestStreak}. Freezes held: ${profile.tokens.freeze}`;
      return statChip({
        iconName: 'flame',
        value: String(live.streak),
        label: 'list streak',
        title,
        className: `stat--streak ${live.streak > 0 && !live.atRisk ? 'stat--hot' : ''} ${live.atRisk ? 'stat--risk' : ''}`.trim(),
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
    'aria-label': 'Tonight\'s completion',
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
        subtitle: `Tonight's bonus quest · +${quest.def.xp} XP · +${quest.def.dust} stardust`,
        invoker: button,
        items: [{
          icon: 'star',
          label: quest.claimed ? 'Already claimed' : quest.description,
          hint: quest.claimed ? 'Come back tomorrow for a new one' : `Progress ${quest.label}`,
          disabled: true,
          onClick: () => {},
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
      h('span', { class: 'quest__reward' }, `+${quest.def.xp} XP · +${quest.def.dust} dust`)),
    h('p', { class: 'quest__desc' }, quest.description),
    h('div', { class: 'quest__bar' }, h('span', { style: { width: `${Math.min(100, pct)}%` } })),
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

/** Sealed until you tap it; then it is the first thing that happens tonight. */
function envelopeCard(state) {
  if (!envelopeWaiting(state)) {
    const opened = state.night.envelope;
    const drop = dropById(opened?.id);
    if (!drop) return null;
    return h('p', { class: 'envelope envelope--opened' },
      icon('star', { size: 13 }),
      h('span', {}, drop.label),
      h('span', { class: 'muted small' }, drop.detail(opened.amount)));
  }
  return h('button', {
    type: 'button',
    class: 'envelope envelope--sealed',
    onPointerdown: (event) => {
      // Couple the press to the finger, not to the click. Fifty milliseconds of
      // perceived latency for one class.
      event.currentTarget.classList.add('is-pressing');
    },
    onClick: (event) => {
      // Measured now: update() notifies synchronously and this button is gone
      // by the next statement, so there is nothing left to fly out of.
      const rect = event.currentTarget.getBoundingClientRect();
      const key = getState().night.key;
      const result = update((s) => openEnvelope(s));
      if (result) emit('envelope', { ...result, rect, key });
    },
  },
  icon('star', { size: 15 }),
  h('span', { class: 'envelope__label' }, 'Tonight’s envelope'),
  h('span', { class: 'envelope__cta' }, 'Open'));
}

/** The ending. Always available — stopping is the thing being rewarded. */
function lightsOutButton(state, stats) {
  if (state.night.lightsOutAt) {
    return h('p', { class: 'lightsout lightsout--done' },
      icon('moon', { size: 13 }),
      `Lights out at ${new Date(state.night.lightsOutAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`);
  }
  const done = stats.total > 0 && stats.remaining === 0;
  const button = h('button', {
    type: 'button',
    class: `lightsout ${done ? 'lightsout--ready' : ''}`.trim(),
    'aria-label': 'Lights out — press and hold to end the night',
  },
  h('span', { class: 'lightsout__fill', 'aria-hidden': 'true' }),
  icon('moon', { size: 15 }),
  h('span', { class: 'lightsout__label' }, 'Lights out'),
  h('span', { class: 'lightsout__hint' }, 'hold to end'));
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
      body: 'Tonight is stamped and banked, the screen goes dark, and the biggest reward is for stopping early.',
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
              ? 'Everything is done. Go to bed.'
              : `${plural(stats.remaining, 'task', 'tasks')} to go${stats.skipped ? `, ${stats.skipped} rain-checked` : ''}.`),
        stats.remaining > 0
          ? h('button', {
            type: 'button',
            class: 'focus-btn',
            title: 'Show one task at a time (F)',
            onClick: () => enterCards(),
          }, icon('skip', { size: 14 }), `One at a time · ${stats.remaining} left`)
          : null,
        h('div', { class: 'tonight__chips' },
          // The streak that belongs next to the bedtime countdown, not the one
          // about the list. It only appears once there is one to show.
          (state.profile.lightsOut?.streak || 0) > 0
            ? h('span', {
              class: 'chip chip--ontime',
              title: `Nights in a row you called it before your bedtime. Best: ${state.profile.lightsOut.best}.`,
            }, icon('moon', { size: 13 }), `${state.profile.lightsOut.streak} on time`)
            : null,
          combo && momentumLive(state)
            ? h('span', {
              class: 'chip chip--combo',
              title: 'Momentum rises when you work through the list at a real pace.',
            }, icon('flame', { size: 13 }), `x${state.night.combo.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')} momentum`)
            : null,
          h('span', { class: 'chip', title: 'Rain checks excuse a task from tonight\'s percentage' },
            icon('skip', { size: 13 }), `${state.profile.tokens.raincheck} rain ${state.profile.tokens.raincheck === 1 ? 'check' : 'checks'}`),
          h('span', { class: 'chip', title: 'Streak freezes cover a missed night' },
            icon('flame', { size: 13 }), `${state.profile.tokens.freeze} ${state.profile.tokens.freeze === 1 ? 'freeze' : 'freezes'}`)),
        nudge ? h('p', { class: 'tonight__nudge' }, icon('bulb', { size: 13 }), nudge) : null)),
    h('div', { class: 'tonight__side' },
      bedtimeChip(state, stats),
      envelopeCard(state),
      questCard(state, stats)));

  if (nightEndHost) replace(nightEndHost, lightsOutButton(state, stats));
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

export function renderCompanion() {
  if (!companionHost) return;
  const state = getState();
  const companion = state.profile.companion;
  clear(companionHost);
  if (!companion?.type || !state.profile.equipped.companion) {
    companionHost.hidden = true;
    return;
  }
  companionHost.hidden = false;

  const stats = computeStats(state);
  const mood = stats.total === 0 ? 'sleepy' : stats.remaining === 0 ? 'happy' : stats.done > 0 ? 'happy' : 'idle';
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
  replace(nightEndHost, lightsOutButton(state, computeStats(state)));
}

export function renderHeader() {
  renderStats();
  renderTonight();
  renderCompanion();
}
