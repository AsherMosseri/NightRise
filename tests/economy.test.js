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
import { grantXp, revokeGrant } from '../js/game.js';

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

/* This test used to assert the opposite — "you did the thing; the xp stays" —
   which is a coherent position and is not survivable. The app cannot tell
   tidying your list apart from farming it, and add-a-task / tick / delete is
   three taps that repeat forever. The rest of the app had already taken the
   other side: clearTonight revokes every award for exactly this reason, and the
   README's rule is that nothing you can un-tick leaves you holding what it paid
   for. Deleting is a stronger form of un-ticking. The cost is that genuinely
   doing a task and then deleting it loses the XP — mitigated by undo, which
   now puts both the row and the balance back. */
test('deleting a completed task hands back the xp you earned', () => {
  const state = reset();
  const id = Object.keys(state.template.tasks)[0];
  toggleTask(id);
  assert.ok(balance().xp > 0);
  deleteTask(id);
  assert.equal(getState().profile.xp, 0, 'nothing is left holding what it paid for');
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

test('deleting a section of completed tasks hands back all of their xp', () => {
  const state = reset();
  const sectionId = state.template.order[0];
  const taskIds = [...state.template.sections[sectionId].taskIds];
  for (const id of taskIds) toggleTask(id);
  const earned = balance();
  assert.ok(earned.xp > 0);

  deleteSection(sectionId);
  assert.equal(getState().profile.xp, 0, 'a section is just several tasks');
  for (const id of taskIds) assert.equal(getState().night.awards[id], undefined);

  undo();
  assert.equal(getState().profile.xp, earned.xp, 'and undo restores rows AND balances');
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

/* ---------------------------------------- printers found by the audit sweep */

test('deleting a task you had ticked hands back what it paid', () => {
  // Add, tick, delete, repeat was an unbounded XP and stardust faucet: the
  // award record went with the task and nothing was left to revoke it.
  replaceState(createInitialState(new Date(2026, 6, 29, 22, 0)));
  const sectionId = getState().template.order[0];
  const before = { xp: getState().profile.xp, dust: getState().profile.stardust };
  for (let i = 0; i < 5; i += 1) {
    const { task } = addTask(sectionId, `Farm ${i}`, 30);
    toggleTask(task.id);
    deleteTask(task.id);
  }
  assert.equal(getState().profile.xp, before.xp, 'no XP survives the task that earned it');
  assert.equal(getState().profile.stardust, before.dust);
});

test('deleting a whole section hands back every award inside it', () => {
  replaceState(createInitialState(new Date(2026, 6, 29, 22, 0)));
  const before = getState().profile.xp;
  const section = addSection('Farm');
  for (let i = 0; i < 3; i += 1) toggleTask(addTask(section.id, `t${i}`, 20).task.id);
  assert.ok(getState().profile.xp > before);
  deleteSection(section.id);
  assert.equal(getState().profile.xp, before);
});

test('undo cannot sell the same check-off twice', () => {
  // The snapshot is taken before the task is ticked; restoring it used to drop
  // the award record while its XP stayed banked, so ticking again paid again.
  replaceState(createInitialState(new Date(2026, 6, 29, 22, 0)));
  const [a, b] = Object.keys(getState().template.tasks);
  const undoId = deleteTask(b).undoId;
  toggleTask(a);
  const earned = getState().profile.xp;
  assert.ok(earned > 0);

  undo(undoId);
  assert.equal(getState().profile.xp, 0, 'the award and the XP moved together');
  toggleTask(a);
  assert.equal(getState().profile.xp, earned, 'and the second tick pays once, not twice');
});

test('undo of a deletion puts back the XP that deletion took', () => {
  replaceState(createInitialState(new Date(2026, 6, 29, 22, 0)));
  const [a] = Object.keys(getState().template.tasks);
  toggleTask(a);
  const earned = getState().profile.xp;
  const undoId = deleteTask(a).undoId;
  assert.equal(getState().profile.xp, 0, 'deleting took it back');
  undo(undoId);
  assert.equal(getState().profile.xp, earned, 'and undoing gives it back');
  assert.ok(getState().night.awards[a], 'with the record intact');
});

test('dust spent before un-ticking is owed, not forgiven', () => {
  const state = createInitialState(new Date(2026, 6, 29, 22, 0));
  grantXp(state, 0, 50);
  state.profile.stardust -= 50; // spent on something
  revokeGrant(state, 0, 50);
  assert.equal(state.profile.stardust, 0, 'the balance never goes negative');
  assert.equal(state.profile.dustDebt, 50, 'but the shortfall is remembered');

  grantXp(state, 0, 50); // earn it again
  assert.equal(state.profile.stardust, 0, 'which pays the debt rather than your pocket');
  assert.equal(state.profile.dustDebt, 0);

  grantXp(state, 0, 20); // and after that, earnings are yours again
  assert.equal(state.profile.stardust, 20);
});
