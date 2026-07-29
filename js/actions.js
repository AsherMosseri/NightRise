/* Every mutation the UI can perform. Keeps render code free of state logic. */

import { getState, update, emit } from './state.js';
import { createSection, createTask, DEFAULT_MINUTES } from './model.js';
import { moveItem, deepClone, clamp } from './util.js';
import {
  applyTaskCompletion, revokeTaskCompletion, checkBadges, nightCompletionBonus, grantXp,
} from './game.js';
import { computeStats } from './night.js';
import { evaluateQuest, questById } from './quests.js';

const undoStack = [];
const UNDO_LIMIT = 25;

function snapshot(state) {
  return {
    template: deepClone(state.template),
    night: deepClone(state.night),
  };
}

export function pushUndo(label) {
  undoStack.push({ label, data: snapshot(getState()) });
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
}

export function undo() {
  const entry = undoStack.pop();
  if (!entry) return null;
  update((state) => {
    state.template = entry.data.template;
    state.night = entry.data.night;
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

export function deleteSection(id) {
  pushUndo('section');
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
    return section;
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
    const task = createTask(title.trim() || 'New task', clamp(Math.round(minutes) || 0, 0, 600));
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
    if (task) task.minutes = clamp(Math.round(Number(minutes) || 0), 0, 600);
  });
}

export function deleteTask(id) {
  pushUndo('task');
  return update((state) => {
    const task = state.template.tasks[id];
    if (!task) return null;
    revokeTaskCompletion(state, id);
    delete state.template.tasks[id];
    delete state.night.skipped[id];
    for (const section of Object.values(state.template.sections)) {
      section.taskIds = section.taskIds.filter((t) => t !== id);
    }
    return task;
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

function afterProgress(state) {
  const stats = computeStats(state);
  const badges = checkBadges(state, stats);
  if (badges.length) emit('badge', badges);

  if (stats.total > 0 && stats.remaining === 0 && !state.night.celebrated) {
    state.night.celebrated = true;
    const bonus = nightCompletionBonus(stats);
    const levels = grantXp(state, bonus.xp, bonus.dust);
    emit('night:complete', { stats, bonus, levels });
    if (levels.length) emit('level', levels);
  } else if (stats.remaining > 0) {
    state.night.celebrated = false;
  }
  return stats;
}

export function toggleTask(id) {
  return update((state) => {
    const task = state.template.tasks[id];
    if (!task) return null;
    if (state.night.done[id] !== undefined) {
      revokeTaskCompletion(state, id);
      emit('task:undone', { task });
      afterProgress(state);
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
    state.night.quest.claimed = true;
    const def = questById(quest.id);
    const levels = grantXp(state, def.xp, def.dust);
    emit('quest:claim', { quest, def, levels });
    if (levels.length) emit('level', levels);
    checkBadges(state, stats);
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
  pushUndo('everything');
  update((state) => {
    state.template = { order: [], sections: {}, tasks: {} };
    state.night.done = {};
    state.night.skipped = {};
    state.night.awards = {};
  });
}
