/* The long Stardust sink: light stars one at a time, and a finished
   constellation is drawn into your real sky forever.

   Two tiers. The figure's own stars are the ones people draw — finish them and
   the shape joins your sky. Past that are its FAINT stars: further real stars of
   that constellation, the ones a keen eye or a small telescope would pick up.
   They are bought on the same escalating ladder, they are drawn dimmer and
   unjoined, and they are what keeps the map worth opening once the shapes are
   collected.

   Not "endless" — that word was here before and it was not true of forty-seven
   stars. It is finite and it is long: 152 bright stars and 229 faint ones,
   111,033 stardust, which simulates at night 713 of solid play at the current
   earning rate. When the last faint star of a figure is lit its button goes
   quiet rather than inventing more. Deliberately no
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
    base: 17,
    stars: [[0.05, 0.35], [0.28, 0.72], [0.5, 0.32], [0.72, 0.74], [0.95, 0.3]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4]],
    // η, ζ, κ, ι, θ, ρ, σ, ψ, ο Cas
    faint: [[0.14, 0.48], [0.2, 0.26], [0.38, 0.56], [0.42, 0.22], [0.6, 0.5], [0.62, 0.2], [0.82, 0.58], [0.86, 0.2], [0.96, 0.46], [0.06, 0.62]],
  },
  {
    id: 'delphinus',
    name: 'Delphinus',
    lore: 'A small tidy diamond with a tail, which people insist on calling Job’s Coffin.',
    base: 20,
    stars: [[0.39, 0.08], [0.31, 0.28], [0.65, 0.05], [0.54, 0.21], [0.15, 0.78]],
    lines: [[0, 2], [2, 3], [3, 1], [1, 0], [1, 4]],
    // Bright: α Sualocin, β Rotanev, γ Del, δ Del (the Job’s Coffin rhombus) with ε Deneb Dulfim as the tail.
    faint: [[0.23, 0.27], [0.18, 0.52], [0.36, 0.48], [0.31, 0.77], [0.37, 0.96], [0.05, 0.84], [0.75, 0.05], [0.76, 0.59], [0.97, 0.59], [0.97, 0.41]],
  },
  {
    id: 'corona',
    name: 'Corona Borealis',
    lore: 'Half a circle of quiet stars, which is as much crown as anyone needs.',
    base: 24,
    stars: [[0.74, 0.52], [0.86, 0.7], [0.69, 0.89], [0.5, 0.92], [0.33, 0.94], [0.13, 0.88], [0.04, 0.64]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6]],
    // Bright, in array order along the arc from its north end, curling west and then east: theta (15h32.
    faint: [[0.47, 0.46], [0.23, 0.7], [0.35, 0.78], [0.09, 0.95], [0.05, 0.37], [0.97, 0.61], [0.29, 0.18], [0.58, 0.11]],
  },
  {
    id: 'lyra',
    name: 'Lyra',
    lore: 'A small harp holding one very bright string.',
    base: 28,
    stars: [[0.5, 0.08], [0.3, 0.36], [0.68, 0.38], [0.34, 0.78], [0.66, 0.8]],
    lines: [[0, 1], [0, 2], [1, 3], [2, 4], [3, 4]],
    // ε (the double-double), η, θ, ι, κ, λ, μ Lyr and the Ring between β and γ
    faint: [[0.6, 0.14], [0.38, 0.18], [0.2, 0.3], [0.44, 0.5], [0.56, 0.52], [0.22, 0.62], [0.78, 0.6], [0.5, 0.66], [0.3, 0.9], [0.72, 0.92], [0.86, 0.28], [0.14, 0.48]],
  },
  {
    id: 'cygnus',
    name: 'Cygnus',
    lore: 'The swan, flying the length of the summer sky.',
    base: 32,
    stars: [[0.5, 0.05], [0.5, 0.36], [0.5, 0.66], [0.5, 0.95], [0.16, 0.5], [0.84, 0.5]],
    lines: [[0, 1], [1, 2], [2, 3], [4, 1], [1, 5]],
    // ζ, τ, ν, ξ, ι, κ, η, χ, 61 Cyg and ο1/ο2
    faint: [[0.34, 0.2], [0.66, 0.22], [0.28, 0.4], [0.72, 0.42], [0.36, 0.6], [0.64, 0.62], [0.3, 0.8], [0.7, 0.82], [0.06, 0.34], [0.94, 0.36], [0.08, 0.66], [0.92, 0.66]],
  },
  {
    id: 'canismajor',
    name: 'Canis Major',
    lore: 'The big dog, rather outshone by the star on its collar.',
    base: 37,
    stars: [[0.4, 0.11], [0.07, 0.19], [0.67, 0.04], [0.66, 0.57], [0.74, 0.73], [0.97, 0.92], [0.59, 0.89], [0.03, 0.96]],
    lines: [[0, 1], [0, 2], [0, 3], [3, 4], [4, 5], [4, 6], [6, 7], [7, 1]],
    // Bright: α Sirius, β Mirzam, γ Muliphein, ο2 CMa, δ Wezen, η Aludra, ε Adhara, ζ Furud.
    faint: [[0.27, 0.27], [0.29, 0.21], [0.2, 0.54], [0.25, 0.51], [0.41, 0.37], [0.55, 0.33], [0.56, 0.13], [0.53, 0.59], [0.64, 0.83], [0.83, 0.75], [0.89, 0.64], [0.88, 0.04], [0.86, 0.53]],
  },
  {
    id: 'auriga',
    name: 'Auriga',
    lore: 'The charioteer’s pentagon, with Capella parked at one corner.',
    base: 42,
    stars: [[0.67, 0.05], [0.06, 0.1], [0.05, 0.51], [0.53, 0.95], [0.95, 0.71], [0.88, 0.16], [0.87, 0.31], [0.81, 0.3]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0], [0, 5], [5, 6], [6, 7], [7, 5]],
    // Bright, in order: alpha (Capella), beta (Menkalinan), theta, beta Tau (Elnath, the shared corner), iota (Hassaleh), epsilon, zeta, eta.
    faint: [[0.63, 0.36], [0.17, 0.4], [0.17, 0.5], [0.44, 0.76], [0.71, 0.44], [0.55, 0.5], [0.92, 0.47], [0.69, 0.74], [0.51, 0.65], [0.59, 0.27]],
  },
  {
    id: 'orion',
    name: 'Orion',
    lore: 'The hunter. Three stars in a row, unmistakable.',
    base: 47,
    stars: [[0.2, 0.06], [0.78, 0.1], [0.36, 0.48], [0.5, 0.52], [0.64, 0.56], [0.16, 0.92], [0.82, 0.95]],
    lines: [[0, 2], [1, 4], [2, 3], [3, 4], [2, 5], [4, 6]],
    // θ (the Trapezium), ι, σ, the sword, the π1–π6 shield and the club
    faint: [[0.46, 0.56], [0.5, 0.62], [0.54, 0.58], [0.42, 0.68], [0.14, 0.16], [0.1, 0.3], [0.08, 0.44], [0.1, 0.58], [0.14, 0.7], [0.86, 0.14], [0.9, 0.3], [0.88, 0.6], [0.62, 0.24], [0.3, 0.86]],
  },
  {
    id: 'pegasus',
    name: 'Pegasus',
    lore: 'A great empty square, with a horse’s neck trailing off one corner.',
    base: 52,
    stars: [[0.54, 0.58], [0.53, 0.25], [0.93, 0.22], [0.96, 0.59], [0.39, 0.7], [0.2, 0.82], [0.04, 0.73], [0.4, 0.19]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 0], [0, 4], [4, 5], [5, 6], [1, 7]],
    // Bright: α Markab, β Scheat, α And Alpheratz, γ Algenib (the Great Square), then ζ Homam, θ Baham, ε Enif down the neck to the nose, and η Matar on the.
    faint: [[0.05, 0.31], [0.18, 0.32], [0.2, 0.11], [0.16, 0.87], [0.43, 0.37], [0.46, 0.33], [0.43, 0.66], [0.46, 0.73], [0.49, 0.44], [0.55, 0.32], [0.64, 0.36], [0.69, 0.4], [0.83, 0.48], [0.88, 0.33], [0.96, 0.45]],
  },
  {
    id: 'taurus',
    name: 'Taurus',
    lore: 'A V for the face, with Aldebaran sitting in it like an orange eye.',
    base: 58,
    stars: [[0.87, 0.22], [0.95, 0.45], [0.52, 0.59], [0.47, 0.51], [0.44, 0.56], [0.41, 0.62], [0.47, 0.61], [0.28, 0.72], [0.05, 0.8]],
    lines: [[0, 3], [1, 2], [2, 6], [6, 5], [5, 4], [4, 3], [5, 7], [7, 8]],
    // Bright, in order: Elnath (beta), zeta, Aldebaran (alpha), Ain (epsilon), delta, Hyadum I (gamma), theta, lambda, xi.
    faint: [[0.08, 0.7], [0.19, 0.36], [0.3, 0.92], [0.31, 0.42], [0.32, 0.5], [0.38, 0.83], [0.45, 0.41], [0.52, 0.79], [0.54, 0.66], [0.54, 0.72], [0.57, 0.39], [0.71, 0.44], [0.91, 0.53]],
  },
  {
    id: 'leo',
    name: 'Leo',
    lore: 'A question mark for the head, then a neat triangle for the tail.',
    base: 64,
    stars: [[0.21, 0.76], [0.95, 0.66], [0.3, 0.47], [0.69, 0.44], [0.05, 0.32], [0.27, 0.34], [0.21, 0.58], [0.69, 0.63], [0.1, 0.24]],
    lines: [[4, 8], [8, 5], [5, 2], [2, 6], [6, 0], [0, 7], [7, 1], [1, 3], [3, 7], [2, 3]],
    // Bright, in order: Regulus (alpha), Denebola (beta), Algieba (gamma), Zosma (delta), Ras Elased Australis (epsilon), Adhafera (zeta), eta, Chertan (the.
    faint: [[0.05, 0.79], [0.14, 0.74], [0.15, 0.91], [0.22, 0.84], [0.39, 0.86], [0.56, 0.29], [0.61, 0.46], [0.63, 0.93], [0.7, 0.35], [0.74, 0.96], [0.77, 0.81], [0.94, 0.45]],
  },
  {
    id: 'bootes',
    name: 'Boötes',
    lore: 'The herdsman, though everyone sees a kite with Arcturus at the tail.',
    base: 70,
    stars: [[0.33, 0.89], [0.59, 0.57], [0.85, 0.32], [0.73, 0.04], [0.47, 0.12], [0.47, 0.44], [0.15, 0.92]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0], [0, 6]],
    // Bright, in array order: alpha Arcturus (14h15.
    faint: [[0.5, 0.48], [0.75, 0.58], [0.62, 0.65], [0.64, 0.89], [0.93, 0.16], [0.29, 0.65], [0.78, 0.66], [0.09, 0.96], [0.59, 0.96]],
  },
  {
    id: 'gemini',
    name: 'Gemini',
    lore: 'Twins side by side, one head noticeably brighter than the other.',
    base: 76,
    stars: [[0.16, 0.06], [0.05, 0.24], [0.39, 0.14], [0.66, 0.37], [0.87, 0.49], [0.95, 0.49], [0.3, 0.52], [0.46, 0.58], [0.72, 0.78], [0.65, 0.94]],
    lines: [[0, 2], [2, 3], [3, 4], [4, 5], [0, 1], [1, 6], [6, 7], [7, 8], [6, 9]],
    // Bright, in order: Castor (alpha), Pollux (beta), tau, Mebsuta (epsilon), Tejat (mu), Propus (eta), Wasat (delta), Mekbuda (zeta), Alhena (gamma), Alzi.
    faint: [[0.81, 0.6], [0.75, 0.41], [0.55, 0.93], [0.5, 0.79], [0.32, 0.77], [0.25, 0.25], [0.22, 0.07], [0.15, 0.8], [0.14, 0.29], [0.12, 0.72], [0.08, 0.19], [0.06, 0.41], [0.04, 0.68]],
  },
  {
    id: 'andromeda',
    name: 'Andromeda',
    lore: 'Two chains of stars, with the next galaxy along just past the shorter one.',
    base: 82,
    stars: [[0.95, 0.95], [0.71, 0.87], [0.47, 0.65], [0.05, 0.34], [0.73, 0.74], [0.57, 0.52], [0.63, 0.4], [0.25, 0.05]],
    lines: [[0, 1], [1, 2], [2, 3], [1, 4], [2, 5], [5, 6], [3, 7]],
    // Bright, in order: alpha (Alpheratz), delta, beta (Mirach), gamma (Almach), pi, mu, nu, 51 And.
    faint: [[0.47, 0.11], [0.37, 0.19], [0.24, 0.25], [0.26, 0.38], [0.21, 0.44], [0.11, 0.57], [0.72, 0.94], [0.88, 0.51], [0.87, 0.6]],
  },
  {
    id: 'draco',
    name: 'Draco',
    lore: 'The dragon, coiled between the bears.',
    base: 88,
    stars: [[0.06, 0.9], [0.22, 0.7], [0.34, 0.46], [0.5, 0.3], [0.68, 0.22], [0.84, 0.32], [0.9, 0.55], [0.74, 0.66]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 4]],
    // ν1/ν2 (the double), κ, λ, θ, η, ζ, ι, φ, χ, ψ, ω Dra
    faint: [[0.12, 0.24], [0.22, 0.42], [0.34, 0.2], [0.44, 0.38], [0.54, 0.18], [0.64, 0.4], [0.74, 0.22], [0.84, 0.44], [0.92, 0.26], [0.28, 0.62], [0.5, 0.66], [0.7, 0.64], [0.16, 0.8], [0.88, 0.78]],
  },
  {
    id: 'aquila',
    name: 'Aquila',
    lore: 'The eagle, holding the low corner of the summer triangle.',
    base: 94,
    stars: [[0.32, 0.32], [0.37, 0.24], [0.27, 0.44], [0.85, 0.09], [0.92, 0.03], [0.62, 0.59], [0.84, 0.97], [0.3, 0.69], [0.08, 0.78]],
    lines: [[1, 0], [0, 2], [5, 3], [3, 4], [5, 7], [7, 8], [0, 5], [5, 6]],
    // Bright, in array order: alpha Altair (19h50.
    faint: [[0.49, 0.8], [0.52, 0.39], [0.6, 0.72], [0.28, 0.34], [0.32, 0.25], [0.35, 0.18], [0.66, 0.03], [0.46, 0.49], [0.17, 0.4]],
  },
  {
    id: 'sagittarius',
    name: 'Sagittarius',
    lore: 'The archer, which everyone sees as a teapot instead.',
    base: 100,
    stars: [[0.9, 0.53], [0.7, 0.5], [0.66, 0.77], [0.61, 0.23], [0.38, 0.33], [0.25, 0.29], [0.1, 0.37], [0.16, 0.5]],
    lines: [[0, 1], [0, 2], [1, 3], [3, 4], [1, 4], [4, 5], [5, 6], [6, 7], [7, 2], [4, 7]],
    // Bright: the Teapot — γ2 Nash (spout tip), δ Kaus Media, ε Kaus Australis, λ Kaus Borealis (lid), φ Sgr, σ Nunki, τ Sgr, ζ Ascella.
    faint: [[0.95, 0.09], [0.93, 0.17], [0.79, 0.04], [0.75, 0.91], [0.66, 0.2], [0.5, 0.14], [0.56, 0.65], [0.41, 0.64], [0.26, 0.08], [0.25, 0.53], [0.22, 0.04], [0.12, 0.09]],
  },
  {
    id: 'perseus',
    name: 'Perseus',
    lore: 'A hero mid-stride, holding a head that blinks every three days.',
    base: 106,
    stars: [[0.79, 0.05], [0.67, 0.14], [0.51, 0.28], [0.34, 0.35], [0.21, 0.65], [0.25, 0.95], [0.21, 0.8], [0.64, 0.61], [0.68, 0.72]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 6], [6, 5], [2, 7], [7, 8]],
    // Bright, in order: eta (Miram), gamma, alpha (Mirfak), delta, epsilon, zeta, xi (Menkib), beta (Algol), rho.
    faint: [[0.32, 0.55], [0.63, 0.46], [0.64, 0.29], [0.77, 0.17], [0.45, 0.35], [0.4, 0.34], [0.72, 0.66], [0.79, 0.71], [0.33, 0.94], [0.35, 0.87]],
  },
  {
    id: 'scorpius',
    name: 'Scorpius',
    lore: 'A hooked tail low on the horizon.',
    base: 112,
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
/** A star costs one night you actually went to bed on time, as well as the dust. */
export const STARLIGHT_PER_STAR = 1;

export function buyStar(state, id) {
  const info = progressFor(state, id);
  if (!info.def || info.nextCost === null) return null;
  if (state.profile.stardust < info.nextCost) return null;
  // The market runs on work; the sky runs on sleep. 152 stars is 152 on-time
  // nights, which is the point: this is the one thing in the app that no amount
  // of checking things off at 1am can buy.
  if ((state.profile.starlight || 0) < STARLIGHT_PER_STAR) return null;
  state.profile.starlight -= STARLIGHT_PER_STAR;
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
