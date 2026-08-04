/* The economy has to survive the orders a real user clicks things in.
   These drive the real action layer, not the pure helpers underneath it. */

import test from 'node:test';
import assert from 'node:assert/strict';

import { getState, replaceState, update } from '../js/state.js';
import {
  toggleTask, toggleSkip, deleteTask, deleteSection, undo, claimQuest, addTask, addSection,
  setTaskMinutes, pushUndo, startTask,
} from '../js/actions.js';
import { createInitialState, createSection, createTask, emptyTemplate } from '../js/model.js';
import { computeStats, forceNewNight } from '../js/night.js';
import {
  grantXp, revokeGrant, applyTaskStart, applyTaskCompletion, revokeTaskCompletion,
  nightCompletionBonus, START_ADVANCE_XP, NIGHT_FULL_XP, levelFromXp, COMBO_MAX,
} from '../js/game.js';
import { lightsOutReward } from '../js/render/goodnight.js';
import { equipItem } from '../js/shop.js';
import { worthOf } from '../js/render/cards.js';
import { applyReset } from '../js/reset.js';

function reset() {
  replaceState(createInitialState(new Date(2026, 6, 29, 22, 0)));
  return getState();
}

/**
 * Run a block with the clock advancing a fixed step per read.
 *
 * Momentum keys off the gap between check-offs, so a test that toggles in a
 * tight loop measures a x1 night no matter what it says it is measuring. Pass
 * the gap you mean.
 */
function withClock(stepMs, body) {
  const real = Date.now;
  let t = real.call(Date);
  Date.now = () => {
    t += stepMs;
    return t;
  };
  try {
    return body();
  } finally {
    Date.now = real;
  }
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
  // The third argument is what the night itself earned — this reward is a
  // share of it, so a test that omits it measures the flat base and nothing else.
  assert.ok(lightsOutReward(90, real, { xp: 157, dust: 81 }).xp > 100,
    'a night you worked through still pays properly');
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

test('starting is bounded at every list size', () => {
  // This sampled an eleven-task list, which is the one size where the claim
  // held by accident. applyTaskStart paid through grantXp(state, XP, 0), and
  // the `0` only suppresses the direct dust argument — grantXp's level-up loop
  // pays levelUpDust on its own. At 27 rows that crossed level 2 and paid 60
  // stardust; at 5,000 rows it paid 1,380, with nothing ever completed. The
  // code comment and the README both asserted the opposite.
  for (const count of [11, 27, 100, 1000]) {
    const state = reset();
    state.template = emptyTemplate();
    const section = createSection('S');
    state.template.sections[section.id] = section;
    state.template.order.push(section.id);
    for (let i = 0; i < count; i += 1) {
      const task = createTask(`t${i}`, 0);
      state.template.tasks[task.id] = task;
      section.taskIds.push(task.id);
    }
    for (const task of Object.values(state.template.tasks)) applyTaskStart(state, task, 1000);
    // Bounded, which is the property that matters — not zero. Starting pays no
    // stardust of its own, but crossing a level pays level-up stardust whatever
    // raised the XP, and pretending otherwise would be the same weasel as the
    // claim this test replaced. What makes it safe is the taper: five thousand
    // rows started and nothing finished is worth about a thousand XP, so the
    // levels it can cross — and the stardust they pay — are bounded too.
    assert.ok(state.profile.xp < NIGHT_FULL_XP * 3, `${count} rows: ${state.profile.xp} XP`);
    assert.ok(state.profile.stardust < 300, `${count} rows: ${state.profile.stardust} stardust`);
  }

  // And past the full-pay band it is genuinely flat: ten times the rows is
  // nowhere near ten times the reward. (Both samples have to be past the band —
  // below it everything pays pound for pound, which is the point.)
  const some = startOnly(500);
  const many = startOnly(5000);
  assert.ok(many.xp < some.xp * 2, `500 rows ${some.xp} XP vs 5000 rows ${many.xp} XP`);
});

function startOnly(count) {
  const state = reset();
  state.template = emptyTemplate();
  const section = createSection('S');
  state.template.sections[section.id] = section;
  state.template.order.push(section.id);
  for (let i = 0; i < count; i += 1) {
    const task = createTask(`t${i}`, 0);
    state.template.tasks[task.id] = task;
    section.taskIds.push(task.id);
  }
  for (const task of Object.values(state.template.tasks)) applyTaskStart(state, task, 1000);
  return { xp: state.profile.xp, dust: state.profile.stardust };
}

test('undo settles awards by amount, not by presence', () => {
  // Edit a task's minutes and re-tick it and the same id sits in both
  // snapshots carrying different figures — so a presence check fired neither
  // branch, the balance kept the larger payout and the record kept the smaller
  // receipt. Un-ticking handed back the small one and you pocketed the
  // difference, on a loop, without limit: 500 laps was 299,000 XP.
  const state = reset();
  const id = Object.keys(state.template.tasks)[0];
  const before = balance();
  for (let lap = 0; lap < 50; lap += 1) {
    setTaskMinutes(id, 600);
    toggleTask(id);
    const undoId = pushUndo('lap');
    toggleTask(id);
    setTaskMinutes(id, 0);
    toggleTask(id);
    undo(undoId);
    toggleTask(id);
  }
  setTaskMinutes(id, 5);
  const after = balance();
  assert.equal(after.xp, before.xp, '50 laps of edit-tick-undo pays no XP');
  assert.ok(after.dust - before.dust < 200, `and no runaway stardust (got +${after.dust - before.dust})`);
});

test('an undo entry cannot be applied to a night it does not belong to', () => {
  // The rollover and "bank tonight and start fresh" replace the night object.
  // Its awards were banked into history, not revoked — so restoring a snapshot
  // from before the boundary re-granted every one of them a second time.
  const state = reset();
  for (const id of Object.keys(state.template.tasks)) toggleTask(id);
  const earned = getState().profile.xp;
  const undoId = pushUndo('last night');
  update((s) => forceNewNight(s, '2026-07-30'));
  assert.equal(undo(undoId), null, 'the entry describes a night that no longer exists');
  assert.equal(getState().profile.xp, earned, 'and nothing was paid twice');
});

test('what the card promises is what the tap pays, at every point on the curve', () => {
  // The house rule, made checkable. The card shows "+12 XP" before you tap, and
  // under a taper the honest number is the marginal step of the curve, not the
  // row's face — which are the same below the full-pay band and diverge sharply
  // above it. Neither judge could find this assertion anywhere in the project.
  const state = reset();
  state.template = emptyTemplate();
  const section = createSection('S');
  state.template.sections[section.id] = section;
  state.template.order.push(section.id);
  for (let i = 0; i < 120; i += 1) {
    const task = createTask(`t${i}`, 5);
    state.template.tasks[task.id] = task;
    section.taskIds.push(task.id);
  }
  replaceState(state);

  const ids = Object.keys(getState().template.tasks);
  ids.forEach((id, i) => {
    const promised = worthOf(getState(), getState().template.tasks[id]);
    const before = getState().profile.xp;
    toggleTask(id);
    const paid = getState().profile.xp - before;
    if (i < ids.length - 1) {
      assert.equal(paid, promised, `row ${i}: promised ${promised}, paid ${paid}`);
    } else {
      // The last row also lands the completion bonus, which is a separate thing
      // the card does not promise — so the only claim here is that finishing
      // the night is never worth less than the row that finished it.
      assert.ok(paid >= promised, `the last row promised ${promised} and paid ${paid}`);
    }
  });
});

test('the taper bounds the night without ever paying a negative amount', () => {
  // Monotonic by construction, which is what disqualified the rival design: a
  // curve that re-prices completed rows can make a single checkmark pay -150.
  const state = reset();
  state.template = emptyTemplate();
  const section = createSection('S');
  state.template.sections[section.id] = section;
  state.template.order.push(section.id);
  for (let i = 0; i < 400; i += 1) {
    const task = createTask(`t${i}`, 600);
    state.template.tasks[task.id] = task;
    section.taskIds.push(task.id);
  }
  replaceState(state);
  // Paced, not hammered. Momentum now rises on gaps that look like you went and
  // did the thing, so a burst of instant taps sits at x1 — this test used to
  // claim maximum momentum while measuring the cheapest possible night.
  withClock(60 * 1000, () => {
    for (const id of Object.keys(getState().template.tasks)) {
      const before = getState().profile.xp;
      toggleTask(id);
      assert.ok(getState().profile.xp >= before, 'no tap may cost you XP');
    }
  });
  assert.equal(getState().night.combo, COMBO_MAX, 'the worst case is the paced one');
  // 400 rows of the longest task the app allows, at maximum momentum, used to
  // be worth 246,440 XP. The whole sink is 8,525 stardust.
  assert.ok(getState().profile.xp < 2500, `one night paid ${getState().profile.xp} XP`);
  assert.ok(getState().profile.stardust < 1200, `one night paid ${getState().profile.stardust} stardust`);
});

test('the same evening pays roughly the same however finely it is written', () => {
  const evening = (rows) => {
    const state = reset();
    state.template = emptyTemplate();
    const section = createSection('S');
    state.template.sections[section.id] = section;
    state.template.order.push(section.id);
    const per = Math.round((45 / rows) * 2) / 2;
    for (let i = 0; i < rows; i += 1) {
      const task = createTask(`t${i}`, per);
      state.template.tasks[task.id] = task;
      section.taskIds.push(task.id);
    }
    replaceState(state);
    withClock(60 * 1000, () => {
      for (const id of Object.keys(getState().template.tasks)) toggleTask(id);
    });
    return getState().profile.xp;
  };
  // It was 35x. It is not 1x and should not be — a longer list is more work and
  // has to be worth more — but splitting is no longer the best move in the game.
  // Measured paced rather than hammered, which is the version that pays most.
  const ratio = evening(400) / evening(4);
  assert.ok(ratio < 8, `400 rows pays ${ratio.toFixed(1)}x what 4 rows pays`);
});

test('a settled night pays what the README says a settled night pays', () => {
  // The README quotes a stardust-per-night figure and paces every sink off it.
  // That number is the whole argument for the rebalance, so it is measured here
  // rather than remembered: eighteen rows, all ticked, quest claimed, lights out
  // on time, on a profile too high for a level-up to inflate the total.
  const state = reset();
  state.template = emptyTemplate();
  const section = createSection('S');
  state.template.sections[section.id] = section;
  state.template.order.push(section.id);
  for (let i = 0; i < 18; i += 1) {
    const task = createTask(`t${i}`, 8);
    state.template.tasks[task.id] = task;
    section.taskIds.push(task.id);
  }
  // High enough that tonight's XP cannot cross a rung, so no level-up stardust.
  state.profile.xp = 4_000_000;
  state.profile.level = levelFromXp(state.profile.xp).level;
  state.profile.stardust = 0;
  replaceState(state);
  const paced = () => withClock(60 * 1000, () => {
    for (const id of Object.keys(getState().template.tasks)) toggleTask(id);
  });
  // Settle the one-time ledgers first. The momentum rungs pay 150 stardust the
  // first time you reach x2.5, ever, which is real income on an early night and
  // no income at all on a later one — the number the sinks are paced against is
  // the later one.
  paced();
  update((s) => forceNewNight(s, '2026-07-30'));
  update((s) => { s.profile.stardust = 0; });
  paced();
  claimQuest();
  update((s) => {
    const reward = lightsOutReward(45, computeStats(s), s.night.paid);
    s.profile.stardust += reward.dust;
  });
  const paid = getState().profile.stardust;
  assert.ok(paid >= 120 && paid <= 145,
    `a settled eighteen-row night paid ${paid} stardust; the README says about 131`);
});

test('stopping early pays the same whether your list was short or long', () => {
  // Lights out sits outside the taper on purpose, and it used to carry a
  // `+ done * 2` term — a per-row payment in the one reward meant to be free of
  // them. Three tasks finished and ended at ten o'clock earned less for
  // stopping than eighteen did, which is the same padding pressure the taper
  // exists to remove, in the last place it should be.
  const ended = (total) => lightsOutReward(45, { total, counted: total, done: total });
  assert.deepEqual(ended(3), ended(18), 'a short honest night ends for what a long one does');
  assert.deepEqual(ended(3), ended(40));
  // It still follows the fraction, so an untouched list is not worth ending for
  // the same amount as a finished one.
  const untouched = lightsOutReward(45, { total: 18, counted: 18, done: 0 });
  assert.ok(untouched.xp < ended(18).xp / 2, 'doing none of it must still pay less');
  assert.ok(untouched.xp > 0, 'but a bad night must still be worth ending');
  // And earlier is still better than later, at every list size.
  assert.ok(lightsOutReward(90, { total: 5, counted: 5, done: 5 }).xp
    > lightsOutReward(10, { total: 5, counted: 5, done: 5 }).xp);
});

/**
 * The invariant every targeted test in this file is a special case of: unwind a
 * night completely and the balance goes back where it started.
 *
 * Every exploit this project has shipped was a sequence nobody thought to write
 * a test for — settle-by-amount, settle-by-presence, the undo entry applied to
 * the wrong night, the reset that forgot a ledger. So this one does not pick the
 * sequence. It runs forty thousand random actions across a hundred nights,
 * un-ticks and deletes everything, and asserts what is left.
 *
 * Seeded, so a failure names the exact run that produced it.
 */
test('no sequence of actions leaves you holding what you gave back', () => {
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const MINUTES = [0.5, 5, 30, 120, 600];
  const OPS = ['toggle', 'toggle', 'toggle', 'skip', 'minutes', 'delete', 'undo', 'add', 'start'];

  let worstXp = 0;
  let worstDust = 0;
  for (let night = 0; night < 100; night += 1) {
    const state = reset();
    state.template = emptyTemplate();
    const section = createSection('S');
    state.template.sections[section.id] = section;
    state.template.order.push(section.id);
    for (let i = 0; i < 6; i += 1) {
      const task = createTask(`t${i}`, pick(MINUTES));
      state.template.tasks[task.id] = task;
      section.taskIds.push(task.id);
    }
    // Zero, so anything left at the end is something the run created.
    state.profile.xp = 0;
    state.profile.stardust = 0;
    replaceState(state);

    withClock(45 * 1000, () => {
      for (let step = 0; step < 400; step += 1) {
        const ids = Object.keys(getState().template.tasks);
        const id = ids.length ? pick(ids) : null;
        const op = pick(OPS);
        // Refusals are a legitimate outcome (no rain checks left, nothing to
        // undo); a throw is not, and would fail the run here.
        if (op === 'toggle' && id) toggleTask(id);
        else if (op === 'skip' && id) toggleSkip(id);
        else if (op === 'minutes' && id) setTaskMinutes(id, pick(MINUTES));
        else if (op === 'start' && id) startTask(id);
        else if (op === 'delete' && id) { pushUndo('fuzz'); deleteTask(id); }
        else if (op === 'undo') undo();
        else if (op === 'add') addTask(section.id, `x${step}`, pick(MINUTES));
      }
      for (const id of Object.keys(getState().night.done)) toggleTask(id);
      for (const id of Object.keys(getState().template.tasks)) deleteTask(id);
    });

    worstXp = Math.max(worstXp, getState().profile.xp);
    worstDust = Math.max(worstDust, getState().profile.stardust);
  }

  assert.equal(worstXp, 0, `a random night left ${worstXp} XP behind`);
  // Stardust is allowed to survive, and only this much. Achievement rungs are
  // paid once ever against a high-water mark and are records of something that
  // did happen — reaching x2.5 momentum is not un-happened by un-ticking the
  // row. The three momentum rungs are the only ones a single night can reach,
  // they total 150, and the number must not grow with the length of the run.
  assert.equal(worstDust, 150, `a random night left ${worstDust} stardust behind`);
});

/* ------------------------------------ a date is the budget, not a night object */

/** Every task in the list, through the real payment path. */
function checkEverything(state) {
  for (const id of Object.keys(state.template.tasks)) {
    applyTaskCompletion(state, state.template.tasks[id]);
  }
}

test('banking and starting fresh does not hand the same date a second budget', () => {
  // The taper's ceiling used to live on the night OBJECT, and this button builds
  // a new one — so re-checking the same list paid again, at +157 XP and ~28
  // stardust a lap, unthrottled. 1,519 laps bought the entire market. The
  // real-time guard does not cover it on purpose: its own comment says "bank
  // tonight and start fresh does not advance the date".
  const state = reset();
  const key = state.night.key;
  checkEverything(state);
  const afterOne = { xp: state.profile.xp, dust: state.profile.stardust };
  assert.ok(afterOne.xp > 0);

  forceNewNight(state, key);
  checkEverything(state);
  const afterTwo = { xp: state.profile.xp, dust: state.profile.stardust };
  assert.equal(afterTwo.xp, afterOne.xp, 'the same date paid its XP twice');

  // And it stays flat, rather than merely growing more slowly.
  for (let lap = 0; lap < 20; lap += 1) {
    forceNewNight(state, key);
    checkEverything(state);
  }
  assert.equal(state.profile.xp, afterOne.xp, 'twenty more laps minted XP');
  assert.equal(state.profile.stardust, afterTwo.dust, 'twenty more laps minted stardust');
});

test('a genuinely new date still gets a budget of its own', () => {
  // The fix must not turn the 4am rollover into a night that pays nothing.
  const state = reset();
  checkEverything(state);
  const one = state.profile.xp;
  forceNewNight(state, '2099-01-01');
  checkEverything(state);
  assert.ok(state.profile.xp > one, 'a new date earned nothing');
});

test('a fresh start cannot claw back the run it just banked', () => {
  // The trap in the obvious version of this fix: carry the paid total forward
  // and the fresh night's face is zero, so the very first settle "corrects" the
  // profile down by a whole night you had legitimately earned.
  const state = reset();
  const key = state.night.key;
  checkEverything(state);
  const earned = state.profile.xp;
  forceNewNight(state, key);
  assert.equal(state.profile.xp, earned, 'banking took the night back');
  // And a single check-off on the fresh night must not either.
  applyTaskCompletion(state, Object.values(state.template.tasks)[0]);
  assert.equal(state.profile.xp, earned, 'the first check-off of a fresh run moved the balance');
});

test('un-ticking inside a night still refunds exactly, carried or not', () => {
  const state = reset();
  const key = state.night.key;
  const first = Object.values(state.template.tasks)[0];
  // An ordinary night: the behaviour nothing here may change.
  const before = state.profile.xp;
  applyTaskCompletion(state, first);
  assert.ok(state.profile.xp > before);
  revokeTaskCompletion(state, first.id);
  assert.equal(state.profile.xp, before, 'a plain un-tick did not refund');

  // And after a fresh start, an un-tick refunds down to what the date already
  // paid and no further — the banked run is not tonight's to give back.
  checkEverything(state);
  const earned = state.profile.xp;
  forceNewNight(state, key);
  applyTaskCompletion(state, first);
  revokeTaskCompletion(state, first.id);
  assert.equal(state.profile.xp, earned, 'un-ticking ate into the banked run');
});

test('clearing tonight after a fresh start does not re-arm the whole night', () => {
  // clearTonight sets `paid` back to the floor rather than to zero. Zeroing it
  // would let the next check-off pay the entire night a second time, which is
  // the faucet that reset exists to prevent.
  const state = reset();
  const key = state.night.key;
  checkEverything(state);
  const earned = state.profile.xp;
  forceNewNight(state, key);
  applyReset(state, ['checks']);
  checkEverything(state);
  assert.equal(state.profile.xp, earned, 'clear-then-recheck paid the date twice');
});

test('a fresh night keeps the target the evening was already judged against', () => {
  // Same date, same clock, so the same line. Otherwise this button was the last
  // way to move the bedtime out from under a night in progress and collect an
  // on-time star for it — the one record in this app you cannot buy.
  const state = reset();
  const key = state.night.key;
  checkEverything(state);
  assert.equal(state.night.bedtime, '23:30', 'the night locked its target');
  forceNewNight(state, key);
  assert.equal(state.night.bedtime, '23:30', 'and a fresh list does not unlock it');
  assert.equal(state.night.lastCall, 60);

  // A real new date does start clean.
  forceNewNight(state, '2099-01-01');
  assert.equal(state.night.bedtime, null);
});
