/* Skies are CSS, which no other test in here reads — so a sky could ship
   missing a property and nothing would say so. It would not throw either: a
   custom property the theme omits simply inherits, so the canvas would draw the
   *previous* sky's moon on the new one's gradient and look merely odd.

   These parse css/themes.css and check the two things a sky has to get right:
   it defines everything, and you can read the app in it. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { THEMES } from '../js/skins.js';

const CSS = readFileSync(new URL('../css/themes.css', import.meta.url), 'utf8');

function themeBlocks() {
  const blocks = {};
  const re = /\[data-theme="([a-z]+)"\]\s*\{([^}]*)\}/g;
  let match = re.exec(CSS);
  while (match) {
    blocks[match[1]] = match[2];
    match = re.exec(CSS);
  }
  // `:root` doubles as the default sky, so it is not matched by the loop above.
  const root = CSS.match(/:root,\s*\[data-theme="midnight"\]\s*\{([^}]*)\}/);
  if (root) blocks.midnight = root[1];
  return blocks;
}

const propsOf = (body) => new Set([...body.matchAll(/(--[a-z0-9-]+):/g)].map((m) => m[1]));
const valuesOf = (body) => Object.fromEntries(
  [...body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
);

function luminance(hex) {
  const parts = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2];
}

function contrast(a, b) {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

test('every sky in the market has a block in the stylesheet', () => {
  const blocks = themeBlocks();
  for (const theme of THEMES) {
    assert.ok(blocks[theme.id], `the market sells "${theme.id}" and css/themes.css has no block for it`);
  }
});

test('every sky defines the whole contract', () => {
  // The contract is what the skies that shipped first all define — not what
  // `:root` defines, which also carries --good/--warn/--bad. Those are semantic
  // status colours, deliberately global, and no sky overrides them.
  const blocks = themeBlocks();
  const original = ['aurora', 'deepspace', 'city', 'frost', 'bloodmoon'];
  let contract = null;
  for (const id of original) {
    const props = propsOf(blocks[id]);
    contract = contract ? new Set([...contract].filter((p) => props.has(p))) : props;
  }
  assert.ok(contract.size >= 20, 'the contract itself looks wrong');

  for (const theme of THEMES) {
    if (theme.id === 'midnight') continue; // :root, which carries more
    const props = propsOf(blocks[theme.id]);
    const missing = [...contract].filter((p) => !props.has(p));
    assert.deepEqual(missing, [], `${theme.id} is missing ${missing.join(', ')}`);
  }
});

test('you can read the app in every sky', () => {
  // Against --panel-solid, which is what the cards, the market and the sheets
  // sit on. Body text at AA, and secondary text held to the same bar rather
  // than the large-text exemption: "47m of tasks left" is small and it is 11pm.
  const blocks = themeBlocks();
  for (const theme of THEMES) {
    const v = valuesOf(blocks[theme.id]);
    const panel = v['--panel-solid'];
    assert.ok(contrast(v['--text'], panel) >= 4.5,
      `${theme.id}: body text is ${contrast(v['--text'], panel).toFixed(1)}:1`);
    assert.ok(contrast(v['--muted'], panel) >= 4.5,
      `${theme.id}: secondary text is ${contrast(v['--muted'], panel).toFixed(1)}:1`);
  }
});

test('every sky has a swatch, and it is its own', () => {
  // The card shows a gradient per sky. A missing rule is an empty grey box on a
  // thing you are being asked to pay 1,680 stardust for.
  const seen = new Set();
  for (const theme of THEMES) {
    const rule = new RegExp(`\\.swatch--theme\\.swatch--${theme.id}\\s*\\{([^}]*)\\}`);
    const match = CSS.match(rule);
    assert.ok(match, `${theme.id} has no swatch`);
    assert.ok(!seen.has(match[1].trim()), `${theme.id}'s swatch is a copy of another sky's`);
    seen.add(match[1].trim());
  }
});

test('the canvas can read a moon and a star out of every sky', () => {
  // js/sky.js pulls these back through getComputedStyle every time the theme
  // changes. A sky that omits one inherits the last sky's value, which is how
  // you get one sky's moon hanging in another's gradient.
  const blocks = themeBlocks();
  for (const theme of THEMES) {
    const v = valuesOf(blocks[theme.id]);
    for (const prop of ['--sky-star', '--sky-star-dim', '--moon', '--moon-shadow', '--trail', '--glow', '--accent']) {
      assert.ok(v[prop], `${theme.id} has no ${prop} for the canvas to read`);
    }
    assert.ok(contrast(v['--moon'], v['--moon-shadow']) >= 3,
      `${theme.id}: the moon's lit and unlit halves are too close to tell apart`);
  }
});

test('no sky can tile, and none carries its attachment per layer', () => {
  // A gradient is an image, and an image whose positioning area is smaller than
  // the area being painted TILES — showing the start of the next copy as a hard
  // line of the gradient's first colour down one edge.
  //
  // Every multi-layer sky used to write `fixed` on its last layer only, so the
  // rest defaulted to `scroll`: one background, two positioning areas, which is
  // the mismatch that can produce that line. The attachment is declared once in
  // css/base.css now and applies to every layer, so no sky may carry its own.
  const blocks = themeBlocks();
  for (const theme of THEMES) {
    const value = valuesOf(blocks[theme.id])['--bg-base'] || '';
    assert.ok(!/\bfixed\b/.test(value),
      `${theme.id} pins its own background-attachment; base.css owns that for every layer`);
    assert.ok(!/\brepeat\b/.test(value), `${theme.id} sets its own repeat`);
  }

  // And the four declarations that make the artifact impossible whatever the
  // geometry does, on the body plus a flat night colour on the root.
  const base = readFileSync(new URL('../css/base.css', import.meta.url), 'utf8');
  for (const decl of [
    'background-repeat: no-repeat',
    'background-size: cover',
    'background-attachment: fixed',
    'background-color: var(--sky-1)',
  ]) {
    assert.ok(base.includes(decl), `css/base.css no longer says "${decl}"`);
  }
  assert.match(base, /html \{ background-color: var\(--sky-1\); \}/,
    'the root needs its own night colour, or the body background is handed to '
    + 'the canvas and its positioning area is computed against a different box');

  // The shorthand would reset all four back to their initial values.
  assert.ok(!/^\s*background: var\(--bg-base\)/m.test(base),
    'the shorthand resets repeat, size, attachment and colour — use background-image');
});

test('the hidden attribute outranks a component that sets display', () => {
  /* The browser hides `hidden` elements with `[hidden] { display: none }` in
     its own stylesheet, which any author rule setting `display` beats. So a
     component styled `display: flex` and then hidden from JS stayed fully on
     screen while its own code believed it was gone — One Card's "you are
     already partway in" line did that over a visibly running clock, and the
     timer button beside it had needed a one-off patch for the same reason.

     One rule settles it for every component, present and future, and it has to
     carry !important or it is just another rule of the same specificity. */
  const base = readFileSync(new URL('../css/base.css', import.meta.url), 'utf8');
  assert.match(base, /\[hidden\] \{ display: none !important; \}/,
    'css/base.css needs the global [hidden] rule');

  // And nothing may hand a hidden element a display back. Comments stripped
  // first: the rule above is explained in prose that quotes the selector.
  const all = ['base', 'components', 'themes']
    .map((f) => readFileSync(new URL(`../css/${f}.css`, import.meta.url), 'utf8'))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const offenders = [...all.matchAll(/([^{}]*\[hidden\][^{}]*)\{([^}]*)\}/g)]
    .filter((m) => !/^\s*\[hidden\]\s*$/.test(m[1]) && /display\s*:/.test(m[2]))
    .map((m) => m[1].trim());
  assert.deepEqual(offenders, [], `${offenders.join(', ')} re-declares display on a hidden element`);
});
