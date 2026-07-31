/* The long Stardust sink: light stars one at a time, and a finished
   constellation is drawn into your real sky forever.

   Two tiers. The figure's own stars are the ones people draw — finish them and
   the shape joins your sky. Past that are its FAINT stars: further real stars of
   that constellation, the ones a keen eye or a small telescope would pick up.
   They are bought on the same escalating ladder, they are drawn dimmer and
   unjoined, and they are what keeps the map worth opening once the shapes are
   collected.

   Not "endless" — that word was here before and it was not true of forty-seven
   stars. It is finite and it is long: the whole map, both tiers, is on the order
   of a year of nightly play at the current earning rate. Deliberately no
   procedurally-generated constellations: a random scatter of points joined by
   random lines reads as noise, and an invented name beside Cassiopeia reads as
   the real content having run out. */

/* Star coordinates are normalised 0..1 inside the constellation's own box. */
export const CONSTELLATIONS = [
  {
    id: 'ursa',
    name: 'Ursa Minor',
    lore: 'The little bear, and the pole star at its tail.',
    base: 14,
    stars: [[0.08, 0.72], [0.24, 0.62], [0.40, 0.55], [0.56, 0.44], [0.70, 0.30], [0.86, 0.34], [0.78, 0.52]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 3]],
    // θ, λ, 4, 5, π1, π2 UMi and the faint bowl members
    faint: [[0.16, 0.78], [0.32, 0.7], [0.48, 0.48], [0.62, 0.36], [0.64, 0.22], [0.88, 0.22], [0.94, 0.44], [0.7, 0.6], [0.56, 0.62], [0.34, 0.5]],
  },
  {
    id: 'cassiopeia',
    name: 'Cassiopeia',
    lore: 'A crooked W, stubbornly upside down half the year.',
    base: 16,
    stars: [[0.05, 0.35], [0.28, 0.72], [0.5, 0.32], [0.72, 0.74], [0.95, 0.3]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4]],
    // η, ζ, κ, ι, θ, ρ, σ, ψ, ο Cas
    faint: [[0.14, 0.48], [0.2, 0.26], [0.38, 0.56], [0.42, 0.22], [0.6, 0.5], [0.62, 0.2], [0.82, 0.58], [0.86, 0.2], [0.96, 0.46], [0.06, 0.62]],
  },
  {
    id: 'lyra',
    name: 'Lyra',
    lore: 'A small harp holding one very bright string.',
    base: 20,
    stars: [[0.5, 0.08], [0.3, 0.36], [0.68, 0.38], [0.34, 0.78], [0.66, 0.8]],
    lines: [[0, 1], [0, 2], [1, 3], [2, 4], [3, 4]],
    // ε (the double-double), η, θ, ι, κ, λ, μ Lyr and the Ring between β and γ
    faint: [[0.6, 0.14], [0.38, 0.18], [0.2, 0.3], [0.44, 0.5], [0.56, 0.52], [0.22, 0.62], [0.78, 0.6], [0.5, 0.66], [0.3, 0.9], [0.72, 0.92], [0.86, 0.28], [0.14, 0.48]],
  },
  {
    id: 'cygnus',
    name: 'Cygnus',
    lore: 'The swan, flying the length of the summer sky.',
    base: 24,
    stars: [[0.5, 0.05], [0.5, 0.36], [0.5, 0.66], [0.5, 0.95], [0.16, 0.5], [0.84, 0.5]],
    lines: [[0, 1], [1, 2], [2, 3], [4, 1], [1, 5]],
    // ζ, τ, ν, ξ, ι, κ, η, χ, 61 Cyg and ο1/ο2
    faint: [[0.34, 0.2], [0.66, 0.22], [0.28, 0.4], [0.72, 0.42], [0.36, 0.6], [0.64, 0.62], [0.3, 0.8], [0.7, 0.82], [0.06, 0.34], [0.94, 0.36], [0.08, 0.66], [0.92, 0.66]],
  },
  {
    id: 'orion',
    name: 'Orion',
    lore: 'The hunter. Three stars in a row, unmistakable.',
    base: 30,
    stars: [[0.2, 0.06], [0.78, 0.1], [0.36, 0.48], [0.5, 0.52], [0.64, 0.56], [0.16, 0.92], [0.82, 0.95]],
    lines: [[0, 2], [1, 4], [2, 3], [3, 4], [2, 5], [4, 6]],
    // θ (the Trapezium), ι, σ, the sword, the π1–π6 shield and the club
    faint: [[0.46, 0.56], [0.5, 0.62], [0.54, 0.58], [0.42, 0.68], [0.14, 0.16], [0.1, 0.3], [0.08, 0.44], [0.1, 0.58], [0.14, 0.7], [0.86, 0.14], [0.9, 0.3], [0.88, 0.6], [0.62, 0.24], [0.3, 0.86]],
  },
  {
    id: 'draco',
    name: 'Draco',
    lore: 'The dragon, coiled between the bears.',
    base: 38,
    stars: [[0.06, 0.9], [0.22, 0.7], [0.34, 0.46], [0.5, 0.3], [0.68, 0.22], [0.84, 0.32], [0.9, 0.55], [0.74, 0.66]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 4]],
    // ν1/ν2 (the double), κ, λ, θ, η, ζ, ι, φ, χ, ψ, ω Dra
    faint: [[0.12, 0.24], [0.22, 0.42], [0.34, 0.2], [0.44, 0.38], [0.54, 0.18], [0.64, 0.4], [0.74, 0.22], [0.84, 0.44], [0.92, 0.26], [0.28, 0.62], [0.5, 0.66], [0.7, 0.64], [0.16, 0.8], [0.88, 0.78]],
  },
  {
    id: 'scorpius',
    name: 'Scorpius',
    lore: 'A hooked tail low on the horizon.',
    base: 46,
    stars: [[0.08, 0.16], [0.24, 0.26], [0.38, 0.42], [0.5, 0.6], [0.62, 0.76], [0.76, 0.84], [0.88, 0.74], [0.9, 0.55], [0.78, 0.46]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8]],
    // ω1/ω2, ρ, ν, μ1/μ2, ζ1/ζ2, η, θ, ι, κ, υ Sco
    faint: [[0.16, 0.14], [0.2, 0.36], [0.1, 0.3], [0.3, 0.12], [0.34, 0.4], [0.44, 0.3], [0.52, 0.48], [0.62, 0.4], [0.7, 0.58], [0.8, 0.52], [0.86, 0.7], [0.74, 0.78], [0.58, 0.72], [0.42, 0.62]],
  },
];

export function constellationById(id) {
  return CONSTELLATIONS.find((c) => c.id === id) || null;
}

/** Each additional star in a constellation costs a little more. */
export function starCost(base, index) {
  return Math.round(base * (1 + index * 0.4));
}

/**
 * Where a constellation stands, bright stars and faint ones.
 *
 * `complete` means exactly what it has always meant — every star of the drawn
 * figure is lit — and deliberately nothing more. The `constellation`
 * achievement family and the live sky both key off it, so letting depth move it
 * would silently retune a ladder and change which shapes are drawn. Depth sits
 * beyond completion and is counted separately.
 */
export function progressFor(state, id) {
  const entry = state.profile.constellations[id];
  const def = constellationById(id);
  const bright = def ? def.stars.length : 0;
  const faintTotal = def?.faint?.length || 0;
  const lit = Math.min(bright, Math.max(0, entry?.lit || 0));
  const complete = Boolean(entry?.complete) || (def && lit >= bright);
  // Depth is only meaningful once the figure is finished; a save claiming it
  // early is clamped rather than trusted.
  const deep = complete ? Math.min(faintTotal, Math.max(0, entry?.deep || 0)) : 0;
  return {
    def,
    lit,
    total: bright,
    complete,
    deep,
    deepTotal: faintTotal,
    deepDone: Boolean(complete && faintTotal > 0 && deep >= faintTotal),
    // One ladder, continuing past the figure: the nth star of a constellation
    // costs the same whether it is one of the drawn ones or one of the faint
    // ones after them, so there is no cliff at the join and no second rule.
    nextCost: def && lit < bright
      ? starCost(def.base, lit)
      : (complete && deep < faintTotal ? starCost(def.base, bright + deep) : null),
  };
}

export function totalRemainingCost(state, id) {
  const { def, lit } = progressFor(state, id);
  if (!def) return 0;
  let sum = 0;
  for (let i = lit; i < def.stars.length; i += 1) sum += starCost(def.base, i);
  return sum;
}

/**
 * Buy the next star — one of the figure's own, or, once the figure is done, one
 * of its fainter real stars. One button, one ladder, no cliff at the join.
 *
 * `complete` flips exactly once, on the last star of the drawn figure, so the
 * completion celebration still fires at the moment it always did.
 */
export function buyStar(state, id) {
  const info = progressFor(state, id);
  if (!info.def || info.nextCost === null) return null;
  if (state.profile.stardust < info.nextCost) return null;
  state.profile.stardust -= info.nextCost;
  const entry = state.profile.constellations[id] || { lit: 0, complete: false, deep: 0 };
  const wasComplete = info.complete;
  if (!wasComplete) {
    entry.lit = info.lit + 1;
    entry.complete = entry.lit >= info.def.stars.length;
  } else {
    entry.deep = info.deep + 1;
  }
  state.profile.constellations[id] = entry;
  return {
    spent: info.nextCost,
    lit: entry.lit,
    deep: entry.deep || 0,
    // Only the star that finished the figure reports completion, so nothing
    // downstream can celebrate the same constellation twice.
    complete: Boolean(entry.complete) && !wasComplete,
    deepStar: wasComplete,
    def: info.def,
  };
}

export function completedConstellations(state) {
  return CONSTELLATIONS.filter((c) => state.profile.constellations[c.id]?.complete);
}

export function collectionSummary(state) {
  const done = completedConstellations(state).length;
  let litStars = 0;
  let totalStars = 0;
  let deepStars = 0;
  let deepTotal = 0;
  for (const c of CONSTELLATIONS) {
    const p = progressFor(state, c.id);
    litStars += p.lit;
    totalStars += p.total;
    deepStars += p.deep;
    deepTotal += p.deepTotal;
  }
  return { done, total: CONSTELLATIONS.length, litStars, totalStars, deepStars, deepTotal };
}
