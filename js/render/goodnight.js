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
import { computeStats, advanceLightsOutStreak, isCleanNight, tonightBedtime } from '../night.js';
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

/* The shape of the reward, as constants rather than as numbers buried in an
   expression, because four separate properties are asserted about them.

   ON_TIME is what the early branch is already worth at exactly zero minutes
   early; the late branch decays from that same value, which is what makes the
   two halves meet. LATE_TAU is the decay constant in minutes: a night is worth
   roughly a third of the way from ON_TIME to FLOOR after about 70 minutes.

   FLOOR is the part that matters most and is the easiest to get wrong. It must
   never be zero. A reward that decays to nothing removes the last reason to
   stop at all, which inverts the entire feature — at 3am this app still has to
   be arguing FOR going to bed, and an app that pays nothing for it is arguing
   for staying up. */
const ON_TIME = { xp: 12, dust: 3 };
const FLOOR = { xp: 3, dust: 1 };
const LATE_TAU = 70;
const EARLY_CAP_MINUTES = 90;
/**
 * The part of this reward that follows the night's own earnings.
 *
 * The flat version did not bite. Measured against the real curve: stopping
 * ninety minutes late cost 13 XP and 3 stardust against stopping on the minute
 * — about 2% of a night — while stopping an hour EARLY paid 116 against 26.
 * The whole gradient sat between "early" and "on time"; between "on time" and
 * "late" there was nothing. The app paid generously for virtue and barely
 * noticed vice, which is the wrong way round for the one number that is
 * supposed to be about when you stopped.
 *
 * A flat bonus cannot be made to bite, either: holding the on-time value fixed
 * and widening the gap means pushing the late value toward zero, and a reward
 * that decays to nothing removes the last reason to stop at 3am. So the reward
 * scales with what the night actually earned. A big night has more to lose by
 * running long, which is both the fair reading and the one with teeth.
 *
 * The dust share is deliberately the large one. Stardust is what buys things, so
 * it is the half you can feel, and this is the app's whole answer to "why go to
 * bed on time" — it makes the good night RICHER rather than making the bad night
 * poorer or blocking anything. The version this replaced tried the other way
 * round: a second currency that gated the star map behind on-time nights. At a
 * real rate of one on-time night a week that stranded 840 stardust a week with
 * nowhere to go and put the map 2.9 years away, which is not a gate, it is a
 * wall — and it converted a reward into a restriction, which is the one thing
 * this app's voice has never done.
 */
const SHARE = { onTimeXp: 0.30, floorXp: 0.04, onTimeDust: 0.50, floorDust: 0.03 };
/* Paid down from 1.5 and 0.35: the money moved from the early tail to the
   on-time/late spread rather than being printed. */
const EARLY_PER_MIN = { xp: 0.7, dust: 0.15 };

/**
 * Reward stopping early: the whole point is that you are in bed, not here.
 *
 * One continuous function of `minutesEarly`, positive through negative. It used
 * to be a cliff — `if (minutesEarly <= 0) return { xp: 15, dust: 3 }` — so one
 * minute late and three hours late paid exactly the same, and so did every
 * other consequence in the app. With nothing measuring how late, a bedtime you
 * overshoot by two hours a night is a line the app notices once and then stops
 * having an opinion about.
 *
 * Four properties, each with a test:
 *  - continuous at zero (the cliff also meant stopping ON the minute paid 15
 *    while stopping a minute sooner paid 26 — you were docked for precision);
 *  - monotonic, so earlier is never worth less;
 *  - bounded above by the ninety-minute earliness cap;
 *  - bounded below by FLOOR, and never zero.
 */
export function lightsOutReward(minutesEarly, stats, earned = { xp: 0, dust: 0 }) {
  // A night with nothing on the list gets the floor. The formula scales with
  // how early you stopped and how much you did, so an empty night paid its
  // maximum — 128 XP and 38 stardust for opening the app and holding a button.
  // You still stopped, and stopping still counts for the bedtime streak; it
  // just is not worth more than a night you actually worked through.
  const capped = Math.min(Math.max(0, minutesEarly), EARLY_CAP_MINUTES);
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
  const done = Math.max(0, Number(stats?.done) || 0);
  const scope = Math.max(1, Number(stats?.counted) || Number(stats?.total) || done || 1);
  // An empty list gets the unconditional third and no more — it used to get a
  // flat {xp:15, dust:3}, which stopped being a FLOOR the moment the late branch
  // could go below it. Past about sixty-six minutes late a night you had worked
  // through paid less than fifteen, so deleting the list before pressing Lights
  // out became the higher-paying move: the exact padding-for-reward pressure the
  // taper exists to remove, reappearing at the one reward outside it.
  const empty = !stats || Number(stats.total) === 0;
  const share = empty ? 1 / 3 : 1 / 3 + (2 / 3) * Math.min(1, done / scope);
  // Past bedtime the clock runs the other way: `capped` is pinned at zero by
  // the clamp above, so the early terms vanish and what is left decays from
  // ON_TIME toward FLOOR. `decay` is 1 at exactly on time, which is what joins
  // the two halves without a step.
  const late = Math.max(0, -minutesEarly);
  const decay = Math.exp(-late / LATE_TAU);
  // Both ends scale with the night, so the SPREAD does too — which is the only
  // thing that makes stopping late cost anything worth noticing.
  const nightXp = Math.max(0, Number(earned?.xp) || 0);
  const nightDust = Math.max(0, Number(earned?.dust) || 0);
  const topXp = ON_TIME.xp + SHARE.onTimeXp * nightXp;
  const botXp = FLOOR.xp + SHARE.floorXp * nightXp;
  const topDust = ON_TIME.dust + SHARE.onTimeDust * nightDust;
  const botDust = FLOOR.dust + SHARE.floorDust * nightDust;
  const xp = botXp + (topXp - botXp) * decay + capped * EARLY_PER_MIN.xp;
  const dust = botDust + (topDust - botDust) * decay + capped * EARLY_PER_MIN.dust;
  // And still capped where it was. Stopping ninety minutes early with nothing on
  // the list paid 128 XP once — ten tasks' worth for holding a button.
  return {
    xp: Math.min(empty ? 15 : Infinity, Math.round(xp * share)),
    dust: Math.min(empty ? 3 : Infinity, Math.round(dust * share)),
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
    const minutesLeft = minutesUntilBedtime(state.night.key, tonightBedtime(state), new Date(now));
    const onTime = minutesLeft === null ? true : minutesLeft >= 0;
    const reward = state.night.lightsOutAt || state.profile.lastLightsOutKey === state.night.key
      ? null
      // What the night earned is what this reward is a share of.
      : lightsOutReward(minutesLeft ?? 0, stats, state.night.paid);

    // Once per date, not once per night object. "Bank tonight and start fresh"
    // hands back a clean night with `lightsOutAt` cleared, so without this the
    // reward for stopping could be collected again on every press — the same
    // hole the envelope and the quest already close with a key of their own.
    const paidTonight = state.profile.lastLightsOutKey === state.night.key;
    if (!state.night.lightsOutAt && !paidTonight) {
      state.night.lightsOutAt = now;
      state.night.lightsOutOnTime = onTime;
      state.profile.lastLightsOutKey = state.night.key;
      // Stopping early still pays, whatever you got through — that reward
      // scales by the fraction and is about ending the night. The streak is
      // stricter: everything that counted, finished, before the bedtime.
      advanceLightsOutStreak(state.profile.lightsOut, state.night.key, isCleanNight(stats, onTime));
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
  // The target this night was judged against — the good-night line quotes the
  // same number the reward was computed from.
  const bedtime = tonightBedtime(state);
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
