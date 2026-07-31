/* The bedtime record: what time you stopped, and whether it is moving earlier. */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  nightBedtime, minutesFromNoon, formatFromNoon, formatShift,
  bedtimeSeries, bedtimeSummary,
} from '../js/bedtime.js';
import { createInitialState } from '../js/model.js';
import { bankNight, computeStats, latenessOf } from '../js/night.js';

/** A history entry for a night that ended at the given wall clock. */
function ended(key, hour, minute, { target = '23:30' } = {}) {
  const [y, m, d] = key.split('-').map(Number);
  const at = new Date(y, m - 1, d, hour, minute);
  if (hour < 4) at.setDate(at.getDate() + 1); // small hours belong to the next morning
  const [th, tm] = target.split(':').map(Number);
  const targetAt = new Date(y, m - 1, d, th, tm);
  if (th < 4) targetAt.setDate(targetAt.getDate() + 1);
  const late = Math.round((at.getTime() - targetAt.getTime()) / 60000);
  return {
    total: 5, done: 5, pct: 100, xp: 40, quest: false, frozen: false,
    lightsOutAt: at.getTime(), onTime: late <= 0, bedtime: target, minutesLate: late,
  };
}

test('minutes are measured from noon, so midnight does not wrap', () => {
  const late = ended('2026-07-29', 0, 30).lightsOutAt;
  const early = ended('2026-07-29', 22, 45).lightsOutAt;
  assert.equal(minutesFromNoon(early, '2026-07-29'), 645);
  assert.equal(minutesFromNoon(late, '2026-07-29'), 750, 'half past midnight is later, not earlier');
  assert.ok(minutesFromNoon(late, '2026-07-29') > minutesFromNoon(early, '2026-07-29'));
});

test('a night with no lights out is not on the record', () => {
  const missing = nightBedtime('2026-07-29', { total: 4, done: 4, pct: 100 });
  assert.equal(missing.recorded, false);
  assert.equal(missing.minutes, null);
  assert.equal(missing.onTime, false);
  assert.equal(nightBedtime('2026-07-29', undefined).recorded, false);
});

test('the clock reads back the way a person would say it', () => {
  assert.equal(formatFromNoon(minutesFromNoon(ended('2026-07-29', 22, 45).lightsOutAt, '2026-07-29'), '2026-07-29'), '10:45 PM');
  assert.equal(formatFromNoon(minutesFromNoon(ended('2026-07-29', 0, 5).lightsOutAt, '2026-07-29'), '2026-07-29'), '12:05 AM');
  assert.equal(formatFromNoon(null), '—');
});

test('the series keeps a slot for every night, recorded or not', () => {
  const history = {
    '2026-07-27': ended('2026-07-27', 23, 0),
    '2026-07-29': ended('2026-07-29', 22, 30),
  };
  const series = bedtimeSeries(history, '2026-07-29', 4);
  assert.deepEqual(series.map((n) => n.key),
    ['2026-07-26', '2026-07-27', '2026-07-28', '2026-07-29']);
  assert.deepEqual(series.map((n) => n.recorded), [false, true, false, true]);
});

test('the summary averages the week and compares it to the one before', () => {
  const history = {};
  // Last week: 11pm every night. The week before: midnight every night.
  for (let d = 16; d <= 22; d += 1) history[`2026-07-${d}`] = ended(`2026-07-${d}`, 0, 0);
  for (let d = 23; d <= 29; d += 1) history[`2026-07-${d}`] = ended(`2026-07-${d}`, 23, 0);

  const summary = bedtimeSummary(history, '2026-07-29', 7);
  assert.equal(summary.recorded, 7);
  assert.equal(formatFromNoon(summary.average), '11:00 PM');
  assert.equal(formatFromNoon(summary.previous), '12:00 AM');
  assert.equal(summary.delta, -60, 'an hour earlier than the week before');
  assert.equal(formatShift(summary.delta), '1h 00m earlier');
});

test('on time is counted against the target of the night itself', () => {
  const history = {
    '2026-07-27': ended('2026-07-27', 23, 0), // 30 early
    '2026-07-28': ended('2026-07-28', 23, 45), // 15 late
    '2026-07-29': ended('2026-07-29', 22, 30), // an hour early
  };
  const summary = bedtimeSummary(history, '2026-07-29', 3);
  assert.equal(summary.onTime, 2);
  assert.equal(summary.onTimeRate, 67);
  assert.equal(formatFromNoon(summary.earliest), '10:30 PM');
  assert.equal(formatFromNoon(summary.latest), '11:45 PM');
  assert.equal(Math.round(summary.averageLate), -25);
});

test('changing your bedtime later does not rewrite whether you made it', () => {
  const history = { '2026-07-29': ended('2026-07-29', 23, 0, { target: '23:30' }) };
  assert.equal(history['2026-07-29'].onTime, true);
  assert.equal(history['2026-07-29'].bedtime, '23:30');
  // The record carries its own target, so a stricter setting tomorrow cannot
  // retroactively make tonight a failure.
  const summary = bedtimeSummary(history, '2026-07-29', 1);
  assert.equal(summary.onTime, 1);
});

test('nothing recorded reads as nothing rather than zero', () => {
  const summary = bedtimeSummary({}, '2026-07-29', 7);
  assert.equal(summary.recorded, 0);
  assert.equal(summary.average, null);
  assert.equal(summary.onTimeRate, null);
  assert.equal(summary.delta, null);
  assert.equal(formatFromNoon(summary.average), '—');
  // Not "no change" — there is no week before to have changed from, and this
  // is the one tile that claims to answer "am I getting better".
  assert.equal(formatShift(summary.delta), '—');
  assert.equal(formatShift(0), 'no change', 'a real zero still reads as one');
});

test('banking a night writes down when you stopped and how late that was', () => {
  const state = createInitialState(new Date(2026, 6, 29, 22, 0));
  state.profile.settings.bedtime = '23:30';
  const tasks = Object.values(state.template.tasks);
  for (const task of tasks) state.night.done[task.id] = Date.now();
  state.night.lightsOutAt = new Date(2026, 6, 30, 0, 30).getTime(); // an hour late
  state.night.lightsOutOnTime = false;

  bankNight(state, computeStats(state));
  const entry = state.history['2026-07-29'];
  assert.equal(entry.bedtime, '23:30');
  assert.equal(entry.minutesLate, 60);
  assert.equal(entry.onTime, false);
  assert.equal(latenessOf(state.night, '23:30'), 60);
});

test('a night nobody ended records no bedtime at all', () => {
  const state = createInitialState(new Date(2026, 6, 29, 22, 0));
  for (const task of Object.values(state.template.tasks)) state.night.done[task.id] = Date.now();
  bankNight(state, computeStats(state));
  const entry = state.history['2026-07-29'];
  assert.equal(entry.lightsOutAt, null);
  assert.equal(entry.minutesLate, null);
  assert.equal(entry.bedtime, null);
  assert.equal(nightBedtime('2026-07-29', entry).recorded, false);
});
