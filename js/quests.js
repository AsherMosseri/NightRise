/* Nightly bonus quests. The roll is seeded by the night key so a reload
   never rerolls, and every `measure` is a pure read of state + stats. */

import { hashString, seededRandom } from './util.js';

const SPRINT_WINDOW_MS = 5 * 60 * 1000;

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
    measure: (state, stats) => stats.sections.filter((s) => s.total > 0 && s.remaining === 0).length,
  },
  {
    id: 'twoSections',
    name: 'Double Feature',
    describe: () => 'Completely clear two sections',
    goal: 2,
    xp: 55,
    dust: 30,
    measure: (state, stats) => stats.sections.filter((s) => s.total > 0 && s.remaining === 0).length,
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
    name: 'Chain Lightning',
    describe: () => 'Reach a x2.0 combo',
    goal: 4,
    xp: 50,
    dust: 28,
    measure: (state) => Math.max(0, (state.night.maxCombo || 1) - 1) * 4,
    progressLabel: (state) => `x${(state.night.maxCombo || 1).toFixed(2).replace(/0$/, '')}`,
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
      if (stats.total === 0 || stats.remaining > 0) return 0;
      const last = Math.max(0, ...Object.values(state.night.done));
      if (!last) return 0;
      const hour = new Date(last).getHours();
      return hour >= 4 && hour < 23 ? 1 : 0;
    },
  },
  {
    id: 'halfBefore',
    name: 'Front Loaded',
    describe: () => 'Complete 4 tasks before the countdown hits an hour',
    goal: 4,
    xp: 45,
    dust: 24,
    measure: (state, stats) => stats.done,
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
    description: def.describe(),
    progress,
    goal: def.goal,
    complete: progress >= def.goal,
    claimed: Boolean(quest.claimed),
    label: def.progressLabel ? def.progressLabel(state) : `${progress}/${def.goal}`,
  };
}
