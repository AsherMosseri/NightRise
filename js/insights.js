/* Per-task insight: which tasks you actually do, and which keep sliding. */

import { plural } from './util.js';

export function taskInsights(state) {
  const stats = state.profile.taskStats || {};
  return Object.entries(stats)
    .map(([id, entry]) => {
      const task = state.template.tasks[id];
      if (!task) return null;
      const seen = entry.seen || 0;
      const rate = seen ? Math.round(((entry.done || 0) / seen) * 100) : null;
      return {
        id,
        title: task.title,
        seen,
        done: entry.done || 0,
        skipped: entry.skipped || 0,
        missStreak: entry.missStreak || 0,
        rate,
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (b.missStreak !== a.missStreak) return b.missStreak - a.missStreak;
      return (a.rate ?? 100) - (b.rate ?? 100);
    });
}

export function reliableTasks(state) {
  return taskInsights(state)
    .filter((t) => t.seen >= 3 && t.rate !== null)
    .sort((a, b) => b.rate - a.rate)
    .slice(0, 3);
}

/** A single gentle nudge for the tonight panel, or null when nothing stands out. */
export function topNudge(state) {
  const worst = taskInsights(state).find((t) => t.missStreak >= 3);
  if (!worst) return null;
  return `“${worst.title}” has slipped ${plural(worst.missStreak, 'night', 'nights')} running.`;
}

export function overallRate(state) {
  const history = Object.values(state.history);
  if (!history.length) return null;
  const sum = history.reduce((acc, h) => acc + (h.pct || 0), 0);
  return Math.round(sum / history.length);
}
