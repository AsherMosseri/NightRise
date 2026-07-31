/* Achievements as tiered families: where a measure puts you, what it pays,
   and what it takes back. */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACHIEVEMENTS, achievementById, tierAt, heldTier, tierState, achievementBoard,
  checkAchievements, dropUnearnedTiers, totalTiers, tierDust, migrateBadges,
} from '../js/achievements.js';
import { createInitialState } from '../js/model.js';
import { COMBO_MAX, comboMultiplier } from '../js/game.js';
import { computeStats } from '../js/night.js';

function fresh() {
  return createInitialState(new Date(2026, 6, 29, 22, 0));
}

/* ------------------------------------------------------------------ shape */

test('every family is a ladder that only ever climbs', () => {
  for (const family of ACHIEVEMENTS) {
    assert.ok(family.tiers.length >= 3, `${family.id} should have room to grow`);
    for (let i = 1; i < family.tiers.length; i += 1) {
      assert.ok(family.tiers[i].at > family.tiers[i - 1].at,
        `${family.id} tier ${i + 1} must be harder than tier ${i}`);
    }
  }
});

test('the wording of a tier is generated from the number it checks', () => {
  // The whole point of `goal(at)`: a hint cannot say seven while the
  // comparison says three, because both read the same field.
  const streak = achievementById('streak');
  assert.match(streak.goal(streak.tiers[1].at), /7/);
  assert.match(streak.goal(30), /30/);
  for (const family of ACHIEVEMENTS) {
    for (const step of family.tiers) {
      assert.equal(typeof family.goal(step.at), 'string');
      assert.ok(family.goal(step.at).length > 0, `${family.id} has an empty hint`);
    }
  }
});

test('a measure lands on the highest tier it has passed', () => {
  const streak = achievementById('streak');
  assert.equal(tierAt(streak, 0), 0);
  assert.equal(tierAt(streak, 2), 0, 'two nights is not three');
  assert.equal(tierAt(streak, 3), 1);
  assert.equal(tierAt(streak, 29), 3);
  assert.equal(tierAt(streak, 1000), streak.tiers.length, 'and it stops at the top');
});

test('the multiplier the game actually produces lands on its tier', () => {
  const combo = achievementById('combo');
  assert.equal(tierAt(combo, comboMultiplier(3)), 1, 'a chain of three is x1.5');
  assert.equal(tierAt(combo, comboMultiplier(5)), 2);
  assert.equal(tierAt(combo, comboMultiplier(99)), 3, 'and the cap is the top rung');
  // 0.25 happens to be exact in binary, so this is not the usual floating-point
  // trap — but the combo thresholds are the only fractional ones in the app,
  // and tierAt compares with a hair of tolerance so they cannot miss by an ulp.
  assert.equal(tierAt(combo, COMBO_MAX - 1e-12), 3);
});

/* --------------------------------------------------------------- progress */

test('a card knows how far into the next tier you are', () => {
  const state = fresh();
  state.profile.bestStreak = 5; // between tier 1 (3) and tier 2 (7)
  checkAchievements(state, computeStats(state));
  const card = tierState(achievementById('streak'), state, computeStats(state));
  assert.equal(card.tier, 1);
  assert.equal(card.name, 'Three in a Row');
  assert.equal(card.progress, '5 / 7');
  assert.equal(card.pct, 50, 'two of the four nights between the rungs');
  assert.match(card.goal, /7/);
});

test('a locked family shows the rung you are climbing toward, not a blank', () => {
  const state = fresh();
  const card = tierState(achievementById('streak'), state, computeStats(state));
  assert.equal(card.tier, 0);
  assert.equal(card.earned, false);
  assert.equal(card.name, 'Three in a Row', 'you can see what you are working on');
  assert.equal(card.progress, '0 / 3');
  assert.equal(card.pct, 0);
});

test('the name of a tier you have not reached is not on the card anywhere', () => {
  const state = fresh();
  state.profile.bestStreak = 3;
  checkAchievements(state, computeStats(state));
  const card = tierState(achievementById('streak'), state, computeStats(state));
  const shown = `${card.name} ${card.goal} ${card.progress}`;
  for (const step of achievementById('streak').tiers.slice(1)) {
    assert.equal(shown.includes(step.name), false,
      `"${step.name}" should stay a surprise until you get there`);
  }
});

test('a maxed family says so instead of inventing a next rung', () => {
  const state = fresh();
  state.profile.bestStreak = 5000;
  checkAchievements(state, computeStats(state));
  const card = tierState(achievementById('streak'), state, computeStats(state));
  assert.equal(card.complete, true);
  assert.equal(card.next, null);
  assert.equal(card.pct, 100);
  assert.equal(card.tier, card.tiers);
});

test('a card never claims a tier the profile has not recorded', () => {
  const state = fresh();
  // A measure that has raced ahead of the profile: an old save migrated, or a
  // night banked in another tab. Until it is settled the card must not boast.
  state.profile.bestStreak = 30;
  const before = tierState(achievementById('streak'), state, computeStats(state));
  assert.equal(before.tier, 0, 'nothing is held yet, so nothing is shown');

  checkAchievements(state, computeStats(state));
  const after = tierState(achievementById('streak'), state, computeStats(state));
  assert.equal(after.tier, 4);
  assert.equal(after.tier, heldTier(state.profile, 'streak'), 'card and profile agree');
});

test('a scale that does not start at zero does not start the bar part-full', () => {
  const state = fresh();
  // The combo multiplier bottoms out at x1 and a companion-less profile still
  // carries tier 1. Neither is progress.
  assert.equal(tierState(achievementById('combo'), state, null).pct, 0);
  assert.equal(tierState(achievementById('companion'), state, null).pct, 0);
  assert.equal(tierState(achievementById('companion'), state, null).measure, 0);

  state.profile.companion = { type: 'owl', name: 'Ash', tier: 1, fed: 0 };
  assert.equal(tierState(achievementById('companion'), state, null).measure, 1);
  assert.equal(tierState(achievementById('companion'), state, null).pct, 50);
});

test('the board covers every family, in order', () => {
  const board = achievementBoard(fresh(), null);
  assert.equal(board.length, ACHIEVEMENTS.length);
  assert.deepEqual(board.map((c) => c.id), ACHIEVEMENTS.map((f) => f.id));
});

/* ---------------------------------------------------------------- earning */

test('crossing several rungs at once reports each of them', () => {
  const state = fresh();
  state.profile.bestStreak = 14;
  const earned = checkAchievements(state, computeStats(state));
  const streak = earned.filter((e) => e.id === 'streak');
  assert.deepEqual(streak.map((e) => e.tier), [1, 2, 3]);
  assert.deepEqual(streak.map((e) => e.name),
    ['Three in a Row', 'Week of Nights', 'Fortnight']);
  assert.equal(heldTier(state.profile, 'streak'), 3);
});

test('a tier is only ever paid for once', () => {
  const state = fresh();
  state.profile.bestStreak = 3;
  const first = checkAchievements(state, computeStats(state));
  const paid = first.find((e) => e.id === 'streak').dust;
  assert.equal(paid, tierDust(1));
  assert.equal(state.profile.stardust, paid);

  assert.deepEqual(checkAchievements(state, computeStats(state)), [], 'nothing new');
  assert.equal(state.profile.stardust, paid, 'and no second payment');
});

test('losing a tier and earning it back does not pay twice', () => {
  const state = fresh();
  state.profile.level = 5;
  checkAchievements(state, computeStats(state));
  const after = state.profile.stardust;

  state.profile.level = 2;
  dropUnearnedTiers(state);
  assert.equal(heldTier(state.profile, 'level'), 0);

  state.profile.level = 5;
  checkAchievements(state, computeStats(state));
  assert.equal(heldTier(state.profile, 'level'), 1, 'you hold it again');
  assert.equal(state.profile.stardust, after, 'but the shelf is not a faucet');
});

test('only the level ladder can be fallen out of', () => {
  const state = fresh();
  state.profile.level = 10;
  state.profile.bestStreak = 30;
  state.profile.nightsLogged = 40;
  checkAchievements(state, computeStats(state));

  // The numbers behind the other two cannot fall on their own, and a drop in
  // level must not drag them down with it.
  state.profile.level = 1;
  const lost = dropUnearnedTiers(state);
  assert.deepEqual(lost.map((l) => l.name), ['Deep Sky', 'Skyward'], 'top rung first');
  assert.equal(heldTier(state.profile, 'level'), 0);
  assert.equal(heldTier(state.profile, 'streak'), 4, 'the streak you held is still held');
  assert.equal(heldTier(state.profile, 'nights'), 3);
});

test('clearing the list tonight counts before 4am comes round', () => {
  const state = fresh();
  const tasks = Object.values(state.template.tasks);
  for (const task of tasks) state.night.done[task.id] = Date.now();
  const earned = checkAchievements(state, computeStats(state));
  assert.equal(earned.find((e) => e.id === 'cleared')?.name, 'Nothing Missed',
    'the reward for clearing the list should not wait until the morning');
});

test('a rain check does not clear the list', () => {
  const state = fresh();
  const tasks = Object.values(state.template.tasks);
  for (const task of tasks.slice(1)) state.night.done[task.id] = Date.now();
  state.night.skipped[tasks[0].id] = true;
  const stats = computeStats(state);
  assert.equal(stats.pct, 100, 'the percentage forgives it');
  checkAchievements(state, stats);
  assert.equal(heldTier(state.profile, 'cleared'), 0, 'the achievement does not');
});

test('the best combo outlives the night it happened in', () => {
  const state = fresh();
  state.night.maxCombo = COMBO_MAX;
  checkAchievements(state, computeStats(state));
  assert.equal(heldTier(state.profile, 'combo'), 3);

  state.night.maxCombo = 1; // a new night
  assert.equal(tierState(achievementById('combo'), state, null).measure, COMBO_MAX);
});

test('the four free packs are not an achievement', () => {
  const state = fresh();
  checkAchievements(state, computeStats(state));
  assert.equal(heldTier(state.profile, 'collector'), 0, 'you were given those');

  state.profile.inventory.themes.push('aurora');
  checkAchievements(state, computeStats(state));
  assert.equal(heldTier(state.profile, 'collector'), 1, 'this one you bought');
});

test('tiers earned counts every rung across every family', () => {
  const state = fresh();
  state.profile.bestStreak = 7;
  state.profile.nightsLogged = 10;
  checkAchievements(state, computeStats(state));
  assert.equal(totalTiers(state.profile), 4, 'two streak rungs and two night rungs');
});

/* -------------------------------------------------------------- old saves */

test('an old badge becomes the rung it stood for', () => {
  assert.deepEqual(migrateBadges(['streak-30', 'on-time-3', 'first-night']),
    { streak: 4, ontime: 2, nights: 1 });
});

test('the highest badge in a family wins, whatever order they were saved in', () => {
  assert.deepEqual(migrateBadges(['streak-30', 'streak-3']), { streak: 4 });
  assert.deepEqual(migrateBadges(['streak-3', 'streak-30']), { streak: 4 });
});

test('a badge the app retired maps to nothing at all', () => {
  assert.deepEqual(migrateBadges(['after-hours']), {});
  assert.deepEqual(migrateBadges(null), {});
  assert.deepEqual(migrateBadges(['not-a-badge', 'perfect']), { cleared: 1 });
});

/* ---------------------------------------------------- on loan until 4am */

test('a rung tonight is holding up goes back when you un-tick', () => {
  const state = fresh();
  const tasks = Object.values(state.template.tasks);
  for (const task of tasks) state.night.done[task.id] = Date.now();
  checkAchievements(state, computeStats(state));
  assert.equal(heldTier(state.profile, 'cleared'), 1, 'Nothing Missed, for clearing the list');

  delete state.night.done[tasks[0].id];
  const lost = dropUnearnedTiers(state, computeStats(state));
  assert.deepEqual(lost.map((l) => l.name), ['Nothing Missed']);
  assert.equal(heldTier(state.profile, 'cleared'), 0,
    'nothing you can un-tick leaves you holding what it paid for');
});

test('once a night is banked the rung is yours, un-tick what you like', () => {
  const state = fresh();
  state.history['2026-07-28'] = { total: 4, done: 4, skipped: 0, pct: 100, xp: 40 };
  checkAchievements(state, computeStats(state));
  assert.equal(heldTier(state.profile, 'cleared'), 1);

  // Tonight is untouched and it does not matter: the floor is what was banked.
  assert.deepEqual(dropUnearnedTiers(state, computeStats(state)), []);
  assert.equal(heldTier(state.profile, 'cleared'), 1);
});

test('wiping the history that proved a rung does not take the rung', () => {
  const state = fresh();
  state.history['2026-07-28'] = { total: 4, done: 4, skipped: 0, pct: 100, xp: 40 };
  checkAchievements(state, computeStats(state));

  state.history = {}; // the Night history checkbox, not an un-tick
  assert.deepEqual(dropUnearnedTiers(state, computeStats(state)), [],
    'a reset has its own checkbox and must not take a rung through the back door');
  assert.equal(heldTier(state.profile, 'cleared'), 1);
});

test('getting a loaned rung back does not pay for it twice', () => {
  const state = fresh();
  const tasks = Object.values(state.template.tasks);
  const clear = () => { for (const t of tasks) state.night.done[t.id] = Date.now(); };

  clear();
  checkAchievements(state, computeStats(state));
  const paid = state.profile.stardust;
  assert.equal(paid, tierDust(1));

  delete state.night.done[tasks[0].id];
  dropUnearnedTiers(state, computeStats(state));
  clear();
  const again = checkAchievements(state, computeStats(state));
  assert.equal(again.find((e) => e.id === 'cleared').dust, 0, 'earned back, but free');
  assert.equal(state.profile.stardust, paid);
});

test('every family says which of the two kinds it is', () => {
  // The rule the whole design rests on: a rung comes off only if you can undo
  // the thing that earned it with a tap. Exactly two families can.
  const undoable = ACHIEVEMENTS.filter((f) => f.floor).map((f) => f.id);
  assert.deepEqual(undoable, ['cleared', 'level']);
});
