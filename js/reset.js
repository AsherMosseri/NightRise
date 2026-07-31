/* Resetting parts of a night, rather than all of it.
 *
 * There was one button and it took everything: tasks, level, streak, unlocks,
 * settings, history. Nearly every reason to press it is narrower than that —
 * "unchecking these one by one is tedious", "I want a different list", "start
 * the game over but keep my list" — and a single button that answers all of
 * them with total destruction is not really an answer.
 *
 * These are pure functions over a state object so the awkward part — putting
 * back the XP that tonight's checkmarks paid out — can be tested without a
 * browser.
 */

import { createProfile, emptyTemplate } from './model.js';
import { revokeTaskCompletion, revokeGrant, revokeTaskStart } from './game.js';
import { dropUnearnedTiers } from './achievements.js';
import { computeStats } from './night.js';

export const RESET_PARTS = [
  {
    id: 'checks',
    label: 'Tonight’s checkmarks',
    hint: 'Unticks everything and hands back the XP and stardust it paid. The list stays.',
  },
  {
    id: 'tasks',
    label: 'The task list',
    hint: 'Every section and every task.',
  },
  {
    id: 'history',
    label: 'Night history',
    hint: 'The heatmap and everything it knows about which tasks you actually do.',
  },
  {
    id: 'progress',
    label: 'Level, XP and badges',
    hint: 'Back to level 1 with an empty badge shelf. Streaks and stardust stay.',
  },
  {
    id: 'streaks',
    label: 'Streaks',
    hint: 'The list streak and the nights-on-time streak, current and best. Start counting again from tonight.',
  },
  {
    id: 'stardust',
    label: 'Stardust',
    hint: 'The balance only. Anything you already bought with it is yours.',
  },
  {
    id: 'unlocks',
    label: 'Everything you unlocked',
    hint: 'Skies, companions, constellations, supplies — back to the starting set. Your stardust balance is untouched.',
  },
  {
    id: 'settings',
    label: 'Settings',
    hint: 'Bedtime, motion, dim, sounds, curfew.',
  },
];

export function resetPartById(id) {
  return RESET_PARTS.find((part) => part.id === id) || null;
}

/**
 * Un-tick tonight without paying for it twice.
 *
 * A wholesale wipe of `night.done` would leave every award in your profile,
 * which makes "check everything, reset, check everything" an XP printer. Each
 * one is revoked the same way un-ticking the box does it.
 */
function clearTonight(state) {
  for (const taskId of Object.keys(state.night.done)) revokeTaskCompletion(state, taskId);
  // The advances go back too, or resetting tonight's checkmarks and starting
  // the same tasks again would pay for starting them twice.
  for (const taskId of Object.keys(state.night.started)) revokeTaskStart(state, taskId);
  if (state.night.bonus) {
    revokeGrant(state, state.night.bonus.xp, state.night.bonus.dust);
    state.night.bonus = null;
  }
  state.night.done = {};
  state.night.skipped = {};
  state.night.awards = {};
  state.night.started = {};
  state.night.combo = 1;
  state.night.maxCombo = 1;
  state.night.lastDoneAt = 0;
  state.night.lastMinutes = 0;
  state.night.celebrated = false;
  if (state.night.lightsOutAward) {
    revokeGrant(state, state.night.lightsOutAward.xp, state.night.lightsOutAward.dust);
    state.night.lightsOutAward = null;
  }
  state.profile.lastLightsOutKey = null;
  state.night.lightsOutAt = null;
  state.night.lightsOutOnTime = false;
}

const APPLY = {
  checks: clearTonight,

  tasks(state) {
    state.template = emptyTemplate();
    state.profile.taskStats = {};
    // Nothing left to have checked off.
    clearTonight(state);
  },

  history(state) {
    state.history = {};
    state.profile.taskStats = {};
    state.profile.nightsLogged = 0;
    state.profile.lastBankedKey = null;
  },

  progress(state) {
    Object.assign(state.profile, {
      xp: 0,
      level: 1,
      maxLevelRewarded: 1,
      // The shelf empties. `tiersPaid` does NOT, and the comment that used to
      // sit here had it exactly backwards: it argued that clearing the ledger
      // was fair because "refilling the shelf earns nothing". That holds only
      // for families whose *measure* this reset also clears. Six of the nine
      // measure permanent records it deliberately keeps — nights banked, best
      // streak, best on-time streak, best combo, unlocks owned, constellations
      // finished — so with the ledger wiped the very next tick re-reached every
      // one of those rungs from records nothing had touched and paid for them
      // all again. Two taps in Settings, +880 stardust, repeatable forever.
      //
      // `tiersPaid` is a payment ledger, not display state. It survives.
      tiers: {},
      tiersBanked: {},
      bestCombo: 1,
      dustDebt: 0,
    });
    // The night's awards recorded XP that no longer exists; un-checking later
    // must not subtract it a second time. Same for the start advances.
    state.night.awards = {};
    state.night.started = {};
    state.night.bonus = null;
  },

  /**
   * Both streaks, because they are the same idea counted two ways and nobody
   * wants to zero one and be asked again about the other. Badges stay: holding
   * a seven-night streak is something you did, not somewhere you are.
   */
  streaks(state) {
    const fresh = createProfile();
    Object.assign(state.profile, {
      streak: 0,
      bestStreak: 0,
      lightsOut: fresh.lightsOut,
    });
  },

  stardust(state) {
    state.profile.stardust = 0;
    // Clearing the balance clears what you owed against it too. Carrying a
    // debt through a reset would be a punishment nobody asked for.
    state.profile.dustDebt = 0;
  },

  unlocks(state) {
    const fresh = createProfile();
    Object.assign(state.profile, {
      inventory: fresh.inventory,
      equipped: fresh.equipped,
      tokens: fresh.tokens,
      companion: fresh.companion,
      companions: {},
      constellations: {},
    });
  },

  settings(state) {
    state.profile.settings = createProfile().settings;
  },
};

/**
 * Apply the chosen resets. Order matters: clearing the list has to give the XP
 * back before the progress wipe zeroes it, or the refund lands on nothing.
 */
export function applyReset(state, ids) {
  const chosen = RESET_PARTS.filter((part) => ids.includes(part.id));
  for (const part of chosen) APPLY[part.id](state);
  // Un-ticking tonight through this door has to hand back the same things
  // un-ticking one box does, and a rung tonight was holding up is one of them.
  dropUnearnedTiers(state, computeStats(state));
  return chosen.map((part) => part.id);
}
