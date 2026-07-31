/* The living night sky behind the app: parallax stars, a moon that fills
   with tonight's progress, shooting stars, unlocked constellations and
   pointer trails. Colours come from CSS custom properties so the theme
   picker stays the single source of truth. */

import { hashString, seededRandom, clamp } from './util.js';

let canvas = null;
let ctx = null;
let width = 0;
let height = 0;
let topInset = 0;
/** A full-screen panel is covering the sky; nothing may restart it. */
let paused = false;
let dpr = 1;
let running = false;
let reducedMotion = false;
let frame = null;

let stars = [];
let meteors = [];
let trailParticles = [];
let bursts = [];
let constellations = [];
let nightStars = [];

let moonFill = 0;
let moonFillTarget = 0;
let trailKind = 'none';
/* Equipped skins. Each is a plain spec from js/skins.js or null for "as it was",
   so nothing here has to know what the market sells. */
let horizonSpec = null;
let weatherSpec = null;
let weatherParticles = [];
let moonSpec = null;
let parallax = { x: 0, y: 0, tx: 0, ty: 0 };
let nextAmbientMeteor = 0;

/* The finale's instruments. All of them decay to nothing on their own, so a
   dropped frame or a backgrounded tab can never leave the sky stuck mid-effect. */
let rings = [];
let ribbons = [];
let moonGlowBoost = 0;
let moonGlowHold = 0; // reduced motion earns a permanently brighter moon instead
let moonFillOverride = null;
let swell = 0;
let swellT = 0;
let drift = 0;

const colors = {
  star: '#e9f0ff',
  starDim: '#8fa2d0',
  accent: '#8ea8ff',
  moon: '#f3ecd8',
  moonShadow: '#1b2140',
  trail: '#bcd0ff',
  glow: '#5f79d8',
  horizon: '#05070f',
};

function readColors() {
  if (typeof window === 'undefined') return;
  const style = getComputedStyle(document.documentElement);
  const get = (name, fallback) => (style.getPropertyValue(name) || '').trim() || fallback;
  colors.star = get('--sky-star', colors.star);
  colors.starDim = get('--sky-star-dim', colors.starDim);
  colors.accent = get('--accent', colors.accent);
  colors.moon = get('--moon', colors.moon);
  colors.moonShadow = get('--moon-shadow', colors.moonShadow);
  colors.trail = get('--trail', colors.trail);
  colors.glow = get('--glow', colors.glow);
  // Falls back to the darkest tone of whatever sky is equipped, so a horizon is
  // a silhouette in every theme without any theme having to know about it.
  colors.horizon = get('--horizon', get('--sky-1', colors.horizon));
}

function buildStars() {
  const density = clamp(Math.round((width * height) / 5200), 90, 420);
  const rand = seededRandom(hashString('nightcheck-stars'));
  stars = Array.from({ length: density }, () => {
    const layer = rand() < 0.55 ? 0 : rand() < 0.75 ? 1 : 2;
    return {
      x: rand() * width,
      y: rand() * height,
      r: (layer === 2 ? 1.5 : layer === 1 ? 1.05 : 0.7) * (0.6 + rand() * 0.8),
      layer,
      phase: rand() * Math.PI * 2,
      speed: 0.6 + rand() * 1.6,
      warm: rand() > 0.86,
    };
  });
}

function placeConstellations(list) {
  constellations = list.map((entry) => {
    const rand = seededRandom(hashString(`place:${entry.id}`));
    const scale = (0.16 + rand() * 0.1) * Math.max(width, 640);
    const x = 0.04 * width + rand() * (width * 0.62);
    const y = 0.06 * height + rand() * (height * 0.42);
    const place = ([sx, sy]) => ({ x: x + sx * scale, y: y + sy * scale * 0.8 });
    return {
      id: entry.id,
      points: entry.stars.map(place),
      // The faint stars you have bought past completion, in the same projected
      // box so they sit inside the figure rather than beside it.
      faint: (entry.faint || []).map(place),
      lines: entry.lines,
      phase: rand() * Math.PI * 2,
    };
  });
}

let constellationSource = [];
let nightStarKeys = [];

export function setConstellations(list) {
  constellationSource = list || [];
  if (width) placeConstellations(constellationSource);
}

/**
 * One star for every night you went to bed on time.
 *
 * Not bought — earned by sleeping. It is the only thing in the app that grows
 * forever, and it is a picture of the one behaviour the app exists to cause.
 * Placed by a seed derived from the night key, so a given night always lands in
 * the same spot and the sky you built is stable across reloads and devices.
 */
export function setNightStars(keys) {
  nightStarKeys = keys || [];
  if (width) placeNightStars(nightStarKeys);
}

function placeNightStars(keys) {
  nightStars = keys.map((key) => {
    const rand = seededRandom(hashString(`night-star:${key}`));
    // Spread over the whole sky, not the top third. During the night the panels
    // cover the middle and only the ones in the margins show — which is fine,
    // because the surface this is really for is the ending, where the app fades
    // away and the sky is all that is left.
    return {
      key,
      x: 0.03 * width + rand() * (width * 0.94),
      y: 0.04 * height + rand() * (height * 0.92),
      r: 1.2 + rand() * 1.0,
      phase: rand() * Math.PI * 2,
    };
  });
}

/**
 * Match the bitmap to the box.
 *
 * A canvas whose backing store does not match its CSS size is not clipped, it
 * is *stretched* — which is what an installed iOS app showed after launch: a
 * moon drawn as a circle arriving on screen as a tall ellipse, stars the size
 * of coins, and the drawing running out partway down. The element had grown
 * when the safe-area insets settled, and iOS never fired a window `resize` for
 * it, so the bitmap stayed the size it was born at.
 *
 * The reliable signal is the element itself, via a ResizeObserver. Everything
 * else here — window resize, orientation, the visual viewport — is belt and
 * braces for engines that report the box late.
 */
function resize(force = false) {
  if (!canvas) return;
  const nextDpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  // Mid-layout the element can measure zero. Keeping the last good size beats
  // rebuilding the sky into a 1×1 bitmap and stretching that across a phone.
  if (w <= 0 || h <= 0) return;
  if (!force && w === width && h === height && nextDpr === dpr) return;

  dpr = nextDpr;
  width = w;
  height = h;
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // How far down the top bar reaches. The moon used to be placed at a fixed
  // fraction of the height, which on a notched phone put its top third behind
  // a blurred, near-opaque bar — the app's own progress meter, half-hidden.
  const bar = document.querySelector('.topbar');
  topInset = bar ? Math.round(bar.getBoundingClientRect().bottom) : 0;
  buildStars();
  placeConstellations(constellationSource);
  placeNightStars(nightStarKeys);
  // Weather is seeded across the whole canvas, so a rotate or a keyboard
  // opening would otherwise leave every particle stranded off the new edge.
  if (weatherSpec) setWeather(weatherSpec);
  if (reducedMotion || !running) drawFrame(performance.now());
}

/* ------------------------------------------------------------------ moon */

export function moonGeometry() {
  const r = clamp(Math.min(width, height) * 0.09, 34, 78);
  // Clear of the top bar by a whole radius, so the moon is a whole moon.
  const y = Math.max(r + clamp(height * 0.08, 30, 90), topInset + r + 14);
  return { x: width - r - clamp(width * 0.08, 28, 90), y, r };
}

/**
 * A moon skin. `null` is today's moon exactly.
 *
 * Every field may be the string 'theme', meaning defer to the equipped sky's own
 * custom property — which is what keeps the free default a true no-op rather
 * than a lookalike that drifts the first time a theme is retuned.
 */
export function setMoonSkin(spec) {
  moonSpec = spec || null;
}

const DEFAULT_CRATERS = [[0.28, -0.3, 0.18], [-0.1, 0.24, 0.13], [0.42, 0.34, 0.1], [0.05, -0.05, 0.08]];

function moonInk() {
  const pick = (value, fallback) => (!value || value === 'theme' ? fallback : value);
  return {
    disc: pick(moonSpec?.disc, colors.moon),
    shadow: pick(moonSpec?.shadow, colors.moonShadow),
    glow: pick(moonSpec?.glow, colors.glow),
    craterAlpha: moonSpec ? clamp(moonSpec.craterAlpha ?? 0.08, 0, 0.25) : 0.08,
    craters: moonSpec?.craters || DEFAULT_CRATERS,
    ring: moonSpec?.ring || null,
  };
}

function drawMoon(time) {
  const { x, y, r } = moonGeometry();
  const fill = clamp(moonFill, 0, 1);
  const ink = moonInk();

  // Bloom for free: the glow gradient already runs every frame, so the finale
  // widens and brightens it rather than adding a filter or a shadowBlur —
  // either of which would cost more than everything else in this file combined.
  const boost = Math.max(moonGlowBoost, moonGlowHold);
  const reach = r * (3.2 + boost * 0.9);
  const glow = ctx.createRadialGradient(x, y, r * 0.5, x, y, reach);
  glow.addColorStop(0, `${ink.glow}55`);
  glow.addColorStop(1, 'transparent');
  ctx.fillStyle = glow;
  ctx.globalAlpha = clamp(0.35 + fill * 0.5 + boost * 0.5, 0, 1);
  ctx.beginPath();
  ctx.arc(x, y, reach, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.fillStyle = ink.shadow;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  // Lit lune: right semicircle joined to a terminator ellipse.
  const rx = Math.abs(r * (1 - 2 * fill));
  ctx.fillStyle = ink.disc;
  ctx.beginPath();
  ctx.arc(x, y, r, -Math.PI / 2, Math.PI / 2, false);
  ctx.ellipse(x, y, rx, r, 0, Math.PI / 2, -Math.PI / 2, fill <= 0.5);
  ctx.fill();

  // Craters, only on the lit side.
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, -Math.PI / 2, Math.PI / 2, false);
  ctx.ellipse(x, y, rx, r, 0, Math.PI / 2, -Math.PI / 2, fill <= 0.5);
  ctx.clip();
  ctx.fillStyle = `rgba(0,0,0,${ink.craterAlpha})`;
  for (const [cx, cy, cr] of ink.craters) {
    ctx.beginPath();
    ctx.arc(x + cx * r, y + cy * r, cr * r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  ctx.strokeStyle = `${ink.disc}33`;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(x, y, r + 1.5 + Math.sin(time / 1400) * 0.6, 0, Math.PI * 2);
  ctx.stroke();

  // A skin's own ring, outside the breathing halo the moon has always had.
  if (ink.ring) {
    ctx.save();
    ctx.globalAlpha = clamp(ink.ring.alpha ?? 0.5, 0, 1);
    ctx.strokeStyle = ink.disc;
    ctx.lineWidth = 1.4;
    if (ink.ring.dash) ctx.setLineDash(ink.ring.dash.split(' ').map(Number));
    ctx.beginPath();
    ctx.arc(x, y, r * (ink.ring.scale || 1.35), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

/* ------------------------------------------------------- horizon & weather */

/**
 * The silhouette along the bottom edge.
 *
 * A spec is `{ band, points }`: `band` is how much of the canvas height it
 * occupies, and `points` are the top edge only, x ascending 0..1 across the
 * canvas and y 0..1 up the band. The shape is closed down to the two bottom
 * corners and filled flat — no interior detail, because a silhouette that tries
 * to be a picture stops reading as a horizon.
 */
export function setHorizon(spec) {
  horizonSpec = spec && spec.points?.length ? spec : null;
}

function drawHorizon() {
  if (!horizonSpec) return;
  const { band, points } = horizonSpec;
  const top = height - height * band;
  ctx.fillStyle = colors.horizon;
  ctx.beginPath();
  ctx.moveTo(0, height);
  for (const [px, py] of points) ctx.lineTo(px * width, height - (height - top) * py);
  ctx.lineTo(width, height);
  ctx.closePath();
  ctx.fill();
}

/**
 * Weather: one particle layer, specified rather than coded.
 *
 * Every sky in this app was only a recolour — same starfield, same density, same
 * everything — so two skies differed in hue and nothing else. Weather is what
 * makes them differ in motion.
 *
 * Seeded eagerly rather than filled in over time, because reduced motion draws
 * exactly one frame and a layer that fades in over ten seconds would render as
 * an empty sky forever.
 */
export function setWeather(spec) {
  weatherSpec = spec && spec.count > 0 ? spec : null;
  weatherParticles = [];
  if (!weatherSpec || !width) return;
  for (let i = 0; i < weatherSpec.count; i += 1) weatherParticles.push(spawnWeather(true));
}

function spawnWeather(seeded = false) {
  const spec = weatherSpec;
  const spawn = spec.spawn || 'top';
  let x = Math.random() * width;
  let y;
  if (seeded || spawn === 'sky') y = Math.random() * height;
  else if (spawn === 'upper') y = Math.random() * height * 0.5;
  else if (spawn === 'edges') {
    y = Math.random() * height;
    x = Math.random() < 0.5 ? -20 : width + 20;
  } else y = -20 - Math.random() * height * 0.2;
  return {
    x,
    y,
    size: spec.size + Math.random() * (spec.sizeJitter || 0),
    phase: Math.random() * Math.PI * 2,
    speed: 0.75 + Math.random() * 0.5,
  };
}

function stepWeather() {
  if (!weatherSpec || !weatherParticles.length) return;
  const spec = weatherSpec;
  for (let i = 0; i < weatherParticles.length; i += 1) {
    const p = weatherParticles[i];
    p.x += spec.vx * p.speed;
    p.y += spec.vy * p.speed;
    if (spec.wobble) p.x += Math.sin(drift * 900 + p.phase) * spec.wobble * 0.6;
    const gone = p.y > height + 40 || p.y < -60 || p.x < -80 || p.x > width + 80;
    if (gone) weatherParticles[i] = spawnWeather();
  }
}

function weatherColor(spec) {
  if (spec.color === 'accent') return colors.accent;
  if (spec.color === 'star') return colors.star;
  if (spec.color === 'glow') return colors.glow;
  return spec.color;
}

function drawWeather() {
  if (!weatherSpec || !weatherParticles.length) return;
  const spec = weatherSpec;
  ctx.fillStyle = weatherColor(spec);
  ctx.strokeStyle = weatherColor(spec);
  ctx.globalAlpha = clamp(spec.opacity, 0, 1);
  for (const p of weatherParticles) {
    if (spec.shape === 'streak') {
      ctx.lineWidth = Math.max(1, p.size * 0.16);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - spec.vx * p.size, p.y - spec.vy * p.size);
      ctx.stroke();
    } else if (spec.shape === 'band') {
      // A soft horizontal curtain: wide, short, and always fading at both ends
      // so it never reads as a drawn rectangle.
      const w = p.size * 6;
      const gradient = ctx.createLinearGradient(p.x - w / 2, 0, p.x + w / 2, 0);
      gradient.addColorStop(0, 'transparent');
      gradient.addColorStop(0.5, weatherColor(spec));
      gradient.addColorStop(1, 'transparent');
      ctx.fillStyle = gradient;
      ctx.fillRect(p.x - w / 2, p.y, w, p.size);
    } else {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

/* ------------------------------------------------------------- meteors */

export function shootingStar(options = {}) {
  // Reduced motion means no motion: with the rAF loop stopped nothing decays,
  // so a meteor drawn here would stay frozen across the sky forever. The same
  // is true of a paused loop — One Card mode and the goodnight screen both stop
  // it — and every sibling effect below already carries this guard. Without it,
  // a session's worth of meteors sat queued and all arrived at once on resume.
  if (reducedMotion || !running) return;
  const startX = options.x ?? width * (0.15 + Math.random() * 0.7);
  const startY = options.y ?? height * (0.02 + Math.random() * 0.25);
  meteors.push({
    x: startX,
    y: startY,
    vx: (options.vx ?? (2.6 + Math.random() * 2.4)) * (Math.random() < 0.2 ? -1 : 1),
    vy: options.vy ?? (1.4 + Math.random() * 1.2),
    life: 1,
    decay: 0.012 + Math.random() * 0.008,
    len: 90 + Math.random() * 90,
    hue: options.hue || colors.star,
  });
}

/**
 * A spray of particles from a point.
 *
 * `spread`/`aim` let a caller point it. The old fixed circle fired half its
 * particles straight off the top-right corner, because that is where the moon
 * is; aiming it down and inward puts the light where the list is.
 */
export function burstAt(x, y, {
  count = 34, aim = null, spread = Math.PI * 2, speed = 1.4, spin = 3.2, gravity = 0.02, decay = 0.009,
} = {}) {
  // Not just reducedMotion: with the loop stopped nothing decays, so particles
  // pushed while a modal has paused the sky sit frozen until it reopens and
  // then all play at once, minutes late.
  if (reducedMotion || !running) return;
  for (let i = 0; i < count; i += 1) {
    const angle = aim === null
      ? (i / count) * spread
      : aim + (i / count - 0.5) * spread;
    const v = speed + Math.random() * spin;
    bursts.push({
      x, y,
      vx: Math.cos(angle) * v,
      vy: Math.sin(angle) * v,
      life: 1,
      decay: decay + Math.random() * 0.01,
      r: 1 + Math.random() * 2,
      g: gravity,
    });
  }
}

/** A celebration asked for while the sky was stopped, waiting for it to resume. */
let owedCelebration = false;

export function celebrateBurst() {
  if (reducedMotion) return;
  // Completing a constellation happens inside the star map, which pauses the
  // sky — so the one moment the sky exists to celebrate was the one it was
  // asleep for, and the three follow-up meteors queued frozen instead. Held
  // until the panel closes and the sky comes back.
  if (!running) {
    owedCelebration = true;
    return;
  }
  const { x, y } = moonGeometry();
  burstAt(x, y);
  for (let i = 0; i < 3; i += 1) setTimeout(() => shootingStar(), i * 260);
}

/**
 * A line of light from somewhere on screen to the moon.
 *
 * Drawn head-first with a dash offset rather than by growing a path, so the
 * whole curve is one stroke however long it is. The curve matters: a straight
 * line reads as a laser, an arc reads as something thrown.
 */
export function ribbonTo(fromX, fromY) {
  if (reducedMotion || !running) return;
  const { x, y } = moonGeometry();
  const midX = (fromX + x) / 2 + (y - fromY) * 0.16;
  const midY = (fromY + y) / 2 - Math.abs(x - fromX) * 0.22;
  ribbons.push({ x0: fromX, y0: fromY, cx: midX, cy: midY, x1: x, y1: y, t: 0, life: 1 });
}

/** One expanding ring. Three lines of draw code for "the sky itself reacted". */
export function ringAt(x, y, { r = 10, vr = 3.2, decay = 0.022, w = 2.4 } = {}) {
  if (reducedMotion || !running) return;
  rings.push({ x, y, r, vr, life: 1, decay, w });
}

/**
 * Drive the moon to full decisively instead of easing toward it forever.
 *
 * The standing lerp approaches its target asymptotically, which is right for
 * every ordinary check-off and wrong for the last one — the terminator should
 * sweep closed and stop, not glide in over three seconds.
 */
export function moonSurge(ms = 320) {
  if (reducedMotion) {
    // Nothing can animate, so the reward is a permanent change instead: the
    // moon is simply brighter from now on, and stays that way.
    moonGlowHold = 0.5;
    moonFill = moonFillTarget;
    drawFrame(performance.now());
    return;
  }
  moonFillOverride = { from: moonFill, to: moonFillTarget, start: performance.now(), ms };
  moonGlowBoost = 1;
}

/** A brightness wave travelling outward from the moon, not a global flash. */
export function starSwell() {
  if (reducedMotion || !running) return;
  swell = 1;
  swellT = 0;
}

/* --------------------------------------------------------------- trails */

/**
 * What each trail is, as data.
 *
 * This was five ternaries on `trailKind` spread across the emitter and the
 * renderer, so adding a trail meant finding all five and adding a branch to
 * each — and forgetting one gave you a trail that half-worked. A trail is now
 * one row. `drift` null means the particle wanders; a drift object makes it
 * rise, which is what separates fireflies from dust.
 */
const TRAIL_SPECS = {
  stardust: { per: 1, decay: 0.03, r: 1, jitter: 1, drift: null, flicker: false, color: () => colors.trail },
  comet: { per: 2, decay: 0.045, r: 1.6, jitter: 1.6, drift: null, flicker: false, color: () => colors.star },
  fireflies: { per: 1, decay: 0.012, r: 1, jitter: 1, drift: { up: 0.15, spread: 0.3 }, flicker: true, color: () => '#ffe58a' },
};

/** Which trails this renderer can actually draw — the shop is tested against it. */
export const TRAIL_IDS = Object.keys(TRAIL_SPECS);

export function setTrail(kind) {
  trailKind = kind || 'none';
  if (!TRAIL_SPECS[trailKind]) trailParticles = [];
}

function spawnTrail(x, y, count, spread) {
  const spec = TRAIL_SPECS[trailKind];
  if (!spec || reducedMotion || !running) return;
  for (let i = 0; i < count; i += 1) {
    trailParticles.push({
      x: x + (Math.random() - 0.5) * spread,
      y: y + (Math.random() - 0.5) * spread,
      vx: (Math.random() - 0.5) * 0.5,
      vy: spec.drift
        ? -(spec.drift.up + Math.random() * spec.drift.spread)
        : (Math.random() - 0.5) * 0.4,
      life: 1,
      decay: spec.decay,
      r: spec.r + Math.random() * spec.jitter,
      phase: Math.random() * Math.PI * 2,
    });
  }
  if (trailParticles.length > 260) trailParticles.splice(0, trailParticles.length - 260);
}

/** The pointer emitter: a thin ribbon, one spec-sized puff per move event. */
function emitTrail(x, y) {
  spawnTrail(x, y, TRAIL_SPECS[trailKind]?.per || 0, 6);
}

/**
 * The check-off emitter.
 *
 * Trails used to hang entirely off `pointermove`, which on a touch screen only
 * fires while a finger is held down — so on the device this app is built for,
 * buying a trail bought very nearly nothing. This fires once, at the box you
 * just tapped, which is the moment the trail is actually for. It is a puff
 * rather than a ribbon because it gets one event rather than sixty a second.
 */
export function emitTrailAt(x, y) {
  spawnTrail(x, y, 16, 14);
}

/* ---------------------------------------------------------------- render */

/**
 * Halos are pre-rendered sprites with a soft gradient falloff. Drawing them as
 * flat discs (the obvious approach) makes the brightest stars read as grey
 * blobs with a hard edge rather than as glow.
 */
const haloCache = new Map();

function haloSprite(color) {
  if (haloCache.has(color)) return haloCache.get(color);
  let sprite = null;
  if (/^#[0-9a-f]{6}$/i.test(color)) {
    const size = 64;
    const offscreen = document.createElement('canvas');
    offscreen.width = size;
    offscreen.height = size;
    const octx = offscreen.getContext('2d');
    const gradient = octx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, `${color}cc`);
    gradient.addColorStop(0.18, `${color}66`);
    gradient.addColorStop(0.55, `${color}1a`);
    gradient.addColorStop(1, `${color}00`);
    octx.fillStyle = gradient;
    octx.fillRect(0, 0, size, size);
    sprite = offscreen;
  }
  haloCache.set(color, sprite);
  return sprite;
}

function drawStars(time) {
  const moon = moonGeometry();
  const reach = Math.hypot(width, height) || 1;
  for (const star of stars) {
    const twinkle = reducedMotion ? 0.75 : 0.55 + 0.45 * Math.sin(time / 900 * star.speed + star.phase);
    const depth = (star.layer + 1) / 3;
    // The wave arrives at nearer stars first, which is what makes it read as
    // something spreading from the moon rather than the screen flashing.
    const local = swell > 0
      ? clamp(swellT * 1.6 - Math.hypot(star.x - moon.x, star.y - moon.y) / reach, 0, 1)
      : 0;
    const x = star.x + parallax.x * depth * 14 + Math.sin(drift * 6 + star.phase) * depth * 3;
    const y = star.y + parallax.y * depth * 10 + Math.cos(drift * 4.4 + star.phase) * depth * 2;
    const color = star.warm ? colors.accent : star.layer === 2 ? colors.star : colors.starDim;
    const alpha = clamp(twinkle * (0.4 + depth * 0.6) * (1 + swell * 0.55 * local), 0.05, 1);

    if (star.layer === 2 && star.r > 1.3) {
      const sprite = haloSprite(color);
      if (sprite) {
        const size = star.r * 9;
        ctx.globalAlpha = alpha * 0.5;
        ctx.drawImage(sprite, x - size / 2, y - size / 2, size, size);
      }
    }

    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, star.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawConstellations(time) {
  if (!constellations.length) return;
  for (const c of constellations) {
    const pulse = reducedMotion ? 0.5 : 0.42 + 0.18 * Math.sin(time / 2200 + c.phase);
    ctx.strokeStyle = colors.accent;
    ctx.globalAlpha = pulse * 0.5;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const [a, b] of c.lines) {
      const p1 = c.points[a];
      const p2 = c.points[b];
      if (!p1 || !p2) continue;
      ctx.moveTo(p1.x + parallax.x * 8, p1.y + parallax.y * 6);
      ctx.lineTo(p2.x + parallax.x * 8, p2.y + parallax.y * 6);
    }
    ctx.stroke();

    // Faint first, so a drawn star always paints over one of its neighbours
    // rather than the other way round. Smaller, dimmer, and never joined by a
    // line — they are the sky filling in around the figure, not part of it.
    if (c.faint.length) {
      ctx.globalAlpha = clamp(pulse * 0.55, 0, 1);
      ctx.fillStyle = colors.star;
      for (const p of c.faint) {
        ctx.beginPath();
        ctx.arc(p.x + parallax.x * 8, p.y + parallax.y * 6, 1.15, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.globalAlpha = clamp(pulse + 0.35, 0, 1);
    ctx.fillStyle = colors.star;
    for (const p of c.points) {
      const x = p.x + parallax.x * 8;
      const y = p.y + parallax.y * 6;
      ctx.beginPath();
      ctx.arc(x, y, 2.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha *= 0.28;
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = clamp(pulse + 0.35, 0, 1);
    }
  }
  ctx.globalAlpha = 1;
}

/**
 * The record, drawn. Warm rather than accent-coloured so it reads as something
 * of yours rather than as another unlockable, and always at least as bright as
 * an ordinary star — a night you actually went to bed on time should not be
 * indistinguishable from the background.
 */
function drawNightStars(time) {
  if (!nightStars.length) return;
  ctx.fillStyle = colors.moon || colors.star;
  for (const s of nightStars) {
    const twinkle = reducedMotion ? 0.72 : 0.6 + 0.22 * Math.sin(time / 2600 + s.phase);
    const x = s.x + parallax.x * 5;
    const y = s.y + parallax.y * 4;
    ctx.globalAlpha = twinkle;
    ctx.beginPath();
    ctx.arc(x, y, s.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = twinkle * 0.22;
    ctx.beginPath();
    ctx.arc(x, y, s.r * 4.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawMeteors() {
  for (const m of meteors) {
    const gradient = ctx.createLinearGradient(m.x, m.y, m.x - m.vx * m.len * 0.1, m.y - m.vy * m.len * 0.1);
    gradient.addColorStop(0, m.hue);
    gradient.addColorStop(1, 'transparent');
    ctx.strokeStyle = gradient;
    ctx.globalAlpha = clamp(m.life, 0, 1);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(m.x, m.y);
    ctx.lineTo(m.x - m.vx * m.len * 0.1, m.y - m.vy * m.len * 0.1);
    ctx.stroke();
    ctx.fillStyle = m.hue;
    ctx.beginPath();
    ctx.arc(m.x, m.y, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawRings() {
  for (const ring of rings) {
    ctx.strokeStyle = colors.accent;
    ctx.globalAlpha = clamp(ring.life, 0, 1) * 0.7;
    ctx.lineWidth = Math.max(0.4, ring.w * ring.life);
    ctx.beginPath();
    ctx.arc(ring.x, ring.y, ring.r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawRibbons() {
  for (const r of ribbons) {
    const t = clamp(r.t, 0, 1);
    // Head-first reveal: the dash pattern is the whole curve, and the offset
    // walks it into view. One stroke regardless of length.
    const len = Math.hypot(r.x1 - r.x0, r.y1 - r.y0) * 1.35;
    ctx.save();
    ctx.strokeStyle = colors.accent;
    ctx.globalAlpha = clamp(r.life, 0, 1) * 0.9;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.setLineDash([len * 0.34, len]);
    ctx.lineDashOffset = len * 0.34 - t * (len * 1.34);
    ctx.beginPath();
    ctx.moveTo(r.x0, r.y0);
    ctx.quadraticCurveTo(r.cx, r.cy, r.x1, r.y1);
    ctx.stroke();
    ctx.restore();

    if (t < 1) {
      // The bright head, at the quadratic's current point.
      const u = 1 - t;
      const hx = u * u * r.x0 + 2 * u * t * r.cx + t * t * r.x1;
      const hy = u * u * r.y0 + 2 * u * t * r.cy + t * t * r.y1;
      ctx.globalAlpha = clamp(r.life, 0, 1);
      ctx.fillStyle = colors.star;
      ctx.beginPath();
      ctx.arc(hx, hy, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

function drawParticles(time) {
  const spec = TRAIL_SPECS[trailKind];
  const color = spec ? spec.color() : colors.trail;
  for (const p of trailParticles) {
    const flicker = spec?.flicker ? 0.5 + 0.5 * Math.sin(time / 200 + p.phase) : 1;
    ctx.globalAlpha = clamp(p.life * flicker, 0, 1) * 0.85;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * (0.5 + p.life * 0.8), 0, Math.PI * 2);
    ctx.fill();
  }
  for (const b of bursts) {
    ctx.globalAlpha = clamp(b.life, 0, 1);
    ctx.fillStyle = b.life > 0.6 ? colors.moon : colors.accent;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function step(time) {
  if (moonFillOverride) {
    const o = moonFillOverride;
    const t = clamp((time - o.start) / o.ms, 0, 1);
    moonFill = o.from + (o.to - o.from) * (1 - (1 - t) ** 3);
    if (t >= 1) moonFillOverride = null;
  } else {
    moonFill += (moonFillTarget - moonFill) * 0.08;
  }

  if (moonGlowBoost > 0.001) moonGlowBoost *= 0.955;
  else moonGlowBoost = 0;

  if (swell > 0.001) {
    swellT += 0.03;
    swell *= 0.972;
  } else {
    swell = 0;
  }

  // A baseline drift so the field is never perfectly rigid. On a phone
  // pointermove only fires while a finger is down, so without this the sky is
  // literally static dots the entire time you are reading the list.
  drift += 0.00035;

  stepWeather();

  parallax.x += (parallax.tx - parallax.x) * 0.05;
  parallax.y += (parallax.ty - parallax.y) * 0.05;

  for (const ring of rings) {
    ring.r += ring.vr;
    ring.life -= ring.decay;
  }
  rings = rings.filter((r) => r.life > 0);

  for (const r of ribbons) {
    if (r.t < 1) r.t = Math.min(1, r.t + 0.075);
    else r.life -= 0.045;
  }
  ribbons = ribbons.filter((r) => r.life > 0);

  for (const m of meteors) {
    m.x += m.vx * 3.2;
    m.y += m.vy * 3.2;
    m.life -= m.decay;
  }
  meteors = meteors.filter((m) => m.life > 0 && m.x > -200 && m.x < width + 200 && m.y < height + 120);

  for (const p of trailParticles) {
    p.x += p.vx;
    p.y += p.vy;
    p.life -= p.decay;
  }
  trailParticles = trailParticles.filter((p) => p.life > 0);

  for (const b of bursts) {
    b.x += b.vx;
    b.y += b.vy;
    b.vy += b.g ?? 0.02;
    b.life -= b.decay;
  }
  bursts = bursts.filter((b) => b.life > 0);

  if (time > nextAmbientMeteor) {
    nextAmbientMeteor = time + 22000 + Math.random() * 45000;
    if (time > 4000) shootingStar();
  }
}

function drawFrame(time) {
  if (!ctx) return;
  // The whole bitmap, not just the logical box. Should the two ever disagree
  // again, pixels outside the box would otherwise never be painted over —
  // which is how a band of stale sky ended up frozen across the top of a phone.
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
  drawStars(time);
  drawConstellations(time);
  drawNightStars(time);
  drawMoon(time);
  drawMeteors();
  // The silhouette occludes the sky behind it — stars, meteors and the moon if
  // it has set — and weather falls in front of it, the way snow falls in front
  // of a treeline. The finale's own instruments stay on top of everything.
  drawHorizon();
  drawWeather();
  drawRibbons();
  drawRings();
  drawParticles(time);
}

function loop(time) {
  if (!running) return;
  step(time);
  drawFrame(time);
  frame = requestAnimationFrame(loop);
}

function start() {
  // `paused` is explicit because start() has several callers that know nothing
  // about panels: setReducedMotion, refreshTheme and the visibilitychange
  // handler all called it unconditionally, so equipping a theme from inside the
  // Night Market restarted the loop behind a full-screen opaque panel and left
  // it running there — the exact cost setSkyPaused exists to avoid.
  if (running || reducedMotion || paused) return;
  running = true;
  frame = requestAnimationFrame(loop);
}

function stop() {
  running = false;
  if (frame) cancelAnimationFrame(frame);
  frame = null;
}

export function setReducedMotion(value) {
  reducedMotion = Boolean(value);
  if (reducedMotion) {
    stop();
    moonFill = moonFillTarget;
    moonFillOverride = null;
    trailParticles = [];
    meteors = [];
    bursts = [];
    // With the loop stopped nothing decays, so anything left mid-flight would
    // hang across the sky for the rest of the night.
    rings = [];
    ribbons = [];
    moonGlowBoost = 0;
    swell = 0;
    drawFrame(performance.now());
  } else {
    start();
  }
}

export function setMoonFill(pct) {
  moonFillTarget = clamp((pct || 0) / 100, 0, 1);
  if (reducedMotion) {
    moonFill = moonFillTarget;
    drawFrame(performance.now());
  }
}

/** Nothing to animate while a full-screen panel is covering the sky. */
export function setSkyPaused(value) {
  paused = Boolean(value);
  if (paused) {
    stop();
    return;
  }
  if (document.hidden) return;
  start();
  if (owedCelebration) {
    owedCelebration = false;
    // A frame late, so the loop is genuinely running when the burst is pushed.
    requestAnimationFrame(() => celebrateBurst());
  }
}

export function refreshTheme() {
  readColors();
  haloCache.clear(); // sprites are tinted per theme colour
  if (reducedMotion || !running) drawFrame(performance.now());
}

export function initSky(node, { reduceMotion = false } = {}) {
  canvas = node;
  ctx = canvas.getContext('2d');
  readColors();
  reducedMotion = reduceMotion;
  resize(true);

  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => resize()).observe(canvas);
  }
  window.addEventListener('resize', () => resize(), { passive: true });
  window.addEventListener('orientationchange', () => resize(), { passive: true });
  window.visualViewport?.addEventListener('resize', () => resize(), { passive: true });
  // Returning from the app switcher can restore a page laid out at another size.
  window.addEventListener('pageshow', () => resize(), { passive: true });

  window.addEventListener('pointermove', (event) => {
    parallax.tx = (event.clientX / Math.max(1, width) - 0.5) * 2;
    parallax.ty = (event.clientY / Math.max(1, height) - 0.5) * 2;
    emitTrail(event.clientX, event.clientY);
  }, { passive: true });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else if (!reducedMotion) start();
  });

  if (reducedMotion) drawFrame(0);
  else start();
}
