/* Nightly bonus quests. The roll is seeded by the night key so a reload
   never rerolls, and every `measure` is a pure read of state + stats. */

import { hashString, seededRandom, formatMultiplier } from './util.js';
import { bedtimeInstant } from './time.js';

const SPRINT_WINDOW_MS = 5 * 60 * 1000;
/** "Front loaded" means done with an hour still on the clock. */
const FRONT_LOAD_LEAD_MS = 60 * 60 * 1000;

/** The moment after which a completion is no longer early. */
function frontLoadCutoff(state) {
  const target = bedtimeInstant(state.night.key, state.profile?.settings?.bedtime);
  return target ? target.getTime() - FRONT_LOAD_LEAD_MS : null;
}

function clockLabel(ms) {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/**
 * Cleared means you did the work. Rain-checking every task in a section leaves
 * nothing remaining, which used to count — two rain checks and a two-task
 * section was a quest reward for doing nothing at all.
 */
function clearedSections(stats) {
  return stats.sections.filter((s) => s.total > 0 && s.remaining === 0 && s.done > 0).length;
}

/** Largest number of completions falling inside one sliding window. */
function busiestWindow(doneTimes, windowMs) {
  const times = doneTimes.slice().sort((a, b) => a - b);
  let best = 0;
  let start = 0;
  for (let end = 0; end < times.length; end += 1) {
    while (times[end] - times[start] > windowMs) start += 1;
    best = Math.max(best, end - start + 1);
  }
  return best;
}

export const QUEST_DEFS = [
  {
    id: 'sprint',
    name: 'Meteor Shower',
    describe: () => 'Finish 3 tasks within 5 minutes',
    goal: 3,
    xp: 45,
    dust: 25,
    measure: (state) => busiestWindow(Object.values(state.night.done), SPRINT_WINDOW_MS),
  },
  {
    id: 'clearSection',
    name: 'Clean Sweep',
    describe: () => 'Completely clear any one section',
    goal: 1,
    xp: 40,
    dust: 20,
    measure: (state, stats) => clearedSections(stats),
  },
  {
    id: 'twoSections',
    name: 'Double Feature',
    describe: () => 'Completely clear two sections',
    goal: 2,
    xp: 55,
    dust: 30,
    measure: (state, stats) => clearedSections(stats),
  },
  {
    id: 'sixTasks',
    name: 'Deep Night',
    describe: () => 'Complete 6 tasks tonight',
    goal: 6,
    xp: 40,
    dust: 22,
    measure: (state, stats) => stats.done,
  },
  {
    id: 'combo',
    name: 'Slipstream',
    describe: () => 'Reach a x2.0 combo',
    goal: 4,
    xp: 50,
    dust: 28,
    measure: (state) => Math.max(0, (state.night.maxCombo || 1) - 1) * 4,
    progressLabel: (state) => formatMultiplier(state.night.maxCombo || 1),
  },
  {
    id: 'noRainchecks',
    name: 'No Excuses',
    describe: () => 'Reach 80% with zero rain checks',
    goal: 1,
    xp: 45,
    dust: 26,
    measure: (state, stats) => (stats.pct >= 80 && stats.skipped === 0 ? 1 : 0),
  },
  {
    id: 'earlyBird',
    name: 'Early to the Stars',
    describe: () => 'Clear the whole night before 11pm',
    goal: 1,
    xp: 60,
    dust: 35,
    measure: (state, stats) => {
      // `remaining` is total minus done minus rain-checked, so gating on it let
      // "clear the whole night" complete with one task of eleven actually done.
      // Clearing means every task, the same as the cleared-nights ladder and the
      // history tile — a rain check excuses a task from the percentage, and the
      // percentage is not what this quest is named after.
      if (stats.total === 0 || stats.done < stats.total) return 0;
      const last = Math.max(0, ...Object.values(state.night.done));
      if (!last) return 0;
      const hour = new Date(last).getHours();
      return hour >= 4 && hour < 23 ? 1 : 0;
    },
  },
  {
    id: 'halfBefore',
    name: 'Front Loaded',
    // It said "before the countdown hits an hour" and measured `stats.done`,
    // which is not that at all: four tasks twenty minutes *past* bedtime
    // completed it. The clock is the whole quest, so the clock is measured.
    describe: (state) => {
      const cutoff = state ? frontLoadCutoff(state) : null;
      return cutoff
        ? `Finish 4 tasks before ${clockLabel(cutoff)}`
        : 'Finish 4 tasks over an hour before bedtime';
    },
    goal: 4,
    xp: 45,
    dust: 24,
    measure: (state) => {
      const cutoff = frontLoadCutoff(state);
      // No readable bedtime, no deadline to be early for.
      if (cutoff === null) return Object.keys(state.night.done).length;
      return Object.values(state.night.done).filter((at) => at <= cutoff).length;
    },
  },
];

export function questById(id) {
  return QUEST_DEFS.find((q) => q.id === id) || QUEST_DEFS[0];
}

/** Deterministic per-night pick. */
export function rollQuest(nightKey) {
  const rand = seededRandom(hashString(`quest:${nightKey}`));
  const def = QUEST_DEFS[Math.floor(rand() * QUEST_DEFS.length) % QUEST_DEFS.length];
  return { id: def.id, progress: 0, claimed: false };
}

export function evaluateQuest(state, stats) {
  const quest = state.night.quest;
  if (!quest) return null;
  const def = questById(quest.id);
  const progress = Math.max(0, Math.min(def.goal, def.measure(state, stats)));
  return {
    def,
    id: def.id,
    name: def.name,
    description: def.describe(state),
    progress,
    goal: def.goal,
    complete: progress >= def.goal,
    claimed: Boolean(quest.claimed),
    label: def.progressLabel ? def.progressLabel(state) : `${progress}/${def.goal}`,
  };
}
