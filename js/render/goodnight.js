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
import { computeStats, advanceLightsOutStreak } from '../night.js';
import { grantXp } from '../game.js';
import { checkAchievements } from '../achievements.js';
import { minutesUntilBedtime, formatClockLabel } from '../time.js';
import { formatDuration, plural } from '../util.js';
import { setSkyPaused } from '../sky.js';
import { shiftKey } from '../time.js';
import { rollQuest, questById } from '../quests.js';
import { peekEnvelope } from '../envelope.js';

let host = null;
let deepTimer = null;

/**
 * Take the app out of the tab order behind the ending.
 *
 * `pointer-events: none` stopped the mouse and nothing stopped the keyboard, so
 * Tab walked every button of an app that had faded to black — a screen reader
 * or a keyboard user got the whole invisible interface read back at them after
 * saying good night.
 */
const BEHIND = ['.topbar', '.app', '.companion-slot', '#cards'];

function setBehindInert(on) {
  for (const selector of BEHIND) {
    const node = document.querySelector(selector);
    if (node) node.inert = on;
  }
}

export function initGoodnight(node) {
  host = node;
}

/** Reward stopping early: the whole point is that you are in bed, not here. */
export function lightsOutReward(minutesEarly, stats) {
  // A night with nothing on the list gets the floor. The formula scales with
  // how early you stopped and how much you did, so an empty night paid its
  // maximum — 128 XP and 38 stardust for opening the app and holding a button.
  // You still stopped, and stopping still counts for the bedtime streak; it
  // just is not worth more than a night you actually worked through.
  if (!stats || stats.total === 0) return { xp: 15, dust: 3 };
  if (minutesEarly <= 0) return { xp: 15, dust: 3 };
  const capped = Math.min(minutesEarly, 90);
  // Scaled by how much of the night you actually did, not just by the clock:
  // stopping ninety minutes early with an untouched eleven-task list used to pay
  // 128 XP and 38 stardust — ten tasks' worth for holding a button — so the best
  // move in the game was to open the app and immediately close it. A third of
  // the reward is unconditional, because stopping early genuinely is the point
  // and a bad night must still be worth ending; the rest follows the work.
  //
  // It follows the FRACTION and nothing else. There used to be a `+ done * 2`
  // term, left over from the version where it was the only scaling and never
  // removed when `share` replaced it. That made this — the one reward that sits
  // outside the taper on purpose — pay per row again, so three tasks finished
  // and ended at ten o'clock earned less for stopping than eighteen did. It is
  // the same padding pressure the taper exists to remove, in the last place it
  // should be. A short honest night now ends for exactly what a long one does.
  //
  // `counted` is the total minus rain checks, which is the denominator the
  // percentage uses; a task you excused should not count against you here
  // either. Falling back through total and then done keeps a partial stats
  // object (the tests build a few) from producing NaN.
  const done = Math.max(0, Number(stats.done) || 0);
  const scope = Math.max(1, Number(stats.counted) || Number(stats.total) || done || 1);
  const share = 1 / 3 + (2 / 3) * Math.min(1, done / scope);
  return {
    xp: Math.round((26 + capped * 1.5) * share),
    dust: Math.round((6 + capped * 0.35) * share),
  };
}

export function isGoodnightOpen() {
  return Boolean(host && host.firstChild);
}

export function dismissGoodnight({ reopened = true } = {}) {
  if (!host || !host.firstChild) return;
  clearTimeout(deepTimer);
  deepTimer = null;
  host.replaceChildren();
  // Both classes. Leaving `is-goodnight-deep` behind meant the second lights-out
  // of a night rendered its panel with the title, the line and the moon already
  // at opacity 0 — an ending that came up blank.
  document.documentElement.classList.remove('is-goodnight', 'is-goodnight-deep');
  setSkyPaused(false);
  setBehindInert(false);
  if (reopened) {
    update((state) => { state.night.reopenedAfterLightsOut = true; });
  }
  // The panel was holding focus and is now gone. Hand it to what replaced it,
  // rather than dropping a keyboard user onto <body> at the end of the night.
  document.querySelector('#nightend .lightsout')?.focus?.({ preventScroll: true });
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
    const reward = state.night.lightsOutAt || state.profile.lastLightsOutKey === state.night.key
      ? null
      : lightsOutReward(minutesLeft ?? 0, stats);

    // Once per date, not once per night object. "Bank tonight and start fresh"
    // hands back a clean night with `lightsOutAt` cleared, so without this the
    // reward for stopping could be collected again on every press — the same
    // hole the envelope and the quest already close with a key of their own.
    const paidTonight = state.profile.lastLightsOutKey === state.night.key;
    if (!state.night.lightsOutAt && !paidTonight) {
      state.night.lightsOutAt = now;
      state.night.lightsOutOnTime = onTime;
      state.profile.lastLightsOutKey = state.night.key;
      advanceLightsOutStreak(state.profile.lightsOut, state.night.key, onTime);
      grantXp(state, reward.xp, reward.dust);
      // Written down so it can be handed back. Resetting tonight's checkmarks
      // nulls lightsOutAt and promises in its own hint to return the XP and
      // stardust — and the amounts were thrown away, so there was nothing to
      // return and the reward could then be collected a second time.
      state.night.lightsOutAward = { xp: reward.xp, dust: reward.dust };
    } else if (!state.night.lightsOutAt) {
      // Already paid for tonight; still record that you stopped.
      state.night.lightsOutAt = now;
      state.night.lightsOutOnTime = onTime;
    }
    // Saying good night again is a fresh ending, not a reopened one.
    state.night.reopenedAfterLightsOut = false;
    // Going to bed on time is the achievement this app is about, so it is
    // awarded at the moment you do it rather than quietly at 4am.
    return { stats, minutesLeft, onTime, reward, achievements: checkAchievements(state, stats) };
  });

  emit('lightsout', result);
  // Not as toasts. #toasts is z-index 75 and .goodnight is 80 with an 88%
  // opaque black over it, added a few statements later — so every rung earned
  // by going to bed on time was painted under the blackout for its whole life,
  // and the on-time family is the one you can *only* earn at this exact moment.
  // The panel says it instead, where you are actually looking.
  render(result);
  return result;
}

/** What is waiting tomorrow — the quest by name, and the envelope only by band. */
function tomorrowLine(state) {
  const key = shiftKey(state.night.key, 1);
  const quest = questById(rollQuest(key).id);
  const rare = peekEnvelope(key).rare;
  return h('p', { class: 'goodnight__tomorrow' },
    icon('star', { size: 13 }),
    h('span', {}, `Tomorrow: ${quest.name}`),
    rare ? h('span', { class: 'goodnight__rare' }, '· and one of the rare envelopes') : null);
}

function render({ stats, minutesLeft, onTime, reward, achievements: earned }) {
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
    ...(earned || []).map((step) => h('p', { class: 'goodnight__earned' },
      icon(step.icon, { size: 14 }),
      h('strong', {}, step.name),
      h('span', { class: 'muted' }, step.dust ? ` · +${step.dust} stardust` : ''))),
    // One sentence about tomorrow, on the last thing you look at.
    //
    // The app cannot reach you at 10pm tomorrow — nothing can, and the README
    // is honest about why — so the only channel it has is memory, and the only
    // moment it controls is the one right before you put the phone down. Both
    // halves are recomputed from the same pure seeds the real roll uses, so
    // neither can overclaim. No countdown, no "don't miss it", and it is never
    // mentioned again when you open.
    tomorrowLine(state),
    h('button', {
      type: 'button',
      class: 'goodnight__stay',
      onClick: () => dismissGoodnight({ reopened: true }),
    }, 'I’m still up'));

  host.replaceChildren(panel);
  document.documentElement.classList.add('is-goodnight');
  // The scrim over the canvas is solid black on its way to fully opaque, and
  // the starfield went on drawing 400 stars a frame underneath it until the
  // phone locked. This is the one screen where nothing is left to look at.
  setSkyPaused(true);
  setBehindInert(true);
  requestAnimationFrame(() => panel.classList.add('goodnight__panel--in'));

  // The screen goes almost black on its own. Nothing left to look at.
  // Held, because `host.firstChild` is not a good enough guard: tap "I'm still
  // up" a second in and press Lights out a second later, and the first timer
  // fires against the *second* panel two seconds into it — an ending that
  // starts fading out before you have finished reading it.
  clearTimeout(deepTimer);
  deepTimer = setTimeout(() => {
    if (host.firstChild) document.documentElement.classList.add('is-goodnight-deep');
  }, 4200);

  panel.querySelector('.goodnight__stay')?.focus({ preventScroll: true });
}
