/* The economy has to survive the orders a real user clicks things in.
   These drive the real action layer, not the pure helpers underneath it. */

import test from 'node:test';
import assert from 'node:assert/strict';

import { getState, replaceState } from '../js/state.js';
import {
  toggleTask, toggleSkip, deleteTask, deleteSection, undo, claimQuest, addTask, addSection,
} from '../js/actions.js';
import { createInitialState } from '../js/model.js';
import { computeStats } from '../js/night.js';

function reset() {
  replaceState(createInitialState(new Date(2026, 6, 29, 22, 0)));
  return getState();
}

const balance = () => {
  const { profile } = getState();
  return { xp: profile.xp, dust: profile.stardust, rain: profile.tokens.raincheck };
};

test('checking and un-checking a task returns you exactly where you started', () => {
  const state = reset();
  const id = Object.keys(state.template.tasks)[0];
  const before = balance();
  toggleTask(id);
  assert.ok(getState().profile.xp > before.xp);
  toggleTask(id);
  assert.deepEqual(balance(), before);
});

test('a check/uncheck loop cannot farm xp', () => {
  const state = reset();
  const id = Object.keys(state.template.tasks)[0];
  const before = balance();
  for (let i = 0; i < 25; i += 1) {
    toggleTask(id);
    toggleTask(id);
  }
  assert.deepEqual(balance(), before, 'twenty five round trips left the balance moved');
});

test('deleting a completed task keeps the xp you earned', () => {
  const state = reset();
  const id = Object.keys(state.template.tasks)[0];
  toggleTask(id);
  const earned = balance();
  deleteTask(id);
  assert.equal(getState().profile.xp, earned.xp, 'you did the thing; the xp stays');
  assert.equal(getState().night.awards[id], undefined);
});

test('delete then undo then uncheck subtracts the award exactly once', () => {
  const state = reset();
  const id = Object.keys(state.template.tasks)[0];
  const before = balance();

  toggleTask(id);
  const afterCheck = balance();
  assert.ok(afterCheck.xp > before.xp);

  deleteTask(id);
  undo();
  assert.equal(getState().profile.xp, afterCheck.xp, 'undo must not change the balance');
  assert.ok(getState().night.done[id] !== undefined, 'the task comes back checked');

  toggleTask(id);
  assert.deepEqual(balance(), before, 'unchecking the restored task settles the books');
});

test('deleting a section of completed tasks keeps their xp and clears their awards', () => {
  const state = reset();
  const sectionId = state.template.order[0];
  const taskIds = [...state.template.sections[sectionId].taskIds];
  for (const id of taskIds) toggleTask(id);
  const earned = balance();

  deleteSection(sectionId);
  assert.equal(getState().profile.xp, earned.xp);
  for (const id of taskIds) assert.equal(getState().night.awards[id], undefined);

  undo();
  assert.equal(getState().profile.xp, earned.xp, 'undo restores rows, not balances');
  for (const id of taskIds) toggleTask(id);
  assert.equal(getState().profile.xp, 0, 'unchecking everything returns to zero');
});

test('rain checks cost a token and give it back when undone', () => {
  const state = reset();
  const id = Object.keys(state.template.tasks)[0];
  const before = balance();

  toggleSkip(id);
  assert.equal(getState().profile.tokens.raincheck, before.rain - 1);
  toggleSkip(id);
  assert.equal(getState().profile.tokens.raincheck, before.rain, 'un-skipping refunds');
});

test('a rain check toggle loop cannot mint tokens', () => {
  const state = reset();
  const id = Object.keys(state.template.tasks)[0];
  const before = balance();
  for (let i = 0; i < 20; i += 1) {
    toggleSkip(id);
    toggleSkip(id);
  }
  assert.equal(getState().profile.tokens.raincheck, before.rain);
});

test('rain checks run out and are refused rather than going negative', () => {
  const state = reset();
  const ids = Object.keys(state.template.tasks);
  const held = getState().profile.tokens.raincheck;
  for (let i = 0; i < held; i += 1) toggleSkip(ids[i]);
  assert.equal(getState().profile.tokens.raincheck, 0);

  const blocked = toggleSkip(ids[held]);
  assert.equal(blocked.blocked, true);
  assert.equal(getState().profile.tokens.raincheck, 0, 'never negative');
  assert.equal(getState().night.skipped[ids[held]], undefined, 'and the task is not skipped');
});

test('checking a rain-checked task hands the token back', () => {
  const state = reset();
  const id = Object.keys(state.template.tasks)[0];
  const before = balance();
  toggleSkip(id);
  toggleTask(id);
  assert.equal(getState().profile.tokens.raincheck, before.rain, 'you did it after all');
  assert.equal(getState().night.skipped[id], undefined);
});

test('the night completion bonus is paid once, not once per re-check', () => {
  const state = reset();
  const ids = Object.keys(state.template.tasks);
  for (const id of ids) toggleTask(id);
  const first = getState().profile.xp;
  assert.equal(computeStats(getState()).remaining, 0);

  const last = ids[ids.length - 1];
  for (let i = 0; i < 5; i += 1) {
    toggleTask(last); // un-complete the night
    toggleTask(last); // and complete it again
  }
  assert.equal(getState().profile.xp, first, 'the bonus did not compound');
});

test('a quest reward can only be claimed once', () => {
  const state = reset();
  state.night.quest = { id: 'sixTasks', progress: 0, claimed: false };
  const ids = Object.keys(state.template.tasks);
  for (let i = 0; i < 6; i += 1) toggleTask(ids[i]);

  const first = claimQuest();
  assert.ok(first, 'the quest was claimable');
  const afterClaim = getState().profile.xp;
  assert.equal(claimQuest(), null, 'a second claim does nothing');
  assert.equal(getState().profile.xp, afterClaim);
});

test('an unfinished quest cannot be claimed', () => {
  const state = reset();
  state.night.quest = { id: 'sixTasks', progress: 0, claimed: false };
  toggleTask(Object.keys(state.template.tasks)[0]);
  assert.equal(claimQuest(), null);
});

test('adding a task to a missing section still lands somewhere real', () => {
  reset();
  const { task, sectionId } = addTask('no-such-section', 'Wander', 3);
  const state = getState();
  assert.ok(state.template.tasks[task.id]);
  assert.ok(state.template.sections[sectionId].taskIds.includes(task.id));
});

test('a task added to an empty app creates its own home', () => {
  replaceState({ ...createInitialState(), template: { order: [], sections: {}, tasks: {} } });
  const { task } = addTask(null, 'Only task', 2);
  const state = getState();
  assert.equal(state.template.order.length, 1);
  assert.ok(state.template.sections[state.template.order[0]].taskIds.includes(task.id));
  addSection('Second');
  assert.equal(getState().template.order.length, 2);
});
