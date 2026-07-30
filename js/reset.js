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
import { revokeTaskCompletion, revokeGrant } from './game.js';

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
    label: 'Level, XP and streak',
    hint: 'Back to level 1, no badges, no streak.',
  },
  {
    id: 'unlocks',
    label: 'Stardust and unlocks',
    hint: 'Skies, companions, constellations, supplies — all back to the start.',
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
  if (state.night.bonus) {
    revokeGrant(state, state.night.bonus.xp, state.night.bonus.dust);
    state.night.bonus = null;
  }
  state.night.done = {};
  state.night.skipped = {};
  state.night.awards = {};
  state.night.combo = 1;
  state.night.maxCombo = 1;
  state.night.lastDoneAt = 0;
  state.night.lastMinutes = 0;
  state.night.celebrated = false;
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
    const fresh = createProfile();
    Object.assign(state.profile, {
      xp: 0,
      level: 1,
      maxLevelRewarded: 1,
      streak: 0,
      bestStreak: 0,
      badges: [],
      lightsOut: fresh.lightsOut,
    });
    // The night's awards recorded XP that no longer exists; un-checking later
    // must not subtract it a second time.
    state.night.awards = {};
    state.night.bonus = null;
  },

  unlocks(state) {
    const fresh = createProfile();
    Object.assign(state.profile, {
      stardust: 0,
      inventory: fresh.inventory,
      equipped: fresh.equipped,
      tokens: fresh.tokens,
      companion: fresh.companion,
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
  return chosen.map((part) => part.id);
}
