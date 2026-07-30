/* Losing a level, and resetting one part of the app without the rest. */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createInitialState } from '../js/model.js';
import {
  grantXp, revokeGrant, levelUpDust, levelFromXp, xpForLevel, checkBadges,
} from '../js/game.js';
import { applyReset, RESET_PARTS } from '../js/reset.js';
import { computeStats } from '../js/night.js';
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

test('a level badge comes off with the level', () => {
  const state = fresh();
  const xp = xpToReach(5);
  grantXp(state, xp);
  checkBadges(state, computeStats(state));
  assert.ok(state.profile.badges.includes('level-5'), 'earned at level 5');

  revokeGrant(state, xp, 0);
  assert.ok(state.profile.level < 5);
  assert.equal(state.profile.badges.includes('level-5'), false, 'and gone again below it');
});

test('a badge you actually did something for is not taken away', () => {
  const state = fresh();
  state.profile.nightsLogged = 1;
  const xp = xpToReach(5);
  grantXp(state, xp);
  checkBadges(state, computeStats(state));
  assert.ok(state.profile.badges.includes('first-night'));

  revokeGrant(state, xp, 0);
  assert.ok(state.profile.badges.includes('first-night'), 'banking that night still happened');
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

test('checking everything and resetting on a loop earns nothing', () => {
  replaceState(fresh());
  const ids = Object.keys(getState().template.tasks);
  for (let round = 0; round < 4; round += 1) {
    for (const id of ids) toggleTask(id);
    applyReset(getState(), ['checks']);
  }
  assert.equal(getState().profile.xp, 0);
  assert.equal(getState().profile.stardust, 0);
  assert.equal(getState().profile.level, 1);
});

test('each part only takes its own', () => {
  const state = fresh();
  state.profile.xp = 900;
  state.profile.level = 4;
  state.profile.stardust = 300;
  state.profile.streak = 6;
  state.profile.badges = ['first-night'];
  state.history['2026-07-28'] = { total: 3, done: 3, pct: 100, xp: 30 };
  state.profile.settings.bedtime = '01:00';
  state.profile.inventory.themes.push('aurora');

  applyReset(state, ['history']);
  assert.deepEqual(state.history, {});
  assert.equal(state.profile.xp, 900, 'history is not progress');
  assert.equal(state.profile.stardust, 300);
  assert.equal(state.profile.settings.bedtime, '01:00');

  applyReset(state, ['unlocks']);
  assert.equal(state.profile.stardust, 0);
  assert.deepEqual(state.profile.inventory.themes, ['midnight']);
  assert.equal(state.profile.xp, 900, 'unlocks are not progress either');
  assert.equal(state.profile.streak, 6);

  applyReset(state, ['progress']);
  assert.equal(state.profile.xp, 0);
  assert.equal(state.profile.level, 1);
  assert.equal(state.profile.streak, 0);
  assert.deepEqual(state.profile.badges, []);
  assert.equal(state.profile.settings.bedtime, '01:00', 'settings are still yours');

  applyReset(state, ['settings']);
  assert.equal(state.profile.settings.bedtime, '23:30');
  assert.ok(Object.keys(state.template.tasks).length > 0, 'and the list was never touched');
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
