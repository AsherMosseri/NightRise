import test from 'node:test';
import assert from 'node:assert/strict';

import {
  nightKeyOf, keyToDate, shiftKey, keyDiffDays, bedtimeInstant,
  minutesUntilBedtime, pacingStatus, parseClock,
} from '../js/time.js';

test('a night key is the evening it started on', () => {
  assert.equal(nightKeyOf(new Date(2026, 6, 29, 22, 30)), '2026-07-29');
  assert.equal(nightKeyOf(new Date(2026, 6, 29, 23, 59)), '2026-07-29');
});

test('the small hours still belong to the night before', () => {
  assert.equal(nightKeyOf(new Date(2026, 6, 30, 0, 5)), '2026-07-29');
  assert.equal(nightKeyOf(new Date(2026, 6, 30, 3, 59)), '2026-07-29');
});

test('4am starts a new night', () => {
  assert.equal(nightKeyOf(new Date(2026, 6, 30, 4, 0)), '2026-07-30');
  assert.equal(nightKeyOf(new Date(2026, 6, 30, 11, 0)), '2026-07-30');
});

test('keys shift and diff across month boundaries', () => {
  assert.equal(shiftKey('2026-07-31', 1), '2026-08-01');
  assert.equal(shiftKey('2026-01-01', -1), '2025-12-31');
  assert.equal(keyDiffDays('2026-07-29', '2026-08-02'), 4);
  assert.equal(keyDiffDays('2026-08-02', '2026-07-29'), -4);
  assert.equal(keyDiffDays('2026-07-29', '2026-07-29'), 0);
});

test('keyToDate round-trips through nightKeyOf', () => {
  assert.equal(nightKeyOf(keyToDate('2026-02-28')), '2026-02-28');
});

test('an evening bedtime lands on the same calendar day', () => {
  const target = bedtimeInstant('2026-07-29', '23:30');
  assert.equal(target.getDate(), 29);
  assert.equal(target.getHours(), 23);
});

test('a small-hours bedtime lands on the next calendar day', () => {
  const target = bedtimeInstant('2026-07-29', '01:15');
  assert.equal(target.getDate(), 30);
  assert.equal(target.getHours(), 1);
});

test('minutes until bedtime goes negative once it passes', () => {
  const now = new Date(2026, 6, 30, 0, 30); // half past midnight
  assert.equal(Math.round(minutesUntilBedtime('2026-07-29', '23:30', now)), -60);
  assert.equal(Math.round(minutesUntilBedtime('2026-07-29', '01:00', now)), 30);
});

test('parseClock rejects nonsense', () => {
  assert.deepEqual(parseClock('07:05'), { hours: 7, minutes: 5 });
  assert.equal(parseClock('25:00'), null);
  assert.equal(parseClock('nope'), null);
});

test('pacing compares work left against time left', () => {
  assert.equal(pacingStatus(0, 120), 'clear');
  assert.equal(pacingStatus(30, 120), 'ahead');
  assert.equal(pacingStatus(100, 120), 'tight');
  assert.equal(pacingStatus(200, 120), 'over');
  assert.equal(pacingStatus(20, -5), 'past');
  assert.equal(pacingStatus(20, null), 'ahead');
});
