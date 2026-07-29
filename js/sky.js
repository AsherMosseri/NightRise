/* The living night sky behind the app: parallax stars, a moon that fills
   with tonight's progress, shooting stars, unlocked constellations and
   pointer trails. Colours come from CSS custom properties so the theme
   picker stays the single source of truth. */

import { hashString, seededRandom, clamp } from './util.js';

let canvas = null;
let ctx = null;
let width = 0;
let height = 0;
let dpr = 1;
let running = false;
let reducedMotion = false;
let frame = null;

let stars = [];
let meteors = [];
let trailParticles = [];
let bursts = [];
let constellations = [];

let moonFill = 0;
let moonFillTarget = 0;
let trailKind = 'none';
let parallax = { x: 0, y: 0, tx: 0, ty: 0 };
let nextAmbientMeteor = 0;

const colors = {
  star: '#e9f0ff',
  starDim: '#8fa2d0',
  accent: '#8ea8ff',
  moon: '#f3ecd8',
  moonShadow: '#1b2140',
  trail: '#bcd0ff',
  glow: '#5f79d8',
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
    return {
      id: entry.id,
      points: entry.stars.map(([sx, sy]) => ({ x: x + sx * scale, y: y + sy * scale * 0.8 })),
      lines: entry.lines,
      phase: rand() * Math.PI * 2,
    };
  });
}

let constellationSource = [];

export function setConstellations(list) {
  constellationSource = list || [];
  if (width) placeConstellations(constellationSource);
}

function resize() {
  if (!canvas) return;
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  width = canvas.clientWidth;
  height = canvas.clientHeight;
  canvas.width = Math.max(1, Math.floor(width * dpr));
  canvas.height = Math.max(1, Math.floor(height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  buildStars();
  placeConstellations(constellationSource);
  if (reducedMotion) drawFrame(0);
}

/* ------------------------------------------------------------------ moon */

function moonGeometry() {
  const r = clamp(Math.min(width, height) * 0.09, 34, 78);
  return { x: width - r - clamp(width * 0.08, 28, 90), y: r + clamp(height * 0.08, 30, 90), r };
}

function drawMoon(time) {
  const { x, y, r } = moonGeometry();
  const fill = clamp(moonFill, 0, 1);

  const glow = ctx.createRadialGradient(x, y, r * 0.5, x, y, r * 3.2);
  glow.addColorStop(0, `${colors.glow}55`);
  glow.addColorStop(1, 'transparent');
  ctx.fillStyle = glow;
  ctx.globalAlpha = 0.35 + fill * 0.5;
  ctx.beginPath();
  ctx.arc(x, y, r * 3.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.fillStyle = colors.moonShadow;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  // Lit lune: right semicircle joined to a terminator ellipse.
  const rx = Math.abs(r * (1 - 2 * fill));
  ctx.fillStyle = colors.moon;
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
  ctx.fillStyle = 'rgba(0,0,0,0.08)';
  const craters = [[0.28, -0.3, 0.18], [-0.1, 0.24, 0.13], [0.42, 0.34, 0.1], [0.05, -0.05, 0.08]];
  for (const [cx, cy, cr] of craters) {
    ctx.beginPath();
    ctx.arc(x + cx * r, y + cy * r, cr * r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  ctx.strokeStyle = `${colors.moon}33`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x, y, r + 1.5 + Math.sin(time / 1400) * 0.6, 0, Math.PI * 2);
  ctx.stroke();
}

/* ------------------------------------------------------------- meteors */

export function shootingStar(options = {}) {
  // Reduced motion means no motion: with the rAF loop stopped nothing decays,
  // so a meteor drawn here would stay frozen across the sky forever.
  if (reducedMotion) return;
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

export function celebrateBurst() {
  if (reducedMotion) return;
  const { x, y } = moonGeometry();
  for (let i = 0; i < 46; i += 1) {
    const angle = (i / 46) * Math.PI * 2;
    const speed = 1.4 + Math.random() * 3.2;
    bursts.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1,
      decay: 0.008 + Math.random() * 0.01,
      r: 1 + Math.random() * 2,
    });
  }
  for (let i = 0; i < 3; i += 1) setTimeout(() => shootingStar(), i * 260);
}

/* --------------------------------------------------------------- trails */

export function setTrail(kind) {
  trailKind = kind || 'none';
  if (trailKind === 'none') trailParticles = [];
}

function emitTrail(x, y) {
  if (trailKind === 'none' || reducedMotion) return;
  const count = trailKind === 'comet' ? 2 : 1;
  for (let i = 0; i < count; i += 1) {
    trailParticles.push({
      x: x + (Math.random() - 0.5) * 6,
      y: y + (Math.random() - 0.5) * 6,
      vx: (Math.random() - 0.5) * 0.5,
      vy: trailKind === 'fireflies' ? -0.15 - Math.random() * 0.3 : (Math.random() - 0.5) * 0.4,
      life: 1,
      decay: trailKind === 'comet' ? 0.045 : trailKind === 'fireflies' ? 0.012 : 0.03,
      r: trailKind === 'comet' ? 1.6 + Math.random() * 1.6 : 1 + Math.random(),
      phase: Math.random() * Math.PI * 2,
    });
  }
  if (trailParticles.length > 260) trailParticles.splice(0, trailParticles.length - 260);
}

const TRAIL_COLORS = {
  stardust: () => colors.trail,
  comet: () => colors.star,
  fireflies: () => '#ffe58a',
};

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
  for (const star of stars) {
    const twinkle = reducedMotion ? 0.75 : 0.55 + 0.45 * Math.sin(time / 900 * star.speed + star.phase);
    const depth = (star.layer + 1) / 3;
    const x = star.x + parallax.x * depth * 14;
    const y = star.y + parallax.y * depth * 10;
    const color = star.warm ? colors.accent : star.layer === 2 ? colors.star : colors.starDim;
    const alpha = clamp(twinkle * (0.4 + depth * 0.6), 0.05, 1);

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

function drawParticles(time) {
  const color = TRAIL_COLORS[trailKind] ? TRAIL_COLORS[trailKind]() : colors.trail;
  for (const p of trailParticles) {
    const flicker = trailKind === 'fireflies' ? 0.5 + 0.5 * Math.sin(time / 200 + p.phase) : 1;
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
  moonFill += (moonFillTarget - moonFill) * 0.08;

  parallax.x += (parallax.tx - parallax.x) * 0.05;
  parallax.y += (parallax.ty - parallax.y) * 0.05;

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
    b.vy += 0.02;
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
  ctx.clearRect(0, 0, width, height);
  drawStars(time);
  drawConstellations(time);
  drawMoon(time);
  drawMeteors();
  drawParticles(time);
}

function loop(time) {
  if (!running) return;
  step(time);
  drawFrame(time);
  frame = requestAnimationFrame(loop);
}

function start() {
  if (running || reducedMotion) return;
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
    trailParticles = [];
    meteors = [];
    bursts = [];
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
export function setSkyPaused(paused) {
  if (paused) stop();
  else if (!reducedMotion && !document.hidden) start();
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
  resize();
  window.addEventListener('resize', resize, { passive: true });

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
