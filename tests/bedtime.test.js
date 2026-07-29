/* The mechanics that exist to get you off the phone: the envelope that pays
   you for opening the app, the curfew that closes it, and lights out. */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createInitialState } from '../js/model.js';
import { openEnvelope, envelopeWaiting, DROPS, dropById } from '../js/envelope.js';
import { inCurfew, CURFEW_LEAD_MINUTES, minutesUntilBedtime } from '../js/time.js';
import { lightsOutReward } from '../js/render/goodnight.js';

test('the envelope is waiting the moment a night starts', () => {
  const state = createInitialState();
  assert.equal(envelopeWaiting(state), true);
});

test('an envelope pays out exactly once', () => {
  const state = createInitialState();
  const first = openEnvelope(state);
  assert.ok(first, 'the first open pays');
  assert.equal(envelopeWaiting(state), false);
  assert.equal(openEnvelope(state), null, 'the second does nothing');
});

test('the same night always holds the same envelope', () => {
  const a = createInitialState(new Date(2026, 6, 29, 22, 0));
  const b = createInitialState(new Date(2026, 6, 29, 22, 0));
  b.night.key = a.night.key;
  assert.equal(openEnvelope(a).drop.id, openEnvelope(b).drop.id);
});

test('envelopes vary across nights', () => {
  const ids = new Set();
  for (let day = 1; day <= 28; day += 1) {
    const state = createInitialState();
    state.night.key = `2026-07-${String(day).padStart(2, '0')}`;
    state.night.envelope = null;
    ids.add(openEnvelope(state).drop.id);
  }
  assert.ok(ids.size > 2, `a month should not hold one prize, got ${[...ids].join(', ')}`);
});

test('every drop is well formed and never leaves a negative balance', () => {
  for (const drop of DROPS) {
    const state = createInitialState();
    state.night.envelope = null;
    const result = openEnvelope({ ...state, night: { ...state.night, key: 'seed' } });
    assert.ok(result);
    assert.equal(typeof drop.label, 'string');
    assert.equal(typeof drop.detail(1), 'string');
    assert.equal(dropById(drop.id), drop);
  }
  const state = createInitialState();
  openEnvelope(state);
  assert.ok(state.profile.stardust >= 0);
  assert.ok(state.profile.tokens.raincheck >= 0);
  assert.ok(state.profile.tokens.freeze >= 0);
});

test('curfew closes the browsing panels in the half hour before bed', () => {
  const key = '2026-07-29';
  const wellBefore = new Date(2026, 6, 29, 21, 0); // 2.5h to go
  const justInside = new Date(2026, 6, 29, 23, 15); // 15m to go
  const past = new Date(2026, 6, 30, 0, 30); // an hour late

  assert.equal(inCurfew(key, '23:30', wellBefore), false);
  assert.equal(inCurfew(key, '23:30', justInside), true);
  assert.equal(inCurfew(key, '23:30', past), true, 'past bedtime is still curfew');
});

test('the curfew boundary is exactly the lead time', () => {
  const key = '2026-07-29';
  const bedtime = '23:30';
  const at = (h, m) => new Date(2026, 6, 29, h, m);
  const edge = at(23, 30 - CURFEW_LEAD_MINUTES);
  assert.equal(Math.round(minutesUntilBedtime(key, bedtime, edge)), CURFEW_LEAD_MINUTES);
  assert.equal(inCurfew(key, bedtime, edge), true);
  assert.equal(inCurfew(key, bedtime, at(22, 59)), false);
});

test('stopping earlier is worth more than stopping late', () => {
  const stats = { done: 8 };
  const early = lightsOutReward(60, stats);
  const nearly = lightsOutReward(5, stats);
  const late = lightsOutReward(-40, stats);
  assert.ok(early.xp > nearly.xp, 'an hour early beats five minutes early');
  assert.ok(nearly.xp > late.xp, 'on time beats late');
  assert.ok(late.xp > 0, 'but stopping late is still better than not stopping');
});

test('the early-bird reward is capped so it cannot be farmed by a silly bedtime', () => {
  const stats = { done: 3 };
  assert.equal(lightsOutReward(90, stats).xp, lightsOutReward(600, stats).xp);
});
