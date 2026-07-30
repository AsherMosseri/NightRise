import test from 'node:test';
import assert from 'node:assert/strict';

import { rollQuest, evaluateQuest, questById, QUEST_DEFS } from '../js/quests.js';
import { createInitialState } from '../js/model.js';
import { computeStats } from '../js/night.js';
import { applyTaskCompletion } from '../js/game.js';

test('the same night always rolls the same quest', () => {
  const a = rollQuest('2026-07-29');
  const b = rollQuest('2026-07-29');
  assert.equal(a.id, b.id);
  assert.equal(a.claimed, false);
});

test('different nights spread across the pool', () => {
  const ids = new Set();
  for (let day = 1; day <= 28; day += 1) {
    ids.add(rollQuest(`2026-07-${String(day).padStart(2, '0')}`).id);
  }
  assert.ok(ids.size > 1, 'a month of nights should not all roll the same quest');
  for (const id of ids) assert.ok(QUEST_DEFS.some((q) => q.id === id));
});

test('the sprint quest measures the busiest five minutes', () => {
  const state = createInitialState();
  state.night.quest = { id: 'sprint', progress: 0, claimed: false };
  const tasks = Object.values(state.template.tasks);
  const base = 1_000_000;
  applyTaskCompletion(state, tasks[0], base);
  applyTaskCompletion(state, tasks[1], base + 60_000);
  applyTaskCompletion(state, tasks[2], base + 20 * 60_000); // way outside the window

  let quest = evaluateQuest(state, computeStats(state));
  assert.equal(quest.progress, 2);
  assert.equal(quest.complete, false);

  applyTaskCompletion(state, tasks[3], base + 120_000);
  quest = evaluateQuest(state, computeStats(state));
  assert.equal(quest.progress, 3);
  assert.equal(quest.complete, true);
});

test('clearing a section satisfies the clean sweep', () => {
  const state = createInitialState();
  state.night.quest = { id: 'clearSection', progress: 0, claimed: false };
  const firstSection = state.template.sections[state.template.order[0]];
  for (const id of firstSection.taskIds) applyTaskCompletion(state, state.template.tasks[id]);
  const quest = evaluateQuest(state, computeStats(state));
  assert.equal(quest.complete, true);
});

test('no-rainchecks needs both the percentage and a clean sheet', () => {
  const state = createInitialState();
  state.night.quest = { id: 'noRainchecks', progress: 0, claimed: false };
  const tasks = Object.values(state.template.tasks);
  for (let i = 0; i < 10; i += 1) applyTaskCompletion(state, tasks[i]);
  assert.equal(evaluateQuest(state, computeStats(state)).complete, true);

  state.night.skipped[tasks[10].id] = true;
  assert.equal(evaluateQuest(state, computeStats(state)).complete, false);
});

test('front loaded counts only what you did early', () => {
  const state = createInitialState(new Date(2026, 6, 29, 20, 0));
  state.profile.settings.bedtime = '23:30';
  state.night.quest = { id: 'halfBefore', progress: 0, claimed: false };
  const tasks = Object.values(state.template.tasks);
  const at = (h, m) => new Date(2026, 6, 29, h, m).getTime();

  // Four tasks, all of them after bedtime — the shape of the bug.
  for (let i = 0; i < 4; i += 1) applyTaskCompletion(state, tasks[i], at(23, 50));
  let quest = evaluateQuest(state, computeStats(state));
  assert.equal(quest.progress, 0, 'past bedtime is not front loaded');
  assert.equal(quest.complete, false);

  // The cutoff is an hour before 23:30. 22:29 counts, 22:31 does not.
  applyTaskCompletion(state, tasks[4], at(22, 29));
  applyTaskCompletion(state, tasks[5], at(22, 31));
  quest = evaluateQuest(state, computeStats(state));
  assert.equal(quest.progress, 1, 'only the one inside the hour');

  for (let i = 6; i < 9; i += 1) applyTaskCompletion(state, tasks[i], at(21, 0));
  quest = evaluateQuest(state, computeStats(state));
  assert.equal(quest.progress, 4);
  assert.equal(quest.complete, true);
});

test('front loaded says which time it means', () => {
  const state = createInitialState(new Date(2026, 6, 29, 20, 0));
  state.profile.settings.bedtime = '23:30';
  state.night.quest = { id: 'halfBefore', progress: 0, claimed: false };
  const quest = evaluateQuest(state, computeStats(state));
  assert.match(quest.description, /Finish 4 tasks before /);
  assert.match(quest.description, /10:30/, 'an hour before the bedtime that is actually set');
});

test('a section you rain-checked into silence is not cleared', () => {
  const state = createInitialState();
  state.night.quest = { id: 'clearSection', progress: 0, claimed: false };
  const section = state.template.sections[state.template.order[0]];
  for (const id of section.taskIds) state.night.skipped[id] = true;

  assert.equal(computeStats(state).sections[0].remaining, 0, 'nothing is left, technically');
  assert.equal(evaluateQuest(state, computeStats(state)).complete, false, 'but nothing was done');

  // One real completion among the excuses is enough to have cleared it.
  const [first] = section.taskIds;
  delete state.night.skipped[first];
  applyTaskCompletion(state, state.template.tasks[first]);
  assert.equal(evaluateQuest(state, computeStats(state)).complete, true);
});

test('every quest definition is well formed', () => {
  for (const def of QUEST_DEFS) {
    assert.equal(questById(def.id), def);
    assert.ok(def.goal > 0);
    assert.ok(def.xp > 0 && def.dust > 0);
    assert.equal(typeof def.describe(createInitialState()), 'string');
    assert.equal(typeof def.describe(), 'string', 'and it survives being asked without state');
  }
});
