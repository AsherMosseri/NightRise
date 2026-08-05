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

test('a double tap on a control cannot zoom the page', () => {
  /* This app is a fixed-viewport layer cake: the sky canvas is `position:
     fixed; inset: 0` and the page gradient is `background-attachment: fixed`.
     Both are sized to the LAYOUT viewport. iOS keeps double-tap-to-zoom on by
     default, and the moment it zooms the VISUAL viewport in, neither covers
     what you are looking at — the night sky is simply gone behind whatever
     panel is open. That is the "double-tap a button in the market and the
     background disappears" report, and why it hit some buttons and not others.

     `manipulation` drops the double-tap gesture and keeps pinch-zoom, which has
     to stay: killing zoom outright would take a real accessibility affordance
     from someone reading at 1am. */
  const base = readFileSync(new URL('../css/base.css', import.meta.url), 'utf8');
  const rule = base.match(/([^{}]*\[role="button"\][^{}]*)\{([^}]*touch-action[^}]*)\}/);
  assert.ok(rule, 'css/base.css no longer gives interactive elements a touch-action');
  assert.match(rule[2], /touch-action:\s*manipulation/);
  for (const el of ['button', 'a', 'label', 'input', 'select', 'textarea']) {
    assert.match(rule[1], new RegExp(`(^|[\\s,])${el}([\\s,]|$)`), `${el} is not covered`);
  }

  // And the viewport must not have solved it the other way.
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /user-scalable\s*=\s*no|maximum-scale/,
    'pinch-zoom stays: the fix is touch-action, not banning zoom');
});

test('no hover style escapes the pointer gate', () => {
  /* iOS keeps `:hover` on the last thing you tapped until you tap something
     else, so on a phone every hover rule is a STATE that arrives on the first
     tap. That is fatal here because hover styles and state styles target the
     same elements: an unguarded `.tab:hover { background: none }` also beats
     `.tab.is-active`, so the tab you touched lost its pill and went muted, and
     `.btn:hover { background: var(--panel) }` beat `.btn--primary`, leaving a
     Buy button as near-black text on a near-black plate.

     This was previously answered by a `@media (hover: none)` block that
     re-declared each hover rule with a neutral value — which is what produced
     both of those, because a neutral value is only neutral for an element that
     has no state. Every hover rule is gated at its source now, and the whole
     point is that nothing gets to opt out. */
  const files = ['base', 'components', 'layout', 'themes'];
  const offenders = [];
  for (const name of files) {
    const css = readFileSync(new URL(`../css/${name}.css`, import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    // Walk the file tracking which at-rule preludes we are inside.
    const stack = [];
    let i = 0;
    let chunk = 0;
    while (i < css.length) {
      const c = css[i];
      if (c === '{') {
        const prelude = css.slice(chunk, i).trim().split('\n').pop().trim();
        if (prelude.startsWith('@')) stack.push(prelude);
        else {
          const selector = css.slice(chunk, i).trim();
          if (selector.includes(':hover') && !stack.some((a) => /hover:\s*hover/.test(a))) {
            offenders.push(`${name}.css: ${selector.split('\n').pop().trim().slice(0, 60)}`);
          }
          stack.push(null);
        }
        chunk = i + 1;
      } else if (c === '}') {
        stack.pop();
        chunk = i + 1;
      }
      i += 1;
    }
  }
  assert.deepEqual(offenders, [],
    `these hover rules apply on touch, where they are sticky state:\n  ${offenders.join('\n  ')}`);
});

test('the neutralising block is gone, and stays gone', () => {
  // Re-declaring a hover rule to undo it cannot work: the undo value has to
  // equal the element's own non-hover value, which for anything with a state
  // is not one value. Four collisions had already been hand-patched inside it.
  const css = readFileSync(new URL('../css/components.css', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks = [...css.matchAll(/@media \(hover: none\)[^{]*\{([\s\S]*?)\n\}/g)];
  for (const [, body] of blocks) {
    assert.ok(!body.includes(':hover'),
      'a @media (hover: none) block is neutralising hover rules again — gate them '
      + 'at the source with @media (hover: hover) instead');
  }
});

/* --------------------------------------------- the pacing chip's status word */

const LAYOUT = readFileSync(new URL('../css/layout.css', import.meta.url), 'utf8');

test('the last-call status word is not painted in a neat accent', () => {
  // 12.5px at 700 is normal text under WCAG, so 4.5:1 applies as painted — and
  // neat --bad under this state's own `brightness(0.90) saturate(0.42)` veil
  // measured 2.55-4.45:1 across the twelve skies, which put the loudest state
  // below the plain past-bedtime chip it is meant to outrank. Mixed toward
  // --text it clears AA in all four veil combinations at 4.63:1 worst.
  const rule = LAYOUT.match(/\.pacing--lastcall \.pacing__label\s*\{([^}]*)\}/)?.[1];
  assert.ok(rule, 'the last-call label has no rule of its own');
  assert.match(rule, /color-mix\([^)]*var\(--bad\)[^)]*--pace-mix/,
    'it has to mix --bad toward --text rather than take it neat');
  assert.doesNotMatch(rule, /color:\s*var\(--bad\)\s*;/, 'and not also set it neat');
});

test('the other five pacing states are left exactly as they were', () => {
  // Deliberate scope. They are marginal under sleep-safe dim as well, but that
  // predates last call and is not this state's doing — changing how an ordinary
  // evening looks is a separate decision, not a side effect of this one.
  for (const [state, tone] of [['ahead', 'good'], ['clear', 'good'], ['tight', 'warn'],
    ['over', 'bad'], ['past', 'bad']]) {
    const re = new RegExp(`\\.pacing--${state} \\.pacing__label[^{]*\\{[^}]*color:\\s*var\\(--${tone}\\)`);
    assert.match(LAYOUT, re, `.pacing--${state} should still take --${tone} neat`);
  }
});

test('both veils at once drain the last-call chip further', () => {
  assert.match(CSS, /\.is-dim \.pacing--lastcall\s*\{[^}]*--pace-mix/,
    'stacked on sleep-safe dim the mixed label is still under AA without this');
  assert.match(CSS, /\.is-dim \.pacing--lastcall\s*\{[^}]*background:\s*var\(--panel-2\)/,
    'and the tinted fill has to go, since it raises the plate under the label');
  assert.doesNotMatch(CSS, /\.is-dim \.pacing\s*\{/,
    'scoped to the last-call chip, not to every pacing state');
});

test('no dim escape list filters a toast that is already inside a filtered dialog', () => {
  // #toasts-modal lives inside <dialog id="modal">, so a bare `.toast` in these
  // lists applied the filter a second time on top of the dialog's own —
  // 0.66 x 0.66 — and the toast came out darker than the panel it was raised on.
  const bare = [...CSS.matchAll(/^\.is-[a-z.-]*\s+\.toast,$/gm)];
  assert.deepEqual(bare.map((m) => m[0]), [],
    'scope the toast rule to #toasts so the modal host inherits it once');
  const scoped = [...CSS.matchAll(/^\.is-[a-z.-]*\s+#toasts \.toast,$/gm)];
  assert.equal(scoped.length, 3, 'all three escape lists (dim, lastcall, both) scope it');
});

test('no swatch rule uses the background shorthand', () => {
  /* A gradient swatch has a border, and CSS paints a background out to the
     BORDER box while sizing it to the PADDING box — then repeats it, because
     `background-repeat` defaults to `repeat`. So the one-pixel overhang on the
     right and bottom was filled with the start of the next tile, and every sky
     in the market ended on a hairline of its own first colour. Measured on Deep
     Space: the last column sat 12 units from the gradient's opening pink and
     174 from the pixel beside it.

     `.swatch` fixes it with `background-origin: border-box` and
     `background-repeat: no-repeat`. The trap is that a shorthand resets every
     longhand it does not name, so a single `background: linear-gradient(...)`
     further down puts both straight back — which is what happened on the first
     attempt at this fix, and it looked identical to not having fixed it. Every
     swatch rule therefore declares `background-image` or `background-color`,
     and this fails if one goes back to the shorthand. */
  const files = ['../css/themes.css', '../css/components.css', '../css/layout.css', '../css/base.css'];
  const offenders = [];
  for (const file of files) {
    const text = readFileSync(new URL(file, import.meta.url), 'utf8');
    // Each rule, as selector + body.
    for (const [, selector, body] of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!selector.includes('.swatch')) continue;
      if (/(^|[;\s])background\s*:/.test(body)) {
        offenders.push(`${file}  ${selector.trim().split('\n').pop().trim()}`);
      }
    }
  }
  assert.deepEqual(offenders, [], 'these reset background-origin and background-repeat');
});

test('the swatch box keeps its background inside its own edges', () => {
  const rule = CSS.match(/\.swatch\s*\{([^}]*)\}/);
  assert.ok(rule, '.swatch is gone');
  assert.match(rule[1], /background-origin:\s*border-box/,
    'the gradient is sized to the padding box and painted to the border box');
  assert.match(rule[1], /background-repeat:\s*no-repeat/,
    'and the overhang is filled from the next tile');
});
