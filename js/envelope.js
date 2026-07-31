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

export function dropById(id) {
  return DROPS.find((d) => d.id === id) || null;
}

/**
 * Open tonight's envelope. Seeded by the night key so a reload cannot reroll
 * it, and recorded so it can only ever pay out once.
 */
export function openEnvelope(state) {
  if (!envelopeWaiting(state)) return null;
  const rand = seededRandom(hashString(`envelope:${state.night.key}:${state.profile.nightsLogged}`));
  const drop = pick(rand);
  const amount = drop.apply(state, rand);
  state.night.envelope = { opened: Date.now(), id: drop.id, amount };
  state.profile.envelopesOpened = (state.profile.envelopesOpened || 0) + 1;
  state.profile.lastEnvelopeKey = state.night.key;
  return { drop, amount };
}

export function envelopeWaiting(state) {
  if (state.night.envelope?.opened) return false;
  // One per date, not one per night object. "Bank tonight and start fresh"
  // hands back a clean night; it must not hand back the prize with it.
  return state.profile.lastEnvelopeKey !== state.night.key;
}
