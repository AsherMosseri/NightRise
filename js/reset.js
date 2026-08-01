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
import { revokeTaskCompletion, revokeGrant, revokeTaskStart, settleNight } from './game.js';
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
  // The records are gone, so the night's face is zero, so it owes back
  // everything it paid. Wiping the records without this left whatever rounding
  // and revocation had not already returned sitting in `night.paid` with no
  // face behind it — not a faucet, since it does not grow, but residue the
  // "clearing tonight hands back what it paid" promise does not allow.
  settleNight(state);
  state.night.paid = { xp: 0, dust: 0 };
  state.night.combo = 1;
  state.night.maxCombo = 1;
  state.night.lastDoneAt = 0;
  state.night.lastMinutes = 0;
  state.night.celebrated = false;
  if (state.night.lightsOutAward) {
    revokeGrant(state, state.night.lightsOutAward.xp, state.night.lightsOutAward.dust);
    state.night.lightsOutAward = null;
    // The key goes back only with the money. It is the once-per-date guard, and
    // clearing it unconditionally opened the exact hole it exists to close:
    // "Bank tonight and start fresh" builds a new night object, so the record of
    // what Lights out paid is gone while the date stays paid. A clear after that
    // handed back nothing — and re-armed the reward, so pressing Lights out
    // again on the same date paid for the same night twice.
    state.profile.lastLightsOutKey = null;
  }
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
      //
      // And so do the two that used to sit in this very object being wiped:
      // `maxLevelRewarded` is the high-water mark that stops a level boundary
      // paying its stardust twice, and `dustDebt` is what you owe for goods you
      // are still holding. Zeroing them here was the same faucet the paragraph
      // above describes, one field over: reset, re-earn, and every level from 1
      // upward pays its bonus again with the stardust from last time still in
      // your pocket. Two taps in Settings, repeatable forever.
      tiers: {},
      tiersBanked: {},
      bestCombo: 1,
    });
    // The night's awards recorded XP that no longer exists; un-checking later
    // must not subtract it a second time. But the XP is the only part this
    // reset zeroes — stardust is its own checkbox and keeps its balance — so
    // DROPPING the records forfeited the dust they owe back. Reset progress,
    // then reset tonight's checkmarks, and clearTonight found nothing left to
    // revoke: the stardust stayed, the list came back, and the same night paid
    // again. Two trips to Settings, ~87 stardust a lap, repeatable forever.
    //
    // The receipts stay; their XP goes to zero. A later un-tick then returns
    // exactly the stardust and none of the XP, which is what each checkbox
    // actually promised.
    for (const award of Object.values(state.night.awards)) award.face = 0;
    for (const record of Object.values(state.night.started)) record.face = 0;
    if (state.night.bonus) state.night.bonus = { ...state.night.bonus, face: 0 };
    // The XP the night paid is gone with the level; what it still owes back in
    // stardust is the dust half of the ledger, which settleNight will hand over
    // when the checkmarks are cleared.
    state.night.paid = { xp: 0, dust: state.night.paid?.dust || 0 };
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
    // The debt stays. It used to be forgiven here on the grounds that carrying
    // it through a reset would be "a punishment nobody asked for" — which
    // forgets what a debt is made of. It exists because you spent stardust and
    // then handed back the thing that earned it, and the goods you bought are
    // still on the shelf: clearing a balance that is already zero and writing
    // off what you owe is a free theme, repeatable. Clearing the *unlocks* is
    // the checkbox that gives the goods back.
  },

  unlocks(state) {
    const fresh = createProfile();
    Object.assign(state.profile, {
      inventory: fresh.inventory,
      equipped: fresh.equipped,
      // Empty, not the starter gift. `createProfile()` seeds one freeze and two
      // rain checks because a new player should not begin with nothing — but
      // handing that gift out again on every press made this button a token
      // dispenser, and tokens are goods. Clearing what you own means owning
      // none of them.
      tokens: { freeze: 0, raincheck: 0 },
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
