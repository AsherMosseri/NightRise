/* Achievements, in tiers.
 *
 * There were thirteen badges and every one of them was a light switch: off,
 * then on, forever. "Turned In" for one night on time and "Clockwork" for
 * three sat side by side as if they were unrelated, "Skyward" and "Deep Sky"
 * likewise, and a shelf of switches tells you nothing about where you are —
 * only which ones happen to be lit.
 *
 * So each one is now a family that levels: a single icon you keep, a name that
 * changes as you climb, and a bar showing how far into the next rung you are.
 * The bar is the point. "0 of 13 badges" is a scoreboard; "4 of 7 nights" is a
 * reason to do something tonight.
 *
 * Two rules hold the whole thing together:
 *
 *  1. Every family is a *number*, not an event. A tier is reached when the
 *     number passes a threshold, so progress can always be drawn and nothing
 *     depends on the app being open at the right moment.
 *  2. The wording is generated from that threshold. `goal(at)` is handed the
 *     same number the comparison uses, so a hint cannot come to say seven while
 *     the check says three — the failure this app keeps finding in its own copy.
 */

import { COMBO_MAX } from './game.js';
import { nightsFullyCleared } from './insights.js';
import { plural, formatMultiplier } from './util.js';
import { CONSTELLATIONS } from './constellations.js';
// The catalogs, not the shop. js/shop.js imports checkAchievements from here,
// so reaching back into it for allItems() would be an import cycle — and one
// that throws, because these are `const` and would be read inside their own
// temporal dead zone. The data lives in skins.js precisely so both can have it.
import * as SKINS from './skins.js';
import { COMPANIONS } from './companion.js';

/** Stardust for reaching a tier, paid once per tier ever. */
export function tierDust(tier) {
  return 20 + tier * 15;
}

function inventorySize(profile) {
  return Object.values(profile.inventory).reduce((sum, list) => sum + list.length, 0);
}

/**
 * Unlocks you actually chose.
 *
 * Derived, not counted by hand. This was the literal 4 — right when the market
 * had four free defaults, and silently wrong the moment it had nine: a brand new
 * profile measured five unlocks it had never bought and was handed two
 * achievement tiers for opening the app. Every free default is one the app gave
 * you, whatever the market grows to.
 *
 * And then it was a hand-typed list of the eight catalogs, which is the same bug
 * one level up: opening a ninth shelf left its free default uncounted, so a fresh
 * profile was handed a Collector rung again for owning something it was given.
 * Every array skins.js exports is a catalog and nothing else is, so the list is
 * read off the module rather than repeated here — a new shelf cannot be missed.
 */
const CATALOG = [
  ...Object.values(SKINS).filter(Array.isArray).flat(),
  ...COMPANIONS,
];
const FREE_UNLOCKS = CATALOG.filter((item) => !item.cost).length;

/** The most anyone can ever own. The top rung has to be reachable by buying. */
const BUYABLE_UNLOCKS = CATALOG.length - FREE_UNLOCKS;

export const ACHIEVEMENTS = [
  {
    id: 'nights',
    icon: 'moon',
    noun: 'nights',
    goal: (at) => (at === 1 ? 'Bank your first night' : `Bank ${at} nights`),
    measure: (state) => state.profile.nightsLogged,
    tiers: [
      { at: 1, name: 'First Light' },
      { at: 10, name: 'Regular' },
      { at: 30, name: 'Old Hand' },
      { at: 100, name: 'Centenary' },
    ],
  },
  {
    id: 'streak',
    icon: 'flame',
    noun: 'nights',
    goal: (at) => `Hold a ${plural(at, 'night', 'night')} streak`,
    // The best you have ever held, not the one you are on. A streak achievement
    // that falls off when you miss a Tuesday is a punishment, and this app has
    // enough ways to tell you that you missed a night.
    measure: (state) => state.profile.bestStreak,
    tiers: [
      { at: 3, name: 'Three in a Row' },
      { at: 7, name: 'Week of Nights' },
      { at: 14, name: 'Fortnight' },
      { at: 30, name: 'Moon Cycle' },
      { at: 100, name: 'Unbroken' },
    ],
  },
  {
    id: 'ontime',
    icon: 'calendar',
    noun: 'nights',
    // Measured off the clean-night streak's high-water mark, so the wording has
    // to ask for a clean night. It used to say "stop before your bedtime", which
    // was true when the streak only watched the clock and became a promise the
    // check no longer kept the moment it also asked for the list.
    goal: (at) => (at === 1
      ? 'Finish the list and stop before your bedtime'
      : `Finish and stop before bedtime ${at} nights running`),
    measure: (state) => state.profile.lightsOut?.best || 0,
    tiers: [
      { at: 1, name: 'Turned In' },
      { at: 3, name: 'Clockwork' },
      { at: 7, name: 'Sound Asleep' },
      { at: 21, name: 'Second Nature' },
      { at: 60, name: 'Nocturne' },
    ],
  },
  {
    id: 'cleared',
    icon: 'check',
    noun: 'nights',
    goal: (at) => (at === 1 ? 'Tick off every task in a night' : `Clear the whole list ${at} nights`),
    // Every task ticked — the same strict count the history panel shows, so the
    // badge and the tile can never disagree. A rain check excuses a task from
    // the percentage; it does not do the task.
    measure: (state, stats) => nightsFullyCleared(state.history)
      + (stats && stats.total > 0 && stats.done >= stats.total ? 1 : 0),
    // Tonight counts toward the rung the moment you finish, but it is on loan
    // until 4am banks it: un-tick something and it goes back. Nights already
    // banked are the floor and are yours whatever you do to tonight.
    floor: (state) => nightsFullyCleared(state.history),
    tiers: [
      { at: 1, name: 'Nothing Missed' },
      { at: 5, name: 'Spotless' },
      { at: 15, name: 'Full House' },
      { at: 40, name: 'Immaculate' },
    ],
  },
  {
    id: 'level',
    icon: 'star',
    noun: 'levels',
    goal: (at) => `Reach level ${at}`,
    measure: (state) => state.profile.level,
    // Nothing here is ever banked. A level says where you are, so un-checking
    // your way down to level 4 must not leave you holding level 5's rung.
    floor: () => 0,
    tiers: [
      { at: 5, name: 'Skyward' },
      { at: 10, name: 'Deep Sky' },
      { at: 20, name: 'Far Horizon' },
      { at: 35, name: 'Escape Velocity' },
      { at: 50, name: 'Orbit' },
    ],
  },
  {
    id: 'combo',
    icon: 'chart',
    noun: 'multiplier',
    goal: (at) => `Hit a ${formatMultiplier(at)} momentum multiplier`,
    format: (n) => formatMultiplier(n),
    base: 1,
    measure: (state) => Math.max(state.profile.bestCombo || 1, state.night.maxCombo || 1),
    tiers: [
      { at: 1.5, name: 'Momentum' },
      { at: 2, name: 'Chain Lightning' },
      { at: COMBO_MAX, name: 'Runaway' },
    ],
  },
  {
    id: 'collector',
    icon: 'bag',
    noun: 'unlocks',
    goal: (at) => `Buy ${plural(at, 'thing', 'things')} from the shop`,
    measure: (state) => Math.max(0, inventorySize(state.profile) - FREE_UNLOCKS),
    tiers: [
      // Spread across whatever the catalog actually holds, so the ladder grows
      // with the market instead of being retyped every time it does. The top
      // rung was once a literal 25 against 18 buyable things, and someone who
      // owned everything read "18 / 25 · buy 25 things" forever — the top rung
      // of a collection has to be reachable by collecting it.
      { at: 1, name: 'Impulse Buy' },
      { at: Math.max(2, Math.round(BUYABLE_UNLOCKS * 0.28)), name: 'Collector' },
      { at: Math.max(3, Math.round(BUYABLE_UNLOCKS * 0.66)), name: 'Curator' },
      { at: BUYABLE_UNLOCKS, name: 'Completionist' },
    ],
  },
  {
    id: 'constellation',
    icon: 'map',
    noun: 'constellations',
    goal: (at) => `Finish ${plural(at, 'constellation', 'constellations')}`,
    measure: (state) => Object.values(state.profile.constellations)
      .filter((c) => c && c.complete).length,
    // Derived from the catalog, not written down. "Whole Sky" at a hardcoded 7
    // was true of a seven-constellation map and became a lie the moment the map
    // grew — the same way "Completionist" asked for 25 purchases against a
    // catalog of 18. A rung named for finishing something has to move with the
    // thing it finishes.
    tiers: [
      { at: 1, name: 'Cartographer' },
      { at: Math.max(2, Math.round(CONSTELLATIONS.length * 0.25)), name: 'Star Charter' },
      { at: Math.max(3, Math.round(CONSTELLATIONS.length * 0.6)), name: 'Wide Field' },
      { at: CONSTELLATIONS.length, name: 'Whole Sky' },
    ],
  },
  {
    id: 'companion',
    icon: 'bulb',
    noun: 'tiers',
    goal: (at) => `Raise a companion to tier ${at}`,
    // A profile with no companion still carries `tier: 1`, which read as being
    // halfway to Bonded before you had adopted anything.
    measure: (state) => (state.profile.companion?.type ? state.profile.companion.tier || 0 : 0),
    tiers: [
      { at: 2, name: 'Bonded' },
      { at: 3, name: 'Best Friend' },
      { at: 4, name: 'Inseparable' },
    ],
  },
];

export function achievementById(id) {
  return ACHIEVEMENTS.find((a) => a.id === id) || null;
}

/** How many tiers a measure has cleared. 0 means the family is still locked. */
export function tierAt(family, measure) {
  let tier = 0;
  // A small epsilon, because the combo multiplier is built by repeated addition
  // of 0.25 and 1.4999999999999998 should count as 1.5.
  for (const step of family.tiers) if (measure >= step.at - 1e-9) tier += 1;
  return tier;
}

/** The tier recorded on the profile, which is what you are actually holding. */
export function heldTier(profile, id) {
  return Math.max(0, Number(profile.tiers?.[id]) || 0);
}

/**
 * The rung durable evidence alone justifies — banked nights, records, things
 * bought. A tier at or below this can never be taken away by an un-tick.
 */
export function bankedTier(profile, id) {
  return Math.max(0, Number(profile.tiersBanked?.[id]) || 0);
}

/**
 * A family's measure with tonight left out.
 *
 * This is the whole of what makes a rung permanent or provisional, and it is
 * why `volatile` is gone. Two families can move *down* on a tap: level, whose
 * floor is nothing at all, and cleared nights, whose floor is the nights
 * already banked. Everything else is a record or a running total that can only
 * fall through a deliberate reset — and a reset has its own checkbox, so it
 * must not be the thing that quietly takes a rung.
 */
function floorOf(family, state) {
  return family.floor ? family.floor(state) : family.measure(state, null);
}

/**
 * Where a family stands right now: never below what banked evidence proves,
 * never above what the live measure reaches.
 */
function reachedTier(family, state, stats) {
  const latch = Math.max(bankedTier(state.profile, family.id), tierAt(family, floorOf(family, state)));
  return Math.max(latch, tierAt(family, family.measure(state, stats)));
}

function fmt(family, n) {
  return family.format ? family.format(n) : String(Math.floor(n));
}

/**
 * Everything the card needs: where you are, what is next, and how far along.
 *
 * The name of a tier you have not reached is withheld, the same way an
 * unreached title is. You get the number you are working toward — which is the
 * part that helps — and the name stays a reveal.
 */
export function tierState(family, state, stats) {
  const measure = family.measure(state, stats);
  // What the profile holds, never what the measure merely qualifies for. The
  // two agree because achievements are settled on load, and a card that ran
  // ahead of the profile would promise a tier nothing had recorded or paid.
  const held = heldTier(state.profile, family.id);
  const current = held > 0 ? family.tiers[held - 1] : null;
  const next = held < family.tiers.length ? family.tiers[held] : null;
  // Where the scale starts. The combo multiplier bottoms out at x1, so without
  // this an untouched profile showed the first bar already two thirds full.
  const from = current ? current.at : (family.base || 0);
  const span = next ? next.at - from : 0;

  return {
    id: family.id,
    icon: family.icon,
    noun: family.noun,
    measure,
    tier: held,
    tiers: family.tiers.length,
    // Locked families show the name of the rung you are climbing toward, so the
    // shelf reads as a list of things to do rather than a row of question marks.
    name: current ? current.name : family.tiers[0].name,
    earned: held > 0,
    complete: !next,
    goal: family.goal(next ? next.at : (current?.at ?? family.tiers[0].at)),
    next: next ? next.at : null,
    progress: next
      ? `${fmt(family, Math.min(measure, next.at))} / ${fmt(family, next.at)}`
      : fmt(family, measure),
    pct: next ? Math.round(Math.max(0, Math.min(1, (measure - from) / (span || 1))) * 100) : 100,
  };
}

/** Every family, in the order they are declared. */
export function achievementBoard(state, stats) {
  return ACHIEVEMENTS.map((family) => tierState(family, state, stats));
}

/** Tiers held across every family — the number the "badges" stat shows. */
export function totalTiers(profile) {
  return ACHIEVEMENTS.reduce((sum, family) => sum + heldTier(profile, family.id), 0);
}

/**
 * Record any tier newly reached, and pay for it.
 *
 * Stardust is paid against `tiersPaid`, the same high-water mark that stops a
 * level boundary being crossed twice for the same bonus, and only for rungs the
 * floor already supports. A rung tonight can still take back is on loan; paying
 * for it would mean the dust outliving the badge. `level` floors at zero and so
 * pays nothing ever — levelling up already pays stardust of its own.
 */
export function checkAchievements(state, stats) {
  const { profile } = state;
  if (!profile.tiers) profile.tiers = {};
  if (!profile.tiersBanked) profile.tiersBanked = {};
  if (!profile.tiersPaid) profile.tiersPaid = {};
  // The best chain you ever held has to be remembered somewhere; `night.maxCombo`
  // is gone at 4am.
  profile.bestCombo = Math.max(profile.bestCombo || 1, state.night.maxCombo || 1);

  const earned = [];
  for (const family of ACHIEVEMENTS) {
    // Bank the floor first. Once written it stays, so wiping the history that
    // proved it does not also take the rung — a reset has its own checkbox and
    // should not be reaching in here through the back door.
    const latch = Math.max(bankedTier(profile, family.id), tierAt(family, floorOf(family, state)));
    if (latch > 0) profile.tiersBanked[family.id] = latch;

    const reached = Math.max(latch, tierAt(family, family.measure(state, stats)));
    const held = heldTier(profile, family.id);
    if (reached === held) continue;
    profile.tiers[family.id] = reached;
    if (reached < held) continue; // a fall is not an award; dropUnearnedTiers reports it

    for (let tier = held + 1; tier <= reached; tier += 1) {
      const step = family.tiers[tier - 1];
      let dust = 0;
      // Paid against the *latch*, not the live measure. A rung that tonight can
      // still take back is on loan, and paying for it meant the stardust
      // outlived the badge: clear the list, collect 35, un-tick one task, the
      // rung drops and the dust stays. Waiting for the floor to catch up — 4am
      // for `cleared`, never for `level`, immediately for the other seven —
      // makes "volatile families pay nothing" true by construction rather than
      // by naming one family in an if.
      if (tier <= latch && tier > (Number(profile.tiersPaid[family.id]) || 0)) {
        dust = tierDust(tier);
        profile.stardust += dust;
        profile.tiersPaid[family.id] = tier;
      }
      earned.push({
        id: family.id, tier, name: step.name, icon: family.icon,
        hint: family.goal(step.at), dust, tiers: family.tiers.length,
      });
    }
  }
  return earned;
}

/**
 * Tiers you have fallen out of, because the thing that earned them was undone.
 *
 * Only the two families with a floor below their measure can reach here — the
 * level you dropped out of, and tonight's clear that you un-ticked — but the
 * call is unconditional so no caller has to know which those are.
 */
export function dropUnearnedTiers(state, stats) {
  const { profile } = state;
  if (!profile.tiers) profile.tiers = {};
  const lost = [];
  for (const family of ACHIEVEMENTS) {
    const reached = reachedTier(family, state, stats);
    const held = heldTier(profile, family.id);
    if (reached >= held) continue;
    for (let tier = held; tier > reached; tier -= 1) {
      lost.push({ id: family.id, tier, name: family.tiers[tier - 1].name, icon: family.icon });
    }
    profile.tiers[family.id] = reached;
  }
  return lost;
}

/* ------------------------------------------------------------- old saves */

/** Which family and rung each retired badge id stood for. */
const LEGACY = {
  'first-night': ['nights', 1],
  perfect: ['cleared', 1],
  'streak-3': ['streak', 1],
  'streak-7': ['streak', 2],
  'streak-30': ['streak', 4],
  'level-5': ['level', 1],
  'level-10': ['level', 2],
  'combo-max': ['combo', 3],
  'on-time': ['ontime', 1],
  'on-time-3': ['ontime', 2],
  collector: ['collector', 2],
  constellation: ['constellation', 1],
  companion: ['companion', 2],
};

/**
 * Turn a saved list of badge ids into tiers.
 *
 * Whatever you had earned, you keep — at the rung it corresponds to. Nothing is
 * paid retroactively: the migrated tier is written to `tiersPaid` as well, so
 * loading an old save is not a stardust windfall.
 */
export function migrateBadges(badges) {
  const tiers = {};
  if (!Array.isArray(badges)) return tiers;
  for (const id of badges) {
    const entry = LEGACY[id];
    if (!entry) continue;
    const [family, tier] = entry;
    tiers[family] = Math.max(tiers[family] || 0, tier);
  }
  return tiers;
}
