/* XP, levels, titles, combo and badges.
   The pure math lives at the top; the `apply*` helpers mutate a state draft. */

import { clamp } from './util.js';

/**
 * Momentum, not speed.
 *
 * The original combo paid its biggest multiplier for checking seven boxes
 * inside 90 seconds — i.e. for standing in the bathroom tapping the phone
 * rather than doing the things. That is exactly backwards for an app whose
 * whole purpose is getting you off the phone and into bed.
 *
 * Momentum instead rises when the gap between check-offs looks like you
 * actually went and did it: longer than a token tap, shorter than a drift into
 * scrolling. Both failure modes reset it to x1.
 */
export const MOMENTUM_MIN_GAP_MS = 20 * 1000;
export const MOMENTUM_GRACE_MS = 3 * 60 * 1000;
export const COMBO_STEP = 0.25;
export const COMBO_MAX = 2.5;
export const BASE_TASK_XP = 10;
export const STREAK_THRESHOLD_PCT = 60;

export const TITLES = [
  { level: 1, name: 'Dreamer' },
  { level: 3, name: 'Night Owl' },
  { level: 5, name: 'Star Gazer' },
  { level: 8, name: 'Moon Walker' },
  { level: 12, name: 'Dusk Warden' },
  { level: 16, name: 'Void Sailor' },
  { level: 20, name: 'Constellation Keeper' },
  { level: 25, name: 'Keeper of the Long Dark' },
];

/** XP needed to get from `level` to `level + 1`. */
export function xpForLevel(level) {
  return Math.round(80 * Math.pow(Math.max(1, level), 1.35));
}

export function levelFromXp(xp) {
  let level = 1;
  let remaining = Math.max(0, xp);
  let need = xpForLevel(level);
  while (remaining >= need && level < 999) {
    remaining -= need;
    level += 1;
    need = xpForLevel(level);
  }
  return { level, into: remaining, need, pct: Math.round((remaining / need) * 100) };
}

export function titleForLevel(level) {
  let title = TITLES[0].name;
  for (const entry of TITLES) if (level >= entry.level) title = entry.name;
  return title;
}

export function nextTitle(level) {
  return TITLES.find((entry) => entry.level > level) || null;
}

/** Multiplier for the nth task in a back-to-back chain (1-based). */
export function comboMultiplier(chainLength) {
  return clamp(1 + (Math.max(1, chainLength) - 1) * COMBO_STEP, 1, COMBO_MAX);
}

export function taskXp(minutes, multiplier = 1) {
  return Math.max(1, Math.round((BASE_TASK_XP + Math.max(0, minutes || 0)) * multiplier));
}

export function stardustFor(xp) {
  return Math.max(1, Math.round(xp / 5));
}

export function levelUpDust(level) {
  return 40 + level * 10;
}

export const BADGES = [
  { id: 'first-night', name: 'First Light', hint: 'Bank your first night', icon: 'moon' },
  { id: 'perfect', name: 'Flawless Night', hint: 'Finish 100% of a night', icon: 'check' },
  { id: 'streak-3', name: 'Three in a Row', hint: 'Hold a 3 night streak', icon: 'flame' },
  { id: 'streak-7', name: 'Week of Nights', hint: 'Hold a 7 night streak', icon: 'flame' },
  { id: 'streak-30', name: 'Moon Cycle', hint: 'Hold a 30 night streak', icon: 'moon' },
  // `level` marks a badge for where you *are* rather than what you did, so it
  // comes off again if un-checking a task drops you back below it.
  { id: 'level-5', name: 'Star Gazer', hint: 'Reach level 5', icon: 'star', level: 5 },
  { id: 'level-10', name: 'Deep Sky', hint: 'Reach level 10', icon: 'star', level: 10 },
  { id: 'combo-max', name: 'Chain Lightning', hint: 'Hit a x2.5 combo', icon: 'flame' },
  { id: 'after-hours', name: 'After Hours', hint: 'Check something off past 1am', icon: 'moon' },
  { id: 'collector', name: 'Collector', hint: 'Own 5 shop unlocks', icon: 'bag' },
  { id: 'constellation', name: 'Cartographer', hint: 'Complete a constellation', icon: 'map' },
  { id: 'companion', name: 'Best Friend', hint: 'Raise a companion to tier 3', icon: 'star' },
];

export function badgeById(id) {
  return BADGES.find((b) => b.id === id) || null;
}

function inventorySize(profile) {
  return Object.values(profile.inventory).reduce((sum, list) => sum + list.length, 0);
}

/** Returns ids of badges newly earned by the current state. */
export function checkBadges(state, stats) {
  const { profile } = state;
  const owned = new Set(profile.badges);
  const earned = [];
  const award = (id, condition) => {
    if (condition && !owned.has(id)) {
      owned.add(id);
      earned.push(id);
    }
  };

  award('first-night', profile.nightsLogged >= 1);
  award('perfect', Object.values(state.history).some((h) => h.pct >= 100 && h.total > 0)
    || (stats && stats.total > 0 && stats.remaining === 0));
  award('streak-3', profile.streak >= 3);
  award('streak-7', profile.streak >= 7);
  award('streak-30', profile.streak >= 30);
  for (const badge of BADGES) {
    if (badge.level) award(badge.id, profile.level >= badge.level);
  }
  award('combo-max', (state.night.maxCombo || 1) >= COMBO_MAX);
  award('after-hours', Object.values(state.night.done).some((ts) => {
    const hour = new Date(ts).getHours();
    return hour >= 0 && hour < 4;
  }));
  award('collector', inventorySize(profile) >= 9); // 4 freebies + 5 unlocks
  award('constellation', Object.values(profile.constellations).some((c) => c && c.complete));
  award('companion', (profile.companion?.tier || 0) >= 3);

  if (earned.length) profile.badges = Array.from(owned);
  return earned;
}

/**
 * Grant XP (and optional stardust). Returns the levels crossed.
 *
 * Level-up stardust is paid against a high-water mark. Without it, crossing a
 * level boundary, un-checking the task and re-checking it paid the level bonus
 * again every time — the level is recomputed from XP, so the same boundary can
 * be crossed all night.
 */
export function grantXp(state, xp, dust = 0) {
  const { profile } = state;
  const before = profile.level;
  profile.xp = Math.max(0, profile.xp + xp);
  profile.stardust = Math.max(0, profile.stardust + dust);
  const after = levelFromXp(profile.xp).level;
  profile.level = after;
  const levelsGained = [];
  for (let lvl = before + 1; lvl <= after; lvl += 1) {
    levelsGained.push(lvl);
    if (lvl > (profile.maxLevelRewarded || 1)) {
      profile.stardust += levelUpDust(lvl);
      profile.maxLevelRewarded = lvl;
    }
  }
  return levelsGained;
}

/** How long a task claiming `minutes` may reasonably take before you have drifted. */
export function momentumWindow(minutes) {
  const expected = Math.max(0, minutes || 0) * 60 * 1000;
  return clamp(expected * 2.5, 4 * 60 * 1000, 25 * 60 * 1000) + MOMENTUM_GRACE_MS;
}

/**
 * The chain length this completion earns. 1 means the chain restarted: either
 * the tap came too fast to be real work, or too long after the last one.
 */
export function chainLengthFor(night, at, lastMinutes = 0) {
  const last = night.lastDoneAt;
  if (!last) return 1;
  const gap = at - last;
  if (gap < MOMENTUM_MIN_GAP_MS) return 1;
  if (gap > momentumWindow(lastMinutes)) return 1;
  return Math.round((night.combo - 1) / COMBO_STEP) + 2;
}

/**
 * Award a task completion. Mutates `state` and records the exact award so
 * un-checking can reverse it precisely.
 */
export function applyTaskCompletion(state, task, at = Date.now()) {
  const night = state.night;
  const chain = chainLengthFor(night, at, night.lastMinutes || 0);
  const multiplier = comboMultiplier(chain);
  const xp = taskXp(task.minutes, multiplier);
  const dust = stardustFor(xp);

  night.done[task.id] = at;
  delete night.skipped[task.id];
  // Remember the chain state this completion replaced so un-checking can put
  // it back; otherwise re-checking one task ratchets the combo upward forever.
  night.awards[task.id] = {
    xp, dust, multiplier, at, prevCombo: night.combo, prevLastDoneAt: night.lastDoneAt,
  };
  night.awards[task.id].prevMinutes = night.lastMinutes || 0;
  night.combo = multiplier;
  night.maxCombo = Math.max(night.maxCombo || 1, multiplier);
  night.lastDoneAt = at;
  night.lastMinutes = Math.max(0, task.minutes || 0);

  const levels = grantXp(state, xp, dust);
  return { xp, dust, multiplier, chain, levels };
}

/** Take back an exact amount, keeping the level in step. */
/**
 * Falling back below a level takes the level's reward with it. Reaching level 5
 * and then un-checking your way back to level 4 should leave you at level 4 in
 * every sense — not level 4 holding level 5's stardust.
 *
 * The one exception is dust you have already spent. It cannot be clawed out of
 * a purchase, and a negative balance is not an answer, so the high-water mark
 * stays up instead: you keep it, and that level is never paid a second time.
 */
function refundLevelUps(profile) {
  while ((profile.maxLevelRewarded || 1) > profile.level) {
    const dust = levelUpDust(profile.maxLevelRewarded);
    if (profile.stardust < dust) break;
    profile.stardust -= dust;
    profile.maxLevelRewarded -= 1;
  }
}

/** Badges you can fall out of: the ones that describe where you are. */
export function dropUnearnedBadges(state) {
  const { profile } = state;
  const lost = BADGES
    .filter((badge) => badge.level && profile.level < badge.level)
    .map((badge) => badge.id)
    .filter((id) => profile.badges.includes(id));
  if (lost.length) profile.badges = profile.badges.filter((id) => !lost.includes(id));
  return lost;
}

/** Reverses a grant exactly, including anything the level it bought paid out. */
export function revokeGrant(state, xp, dust) {
  const { profile } = state;
  const before = profile.level;
  profile.xp = Math.max(0, profile.xp - (xp || 0));
  profile.stardust = Math.max(0, profile.stardust - (dust || 0));
  profile.level = levelFromXp(profile.xp).level;
  refundLevelUps(profile);
  const lostBadges = dropUnearnedBadges(state);
  const levelsLost = [];
  for (let lvl = before; lvl > profile.level; lvl -= 1) levelsLost.push(lvl);
  return { levelsLost, lostBadges };
}

export function revokeTaskCompletion(state, taskId) {
  const night = state.night;
  const award = night.awards[taskId];
  delete night.done[taskId];
  delete night.awards[taskId];
  if (!award) return null;
  revokeGrant(state, award.xp, award.dust);
  // Only the most recent completion owns the current chain.
  if (award.at !== undefined && night.lastDoneAt === award.at) {
    night.combo = award.prevCombo ?? 1;
    night.lastDoneAt = award.prevLastDoneAt ?? 0;
    night.lastMinutes = award.prevMinutes ?? 0;
  }
  return award;
}

/** One-off bonus for clearing everything that still counts tonight. */
export function nightCompletionBonus(stats) {
  const base = 40 + stats.total * 6;
  return { xp: base, dust: stardustFor(base) };
}
