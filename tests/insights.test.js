/* What the history stats claim, versus what they count. */

import test from 'node:test';
import assert from 'node:assert/strict';

import { nightsFullyCleared, overallRate, taskInsights, topNudge } from '../js/insights.js';
import { ACHIEVEMENTS } from '../js/achievements.js';
import { createInitialState, createTask } from '../js/model.js';

/** A banked night. `done` excludes rain checks; `pct` is over what counted. */
function night({ total, done, skipped = 0 }) {
  const counted = total - skipped;
  return {
    total, done, skipped,
    pct: counted === 0 ? 0 : Math.round((done / counted) * 100),
    xp: 0, quest: false, frozen: false,
    lightsOutAt: null, onTime: false, bedtime: null, minutesLate: null,
  };
}

test('"every task done" counts nights you cleared the list', () => {
  const history = {
    '2026-07-27': night({ total: 5, done: 5 }),
    '2026-07-28': night({ total: 5, done: 3 }),
    '2026-07-29': night({ total: 8, done: 8 }),
  };
  assert.equal(nightsFullyCleared(history), 2);
});

test('a rain check is not a task you did', () => {
  // Five of six excused, one done. That scores 100% — and it is still not a
  // night where every task got done.
  const raincheck = night({ total: 6, done: 1, skipped: 5 });
  assert.equal(raincheck.pct, 100, 'the percentage forgives it');
  assert.equal(nightsFullyCleared({ '2026-07-29': raincheck }), 0, 'the tile does not');
});

test('a night with nothing on the list is not an achievement', () => {
  assert.equal(nightsFullyCleared({ '2026-07-29': night({ total: 0, done: 0 }) }), 0);
  assert.equal(nightsFullyCleared({}), 0);
});

test('the stat has nothing to do with bedtime', () => {
  // Cleared the list at half two in the morning. It still counts here, because
  // this number is about the list; "to bed on time" is the one next to it.
  const late = night({ total: 4, done: 4 });
  late.lightsOutAt = new Date(2026, 6, 30, 2, 30).getTime();
  late.onTime = false;
  assert.equal(nightsFullyCleared({ '2026-07-29': late }), 1);
});

test('no achievement name claims a bedtime it does not measure', () => {
  // One family *is* about bedtime. Nothing else may sound like it.
  const claims = /\b(perfect|flawless|early|bed|bedtime|asleep|sleep)\b/i;
  for (const family of ACHIEVEMENTS) {
    if (family.id === 'ontime') continue;
    for (const step of family.tiers) {
      assert.equal(claims.test(step.name), false,
        `"${step.name}" sounds like sleep, but ${family.id} measures: ${family.goal(step.at)}`);
    }
  }
});

test('the average night is the mean percentage, gaps excluded', () => {
  const state = {
    history: {
      '2026-07-28': night({ total: 4, done: 2 }),
      '2026-07-29': night({ total: 4, done: 4 }),
    },
  };
  assert.equal(overallRate(state), 75);
  assert.equal(overallRate({ history: {} }), null);
});

test('two tasks with the same name are told apart', () => {
  // Stats are keyed by id, but every surface printed only the title — so two
  // "Brush teeth" rows were identical, and the nudge blamed the one you do
  // every night for the slipping of the one you do not.
  const state = createInitialState();
  const [a, b] = state.template.order;
  const first = addTaskTo(state, a, 'Brush teeth');
  const second = addTaskTo(state, b, 'Brush teeth');
  state.profile.taskStats = {
    [first]: { seen: 5, done: 5, skipped: 0, missStreak: 0, lastDoneKey: null },
    [second]: { seen: 5, done: 1, skipped: 0, missStreak: 4, lastDoneKey: null },
  };
  const rows = taskInsights(state);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.where), 'both carry a section, since both share a title');
  assert.notEqual(rows[0].where, rows[1].where);
  assert.match(topNudge(state).text, new RegExp(state.template.sections[b].title));

  // A title nobody shares stays clean.
  state.profile.taskStats[first].missStreak = 0;
  const unique = addTaskTo(state, a, 'Floss');
  state.profile.taskStats[unique] = { seen: 3, done: 3, skipped: 0, missStreak: 0, lastDoneKey: null };
  assert.equal(taskInsights(state).find((r) => r.title === 'Floss').where, null);
});

function addTaskTo(state, sectionId, title) {
  const task = createTask(title, 5);
  state.template.tasks[task.id] = task;
  state.template.sections[sectionId].taskIds.push(task.id);
  return task.id;
}
