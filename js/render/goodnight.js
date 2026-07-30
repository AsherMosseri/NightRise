/* Lights Out — the ending the app was missing.
 *
 * Finishing a night used to fire a celebration and then hand you back a fully
 * lit, fully interactive app on an unlocked phone at 11:40pm, which is the
 * exact shape of the thing NightCheck exists to beat. This closes the night:
 * it stamps when you stopped, pays the reward for stopping (not for tapping),
 * and then takes the screen away.
 */

import { h, icon } from '../dom.js';
import { getState, update, emit } from '../state.js';
import { computeStats } from '../night.js';
import { grantXp, checkBadges } from '../game.js';
import { minutesUntilBedtime, formatClockLabel } from '../time.js';
import { formatDuration, plural } from '../util.js';

let host = null;

export function initGoodnight(node) {
  host = node;
}

/** Reward stopping early: the whole point is that you are in bed, not here. */
export function lightsOutReward(minutesEarly, stats) {
  if (minutesEarly <= 0) return { xp: 15, dust: 3 };
  const capped = Math.min(minutesEarly, 90);
  return {
    xp: Math.round(20 + capped * 1.2 + stats.done * 2),
    dust: Math.round(6 + capped * 0.35),
  };
}

export function isGoodnightOpen() {
  return Boolean(host && host.firstChild);
}

export function dismissGoodnight({ reopened = true } = {}) {
  if (!host || !host.firstChild) return;
  host.replaceChildren();
  document.documentElement.classList.remove('is-goodnight');
  if (reopened) {
    update((state) => { state.night.reopenedAfterLightsOut = true; });
  }
}

/**
 * Bank the moment you stopped, pay for stopping, and fade the app out.
 * Called from the tonight panel's primary button.
 */
export function lightsOut() {
  const result = update((state) => {
    const stats = computeStats(state);
    const now = Date.now();
    const minutesLeft = minutesUntilBedtime(state.night.key, state.profile.settings.bedtime, new Date(now));
    const onTime = minutesLeft === null ? true : minutesLeft >= 0;
    const reward = state.night.lightsOutAt ? null : lightsOutReward(minutesLeft ?? 0, stats);

    if (!state.night.lightsOutAt) {
      state.night.lightsOutAt = now;
      state.night.lightsOutOnTime = onTime;
      const lights = state.profile.lightsOut;
      // One increment per night, however many times you press the button.
      if (lights.lastKey !== state.night.key) {
        lights.streak = onTime ? (lights.lastKey ? lights.streak + 1 : 1) : 0;
        lights.best = Math.max(lights.best, lights.streak);
        lights.lastKey = state.night.key;
      }
      grantXp(state, reward.xp, reward.dust);
    }
    // Going to bed on time is the achievement this app is about, so it is
    // awarded at the moment you do it rather than quietly at 4am.
    return { stats, minutesLeft, onTime, reward, badges: checkBadges(state, stats) };
  });

  emit('lightsout', result);
  if (result.badges?.length) emit('badge', result.badges);
  render(result);
  return result;
}

function render({ stats, minutesLeft, onTime, reward }) {
  if (!host) return;
  const state = getState();
  const { bedtime } = state.profile.settings;
  const lights = state.profile.lightsOut;

  const headline = onTime ? 'Good night.' : 'Good night anyway.';
  const line = minutesLeft === null
    ? 'Sleep well.'
    : onTime
      ? `${formatDuration(minutesLeft)} before ${formatClockLabel(bedtime)}. That is the whole game.`
      : `${formatDuration(minutesLeft)} past ${formatClockLabel(bedtime)}. Tomorrow, a bit sooner.`;

  const panel = h('div', { class: 'goodnight__panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Good night' },
    h('div', { class: 'goodnight__moon', 'aria-hidden': 'true' }, icon('moon', { size: 44 })),
    h('h2', { class: 'goodnight__title' }, headline),
    h('p', { class: 'goodnight__line' }, line),
    h('p', { class: 'goodnight__stats' },
      `${stats.done}/${stats.counted || stats.total} done`,
      reward ? ` · +${reward.xp} XP · +${reward.dust} stardust for stopping` : ''),
    lights.streak > 1
      ? h('p', { class: 'goodnight__streak' }, icon('flame', { size: 14 }), `${plural(lights.streak, 'night', 'nights')} in a row to bed on time`)
      : null,
    h('button', {
      type: 'button',
      class: 'goodnight__stay',
      onClick: () => dismissGoodnight({ reopened: true }),
    }, 'I’m still up'));

  host.replaceChildren(panel);
  document.documentElement.classList.add('is-goodnight');
  requestAnimationFrame(() => panel.classList.add('goodnight__panel--in'));

  // The screen goes almost black on its own. Nothing left to look at.
  setTimeout(() => {
    if (host.firstChild) document.documentElement.classList.add('is-goodnight-deep');
  }, 4200);

  panel.querySelector('.goodnight__stay')?.focus({ preventScroll: true });
}
