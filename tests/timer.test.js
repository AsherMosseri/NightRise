import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createTimer, elapsedOf, isRunning, startTimer, pauseTimer, toggleTimer, resetTimer,
  timerPhase, timerLabel, timerCaption, timerProgress, warnThresholdMs,
} from '../js/timer.js';
import { createInitialState } from '../js/model.js';
import { normalizeState } from '../js/storage.js';

const MIN = 60_000;

test('a countdown reads the estimate before it starts', () => {
  const t = createTimer('t1', 5);
  assert.equal(isRunning(t), false);
  assert.equal(timerLabel(t.plannedMs, 0), '5:00');
  assert.equal(timerProgress(t.plannedMs, 0), 0);
});

test('counting down rounds up, so 0:00 means zero', () => {
  const planned = 5 * MIN;
  assert.equal(timerLabel(planned, 0), '5:00');
  assert.equal(timerLabel(planned, 500), '5:00', 'half a second in is still five minutes to go');
  assert.equal(timerLabel(planned, 1000), '4:59');
  assert.equal(timerLabel(planned, planned - 1), '0:01', 'the last second is shown until it is gone');
  assert.equal(timerLabel(planned, planned), '0:00');
});

test('past the estimate it counts up instead of stopping', () => {
  const planned = 2 * MIN;
  assert.equal(timerLabel(planned, planned + 999), '+0:00');
  assert.equal(timerLabel(planned, planned + 1000), '+0:01');
  assert.equal(timerLabel(planned, planned + 95_000), '+1:35');
  assert.equal(timerLabel(planned, planned + 3_725_000), '+1:02:05');
});

test('the phase says where you are without a word', () => {
  const planned = 10 * MIN;
  assert.equal(timerPhase(planned, 0), 'running');
  assert.equal(timerPhase(planned, 7 * MIN), 'running');
  assert.equal(timerPhase(planned, 8 * MIN + 1), 'close', 'inside the last fifth');
  assert.equal(timerPhase(planned, planned), 'over');
  assert.equal(timerPhase(planned, planned + MIN), 'over');
});

test('short tasks get a floor on the warning, not a fifth of nothing', () => {
  assert.equal(warnThresholdMs(30_000), 30_000);
  // Half a minute long: it is "close" from the moment it starts.
  assert.equal(timerPhase(30_000, 0), 'close');
  assert.equal(timerPhase(2 * MIN, 0), 'running');
  assert.equal(timerPhase(2 * MIN, 91_000), 'close');
});

test('no estimate is a stopwatch, never late', () => {
  assert.equal(timerPhase(0, 0), 'open');
  assert.equal(timerPhase(0, 99 * MIN), 'open', 'nothing to be over');
  assert.equal(timerLabel(0, 65_000), '1:05', 'and it just counts up');
  assert.equal(timerProgress(0, 65_000), 0);
  assert.match(timerCaption(0, 0, '—'), /no estimate/);
});

test('the caption names the estimate on both sides of it', () => {
  assert.equal(timerCaption(5 * MIN, MIN, '5 minutes'), 'left of 5 minutes');
  assert.equal(timerCaption(5 * MIN, 9 * MIN, '5 minutes'), 'over 5 minutes');
});

test('the bar fills to the estimate and stops there', () => {
  const planned = 4 * MIN;
  assert.equal(timerProgress(planned, 0), 0);
  assert.equal(timerProgress(planned, 2 * MIN), 0.5);
  assert.equal(timerProgress(planned, 40 * MIN), 1, 'overtime does not overflow it');
});

test('pausing keeps the time, resuming does not lose it', () => {
  const t = createTimer('t1', 5);
  startTimer(t, 1000);
  assert.equal(elapsedOf(t, 31_000), 30_000);
  pauseTimer(t, 31_000);
  assert.equal(isRunning(t), false);
  assert.equal(elapsedOf(t, 999_000), 30_000, 'a paused clock does not drift');

  startTimer(t, 100_000);
  assert.equal(elapsedOf(t, 110_000), 40_000, 'and picks up where it left off');
});

test('toggling and resetting', () => {
  const t = createTimer('t1', 5);
  toggleTimer(t, 0);
  assert.equal(isRunning(t), true);
  toggleTimer(t, 5000);
  assert.equal(isRunning(t), false);
  assert.equal(elapsedOf(t, 9000), 5000);

  resetTimer(t, false, 9000);
  assert.equal(elapsedOf(t, 99_000), 0);
  resetTimer(t, true, 10_000);
  assert.equal(isRunning(t), true);
  assert.equal(elapsedOf(t, 12_000), 2000);
});

test('a timer can start already running, for the auto setting', () => {
  const t = createTimer('t1', 2, true, 500);
  assert.equal(isRunning(t), true);
  assert.equal(elapsedOf(t, 2500), 2000);
});

test('half a minute is a real estimate', () => {
  const t = createTimer('t1', 0.5);
  assert.equal(t.plannedMs, 30_000);
  assert.equal(timerLabel(t.plannedMs, 0), '0:30');
});

test('a parked clock survives a save and never comes back running', () => {
  // The timer used to be a module variable, nulled on exit — press Later,
  // glance at the list, or background the phone, and four minutes of work
  // became zero minutes of work. It lives on the night now.
  const state = createInitialState(new Date(2026, 6, 29, 22, 0));
  const id = Object.keys(state.template.tasks)[0];
  state.night.clocks[id] = { taskId: id, plannedMs: 120000, accumulatedMs: 240000, startedAt: Date.now() };

  const loaded = normalizeState(state);
  assert.equal(loaded.night.clocks[id].accumulatedMs, 240000, 'the minutes are still there');
  assert.equal(loaded.night.clocks[id].startedAt, null,
    'but never running: a phone in a pocket must not accumulate an hour');
  assert.equal(elapsedOf(loaded.night.clocks[id]), 240000);
});

test('a clock for a task that no longer exists is dropped', () => {
  const state = createInitialState(new Date(2026, 6, 29, 22, 0));
  state.night.clocks.gone = { taskId: 'gone', plannedMs: 60000, accumulatedMs: 5000, startedAt: null };
  assert.equal(normalizeState(state).night.clocks.gone, undefined);
});
