#!/usr/bin/env node
/**
 * Renders the PWA PNG icons with no dependencies — a tiny software
 * rasteriser plus zlib for the PNG chunks. Mirrors assets/icon.svg.
 *
 *   node tools/make-icons.mjs
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'assets');

const SAMPLES = 3; // supersampling per axis

const hex = (value) => [
  parseInt(value.slice(1, 3), 16),
  parseInt(value.slice(3, 5), 16),
  parseInt(value.slice(5, 7), 16),
];

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

const SKY_TOP = hex('#141c4a');
const SKY_MID = hex('#0a1030');
const SKY_BOTTOM = hex('#05070f');
const MOON_LIGHT = hex('#f7f0dc');
const MOON_DARK = hex('#cbb98f');
const ACCENT = hex('#7d9bff');
const STAR = hex('#eaf0ff');

function roundedRectContains(x, y, size, radius) {
  const rx = Math.min(Math.max(x, radius), size - radius);
  const ry = Math.min(Math.max(y, radius), size - radius);
  return Math.hypot(x - rx, y - ry) <= radius;
}

function distanceToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** Colour of one sample point, in a 0..1 unit square. */
/**
 * The same picture assets/icon.svg draws, in a rasteriser rather than in SVG.
 *
 * Two renderers of one image is exactly the drift this project keeps getting
 * caught by, so it is worth saying what has to stay in step: the moon centre,
 * the radius, the fill fraction, and the meteor's path. tests/icons.test.js
 * reads the numbers back out of both files and compares them, so a change here
 * that is not also a change there fails. Run it and look at both anyway.
 */
const MOON_X = 262 / 512;
const MOON_Y = 248 / 512;
const MOON_R = 126 / 512;
const FILL = 0.72;
// The terminator's x-radius, straight out of sky.js drawMoon: r * |1 - 2f|.
const TERMINATOR_RX = MOON_R * Math.abs(1 - 2 * FILL);
const MOON_UNLIT = hex('#39457e');
const MOON_RIM = hex('#5866a8');
// The meteor — which is what shootingStar() draws when you tick something off —
// flying the path of a checkmark across the moon. Two segments, round joined.
const METEOR = [[232 / 512, 258 / 512], [282 / 512, 324 / 512], [404 / 512, 158 / 512]];
const METEOR_W = 14.5 / 512; // half of the SVG's stroke-width
const METEOR_HEAD = [404 / 512, 158 / 512];
const HEAD_R = 14 / 512;
const HALO_R = 27 / 512;
// Deep where the stroke lies on the gold, hot where it leaves onto the sky. The
// taper is in value rather than opacity — see the note in assets/icon.svg.
const METEOR_DIM = hex('#3f52b5');
const METEOR_MID = hex('#6f8bf0');
const METEOR_LIT = hex('#f2f6ff');
const METEOR_HALO = hex('#dfe8ff');
const METEOR_HOT = hex('#f6f9ff');
// One pixel of feather at 512, on top of the supersampling.
const FEATHER = 1.5 / 512;

/**
 * The SVG's stroke gradient, which is an objectBoundingBox one running from the
 * box's bottom-left corner to its top-right. Reproduced rather than approximated
 * with arc length along the path: the two differ, because the checkmark doubles
 * back on itself and the vertex sits at a *lower* point on this axis than the
 * tail does. Arc length would brighten the short arm; this does not, which is
 * what makes the two arms read as one continuous streak.
 */
const BOX_X = Math.min(...METEOR.map((p) => p[0]));
const BOX_Y = Math.min(...METEOR.map((p) => p[1]));
const BOX_W = Math.max(...METEOR.map((p) => p[0])) - BOX_X;
const BOX_H = Math.max(...METEOR.map((p) => p[1])) - BOX_Y;
const GRAD_STOP = 0.55;

function meteorPaint(x, y) {
  const g = Math.max(0, Math.min(1, ((x - BOX_X) / BOX_W + (BOX_Y + BOX_H - y) / BOX_H) / 2));
  return g < GRAD_STOP
    ? mix(METEOR_DIM, METEOR_MID, g / GRAD_STOP)
    : mix(METEOR_MID, METEOR_LIT, (g - GRAD_STOP) / (1 - GRAD_STOP));
}

function sample(u, v, { maskable }) {
  const inset = maskable ? 0.1 : 0;

  // Square, always. Every platform that shows this applies its own mask, and a
  // pre-rounded asset with transparent corners gets rounded twice or picks up
  // dark ones. Only the maskable variant insets, and it stays full bleed.
  let color = v < 0.5 ? mix(SKY_TOP, SKY_MID, v * 2) : mix(SKY_MID, SKY_BOTTOM, (v - 0.5) * 2);

  const scale = 1 - inset * 2;
  const x = (u - inset) / scale;
  const y = (v - inset) / scale;

  // Stars. Fat on purpose: the old ones were r=0.008 of the canvas, which is
  // under half a pixel at the 60x60 this is actually looked at.
  const stars = [[0.1875, 0.207, 0.0215, 0.95], [0.137, 0.383, 0.0127, 0.55],
    [0.840, 0.816, 0.0156, 0.6], [0.715, 0.902, 0.0117, 0.45]];
  for (const [sx, sy, sr, alpha] of stars) {
    const d = Math.hypot(x - sx, y - sy);
    if (d < sr) color = mix(color, STAR, alpha);
    else if (d < sr * 2.6) color = mix(color, STAR, alpha * 0.18 * (1 - (d - sr) / (sr * 1.6)));
  }

  const fromMoon = Math.hypot(x - MOON_X, y - MOON_Y);

  // Moon glow.
  const reach = 190 / 512;
  if (fromMoon < reach) color = mix(color, ACCENT, 0.34 * (1 - fromMoon / reach));

  if (fromMoon <= MOON_R) {
    // The whole disc first — the part that is not done yet has to be visible,
    // or the lit part is a blob rather than a fraction of something.
    color = MOON_UNLIT.slice();
    if (fromMoon > MOON_R - 0.006) color = MOON_RIM.slice();

    // The lit lune: the right half, plus whatever the terminator ellipse adds.
    const dx = (x - MOON_X) / TERMINATOR_RX;
    const dy = (y - MOON_Y) / MOON_R;
    const lit = x >= MOON_X || dx * dx + dy * dy <= 1;
    if (lit) {
      const shade = (x - (MOON_X - MOON_R)) / (MOON_R * 2);
      color = mix(MOON_LIGHT, MOON_DARK, Math.max(0, Math.min(1, shade)));
    }
  }

  // The meteor last, so it crosses the moon rather than hiding behind it.
  //
  // Distance to the polyline is the minimum over its segments, which is exactly
  // a union of round-capped capsules — so stroke-linecap and stroke-linejoin
  // both come out round for free, matching the SVG without a special case at
  // the vertex.
  let dMeteor = Infinity;
  for (let i = 0; i < METEOR.length - 1; i += 1) {
    const [x1, y1] = METEOR[i];
    const [x2, y2] = METEOR[i + 1];
    dMeteor = Math.min(dMeteor, distanceToSegment(x, y, x1, y1, x2, y2));
  }
  const cover = Math.max(0, Math.min(1, (METEOR_W - dMeteor) / FEATHER));
  if (cover > 0) color = mix(color, meteorPaint(x, y), cover);
  const fromHead = Math.hypot(x - METEOR_HEAD[0], y - METEOR_HEAD[1]);
  if (fromHead < HALO_R) color = mix(color, METEOR_HALO, 0.2 * (1 - fromHead / HALO_R));
  if (fromHead <= HEAD_R) {
    color = mix(color, METEOR_HOT, Math.max(0, Math.min(1, (HEAD_R - fromHead) / FEATHER)));
  }

  return color;
}

function renderPng(size, options) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let pos = 0;
  for (let py = 0; py < size; py += 1) {
    raw[pos] = 0; // no filter
    pos += 1;
    for (let px = 0; px < size; px += 1) {
      let r = 0; let g = 0; let b = 0; let a = 0;
      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const u = (px + (sx + 0.5) / SAMPLES) / size;
          const v = (py + (sy + 0.5) / SAMPLES) / size;
          const color = sample(u, v, options);
          if (color) {
            r += color[0]; g += color[1]; b += color[2]; a += 255;
          }
        }
      }
      const total = SAMPLES * SAMPLES;
      const hits = a / 255;
      raw[pos] = hits ? Math.round(r / hits) : 0;
      raw[pos + 1] = hits ? Math.round(g / hits) : 0;
      raw[pos + 2] = hits ? Math.round(b / hits) : 0;
      raw[pos + 3] = Math.round(a / total);
      pos += 4;
    }
  }
  return encodePng(size, size, raw);
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0, 0);
  return Buffer.concat([length, body, crc]);
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = -1;
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

function encodePng(width, height, raw) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;   // bit depth
  header[9] = 6;   // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT_DIR, { recursive: true });
const targets = [
  ['icon-192.png', 192, { maskable: false }],
  ['icon-512.png', 512, { maskable: false }],
  ['icon-maskable-512.png', 512, { maskable: true }],
];
for (const [name, size, options] of targets) {
  const png = renderPng(size, options);
  writeFileSync(resolve(OUT_DIR, name), png);
  console.log(`wrote assets/${name} (${size}x${size}, ${(png.length / 1024).toFixed(1)} kB)`);
}
