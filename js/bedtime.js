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

export function minutesFromNoon(at, key) {
  return Math.round((at - keyToDate(key).getTime()) / 60000);
}

/** "11:30 PM" from minutes-from-noon, whatever side of midnight it lands on. */
export function formatFromNoon(minutes, key = '2000-01-02') {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return '—';
  const at = new Date(keyToDate(key).getTime() + minutes * 60000);
  return at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
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
  const rounded = Math.ceil(averageFromNoon / 15) * 15;
  const at = new Date(keyToDate(key).getTime() + rounded * 60000);
  return {
    suggested: at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
    suggestedValue: `${pad2(at.getHours())}:${pad2(at.getMinutes())}`,
  };
}
