import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeStats, bankNight, rolloverIfNeeded, forceNewNight, effectiveStreak,
  advanceLightsOutStreak,
} from '../js/night.js';
import { createInitialState } from '../js/model.js';
import { applyTaskCompletion } from '../js/game.js';
import { ACHIEVEMENTS, checkAchievements, heldTier } from '../js/achievements.js';
import { normalizeState } from '../js/storage.js';
import { openEnvelope, envelopeWaiting } from '../js/envelope.js';

function stateWithProgress(doneCount, skipCount = 0) {
  const state = createInitialState(new Date(2026, 6, 29, 22, 0));
  const tasks = Object.values(state.template.tasks);
  for (let i = 0; i < doneCount; i += 1) applyTaskCompletion(state, tasks[i], 1_000_000 + 1000 * i);
  for (let i = 0; i < skipCount; i += 1) state.night.skipped[tasks[tasks.length - 1 - i].id] = true;
  return state;
}

test('stats count done, skipped and remaining minutes', () => {
  const state = stateWithProgress(2, 1);
  const stats = computeStats(state);
  assert.equal(stats.total, 11);
  assert.equal(stats.done, 2);
  assert.equal(stats.skipped, 1);
  assert.equal(stats.remaining, 8);
  assert.equal(stats.counted, 10);
  assert.equal(stats.pct, 20);
  assert.ok(stats.minutesRemaining > 0);
  assert.equal(stats.sections.length, 3);
});

test('rain checks lift the percentage because they leave the denominator', () => {
  const withoutSkip = computeStats(stateWithProgress(5));
  const withSkip = computeStats(stateWithProgress(5, 3));
  assert.ok(withSkip.pct > withoutSkip.pct);
});

test('a good night extends the streak', () => {
  const state = stateWithProgress(9);
  state.profile.streak = 4;
  state.profile.lastBankedKey = '2026-07-28';
  const result = bankNight(state, computeStats(state));
  assert.equal(result.met, true);
  assert.equal(state.profile.streak, 5);
  assert.equal(state.profile.bestStreak, 5);
  assert.equal(state.history['2026-07-29'].done, 9);
  assert.equal(state.profile.lastBankedKey, '2026-07-29');
});

test('a bad night with no freeze resets the streak', () => {
  const state = stateWithProgress(1);
  state.profile.streak = 6;
  state.profile.tokens.freeze = 0;
  state.profile.lastBankedKey = '2026-07-28';
  const result = bankNight(state, computeStats(state));
  assert.equal(result.met, false);
  assert.equal(state.profile.streak, 0);
});

test('a freeze covers a bad night and is spent', () => {
  const state = stateWithProgress(1);
  state.profile.streak = 6;
  state.profile.tokens.freeze = 1;
  state.profile.lastBankedKey = '2026-07-28';
  const result = bankNight(state, computeStats(state));
  assert.equal(result.frozenUsed, 1);
  assert.equal(state.profile.tokens.freeze, 0);
  assert.equal(state.profile.streak, 6, 'the streak is protected, not advanced');
  assert.equal(state.history['2026-07-29'].frozen, true);
});

test('nights where the app was never opened count as missed', () => {
  const state = stateWithProgress(9);
  state.profile.streak = 5;
  state.profile.tokens.freeze = 1;
  state.profile.lastBankedKey = '2026-07-25'; // three nights unopened
  const result = bankNight(state, computeStats(state));
  assert.equal(result.missedNights, 3);
  assert.equal(result.frozenUsed, 0, 'one freeze cannot cover three nights');
  assert.equal(state.profile.streak, 1);
});

test('freezes cover a gap when there are enough of them', () => {
  const state = stateWithProgress(9);
  state.profile.streak = 5;
  state.profile.tokens.freeze = 3;
  state.profile.lastBankedKey = '2026-07-27';
  const result = bankNight(state, computeStats(state));
  assert.equal(result.missedNights, 1);
  assert.equal(result.frozenUsed, 1);
  assert.equal(state.profile.tokens.freeze, 2);
  assert.equal(state.profile.streak, 6);
});

test('an empty list is not judged', () => {
  const state = createInitialState(new Date(2026, 6, 29, 22, 0));
  state.template = { order: [], sections: {}, tasks: {} };
  state.profile.streak = 3;
  const result = bankNight(state, computeStats(state));
  assert.equal(state.profile.streak, 3);
  assert.equal(state.history['2026-07-29'], undefined);
  assert.equal(result.missedNights, 0);
});

test('banking records how a task did, and forgets deleted tasks', () => {
  const state = stateWithProgress(2);
  const tasks = Object.values(state.template.tasks);
  bankNight(state, computeStats(state));
  assert.equal(state.profile.taskStats[tasks[0].id].done, 1);
  assert.equal(state.profile.taskStats[tasks[5].id].missStreak, 1);

  // A deleted task is forgotten the next time a night is banked.
  const goneId = tasks[5].id;
  delete state.template.tasks[goneId];
  state.night = { ...state.night, key: '2026-07-30', done: {}, skipped: {}, awards: {} };
  bankNight(state, computeStats(state));
  assert.equal(state.profile.taskStats[goneId], undefined);
});

test('a night key is never banked twice', () => {
  const state = stateWithProgress(9);
  state.profile.streak = 4;
  state.profile.lastBankedKey = '2026-07-28';
  const first = bankNight(state, computeStats(state));
  assert.equal(first.alreadyBanked, false);
  const banked = { ...state.history['2026-07-29'] };
  const streak = state.profile.streak;
  const logged = state.profile.nightsLogged;

  // Simulate the state "start a fresh night" used to leave behind.
  state.night = { ...state.night, done: {}, skipped: {}, awards: {} };
  const second = bankNight(state, computeStats(state));
  assert.equal(second.alreadyBanked, true);
  assert.deepEqual(state.history['2026-07-29'], banked, 'history survives');
  assert.equal(state.profile.streak, streak, 'the streak is not reset');
  assert.equal(state.profile.nightsLogged, logged, 'the night is not counted twice');
  assert.equal(state.profile.tokens.freeze, 1, 'no freeze is burned');
});

test('starting a fresh night stays on tonight', () => {
  const state = stateWithProgress(9);
  forceNewNight(state, null, new Date(2026, 6, 29, 22, 0));
  assert.equal(state.night.key, '2026-07-29', 'it is still tonight, not tomorrow');
  assert.deepEqual(state.night.done, {}, 'with a clean list');
  assert.ok(state.history['2026-07-29'], 'and the finished night was banked');
});

test('4am after a fresh start rolls the night without re-banking it', () => {
  const state = stateWithProgress(9);
  forceNewNight(state, null, new Date(2026, 6, 29, 22, 0));
  const streak = state.profile.streak;
  const logged = state.profile.nightsLogged;
  const banked = { ...state.history['2026-07-29'] };

  rolloverIfNeeded(state, new Date(2026, 6, 30, 5, 0));
  assert.equal(state.night.key, '2026-07-30', 'tomorrow starts normally');
  assert.equal(state.profile.streak, streak, 'the streak is not touched twice');
  assert.equal(state.profile.nightsLogged, logged);
  assert.deepEqual(state.history['2026-07-29'], banked, 'the empty second run did not overwrite it');
});

test('a second run at the same night can only improve its history entry', () => {
  const state = stateWithProgress(9);
  forceNewNight(state, null, new Date(2026, 6, 29, 22, 0));
  const first = { ...state.history['2026-07-29'] };
  assert.ok(first.pct > 0);

  // Do every task this time round, then let 4am bank it.
  for (const id of Object.keys(state.template.tasks)) state.night.done[id] = Date.now();
  rolloverIfNeeded(state, new Date(2026, 6, 30, 5, 0));
  const second = state.history['2026-07-29'];
  assert.equal(second.pct, 100, 'the better run is what the date is remembered by');
  assert.ok(second.done > first.done);
  assert.equal(state.profile.nightsLogged, 1, 'still one night, counted once');
});

test('starting fresh does not hand out a second envelope or quest reward', () => {
  const state = stateWithProgress(9);
  openEnvelope(state);
  // This profile has banked a night before, and its First Light tier is already
  // settled — so the stardust below can only move if the envelope paid again.
  state.profile.nightsLogged = 1;
  checkAchievements(state, computeStats(state));
  const dust = state.profile.stardust;
  const freezes = state.profile.tokens.freeze;
  const rainchecks = state.profile.tokens.raincheck;

  forceNewNight(state, null, new Date(2026, 6, 29, 22, 0));
  assert.equal(envelopeWaiting(state), false, 'the same night owes you nothing more');
  assert.equal(openEnvelope(state), null);
  assert.equal(state.profile.stardust, dust);
  assert.equal(state.profile.tokens.freeze, freezes);
  assert.equal(state.profile.tokens.raincheck, rainchecks);

  // A real new night is a different story.
  rolloverIfNeeded(state, new Date(2026, 6, 30, 5, 0));
  assert.equal(envelopeWaiting(state), true);
});

test('a night dated tomorrow is pulled back to tonight, not banked', () => {
  const state = stateWithProgress(9);
  state.night.key = '2026-07-30'; // what the old "start fresh" left behind
  const banked = Object.keys(state.history).length;

  assert.equal(rolloverIfNeeded(state, new Date(2026, 6, 29, 21, 30)), null);
  assert.equal(state.night.key, '2026-07-29', 'the header stops claiming it is tomorrow');
  assert.equal(Object.keys(state.history).length, banked, 'nothing ended, so nothing was banked');
});

test('a clock that jumps backwards never re-banks an old night', () => {
  const state = stateWithProgress(9);
  state.profile.lastBankedKey = '2026-07-28';
  const before = { ...state.night };
  assert.equal(rolloverIfNeeded(state, new Date(2026, 6, 20, 22, 0)), null);
  assert.equal(state.night.key, before.key, 'tonight is left alone');
  assert.equal(state.history['2026-07-20'], undefined);
});

test('rollover only fires once the night key changes', () => {
  const state = createInitialState(new Date(2026, 6, 29, 22, 0));
  assert.equal(rolloverIfNeeded(state, new Date(2026, 6, 30, 1, 0)), null, 'still the same night at 1am');

  const result = rolloverIfNeeded(state, new Date(2026, 6, 30, 5, 0));
  assert.ok(result, 'past 4am it rolls');
  assert.equal(state.night.key, '2026-07-30');
  assert.deepEqual(state.night.done, {});
  assert.ok(state.night.quest);
});

test('a forced new night banks the old one', () => {
  const state = stateWithProgress(9);
  forceNewNight(state, '2026-07-30');
  assert.equal(state.night.key, '2026-07-30');
  assert.ok(state.history['2026-07-29']);
  assert.deepEqual(state.night.done, {});
});

test('the streak shown after an absence is the honest one', () => {
  const state = stateWithProgress(0);
  state.profile.streak = 9;
  state.profile.tokens.freeze = 0;
  state.profile.lastBankedKey = '2026-07-25'; // three nights ago

  const live = effectiveStreak(state, new Date(2026, 6, 29, 22, 0));
  assert.equal(live.missed, 3);
  assert.equal(live.streak, 0, 'nothing covers it, so say so now');
  assert.equal(live.atRisk, true);
});

test('freezes you hold are counted before the streak is written off', () => {
  const state = stateWithProgress(0);
  state.profile.streak = 9;
  state.profile.tokens.freeze = 3;
  state.profile.lastBankedKey = '2026-07-26'; // two nights missed

  const live = effectiveStreak(state, new Date(2026, 6, 29, 22, 0));
  assert.equal(live.missed, 2);
  assert.equal(live.covered, 2);
  assert.equal(live.streak, 9, 'covered, so it still stands');
  assert.equal(live.atRisk, true);
});

test('an unbroken run reports no risk', () => {
  const state = stateWithProgress(0);
  state.profile.streak = 4;
  state.profile.lastBankedKey = '2026-07-28';
  const live = effectiveStreak(state, new Date(2026, 6, 29, 22, 0));
  assert.deepEqual(live, { streak: 4, missed: 0, covered: 0, atRisk: false });
});

/* --------------------------------------------------------------- badges */

test('there is no achievement for still being awake at 1am', () => {
  for (const family of ACHIEVEMENTS) {
    for (const step of family.tiers) {
      assert.doesNotMatch(`${step.name} ${family.goal(step.at)}`, /1am|past midnight|late night/i,
        `${family.id} should not reward staying up`);
    }
  }
});

test('stopping before bedtime is what climbs the on-time ladder', () => {
  const state = stateWithProgress(9);
  checkAchievements(state, computeStats(state));
  assert.equal(heldTier(state.profile, 'ontime'), 0, 'nothing yet');

  state.profile.lightsOut = { streak: 1, best: 1, lastKey: '2026-07-29' };
  const first = checkAchievements(state, computeStats(state));
  assert.equal(heldTier(state.profile, 'ontime'), 1);
  assert.equal(first.find((e) => e.id === 'ontime').name, 'Turned In');

  state.profile.lightsOut.best = 3;
  const second = checkAchievements(state, computeStats(state));
  assert.equal(heldTier(state.profile, 'ontime'), 2);
  assert.equal(second.find((e) => e.id === 'ontime').name, 'Clockwork');
});

test('an old badge list is carried over as tiers, retired ids and all', () => {
  const state = stateWithProgress(0);
  state.profile.badges = ['first-night', 'after-hours', 'streak-7'];
  delete state.profile.tiers;
  const loaded = normalizeState(JSON.parse(JSON.stringify(state)), new Date(2026, 6, 29, 22, 0));
  assert.equal(heldTier(loaded.profile, 'nights'), 1, 'First Light became tier 1');
  assert.equal(heldTier(loaded.profile, 'streak'), 2, 'a 7 night streak is the second rung');
  assert.equal(loaded.profile.badges, undefined, 'the old shape is gone');
  // "After Hours" no longer maps to anything, and must not invent a tier.
  assert.equal(Object.keys(loaded.profile.tiers).length, 2);
  // Nothing is paid retroactively for what a save already had.
  assert.equal(loaded.profile.tiersPaid.streak, 2);
});

test('the lights-out streak only counts nights that are actually in a row', () => {
  const lights = { streak: 0, best: 0, lastKey: null };
  advanceLightsOutStreak(lights, '2026-07-27', true);
  assert.equal(lights.streak, 1);
  advanceLightsOutStreak(lights, '2026-07-28', true);
  advanceLightsOutStreak(lights, '2026-07-29', true);
  assert.equal(lights.streak, 3, 'three consecutive nights');
  assert.equal(lights.best, 3);

  // A gap restarts it, however good the night was.
  advanceLightsOutStreak(lights, '2026-08-05', true);
  assert.equal(lights.streak, 1, 'a week later is not "running"');
  assert.equal(lights.best, 3, 'but the best still stands');

  // Pressing it twice on the same night changes nothing.
  advanceLightsOutStreak(lights, '2026-08-05', true);
  assert.equal(lights.streak, 1);

  // And going to bed late breaks it.
  advanceLightsOutStreak(lights, '2026-08-06', false);
  assert.equal(lights.streak, 0);
});

test('Clockwork needs three nights that really were consecutive', () => {
  const state = stateWithProgress(0);
  const lights = state.profile.lightsOut;
  for (const key of ['2026-07-01', '2026-07-10', '2026-07-20']) {
    advanceLightsOutStreak(lights, key, true);
  }
  checkAchievements(state, computeStats(state));
  assert.equal(heldTier(state.profile, 'ontime'), 1,
    'three scattered nights are not three nights running');

  for (const key of ['2026-07-21', '2026-07-22']) advanceLightsOutStreak(lights, key, true);
  checkAchievements(state, computeStats(state));
  assert.equal(heldTier(state.profile, 'ontime'), 2);
});

test('the streak only counts as safe when it actually grew', () => {
  // `met` asks whether tonight hit 60% and knows nothing about the nights you
  // were away, so it cannot be what decides the headline.
  const state = stateWithProgress(9);
  state.profile.streak = 12;
  state.profile.lastBankedKey = '2026-07-25'; // four nights ago
  state.profile.tokens.freeze = 0;
  const result = bankNight(state, computeStats(state));

  assert.equal(result.met, true, 'tonight really was a good night');
  assert.ok(result.streakAfter < result.streakBefore, 'and the streak still reset');
  assert.equal(result.streakAfter, 1, 'counting again from tonight');
});
