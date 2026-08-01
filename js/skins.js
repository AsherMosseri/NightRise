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

/**
 * Typefaces. `stack` is the same list `css/base.css` sets for the equipped font,
 * carried here so the card's preview can render in the face you are actually
 * buying rather than relying on a matching CSS rule.
 *
 * It used to rely on one: `.swatch--font.swatch--aurora`. Renaming this id to
 * `sans` — to stop it colliding with the Aurora *sky* — orphaned that rule
 * silently, and the default typeface's card began previewing in whatever face
 * happened to be equipped. Data the renderer reads cannot come unstuck from the
 * item it describes; a class name matched by convention can.
 */
export const FONTS = [
  {
    id: 'sans',
    name: 'Aurora Sans',
    cost: 0,
    desc: 'The clean default.',
    stack: 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  },
  {
    id: 'mono',
    name: 'Terminal',
    cost: 260,
    desc: 'Monospaced, for the very online.',
    stack: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
  },
  {
    id: 'serif',
    name: 'Bedside',
    cost: 310,
    desc: 'A quiet book serif.',
    stack: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif',
  },
  {
    id: 'display',
    name: 'Neon',
    cost: 480,
    reqLevel: 5,
    desc: 'Wide letterforms with a glow.',
    stack: '"Avenir Next", Futura, "Trebuchet MS", system-ui, sans-serif',
    glow: true,
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
  {
    id: 'rain',
    name: 'Rainfall',
    cost: 430,
    desc: 'Steady on the window, the kind you fall asleep to.',
    count: 64,
    shape: 'streak',
    vx: -0.18,
    vy: 1.15,
    size: 11,
    sizeJitter: 7,
    color: 'glow',
    opacity: 0.34,
    wobble: 0,
    spawn: 'top',
  },
  {
    id: 'snow',
    name: 'Snowfall',
    cost: 610,
    desc: 'Slow flakes that take all night to settle.',
    count: 70,
    shape: 'dot',
    vx: 0.08,
    vy: 0.35,
    size: 1.3,
    sizeJitter: 1.4,
    color: 'star',
    opacity: 0.45,
    wobble: 0.9,
    spawn: 'top',
  },
  {
    id: 'meteors',
    name: 'Meteor Shower',
    cost: 980,
    desc: 'Faint streaks high up, gone before you can point at them.',
    count: 6,
    shape: 'streak',
    vx: -0.7,
    vy: 0.95,
    size: 42,
    sizeJitter: 26,
    color: 'star',
    opacity: 0.5,
    wobble: 0,
    spawn: 'upper',
  },
  {
    id: 'northern',
    name: 'Northern Lights',
    cost: 1420,
    desc: 'Slow curtains of light that only move when you look away.',
    count: 4,
    shape: 'band',
    vx: 0.14,
    vy: 0.015,
    size: 90,
    sizeJitter: 55,
    color: 'accent',
    opacity: 0.16,
    wobble: 0.65,
    spawn: 'upper',
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
  {
    id: 'porcelain',
    name: 'Porcelain',
    cost: 300,
    desc: 'No craters, the way the moon looks at full when nothing casts a shadow.',
    disc: '#f7f6f2',
    shadow: '#171b30',
    // drawMoon paints the glow out to 3.2r at up to 0.85 alpha, so it is the
    // largest lit area on an 11pm screen. #93a8e2 was 2.7x Midnight's --glow
    // and brighter than any sky ships; this sits inside the range they set.
    glow: '#7b8fd0',
    craterAlpha: 0,
    craters: [],
    ring: null,
  },
  {
    id: 'harvest',
    name: 'Harvest Moon',
    cost: 520,
    desc: 'The full moon nearest the autumn equinox, orange from riding low.',
    disc: '#f0a44e',
    shadow: '#2b1707',
    glow: '#b96a22',
    craterAlpha: 0.11,
    // Six, the cratered one of the set. The (0.52,-0.15) lens used to be 0.22
    // and reached into its neighbour at (0.27,-0.47); drawMoon fills each
    // crater as its own rgba circle with no union, so the overlap composited
    // twice and read as a clipping artifact rather than a crater.
    craters: [[-0.23, -0.54, 0.26], [0.27, -0.47, 0.2], [0.52, -0.15, 0.17], [-0.27, 0.36, 0.17], [-0.57, 0.41, 0.1], [0.56, 0.26, 0.09]],
    ring: null,
  },
  {
    id: 'bluemoon',
    name: 'Blue Moon',
    cost: 740,
    desc: 'Actually blue, the way it looks through the smoke of a very large fire.',
    disc: '#a8c6ff',
    shadow: '#101a38',
    glow: '#4a6cc8',
    craterAlpha: 0.06,
    // Its own face, not Harvest's at a smaller radius. Spread across x on
    // purpose: the lit lune grows from the right, so craters at x 0.5, 0.1,
    // -0.05, -0.36 arrive at roughly a quarter, half, and two thirds full and
    // the moon keeps developing all evening instead of arriving at once.
    craters: [[0.5, 0.18, 0.2], [-0.05, -0.44, 0.16], [-0.36, 0.2, 0.19], [0.1, 0.48, 0.11]],
    ring: null,
  },
  {
    // Was Earthshine, whose whole idea — a lit unlit half — worked against the
    // one thing the moon does here, and whose disc was a second white a hair
    // from Porcelain's. The shelf had no dark moon and no metal one; this is
    // both.
    id: 'copper',
    name: 'Old Copper',
    cost: 1060,
    desc: 'Beaten copper gone dark, the colour of a kettle nobody polishes.',
    disc: '#c07a3c',
    shadow: '#1e0f06',
    glow: '#9a5f2c',
    craterAlpha: 0.14,
    craters: [[-0.4, -0.35, 0.22], [0.15, -0.6, 0.14], [0.44, -0.12, 0.19], [-0.05, 0.28, 0.25], [0.5, 0.44, 0.11]],
    ring: null,
  },
  {
    id: 'halo',
    name: 'Ice Halo',
    cost: 1290,
    desc: 'A ring of high ice around the moon, which is supposed to mean rain by morning.',
    // Ice, not cream. The old #f4e7c8 / #1b1e36 pair was Midnight's own --moon
    // and --moon-shadow to within a percent, so the most expensive moon on the
    // shelf sold most users the free one with a ring drawn round it.
    disc: '#d8e8f6',
    shadow: '#151a2e',
    glow: '#7f92c4',
    craterAlpha: 0.07,
    craters: [[0.26, -0.5, 0.18], [-0.42, -0.22, 0.14], [0.38, 0.12, 0.1], [-0.16, 0.44, 0.21]],
    // 1.35, which is also drawMoon's own fallback, because the moon sits in a
    // corner: moonGeometry insets it by 28px from the right edge and clears the
    // top bar by 14px, so a ring at 1.8 ran flush to the bezel on every phone
    // and put its top arc inside the bar's blur. 1.35 leaves 15px and 2px.
    // Brighter instead of bigger — the ring is the only reason to buy this.
    ring: { alpha: 0.34, dash: '', scale: 1.35 },
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
    // The measurement already in js/dom.js, to the digit. A free default that is
    // merely close to today's is a silent visual change to everyone's app.
    box: [4, 6, 16, 12, 12.15, 12.76],
  },
  {
    id: 'strike',
    name: 'Struck Through',
    cost: 240,
    desc: 'A line through it, the way you would on paper.',
    path: 'M4 12h16',
    box: [4, 12, 16, 0, 12, 12],
  },
  {
    id: 'star',
    name: 'Star',
    cost: 420,
    desc: 'A small one of your own, for a small thing done.',
    path: 'M12 3.5l2.6 5.6 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.9l6-.8z',
    box: [3.4, 3.5, 17.2, 16.6, 11.95, 12.64],
  },
  {
    id: 'crescent',
    name: 'Crescent',
    cost: 640,
    desc: 'The same moon that is filling up above the list.',
    path: 'M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z',
    box: [3.32, 4, 16.68, 16.68, 9.95, 13.95],
  },
  {
    id: 'ember',
    name: 'Ember',
    cost: 880,
    desc: 'A little flame, for the ones that took some doing.',
    path: 'M12 3.5c.6 3.2 4.5 4.6 4.5 8.6a4.5 4.5 0 0 1-9 0c0-1.7.8-2.8 1.8-3.8.5 1 1.2 1.6 2 1.9-.4-2.4-.1-4.6.7-6.7z',
    // Measured with getBBox and a 200-sample path centroid, not estimated.
    box: [7.5, 3.5, 9, 13.1, 11.95, 10.61],
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
    note: 'theme',
    ink: 'theme',
    flap: 'theme',
    seal: 'theme',
    sealPath: null,
  },
  {
    id: 'kraft',
    name: 'Kraft',
    cost: 270,
    // No emblem: the seal is the brass button, and a parcel envelope has never
    // been stamped with anything.
    desc: 'Brown parcel paper, with the little brass button the string winds round.',
    paper: '#2a2116',
    note: '#332819',
    ink: '#f1e6d2',
    flap: '#40301c',
    seal: '#be8a44',
    sealPath: null,
  },
  {
    id: 'airmail',
    name: 'Airmail',
    cost: 560,
    desc: 'Paper cut thin to save postage, a blue flap, and a red stamp.',
    paper: '#16212c',
    note: '#1d2a36',
    ink: '#e9eef3',
    // The one skin whose flap is a different colour rather than a shade of the
    // paper — the blue band is the whole of what makes an airmail envelope
    // recognisable, and 2.36:1 against the paper is what makes it read as one.
    flap: '#2c5a9a',
    seal: '#c0453a',
    sealPath: 'M20.5 3.5L3.5 10.4l7 3.1 3.1 7z M20.5 3.5l-10 10',
  },
  {
    id: 'garden',
    name: 'Garden Post',
    cost: 760,
    desc: 'Bottle green card out of a seed catalogue, sealed with a leaf.',
    paper: '#172817',
    note: '#1e321e',
    ink: '#e7eedc',
    flap: '#254226',
    seal: '#6e9450',
    sealPath: 'M12 21C6 16.5 6 8.5 12 3 18 8.5 18 16.5 12 21Z M12 21V8',
  },
  {
    id: 'leadseal',
    name: 'Lead Seal',
    cost: 960,
    // Grey wax, not black. `--env-seal` is also the colour of the icon in every
    // reel cell (components.css, `.env-cell > svg`) and of the emblem pressed
    // into the wax (`color-mix(in srgb, var(--env-seal) 45%, #000)`), so a wax
    // dark enough to be called black takes both of those below 1.5:1 and the
    // prize line loses its glyph. Lead is as dark as the wax can honestly go.
    desc: 'Ink-black card, sealed in grey wax and pressed with a signet ring.',
    paper: '#18171a',
    note: '#1f1e23',
    ink: '#e8e6ee',
    flap: '#2b2935',
    seal: '#8c949f',
    sealPath: 'M12 5.5a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6',
  },
];

const BY_ID = (list) => (id) => list.find((entry) => entry.id === id) || list[0];

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
