import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeState, parseImport, serializeState, damagedSave } from '../js/storage.js';
import { createInitialState } from '../js/model.js';

test('garbage in gives a usable starter night', () => {
  const state = normalizeState(null);
  assert.ok(state.template.order.length > 0);
  assert.equal(state.profile.level, 1);
  assert.ok(state.night.key);
});

test('a task orphaned from its section is rehomed, not dropped', () => {
  const raw = createInitialState();
  const orphan = Object.keys(raw.template.tasks)[0];
  for (const section of Object.values(raw.template.sections)) {
    section.taskIds = section.taskIds.filter((id) => id !== orphan);
  }
  const state = normalizeState(raw);
  const homes = Object.values(state.template.sections).filter((s) => s.taskIds.includes(orphan));
  assert.equal(homes.length, 1);
});

test('a task listed twice is only kept once', () => {
  const raw = createInitialState();
  const [a, b] = raw.template.order;
  const taskId = raw.template.sections[a].taskIds[0];
  raw.template.sections[b].taskIds.push(taskId);
  const state = normalizeState(raw);
  const homes = Object.values(state.template.sections).filter((s) => s.taskIds.includes(taskId));
  assert.equal(homes.length, 1);
});

test('progress pointing at deleted tasks is cleaned up', () => {
  const raw = createInitialState();
  raw.night.done['ghost'] = Date.now();
  raw.night.skipped['ghost'] = true;
  raw.night.awards['ghost'] = { xp: 10, dust: 2 };
  const state = normalizeState(raw);
  assert.equal(state.night.done.ghost, undefined);
  assert.equal(state.night.skipped.ghost, undefined);
  assert.equal(state.night.awards.ghost, undefined);
});

test('missing profile fields fall back to defaults', () => {
  const state = normalizeState({ template: { order: [], sections: {}, tasks: {} }, profile: { xp: 500 } });
  assert.equal(state.profile.xp, 500);
  assert.equal(state.profile.equipped.theme, 'midnight');
  assert.deepEqual(state.profile.tokens.freeze >= 0, true);
  assert.ok(Array.isArray(state.profile.inventory.themes));
  assert.ok(state.profile.inventory.themes.includes('midnight'));
});

test('nonsense values are coerced rather than trusted', () => {
  const state = normalizeState({
    template: {
      order: ['s1', 'nope'],
      sections: { s1: { title: 'A', taskIds: ['t1', 'missing'] } },
      tasks: { t1: { title: 'x', minutes: 'lots' } },
    },
    profile: { xp: -40, stardust: 'nope', streak: -3 },
    history: { '2026-07-01': { pct: 400, total: 3, done: 3 } },
  });
  assert.equal(state.template.order.length, 1);
  assert.equal(state.template.sections.s1.taskIds.length, 1);
  assert.equal(state.template.tasks.t1.minutes, 5);
  assert.equal(state.profile.xp, 0);
  assert.equal(state.profile.stardust, 0);
  assert.equal(state.profile.streak, 0);
  assert.equal(state.history['2026-07-01'].pct, 100);
});

test('a full export survives a round trip', () => {
  const original = createInitialState();
  original.profile.xp = 1234;
  original.profile.stardust = 99;
  original.profile.inventory.themes.push('aurora');
  const restored = parseImport(serializeState(original));
  assert.equal(restored.profile.xp, 1234);
  assert.equal(restored.profile.stardust, 99);
  assert.ok(restored.profile.inventory.themes.includes('aurora'));
  assert.equal(Object.keys(restored.template.tasks).length, Object.keys(original.template.tasks).length);
});

test('importing something that is not a backup fails loudly', () => {
  assert.throws(() => parseImport('{"hello":"world"}'), /does not look like/);
  assert.throws(() => parseImport('not json at all'));
});

test('a malformed field gets its default back instead of bricking the app', () => {
  // mergeDefaults copies a non-object straight through, so `tokens: null` or
  // `inventory: "x"` — hand-edited, imported, half-written — arrived intact and
  // threw on first dereference. Inside normalizeState that throw is caught by
  // loadState, which then declares a perfectly readable save corrupt.
  for (const profile of [
    { inventory: 'x' }, { tokens: null }, { settings: null },
    { constellations: null }, { equipped: [1, 2] }, { companion: 42 }, { taskStats: 'no' },
  ]) {
    const state = normalizeState({ profile });
    assert.equal(typeof state.profile.tokens.raincheck, 'number');
    assert.equal(typeof state.profile.settings.bedtime, 'string');
    assert.ok(Array.isArray(state.profile.inventory.themes));
    assert.equal(state.profile.equipped.theme, 'midnight');
    assert.deepEqual(state.profile.constellations, {});
  }
});

test('damage that parses is still damage', () => {
  // The recovery path only ever fired when JSON.parse threw, which is the least
  // likely kind of damage. A save that parses but is structurally wrong was
  // normalised into something plausible, opened as a near-empty checklist, and
  // committed over the real save by the first debounced write — no backup, no
  // warning. The test is not "did it throw", it is "did we lose anything".
  const good = createInitialState();
  assert.equal(damagedSave(good, normalizeState(good)), false);
  assert.equal(damagedSave({}, normalizeState({})), false);

  const cases = [
    { template: 'truncated' },
    { history: 7 },
    { profile: [] },
    { night: 'x' },
    { history: { '2026-07-01': { pct: 100 } } }, // history with no template at all
    (() => { const s = createInitialState(); s.template.tasks[Object.keys(s.template.tasks)[0]] = null; return s; })(),
    (() => { const s = createInitialState(); s.template.sections[s.template.order[0]] = 'gone'; return s; })(),
    (() => { const s = createInitialState(); s.history['2026-07-01'] = 'not an entry'; return s; })(),
  ];
  for (const raw of cases) {
    assert.equal(damagedSave(raw, normalizeState(raw)), true, JSON.stringify(raw).slice(0, 60));
  }
});
