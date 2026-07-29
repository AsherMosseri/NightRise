/* Top bar stats and the "tonight" panel: progress, bedtime pacing, quest,
   tokens and the companion in the corner. */

import { h, svg, icon, clear, replace } from '../dom.js';
import { getState } from '../state.js';
import { computeStats } from '../night.js';
import { evaluateQuest } from '../quests.js';
import { levelFromXp, titleForLevel, nextTitle } from '../game.js';
import {
  formatNightLabel, minutesUntilBedtime, pacingStatus, PACING_COPY, formatClockLabel,
} from '../time.js';
import { formatDuration, formatNumber, plural } from '../util.js';
import { topNudge } from '../insights.js';
import { claimQuest } from '../actions.js';
import { companionSvg, TIER_NAMES, feedsToNextTier } from '../companion.js';
import { toast } from '../toast.js';

let statsHost = null;
let tonightHost = null;
let companionHost = null;

export function initHeader({ stats, tonight, companion }) {
  statsHost = stats;
  tonightHost = tonight;
  companionHost = companion;
}

/* ------------------------------------------------------------- stat chips */

function statChip({ iconName, value, label, title, className = '' }) {
  return h('div', { class: `stat ${className}`.trim(), title },
    icon(iconName, { size: 15 }),
    h('span', { class: 'stat__value' }, value),
    h('span', { class: 'stat__label' }, label));
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
      h('div', { class: 'level__badge', title: upcoming ? `${upcoming.name} at level ${upcoming.level}` : 'Maximum title' },
        h('span', { class: 'level__num' }, String(level.level)),
        h('span', { class: 'level__word' }, 'lvl')),
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
        }, h('span', { class: 'xpbar__fill', style: { width: `${Math.min(100, level.pct)}%` } })))),
    statChip({
      iconName: 'flame',
      value: String(profile.streak),
      label: profile.streak === 1 ? 'night streak' : 'night streak',
      title: `Best streak: ${profile.bestStreak}. Streak freezes held: ${profile.tokens.freeze}`,
      className: profile.streak > 0 ? 'stat--hot' : '',
    }),
    statChip({
      iconName: 'star',
      value: formatNumber(profile.stardust),
      label: 'stardust',
      title: 'Spend it in the Night Market and on the star map',
      className: 'stat--dust',
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
    svg('circle', {
      class: 'dial__fill',
      cx: 59,
      cy: 59,
      r: radius,
      'stroke-dasharray': `${dash} ${circumference - dash}`,
    })),
  h('div', { class: 'dial__inner' },
    h('span', { class: 'dial__pct' }, `${pct}%`),
    h('span', { class: 'dial__sub' }, `${stats.done}/${stats.counted || stats.total}`)));
}

function questCard(state, stats) {
  const quest = evaluateQuest(state, stats);
  if (!quest) return null;
  const pct = Math.round((quest.progress / quest.goal) * 100);
  return h('div', { class: ['quest', quest.complete && 'quest--done', quest.claimed && 'quest--claimed'].filter(Boolean).join(' ') },
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
        }, quest.complete ? 'Claim reward' : 'In progress')));
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

export function renderTonight() {
  if (!tonightHost) return;
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
        h('div', { class: 'tonight__chips' },
          combo ? h('span', { class: 'chip chip--combo' }, icon('flame', { size: 13 }), `x${state.night.combo.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')} combo`) : null,
          h('span', { class: 'chip', title: 'Rain checks excuse a task from tonight\'s percentage' },
            icon('skip', { size: 13 }), `${state.profile.tokens.raincheck} rain ${state.profile.tokens.raincheck === 1 ? 'check' : 'checks'}`),
          h('span', { class: 'chip', title: 'Streak freezes cover a missed night' },
            icon('flame', { size: 13 }), `${state.profile.tokens.freeze} ${state.profile.tokens.freeze === 1 ? 'freeze' : 'freezes'}`)),
        nudge ? h('p', { class: 'tonight__nudge' }, icon('bulb', { size: 13 }), nudge) : null)),
    h('div', { class: 'tonight__side' },
      bedtimeChip(state, stats),
      questCard(state, stats)));
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

export function renderHeader() {
  renderStats();
  renderTonight();
  renderCompanion();
}
