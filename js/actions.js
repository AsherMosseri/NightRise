/* Every mutation the UI can perform. Keeps render code free of state logic. */

import { getState, update, emit } from './state.js';
import { createSection, createTask, DEFAULT_MINUTES, clampTitle, TITLE_MAX } from './model.js';
import { moveItem, deepClone, clamp, roundMinutes } from './util.js';
import {
  applyTaskCompletion, revokeTaskCompletion, nightCompletionBonus, grantXp,
  revokeGrant, applyTaskStart, revokeTaskStart,
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
    started: deepClone(state.night.started),
  };
}

export function pushUndo(label) {
  undoSeq += 1;
  undoStack.push({ id: undoSeq, label, data: snapshot(getState()) });
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  return undoSeq;
}

/**
 * Put the award record back *and* the profile with it.
 *
 * Assigning `night.awards` wholesale was silently destructive: a snapshot taken
 * before you ticked something, restored after, dropped that award's record
 * while its XP and stardust stayed banked — so ticking the same task again paid
 * for it a second time. The record and the balance have to move together, so
 * the difference is settled in both directions rather than overwritten.
 */
function restoreAwards(state, target) {
  for (const [id, award] of Object.entries(state.night.awards)) {
    if (!target[id]) revokeGrant(state, award.xp, award.dust);
  }
  for (const [id, award] of Object.entries(target)) {
    if (!state.night.awards[id]) grantXp(state, award.xp, award.dust);
  }
  state.night.awards = deepClone(target);
}

/**
 * The same problem one field over: rain checks are spent and refunded on
 * `profile.tokens`, which the snapshot never captured, while the record of
 * which tasks are excused lives on `night.skipped`, which it restored
 * wholesale. Un-skip a task (token back), then undo an older deletion, and the
 * task was rain-checked again with the token still in your pocket.
 */
/**
 * Same rule again for the start advance: the record and the balance move
 * together, or undoing a delete hands the row back with the advance still paid
 * and the record gone — so starting it again would pay twice.
 */
function restoreStarted(state, target) {
  for (const [id, record] of Object.entries(state.night.started)) {
    if (!target[id]) revokeGrant(state, record.xp, 0);
  }
  for (const [id, record] of Object.entries(target)) {
    if (!state.night.started[id]) grantXp(state, record.xp, 0);
  }
  state.night.started = deepClone(target);
}

function restoreSkipped(state, target) {
  for (const id of Object.keys(state.night.skipped)) {
    if (!target[id]) state.profile.tokens.raincheck += 1;
  }
  for (const id of Object.keys(target)) {
    if (!state.night.skipped[id]) {
      state.profile.tokens.raincheck = Math.max(0, state.profile.tokens.raincheck - 1);
    }
  }
  state.night.skipped = deepClone(target);
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
    restoreSkipped(state, entry.data.skipped);
    restoreAwards(state, entry.data.awards);
    restoreStarted(state, entry.data.started || {});
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
    if (section) section.title = clampTitle(title, section.title);
  });
}

/** Same economy rule as deleteTask: every task it takes hands back what it paid. */
export function deleteSection(id) {
  const undoId = pushUndo('section');
  return update((state) => {
    const section = state.template.sections[id];
    if (!section) return null;
    for (const taskId of section.taskIds) {
      revokeTaskCompletion(state, taskId); // same debt as deleting one task
      revokeTaskStart(state, taskId);
      if (state.night.skipped[taskId]) state.profile.tokens.raincheck += 1;
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
    if (task) task.title = clampTitle(title, task.title);
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
 * Deleting settles the economy, and undo settles it back.
 *
 * This comment used to say the opposite — "deleting never touches the economy,
 * XP you earned stays earned" — which was a defensible position right up until
 * you notice that add-a-task, tick it, delete it, repeat is three taps and
 * prints XP and stardust forever. The app cannot tell tidying your list apart
 * from farming it, so a deletion hands back exactly what the task paid and
 * refunds any rain check spent on it. Undo restores the row *and* the balances,
 * so nothing is lost by pressing the wrong thing.
 */
export function deleteTask(id) {
  const undoId = pushUndo('task');
  return update((state) => {
    const task = state.template.tasks[id];
    if (!task) return null;
    // Hand back what it paid before the record of it is gone. Deleting a task
    // you had ticked used to keep its XP and stardust with nothing left to
    // revoke them, so add-a-task, tick it, delete it, repeat printed money.
    revokeTaskCompletion(state, id);
    // The advance goes back with it: a deleted task cannot have been started.
    revokeTaskStart(state, id);
    // A rain check spent on a task you then delete is a token gone for nothing,
    // and it also left undo double-spending when it put the task back.
    if (state.night.skipped[id]) state.profile.tokens.raincheck += 1;
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
  const lost = dropUnearnedTiers(state, stats);
  if (lost.length) emit('achievement:lost', lost);
  const earned = checkAchievements(state, stats);
  if (earned.length) emit('achievement', earned);

  const complete = stats.total > 0 && stats.remaining === 0 && stats.counted > 0;
  if (complete && !state.night.bonus) {
    const bonus = nightCompletionBonus(stats);
    const levels = grantXp(state, bonus.xp, bonus.dust);
    state.night.bonus = bonus;
    // The money and the ceremony are different questions. `bonus` is the
    // payment and has to come back when you un-tick; `celebrated` is whether
    // tonight has had its moment, and it never un-happens. Without the split,
    // fixing a mis-tap on the last task replayed the whole finale — every time.
    const first = !state.night.celebrated;
    state.night.celebrated = true;
    emit('night:complete', { stats, bonus, levels, first });
    if (levels.length) emit('level', levels);
  } else if (!complete && state.night.bonus) {
    revokeGrant(state, state.night.bonus.xp, state.night.bonus.dust);
    state.night.bonus = null;
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
      const revoked = revokeTaskCompletion(state, id);
      emit('task:undone', { task });
      afterProgress(state);
      if (state.profile.level < levelBefore) {
        emit('level:lost', { from: levelBefore, to: state.profile.level, reclaimed: revoked?.reclaimed || 0 });
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

/**
 * Say you are starting this one.
 *
 * The point of the whole mechanic: the ask stops being "finish this", which is
 * a prediction about the next fifteen minutes, and becomes "press this and
 * stand up", which is a prediction about the next three seconds. It cannot be
 * undone — starting happened — and it does not move the percentage, the streak
 * or anything else that scores the night.
 */
export function startTask(id) {
  return update((state) => {
    const task = state.template.tasks[id];
    if (!task) return null;
    const started = applyTaskStart(state, task);
    if (!started) return null;
    emit('task:start', { task, ...started });
    return { task, ...started };
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
    if (state.night.done[id] !== undefined) {
      // The same bookkeeping `toggleTask` wraps around the identical call. Not
      // reachable from the UI any more — a done task is not offered a rain
      // check — but a revoke that can drop a level must never do it silently.
      const levelBefore = state.profile.level;
      const revoked = revokeTaskCompletion(state, id);
      if (state.profile.level < levelBefore) {
        emit('level:lost', { from: levelBefore, to: state.profile.level, reclaimed: revoked?.reclaimed || 0 });
      }
    }
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


