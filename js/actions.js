/* Every mutation the UI can perform. Keeps render code free of state logic. */

import { getState, update, emit } from './state.js';
import { createSection, createTask, DEFAULT_MINUTES } from './model.js';
import { moveItem, deepClone, clamp, roundMinutes } from './util.js';
import {
  applyTaskCompletion, revokeTaskCompletion, nightCompletionBonus, grantXp,
  revokeGrant,
} from './game.js';
import { computeStats } from './night.js';
import { checkAchievements, dropUnearnedTiers } from './achievements.js';
import { evaluateQuest, questById } from './quests.js';

const undoStack = [];
const UNDO_LIMIT = 25;
let undoSeq = 0;

/**
 * Only what a deletion can destroy: the template and the night's per-task
 * records. Snapshotting the whole night used to rewind `quest.claimed` too,
 * so claiming the nightly quest and then hitting Undo on an unrelated delete
 * toast handed the reward back to be claimed again, forever.
 */
function snapshot(state) {
  return {
    template: deepClone(state.template),
    done: deepClone(state.night.done),
    skipped: deepClone(state.night.skipped),
    awards: deepClone(state.night.awards),
  };
}

export function pushUndo(label) {
  undoSeq += 1;
  undoStack.push({ id: undoSeq, label, data: snapshot(getState()) });
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  return undoSeq;
}

/**
 * Undo a specific entry. The toast passes the id of the deletion it announced,
 * so pressing Undo on the "Deleted Floss" toast restores Floss even if you have
 * deleted something else since — a bare LIFO pop restored the wrong thing.
 */
export function undo(id = null) {
  const index = id === null
    ? undoStack.length - 1
    : undoStack.findIndex((entry) => entry.id === id);
  if (index === -1) return null;
  const [entry] = undoStack.splice(index, 1);
  update((state) => {
    state.template = entry.data.template;
    state.night.done = entry.data.done;
    state.night.skipped = entry.data.skipped;
    state.night.awards = entry.data.awards;
    afterProgress(state);
  });
  return entry.label;
}

/* ---------------------------------------------------------------- sections */

export function addSection(title = 'New section') {
  return update((state) => {
    const section = createSection(title.trim() || 'New section');
    state.template.sections[section.id] = section;
    state.template.order.push(section.id);
    return section;
  });
}

export function renameSection(id, title) {
  update((state) => {
    const section = state.template.sections[id];
    if (section) section.title = title.trim() || section.title;
  });
}

/** Same economy rule as deleteTask: the night's awards go, the profile does not. */
export function deleteSection(id) {
  const undoId = pushUndo('section');
  return update((state) => {
    const section = state.template.sections[id];
    if (!section) return null;
    for (const taskId of section.taskIds) {
      delete state.template.tasks[taskId];
      delete state.night.done[taskId];
      delete state.night.skipped[taskId];
      delete state.night.awards[taskId];
    }
    delete state.template.sections[id];
    state.template.order = state.template.order.filter((s) => s !== id);
    afterProgress(state);
    return { section, undoId };
  });
}

export function moveSection(id, delta) {
  update((state) => {
    const from = state.template.order.indexOf(id);
    if (from === -1) return;
    state.template.order = moveItem(state.template.order, from, from + delta);
  });
}

/** `toIndex` is a slot in the list *before* the item is lifted out. */
export function reorderSection(id, toIndex) {
  update((state) => {
    const from = state.template.order.indexOf(id);
    if (from === -1) return;
    const target = from < toIndex ? toIndex - 1 : toIndex;
    state.template.order = moveItem(state.template.order, from, target);
  });
}

export function toggleSectionCollapsed(id) {
  update((state) => {
    const section = state.template.sections[id];
    if (section) section.collapsed = !section.collapsed;
  });
}

/* ------------------------------------------------------------------- tasks */

export function addTask(sectionId, title, minutes = DEFAULT_MINUTES) {
  return update((state) => {
    let section = state.template.sections[sectionId];
    if (!section) {
      const firstId = state.template.order[0];
      section = state.template.sections[firstId];
    }
    if (!section) {
      section = createSection('Tonight');
      state.template.sections[section.id] = section;
      state.template.order.push(section.id);
    }
    const task = createTask(title.trim() || 'New task', roundMinutes(minutes) ?? DEFAULT_MINUTES);
    state.template.tasks[task.id] = task;
    section.taskIds.push(task.id);
    return { task, sectionId: section.id };
  });
}

export function renameTask(id, title) {
  update((state) => {
    const task = state.template.tasks[id];
    if (task) task.title = title.trim() || task.title;
  });
}

export function setTaskMinutes(id, minutes) {
  update((state) => {
    const task = state.template.tasks[id];
    const next = roundMinutes(minutes);
    if (task && next !== null) task.minutes = next;
  });
}

/**
 * Deleting never touches the economy. XP you earned by actually doing the thing
 * stays earned, and a spent rain check stays spent — only un-checking takes an
 * award back. That keeps undo (which restores the template and the night, but
 * deliberately not your profile) exactly reversible: restore the row, the award
 * record comes back with it, and un-checking later subtracts it exactly once.
 */
export function deleteTask(id) {
  const undoId = pushUndo('task');
  return update((state) => {
    const task = state.template.tasks[id];
    if (!task) return null;
    delete state.template.tasks[id];
    delete state.night.done[id];
    delete state.night.skipped[id];
    delete state.night.awards[id];
    for (const section of Object.values(state.template.sections)) {
      section.taskIds = section.taskIds.filter((t) => t !== id);
    }
    afterProgress(state); // deleting the last unfinished task can finish the night
    return { task, undoId };
  });
}

export function sectionIdOfTask(state, taskId) {
  return state.template.order.find((id) => state.template.sections[id]?.taskIds.includes(taskId)) || null;
}

/**
 * Drop a task into a section at a specific slot. `index` refers to the list
 * as it looked before the task was lifted out, so a same-section move down
 * shifts by one once the gap closes.
 */
export function moveTaskTo(taskId, targetSectionId, index) {
  update((state) => {
    const fromId = sectionIdOfTask(state, taskId);
    const target = state.template.sections[targetSectionId];
    if (!target) return;
    let at = index;
    if (fromId) {
      const from = state.template.sections[fromId];
      const originalIndex = from.taskIds.indexOf(taskId);
      if (fromId === targetSectionId && originalIndex > -1 && originalIndex < index) at -= 1;
      from.taskIds = from.taskIds.filter((t) => t !== taskId);
    }
    target.taskIds.splice(clamp(at, 0, target.taskIds.length), 0, taskId);
    target.collapsed = false;
  });
}

/** Move up/down one slot, hopping into the neighbouring section at the edges. */
export function moveTaskByStep(taskId, delta) {
  update((state) => {
    const sectionId = sectionIdOfTask(state, taskId);
    if (!sectionId) return;
    const section = state.template.sections[sectionId];
    const index = section.taskIds.indexOf(taskId);
    const next = index + delta;
    if (next >= 0 && next < section.taskIds.length) {
      section.taskIds = moveItem(section.taskIds, index, next);
      return;
    }
    const orderIndex = state.template.order.indexOf(sectionId);
    const neighbourId = state.template.order[orderIndex + delta];
    const neighbour = state.template.sections[neighbourId];
    if (!neighbour) return;
    section.taskIds = section.taskIds.filter((t) => t !== taskId);
    if (delta < 0) neighbour.taskIds.push(taskId);
    else neighbour.taskIds.unshift(taskId);
    neighbour.collapsed = false;
  });
}

/* ---------------------------------------------------------------- progress */

/**
 * The completion bonus is banked in `night.bonus` so it can be paid once and
 * taken back exactly if you un-check something. Without the record, re-checking
 * the last task paid the bonus again every single time.
 */
function afterProgress(state) {
  const stats = computeStats(state);
  // Order matters: drop first, then award. Un-checking a task can push you out
  // of a level tier, and reporting the loss before the gains keeps a single
  // toggle from claiming a tier it just took away.
  const lost = dropUnearnedTiers(state);
  if (lost.length) emit('achievement:lost', lost);
  const earned = checkAchievements(state, stats);
  if (earned.length) emit('achievement', earned);

  const complete = stats.total > 0 && stats.remaining === 0 && stats.counted > 0;
  if (complete && !state.night.bonus) {
    const bonus = nightCompletionBonus(stats);
    const levels = grantXp(state, bonus.xp, bonus.dust);
    state.night.bonus = bonus;
    state.night.celebrated = true;
    emit('night:complete', { stats, bonus, levels });
    if (levels.length) emit('level', levels);
  } else if (!complete && state.night.bonus) {
    revokeGrant(state, state.night.bonus.xp, state.night.bonus.dust);
    state.night.bonus = null;
    state.night.celebrated = false;
  }
  return stats;
}

export function toggleTask(id) {
  return update((state) => {
    const task = state.template.tasks[id];
    if (!task) return null;
    if (state.night.done[id] !== undefined) {
      // The whole un-check has to settle before we can say what it cost: the
      // task's own award and the completion bonus it may have unlocked both
      // come off, and either can be the one that drops you a level.
      const levelBefore = state.profile.level;
      revokeTaskCompletion(state, id);
      emit('task:undone', { task });
      afterProgress(state);
      if (state.profile.level < levelBefore) {
        emit('level:lost', { from: levelBefore, to: state.profile.level });
      }
      return { done: false, task };
    }
    if (state.night.skipped[id]) {
      delete state.night.skipped[id];
      state.profile.tokens.raincheck += 1;
    }
    const award = applyTaskCompletion(state, task);
    emit('task:done', { task, award });
    if (award.levels.length) emit('level', award.levels);
    afterProgress(state);
    return { done: true, task, award };
  });
}

/** Rain check: excuse a task from tonight's completion percentage. */
export function toggleSkip(id) {
  return update((state) => {
    const task = state.template.tasks[id];
    if (!task) return null;
    if (state.night.skipped[id]) {
      delete state.night.skipped[id];
      state.profile.tokens.raincheck += 1;
      emit('task:unskip', { task });
      afterProgress(state);
      return { skipped: false, task };
    }
    if (state.profile.tokens.raincheck <= 0) {
      emit('tokens:empty', { kind: 'raincheck' });
      return { skipped: false, task, blocked: true };
    }
    if (state.night.done[id] !== undefined) revokeTaskCompletion(state, id);
    state.profile.tokens.raincheck -= 1;
    state.night.skipped[id] = true;
    emit('task:skip', { task });
    afterProgress(state);
    return { skipped: true, task };
  });
}

export function claimQuest() {
  return update((state) => {
    const stats = computeStats(state);
    const quest = evaluateQuest(state, stats);
    if (!quest || !quest.complete || quest.claimed) return null;
    // Paid once per date. Starting the night fresh clears `claimed`, which
    // would otherwise let one quest be claimed as many times as you press it.
    if (state.profile.lastQuestKey === state.night.key) return null;
    state.night.quest.claimed = true;
    state.profile.lastQuestKey = state.night.key;
    const def = questById(quest.id);
    const levels = grantXp(state, def.xp, def.dust);
    emit('quest:claim', { quest, def, levels });
    if (levels.length) emit('level', levels);
    const earned = checkAchievements(state, stats);
    if (earned.length) emit('achievement', earned);
    return { quest, def, levels };
  });
}

/* ---------------------------------------------------------------- settings */

export function setSetting(key, value) {
  update((state) => {
    state.profile.settings[key] = value;
    emit('setting', { key, value });
  });
}

export function clearAllTasks() {
  const undoId = pushUndo('everything');
  update((state) => {
    state.template = { order: [], sections: {}, tasks: {} };
    state.night.done = {};
    state.night.skipped = {};
    state.night.awards = {};
    afterProgress(state);
  });
  return undoId;
}
