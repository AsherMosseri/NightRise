import test from 'node:test';
import assert from 'node:assert/strict';

import {
  roundMinutes, formatMinutesShort, formatMinutesClock, formatMinutesLong, stepMinutes,
  formatDuration, keypadPress,
} from '../js/util.js';
import { createInitialState } from '../js/model.js';
import { computeStats } from '../js/night.js';

test('estimates quantise to the half minute', () => {
  assert.equal(roundMinutes(7), 7);
  assert.equal(roundMinutes(7.5), 7.5);
  assert.equal(roundMinutes(7.4), 7.5);
  assert.equal(roundMinutes(7.2), 7);
  assert.equal(roundMinutes(0.5), 0.5);
  assert.equal(roundMinutes('7.5'), 7.5);
});

test('estimates stay inside the allowed range', () => {
  assert.equal(roundMinutes(-4), 0);
  assert.equal(roundMinutes(9999), 600);
  assert.equal(roundMinutes('lots'), null);
  assert.equal(roundMinutes(undefined), null);
});

test('short form is compact enough for a row chip', () => {
  assert.equal(formatMinutesShort(0.5), '30s');
  assert.equal(formatMinutesShort(7), '7m');
  assert.equal(formatMinutesShort(7.5), '7½m');
  assert.equal(formatMinutesShort(0), '—');
});

test('clock form fits the stepper without wrapping', () => {
  assert.equal(formatMinutesClock(0.5), '30s');
  assert.equal(formatMinutesClock(7), '7m');
  assert.equal(formatMinutesClock(7.5), '7m 30s');
  assert.equal(formatMinutesClock(0), 'no estimate');
});

test('long form is something a screen reader can say', () => {
  assert.equal(formatMinutesLong(0.5), '30 seconds');
  assert.equal(formatMinutesLong(1), '1 minute');
  assert.equal(formatMinutesLong(7), '7 minutes');
  assert.equal(formatMinutesLong(7.5), '7 minutes 30 seconds');
  assert.equal(formatMinutesLong(0), 'no estimate');
});

test('the stepper moves by an amount that suits the size', () => {
  assert.equal(stepMinutes(0, 1), 0.5);
  assert.equal(stepMinutes(0.5, 1), 1);
  assert.equal(stepMinutes(2, 1), 3);
  assert.equal(stepMinutes(10, 1), 15);
  assert.equal(stepMinutes(30, 1), 40);
  assert.equal(stepMinutes(0, -1), 0);
  assert.equal(stepMinutes(1, -1), 0.5);
  assert.equal(stepMinutes(3, -1), 2);
  assert.equal(stepMinutes(15, -1), 10);
});

test('the number pad builds a value one key at a time', () => {
  const type = (keys) => keys.reduce((acc, k) => keypadPress(acc, k), '');
  assert.equal(type(['7']), '7');
  assert.equal(type(['7', '.', '5']), '7.5');
  assert.equal(type(['0', '7']), '7');
  assert.equal(type(['.', '5']), '0.5');
  assert.equal(type(['1', '.', '.', '5']), '1.5');
  assert.equal(type(['1', '2', 'del']), '1');
  assert.equal(keypadPress('', 'del'), '');
  assert.equal(roundMinutes(type(['.', '5'])), 0.5);
});

test('the number pad refuses a key rather than saving a different number', () => {
  assert.equal(keypadPress('600', '0'), '600');
  assert.equal(keypadPress('60', '1'), '60');
  assert.equal(keypadPress('7', 'x'), '7');
  // Typing past the half is allowed; it lands on the half when it is saved.
  assert.equal(keypadPress('1.5', '5'), '1.55');
  assert.equal(roundMinutes('1.55'), 1.5);
});

test('half a minute of work left does not read as nothing left', () => {
  assert.equal(formatDuration(0.5), '1m');
  assert.equal(formatDuration(0.3), '<1m');
  assert.equal(formatDuration(-0.3), '<1m');
  assert.equal(formatDuration(0), '0m');
  assert.equal(formatDuration(7.5), '8m');
  assert.equal(formatDuration(75), '1h 15m');
});

test('a half-minute task counts toward the remaining total', () => {
  const state = createInitialState();
  const sectionId = state.template.order[0];
  const taskId = state.template.sections[sectionId].taskIds[0];
  for (const id of Object.keys(state.template.tasks)) {
    if (id !== taskId) state.night.done[id] = 1;
  }
  state.template.tasks[taskId].minutes = 0.5;
  assert.equal(computeStats(state).minutesRemaining, 0.5);
});
