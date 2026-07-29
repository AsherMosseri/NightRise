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
  const total = Math.abs(Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

export function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}
