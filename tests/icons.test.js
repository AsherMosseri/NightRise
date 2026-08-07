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
 * the source of truth describes is the picture the build emits, and it pins the
 * one property that took several attempts to get right: that the checkmark is
 * legible against whatever is behind it.
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

/** The checkmark's polyline and stroke, from the SVG. */
function checkPath() {
  const m = SVG.match(/<path d="((?:M|L)[^"]*)" fill="none" stroke="(#[0-9a-f]{6})" stroke-width="(\d+)"/);
  assert.ok(m, 'the checkmark path is not the shape this test knows how to read');
  return {
    points: [...m[1].matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((p) => [Number(p[1]), Number(p[2])]),
    stroke: m[2],
    width: Number(m[3]),
  };
}

/** The moon, as the SVG draws it. */
function moon() {
  const disc = circles().filter((c) => c.fill === '#39457e' || c.stroke === '#5866a8');
  assert.equal(disc.length, 2, 'expected a filled disc and a rim stroke');
  const fill = Number(RASTER.match(/const FILL = ([\d.]+);/)[1]);
  return { cx: disc[0].cx, cy: disc[0].cy, r: disc[0].r, fill, rx: disc[0].r * Math.abs(1 - 2 * fill) };
}

/* --- colour maths, so the contrast claims in the SVG's comments are checked --- */
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

// The three fields the mark can lie on, at their worst point for a blue stroke.
const SKY = '#0a1030';
const UNLIT = '#39457e';
const GOLD = '#cbb98f';

/** Which field is behind a point: 'sky', 'unlit' or 'gold'. */
function fieldAt(x, y, m) {
  if (Math.hypot(x - m.cx, y - m.cy) > m.r) return 'sky';
  const ex = (x - m.cx) / m.rx;
  const ey = (y - m.cy) / m.r;
  return (x >= m.cx || ex * ex + ey * ey <= 1) ? 'gold' : 'unlit';
}

/** Walk the stroke's covered area, yielding [x, y, field] samples. */
function* strokeSamples(step = 1) {
  const { points, width } = checkPath();
  const m = moon();
  const half = width / 2;
  for (let i = 0; i < points.length - 1; i += 1) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    const len = Math.hypot(x2 - x1, y2 - y1);
    const nx = -(y2 - y1) / len;
    const ny = (x2 - x1) / len;
    const steps = Math.ceil(len / step);
    for (let s = 0; s <= steps; s += 1) {
      const t = s / steps;
      for (const off of [-half, -half / 2, 0, half / 2, half]) {
        const x = x1 + (x2 - x1) * t + nx * off;
        const y = y1 + (y2 - y1) * t + ny * off;
        yield [x, y, fieldAt(x, y, m)];
      }
    }
  }
  // The round caps bulge half a width past each endpoint.
  for (const [px, py] of points) {
    for (let a = 0; a < 48; a += 1) {
      const th = (a / 48) * Math.PI * 2;
      const x = px + Math.cos(th) * half;
      const y = py + Math.sin(th) * half;
      yield [x, y, fieldAt(x, y, m)];
    }
  }
}

test('the moon is in the same place in both renderers', () => {
  const m = moon();
  assert.equal(m.cx, units('MOON_X'));
  assert.equal(m.cy, units('MOON_Y'));
  assert.equal(m.r, units('MOON_R'));

  const disc = circles().filter((c) => c.fill === '#39457e' || c.stroke === '#5866a8');
  assert.equal(disc[0].fill, color('MOON_UNLIT'));
  assert.equal(disc[1].stroke, color('MOON_RIM'));

  const glow = circles().find((c) => c.fill === 'url(#glow)');
  assert.equal(glow.r, units('GLOW_R'), 'the glow radius drifted between renderers');
  assert.deepEqual([glow.cx, glow.cy], [m.cx, m.cy], 'the glow is concentric with the moon');
});

test('the lit lune is at the fill fraction the rasteriser uses', () => {
  // The lune is a right semicircle joined to a terminator ellipse whose
  // x-radius is r * |1 - 2f| — the geometry sky.js drawMoon() uses. Recover it
  // from the path and check it against FILL.
  const m = moon();
  const d = SVG.match(/<path d="M(\d+) (\d+) A(\d+) \3 0 0 1 \1 (\d+) A(\d+) \3 0 0 1 \1 \2 Z"/);
  assert.ok(d, 'the lune path is not the shape this test knows how to read');
  const [, cx, top, r, bottom, rx] = d.map(Number);
  assert.equal(cx, m.cx);
  assert.equal(r, m.r);
  assert.equal(Number(top), m.cy - m.r);
  assert.equal(Number(bottom), m.cy + m.r);
  assert.equal(rx, Math.round(m.rx));
  assert.ok(m.fill > 0.5 && m.fill < 0.75, 'gibbous on purpose: a half moon reads as a shape, not a moon');
});

test('the checkmark follows the same path in both renderers', () => {
  const { points, width, stroke } = checkPath();
  const raster = RASTER.match(/const CHECK = (\[\[[\s\S]*?\]\]);/)[1];
  const rasterPoints = [...raster.matchAll(/\[(-?[\d.]+) \/ 512, (-?[\d.]+) \/ 512\]/g)]
    .map((p) => [Number(p[1]), Number(p[2])]);
  assert.deepEqual(rasterPoints, points);
  assert.equal(units('CHECK_W'), width / 2, 'the rasteriser stores the half-width');
  assert.equal(stroke, color('CHECK_COLOR'));
});

test('it is a checkmark: down-right into a vertex, then up-right and past', () => {
  const { points } = checkPath();
  assert.equal(points.length, 3, 'a check is two segments');
  const [start, vertex, tip] = points;
  assert.ok(vertex[1] > start[1] && vertex[1] > tip[1], 'the vertex is the lowest point');
  assert.ok(start[0] < vertex[0] && vertex[0] < tip[0], 'it travels left to right throughout');
  assert.ok(tip[1] < start[1], 'the long arm ends above where the short arm began');
});

test('the checkmark reaches into the moon without being swallowed by it', () => {
  // Two failure modes, opposite each other. Clear of the moon entirely, the mark
  // reads as scenery rather than as a second subject — that is what an earlier
  // draft did, with the meteor parked up in a corner. Laid across the lit face,
  // it goes illegible, which is what the draft after that did. It has to touch
  // and no more.
  const counts = { sky: 0, unlit: 0, gold: 0 };
  let total = 0;
  for (const [, , field] of strokeSamples()) { counts[field] += 1; total += 1; }

  const onMoon = (counts.unlit + counts.gold) / total;
  assert.ok(onMoon > 0.03, `the mark only touches the moon over ${(onMoon * 100).toFixed(1)}% of itself`);
  assert.ok(onMoon < 0.35, `${(onMoon * 100).toFixed(0)}% of the mark is on the moon; it should mostly be on the sky`);
  assert.ok(counts.sky / total > 0.6, 'most of the mark belongs on the dark sky, where the contrast is');
});

test('the checkmark is legible along its whole length', () => {
  // This is the property several drafts got wrong, and it cannot be seen by
  // reading the file. The accent blue measures 7.09:1 on the sky, 3.44:1 on the
  // moon's unlit half and 1.36:1 on its lit face — so where the mark lies
  // decides whether it can be seen, and no choice of blue rescues a bad
  // placement: a blue deep enough for the gold (7.71:1) drops to 1.17:1 on the
  // navy. One draft ran the mark across the lit face and measured 1.74:1 median
  // with 87% of its length under 3:1.
  const { stroke } = checkPath();
  const behind = { sky: SKY, unlit: UNLIT, gold: GOLD };

  const ratios = [];
  for (const [, , field] of strokeSamples()) ratios.push(contrast(stroke, behind[field]));
  ratios.sort((a, b) => a - b);

  const median = ratios[Math.floor(ratios.length / 2)];
  const weak = ratios.filter((r) => r < 3).length / ratios.length;

  // 3.0 is the meaningful floor: blue on the unlit navy is 3.44:1, so anything
  // below it means some of the stroke — usually a round cap overhanging the
  // terminator by a few pixels — has crept onto the lit face. That exact bug was
  // live and invisible until this swept the stroke's full width rather than its
  // centreline, which measured a comfortable 2.30:1 while the cap sat at 1.36.
  assert.ok(median >= 6, `median contrast along the mark is ${median.toFixed(2)}:1`);
  assert.ok(ratios[0] >= 3, `weakest point on the mark is ${ratios[0].toFixed(2)}:1`);
  assert.ok(weak === 0, `${(weak * 100).toFixed(1)}% of the mark is under 3:1`);
});

test('the checkmark survives being looked at small', () => {
  const { width } = checkPath();
  // At the 29px an iPhone home screen actually renders, a stroke this wide is
  // width/512*29 device pixels. Under one and it is a smudge.
  assert.ok((width / 512) * 29 >= 1.5, `${((width / 512) * 29).toFixed(2)}px at 29px is too thin to read`);
});

test('the icon carries no baked corner radius', () => {
  // Every platform masks this itself; a pre-rounded asset gets rounded twice or
  // shows dark corners. The rounding lives in the maskable variant only.
  assert.ok(!/<rect[^>]*\brx=/.test(SVG), 'the background rect must stay square');
  assert.match(SVG, /<rect width="512" height="512" fill="url\(#bg\)" \/>/);
});

test('the stars match in both renderers', () => {
  const stars = circles().filter((c) => c.fill === null && c.stroke === null);
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
