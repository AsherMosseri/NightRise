/* What the history stats claim, versus what they count. */

import test from 'node:test';
import assert from 'node:assert/strict';

import { nightsFullyCleared, overallRate } from '../js/insights.js';
import { BADGES } from '../js/game.js';

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

test('no badge name claims a bedtime it does not measure', () => {
  // The two that *are* about bedtime, and nothing else may sound like them.
  const bedtimeBadges = new Set(['on-time', 'on-time-3']);
  const claims = /\b(perfect|flawless|early|bed|bedtime|asleep|sleep)\b/i;
  for (const badge of BADGES) {
    if (bedtimeBadges.has(badge.id)) continue;
    assert.equal(claims.test(badge.name), false,
      `badge "${badge.name}" sounds like it is about sleep, but it measures: ${badge.hint}`);
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
