/* The nightly cycle: live stats, rollover, banking, streaks and freezes. */

import { createNight } from './model.js';
import { nightKeyOf, keyDiffDays, shiftKey } from './time.js';
import { STREAK_THRESHOLD_PCT, checkBadges } from './game.js';

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
  };
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
  if (profile.lastBankedKey === night.key) {
    result.alreadyBanked = true;
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
  entry.lightsOutAt = night.lightsOutAt || null;
  entry.onTime = Boolean(night.lightsOutOnTime);
  entry.frozen = result.frozenUsed > 0;
  state.history[night.key] = entry;

  updateTaskStats(state, stats);
  result.streakAfter = profile.streak;
  result.badges = checkBadges(state, stats);
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
  if (keyDiffDays(state.night.key, key) < 0) return null;
  const stats = computeStats(state);
  const result = bankNight(state, stats);
  state.night = createNight(key);
  return result;
}

/**
 * Manual "start a fresh night" — banks the current one and moves on to the next
 * key. Re-using the current key left a duplicate night that the 4am rollover
 * banked a second time, as 0%.
 */
export function forceNewNight(state, key) {
  const stats = computeStats(state);
  const result = bankNight(state, stats);
  state.night = createNight(key || shiftKey(state.night.key, 1));
  return result;
}
