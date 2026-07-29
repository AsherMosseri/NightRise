/* The endless Stardust sink: light stars one at a time, and a finished
   constellation is drawn into your real sky forever. */

/* Star coordinates are normalised 0..1 inside the constellation's own box. */
export const CONSTELLATIONS = [
  {
    id: 'ursa',
    name: 'Ursa Minor',
    lore: 'The little bear, and the pole star at its tail.',
    base: 14,
    stars: [[0.08, 0.72], [0.24, 0.62], [0.40, 0.55], [0.56, 0.44], [0.70, 0.30], [0.86, 0.34], [0.78, 0.52]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 3]],
  },
  {
    id: 'cassiopeia',
    name: 'Cassiopeia',
    lore: 'A crooked W, stubbornly upside down half the year.',
    base: 16,
    stars: [[0.05, 0.35], [0.28, 0.72], [0.5, 0.32], [0.72, 0.74], [0.95, 0.3]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4]],
  },
  {
    id: 'lyra',
    name: 'Lyra',
    lore: 'A small harp holding one very bright string.',
    base: 20,
    stars: [[0.5, 0.08], [0.3, 0.36], [0.68, 0.38], [0.34, 0.78], [0.66, 0.8]],
    lines: [[0, 1], [0, 2], [1, 3], [2, 4], [3, 4]],
  },
  {
    id: 'cygnus',
    name: 'Cygnus',
    lore: 'The swan, flying the length of the summer sky.',
    base: 24,
    stars: [[0.5, 0.05], [0.5, 0.36], [0.5, 0.66], [0.5, 0.95], [0.16, 0.5], [0.84, 0.5]],
    lines: [[0, 1], [1, 2], [2, 3], [4, 1], [1, 5]],
  },
  {
    id: 'orion',
    name: 'Orion',
    lore: 'The hunter. Three stars in a row, unmistakable.',
    base: 30,
    stars: [[0.2, 0.06], [0.78, 0.1], [0.36, 0.48], [0.5, 0.52], [0.64, 0.56], [0.16, 0.92], [0.82, 0.95]],
    lines: [[0, 2], [1, 4], [2, 3], [3, 4], [2, 5], [4, 6]],
  },
  {
    id: 'draco',
    name: 'Draco',
    lore: 'The dragon, coiled between the bears.',
    base: 38,
    stars: [[0.06, 0.9], [0.22, 0.7], [0.34, 0.46], [0.5, 0.3], [0.68, 0.22], [0.84, 0.32], [0.9, 0.55], [0.74, 0.66]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 4]],
  },
  {
    id: 'scorpius',
    name: 'Scorpius',
    lore: 'A hooked tail low on the horizon.',
    base: 46,
    stars: [[0.08, 0.16], [0.24, 0.26], [0.38, 0.42], [0.5, 0.6], [0.62, 0.76], [0.76, 0.84], [0.88, 0.74], [0.9, 0.55], [0.78, 0.46]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8]],
  },
];

export function constellationById(id) {
  return CONSTELLATIONS.find((c) => c.id === id) || null;
}

/** Each additional star in a constellation costs a little more. */
export function starCost(base, index) {
  return Math.round(base * (1 + index * 0.4));
}

export function progressFor(state, id) {
  const entry = state.profile.constellations[id];
  const def = constellationById(id);
  const lit = Math.min(def ? def.stars.length : 0, Math.max(0, entry?.lit || 0));
  return {
    def,
    lit,
    total: def ? def.stars.length : 0,
    complete: Boolean(entry?.complete) || (def && lit >= def.stars.length),
    nextCost: def && lit < def.stars.length ? starCost(def.base, lit) : null,
  };
}

export function totalRemainingCost(state, id) {
  const { def, lit } = progressFor(state, id);
  if (!def) return 0;
  let sum = 0;
  for (let i = lit; i < def.stars.length; i += 1) sum += starCost(def.base, i);
  return sum;
}

/** Buy the next star. Mutates state; returns null when it can't be bought. */
export function buyStar(state, id) {
  const info = progressFor(state, id);
  if (!info.def || info.complete || info.nextCost === null) return null;
  if (state.profile.stardust < info.nextCost) return null;
  state.profile.stardust -= info.nextCost;
  const entry = state.profile.constellations[id] || { lit: 0, complete: false };
  entry.lit = info.lit + 1;
  entry.complete = entry.lit >= info.def.stars.length;
  state.profile.constellations[id] = entry;
  return { spent: info.nextCost, lit: entry.lit, complete: entry.complete, def: info.def };
}

export function completedConstellations(state) {
  return CONSTELLATIONS.filter((c) => state.profile.constellations[c.id]?.complete);
}

export function collectionSummary(state) {
  const done = completedConstellations(state).length;
  const litStars = CONSTELLATIONS.reduce((sum, c) => sum + progressFor(state, c.id).lit, 0);
  const totalStars = CONSTELLATIONS.reduce((sum, c) => sum + c.stars.length, 0);
  return { done, total: CONSTELLATIONS.length, litStars, totalStars };
}
