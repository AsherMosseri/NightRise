import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * The icon is drawn twice — once in assets/icon.svg, and once again by the
 * software rasteriser in tools/make-icons.mjs that produces the PNGs the app
 * actually ships. Nothing links them but care, and this repo has been caught by
 * exactly that shape of thing more than once: the achievements catalogue, the
 * service worker's precache list, the per-id CSS swatch rules. Every time, a
 * hand-maintained second copy drifted from the first and no test noticed.
 *
 * So: read the numbers back out of both files and compare them. This does not
 * check that the icon looks good — nothing here can. It checks that the picture
 * the source of truth describes is the picture the build emits, which is the
 * part that fails silently.
 */

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const SVG = read('../assets/icon.svg');
const RASTER = read('../tools/make-icons.mjs');

/** Every `<circle>` in the SVG, in document order. */
function circles() {
  return [...SVG.matchAll(/<circle\b([^>]*)\/>/g)].map(([, attrs]) => {
    const attr = (name) => {
      const m = attrs.match(new RegExp(`${name}="([^"]*)"`));
      return m ? m[1] : null;
    };
    return {
      cx: Number(attr('cx')), cy: Number(attr('cy')), r: Number(attr('r')),
      fill: attr('fill'), stroke: attr('stroke'),
    };
  });
}

/** A `const NAME = <number> / 512;` from the rasteriser, as SVG user units. */
function units(name) {
  const m = RASTER.match(new RegExp(`const ${name} = (-?[\\d.]+) / 512;`));
  assert.ok(m, `tools/make-icons.mjs has no "const ${name} = n / 512"`);
  return Number(m[1]);
}

/** A `const NAME = hex('#rrggbb');` from the rasteriser. */
function color(name) {
  const m = RASTER.match(new RegExp(`const ${name} = hex\\('(#[0-9a-f]{6})'\\)`));
  assert.ok(m, `tools/make-icons.mjs has no "const ${name} = hex(...)"`);
  return m[1];
}

test('the moon is in the same place in both renderers', () => {
  const disc = circles().filter((c) => c.r === 126);
  assert.equal(disc.length, 2, 'expected a filled disc and a rim stroke');
  for (const c of disc) {
    assert.equal(c.cx, units('MOON_X'));
    assert.equal(c.cy, units('MOON_Y'));
    assert.equal(c.r, units('MOON_R'));
  }
  assert.equal(disc[0].fill, color('MOON_UNLIT'));
  assert.equal(disc[1].stroke, color('MOON_RIM'));
});

test('the lit lune is at the fill fraction the rasteriser uses', () => {
  // The lune is a right semicircle joined to a terminator ellipse whose
  // x-radius is r * |1 - 2f| — the geometry sky.js drawMoon() uses. Recover f
  // from the path's second arc and check it against FILL.
  const m = SVG.match(/d="M262 122 A126 126 0 0 1 262 374 A(\d+) 126 0 0 1 262 122 Z"/);
  assert.ok(m, 'the lune path is not the shape this test knows how to read');
  const fill = Number(RASTER.match(/const FILL = ([\d.]+);/)[1]);
  assert.equal(Number(m[1]), Math.round(126 * Math.abs(1 - 2 * fill)));
  assert.ok(fill > 0.5 && fill < 0.75, 'gibbous on purpose: a half moon reads as a shape, not a moon');
});

test('the meteor follows the same path in both renderers', () => {
  const d = SVG.match(/<path d="((?:M|L)[^"]*)" stroke="url\(#meteor\)"/)[1];
  const points = [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((p) => [Number(p[1]), Number(p[2])]);
  const raster = RASTER.match(/const METEOR = (\[\[[\s\S]*?\]\]);/)[1];
  const rasterPoints = [...raster.matchAll(/\[(-?[\d.]+) \/ 512, (-?[\d.]+) \/ 512\]/g)]
    .map((p) => [Number(p[1]), Number(p[2])]);
  assert.deepEqual(rasterPoints, points);

  // It has to be a checkmark: down-right into a vertex, then up-right and past.
  assert.equal(points.length, 3, 'a check is two segments');
  const [start, vertex, tip] = points;
  assert.ok(vertex[1] > start[1] && vertex[1] > tip[1], 'the vertex is the lowest point');
  assert.ok(start[0] < vertex[0] && vertex[0] < tip[0], 'it travels left to right throughout');
  assert.ok(tip[1] < start[1], 'the long arm ends above where the short arm began');
});

test('the meteor crosses the moon, which is what makes it a second subject', () => {
  // The draft this replaced sat clear of the moon up in the corner and read as
  // scenery — a third tier of background with the stars. Overlap is the whole
  // mechanism, so it is the thing worth asserting.
  const cx = units('MOON_X');
  const cy = units('MOON_Y');
  const r = units('MOON_R');
  const d = SVG.match(/<path d="((?:M|L)[^"]*)" stroke="url\(#meteor\)"/)[1];
  const points = [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((p) => [Number(p[1]), Number(p[2])]);

  // Walk the polyline and count how much of it lies inside the disc.
  let inside = 0;
  let total = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    const len = Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.ceil(len);
    for (let s = 0; s < steps; s += 1) {
      const t = (s + 0.5) / steps;
      const x = x1 + (x2 - x1) * t;
      const y = y1 + (y2 - y1) * t;
      total += 1;
      if (Math.hypot(x - cx, y - cy) <= r) inside += 1;
    }
  }
  assert.ok(inside / total > 0.5, `only ${Math.round((inside / total) * 100)}% of the meteor is over the moon`);

  // And it must break the outline somewhere, or it is contained decoration
  // sitting on the moon rather than something crossing it. Only the head end is
  // required to clear the disc: the tail starts inside on purpose and fades in,
  // which is what a meteor does and what a checkmark drawn as a solid stroke
  // cannot. Asserting both ends would be asserting a different picture.
  const tip = points[points.length - 1];
  assert.ok(Math.hypot(tip[0] - cx, tip[1] - cy) > r, 'the head has to clear the disc');
});

test('the meteor stroke survives being looked at small', () => {
  const width = Number(SVG.match(/stroke="url\(#meteor\)"\s+stroke-width="(\d+)"/)[1]);
  assert.equal(units('METEOR_W'), width / 2, 'the rasteriser stores the half-width');
  // At the 29px an iPhone home screen actually renders, a stroke this wide is
  // width/512*29 device pixels. Under one and it is a smudge.
  assert.ok((width / 512) * 29 >= 1.5, `${((width / 512) * 29).toFixed(2)}px at 29px is too thin to read`);
});

test('the meteor head matches in both renderers', () => {
  const head = circles().filter((c) => c.fill === '#f6f9ff');
  assert.equal(head.length, 1);
  const halo = circles().filter((c) => c.fill === '#dfe8ff');
  assert.equal(halo.length, 1);

  assert.equal(head[0].r, units('HEAD_R'));
  assert.equal(halo[0].r, units('HALO_R'));
  assert.equal(halo[0].cx, head[0].cx, 'the halo is concentric with the head');
  assert.equal(halo[0].cy, head[0].cy);
  assert.equal(head[0].fill, color('METEOR_HOT'));
  assert.equal(halo[0].fill, color('METEOR_HALO'));

  // The head sits on the tip of the stroke, so the round cap fills behind it.
  const d = SVG.match(/<path d="((?:M|L)[^"]*)" stroke="url\(#meteor\)"/)[1];
  const points = [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((p) => [Number(p[1]), Number(p[2])]);
  assert.deepEqual([head[0].cx, head[0].cy], points[points.length - 1]);

  const raster = RASTER.match(/const METEOR_HEAD = \[(-?[\d.]+) \/ 512, (-?[\d.]+) \/ 512\];/);
  assert.deepEqual([Number(raster[1]), Number(raster[2])], [head[0].cx, head[0].cy]);
});

test('the stroke gradient matches in both renderers', () => {
  const block = SVG.match(/<linearGradient id="meteor"[^>]*>([\s\S]*?)<\/linearGradient>/)[1];
  const stops = [...block.matchAll(/offset="(\d+)%" stop-color="(#[0-9a-f]{6})" stop-opacity="([\d.]+)"/g)]
    .map((m) => ({ at: Number(m[1]) / 100, color: m[2], opacity: Number(m[3]) }));
  assert.equal(stops.length, 3);

  assert.deepEqual(stops.map((s) => s.color), [color('METEOR_DIM'), color('METEOR_MID'), color('METEOR_LIT')]);
  assert.equal(stops[1].at, Number(RASTER.match(/const GRAD_STOP = ([\d.]+);/)[1]));
  // Fully opaque throughout. The taper is in value, not in alpha — see below.
  assert.deepEqual(stops.map((s) => s.opacity), [1, 1, 1]);

  // It runs bottom-left to top-right, the direction of travel. If this axis
  // ever flips, the streak brightens at the tail instead of at the head and the
  // rasteriser's meteorPaint() — which reproduces this axis rather than using
  // arc length along the path — silently disagrees with the SVG.
  const axis = SVG.match(/<linearGradient id="meteor" x1="(\d)" y1="(\d)" x2="(\d)" y2="(\d)"/).slice(1).map(Number);
  assert.deepEqual(axis, [0, 1, 1, 0]);
});

/* WCAG relative luminance, and the contrast ratio between two hex colours. */
function luminance(hex) {
  const chan = (i) => {
    const s = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * chan(0) + 0.7152 * chan(1) + 0.0722 * chan(2);
}
const contrast = (a, b) => {
  const [hi, lo] = luminance(a) > luminance(b) ? [a, b] : [b, a];
  return (luminance(hi) + 0.05) / (luminance(lo) + 0.05);
};

test('no part of the meteor lies on the moon\'s unlit half', () => {
  // This is the constraint the whole colour scheme hangs on, so it is asserted
  // rather than trusted. There is no blue that reads on both fields at once:
  //
  //   #7d9bff  3.44:1 on the unlit navy   1.36:1 on the gold
  //   #2c3a7a  1.17:1 on the unlit navy   7.71:1 on the gold
  //
  // A stroke crossing the terminator is therefore illegible along part of its
  // length whatever colour it is given. The first version of this icon crossed
  // it, spent 26% of its length on the navy, and measured 1.74:1 median with
  // 87% of the stroke under 3:1. The fix was geometric, not chromatic.
  const cx = units('MOON_X');
  const cy = units('MOON_Y');
  const r = units('MOON_R');
  const fill = Number(RASTER.match(/const FILL = ([\d.]+);/)[1]);
  const rx = r * Math.abs(1 - 2 * fill);
  const half = Number(SVG.match(/stroke="url\(#meteor\)"\s+stroke-width="(\d+)"/)[1]) / 2;

  const d = SVG.match(/<path d="((?:M|L)[^"]*)" stroke="url\(#meteor\)"/)[1];
  const points = [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((p) => [Number(p[1]), Number(p[2])]);

  // Sample the stroke's full covered area, not just its centreline: an edge
  // sliding over the terminator is the failure this guards, and a centreline
  // walk would not see it. The round caps bulge half a stroke-width *past* each
  // endpoint too, so those are swept as discs rather than assumed away.
  const onUnlit = [];
  const test = (x, y) => {
    if (Math.hypot(x - cx, y - cy) > r) return; // over the sky, which is fine
    const ex = (x - cx) / rx;
    const ey = (y - cy) / r;
    if (!(x >= cx || ex * ex + ey * ey <= 1)) onUnlit.push([Math.round(x), Math.round(y)]);
  };
  for (let i = 0; i < points.length - 1; i += 1) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    const len = Math.hypot(x2 - x1, y2 - y1);
    const nx = -(y2 - y1) / len;
    const ny = (x2 - x1) / len;
    for (let s = 0; s <= Math.ceil(len); s += 1) {
      const t = s / Math.ceil(len);
      for (const off of [-half, -half / 2, 0, half / 2, half]) {
        test(x1 + (x2 - x1) * t + nx * off, y1 + (y2 - y1) * t + ny * off);
      }
    }
  }
  for (const [px, py] of points) {
    for (let a = 0; a < 32; a += 1) {
      const th = (a / 32) * Math.PI * 2;
      test(px + Math.cos(th) * half, py + Math.sin(th) * half);
    }
  }
  assert.deepEqual(onUnlit.slice(0, 5), [], `${onUnlit.length} samples of the stroke sit on the unlit half`);
});

test('each end of the meteor has contrast against the field it lands on', () => {
  // The taper is in value, not opacity, and it has to run the right way round.
  // The first draft faded 50%-opacity blue to near-white, which put the dim end
  // on the navy and the hot end on the gold — each on the one field it could
  // not be seen against. If someone flips these stops back, this fails.
  const stops = [...SVG.match(/<linearGradient id="meteor"[^>]*>([\s\S]*?)<\/linearGradient>/)[1]
    .matchAll(/stop-color="(#[0-9a-f]{6})"/g)].map((m) => m[1]);
  const [tail, , head] = stops;

  const LUNE_DARK = '#cbb98f'; // the lune's own gradient at its dark end
  const SKY = '#0a1030';

  assert.ok(luminance(tail) < luminance(head), 'the tail must be the darker end');
  assert.ok(contrast(tail, LUNE_DARK) >= 3, `tail on the gold is ${contrast(tail, LUNE_DARK).toFixed(2)}:1`);
  assert.ok(contrast(head, SKY) >= 4.5, `head on the sky is ${contrast(head, SKY).toFixed(2)}:1`);
});

test('the icon carries no baked corner radius', () => {
  // Every platform masks this itself; a pre-rounded asset gets rounded twice or
  // shows dark corners. The rounding lives in the maskable variant only.
  assert.ok(!/<rect[^>]*\brx=/.test(SVG), 'the background rect must stay square');
  assert.match(SVG, /<rect width="512" height="512" fill="url\(#bg\)" \/>/);
});

test('the stars match in both renderers', () => {
  const stars = circles().filter((c) => c.r <= 11 && c.fill === null);
  assert.equal(stars.length, 4, 'four stars, and they inherit fill from their group');
  const listed = [...RASTER.match(/const stars = \[([\s\S]*?)\];/)[1]
    .matchAll(/\[([\d.]+), ([\d.]+), ([\d.]+), ([\d.]+)\]/g)]
    .map((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
  assert.equal(listed.length, stars.length);
  for (const [i, star] of stars.entries()) {
    const [sx, sy, sr] = listed[i];
    assert.ok(Math.abs(sx * 512 - star.cx) < 0.5, `star ${i} x`);
    assert.ok(Math.abs(sy * 512 - star.cy) < 0.5, `star ${i} y`);
    assert.ok(Math.abs(sr * 512 - star.r) < 0.5, `star ${i} r`);
    // Fat on purpose: r=4 on a 512 canvas is under half a pixel at 60x60.
    assert.ok((star.r / 512) * 60 >= 0.6, `star ${i} disappears at 60px`);
  }
});
