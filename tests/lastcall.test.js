/* Last call: the second line, later than bedtime, where the app stops
   negotiating.

   Everything the app knew about lateness used to be a single boolean flipped at
   bedtime — the reward, the chip, the streak, the copy — so one minute over and
   three hours over were the same event. These cover the two halves of fixing
   that: a stage function that can tell the difference, and a reward that varies
   continuously with it. */

import test from 'node:test';
import assert from 'node:assert/strict';

import { execFileSync } from 'node:child_process';

import {
  lateStage, lastCallInstant, minutesPastLastCall, formatLastCall, lastCallCapped,
  bedtimeInstant, nightEndInstant, panelGate, shiftKey,
  LAST_CALL_DEFAULT, LAST_CALL_CHOICES, PACING_COPY,
} from '../js/time.js';
import { lightsOutReward } from '../js/render/goodnight.js';
import { applyTaskCompletion, applyTaskStart } from '../js/game.js';
import { openEnvelope } from '../js/envelope.js';
import {
  tonightBedtime, tonightLastCall, bedtimeMovesTomorrow, bankNight, computeStats,
} from '../js/night.js';
import {
  lastNightReckoning, suggestBedtime, minutesFromNoon, bedtimeSummary,
} from '../js/bedtime.js';
import { createInitialState, createProfile } from '../js/model.js';
import { normalizeState } from '../js/storage.js';

const KEY = '2026-08-01';
const BED = '21:45';
const at = (h, m = 0, day = 1) => new Date(2026, 7, day, h, m, 0, 0);

/* ------------------------------------------------------------ the stages */

test('the ladder has a rung for each thing that changes', () => {
  const stage = (d) => lateStage(KEY, BED, 60, d);
  assert.equal(stage(at(19, 0)), 'clear', 'the evening is just the evening');
  assert.equal(stage(at(21, 14)), 'clear', 'thirty-one minutes out');
  assert.equal(stage(at(21, 15)), 'curfew', 'the half hour before bedtime');
  assert.equal(stage(at(21, 44)), 'curfew');
  assert.equal(stage(at(22, 30)), 'past');
  assert.equal(stage(at(23, 0)), 'lastcall');
});

test('the bedtime minute itself is not late', () => {
  // pacingStatus carries a scar about exactly this (js/time.js:94-97): the chip
  // read "0m left" while the label under it said "Past bedtime", and lightsOut
  // pays for stopping in that minute. Three places have to agree.
  assert.equal(lateStage(KEY, BED, 60, at(21, 45)), 'curfew', 'still yours');
  assert.equal(lateStage(KEY, BED, 60, at(21, 46)), 'past');
});

test('last call is a line, so the minute it lands on is over it', () => {
  // The opposite convention to bedtime, deliberately. Bedtime is a target you
  // are rewarded for meeting; last call is not something you meet.
  assert.equal(lateStage(KEY, BED, 60, at(22, 44)), 'past');
  assert.equal(lateStage(KEY, BED, 60, at(22, 45)), 'lastcall');
});

test('with no bedtime set nothing is ever late', () => {
  for (const hour of [18, 22, 23]) {
    assert.equal(lateStage(KEY, '', 60, at(hour)), 'clear');
    assert.equal(lateStage(KEY, 'half nine', 60, at(hour)), 'clear');
  }
  assert.equal(lastCallInstant(KEY, '', 60), null);
  assert.equal(minutesPastLastCall(KEY, '', 60, at(23)), null);
  assert.equal(formatLastCall(KEY, '', 60), '—');
});

test('last call off never reaches the last rung', () => {
  // The single switch the whole feature hangs off. Off must put every consumer
  // back on exactly the old behaviour, not on a quieter version of the new one.
  for (const hour of [22, 23, 2]) {
    const when = hour < 4 ? at(hour, 0, 2) : at(hour);
    assert.notEqual(lateStage(KEY, BED, 0, when), 'lastcall');
  }
  assert.equal(lateStage(KEY, BED, 0, at(23)), 'past');
  assert.equal(lastCallInstant(KEY, BED, 0), null);
  assert.equal(formatLastCall(KEY, BED, 0), '—');
});

test('a bedtime in the small hours resolves forward, and so does its last call', () => {
  // bedtimeInstant pivots at noon, so 01:30 belongs to the morning after the
  // night began. Last call must follow it there rather than back a day.
  const late = lastCallInstant(KEY, '01:30', 60);
  assert.equal(late.getDate(), 2, 'the 2nd, not the 1st');
  assert.equal(late.getHours(), 2);
  assert.equal(lateStage(KEY, '01:30', 60, at(23, 0)), 'clear', '11pm is hours early');
  assert.equal(lateStage(KEY, '01:30', 60, at(1, 20, 2)), 'curfew');
  assert.equal(lateStage(KEY, '01:30', 60, at(2, 30, 2)), 'lastcall');
});

test('the offset is real minutes, not wall-clock arithmetic', () => {
  // Added through the epoch rather than by walking the local calendar. On a
  // spring-forward night `setMinutes(+120)` lands on the same wall clock and a
  // different number of actual minutes — and how long you have actually been up
  // is the only thing this number is measuring.
  for (const minutes of LAST_CALL_CHOICES.filter(Boolean)) {
    const bed = bedtimeInstant(KEY, BED);
    const call = lastCallInstant(KEY, BED, minutes);
    assert.equal((call.getTime() - bed.getTime()) / 60000, minutes);
  }
  // A US spring-forward night: 2am jumps to 3am on 2026-03-08.
  const dstKey = '2026-03-07';
  const bed = bedtimeInstant(dstKey, '01:00');
  const call = lastCallInstant(dstKey, '01:00', 120);
  assert.equal((call.getTime() - bed.getTime()) / 60000, 120,
    'two hours after must be two real hours, whatever the clock did');
});

test('minutesPastLastCall is signed, and zero at the line', () => {
  assert.equal(minutesPastLastCall(KEY, BED, 60, at(22, 45)), 0);
  assert.equal(minutesPastLastCall(KEY, BED, 60, at(22, 15)), -30);
  assert.equal(minutesPastLastCall(KEY, BED, 60, at(23, 45)), 60);
});

test('the last rung has copy of its own', () => {
  assert.ok(PACING_COPY.lastcall?.label, 'the chip needs something to say');
  assert.ok(!/!$/.test(PACING_COPY.lastcall.hint), 'no exclamation marks in this app');
});

/* ------------------------------------------------------------- the reward */

const FULL = { total: 10, counted: 10, done: 10 };
const HALF = { total: 10, counted: 10, done: 5 };

test('the reward is continuous where it used to be a cliff', () => {
  // It was `if (minutesEarly <= 0) return { xp: 15, dust: 3 }`, so stopping ON
  // the minute paid 15 and stopping one minute sooner paid 26 — you were docked
  // for precision, at the exact value the whole app is trying to reward.
  const before = lightsOutReward(0.001, FULL);
  const on = lightsOutReward(0, FULL);
  const after = lightsOutReward(-0.001, FULL);
  assert.deepEqual(on, before);
  assert.deepEqual(on, after);
});

test('earlier is never worth less', () => {
  let previous = -Infinity;
  for (let m = -1440; m <= 240; m += 1) {
    const { xp } = lightsOutReward(m, FULL);
    assert.ok(xp >= previous - 1e-9, `${m} minutes pays ${xp} after ${previous}`);
    previous = xp;
  }
});

test('lateness costs something, and it keeps costing', () => {
  const on = lightsOutReward(0, FULL).xp;
  const bit = lightsOutReward(-15, FULL).xp;
  const late = lightsOutReward(-60, FULL).xp;
  const hours = lightsOutReward(-180, FULL).xp;
  assert.ok(on > bit && bit > late && late > hours,
    `expected a slope, got ${on} > ${bit} > ${late} > ${hours}`);
  // The point of the whole feature: one minute over and three hours over must
  // not be the same event.
  assert.ok(lightsOutReward(-1, FULL).xp > hours + 5, 'a slight miss is not a disaster');
});

test('the reward never reaches zero, however late it gets', () => {
  // The single most important property here. A reward that decays to nothing
  // removes the last reason to stop at all, so at 3am the app would be arguing
  // for staying up — the exact inverse of what it is for.
  for (const minutes of [-120, -360, -720, -1440, -100000]) {
    const { xp, dust } = lightsOutReward(minutes, FULL);
    assert.ok(xp > 0, `${minutes} pays ${xp} XP`);
    assert.ok(dust > 0, `${minutes} pays ${dust} stardust`);
  }
});

test('stopping very early is still capped', () => {
  assert.deepEqual(lightsOutReward(90, FULL), lightsOutReward(600, FULL));
});

test('the work still scales it, at every hour of the night', () => {
  for (const minutes of [60, 0, -60, -180]) {
    const full = lightsOutReward(minutes, FULL);
    const half = lightsOutReward(minutes, HALF);
    assert.ok(full.xp > half.xp, `at ${minutes} an untouched list paid the same`);
  }
});

test('an empty list never out-earns a night you worked through', () => {
  // It used to return a flat {xp:15, dust:3}, which was a floor only while
  // nothing could go below it. Once the late branch could, deleting your list
  // before pressing Lights out became the higher-paying move past about
  // sixty-six minutes late — the padding-for-reward pressure the taper exists
  // to remove, reappearing at the one reward that sits outside it.
  const EMPTY = { total: 0 };
  for (const minutes of [90, 30, 0, -30, -66, -90, -180, -600]) {
    const worked = lightsOutReward(minutes, FULL).xp;
    const empty = lightsOutReward(minutes, EMPTY).xp;
    assert.ok(empty <= worked, `${minutes}: empty paid ${empty} against ${worked}`);
  }
  // And still capped where it was: stopping ninety minutes early with nothing
  // on the list once paid 128 XP, ten tasks' worth for holding a button.
  assert.deepEqual(lightsOutReward(90, EMPTY), { xp: 15, dust: 3 });
  assert.deepEqual(lightsOutReward(600, null), { xp: 15, dust: 3 });
  // Stopping is still always worth something, even with nothing to show.
  assert.ok(lightsOutReward(-600, EMPTY).xp > 0);
});

/* -------------------------------------------------- the morning reckoning */

function withHistory(entry, todayKey = '2026-08-02') {
  const state = createInitialState(new Date(2026, 7, 2, 10, 0));
  state.night.key = todayKey;
  state.profile.settings.bedtime = BED;
  state.profile.settings.lastCall = 60;
  // At the ROOT. A fixture that plants it on the profile tests a shape the app
  // never produces — which is exactly how the first version of this passed 24
  // tests while the feature could not fire once.
  state.history = { [KEY]: entry };
  return state;
}

const longNight = {
  key: KEY,
  lightsOutAt: at(23, 55).getTime(),
  onTime: false,
  bedtime: BED,
  minutesLate: 130,
};

test('a night that ran past last call is worth one sentence', () => {
  const reck = lastNightReckoning(withHistory(longNight));
  assert.ok(reck, 'nothing to say about a 2h10m overrun');
  assert.equal(reck.late, 130);
});

test('one night is not an average, and not a reason to move the target', () => {
  // This fixture holds exactly one night. The sheet used to call its mean a
  // "7-night average" — the window size, not the count it divided by — so the
  // line under "Lights out 1:20 AM" read "7-night average 1:20 AM": the same
  // figure twice, one of them claiming to be a week of them. And "Move the
  // target to 1:30 AM" was computed from that single night, which would set
  // your bedtime to the worst night on record because it is also the only one.
  const reck = lastNightReckoning(withHistory(longNight));
  assert.equal(reck.recorded, 1, 'one night ended inside the window');
  assert.equal(reck.average, null, 'so there is no average to print');
  assert.equal(reck.suggestedValue, null, 'and nothing to move the target to');
});

test('a run of them is both', () => {
  const state = withHistory(longNight);
  // Three nights ending at 12:30am, against the same target.
  for (let i = 1; i <= 3; i += 1) {
    const key = shiftKey(KEY, -i);
    const [y, m, d] = key.split('-').map(Number);
    state.history[key] = {
      key, lightsOutAt: new Date(y, m - 1, d + 1, 0, 30).getTime(),
      onTime: false, bedtime: BED, minutesLate: 165,
    };
  }
  const reck = lastNightReckoning(state);
  assert.equal(reck.recorded, 4);
  assert.ok(reck.average, 'four nights is an average');
  assert.ok(reck.suggestedValue, 'and a pattern worth offering to act on');
  assert.notEqual(reck.average, reck.at, 'the mean is not just last night again');
});

test('and an ordinary miss is not', () => {
  // The rung below already answered it, by paying less. A sentence as well is
  // the app saying the same thing twice.
  const brief = { ...longNight, minutesLate: 20 };
  assert.equal(lastNightReckoning(withHistory(brief)), null);
});

test('it is said once, and survives a reload', () => {
  const state = withHistory(longNight);
  assert.ok(lastNightReckoning(state));
  state.profile.reckonedKey = state.night.key;
  assert.equal(lastNightReckoning(state), null);
  const loaded = normalizeState(JSON.parse(JSON.stringify(state)));
  assert.equal(loaded.profile.reckonedKey, state.night.key, 'the key has to persist');
});

test('nothing to say with last call off, or with no night on record', () => {
  const off = withHistory(longNight);
  off.profile.settings.lastCall = 0;
  assert.equal(lastNightReckoning(off), null);

  const unrecorded = withHistory({ key: KEY, lightsOutAt: null, minutesLate: null });
  assert.equal(lastNightReckoning(unrecorded), null);
  assert.equal(lastNightReckoning(withHistory(undefined)), null);
});

test('it measures against the target that stood that night', () => {
  // Not today's setting. Otherwise moving your bedtime would rewrite history
  // into — or out of — a telling-off you already had.
  const state = withHistory(longNight);
  state.profile.settings.bedtime = '01:00';
  const reck = lastNightReckoning(state);
  assert.ok(reck, 'changing tonight’s target must not erase last night');
  assert.equal(reck.target, BED);
});

test('the suggested bedtime is one you could actually keep', () => {
  // Rounded UP to the quarter hour. A suggestion landing earlier than your own
  // average is one you miss on the day you accept it, and the first thing it
  // has to be is achievable.
  const key = '2026-08-01';
  const eleven50 = minutesFromNoon(at(23, 50).getTime(), key);
  assert.equal(suggestBedtime(eleven50, key).suggestedValue, '00:00');
  const eleven31 = minutesFromNoon(at(23, 31).getTime(), key);
  assert.equal(suggestBedtime(eleven31, key).suggestedValue, '23:45');
  const onQuarter = minutesFromNoon(at(23, 30).getTime(), key);
  assert.equal(suggestBedtime(onQuarter, key).suggestedValue, '23:30', 'already round');
  assert.equal(suggestBedtime(null).suggestedValue, null);
  assert.equal(suggestBedtime(NaN).suggested, '—');
});

/* ------------------------------------------------------------- the setting */

test('the setting arrives with a default and cannot be poisoned', () => {
  assert.equal(createProfile().settings.lastCall, LAST_CALL_DEFAULT);
  assert.ok(LAST_CALL_CHOICES.includes(LAST_CALL_DEFAULT));

  // Every consumer does arithmetic on it. A string or a NaN would make
  // lastCallInstant produce an Invalid Date, every comparison against which is
  // false — so the stage would silently never reach 'lastcall' and the feature
  // would be off with nothing anywhere saying so.
  for (const bad of ['soon', NaN, -30, null, undefined, 47, Infinity, '60x', false, '', [], '60', {}]) {
    const state = createInitialState(new Date(2026, 7, 1, 22, 0));
    state.profile.settings.lastCall = bad;
    const loaded = normalizeState(JSON.parse(JSON.stringify(state)));
    assert.ok(LAST_CALL_CHOICES.includes(loaded.profile.settings.lastCall),
      `${String(bad)} survived as ${loaded.profile.settings.lastCall}`);
  }

  // And a legitimate choice is left alone, as a number — choiceRow compares
  // with ===, so a string would show no chip selected.
  for (const good of LAST_CALL_CHOICES) {
    const state = createInitialState(new Date(2026, 7, 1, 22, 0));
    state.profile.settings.lastCall = good;
    const loaded = normalizeState(JSON.parse(JSON.stringify(state)));
    assert.strictEqual(loaded.profile.settings.lastCall, good);
  }
});

test('a save written before last call existed gets the default', () => {
  const state = createInitialState(new Date(2026, 7, 1, 22, 0));
  delete state.profile.settings.lastCall;
  const loaded = normalizeState(JSON.parse(JSON.stringify(state)));
  assert.equal(loaded.profile.settings.lastCall, LAST_CALL_DEFAULT);
});

/* ------------------------------------------- last call and the 4am rollover */

test('last call cannot land after the night it belongs to', () => {
  const end = nightEndInstant(KEY);
  assert.equal(end.getHours(), 4);
  assert.equal(end.getDate(), 2, 'the morning after');

  // 3:45 is the latest bedtime the picker offers. Two hours past it is 5:45am —
  // an instant this key never sees, because the night rolled at 4 and every
  // consumer asks about the *current* key. So the stage could not fire, while
  // Settings named 5:45 AM as the time it would.
  assert.equal(lastCallInstant(KEY, '03:45', 120).getTime(), end.getTime());
  assert.equal(lastCallCapped(KEY, '03:45', 120), true);

  // An ordinary evening is untouched, and still counted in real minutes.
  assert.equal(lastCallCapped(KEY, BED, 120), false);
  assert.equal(lastCallInstant(KEY, BED, 120).getTime(),
    bedtimeInstant(KEY, BED).getTime() + 120 * 60000);
});

test('no bedtime the picker offers can push last call out of its night', () => {
  const end = nightEndInstant(KEY).getTime();
  for (let fromNoon = 7 * 60; fromNoon <= 15 * 60 + 45; fromNoon += 15) {
    const total = (fromNoon + 720) % 1440;
    const bedtime = `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
    for (const choice of LAST_CALL_CHOICES.filter(Boolean)) {
      const call = lastCallInstant(KEY, bedtime, choice).getTime();
      assert.ok(call <= end, `${bedtime} + ${choice} min escaped the night`);
      assert.ok(call >= bedtimeInstant(KEY, bedtime).getTime(),
        `${bedtime} + ${choice} min landed before the bedtime it follows`);
    }
  }
});

test('turning off the market curfew does not turn off last call', () => {
  assert.equal(panelGate('clear', true), 'open');
  assert.equal(panelGate('curfew', true), 'soft', 'a sheet with a way through');
  assert.equal(panelGate('past', true), 'soft');
  assert.equal(panelGate('lastcall', true), 'shut', 'and no way through');

  // "Close the market before bed" off: the soft rung goes, the hard one stays.
  assert.equal(panelGate('curfew', false), 'open');
  assert.equal(panelGate('past', false), 'open');
  assert.equal(panelGate('lastcall', false), 'shut',
    'the Last call row promises the panels stop letting you in — a different toggle must not cancel that');
});

/* --------------------------------------- the night that ran past the rollover */

test('the record does not jump a day at the 4am rollover', () => {
  // Stop at 3:50 and it belongs to KEY. Twenty minutes later the night has
  // rolled, so stopping at 4:10 is stamped on the *next* key, 470 minutes
  // before that key's own noon.
  const before = minutesFromNoon(new Date(2026, 7, 2, 3, 50).getTime(), KEY);
  const after = minutesFromNoon(new Date(2026, 7, 2, 4, 10).getTime(), '2026-08-02');
  assert.equal(before, 950);
  assert.equal(after, 970, 'twenty minutes later, not a day earlier');
});

test('one night past 4am does not drag the week hours earlier', () => {
  const today = '2026-08-08';
  const history = {};
  for (let i = 1; i <= 7; i += 1) {
    const key = shiftKey(today, -i);
    const [y, m, d] = key.split('-').map(Number);
    // The most recent night ran to 4:10am, so the roll stamped it on its own
    // key in the morning. The rest ended at 12:30am, the night after theirs.
    const at = i === 1 ? new Date(y, m - 1, d, 4, 10) : new Date(y, m - 1, d + 1, 0, 30);
    history[key] = { lightsOutAt: at.getTime(), minutesLate: 60, bedtime: '23:30', onTime: false };
  }

  const summary = bedtimeSummary(history, today);
  assert.ok(summary.average > summary.earliest, 'the mean sits inside its own range');
  assert.equal(summary.latest, 970, 'the 4:10am night is the latest of them, not the earliest');

  // The whole point of the suggestion is that you could actually hit it. Read
  // raw, that one night pulled the mean to 546 and the app offered to move a
  // 11:30 target to 9:15 PM as the remedy for going to bed too late.
  const { suggestedValue } = suggestBedtime(summary.average, today);
  assert.equal(suggestedValue, '01:15');
  assert.ok(minutesFromNoon(new Date(2026, 7, 8, 1, 15).getTime(), '2026-08-07') >= summary.earliest,
    'never earlier than the earliest night it was computed from');
});

test('a suggestion stays inside the range the picker offers', () => {
  // It is applied by writing straight into the setting, so it has to be a time
  // the picker could have produced — and one the night cycle reads as tonight.
  assert.equal(suggestBedtime(60, KEY).suggestedValue, '19:00', 'nothing earlier than 7pm');
  assert.equal(suggestBedtime(1200, KEY).suggestedValue, '03:45', 'nothing past the rollover');
});

test('minutes from noon are clock minutes, on the two nights that differ', () => {
  // This machine runs in UTC, where every day is exactly 1440 minutes and the
  // difference cannot show. So ask a zone that changes: on 2026-11-01 New York
  // runs 1:59am twice, making that night 25 real hours long.
  const probe = `
    import { minutesFromNoon, formatFromNoon, suggestBedtime } from './js/bedtime.js';
    const fallBack = minutesFromNoon(new Date(2026, 10, 1, 3, 30).getTime(), '2026-10-31');
    const ordinary = minutesFromNoon(new Date(2026, 10, 8, 3, 30).getTime(), '2026-11-07');
    console.log(JSON.stringify({
      fallBack, ordinary,
      face: formatFromNoon(fallBack, '2026-10-31'),
      suggested: suggestBedtime(fallBack, '2026-10-31').suggestedValue,
      offsets: [new Date(2026, 9, 31, 12).getTimezoneOffset(), new Date(2026, 10, 1, 12).getTimezoneOffset()],
    }));
  `;
  const out = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', probe], {
    env: { ...process.env, TZ: 'America/New_York' }, encoding: 'utf8',
  }));

  assert.notDeepEqual(out.offsets[0], out.offsets[1], 'the probe zone really did change');
  assert.equal(out.fallBack, 930, '3:30am is 930 minutes past noon');
  assert.equal(out.fallBack, out.ordinary,
    'the same clock time gives the same number, whatever the calendar did that night');
  assert.equal(out.face, '3:30 AM', 'and converts back to the time you actually stopped');
  assert.equal(out.suggested, '03:30');
});

/* ------------------------------------- the target you are judged against */

function startedNight(bedtime = BED, lastCall = 60) {
  const state = createInitialState(at(20, 0));
  state.night.key = KEY;
  state.profile.settings.bedtime = bedtime;
  state.profile.settings.lastCall = lastCall;
  return state;
}

test('a night that has not started yet takes the setting as it stands', () => {
  const state = startedNight();
  assert.equal(state.night.bedtime, null, 'nothing has cost anything yet');
  assert.equal(tonightBedtime(state), BED);
  state.profile.settings.bedtime = '22:30';
  assert.equal(tonightBedtime(state), '22:30', 'correcting it before you begin applies tonight');
});

test('the first thing that costs you something fixes tonight’s targets', () => {
  const state = startedNight();
  const task = Object.values(state.template.tasks)[0];
  applyTaskCompletion(state, task);
  assert.equal(state.night.bedtime, BED);
  assert.equal(state.night.lastCall, 60);

  // The exploit, in one line. At 12:45am against a 9:45 target this turned
  // 9 XP into 49, a broken clean-night streak into a kept one, last call into
  // curfew, and a late night into a permanent on-time star.
  state.profile.settings.bedtime = '01:00';
  state.profile.settings.lastCall = 120;
  assert.equal(tonightBedtime(state), BED, 'tonight is still judged against the line it was running on');
  assert.equal(tonightLastCall(state), 60);
  assert.equal(lateStage(KEY, tonightBedtime(state), tonightLastCall(state), at(0, 45, 2)), 'lastcall');
  assert.equal(bedtimeMovesTomorrow(state), true, 'and the panel has to say so');
});

test('un-ticking everything does not release the lock', () => {
  // Otherwise "tick, untick, move the bedtime, re-tick" is the same loophole
  // with two more steps in it.
  const state = startedNight();
  const task = Object.values(state.template.tasks)[0];
  applyTaskCompletion(state, task);
  delete state.night.done[task.id];
  delete state.night.awards[task.id];
  state.profile.settings.bedtime = '01:00';
  assert.equal(tonightBedtime(state), BED);
});

test('starting a task locks it too, and so does the envelope', () => {
  const started = startedNight();
  applyTaskStart(started, Object.values(started.template.tasks)[0]);
  assert.equal(started.night.bedtime, BED, 'an advance is the night costing you something');

  const opened = startedNight();
  openEnvelope(opened);
  assert.equal(opened.night.bedtime, BED, 'and so is the first payout of the night');
});

test('the history entry records the target the night was judged against', () => {
  const state = startedNight();
  applyTaskCompletion(state, Object.values(state.template.tasks)[0]);
  state.night.lightsOutAt = at(23, 55).getTime();
  state.profile.settings.bedtime = '01:00'; // moved after the fact
  const result = bankNight(state, computeStats(state));
  assert.equal(state.history[KEY].bedtime, BED,
    'the stamp is what it ran against, not what the setting says now');
  assert.ok(state.history[KEY].minutesLate > 0, 'and it was late, whatever the setting says');
  assert.ok(result);
});

test('a locked target survives a reload, and a corrupt one does not stick', () => {
  const state = startedNight();
  applyTaskCompletion(state, Object.values(state.template.tasks)[0]);
  const loaded = normalizeState(JSON.parse(JSON.stringify(state)));
  assert.equal(loaded.night.bedtime, BED, 'the lock is part of the night, and the night is saved');

  for (const bad of ['', 'nonsense', '99:99', 12, null, {}]) {
    const hostile = JSON.parse(JSON.stringify(state));
    hostile.night.bedtime = bad;
    // null, not a number: a night judged against garbage is judged against
    // nothing, and the live setting is the only safe fallback.
    assert.equal(normalizeState(hostile).night.bedtime, null, `${JSON.stringify(bad)} survived`);
  }
});
