import test from 'node:test';
import assert from 'node:assert/strict';

import {
  xpForLevel, levelFromXp, titleForLevel, nextTitle, comboMultiplier, taskXp,
  stardustFor, grantXp, applyTaskCompletion, revokeTaskCompletion, chainLengthFor,
  nightCompletionBonus, checkBadges, COMBO_MAX, MOMENTUM_MIN_GAP_MS, momentumWindow,
} from '../js/game.js';
import { createInitialState } from '../js/model.js';

test('the level curve is monotonic and starts where we expect', () => {
  assert.equal(xpForLevel(1), 80);
  for (let level = 1; level < 30; level += 1) {
    assert.ok(xpForLevel(level + 1) > xpForLevel(level), `level ${level} should cost less than ${level + 1}`);
  }
});

test('levelFromXp inverts the curve', () => {
  assert.deepEqual(levelFromXp(0).level, 1);
  assert.equal(levelFromXp(xpForLevel(1) - 1).level, 1);
  assert.equal(levelFromXp(xpForLevel(1)).level, 2);
  assert.equal(levelFromXp(xpForLevel(1) + xpForLevel(2)).level, 3);
  const at = levelFromXp(xpForLevel(1) + 10);
  assert.equal(at.into, 10);
  assert.equal(at.need, xpForLevel(2));
});

test('titles unlock at their levels', () => {
  assert.equal(titleForLevel(1), 'Dreamer');
  assert.equal(titleForLevel(4), 'Night Owl');
  assert.equal(titleForLevel(5), 'Star Gazer');
  assert.equal(titleForLevel(99), 'Keeper of the Long Dark');
  assert.equal(nextTitle(1).name, 'Night Owl');
  assert.equal(nextTitle(99), null);
});

test('the combo multiplier steps up and caps', () => {
  assert.equal(comboMultiplier(1), 1);
  assert.equal(comboMultiplier(2), 1.25);
  assert.equal(comboMultiplier(5), 2);
  assert.equal(comboMultiplier(50), COMBO_MAX);
});

test('task xp scales with minutes and multiplier', () => {
  assert.equal(taskXp(5), 15);
  assert.equal(taskXp(5, 2), 30);
  assert.equal(taskXp(0), 10);
  assert.equal(stardustFor(15), 3);
});

test('granting xp levels up and pays a stardust bonus', () => {
  const state = createInitialState();
  const levels = grantXp(state, xpForLevel(1) + xpForLevel(2));
  assert.deepEqual(levels, [2, 3]);
  assert.equal(state.profile.level, 3);
  assert.ok(state.profile.stardust > 0, 'level ups should pay stardust');
});

test('momentum needs a gap long enough to have actually done something', () => {
  const night = { lastDoneAt: 1_000_000, combo: 1.25 };
  const tooFast = 1_000_000 + MOMENTUM_MIN_GAP_MS - 1;
  assert.equal(chainLengthFor(night, tooFast, 5), 1, 'machine-gun tapping is not momentum');
  assert.equal(chainLengthFor(night, 1_000_000 + 60_000, 5), 3, 'a real minute of work continues it');
  assert.equal(chainLengthFor({ lastDoneAt: 0, combo: 1 }, 5000, 0), 1, 'the first task starts at x1');
});

test('momentum lapses once you have drifted off', () => {
  const night = { lastDoneAt: 1_000_000, combo: 1.5 };
  const window = momentumWindow(5);
  assert.equal(chainLengthFor(night, 1_000_000 + window - 1000, 5), 4);
  assert.equal(chainLengthFor(night, 1_000_000 + window + 1000, 5), 1);
});

test('a longer task buys a longer window', () => {
  assert.ok(momentumWindow(30) > momentumWindow(2));
  assert.ok(momentumWindow(0) >= 4 * 60 * 1000, 'even a 0-minute task gets a usable window');
  assert.ok(momentumWindow(600) <= 30 * 60 * 1000, 'but the window is capped');
});

test('completing then un-completing a task leaves no trace', () => {
  const state = createInitialState();
  const task = Object.values(state.template.tasks)[0];
  const before = { xp: state.profile.xp, dust: state.profile.stardust };

  const award = applyTaskCompletion(state, task, 10_000);
  assert.ok(award.xp > 0);
  assert.equal(state.profile.xp, before.xp + award.xp);
  assert.ok(state.night.done[task.id]);

  revokeTaskCompletion(state, task.id);
  assert.equal(state.profile.xp, before.xp);
  assert.equal(state.profile.stardust, before.dust);
  assert.equal(state.night.done[task.id], undefined);
  assert.equal(state.night.awards[task.id], undefined);
});

test('working steadily through the list builds momentum', () => {
  const state = createInitialState();
  const [a, b, c] = Object.values(state.template.tasks);
  const first = applyTaskCompletion(state, a, 1_000_000);
  const second = applyTaskCompletion(state, b, 1_120_000); // two minutes later
  const third = applyTaskCompletion(state, c, 1_300_000); // three more
  assert.equal(first.multiplier, 1);
  assert.equal(second.multiplier, 1.25);
  assert.equal(third.multiplier, 1.5);
  assert.equal(state.night.maxCombo, 1.5);
});

test('rattling through the checkboxes without doing anything earns nothing extra', () => {
  const state = createInitialState();
  const tasks = Object.values(state.template.tasks);
  let at = 1_000_000;
  const multipliers = tasks.slice(0, 5).map((task) => {
    at += 2000; // two seconds apart
    return applyTaskCompletion(state, task, at).multiplier;
  });
  assert.deepEqual(multipliers, [1, 1, 1, 1, 1]);
  assert.equal(state.night.maxCombo, 1);
});

test('wandering off for half an hour drops the momentum', () => {
  const state = createInitialState();
  const [a, b] = Object.values(state.template.tasks);
  applyTaskCompletion(state, a, 1_000_000);
  const second = applyTaskCompletion(state, b, 1_000_000 + 40 * 60 * 1000);
  assert.equal(second.multiplier, 1);
});

test('un-checking the newest task hands the momentum back', () => {
  const state = createInitialState();
  const [a, b, c] = Object.values(state.template.tasks);
  applyTaskCompletion(state, a, 1_000_000);
  applyTaskCompletion(state, b, 1_120_000);
  assert.equal(state.night.combo, 1.25);

  revokeTaskCompletion(state, b.id);
  assert.equal(state.night.combo, 1, 'back to where the chain was');
  assert.equal(state.night.lastDoneAt, 1_000_000);

  // and it does not ratchet: re-doing the same work gives the same multiplier
  const again = applyTaskCompletion(state, c, 1_120_000);
  assert.equal(again.multiplier, 1.25);
});

test('the completion bonus grows with the size of the night', () => {
  assert.ok(nightCompletionBonus({ total: 12 }).xp > nightCompletionBonus({ total: 3 }).xp);
});

test('badges are only ever awarded once', () => {
  const state = createInitialState();
  state.profile.streak = 7;
  state.profile.nightsLogged = 2;
  const first = checkBadges(state, { total: 4, remaining: 2 });
  assert.ok(first.includes('streak-3'));
  assert.ok(first.includes('streak-7'));
  const second = checkBadges(state, { total: 4, remaining: 2 });
  assert.deepEqual(second, []);
});
