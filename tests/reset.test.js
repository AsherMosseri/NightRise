/* Losing a level, and resetting one part of the app without the rest. */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createInitialState } from '../js/model.js';
import {
  grantXp, revokeGrant, levelUpDust, levelFromXp, xpForLevel,
} from '../js/game.js';
import { checkAchievements, dropUnearnedTiers, heldTier, tierDust } from '../js/achievements.js';
import { applyReset, RESET_PARTS } from '../js/reset.js';
import { computeStats, bankNight } from '../js/night.js';
import { getState, replaceState } from '../js/state.js';
import { toggleTask } from '../js/actions.js';

function fresh() {
  return createInitialState(new Date(2026, 6, 29, 22, 0));
}

/** xpForLevel is the step from one level to the next; this is the total. */
function xpToReach(level) {
  let sum = 0;
  for (let l = 1; l < level; l += 1) sum += xpForLevel(l);
  return sum;
}

/* --------------------------------------------------------------- levelling */

test('dropping back below a level gives its reward back', () => {
  const state = fresh();
  const toLevel2 = xpToReach(2);
  grantXp(state, toLevel2);
  assert.equal(state.profile.level, 2);
  const paid = levelUpDust(2);
  assert.equal(state.profile.stardust, paid, 'levelling up paid out');

  revokeGrant(state, toLevel2, 0);
  assert.equal(state.profile.level, 1);
  assert.equal(state.profile.stardust, 0, 'and dropping back took it away again');
  assert.equal(state.profile.maxLevelRewarded, 1);
});

test('a level round trip is worth nothing', () => {
  const state = fresh();
  const xp = xpToReach(3);
  for (let i = 0; i < 5; i += 1) {
    grantXp(state, xp);
    revokeGrant(state, xp, 0);
  }
  assert.equal(state.profile.xp, 0);
  assert.equal(state.profile.stardust, 0);
  assert.equal(state.profile.level, 1);
});

test('a level tier comes off with the level', () => {
  const state = fresh();
  const xp = xpToReach(5);
  grantXp(state, xp);
  checkAchievements(state, computeStats(state));
  assert.equal(heldTier(state.profile, 'level'), 1, 'Skyward, earned at level 5');

  revokeGrant(state, xp, 0);
  const lost = dropUnearnedTiers(state);
  assert.ok(state.profile.level < 5);
  assert.equal(heldTier(state.profile, 'level'), 0, 'and gone again below it');
  assert.deepEqual(lost.map((l) => l.name), ['Skyward'], 'and it says which one went');
});

test('the level ladder pays no stardust, so falling out of it owes nothing', () => {
  const state = fresh();
  const before = state.profile.stardust;
  grantXp(state, xpToReach(5), 0);
  const earned = checkAchievements(state, computeStats(state));
  const levelTier = earned.find((e) => e.id === 'level');
  assert.equal(levelTier.dust, 0,
    'levelling already pays its own bonus; a badge paying again would have to claw it back');
  // Whatever the balance is, it moved only by the level-up bonus grantXp paid.
  assert.equal(state.profile.stardust, before + levelUpDust(2) + levelUpDust(3)
    + levelUpDust(4) + levelUpDust(5));
});

test('a tier you actually did something for is not taken away', () => {
  const state = fresh();
  state.profile.nightsLogged = 1;
  const xp = xpToReach(5);
  grantXp(state, xp);
  checkAchievements(state, computeStats(state));
  assert.equal(heldTier(state.profile, 'nights'), 1);

  revokeGrant(state, xp, 0);
  dropUnearnedTiers(state);
  assert.equal(heldTier(state.profile, 'nights'), 1, 'banking that night still happened');
});

test('dust already spent is not clawed into a negative balance', () => {
  const state = fresh();
  const xp = xpToReach(2);
  grantXp(state, xp);
  state.profile.stardust = 0; // spent it in the shop

  revokeGrant(state, xp, 0);
  assert.equal(state.profile.stardust, 0, 'no negative balance');
  assert.equal(state.profile.maxLevelRewarded, 2, 'so that level is never paid twice');

  // And re-earning it pays nothing, which is what keeps the loop worthless.
  grantXp(state, xp);
  assert.equal(state.profile.stardust, 0);
});

test('un-checking a task that levelled you up undoes the level too', () => {
  replaceState(fresh());
  const ids = Object.keys(getState().template.tasks);
  // Sit just under level 2, then let one task push us over.
  getState().profile.xp = xpToReach(2) - 5;
  getState().profile.level = levelFromXp(getState().profile.xp).level;

  toggleTask(ids[0]);
  assert.equal(getState().profile.level, 2);
  const dustAtLevel2 = getState().profile.stardust;
  assert.ok(dustAtLevel2 >= levelUpDust(2));

  toggleTask(ids[0]);
  assert.equal(getState().profile.level, 1, 'back down');
  assert.equal(getState().profile.xp, xpToReach(2) - 5, 'exactly where we started');
  assert.equal(getState().profile.stardust, 0, 'including the level bonus');
});

/* ------------------------------------------------------------------ resets */

test('resetting tonight hands the XP back', () => {
  const state = fresh();
  replaceState(state);
  const ids = Object.keys(getState().template.tasks);
  for (const id of ids.slice(0, 5)) toggleTask(id);
  assert.ok(getState().profile.xp > 0);

  applyReset(getState(), ['checks']);
  assert.equal(getState().profile.xp, 0, 'nothing earned survives the un-ticking');
  assert.equal(getState().profile.stardust, 0);
  assert.deepEqual(getState().night.done, {});
  assert.ok(Object.keys(getState().template.tasks).length > 0, 'the list itself stays');
});

test('checking everything and resetting on a loop earns nothing after the first', () => {
  replaceState(fresh());
  const ids = Object.keys(getState().template.tasks);

  for (const id of ids) toggleTask(id);
  applyReset(getState(), ['checks']);
  // Clearing the whole list genuinely happened once, and the achievement tier
  // it reached is paid once. That payment is the entire allowance.
  const afterFirst = getState().profile.stardust;
  assert.equal(afterFirst, tierDust(1), 'Nothing Missed, tier 1, and not a grain more');

  for (let round = 0; round < 4; round += 1) {
    for (const id of ids) toggleTask(id);
    applyReset(getState(), ['checks']);
  }
  assert.equal(getState().profile.xp, 0, 'the XP goes back every time');
  assert.equal(getState().profile.stardust, afterFirst, 'and four more laps pay nothing');
  assert.equal(getState().profile.level, 1);
});

function loaded() {
  const state = fresh();
  state.profile.xp = 900;
  state.profile.level = 4;
  state.profile.stardust = 300;
  state.profile.streak = 6;
  state.profile.bestStreak = 9;
  state.profile.lightsOut = { streak: 3, best: 5, lastKey: '2026-07-29' };
  state.profile.tiers = { nights: 1, streak: 1 };
  state.profile.tiersBanked = { nights: 1, streak: 1 };
  state.profile.tiersPaid = { nights: 1, streak: 1 };
  state.history['2026-07-28'] = { total: 3, done: 3, pct: 100, xp: 30 };
  state.profile.settings.bedtime = '01:00';
  state.profile.inventory.themes.push('aurora');
  state.profile.tokens = { freeze: 4, raincheck: 6 };
  return state;
}

test('each part only takes its own', () => {
  const state = loaded();

  applyReset(state, ['history']);
  assert.deepEqual(state.history, {});
  assert.equal(state.profile.xp, 900, 'history is not progress');
  assert.equal(state.profile.stardust, 300);
  assert.equal(state.profile.settings.bedtime, '01:00');

  applyReset(state, ['unlocks']);
  assert.deepEqual(state.profile.inventory.themes, ['midnight']);
  assert.deepEqual(state.profile.tokens, { freeze: 1, raincheck: 2 });
  assert.equal(state.profile.stardust, 300, 'the balance is a separate choice');
  assert.equal(state.profile.xp, 900, 'unlocks are not progress either');
  assert.equal(state.profile.streak, 6);

  applyReset(state, ['stardust']);
  assert.equal(state.profile.stardust, 0);
  assert.equal(state.profile.xp, 900, 'and spending money is not losing XP');

  applyReset(state, ['progress']);
  assert.equal(state.profile.xp, 0);
  assert.equal(state.profile.level, 1);
  assert.deepEqual(state.profile.tiers, {});
  assert.deepEqual(state.profile.tiersBanked, {});
  assert.deepEqual(state.profile.tiersPaid, {}, 'or refilling the shelf would earn nothing');
  assert.equal(state.profile.streak, 6, 'the streak is its own option now');
  assert.equal(state.profile.settings.bedtime, '01:00', 'settings are still yours');

  applyReset(state, ['settings']);
  assert.equal(state.profile.settings.bedtime, '23:30');
  assert.ok(Object.keys(state.template.tasks).length > 0, 'and the list was never touched');
});

test('resetting the streak leaves everything you earned alone', () => {
  const state = loaded();
  applyReset(state, ['streaks']);

  assert.equal(state.profile.streak, 0, 'current');
  assert.equal(state.profile.bestStreak, 0, 'and best, or the number would never be beatable');
  assert.deepEqual(state.profile.lightsOut, { streak: 0, best: 0, lastKey: null },
    'both streaks go together — they are one idea counted two ways');

  assert.equal(state.profile.xp, 900, 'XP is not a streak');
  assert.equal(state.profile.level, 4);
  assert.equal(state.profile.stardust, 300);
  assert.deepEqual(state.profile.tiers, { nights: 1, streak: 1 },
    'holding a streak once is something you did, not somewhere you are');
  assert.ok(state.history['2026-07-28'], 'and the nights themselves still happened');
});

test('a fresh streak starts from tonight rather than continuing', () => {
  const state = loaded();
  applyReset(state, ['streaks']);
  state.profile.lastBankedKey = '2026-07-28';
  bankNight(state, computeStats(state));
  assert.equal(state.profile.streak, 0, 'an empty night does not resurrect the old number');
});

test('clearing the list clears what was ticked on it', () => {
  replaceState(fresh());
  const ids = Object.keys(getState().template.tasks);
  toggleTask(ids[0]);
  toggleTask(ids[1]);

  applyReset(getState(), ['tasks']);
  assert.deepEqual(getState().template.order, []);
  assert.deepEqual(getState().night.done, {});
  assert.equal(getState().profile.xp, 0, 'and the XP those two paid');
});

test('an unknown id is ignored rather than throwing', () => {
  const state = fresh();
  assert.deepEqual(applyReset(state, ['nonsense']), []);
  assert.deepEqual(applyReset(state, ['settings', 'nonsense']), ['settings']);
});

test('every part has copy for the picker', () => {
  for (const part of RESET_PARTS) {
    assert.ok(part.id && part.label && part.hint, `${part.id} needs a label and a hint`);
  }
});
