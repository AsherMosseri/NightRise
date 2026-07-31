import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeState, parseImport, serializeState, damagedSave } from '../js/storage.js';
import { createInitialState, createTask, createSection, TITLE_MAX, PRICE_REBASE, SCHEMA_VERSION } from '../js/model.js';

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

test('a title is clamped where you can see it, not silently on the next load', () => {
  // The loader has always cut at 200. Nothing on the way in did, so a longer
  // title lived on screen and on disk all evening and was amputated at launch.
  const long = 'x'.repeat(400);
  const task = createTask(long, 5);
  assert.equal(task.title.length, TITLE_MAX);
  assert.equal(createSection(long).title.length, TITLE_MAX);
  // And what the loader keeps now matches what the app stores.
  const state = createInitialState();
  const id = Object.keys(state.template.tasks)[0];
  state.template.tasks[id].title = long;
  assert.equal(normalizeState(state).template.tasks[id].title, task.title);
});

test('a night key has to look like a date', () => {
  // 'not-a-date' used to survive: keyDiffDays returned NaN, the "only roll
  // forward" guard was skipped, the night was banked, and the history panel
  // showed "Invalid Date" against it forever.
  assert.match(normalizeState({ night: { key: 'not-a-date' } }).night.key, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(normalizeState({ night: { key: '2026-13-45' } }).night.key, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(normalizeState({ night: { key: '2026-07-04' } }).night.key, '2026-07-04');
  const history = normalizeState({ history: { 'not-a-date': { pct: 100 }, '2026-07-04': { pct: 90 } } }).history;
  assert.deepEqual(Object.keys(history), ['2026-07-04']);
});

test('a malformed award cannot NaN the whole profile', () => {
  // `xp: {}` made `profile.xp - xp` NaN on the next un-tick, JSON.stringify
  // wrote null, and the reload read zero — every level and title gone, with no
  // throw and therefore no backup.
  const state = createInitialState();
  const id = Object.keys(state.template.tasks)[0];
  state.night.done[id] = Date.now();
  state.night.awards[id] = { xp: {}, dust: [], multiplier: 'x2', at: 'now' };
  const award = normalizeState(state).night.awards[id];
  for (const value of Object.values(award)) assert.ok(Number.isFinite(value), JSON.stringify(award));
});

test('a token count is a count', () => {
  // `raincheck: 'lots'` passed the `<= 0` gate, then `-= 1` made it NaN, and
  // NaN <= 0 is false too — the gate never closed and rain checks were endless.
  const tokens = normalizeState({ profile: { tokens: { freeze: -99, raincheck: 'lots', mystery: '3' } } }).profile.tokens;
  assert.equal(tokens.freeze, 0);
  assert.equal(tokens.raincheck, 0);
  assert.equal(tokens.mystery, 3, 'kinds the shop may add go through the same clamp');
});

test('an unreadable bedtime falls back rather than becoming a hole', () => {
  // Pacing, curfew and the Front Loaded quest each fall back to something
  // different when bedtimeInstant returns null, and the value arrives from any
  // imported or hand-edited backup unvalidated.
  assert.equal(normalizeState({ profile: { settings: { bedtime: 'half eleven' } } }).profile.settings.bedtime, '23:30');
  assert.equal(normalizeState({ profile: { settings: { bedtime: '22:15' } } }).profile.settings.bedtime, '22:15');
});

test('the stardust rebalance does not confiscate what a save had banked', () => {
  // Everything got dearer. A balance banked under the old prices has to grow by
  // the same factor, or repricing is a silent confiscation of somebody's
  // savings — they would open the app to find the sky they were two nights
  // from affording is now six.
  const old = createInitialState();
  old.version = 1;
  old.profile.stardust = 1000;
  old.profile.dustDebt = 100;
  const migrated = normalizeState(old);
  assert.equal(migrated.profile.stardust, Math.round(1000 * PRICE_REBASE));
  assert.equal(migrated.profile.dustDebt, Math.round(100 * PRICE_REBASE),
    'the debt is the same currency and has to move with it');
  assert.equal(migrated.version, SCHEMA_VERSION);

  // A save with no version at all is an old one — the field was written from
  // the first commit but read by nothing, so a hand-edited copy may lack it.
  const noVersion = createInitialState();
  delete noVersion.version;
  noVersion.profile.stardust = 500;
  assert.equal(normalizeState(noVersion).profile.stardust, Math.round(500 * PRICE_REBASE));

  // And a save already on the new schema is left alone, however many times it
  // is loaded — this must not compound.
  let current = createInitialState();
  current.profile.stardust = 700;
  for (let i = 0; i < 5; i += 1) current = normalizeState(current);
  assert.equal(current.profile.stardust, 700, 'reloading five times must not inflate it');
});
