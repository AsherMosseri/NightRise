/* The envelope: one good thing that happens the moment you open the app,
 * before you have earned anything.
 *
 * Every other reward here is downstream of doing chores, which does nothing
 * for the failure mode the app actually loses to — the app being closed while
 * you scroll. This one pays for showing up, and it is the same shape every
 * night: sealed, one tap, something inside.
 */

import { hashString, seededRandom } from './util.js';
import { MOMENTUM_MIN_GAP_MS } from './game.js';
import { keyDiffDays, shiftKey } from './time.js';

export const DROPS = [
  {
    id: 'dust-small',
    weight: 30,
    label: 'A pinch of stardust',
    detail: (n) => `+${n} stardust`,
    apply: (state, rand) => {
      const amount = 12 + Math.floor(rand() * 18);
      state.profile.stardust += amount;
      return amount;
    },
  },
  {
    id: 'dust-big',
    weight: 8,
    label: 'A handful of stardust',
    detail: (n) => `+${n} stardust`,
    apply: (state, rand) => {
      const amount = 45 + Math.floor(rand() * 40);
      state.profile.stardust += amount;
      return amount;
    },
  },
  {
    id: 'raincheck',
    weight: 16,
    label: 'A rain check',
    detail: () => 'One task excused, whenever you need it',
    apply: (state) => {
      state.profile.tokens.raincheck += 1;
      return 1;
    },
  },
  {
    id: 'freeze',
    weight: 7,
    label: 'A streak freeze',
    detail: () => 'One missed night covered',
    apply: (state) => {
      state.profile.tokens.freeze += 1;
      return 1;
    },
  },
  {
    id: 'headstart',
    weight: 20,
    label: 'A head start',
    detail: () => 'Tonight begins at x1.5 momentum',
    apply: (state) => {
      // Stamped one momentum-window back, not at "now". `chainLengthFor` resets
      // the chain to 1 when two check-offs are less than MOMENTUM_MIN_GAP_MS
      // apart — so the natural flow, open the app, tap the envelope, tap the
      // first box, threw the whole prize away. And `combo` is 1.25 rather than
      // 1.5 because the chain the next completion earns is derived from it:
      // 1.25 yields chain 3, and comboMultiplier(3) is exactly the x1.5 the
      // label promises. Setting 1.5 here paid x1.75 on the next task.
      state.night.combo = Math.max(state.night.combo || 1, 1.25);
      state.night.lastDoneAt = Date.now() - MOMENTUM_MIN_GAP_MS;
      state.night.lastMinutes = 10;
      return 1.5;
    },
  },
  {
    id: 'quiet',
    weight: 19,
    label: 'Nothing but a good night',
    detail: () => 'Some envelopes are just an envelope',
    apply: () => 0,
  },
];

function pick(rand) {
  const total = DROPS.reduce((sum, d) => sum + d.weight, 0);
  let roll = rand() * total;
  for (const drop of DROPS) {
    roll -= drop.weight;
    if (roll <= 0) return drop;
  }
  return DROPS[DROPS.length - 1];
}

/**
 * What a night's envelope holds, without opening it.
 *
 * Pure in the key — same seed, same `pick` — so the goodnight screen can say
 * how rare tomorrow's is without touching state or claiming anything the roll
 * will not honour. It returns the band, never the prize: a named prize waiting
 * is an obligation, and this app is not a streak app.
 */
export function peekEnvelope(key) {
  const rand = seededRandom(hashString(`envelope:${key}`));
  const drop = pick(rand);
  return { id: drop.id, rare: drop.weight <= 8 };
}

export function dropById(id) {
  return DROPS.find((d) => d.id === id) || null;
}

/**
 * Open tonight's envelope. Seeded by the night key so a reload cannot reroll
 * it, and recorded so it can only ever pay out once.
 */
export function openEnvelope(state) {
  const waiting = pendingEnvelopes(state);
  if (!waiting.length) return null;
  const key = waiting[0];
  // The night key alone. `nightsLogged` increments in bankNight, so pressing
  // "Bank tonight and start fresh" — or resetting Night history — changed what
  // was inside an envelope you had not opened yet, which is exactly what the
  // docstring above promises cannot happen. `lastEnvelopeKey` is what enforces
  // one per date; the seed only has to be stable. It also has to be a pure
  // function of the key, so a night you were away for can still be recomputed.
  const rand = seededRandom(hashString(`envelope:${key}`));
  const drop = pick(rand);
  const amount = drop.apply(state, rand);
  if (key === state.night.key) state.night.envelope = { opened: Date.now(), id: drop.id, amount };
  state.profile.envelopesOpened = (state.profile.envelopesOpened || 0) + 1;
  // A high-water mark, so opening the oldest one first cannot leave a gap.
  state.profile.lastEnvelopeKey = key;
  return { drop, amount, key, remaining: pendingEnvelopes(state).length };
}

/** How many envelopes are on the mat, at most `MAT_MAX`. */
export const MAT_MAX = 3;

/**
 * The envelopes for the nights you were away, plus tonight's.
 *
 * A night you skipped used to vanish silently and forever, and the app greeted
 * a returning user with a red streak chip and a reset notice — which is exactly
 * the moment they close it and open a feed instead. Being away is now the
 * reason there is something to open.
 *
 * Capped at three, and paid from the same weight table as any other night: this
 * must not become a reason to stay away.
 */
export function pendingEnvelopes(state, now = new Date()) {
  const tonight = state.night.key;
  const openedTonight = Boolean(state.night.envelope?.opened);
  const last = state.profile.lastEnvelopeKey;
  if (!last) return openedTonight ? [] : [tonight];
  const gap = keyDiffDays(last, tonight);
  if (gap <= 0) return [];
  const keys = [];
  // Oldest first, so the high-water mark advances one night at a time.
  for (let back = Math.min(gap, MAT_MAX); back >= 1; back -= 1) {
    keys.push(shiftKey(tonight, -(back - 1)));
  }
  return openedTonight ? keys.filter((k) => k !== tonight) : keys;
}

export function envelopeWaiting(state) {
  return pendingEnvelopes(state).length > 0;
}
