/* Per-task insight: which tasks you actually do, and which keep sliding. */

import { plural } from './util.js';

/** Which section a task lives in, so two "Brush teeth" rows can be told apart. */
function sectionTitles(template) {
  const homes = new Map();
  for (const section of Object.values(template.sections)) {
    for (const taskId of section.taskIds) homes.set(taskId, section.title);
  }
  return homes;
}

export function taskInsights(state) {
  const stats = state.profile.taskStats || {};
  const homes = sectionTitles(state.template);
  // Stats are keyed by id, but every surface printed only the title — so two
  // tasks with the same name were two identical rows, and the nudge said
  // '"Brush teeth" has slipped 4 nights running' about the one you always do.
  const seenTitles = new Map();
  for (const id of Object.keys(stats)) {
    const task = state.template.tasks[id];
    if (task) seenTitles.set(task.title, (seenTitles.get(task.title) || 0) + 1);
  }
  return Object.entries(stats)
    .map(([id, entry]) => {
      const task = state.template.tasks[id];
      if (!task) return null;
      const seen = entry.seen || 0;
      const rate = seen ? Math.round(((entry.done || 0) / seen) * 100) : null;
      return {
        id,
        title: task.title,
        minutes: task.minutes,
        // Only when it is actually needed — a section name on every row is
        // noise, and on a duplicated one it is the whole point.
        where: seenTitles.get(task.title) > 1 ? (homes.get(id) || null) : null,
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
/**
 * The one task that keeps sliding, and the sentence about it.
 *
 * Returns the row as well as the text, because a bare sentence was the only
 * purely punitive number in an app that otherwise measures streaks off
 * `bestStreak` specifically so they cannot punish — and it was aimed at exactly
 * the task you dread most. Something you can act on beats something you can
 * only read.
 */
export function topNudge(state) {
  const worst = taskInsights(state).find((t) => t.missStreak >= 3);
  if (!worst) return null;
  const where = worst.where ? ` in ${worst.where}` : '';
  return {
    ...worst,
    text: `“${worst.title}”${where} has slipped ${plural(worst.missStreak, 'night', 'nights')} running.`,
  };
}

/**
 * Every date you ended before your bedtime, plus tonight if you just did.
 *
 * Tonight is on loan until 4am — the same rule the `cleared` achievement family
 * uses — because the star should appear the moment you press the button, and
 * the history entry it will be read from does not exist until the night banks.
 */
export function onTimeNights(state) {
  const keys = Object.entries(state.history)
    .filter(([, entry]) => entry?.onTime)
    .map(([key]) => key);
  if (state.night.lightsOutOnTime && !keys.includes(state.night.key)) keys.push(state.night.key);
  return keys.sort();
}

export function overallRate(state) {
  const history = Object.values(state.history);
  if (!history.length) return null;
  const sum = history.reduce((acc, h) => acc + (h.pct || 0), 0);
  return Math.round(sum / history.length);
}

/**
 * Nights where every task was ticked — deliberately not nights that *scored*
 * 100%.
 *
 * A rain check excuses a task from the percentage, so a night with five of six
 * rain-checked and one done reads as 100%. That is a fine night and it earns
 * Full Marks, but it is not a night you did everything, and a stat labelled
 * "every task done" must not count it. Nights with no tasks at all are not
 * achievements either.
 */
export function nightsFullyCleared(history) {
  return Object.values(history).filter((h) => h.total > 0 && h.done >= h.total).length;
}
