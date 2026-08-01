/* What time you actually went to bed, and whether it is moving earlier.
 *
 * The night streak counts nights you got through your list. That is a real
 * thing to be proud of and it is not what this app is for: you can finish every
 * task and still be awake at one. So the bedtime record is kept separately and
 * measured on its own terms — when you called it, how that compares to the
 * target you set, and whether this week is earlier than last.
 *
 * Clock times are awkward to average because they wrap at midnight: 11:50pm and
 * 12:10am are twenty minutes apart but 1420 apart as numbers. Everything here
 * works in minutes from noon of the night's own date instead, which is
 * monotonic across the whole night — 11:30pm is 690, 12:45am is 765 — so the
 * mean of a fortnight is just a mean.
 */

import { keyToDate, shiftKey } from './time.js';
import { pad2 } from './util.js';

/** A night is only on the record if you actually ended it. */
export function nightBedtime(key, entry) {
  if (!entry || !entry.lightsOutAt) {
    return { key, recorded: false, at: null, minutes: null, late: null, onTime: false, target: null };
  }
  return {
    key,
    recorded: true,
    at: entry.lightsOutAt,
    minutes: minutesFromNoon(entry.lightsOutAt, key),
    late: typeof entry.minutesLate === 'number' ? entry.minutesLate : null,
    onTime: Boolean(entry.onTime),
    target: entry.bedtime || null,
  };
}

/** A day, in minutes. The wrap this module exists to keep out of the way. */
const DAY = 1440;

/**
 * Where in its night a lights-out landed, as minutes after that night's noon.
 *
 * Normally positive: the night key is the evening's date, so 11:30pm is 690 and
 * 12:45am the next morning is 765. It comes out negative in exactly one case —
 * the night rolled at 4am while you were still up, so pressing Lights out at
 * 4:10am stamps the *new* key at 4:10 in the morning, which is 470 minutes
 * BEFORE that key's noon.
 *
 * Left raw, that is a 1440-minute cliff twenty minutes wide: stop at 3:50 and
 * the night reads 950, stop at 4:10 and it reads −470. One such night dragged a
 * seven-night average about three hours earlier, so the app answered a run of
 * midnights by offering to move the target from 11:30 to 9:30 — a suggestion
 * earlier than every night it was computed from. Lifting the negative case by a
 * day puts 4:10am at 970, right where it belongs: twenty minutes later than
 * 3:50am. The clock face is unchanged (a day is a whole number of turns), so
 * everything that formats one of these still prints the time you stopped.
 *
 * Counted along the calendar rather than the epoch, because everything this
 * number is compared against is a clock time: the target line on the chart, the
 * bedtime picker's range, the suggestion written back into the setting. On the
 * night the clocks go back, epoch minutes made a 3:30am lights-out read 990 —
 * an hour later than a 3:30am lights-out any other night of the year, and an
 * hour below its own target line on the same chart.
 */
export function minutesFromNoon(at, key) {
  const d = new Date(at);
  const noonOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0);
  // Noon to noon, so a 23- or 25-hour day still rounds to a whole day.
  const days = Math.round((noonOfDay.getTime() - keyToDate(key).getTime()) / 86400000);
  const seconds = d.getSeconds() + d.getMilliseconds() / 1000;
  const raw = days * DAY + d.getHours() * 60 + d.getMinutes() + Math.round(seconds / 60) - 720;
  return raw < 0 ? raw + DAY : raw;
}

/** "11:30 PM" from minutes-from-noon, whatever side of midnight it lands on. */
export function formatFromNoon(minutes, key = '2000-01-02') {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return '—';
  return atFromNoon(minutes, key).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/**
 * Minutes-from-noon back to a wall clock, by walking the calendar rather than
 * the epoch.
 *
 * The opposite choice to lastCallInstant (js/time.js), and for the opposite
 * reason. Last call asks how long you have actually been up, so it adds real
 * minutes. This asks what the clock said, so it adds clock minutes — the exact
 * inverse of minutesFromNoon above, which is the only thing that makes the round
 * trip hold on the two nights a year when the two disagree.
 */
function atFromNoon(minutes, key) {
  const at = keyToDate(key);
  at.setMinutes(at.getMinutes() + Math.round(minutes));
  return at;
}

/** "23 min earlier" / "8 min later" / "the same". */
export function formatShift(delta) {
  // Nothing to compare against is not "no change". On your first ever Lights
  // out the only tile the README calls out as answering "am I getting better"
  // answered with a confident, false zero — while its own tooltip two lines
  // below said there were not enough nights yet. Its four neighbours all admit
  // missing data with an em dash; so does this one now.
  if (delta === null || !Number.isFinite(delta)) return '—';
  if (Math.abs(delta) < 1) return 'no change';
  const mins = Math.abs(Math.round(delta));
  const label = mins >= 60
    ? `${Math.floor(mins / 60)}h ${pad2(mins % 60)}m`
    : `${mins} min`;
  return `${label} ${delta < 0 ? 'earlier' : 'later'}`;
}

/**
 * One slot per night, oldest first, including the nights with no record —
 * a gap in the chart is information too.
 */
export function bedtimeSeries(history, todayKey, nights = 21) {
  const out = [];
  for (let i = nights - 1; i >= 0; i -= 1) {
    const key = shiftKey(todayKey, -i);
    out.push(nightBedtime(key, history[key]));
  }
  return out;
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((sum, n) => sum + n, 0) / values.length;
}

/**
 * The numbers worth showing. `window` nights for the current figures, and the
 * `window` before that for the comparison — the delta is the only one of these
 * that answers "am I getting better", which is the whole point of a stat.
 */
export function bedtimeSummary(history, todayKey, window = 7) {
  const series = bedtimeSeries(history, todayKey, window * 2);
  const recent = series.slice(window).filter((n) => n.recorded);
  const earlier = series.slice(0, window).filter((n) => n.recorded);

  const average = mean(recent.map((n) => n.minutes));
  const previous = mean(earlier.map((n) => n.minutes));
  const lateValues = recent.map((n) => n.late).filter((n) => typeof n === 'number');

  return {
    window,
    recorded: recent.length,
    onTime: recent.filter((n) => n.onTime).length,
    onTimeRate: recent.length ? Math.round((recent.filter((n) => n.onTime).length / recent.length) * 100) : null,
    average,
    previous,
    // Negative is progress: the average has moved earlier in the night.
    delta: average !== null && previous !== null ? average - previous : null,
    earliest: recent.length ? Math.min(...recent.map((n) => n.minutes)) : null,
    latest: recent.length ? Math.max(...recent.map((n) => n.minutes)) : null,
    averageLate: mean(lateValues),
  };
}

/**
 * The morning after a night that ran past last call, as data.
 *
 * Here rather than in the renderer because it is arithmetic on the history, and
 * because the one number in it that is a judgement call — what bedtime to
 * suggest instead — deserves a test rather than a comment.
 *
 * Returns null when there is nothing to say, which is most mornings: no
 * previous night on record, last call off, the night ended before it, or you
 * have already been told about this one.
 */
export function lastNightReckoning(state, todayKey = state.night.key) {
  const { bedtime, lastCall } = state.profile.settings;
  if (!lastCall) return null;
  if (state.profile.reckonedKey === todayKey) return null;

  const key = shiftKey(todayKey, -1);
  // `state.history`, not `state.profile.history`. There is no history on the
  // profile and never has been — every other consumer reads the root (night.js,
  // insights.js, modals.js, achievements.js). Reading the wrong one returned
  // undefined on every call, so this whole feature was dead code, and the tests
  // passed because their fixture planted the history in the same wrong place.
  const night = nightBedtime(key, state.history?.[key]);
  if (!night.recorded || night.late === null) return null;
  // `late` is signed minutes past that night's own target — the one stamped on
  // the entry, not today's setting, so changing your bedtime cannot rewrite
  // history into or out of a telling-off.
  if (night.late < lastCall) return null;

  const summary = bedtimeSummary(state.history || {}, todayKey);
  return {
    key,
    late: night.late,
    at: formatFromNoon(night.minutes, key),
    target: night.target || bedtime,
    window: summary.window,
    average: summary.recorded ? formatFromNoon(summary.average, key) : null,
    shift: formatShift(summary.delta),
    ...suggestBedtime(summary.average, key),
  };
}

/**
 * A bedtime you might actually hit, from when you actually stop.
 *
 * The average of the last week, rounded UP to the next quarter hour. Up, not
 * to-nearest: a suggestion that lands earlier than your own average is one you
 * will miss on the day you accept it, and the first thing this suggestion has
 * to be is achievable. Rounded at all because "11:52 PM" reads as a
 * measurement and a target has to read as a decision.
 */
export function suggestBedtime(averageFromNoon, key = '2000-01-02') {
  if (averageFromNoon === null || !Number.isFinite(averageFromNoon)) {
    return { suggested: '—', suggestedValue: null };
  }
  // Into the same range the bedtime picker offers, because this suggestion is
  // applied by writing straight into the setting. An average past 3:45 rounds up
  // to a time the night cycle reads as *this* morning, which the picker will not
  // let you type and the countdown cannot represent.
  const rounded = clampFromNoon(Math.ceil(averageFromNoon / 15) * 15);
  const at = atFromNoon(rounded, key);
  return {
    suggested: at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
    suggestedValue: `${pad2(at.getHours())}:${pad2(at.getMinutes())}`,
  };
}

/**
 * The evening, as minutes from noon: 19:00 is 420, 03:45 is 945 — one step short
 * of the 4am rollover. Shared with the bedtime picker so the range a suggestion
 * may land in and the range you may dial in are the same range.
 */
export const BEDTIME_EARLIEST_FROM_NOON = 7 * 60;
export const BEDTIME_LATEST_FROM_NOON = 15 * 60 + 45;

export function clampFromNoon(minutes) {
  return Math.min(BEDTIME_LATEST_FROM_NOON, Math.max(BEDTIME_EARLIEST_FROM_NOON, minutes));
}
