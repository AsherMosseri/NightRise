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
