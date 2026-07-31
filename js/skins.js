/* The five appearance categories that are pure data: what the sky stands on,
   what falls through it, which moon hangs in it, the mark you leave on a task,
   and the envelope you open every night.

   Data only — this module imports nothing, so every renderer can import it
   without a cycle. Each category's first entry is free and is exactly what the
   app looks like today, so a save that has never opened the market renders
   byte-for-byte as it always did.

   Everything here is drawn, never loaded: coordinates, colours and SVG path
   strings. No images, no fonts, no network. The app has to work offline on a
   phone in a dark room. */

export const THEMES = [
  { id: 'midnight', name: 'Midnight', cost: 0, desc: 'Deep blue, quiet, the default night.' },
  { id: 'aurora', name: 'Aurora', cost: 400, desc: 'Green and violet curtains over the horizon.' },
  { id: 'deepspace', name: 'Deep Space', cost: 700, reqLevel: 4, desc: 'Nebula purples, far from any city.' },
  { id: 'city', name: 'City Skyline', cost: 920, reqLevel: 6, desc: 'Amber windows under a hazy orange sky.' },
  { id: 'frost', name: 'Frost', cost: 1150, reqLevel: 8, desc: 'Pale ice blue and a very long winter night.' },
  { id: 'bloodmoon', name: 'Blood Moon', cost: 1550, reqLevel: 10, desc: 'Rust and ember. Rare, and a little ominous.' },
];

export const SOUND_PACKS = [
  { id: 'chime', name: 'Chime', cost: 0, desc: 'Soft glass bell on every check.' },
  { id: 'crickets', name: 'Crickets', cost: 260, desc: 'A short chirp from the garden.' },
  { id: 'windchime', name: 'Wind Chime', cost: 440, desc: 'Three notes on a breeze.' },
  { id: 'synth', name: 'Synth', cost: 570, desc: 'Warm analog blip, retro and satisfying.' },
];

export const TRAILS = [
  { id: 'none', name: 'No trail', cost: 0, desc: 'Just the cursor.' },
  { id: 'stardust', name: 'Stardust', cost: 330, desc: 'Fine glittering dust follows the pointer.' },
  { id: 'comet', name: 'Comet', cost: 530, desc: 'A short bright tail with a slow fade.' },
  { id: 'fireflies', name: 'Fireflies', cost: 660, desc: 'Little lights that drift after you.' },
];

export const FONTS = [
  // `sans`, not `aurora`. The Aurora *sky* is also `aurora`, and ids are global
  // in `itemById` — so tapping Equip on this card looked up the theme, and the
  // default typeface could never be equipped again once you left it. Renamed
  // rather than disambiguated alone, because two things in one market sharing a
  // name is a trap whatever the lookup does. Saves are migrated in storage.js.
  { id: 'sans', name: 'Aurora Sans', cost: 0, desc: 'The clean default.' },
  { id: 'mono', name: 'Terminal', cost: 260, desc: 'Monospaced, for the very online.' },
  { id: 'serif', name: 'Bedside', cost: 310, desc: 'A quiet book serif.' },
  { id: 'display', name: 'Neon', cost: 480, reqLevel: 5, desc: 'Wide letterforms with a glow.' },
];

/**
 * The silhouette along the bottom of the sky.
 *
 * `band` is the fraction of canvas height it occupies; `points` are the top edge
 * only, x ascending 0..1 across the canvas and y 0..1 up the band. js/sky.js
 * closes the shape to the bottom corners and fills it flat.
 */
export const HORIZONS = [
  {
    id: 'open',
    name: 'Open Sky',
    cost: 0,
    desc: 'Nothing in the way, all the way down.',
    band: 0,
    points: [[0, 0], [1, 0]],
  },
];

/**
 * One particle layer over the sky.
 *
 * Colours may be a hex string or 'accent' / 'star' / 'glow' to take the equipped
 * sky's own custom property, so weather belongs to whatever sky it falls on.
 */
export const WEATHER = [
  {
    id: 'clear',
    name: 'Clear',
    cost: 0,
    desc: 'A still night, which is most of them.',
    count: 0,
    shape: 'dot',
    vx: 0,
    vy: 0,
    size: 0,
    sizeJitter: 0,
    color: 'star',
    opacity: 0,
    wobble: 0,
    spawn: 'sky',
  },
];

/**
 * The moon, which fills with tonight's completion.
 *
 * 'theme' in a colour field means defer to the equipped sky, which is what keeps
 * the free default a true no-op rather than a lookalike that drifts the first
 * time a theme is retuned. Whatever a skin does, the lit fraction has to stay
 * legible from across a dark room — that is the whole mechanic.
 */
export const MOONS = [
  {
    id: 'classic',
    name: 'Classic',
    cost: 0,
    desc: 'The moon as it has always been here.',
    disc: 'theme',
    shadow: 'theme',
    glow: 'theme',
    craterAlpha: 0.08,
    craters: [[0.28, -0.3, 0.18], [-0.1, 0.24, 0.13], [0.42, 0.34, 0.1], [0.05, -0.05, 0.08]],
    ring: null,
  },
];

/**
 * The glyph that lands in the box when you check something off — the most-seen
 * graphic in the app. Stroked paths in a 24x24 box, exactly like js/dom.js
 * icons, with the same hand-measured optical bounds.
 */
export const MARKS = [
  {
    id: 'check',
    name: 'Tick',
    cost: 0,
    desc: 'A tick. Hard to improve on.',
    path: 'M4 12l6 6L20 6',
    box: [4, 6, 16, 12, 12.15, 12.76],
  },
];

/**
 * The nightly envelope. Four colours and an optional wax seal — the difference
 * between a manila office envelope and a sealed letter is construction, and
 * colour is what has to carry it.
 */
export const ENVELOPES = [
  {
    id: 'plain',
    name: 'Plain',
    cost: 0,
    desc: 'The envelope this app has always handed you.',
    paper: 'theme',
    ink: 'theme',
    flap: 'theme',
    seal: 'theme',
    sealPath: null,
  },
];

const BY_ID = (list) => (id) => list.find((entry) => entry.id === id) || list[0];

export const horizonById = BY_ID(HORIZONS);
export const weatherById = BY_ID(WEATHER);
export const moonById = BY_ID(MOONS);
export const markById = BY_ID(MARKS);
export const envelopeById = BY_ID(ENVELOPES);

/**
 * Marks, as an icon table js/dom.js can merge into its own.
 *
 * Keyed `mark:<id>` so a mark can never collide with an interface icon — the
 * market has already shipped one id collision across two categories and it cost
 * a user the ability to change their typeface back.
 */
export function markIcons() {
  const paths = {};
  const boxes = {};
  for (const mark of MARKS) {
    paths[`mark:${mark.id}`] = mark.path;
    boxes[`mark:${mark.id}`] = mark.box;
  }
  return { paths, boxes };
}
