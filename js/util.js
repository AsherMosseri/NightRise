/* Small shared helpers. No dependencies. */

let idCounter = 0;

export function uid(prefix = 'id') {
  idCounter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${rand}`;
}

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export function pad2(n) {
  return String(n).padStart(2, '0');
}

export function debounce(fn, ms) {
  let timer = null;
  const wrapped = (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  };
  wrapped.flush = (...args) => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
      fn(...args);
    }
  };
  return wrapped;
}

/** Move an item within an array, returning a new array. */
export function moveItem(arr, from, to) {
  const next = arr.slice();
  if (from < 0 || from >= next.length) return next;
  const target = clamp(to, 0, next.length - 1);
  const [item] = next.splice(from, 1);
  next.splice(target, 0, item);
  return next;
}

export function deepClone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

/** Deterministic 32-bit hash — used to seed per-night randomness. */
export function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Seeded PRNG so a given night always rolls the same quest. */
export function seededRandom(seed) {
  let s = seed >>> 0 || 1;
  return function next() {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export function formatNumber(n) {
  return Math.round(n).toLocaleString();
}

/** "3h 12m" / "12m" / "just now" style duration for the bedtime countdown. */
export function formatDuration(minutes) {
  const raw = Math.abs(Number(minutes) || 0);
  const total = Math.round(raw);
  // Half a minute of work left is not "0m left" — that reads as nothing to do.
  if (total === 0 && raw > 0) return '<1m';
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

export function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

/* ------------------------------------------------------- task time estimates */

/**
 * Estimates are stored in minutes, but real tasks are not whole minutes: taking
 * out the bins is thirty seconds and a shower is seven. We keep the minute as
 * the unit (every saved night stays valid) and quantise to a half, which is the
 * finest distinction anyone can honestly make about their own evening.
 */
export const MINUTE_STEP = 0.5;
export const MAX_MINUTES = 600;

/** Clamp and quantise, or null if the value was not a number at all. */
export function roundMinutes(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return clamp(Math.round(n / MINUTE_STEP) * MINUTE_STEP, 0, MAX_MINUTES);
}

/** Compact, for the row chip: "30s", "7m", "7½m". */
export function formatMinutesShort(minutes) {
  const m = roundMinutes(minutes) ?? 0;
  if (m === 0) return '—';
  if (m < 1) return '30s';
  const whole = Math.floor(m);
  return m === whole ? `${whole}m` : `${whole}½m`;
}

/** Unambiguous but short, for the stepper readout: "30s", "7m", "7m 30s". */
export function formatMinutesClock(minutes) {
  const m = roundMinutes(minutes) ?? 0;
  if (m === 0) return 'no estimate';
  const whole = Math.floor(m);
  if (!whole) return '30s';
  return m === whole ? `${whole}m` : `${whole}m 30s`;
}

/** Spoken, for labels and sheets: "30 seconds", "1 minute", "7 minutes 30 seconds". */
export function formatMinutesLong(minutes) {
  const m = roundMinutes(minutes) ?? 0;
  if (m === 0) return 'no estimate';
  const whole = Math.floor(m);
  if (!whole) return '30 seconds';
  if (m === whole) return plural(whole, 'minute', 'minutes');
  return `${plural(whole, 'minute', 'minutes')} 30 seconds`;
}

/**
 * Stepping an estimate up or down by an amount that matches its size — half
 * minutes near zero, five-minute jumps once you are past ten. One long press
 * should not take you from 30s to 45 minutes, and it should not take forty taps
 * to get there either.
 */
export function stepMinutes(current, direction) {
  const m = roundMinutes(current) ?? 0;
  const up = direction > 0;
  const size = (() => {
    if (up ? m < 2 : m <= 2) return 0.5;
    if (up ? m < 10 : m <= 10) return 1;
    if (up ? m < 30 : m <= 30) return 5;
    return 10;
  })();
  return roundMinutes(m + (up ? size : -size));
}
