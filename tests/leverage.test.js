/* The three things built to move what time this person actually sleeps: a
   reward whose spread is worth noticing, a currency only sleeping can mint, and
   an alarm the phone fires when the app is closed. */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createInitialState } from '../js/model.js';
import { lightsOutReward } from '../js/render/goodnight.js';
import { buyStar, progressFor, CONSTELLATIONS } from '../js/constellations.js';
import { applyReset } from '../js/reset.js';
import { normalizeState } from '../js/storage.js';
import { bedtimeAlarmIcs, ALARM_LEAD_MINUTES } from '../js/alarm.js';

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

/* -------------------------------------------------------------- starlight */

test('the sky can only be bought with nights, not with stardust', () => {
  const state = createInitialState(new Date(2026, 7, 3, 22, 0));
  state.profile.stardust = 1e6;
  const id = CONSTELLATIONS[0].id;
  const seeded = state.profile.starlight;
  assert.ok(seeded > 0, 'the map must not be a locked door on night one');

  for (let i = 0; i < seeded; i += 1) assert.ok(buyStar(state, id), 'a seeded night should buy a star');
  assert.equal(state.profile.starlight, 0);
  // All the money in the world and no nights: the sky stops.
  assert.equal(buyStar(state, id), null, 'stardust alone bought a star');
  assert.ok(state.profile.stardust > 900000, 'and it must not have taken the dust anyway');

  state.profile.starlight = 1;
  assert.ok(buyStar(state, id), 'one night, one star');
  assert.equal(state.profile.starlight, 0);
});

test('a starlight is minted by stopping on time and handed back with the night', () => {
  const state = createInitialState(new Date(2026, 7, 3, 22, 0));
  const before = state.profile.starlight;
  // The shape lightsOut() writes when the stop was on time.
  state.night.lightsOutAt = Date.now();
  state.night.lightsOutAward = { xp: 40, dust: 9, starlight: 1 };
  state.profile.starlight = before + 1;
  state.profile.lastLightsOutKey = state.night.key;

  applyReset(state, ['checks']);
  assert.equal(state.profile.starlight, before, 'clearing the night kept the night it bought');
});

test('starlight survives a reload and cannot be forged by a hostile save', () => {
  for (const [bad, want] of [[NaN, 0], [-5, 0], ['12', 12], [null, 0], [{}, 0], [3.7, 4]]) {
    const state = createInitialState(new Date(2026, 7, 3, 22, 0));
    state.profile.starlight = bad;
    const loaded = normalizeState(JSON.parse(JSON.stringify(state)));
    assert.equal(loaded.profile.starlight, want, `${JSON.stringify(bad)} came back wrong`);
  }
});

test('the whole sky is a season of sleeping well', () => {
  // 152 stars, one night each. This is the point of the mechanic: it is the one
  // thing in the app that no amount of checking things off at 1am can buy.
  const stars = CONSTELLATIONS.reduce((n, c) => n + c.stars.length, 0);
  assert.ok(stars > 100, `only ${stars} stars — not enough of a season to matter`);
  const state = createInitialState(new Date(2026, 7, 3, 22, 0));
  assert.ok(progressFor(state, CONSTELLATIONS[0].id).nextCost > 0, 'stars still cost dust as well');
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
