/* XP, levels, titles, combo and badges.
   The pure math lives at the top; the `apply*` helpers mutate a state draft. */

import { clamp } from './util.js';

export const COMBO_WINDOW_MS = 90 * 1000;
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
  { id: 'level-5', name: 'Star Gazer', hint: 'Reach level 5', icon: 'star' },
  { id: 'level-10', name: 'Deep Sky', hint: 'Reach level 10', icon: 'star' },
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
  award('level-5', profile.level >= 5);
  award('level-10', profile.level >= 10);
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

/** Grant XP (and optional stardust). Returns the levels crossed. */
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
    profile.stardust += levelUpDust(lvl);
  }
  return levelsGained;
}

/** Current chain length given the last completion time. */
export function chainLengthFor(night, at) {
  if (!night.lastDoneAt || at - night.lastDoneAt > COMBO_WINDOW_MS) return 1;
  return Math.round((night.combo - 1) / COMBO_STEP) + 2;
}

/**
 * Award a task completion. Mutates `state` and records the exact award so
 * un-checking can reverse it precisely.
 */
export function applyTaskCompletion(state, task, at = Date.now()) {
  const night = state.night;
  const chain = chainLengthFor(night, at);
  const multiplier = comboMultiplier(chain);
  const xp = taskXp(task.minutes, multiplier);
  const dust = stardustFor(xp);

  night.done[task.id] = at;
  delete night.skipped[task.id];
  night.awards[task.id] = { xp, dust, multiplier };
  night.combo = multiplier;
  night.maxCombo = Math.max(night.maxCombo || 1, multiplier);
  night.lastDoneAt = at;

  const levels = grantXp(state, xp, dust);
  return { xp, dust, multiplier, chain, levels };
}

export function revokeTaskCompletion(state, taskId) {
  const night = state.night;
  const award = night.awards[taskId];
  delete night.done[taskId];
  delete night.awards[taskId];
  if (!award) return null;
  state.profile.xp = Math.max(0, state.profile.xp - award.xp);
  state.profile.stardust = Math.max(0, state.profile.stardust - award.dust);
  state.profile.level = levelFromXp(state.profile.xp).level;
  return award;
}

/** One-off bonus for clearing everything that still counts tonight. */
export function nightCompletionBonus(stats) {
  const base = 40 + stats.total * 6;
  return { xp: base, dust: stardustFor(base) };
}
