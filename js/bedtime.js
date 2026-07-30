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
  if (delta === null || !Number.isFinite(delta) || Math.abs(delta) < 1) return 'no change';
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
