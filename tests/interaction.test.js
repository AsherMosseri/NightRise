import test from 'node:test';
import assert from 'node:assert/strict';

import { parseQuickAdd, slugify } from '../js/keys.js';
import { moveItem } from '../js/util.js';
import { starCost, progressFor, buyStar, collectionSummary, CONSTELLATIONS } from '../js/constellations.js';
import { createInitialState } from '../js/model.js';

const SECTIONS = [
  { id: 's1', title: 'Wind Down' },
  { id: 's2', title: 'Tidy Up' },
  { id: 's3', title: 'Tomorrow Prep' },
];

test('quick add pulls out the section and the minutes', () => {
  const parsed = parseQuickAdd('Brush teeth #wind-down !5', SECTIONS);
  assert.equal(parsed.title, 'Brush teeth');
  assert.equal(parsed.minutes, 5);
  assert.equal(parsed.sectionId, 's1');
});

test('section hints match on prefix and substring', () => {
  assert.equal(parseQuickAdd('Dishes #tidy', SECTIONS).sectionId, 's2');
  assert.equal(parseQuickAdd('Dishes #prep', SECTIONS).sectionId, 's3');
  assert.equal(parseQuickAdd('Dishes #kitchen', SECTIONS).sectionId, null);
  assert.equal(parseQuickAdd('Dishes #kitchen', SECTIONS).sectionHint, 'kitchen');
});

test('minutes can be written a few ways', () => {
  assert.equal(parseQuickAdd('Read ~15', SECTIONS).minutes, 15);
  assert.equal(parseQuickAdd('Read !15m', SECTIONS).minutes, 15);
  assert.equal(parseQuickAdd('Read 20 min', SECTIONS).minutes, 20);
  assert.equal(parseQuickAdd('Read', SECTIONS).minutes, null);
});

test('odd durations survive: half minutes and seconds', () => {
  assert.equal(parseQuickAdd('Shower !7.5', SECTIONS).minutes, 7.5);
  assert.equal(parseQuickAdd('Bins !30s', SECTIONS).minutes, 0.5);
  assert.equal(parseQuickAdd('Bins !90 sec', SECTIONS).minutes, 1.5);
  assert.equal(parseQuickAdd('Stretch 7.5 min', SECTIONS).minutes, 7.5);
  assert.equal(parseQuickAdd('Shower !7.5', SECTIONS).title, 'Shower');
  // Quantised to the half — nobody is estimating twenty seconds honestly.
  assert.equal(parseQuickAdd('Bins !20s', SECTIONS).minutes, 0.5);
  assert.equal(parseQuickAdd('Bins !5s', SECTIONS).minutes, 0);
});

test('a bare trailing "s" is not a unit', () => {
  const parsed = parseQuickAdd('Sort the 90s records', SECTIONS);
  assert.equal(parsed.title, 'Sort the 90s records');
  assert.equal(parsed.minutes, null);
});

test('a title with no extras is left alone', () => {
  const parsed = parseQuickAdd('  Water the  plants ', SECTIONS);
  assert.equal(parsed.title, 'Water the plants');
  assert.equal(parsed.sectionId, null);
});

test('a number that is part of the task name is not eaten', () => {
  assert.equal(parseQuickAdd('Do 10 push ups', SECTIONS).title, 'Do 10 push ups');
  assert.equal(parseQuickAdd('Do 10 push ups', SECTIONS).minutes, null);
});

test('slugify is stable for section matching', () => {
  assert.equal(slugify('Tomorrow Prep!'), 'tomorrow-prep');
  assert.equal(slugify('  Wind   Down  '), 'wind-down');
});

test('moveItem reorders without mutating the original', () => {
  const list = ['a', 'b', 'c', 'd'];
  assert.deepEqual(moveItem(list, 0, 2), ['b', 'c', 'a', 'd']);
  assert.deepEqual(moveItem(list, 3, 0), ['d', 'a', 'b', 'c']);
  assert.deepEqual(moveItem(list, 0, -5), ['a', 'b', 'c', 'd'], 'out of range clamps');
  assert.deepEqual(list, ['a', 'b', 'c', 'd'], 'original untouched');
});

test('each star in a constellation costs more than the last', () => {
  const def = CONSTELLATIONS[0];
  for (let i = 1; i < def.stars.length; i += 1) {
    assert.ok(starCost(def.base, i) > starCost(def.base, i - 1));
  }
});

test('buying stars completes a constellation and only then', () => {
  const state = createInitialState();
  const def = CONSTELLATIONS[0];
  state.profile.stardust = 100000;
  state.profile.starlight = 100000; // a star costs a night on time too

  for (let i = 0; i < def.stars.length; i += 1) {
    const result = buyStar(state, def.id);
    assert.ok(result, `star ${i} should be purchasable`);
    assert.equal(result.complete, i === def.stars.length - 1);
  }
  assert.equal(progressFor(state, def.id).complete, true);
  assert.equal(collectionSummary(state).done, 1);

  // This used to assert that a finished constellation could not be bought
  // again, which was the whole map's ceiling: 47 stars and then stardust
  // bought nothing for the rest of your life. Completion is now the join
  // between two tiers rather than the end — past the drawn figure are its
  // fainter real stars, on the same ladder. What must NOT change is what
  // `complete` means, because the achievement family and the live sky both
  // read it.
  const faintCount = def.faint?.length || 0;
  for (let i = 0; i < faintCount; i += 1) {
    const result = buyStar(state, def.id);
    assert.ok(result, `faint star ${i} should be purchasable`);
    assert.equal(result.complete, false, 'and must never re-report completion');
    assert.equal(result.deepStar, true);
  }
  assert.equal(buyStar(state, def.id), null, 'until every one of them is lit');
  assert.equal(progressFor(state, def.id).complete, true, 'complete still means the figure');
  assert.equal(collectionSummary(state).done, 1, 'and still counts once');
});

test('stars you cannot afford are not sold to you', () => {
  const state = createInitialState();
  state.profile.stardust = 0;
  assert.equal(buyStar(state, CONSTELLATIONS[0].id), null);
  assert.equal(progressFor(state, CONSTELLATIONS[0].id).lit, 0);
});

test('a section titled in any script can be reached by #hint', () => {
  // slugify stripped everything outside [a-z0-9], so "ערב" and "تنظيف" both
  // slugified to the empty string — unreachable, and indistinguishable from
  // each other. The hint pattern itself was `\w`, so `#ערב` did not even parse
  // as a hint: a literal hash was left sitting in the task's name.
  const sections = [
    { id: 'a', title: 'ערב' },
    { id: 'b', title: 'تنظيف' },
    { id: 'c', title: 'Wind Down' },
  ];
  assert.equal(parseQuickAdd('water #ערב', sections).sectionId, 'a');
  assert.equal(parseQuickAdd('sweep #تنظيف', sections).sectionId, 'b');
  assert.equal(parseQuickAdd('floss #wind-down', sections).sectionId, 'c');
  // And the hash is stripped from the title in every case.
  assert.equal(parseQuickAdd('water #ערב', sections).title, 'water');
  assert.equal(parseQuickAdd('x #🌙', sections).title, 'x');
  // An accented title still answers to its unaccented spelling.
  assert.equal(parseQuickAdd('a #cafe', [{ id: 'd', title: 'Café' }]).sectionId, 'd');
});
