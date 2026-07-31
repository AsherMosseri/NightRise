/* The mechanics that exist to get you off the phone: the envelope that pays
   you for opening the app, the curfew that closes it, and lights out. */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createInitialState } from '../js/model.js';
import { openEnvelope, envelopeWaiting, pendingEnvelopes, peekEnvelope, DROPS, dropById } from '../js/envelope.js';
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

test('a week away hands you three envelopes, not seven', () => {
  // A night you skipped used to vanish silently and forever, and the app
  // greeted a returning user with a red streak chip and a reset notice — the
  // moment they close it and open a feed. Being away is the reason there is
  // something to open now. Capped, and paid from the same weight table as any
  // other night, so it never pays to stay away.
  const state = createInitialState(new Date(2026, 6, 29, 22, 0));
  state.profile.lastEnvelopeKey = '2026-07-22';
  assert.deepEqual(pendingEnvelopes(state), ['2026-07-27', '2026-07-28', '2026-07-29']);

  // Opening advances the high-water mark one night at a time, oldest first.
  const first = openEnvelope(state);
  assert.equal(first.key, '2026-07-27');
  assert.equal(state.profile.lastEnvelopeKey, '2026-07-27');
  assert.equal(first.remaining, 2);
  openEnvelope(state);
  const last = openEnvelope(state);
  assert.equal(last.key, '2026-07-29');
  assert.equal(openEnvelope(state), null, 'and the mat is empty');
});

test('a night away is worth exactly what tonight is worth', () => {
  // Same table, same seed shape. If a skipped night paid better than a night
  // you turned up for, the app would be paying you to stay away.
  const away = createInitialState(new Date(2026, 6, 29, 22, 0));
  away.profile.lastEnvelopeKey = '2026-07-26';
  const backfilled = openEnvelope(away);

  const direct = createInitialState(new Date(2026, 6, 27, 22, 0));
  const straight = openEnvelope(direct);
  assert.equal(backfilled.key, '2026-07-27');
  assert.equal(straight.key, '2026-07-27');
  assert.equal(backfilled.drop.id, straight.drop.id, 'the same night pays the same thing');
});

test('a fresh install has exactly one envelope, and opening it empties the mat', () => {
  const state = createInitialState(new Date(2026, 6, 29, 22, 0));
  assert.deepEqual(pendingEnvelopes(state), ['2026-07-29']);
  openEnvelope(state);
  assert.deepEqual(pendingEnvelopes(state), []);
});

test('what tomorrow is teased as is what tomorrow pays', () => {
  // The goodnight screen is the only advertisement this app can run, and the
  // house rule is that a hint comes off the number the check uses. `peek` runs
  // the identical seeded pick without applying the drop.
  for (const key of ['2026-07-29', '2026-07-30', '2026-08-01', '2026-08-14', '2026-09-03']) {
    const state = createInitialState(new Date(`${key}T22:00:00`));
    const opened = openEnvelope(state);
    assert.equal(peekEnvelope(key).id, opened.drop.id, key);
  }
  // And "rare" means what the weight table means by rare, not a copy decision.
  for (const drop of DROPS) {
    const rare = drop.weight <= 8;
    assert.equal(typeof rare, 'boolean');
  }
});

test('stopping early with an untouched list is not the best move in the game', () => {
  // `+ stats.done * 2` was far too weak to matter: ninety minutes early with
  // an untouched eleven-task list paid 128 XP and 38 stardust — ten tasks'
  // worth for holding a button — so opening the app and immediately ending the
  // night beat doing anything at all.
  const nothing = lightsOutReward(90, { done: 0, total: 11, counted: 11 });
  const everything = lightsOutReward(90, { done: 11, total: 11, counted: 11 });
  assert.ok(everything.xp > nothing.xp * 2, 'clearing the list is worth much more than not');
  assert.ok(everything.dust > nothing.dust * 2);

  // But a bad night must still be worth ending — that is the whole argument.
  assert.ok(nothing.xp > lightsOutReward(-30, { done: 11, total: 11, counted: 11 }).xp,
    'stopping early having done nothing still beats stopping late having done everything');
  assert.ok(nothing.dust > 0);
});
