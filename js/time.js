/* Night-cycle time math. Pure functions — no DOM, safe to unit test in node. */

import { pad2 } from './util.js';

/** Anything before 4am still belongs to the previous evening's night. */
export const NIGHT_BOUNDARY_HOUR = 4;

export function nightKeyOf(date = new Date()) {
  const d = new Date(date.getTime());
  if (d.getHours() < NIGHT_BOUNDARY_HOUR) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Local Date at noon for the given key — noon keeps DST shifts from moving the day. */
export function keyToDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

export function shiftKey(key, days) {
  const d = keyToDate(key);
  d.setDate(d.getDate() + days);
  return nightKeyOf(d);
}

/** Whole days from key `a` to key `b` (positive when b is later). */
export function keyDiffDays(a, b) {
  const ms = keyToDate(b).getTime() - keyToDate(a).getTime();
  return Math.round(ms / 86400000);
}

export function formatNightLabel(key) {
  return keyToDate(key).toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric',
  });
}

export function formatShortDate(key) {
  return keyToDate(key).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function parseClock(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return { hours, minutes };
}

/** Human 12h rendering for the bedtime chip, respecting the user's locale. */
export function formatClockLabel(value) {
  const parsed = parseClock(value);
  if (!parsed) return '—';
  const d = new Date(2000, 0, 1, parsed.hours, parsed.minutes);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/**
 * The instant the given bedtime falls on for a night key.
 * Bedtimes at/after the 4am boundary belong to that evening; earlier ones
 * (a 1:30am bedtime, say) belong to the small hours of the next calendar day.
 */
export function bedtimeInstant(key, bedtime) {
  const parsed = parseClock(bedtime);
  if (!parsed) return null;
  const base = keyToDate(key);
  const target = new Date(base.getFullYear(), base.getMonth(), base.getDate(), parsed.hours, parsed.minutes, 0, 0);
  // Noon, not the 4am night boundary. A bedtime is an evening or small-hours
  // time, so anything before midday belongs to the morning *after* the night
  // started. With the boundary at 4, a target of 04:00 resolved to the morning
  // the night began — eighteen hours in the past — which made the countdown
  // read "18h over" all evening, held curfew closed from the first second, and
  // made every lights-out late however early you stopped. Pivoting at noon
  // means a mistyped or imported time still resolves forward.
  if (parsed.hours < 12) target.setDate(target.getDate() + 1);
  return target;
}

export function minutesUntilBedtime(key, bedtime, now = new Date()) {
  const target = bedtimeInstant(key, bedtime);
  if (!target) return null;
  return (target.getTime() - now.getTime()) / 60000;
}

/**
 * Compare work left against time left.
 * `clear` nothing to do, `ahead` comfortable, `tight` cutting it close,
 * `over` more work than time, `past` bedtime has already passed.
 */
export function pacingStatus(remainingMinutes, minutesLeft) {
  if (remainingMinutes <= 0) return 'clear';
  if (minutesLeft === null) return 'ahead';
  // `< 0`, not `<= 0`. At exactly the bedtime minute the chip above this read
  // "0m left" while the label under it read "Past bedtime" — and lightsOut
  // treats zero as on time, so stopping in that minute was recorded as on time
  // by an app that was telling you you were late.
  if (minutesLeft < 0) return 'past';
  if (minutesLeft === 0) return remainingMinutes > 0 ? 'over' : 'clear';
  const ratio = remainingMinutes / minutesLeft;
  if (ratio <= 0.7) return 'ahead';
  if (ratio <= 1) return 'tight';
  return 'over';
}

export const PACING_COPY = {
  clear: { label: 'All clear', hint: 'Nothing left tonight.' },
  ahead: { label: 'On pace', hint: 'Comfortably ahead of bedtime.' },
  tight: { label: 'Cutting it close', hint: 'Just enough time — keep moving.' },
  over: { label: 'Over budget', hint: 'More to do than time left. Rain check something?' },
  past: { label: 'Past bedtime', hint: 'You are running late. Bank what you can.' },
};

export const CURFEW_LEAD_MINUTES = 30;

/**
 * True once we are inside the half hour before bedtime (and until the night
 * rolls). The shop, star map, history and insights are four browsing surfaces
 * with a currency attached; one tap away at 12:10am they are the same product
 * NightCheck is supposed to be rescuing you from.
 */
export function inCurfew(key, bedtime, now = new Date()) {
  const minutesLeft = minutesUntilBedtime(key, bedtime, now);
  if (minutesLeft === null) return false;
  return minutesLeft <= CURFEW_LEAD_MINUTES;
}
