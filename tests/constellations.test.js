/* The star map is data, and data is where a claim goes stale quietly.
 *
 * The catalog was checked once by hand — every figure against its real sky
 * position and its conventional asterism lines — and hand-checking does not
 * survive the next edit. These tests pin the properties that check established,
 * plus the totals the README and the module header now quote, so a mistyped
 * coordinate or a dropped figure fails here instead of shipping a sky with a
 * broken shape in it. */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CONSTELLATIONS,
  starCost,
  progressFor,
  buyStar,
  collectionSummary,
} from '../js/constellations.js';
import { createInitialState } from '../js/model.js';

const brightCount = (c) => c.stars.length;
const faintCount = (c) => (c.faint ? c.faint.length : 0);

function costOf(c) {
  let sum = 0;
  for (let i = 0; i < brightCount(c) + faintCount(c); i += 1) sum += starCost(c.base, i);
  return sum;
}

test('every figure is a well-formed shape', () => {
  for (const c of CONSTELLATIONS) {
    assert.ok(c.stars.length >= 3, `${c.id} has fewer than three stars`);
    for (const set of ['stars', 'faint']) {
      for (const [x, y] of c[set] || []) {
        assert.ok(x >= 0 && x <= 1 && y >= 0 && y <= 1,
          `${c.id} ${set} point ${x},${y} is outside the 0..1 box`);
      }
    }
    for (const [a, b] of c.lines) {
      assert.ok(a >= 0 && a < c.stars.length, `${c.id} line references star ${a}`);
      assert.ok(b >= 0 && b < c.stars.length, `${c.id} line references star ${b}`);
      assert.notEqual(a, b, `${c.id} has a line from a star to itself`);
    }
  }
});

test('every drawn figure is a single connected shape', () => {
  // A star nothing joins to renders as an orphan dot inside a named figure,
  // which reads as a bug rather than as a constellation.
  for (const c of CONSTELLATIONS) {
    const adjacency = new Map();
    for (const [a, b] of c.lines) {
      if (!adjacency.has(a)) adjacency.set(a, []);
      if (!adjacency.has(b)) adjacency.set(b, []);
      adjacency.get(a).push(b);
      adjacency.get(b).push(a);
    }
    const seen = new Set([0]);
    const stack = [0];
    while (stack.length) {
      for (const next of adjacency.get(stack.pop()) || []) {
        if (!seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
    assert.equal(seen.size, c.stars.length,
      `${c.id} draws ${c.stars.length} stars but only ${seen.size} are joined to the figure`);
  }
});

test('no two stars of a figure sit on top of each other', () => {
  // Bright and faint share one canvas, so a faint star hidden under a bright
  // one is stardust spent on nothing visible.
  for (const c of CONSTELLATIONS) {
    const points = [...c.stars, ...(c.faint || [])];
    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        const distance = Math.hypot(points[i][0] - points[j][0], points[i][1] - points[j][1]);
        assert.ok(distance > 0.03,
          `${c.id} stars ${i} and ${j} are ${distance.toFixed(3)} apart`);
      }
    }
  }
});

test('ids and names are unique', () => {
  assert.equal(new Set(CONSTELLATIONS.map((c) => c.id)).size, CONSTELLATIONS.length);
  assert.equal(new Set(CONSTELLATIONS.map((c) => c.name)).size, CONSTELLATIONS.length);
});

test('the map ramps in price, cheapest first', () => {
  // The order the market lists them in is the order they get expensive in, so
  // the first figure is reachable on an early night and the last one is a goal.
  const bases = CONSTELLATIONS.map((c) => c.base);
  for (let i = 1; i < bases.length; i += 1) {
    assert.ok(bases[i] >= bases[i - 1],
      `${CONSTELLATIONS[i].id} at ${bases[i]} is cheaper than the figure before it`);
  }
});

test('the catalog is the size the README and the header claim', () => {
  // These four numbers are quoted in prose in two places. If a figure is added
  // or a coordinate list edited, the prose is wrong until this is updated with
  // it — which is the point of asserting them.
  const bright = CONSTELLATIONS.reduce((sum, c) => sum + brightCount(c), 0);
  const faint = CONSTELLATIONS.reduce((sum, c) => sum + faintCount(c), 0);
  const total = CONSTELLATIONS.reduce((sum, c) => sum + costOf(c), 0);
  assert.equal(CONSTELLATIONS.length, 20, 'twenty figures');
  assert.equal(bright, 152, 'bright stars');
  assert.equal(faint, 229, 'faint stars');
  assert.equal(total, 111033, 'stardust for the whole map, both tiers');
});

test('every figure has a faint tier to continue into', () => {
  for (const c of CONSTELLATIONS) {
    assert.ok(faintCount(c) > 0, `${c.id} stops dead when its shape is finished`);
  }
});

test('there is no cliff at the join between the tiers', () => {
  // One ladder, continuing past the figure: the first faint star costs what the
  // next bright one would have.
  const state = createInitialState(new Date('2026-03-10T21:00:00Z'));
  const c = CONSTELLATIONS[0];
  state.profile.stardust = 1e6;
  for (let i = 0; i < brightCount(c); i += 1) assert.ok(buyStar(state, c.id));
  assert.equal(progressFor(state, c.id).nextCost, starCost(c.base, brightCount(c)));
});

test('a fully bought figure goes quiet rather than inventing more stars', () => {
  const state = createInitialState(new Date('2026-03-10T21:00:00Z'));
  const c = CONSTELLATIONS[0];
  state.profile.stardust = 1e6;
  let bought = 0;
  while (buyStar(state, c.id)) {
    bought += 1;
    assert.ok(bought <= 1000, 'buying never stopped — the map is unbounded');
  }
  assert.equal(bought, brightCount(c) + faintCount(c));
  assert.equal(progressFor(state, c.id).nextCost, null);
  assert.equal(1e6 - state.profile.stardust, costOf(c), 'spent exactly what the figure costs');
});

test('completion fires exactly once, on the last bright star', () => {
  const state = createInitialState(new Date('2026-03-10T21:00:00Z'));
  const c = CONSTELLATIONS[0];
  state.profile.stardust = 1e6;
  const completions = [];
  const deepStars = [];
  for (let i = 0; i < brightCount(c) + faintCount(c); i += 1) {
    const result = buyStar(state, c.id);
    if (result.complete) completions.push(i);
    if (result.deepStar) deepStars.push(i);
  }
  assert.deepEqual(completions, [brightCount(c) - 1], 'one completion, on the last bright star');
  assert.equal(deepStars.length, faintCount(c), 'every star past the figure is a faint one');
  assert.equal(deepStars[0], brightCount(c), 'and they start immediately after it');
});

test('depth is counted apart from completion', () => {
  // The achievement ladder and the live sky both key off `complete`, so buying
  // faint stars must not move it and must not un-move it either.
  const state = createInitialState(new Date('2026-03-10T21:00:00Z'));
  const c = CONSTELLATIONS[0];
  state.profile.stardust = 1e6;
  for (let i = 0; i < brightCount(c) + 3; i += 1) buyStar(state, c.id);
  const info = progressFor(state, c.id);
  assert.equal(info.complete, true);
  assert.equal(info.lit, brightCount(c), 'lit never runs past the drawn figure');
  assert.equal(info.deep, 3);
  assert.equal(info.deepDone, false);
  assert.equal(collectionSummary(state).done, 1, 'still one finished figure, not four');
});

test('a save claiming depth on an unfinished figure is clamped, not trusted', () => {
  const state = createInitialState(new Date('2026-03-10T21:00:00Z'));
  const c = CONSTELLATIONS[0];
  state.profile.constellations[c.id] = { lit: 2, complete: false, deep: 40 };
  const info = progressFor(state, c.id);
  assert.equal(info.deep, 0, 'depth before completion is not depth');
  assert.equal(info.nextCost, starCost(c.base, 2), 'and the next star is still a bright one');
});
