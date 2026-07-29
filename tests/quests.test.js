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

test('every quest definition is well formed', () => {
  for (const def of QUEST_DEFS) {
    assert.equal(questById(def.id), def);
    assert.ok(def.goal > 0);
    assert.ok(def.xp > 0 && def.dust > 0);
    assert.equal(typeof def.describe(), 'string');
  }
});
