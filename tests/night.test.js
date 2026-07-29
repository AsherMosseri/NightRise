import test from 'node:test';
import assert from 'node:assert/strict';

import { computeStats, bankNight, rolloverIfNeeded, forceNewNight } from '../js/night.js';
import { createInitialState } from '../js/model.js';
import { applyTaskCompletion } from '../js/game.js';

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

test('starting a fresh night moves to the next key so 4am cannot re-bank it', () => {
  const state = stateWithProgress(9);
  forceNewNight(state);
  assert.equal(state.night.key, '2026-07-30');
  assert.ok(state.history['2026-07-29'], 'the finished night was banked');

  const streak = state.profile.streak;
  const banked = { ...state.history['2026-07-29'] };
  assert.equal(rolloverIfNeeded(state, new Date(2026, 6, 30, 5, 0)), null,
    'the 4am boundary has nothing left to do');
  assert.equal(state.profile.streak, streak);
  assert.deepEqual(state.history['2026-07-29'], banked);
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
