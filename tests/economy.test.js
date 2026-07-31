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
import {
  grantXp, revokeGrant, applyTaskStart, applyTaskCompletion, revokeTaskCompletion,
  nightCompletionBonus, START_ADVANCE_XP,
} from '../js/game.js';
import { lightsOutReward } from '../js/render/goodnight.js';
import { equipItem } from '../js/shop.js';

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

test('undo does not print rain checks', () => {
  // The token lives on `profile`, which the snapshot never captured, while the
  // record of what is excused lives on `night.skipped`, which it restored
  // wholesale. Un-skip, then undo an older deletion, and the task came back
  // rain-checked with the token still in your pocket.
  replaceState(createInitialState(new Date(2026, 6, 29, 22, 0)));
  const [a, b] = Object.keys(getState().template.tasks);
  const held = getState().profile.tokens.raincheck;

  toggleSkip(a);
  assert.equal(getState().profile.tokens.raincheck, held - 1);
  const undoId = deleteTask(b).undoId;
  toggleSkip(a); // un-skip: token back
  assert.equal(getState().profile.tokens.raincheck, held);

  undo(undoId); // restores skipped:{a}
  assert.equal(getState().profile.tokens.raincheck, held - 1,
    'the task is excused again, so the token is spent again');
});

test('deleting a rain-checked task hands the token back', () => {
  replaceState(createInitialState(new Date(2026, 6, 29, 22, 0)));
  const [a] = Object.keys(getState().template.tasks);
  const held = getState().profile.tokens.raincheck;
  toggleSkip(a);
  deleteTask(a);
  assert.equal(getState().profile.tokens.raincheck, held, 'spent on a task that no longer exists');
});

test('stopping on a night with nothing on the list pays the floor', () => {
  const empty = { total: 0, done: 0 };
  const real = { total: 6, done: 6 };
  assert.deepEqual(lightsOutReward(90, empty), { xp: 15, dust: 3 });
  assert.ok(lightsOutReward(90, real).xp > 100, 'a night you worked through still pays properly');
});

test('each companion keeps its own feeding', () => {
  replaceState(createInitialState(new Date(2026, 6, 29, 22, 0)));
  const state = getState();
  state.profile.stardust = 5000;
  state.profile.inventory.companions = ['owl', 'cat'];
  equipItem('owl');
  Object.assign(getState().profile.companion, { tier: 3, fed: 14 });

  equipItem('cat');
  assert.equal(getState().profile.companion.fed, 0, 'a new companion starts fresh');
  equipItem('owl');
  assert.equal(getState().profile.companion.fed, 14, 'and the owl remembers');
  assert.equal(getState().profile.companion.tier, 3);
});

test('starting then finishing pays exactly what finishing alone paid', () => {
  // The advance is moved, not added. The whole economy paid at the far end of a
  // task, which for a person who dreads the task puts 100% of the reward on the
  // other side of the moment they bail — so a small fixed amount moves to the
  // moment of highest resistance, and comes off what finishing pays.
  const plain = reset();
  const task = Object.values(plain.template.tasks)[0];
  applyTaskCompletion(plain, task, 1000);
  const paidStraight = plain.profile.xp;

  const staged = reset();
  applyTaskStart(staged, task, 500);
  assert.equal(staged.profile.xp, START_ADVANCE_XP, 'a little, up front');
  applyTaskCompletion(staged, task, 1000);
  assert.equal(staged.profile.xp, paidStraight, 'and the total is unchanged');
  assert.equal(staged.profile.stardust, plain.profile.stardust, 'stardust is untouched by starting');
});

test('starting twice pays once', () => {
  const state = reset();
  const task = Object.values(state.template.tasks)[0];
  assert.ok(applyTaskStart(state, task, 500));
  assert.equal(applyTaskStart(state, task, 900), null);
  assert.equal(state.profile.xp, START_ADVANCE_XP);
});

test('starting does not feed momentum', () => {
  // Starting is not finishing. If it moved the combo, a night of pressing Start
  // on everything would build a multiplier out of nothing done.
  const state = reset();
  const [a, b] = Object.values(state.template.tasks);
  applyTaskStart(state, a, 1000);
  applyTaskStart(state, b, 60000);
  assert.equal(state.night.combo, 1);
  assert.equal(state.night.lastDoneAt, 0);
  assert.equal(computeStats(state).done, 0, 'and it does not move the percentage');
  assert.equal(computeStats(state).pct, 0);
});

test('un-checking a started task keeps the advance and takes back the rest', () => {
  // Starting happened; un-checking cannot un-happen it. What comes back is
  // exactly what the completion paid, which is the reduced figure.
  const state = reset();
  const task = Object.values(state.template.tasks)[0];
  applyTaskStart(state, task, 500);
  applyTaskCompletion(state, task, 1000);
  revokeTaskCompletion(state, task.id);
  assert.equal(state.profile.xp, START_ADVANCE_XP);
  assert.ok(state.night.started[task.id], 'the record of having started stays');
});

test('starting everything and finishing nothing has a small ceiling', () => {
  // The one way to earn without finishing. The bound is stated here so it stays
  // bounded: the whole list started and nothing done is worth less than a
  // single night's completion bonus.
  const state = reset();
  const tasks = Object.values(state.template.tasks);
  for (const task of tasks) applyTaskStart(state, task, 1000);
  assert.equal(state.profile.xp, tasks.length * START_ADVANCE_XP);
  assert.ok(state.profile.xp < nightCompletionBonus(computeStats(state)).xp,
    'less than finishing the list pays as a bonus, on its own');
  assert.equal(state.profile.stardust, 0);
});
