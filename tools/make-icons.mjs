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
function sample(u, v, { maskable }) {
  const inset = maskable ? 0.1 : 0;
  const size = 1;
  const radius = maskable ? 0.5 : 0.22;

  if (!maskable && !roundedRectContains(u, v, size, radius)) return null;

  // Background gradient.
  let color = v < 0.5 ? mix(SKY_TOP, SKY_MID, v * 2) : mix(SKY_MID, SKY_BOTTOM, (v - 0.5) * 2);

  const scale = 1 - inset * 2;
  const x = (u - inset) / scale;
  const y = (v - inset) / scale;

  // Stars.
  const stars = [[0.21, 0.23, 0.014, 0.9], [0.29, 0.14, 0.009, 0.7], [0.16, 0.38, 0.008, 0.55],
    [0.82, 0.23, 0.010, 0.6], [0.77, 0.64, 0.008, 0.5]];
  for (const [sx, sy, sr, alpha] of stars) {
    const d = Math.hypot(x - sx, y - sy);
    if (d < sr) color = mix(color, STAR, alpha);
    else if (d < sr * 2.6) color = mix(color, STAR, alpha * 0.18 * (1 - (d - sr) / (sr * 1.6)));
  }

  // Moon glow.
  const glow = Math.hypot(x - 0.586, y - 0.414);
  if (glow < 0.34) color = mix(color, ACCENT, 0.32 * (1 - glow / 0.34));

  // Crescent: big disc minus an offset disc.
  const inMoon = Math.hypot(x - 0.586, y - 0.414) <= 0.23;
  const inCut = Math.hypot(x - 0.47, y - 0.30) <= 0.196;
  if (inMoon && !inCut) {
    const shade = (x - 0.36) / 0.46;
    color = mix(MOON_LIGHT, MOON_DARK, Math.max(0, Math.min(1, shade)));
  }

  // Check mark.
  const strokeWidth = 0.033;
  const d1 = distanceToSegment(x, y, 0.293, 0.695, 0.395, 0.797);
  const d2 = distanceToSegment(x, y, 0.395, 0.797, 0.621, 0.555);
  if (Math.min(d1, d2) <= strokeWidth) color = ACCENT.slice();

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
