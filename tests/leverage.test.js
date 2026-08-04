/* The three things built to move what time this person actually sleeps: a
   reward whose spread is worth noticing, a night that pays better for ending on
   time, and an alarm the phone fires when the app is closed. */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createInitialState } from '../js/model.js';
import { lightsOutReward } from '../js/render/goodnight.js';
import { buyStar, progressFor, CONSTELLATIONS } from '../js/constellations.js';
import { normalizeState } from '../js/storage.js';
import { bedtimeAlarmIcs, ALARM_LEAD_MINUTES } from '../js/alarm.js';
import { browseGate, minutesUntilBedtime, BROWSE_BUDGET_CHOICES } from '../js/time.js';
import { lockTonightTargets } from '../js/game.js';
import { forceNewNight, tonightBedtime } from '../js/night.js';

const FULL = { total: 12, counted: 12, done: 12 };
const NIGHT = { xp: 157, dust: 81 };

/* ------------------------------------------------------- the reward's spread */

test('being late costs a share of the night, not a rounding error', () => {
  // Measured before this change: stopping ninety minutes late cost 13 XP and 3
  // stardust against stopping on the minute — 8% of a 157-XP night — while
  // stopping an hour EARLY paid 116 against 26. The whole gradient sat on the
  // early side of the line. The reward now scales with what the night earned,
  // so the gap scales with it too.
  const onTime = lightsOutReward(0, FULL, NIGHT);
  const late = lightsOutReward(-90, FULL, NIGHT);
  const gap = onTime.xp - late.xp;
  assert.ok(gap >= 30, `stopping 90 minutes late only costs ${gap} XP`);
  assert.ok(gap / NIGHT.xp >= 0.18, `that is only ${Math.round(gap / NIGHT.xp * 100)}% of the night`);
  assert.ok(onTime.dust - late.dust >= 5);
});

test('a bigger night has more to lose by running long', () => {
  const small = { xp: 40, dust: 20 };
  const big = { xp: 300, dust: 150 };
  const gapOf = (n) => lightsOutReward(0, FULL, n).xp - lightsOutReward(-90, FULL, n).xp;
  assert.ok(gapOf(big) > gapOf(small) * 2, 'the stake does not follow the night');
});

test('the four properties the curve has always had still hold', () => {
  // Continuous at zero: stopping ON the minute must never pay less than a
  // minute sooner. The original cliff docked you for precision.
  const at = (m) => lightsOutReward(m, FULL, NIGHT).xp;
  assert.ok(Math.abs(at(0) - at(1)) <= 2, `a step at zero: ${at(1)} then ${at(0)}`);
  // Monotonic across the whole range.
  let previous = Infinity;
  for (let m = 240; m >= -600; m -= 5) {
    const value = at(m);
    assert.ok(value <= previous + 0.001, `not monotonic at ${m}: ${value} after ${previous}`);
    previous = value;
  }
  // Bounded above by the ninety-minute cap, and never zero however late.
  assert.equal(at(240), at(90), 'the earliness cap stopped binding');
  assert.ok(at(-720) > 0, 'twelve hours late still has to be worth stopping');
});

/* ------------------------------------------- sleeping on time pays, not gates */

test('going to bed on time makes you richer rather than unlocking a door', () => {
  // The version of this that shipped for an hour was a second currency: a star
  // cost stardust AND a night slept on time. It was the wrong shape twice over.
  // It was redundant — the app already puts one star in the sky per on-time
  // night, for free, from onTimeNights() — and it converted a reward into a
  // restriction, which is how you end up with a week of savings and nothing to
  // spend them on. The pull has to be on the earning side.
  const onTime = lightsOutReward(0, FULL, NIGHT);
  const late = lightsOutReward(-90, FULL, NIGHT);
  const gained = onTime.dust - late.dust;
  // A third of the night's whole dust income rides on when you stopped. Stated
  // as a fraction rather than a number so the assertion survives a rebalance of
  // what a night earns — the point is the share, not the figure.
  assert.ok(gained / NIGHT.dust >= 0.3,
    `stopping on time is only worth ${gained} extra dust on a ${NIGHT.dust} night`);
  // And earlier still beats on time, so the incentive does not stop at the line.
  assert.ok(lightsOutReward(60, FULL, NIGHT).dust > onTime.dust, 'an hour early pays no better than on the minute');
});

test('the sky is bought with stardust and nothing else', () => {
  // Guard against re-introducing a gate. A fresh profile with the money buys a
  // star on its first night, having slept nothing at all.
  const state = createInitialState(new Date(2026, 7, 3, 22, 0));
  state.profile.stardust = 1e6;
  const id = CONSTELLATIONS[0].id;
  const bought = buyStar(state, id);
  assert.ok(bought, 'a paid-for star was refused');
  assert.equal(state.profile.stardust, 1e6 - bought.spent, 'the only price is dust');
  assert.ok(buyStar(state, id), 'and it does not stop after one');
});

test('the whole sky is a season of sleeping well', () => {
  // 152 stars. The sky fills from two directions at once: one star per on-time
  // night for free, and the constellations you light with dust — and the dust
  // itself comes faster on the nights you stopped on time.
  const stars = CONSTELLATIONS.reduce((n, c) => n + c.stars.length, 0);
  assert.ok(stars > 100, `only ${stars} stars — not enough of a season to matter`);
  const state = createInitialState(new Date(2026, 7, 3, 22, 0));
  assert.ok(progressFor(state, CONSTELLATIONS[0].id).nextCost > 0, 'stars stopped costing anything');
});

/* ------------------------------------------------------------ the alarm */

test('the bedtime alarm is a calendar file a phone will actually accept', () => {
  const ics = bedtimeAlarmIcs('23:30', { now: new Date(2026, 7, 3, 20, 0) });
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'), 'CRLF is required, and importers enforce it');
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.doesNotMatch(ics, /(?<!\r)\n/, 'a bare LF anywhere makes the file invalid');
  for (const required of ['VERSION:2.0', 'RRULE:FREQ=DAILY', 'DTSTART:', 'BEGIN:VALARM', 'END:VEVENT']) {
    assert.ok(ics.includes(required), `missing ${required}`);
  }
  assert.equal((ics.match(/BEGIN:VALARM/g) || []).length, 2, 'a warning and the bedtime itself');
  assert.ok(ics.includes(`TRIGGER:-PT${ALARM_LEAD_MINUTES}M`), 'the lead alarm is the one that can change anything');
  // Floating local time: no TZID, no trailing Z on DTSTART. A bedtime is 11:30pm
  // where you are standing, and pinning a zone moves it when you travel.
  assert.match(ics, /DTSTART:\d{8}T\d{6}(?!Z)/);
  assert.doesNotMatch(ics, /DTSTART;TZID/);
});

test('the first alarm is never one that has already passed', () => {
  const evening = bedtimeAlarmIcs('23:30', { now: new Date(2026, 7, 3, 20, 0) });
  assert.match(evening, /DTSTART:20260803T233000/, 'still ahead tonight, so tonight');
  const afterwards = bedtimeAlarmIcs('23:30', { now: new Date(2026, 7, 3, 23, 45) });
  assert.match(afterwards, /DTSTART:20260804T233000/, 'already gone, so tomorrow');
  const onTheMinute = bedtimeAlarmIcs('23:30', { now: new Date(2026, 7, 3, 23, 30) });
  assert.match(onTheMinute, /DTSTART:20260804T233000/, 'exactly now counts as gone');
});

test('re-adding after changing your bedtime replaces the alarm rather than stacking one', () => {
  const uid = (ics) => ics.match(/UID:(.+)\r\n/)[1];
  assert.equal(uid(bedtimeAlarmIcs('23:30')), uid(bedtimeAlarmIcs('23:30')), 'the UID has to be stable');
  assert.notEqual(uid(bedtimeAlarmIcs('23:30')), uid(bedtimeAlarmIcs('22:45')),
    'two different bedtimes must not share one event');
});

test('the file cannot be broken by what goes into it', () => {
  assert.equal(bedtimeAlarmIcs(''), null);
  assert.equal(bedtimeAlarmIcs('nonsense'), null);
  assert.equal(bedtimeAlarmIcs('99:99'), null);
  // Commas and semicolons are structure in this format; every generated line
  // has to survive being read back as one property.
  for (const line of bedtimeAlarmIcs('23:30').split('\r\n')) {
    assert.ok(line.length <= 75, `unfolded line of ${line.length} octets: ${line.slice(0, 40)}…`);
  }
});

/* -------------------------------------- the gate, while the panel is open */

test('a browsing budget is a quantity, and the curfew is a time', () => {
  const TEN = 10 * 60000;
  // Inside the budget the old gate is untouched, at every stage.
  assert.equal(browseGate('clear', true, 0, TEN), 'open');
  assert.equal(browseGate('curfew', true, 0, TEN), 'soft');
  assert.equal(browseGate('lastcall', true, 0, TEN), 'shut');
  // Spent, and it is shut whatever the clock says — this is the evening the
  // curfew has no opinion about: an hour in the market at nine o'clock.
  assert.equal(browseGate('clear', true, TEN, TEN), 'spent');
  assert.equal(browseGate('clear', false, TEN, TEN), 'spent', 'and the curfew toggle is not its off switch');
  // Last call still outranks it, so the copy never says "budget" when the real
  // reason is the hour.
  assert.equal(browseGate('lastcall', true, TEN, TEN), 'shut');
  // Off is off.
  assert.equal(browseGate('clear', true, 99 * TEN, 0), 'open');
});

test('the browsing clock and its budget survive a hostile save', () => {
  for (const bad of [NaN, -1, '600000', null, {}, Infinity]) {
    const state = createInitialState(new Date(2026, 7, 3, 22, 0));
    state.night.browsedMs = bad;
    const ms = normalizeState(JSON.parse(JSON.stringify(state))).night.browsedMs;
    assert.ok(Number.isFinite(ms) && ms >= 0, `${JSON.stringify(bad)} left ${ms}`);
  }
  for (const bad of [7, -5, '10', null, 'lots']) {
    const state = createInitialState(new Date(2026, 7, 3, 22, 0));
    state.profile.settings.browseBudget = bad;
    const value = normalizeState(JSON.parse(JSON.stringify(state))).profile.settings.browseBudget;
    assert.ok(BROWSE_BUDGET_CHOICES.includes(value), `${JSON.stringify(bad)} survived as ${value}`);
  }
});

test('the night’s browsing clock starts at zero and rolls over with the night', () => {
  const state = createInitialState(new Date(2026, 7, 3, 22, 0));
  assert.equal(state.night.browsedMs, 0);
  state.night.browsedMs = 9 * 60000;
  forceNewNight(state, '2099-01-01');
  assert.equal(state.night.browsedMs, 0, 'a new night is a new allowance');
});

test('the target locks on the clock, not only on the first thing you tap', () => {
  // lockTonightTargets has three action-shaped callers — start, finish, envelope.
  // Open the app at 00:45 having touched nothing and the bedtime was still
  // editable, which is exactly the state the lock exists for.
  const state = createInitialState(new Date(2026, 7, 3, 20, 0));
  state.night.key = '2026-08-03';
  state.profile.settings.bedtime = '23:30';
  assert.equal(state.night.bedtime, null, 'nothing has happened yet');

  // What syncLateStage does once the target has gone by.
  const past = minutesUntilBedtime(state.night.key, state.profile.settings.bedtime,
    new Date(2026, 7, 4, 0, 45));
  assert.ok(past < 0);
  lockTonightTargets(state);
  assert.equal(state.night.bedtime, '23:30');
  state.profile.settings.bedtime = '01:00';
  assert.equal(tonightBedtime(state), '23:30', 'tonight is still judged against the line it ran on');
});
