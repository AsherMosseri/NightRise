/* The nightly cycle: live stats, rollover, banking, streaks and freezes. */

import { createNight } from './model.js';
import { nightKeyOf, keyDiffDays, bedtimeInstant } from './time.js';
import { STREAK_THRESHOLD_PCT } from './game.js';
import { checkAchievements } from './achievements.js';

/** Live view of tonight — used by the header, sky, quests and pacing. */
export function computeStats(state) {
  const { template, night } = state;
  const sections = [];
  let total = 0;
  let done = 0;
  let skipped = 0;
  let minutesRemaining = 0;

  for (const sectionId of template.order) {
    const section = template.sections[sectionId];
    if (!section) continue;
    const entry = { id: sectionId, title: section.title, total: 0, done: 0, skipped: 0, remaining: 0 };
    for (const taskId of section.taskIds) {
      const task = template.tasks[taskId];
      if (!task) continue;
      entry.total += 1;
      total += 1;
      // Presence, not truthiness — a completion timestamp could legitimately be 0.
      if (night.done[taskId] !== undefined) {
        entry.done += 1;
        done += 1;
      } else if (night.skipped[taskId]) {
        entry.skipped += 1;
        skipped += 1;
      } else {
        entry.remaining += 1;
        minutesRemaining += Math.max(0, task.minutes || 0);
      }
    }
    sections.push(entry);
  }

  const counted = total - skipped;
  const remaining = total - done - skipped;
  const pct = total === 0 || counted === 0 ? 0 : Math.round((done / counted) * 100);
  return { total, done, skipped, remaining, counted, pct, minutesRemaining, sections };
}

export function summarizeForHistory(stats, xpEarned) {
  return {
    total: stats.total,
    done: stats.done,
    skipped: stats.skipped,
    pct: stats.pct,
    xp: Math.round(xpEarned || 0),
    quest: false,
    frozen: false,
    lightsOutAt: null,
    onTime: false,
    // The target as it stood that night, so changing your bedtime later cannot
    // rewrite whether you made it, and how far off you were either way.
    bedtime: null,
    minutesLate: null,
  };
}

/** How late the night ended against its own target. Negative is early. */
export function latenessOf(night, bedtime) {
  if (!night.lightsOutAt) return null;
  const target = bedtimeInstant(night.key, bedtime);
  if (!target) return null;
  return Math.round((night.lightsOutAt - target.getTime()) / 60000);
}

function stampBedtime(entry, state) {
  const { night, profile } = state;
  entry.lightsOutAt = night.lightsOutAt || null;
  entry.onTime = Boolean(night.lightsOutOnTime);
  entry.bedtime = night.lightsOutAt ? (profile.settings?.bedtime || null) : null;
  entry.minutesLate = latenessOf(night, profile.settings?.bedtime);
  return entry;
}

function xpEarnedTonight(state) {
  return Object.values(state.night.awards).reduce((sum, a) => sum + (a?.xp || 0), 0);
}

function updateTaskStats(state, stats) {
  const { template, night, profile } = state;
  if (!profile.taskStats) profile.taskStats = {};
  for (const task of Object.values(template.tasks)) {
    const entry = profile.taskStats[task.id] || { seen: 0, done: 0, skipped: 0, missStreak: 0, lastDoneKey: null };
    entry.seen += 1;
    if (night.done[task.id] !== undefined) {
      entry.done += 1;
      entry.missStreak = 0;
      entry.lastDoneKey = night.key;
    } else {
      if (night.skipped[task.id]) entry.skipped += 1;
      entry.missStreak += 1;
    }
    profile.taskStats[task.id] = entry;
  }
  // Forget stats for tasks that no longer exist.
  for (const id of Object.keys(profile.taskStats)) {
    if (!template.tasks[id]) delete profile.taskStats[id];
  }
  return stats;
}

/**
 * Fold the finished night into history and update the streak.
 * A Streak Freeze covers one missed night — including nights where the app
 * was never opened, detected via the gap since the last banked night.
 */
export function bankNight(state, stats) {
  const { profile, night } = state;
  const xp = xpEarnedTonight(state);
  const met = stats.total > 0 && stats.pct >= STREAK_THRESHOLD_PCT;

  const result = {
    key: night.key, stats, met, xp,
    streakBefore: profile.streak, streakAfter: profile.streak,
    frozenUsed: 0, missedNights: 0, badges: [], alreadyBanked: false,
  };

  // Banking is idempotent per night key. Without this, "start a fresh night"
  // followed by the 4am rollover banked the same key twice: the second pass saw
  // an empty night, overwrote a 100% history entry with 0%, burned a freeze and
  // reset the streak.
  //
  // The history entry is the exception. Starting fresh gives the same date a
  // second run, and what you did on a date is the best you got to on it — so
  // the entry may improve, while the streak, the freezes and the per-task
  // stats stay counted exactly once.
  if (profile.lastBankedKey === night.key) {
    result.alreadyBanked = true;
    const previous = state.history[night.key];
    if (stats.total > 0 && (!previous || stats.pct > previous.pct)) {
      const better = summarizeForHistory(stats, xp);
      better.quest = Boolean(night.quest?.claimed) || Boolean(previous?.quest);
      stampBedtime(better, state);
      if (!better.lightsOutAt && previous?.lightsOutAt) {
        // A second run at the same night keeps the bedtime the first one recorded.
        better.lightsOutAt = previous.lightsOutAt;
        better.onTime = Boolean(previous.onTime);
        better.bedtime = previous.bedtime ?? null;
        better.minutesLate = previous.minutesLate ?? null;
      }
      better.frozen = Boolean(previous?.frozen);
      state.history[night.key] = better;
    }
    return result;
  }

  if (stats.total === 0) return result; // Nothing was ever on the list; don't judge it.

  const gapMissed = profile.lastBankedKey
    ? Math.max(0, keyDiffDays(profile.lastBankedKey, night.key) - 1)
    : 0;
  const needed = gapMissed + (met ? 0 : 1);
  result.missedNights = needed;

  if (needed === 0) {
    profile.streak += 1;
  } else if (profile.streak > 0 && profile.tokens.freeze >= needed) {
    profile.tokens.freeze -= needed;
    result.frozenUsed = needed;
    if (met) profile.streak += 1;
  } else {
    profile.streak = met ? 1 : 0;
  }

  profile.bestStreak = Math.max(profile.bestStreak, profile.streak);
  profile.nightsLogged += 1;
  profile.lastBankedKey = night.key;

  const entry = summarizeForHistory(stats, xp);
  entry.quest = Boolean(night.quest?.claimed);
  stampBedtime(entry, state);
  entry.frozen = result.frozenUsed > 0;
  state.history[night.key] = entry;

  updateTaskStats(state, stats);
  result.streakAfter = profile.streak;
  result.achievements = checkAchievements(state, stats);
  return result;
}

/**
 * Roll over to a new night if the clock has crossed the 4am boundary.
 * Returns the banking result, or null when nothing changed.
 */
export function rolloverIfNeeded(state, now = new Date()) {
  const key = nightKeyOf(now);
  if (state.night.key === key) return null;
  // Only ever roll forward. A clock correction, a timezone hop westward or a
  // manually-set date could otherwise re-bank an old key and overwrite history.
  //
  // A night dated exactly one day ahead is not a rollover, it is a mistake to
  // undo: "start fresh" used to jump a day forward, which left the app
  // insisting it was tomorrow — tomorrow's date in the header, and "24h 32m
  // left" until a bedtime half an hour away. Retitle it to tonight. Nothing has
  // ended, so nothing is banked. A bigger gap is a wrong clock rather than our
  // bug, and renaming a night across a week could land on a real history entry.
  const drift = keyDiffDays(state.night.key, key);
  if (drift < 0) {
    if (drift === -1) state.night.key = key;
    return null;
  }
  const stats = computeStats(state);
  const result = bankNight(state, stats);
  state.night = createNight(key);
  return result;
}

/**
 * The lights-out streak: nights you stopped before your bedtime, back to back.
 *
 * "In a row" has to mean consecutive dates. This used to add one whenever there
 * was any previous on-time night at all, so three scattered across a month read
 * as three nights running — and a badge that says "three nights running" has to
 * be telling the truth.
 */
export function advanceLightsOutStreak(lights, key, onTime) {
  if (!lights || lights.lastKey === key) return lights; // once per night, however many presses
  const consecutive = Boolean(lights.lastKey) && keyDiffDays(lights.lastKey, key) === 1;
  lights.streak = onTime ? (consecutive ? (lights.streak || 0) + 1 : 1) : 0;
  lights.best = Math.max(lights.best || 0, lights.streak);
  lights.lastKey = key;
  return lights;
}

/**
 * Manual "start a fresh night" — bank what you did, then hand back a clean list
 * for the *same* night. It is still tonight; you have not gone to bed and woken
 * up, you have just decided to run the evening again.
 *
 * This used to advance to the next key, as a workaround for the 4am rollover
 * banking the same night twice. Banking is idempotent per key now, so the
 * workaround only did harm: it dated the night a day into the future, so the
 * header showed tomorrow and the bedtime countdown read a full day.
 */
export function forceNewNight(state, key, now = new Date()) {
  const stats = computeStats(state);
  const result = bankNight(state, stats);
  state.night = createNight(key || nightKeyOf(now));
  return result;
}

/**
 * Nights that have gone by unbanked since the last one you banked. The streak
 * in `profile` is only updated when a night is banked, so after three nights
 * away the app cheerfully showed the old number until 4am the next morning.
 */
export function pendingMisses(state, now = new Date()) {
  const { lastBankedKey } = state.profile;
  if (!lastBankedKey) return 0;
  return Math.max(0, keyDiffDays(lastBankedKey, nightKeyOf(now)) - 1);
}

/** The streak as it actually stands right now, not as it was last banked. */
export function effectiveStreak(state, now = new Date()) {
  const missed = pendingMisses(state, now);
  const held = state.profile.tokens.freeze || 0;
  if (missed === 0) {
    return { streak: state.profile.streak, missed: 0, covered: 0, atRisk: false };
  }
  // bankNight is all-or-nothing: it spends freezes only when it holds enough to
  // cover every missed night, and otherwise spends none and resets the streak.
  // This used to report `min(missed, held)`, so with one freeze against two
  // missed nights the header cheerfully said a freeze would cover it — and then
  // 4am spent nothing and took the streak anyway. It reports what will actually
  // happen: either the whole gap is covered or none of it is.
  const enough = held >= missed;
  const covered = enough ? missed : 0;
  const survives = enough && state.profile.streak > 0;
  return {
    streak: survives ? state.profile.streak : 0,
    missed,
    covered,
    held,
    atRisk: true,
  };
}
