/* The card timer: a countdown that refuses to end.
 *
 * A timer that stops at zero has to decide what zero means, and every answer is
 * wrong at midnight — an alarm is a jolt, a dismissal is a chore, and "time's
 * up" on tidying the kitchen is a lie. So it keeps going. Past zero the numbers
 * count up instead of down and the colour changes, which is the whole message:
 * not "you failed", just "this is taking longer than you thought". Nothing
 * beeps, nothing blocks, nothing has to be dismissed.
 *
 * Pure functions of (planned, elapsed) so the awkward parts — the last second,
 * an estimate of zero, an hour of overtime — are testable without a clock.
 */

import { pad2 } from './util.js';

/** Inside the last fifth, or the last half minute, whichever is longer. */
export const WARN_FRACTION = 0.2;
export const WARN_FLOOR_MS = 30_000;

export function warnThresholdMs(plannedMs) {
  return Math.max(WARN_FLOOR_MS, Math.round(plannedMs * WARN_FRACTION));
}

/**
 * 'open'    no estimate to measure against — a plain stopwatch
 * 'running' comfortably inside the estimate
 * 'close'   nearly out of it
 * 'over'    past it, and counting up
 */
export function timerPhase(plannedMs, elapsedMs) {
  if (!plannedMs || plannedMs <= 0) return 'open';
  const left = plannedMs - elapsedMs;
  if (left <= 0) return 'over';
  if (left <= warnThresholdMs(plannedMs)) return 'close';
  return 'running';
}

function clock(seconds) {
  const total = Math.max(0, seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}

/**
 * The face of the clock. Counting down rounds up, so "0:01" holds until the
 * second is genuinely gone and "0:00" means zero; counting up rounds down, so
 * "+0:01" appears only once a second has actually passed.
 */
export function timerLabel(plannedMs, elapsedMs) {
  if (!plannedMs || plannedMs <= 0) return clock(Math.floor(elapsedMs / 1000));
  const left = plannedMs - elapsedMs;
  if (left >= 0) return clock(Math.ceil(left / 1000));
  return `+${clock(Math.floor(-left / 1000))}`;
}

/** The line under the numbers, so the estimate is never guesswork. */
export function timerCaption(plannedMs, elapsedMs, spokenEstimate) {
  if (!plannedMs || plannedMs <= 0) return 'no estimate — just counting';
  return plannedMs - elapsedMs >= 0
    ? `left of ${spokenEstimate}`
    : `over ${spokenEstimate}`;
}

/** How full the drain bar is: 0 at the start, 1 at the estimate and beyond. */
export function timerProgress(plannedMs, elapsedMs) {
  if (!plannedMs || plannedMs <= 0) return 0;
  return Math.min(1, Math.max(0, elapsedMs / plannedMs));
}

/* ------------------------------------------------------------ the stopwatch */

export function createTimer(taskId, minutes, running = false, now = Date.now()) {
  return {
    taskId,
    plannedMs: Math.max(0, Number(minutes) || 0) * 60_000,
    accumulatedMs: 0,
    startedAt: running ? now : null,
  };
}

/** Elapsed is derived from timestamps, so a throttled tab cannot lose time. */
export function elapsedOf(timer, now = Date.now()) {
  if (!timer) return 0;
  return timer.accumulatedMs + (timer.startedAt === null ? 0 : Math.max(0, now - timer.startedAt));
}

export function isRunning(timer) {
  return Boolean(timer && timer.startedAt !== null);
}

export function startTimer(timer, now = Date.now()) {
  if (!timer || timer.startedAt !== null) return timer;
  timer.startedAt = now;
  return timer;
}

export function pauseTimer(timer, now = Date.now()) {
  if (!timer || timer.startedAt === null) return timer;
  timer.accumulatedMs = elapsedOf(timer, now);
  timer.startedAt = null;
  return timer;
}

export function toggleTimer(timer, now = Date.now()) {
  return isRunning(timer) ? pauseTimer(timer, now) : startTimer(timer, now);
}

export function resetTimer(timer, running = false, now = Date.now()) {
  if (!timer) return timer;
  timer.accumulatedMs = 0;
  timer.startedAt = running ? now : null;
  return timer;
}
