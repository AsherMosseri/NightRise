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
  lastcall: { label: 'Well past', hint: 'Last call has been and gone. Stop where you are.' },
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

/* ------------------------------------------------------------- last call */

/**
 * Last call: a second line, later than bedtime, where the app stops negotiating.
 *
 * Bedtime is an aspiration and the app treats missing it as one event, however
 * far past you are — the same flat reward, the same red chip, the same broken
 * streak at one minute over and at three hours. With nothing measuring *how*
 * late, there is nothing to escalate along, and a target you overshoot by two
 * hours every night stops meaning anything at all.
 *
 * Stored as minutes PAST bedtime rather than as a clock time, so it follows the
 * bedtime when that moves. 0 turns it off, which puts every consumer back on
 * exactly today's behaviour.
 */
export const LAST_CALL_DEFAULT = 60;
export const LAST_CALL_CHOICES = [0, 30, 60, 90, 120];

/** The instant a night key stops being the current night: 4am the morning after. */
export function nightEndInstant(key) {
  const base = keyToDate(key);
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + 1, NIGHT_BOUNDARY_HOUR, 0, 0, 0);
}

export function lastCallInstant(key, bedtime, lastCall = LAST_CALL_DEFAULT, { clamp = true } = {}) {
  const minutes = Math.max(0, Math.round(Number(lastCall) || 0));
  if (!minutes) return null;
  const target = bedtimeInstant(key, bedtime);
  if (!target) return null;
  // Through the epoch, not `setMinutes`. Adding to a Date's minute field walks
  // the local calendar, so an offset spanning a DST boundary would land on the
  // same wall-clock arithmetic rather than the same number of real minutes —
  // and the whole point of this number is how long you have actually been up.
  const raw = new Date(target.getTime() + minutes * 60000);
  // Never past the end of the night it belongs to. A 3:45 bedtime with two hours
  // put last call at 5:45am — a moment this key never sees, because the night
  // rolls at 4 and every consumer asks about the *current* key. So the stage
  // could not fire, while Settings named 5:45 AM as the time it would. 4am is
  // the real answer there: the night ends, the list resets, and nothing later
  // than that belongs to it. Clamped forward only — if the bedtime itself is
  // already past the boundary, last call stays after the bedtime it follows.
  // `clamp: false` asks what the offset alone would have produced, which is the
  // only honest way to explain the clamp to someone: "two hours past 3:45 would
  // be 5:45, but the night ends at 4" is true, and "120 minutes past 3:45 AM,
  // so 4:00 AM" — which is what the settings hint said — is not.
  if (!clamp) return raw;
  const end = nightEndInstant(key);
  return raw > end && end > target ? end : raw;
}

/**
 * The clock face last call lands on — "10:45 PM" — or '—' when it is off.
 *
 * Formatted from the instant rather than by adding to the bedtime string,
 * because the offset can cross midnight (an 11:30 bedtime and 120 minutes is
 * 1:30 the next day) and string arithmetic on "23:30" + 120 does not.
 */
export function formatLastCall(key, bedtime, lastCall = LAST_CALL_DEFAULT, opts) {
  const at = lastCallInstant(key, bedtime, lastCall, opts);
  if (!at) return '—';
  return at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** True when the 4am rollover, rather than your offset, is what sets last call. */
export function lastCallCapped(key, bedtime, lastCall = LAST_CALL_DEFAULT) {
  const at = lastCallInstant(key, bedtime, lastCall);
  return at !== null && at.getTime() === nightEndInstant(key).getTime();
}

/** Signed minutes past last call; negative before it, null when it is off. */
export function minutesPastLastCall(key, bedtime, lastCall, now = new Date()) {
  const target = lastCallInstant(key, bedtime, lastCall);
  if (!target) return null;
  return (now.getTime() - target.getTime()) / 60000;
}

/**
 * How late it is, as one word, for everything that has to change with it.
 *
 * 'clear'    before the curfew window — nothing is different
 * 'curfew'   inside the half hour before bedtime; the browsing panels soft-close
 * 'past'     bedtime has gone by
 * 'lastcall' past the second line; the app stops offering a way back in
 *
 * One function so the ladder is defined once. `'clear'` whenever there is no
 * usable bedtime or last call is off, which is what makes the whole feature
 * switch off from a single place.
 */
/**
 * What the four browsing panels do at a stage — the one place the two settings
 * that can close them are combined.
 *
 * 'open' nothing in the way · 'soft' the curfew sheet, with a way through ·
 * 'shut' past last call, and there is no way through.
 *
 * Here rather than at each call site because there were two call sites and they
 * disagreed. Both asked "is the curfew toggle on?" first, which made last call a
 * sub-clause of a different setting: turn off "close the market before bed" and
 * last call quietly stopped closing anything, while the Last call row directly
 * above that toggle went on saying it would. Two settings, two rungs, two off
 * switches; this function is where that is written down.
 */
export function panelGate(stage, curfewEnabled = true) {
  if (stage === 'lastcall') return 'shut';
  if (!curfewEnabled) return 'open';
  return stage === 'curfew' || stage === 'past' ? 'soft' : 'open';
}

export function lateStage(key, bedtime, lastCall = LAST_CALL_DEFAULT, now = new Date()) {
  const minutesLeft = minutesUntilBedtime(key, bedtime, now);
  if (minutesLeft === null) return 'clear';
  // `< 0`, matching pacingStatus and lightsOut: the bedtime minute itself
  // counts as on time, and an app that pays you for stopping in that minute
  // must not simultaneously be telling you that you are past it.
  if (minutesLeft < 0) {
    const past = minutesPastLastCall(key, bedtime, lastCall, now);
    // `>= 0` here, unlike above: last call is not a target you are rewarded for
    // meeting, it is a line, and the minute it lands on is over it.
    return past !== null && past >= 0 ? 'lastcall' : 'past';
  }
  return minutesLeft <= CURFEW_LEAD_MINUTES ? 'curfew' : 'clear';
}
