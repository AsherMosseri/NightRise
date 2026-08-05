/* The market is a catalog on one side and a renderer on the other, and nothing
   made them agree. A trail could be sold with no spec to draw it; a companion
   could be sold and come out as a different animal. These tests are the join. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  THEMES, SOUND_PACKS, TRAILS, FONTS, CONSUMABLES, allItems, itemById,
} from '../js/shop.js';
import { WEATHER, MOONS, MARKS, ENVELOPES } from '../js/skins.js';
import { packTones } from '../js/audio.js';
import { markIconName } from '../js/dom.js';
import { soundAt, soundTint } from '../js/render/modals.js';
import { COMPANIONS, SPECIES_IDS } from '../js/companion.js';
import { TRAIL_IDS, trailSpec } from '../js/sky.js';
import { createProfile, createInitialState } from '../js/model.js';
import { equipItem, buyConsumable, canBuy, purchase } from '../js/shop.js';
import { MOMENTUM_MIN_GAP_MS } from '../js/game.js';
import { getState, replaceState } from '../js/state.js';
import { normalizeState } from '../js/storage.js';

/* Skies are the one shelf still drawn by a CSS rule per id, so the test that
   nothing is sold behind an empty picture has to read the stylesheet. */
const THEME_CSS = readFileSync(new URL('../css/themes.css', import.meta.url), 'utf8');

const CATALOGS = [
  ['themes', THEMES], ['weather', WEATHER], ['moons', MOONS],
  ['sounds', SOUND_PACKS], ['trails', TRAILS], ['marks', MARKS],
  ['envelopes', ENVELOPES], ['fonts', FONTS], ['companions', COMPANIONS],
];

test('every id in the market is unique and resolves', () => {
  const items = allItems();
  const ids = items.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length, 'two items share an id');
  for (const item of items) {
    assert.ok(itemById(item.id), `${item.id} is listed but does not resolve`);
  }
  for (const [, list] of CATALOGS) {
    for (const item of list) {
      assert.ok(typeof item.name === 'string' && item.name, `${item.id} has no name`);
      assert.ok(typeof item.desc === 'string' && item.desc, `${item.id} has no description`);
      assert.ok(Number.isFinite(item.cost) && item.cost >= 0, `${item.id} has no cost`);
    }
  }
});

/**
 * What each shelf's card reads to draw its picture. A shelf that is not in here
 * has no preview at all, which is the failure this test exists for: sounds and
 * trails were drawn by hand-written CSS, one rule per id, and when both shelves
 * were deepened the rules were not — so Kalimba, Temple Bell, Pulse, Embers,
 * Moondust and Ripple all showed an empty box, on cards priced 690 to 950. The
 * CSS was silent about it and so was every test.
 */
const PREVIEW_SOURCE = {
  themes: (item) => THEME_CSS.includes(`.swatch--theme.swatch--${item.id} `),
  sounds: (item) => packTones(item.id).length > 0,
  trails: (item) => item.id === 'none' || Boolean(trailSpec(item.id)),
  moons: (item) => Boolean(item.disc),
  horizons: (item) => item.id === 'open' || Boolean(item.points?.length),
  weather: (item) => item.id === 'clear' || Boolean(item.count),
  marks: (item) => markIconName({ profile: { equipped: { mark: item.id } } }) === `mark:${item.id}`,
  envelopes: (item) => Boolean(item.paper),
  fonts: (item) => Boolean(item.stack),
  companions: (item) => SPECIES_IDS.includes(item.id),
};

test('nothing in the market is sold behind an empty picture', () => {
  const items = allItems();
  assert.ok(items.length > 50, 'the market got smaller — check this list still covers it');
  for (const item of items) {
    const has = PREVIEW_SOURCE[item.bucket];
    assert.ok(has, `no shelf rule for "${item.bucket}" — a whole shelf could be drawing nothing`);
    assert.ok(has(item), `"${item.name}" (${item.bucket}/${item.id}) has nothing to draw on its card`);
  }
});

test('a sound card is a transcript of the sound behind the Preview button', () => {
  // The picture is recorded from the same call the button plays, so the two
  // cannot describe different sounds. The quiet pack has to read as quiet and
  // the high one as high, or the drawing is decoration rather than a preview.
  const gain = (id) => Math.max(...packTones(id).map((t) => t.gain));
  const pitch = (id) => Math.max(...packTones(id).map((t) => t.freq));
  assert.ok(gain('bell') < gain('pulse'), 'Temple Bell is the quiet one, and the card must show it');
  assert.ok(pitch('crickets') > pitch('bell') * 4, 'a chirp and a temple bell drew the same height');
  for (const pack of SOUND_PACKS) {
    for (const tone of packTones(pack.id)) {
      assert.ok(tone.freq > 0 && tone.dur > 0, `${pack.id} records a tone with no shape`);
    }
  }
});

test('every trail the market sells is a trail the sky can draw', () => {
  // Trail behaviour used to be five ternaries scattered across the emitter and
  // the renderer. Selling one the renderer has never heard of would have drawn
  // the default and charged you for it.
  for (const trail of TRAILS) {
    assert.ok(TRAIL_IDS.includes(trail.id) || trail.id === 'none',
      `the market sells "${trail.id}" and js/sky.js cannot draw it`);
  }
});

test('every companion the market sells is a species that can be drawn', () => {
  // The species chain's final `else` was the bat, so a companion added to the
  // catalog and not to the chain was sold, paid for, and rendered as a bat.
  for (const companion of COMPANIONS) {
    assert.ok(SPECIES_IDS.includes(companion.id),
      `the market sells "${companion.id}" and js/companion.js cannot draw it`);
  }
});

test('every category has exactly one free default, and you already own it', () => {
  // A category whose free entry is missing from the starting inventory opens
  // with nothing equipped; one with two free entries has an arbitrary winner.
  const profile = createProfile();
  for (const [bucket, list] of CATALOGS) {
    const free = list.filter((item) => item.cost === 0);
    if (bucket === 'companions') {
      assert.equal(free.length, 0, 'companions are all paid for on purpose');
      continue;
    }
    assert.equal(free.length, 1, `${bucket} has ${free.length} free entries, not one`);
    assert.ok(profile.inventory[bucket].includes(free[0].id),
      `${bucket} opens without owning its free default`);
  }
});

test('every equipped slot has a default and every default is owned', () => {
  const profile = createProfile();
  for (const [slot, id] of Object.entries(profile.equipped)) {
    if (id === null) continue; // companion is deliberately nullable
    assert.ok(typeof id === 'string', `equipped.${slot} has no default`);
    assert.ok(itemById(id), `equipped.${slot} is "${id}", which is not in the market`);
  }
});

test('a save from before a category existed picks up its free default', () => {
  // Inventory buckets have always arrived by merging the factory's defaults in.
  // `equipped` did not, so the slot came back undefined and every renderer for
  // a new category would have needed its own fallback.
  const before = {
    version: 2,
    profile: {
      xp: 900,
      stardust: 50,
      equipped: { theme: 'aurora', companion: null },
      inventory: { themes: ['midnight', 'aurora'] },
    },
  };
  const after = normalizeState(before, new Date(2026, 6, 29, 22, 0)).profile;
  const fresh = createProfile();
  for (const [slot, fallback] of Object.entries(fresh.equipped)) {
    if (slot === 'theme') continue;
    assert.equal(after.equipped[slot], fallback, `equipped.${slot} did not arrive`);
  }
  for (const bucket of Object.keys(fresh.inventory)) {
    assert.ok(Array.isArray(after.inventory[bucket]), `inventory.${bucket} did not arrive`);
  }
  assert.equal(after.equipped.theme, 'aurora', 'what the save had equipped is kept');
  assert.equal(after.equipped.companion, null, 'and a deliberate null stays null');
  assert.equal(after.xp, 900, 'nothing else was touched');
});

test('consumables are priced and named', () => {
  assert.ok(CONSUMABLES.length >= 2);
  for (const item of CONSUMABLES) {
    assert.ok(item.name && item.desc && item.icon, `${item.id} is missing a field`);
    assert.ok(item.cost > 0, `${item.id} is free, which makes it infinite`);
  }
});

test('a head start cannot be bought twice in one night', () => {
  // It acts on tonight rather than becoming a token, so a second one is paying
  // again for a multiplier you already have and getting nothing to hold.
  const state = createInitialState(new Date(2026, 6, 29, 22, 0));
  state.profile.stardust = 5000;
  replaceState(state);
  assert.ok(buyConsumable('headstart'), 'the first one lands');
  const after = getState().profile.stardust;
  assert.ok(getState().night.combo >= 1.25, 'and it actually starts the momentum');
  assert.equal(buyConsumable('headstart'), null, 'the second is refused');
  assert.equal(getState().profile.stardust, after, 'and costs nothing');
});

test('a head start does not throw itself away on the next tap', () => {
  // `chainLengthFor` resets the chain when two check-offs land closer together
  // than MOMENTUM_MIN_GAP_MS. Stamping `lastDoneAt` at "now" would mean the
  // very next check-off looked instant and the prize evaporated — the same
  // subtlety the envelope's version of this had to get right.
  const state = createInitialState(new Date(2026, 6, 29, 22, 0));
  state.profile.stardust = 5000;
  replaceState(state);
  buyConsumable('headstart');
  assert.ok(Date.now() - getState().night.lastDoneAt >= MOMENTUM_MIN_GAP_MS,
    'the stamp is a full momentum window back, not now');
});

test('a second wind changes the quest, once, and never past a claim', () => {
  const state = createInitialState(new Date(2026, 6, 29, 22, 0));
  state.profile.stardust = 5000;
  replaceState(state);
  const before = getState().night.quest.id;
  assert.ok(buyConsumable('secondwind'));
  assert.notEqual(getState().night.quest.id, before, 'a different quest');
  assert.equal(buyConsumable('secondwind'), null, 'and only one a night');

  // A claimed quest is already paid for. Rerolling past it would either throw
  // the reward away or hand out a second one.
  const fresh = createInitialState(new Date(2026, 6, 29, 22, 0));
  fresh.profile.stardust = 5000;
  fresh.night.quest.claimed = true;
  replaceState(fresh);
  assert.equal(buyConsumable('secondwind'), null);
  assert.equal(getState().profile.stardust, 5000, 'refused, and not charged');
});

test('a rerolled quest is still a pure function of the night', () => {
  // Seeded off the night key plus how many rerolls it has had, so a reload
  // cannot shop for a quest by re-rolling until a good one comes up.
  const roll = (n) => {
    const state = createInitialState(new Date(2026, 6, 29, 22, 0));
    state.profile.stardust = 5000;
    replaceState(state);
    for (let i = 0; i < n; i += 1) {
      getState().night.rerolledKey = null; // a fresh night each time, same date
      buyConsumable('secondwind');
    }
    return getState().night.quest.id;
  };
  assert.equal(roll(1), roll(1), 'the same night and the same reroll give the same quest');
  assert.equal(roll(2), roll(2));
});

test('the whole market costs what the README says it costs', () => {
  // Quoted in prose and used to pace every sink. Measured, not remembered, and
  // `tools/economy-sim.mjs` prints both of these beside the nights-to-afford
  // figures — if this fails, run it and update the README from what it says.
  const open = allItems().filter((i) => i.shelf !== 'far');
  assert.equal(open.reduce((sum, item) => sum + (item.cost || 0), 0), 43130,
    'the market total moved');
  const far = allItems().filter((i) => i.shelf === 'far');
  assert.equal(far.reduce((sum, item) => sum + (item.cost || 0), 0), 20700,
    'the Far Shelf total moved');
});

test('a starting profile owns nothing it has not paid for', () => {
  const state = createInitialState(new Date(2026, 6, 29, 22, 0));
  for (const item of allItems()) {
    if (item.cost === 0) continue;
    assert.ok(!(state.profile.inventory[item.bucket] || []).includes(item.id),
      `a new player already owns ${item.id}`);
  }
});

test('equipping one category never reaches into another', () => {
  // The Aurora sky and the Aurora Sans typeface were both `aurora`, and
  // `itemById` searches every bucket with themes first. So the Equip button on
  // the typeface card looked up a *sky*: if you owned it your whole night
  // changed colour, and if you did not the tap did nothing at all — either way
  // the default typeface could not be put back once you had left it.
  const state = createInitialState(new Date(2026, 6, 29, 22, 0));
  state.profile.inventory.fonts = ['sans', 'mono'];
  state.profile.inventory.themes = ['midnight', 'aurora'];
  state.profile.equipped.font = 'mono';
  state.profile.equipped.theme = 'midnight';
  replaceState(state);

  equipItem('sans', 'fonts');
  assert.equal(getState().profile.equipped.font, 'sans', 'the default type went back on');
  assert.equal(getState().profile.equipped.theme, 'midnight', 'and the sky did not move');
});

test('a save written before the typeface was renamed is carried across', () => {
  const before = {
    version: 2,
    profile: {
      xp: 5000,
      stardust: 100,
      equipped: { theme: 'aurora', font: 'aurora' },
      inventory: { themes: ['midnight', 'aurora'], fonts: ['aurora', 'mono'] },
    },
  };
  const after = normalizeState(before, new Date(2026, 6, 29, 22, 0)).profile;
  assert.equal(after.equipped.font, 'sans');
  assert.deepEqual(after.inventory.fonts, ['sans', 'mono']);
  // Scoped to the two font fields. The sky of the same name is a different
  // thing that someone paid 400 stardust for.
  assert.equal(after.equipped.theme, 'aurora', 'the sky kept its id');
  assert.ok(after.inventory.themes.includes('aurora'), 'and is still owned');
});

test('a save written before the envelope shelf was restocked keeps what it bought', () => {
  const before = {
    version: 3,
    profile: {
      xp: 5000,
      stardust: 100,
      equipped: { envelope: 'oxblood' },
      inventory: { envelopes: ['plain', 'slate', 'oxblood'] },
    },
  };
  const after = normalizeState(before, new Date(2026, 6, 29, 22, 0)).profile;
  assert.equal(after.equipped.envelope, 'garden', 'the equipped skin came across by rank');
  assert.deepEqual(after.inventory.envelopes, ['plain', 'kraft', 'garden'],
    'and so did everything the save had paid for');
  for (const id of after.inventory.envelopes) {
    assert.ok(ENVELOPES.some((e) => e.id === id), `${id} is not on the shelf any more`);
  }
});

test('every moon keeps its craters on its face and its fill legible', () => {
  // The moon fills with tonight's completion. A skin whose lit and unlit halves
  // sit close together in luminance breaks the one mechanic the moon has.
  const lum = (hex) => {
    const parts = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2];
  };
  for (const moon of MOONS) {
    for (const [x, y, r] of moon.craters) {
      assert.ok(Math.hypot(x, y) + r < 0.95, `${moon.id} has a crater off the edge of the moon`);
    }
    assert.ok(moon.craterAlpha >= 0 && moon.craterAlpha <= 0.25, `${moon.id} craterAlpha`);
    if (moon.ring) assert.ok(moon.ring.scale >= 1.1 && moon.ring.scale <= 1.9, `${moon.id} ring`);
    if (moon.disc === 'theme') continue;
    const a = lum(moon.disc);
    const b = lum(moon.shadow);
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    assert.ok(ratio >= 3, `${moon.id} lit and unlit are only ${ratio.toFixed(1)}:1 apart`);
  }
});

test('weather stays inside the frame budget and stays calm', () => {
  // This runs at 60fps on a phone alongside the starfield and the trails, and it
  // runs at 11pm. Both of those are limits.
  for (const w of WEATHER) {
    assert.ok(w.count <= 90, `${w.id} spawns ${w.count} particles`);
    if (w.shape === 'band') assert.ok(w.count <= 8, `${w.id} draws ${w.count} gradients a frame`);
    assert.ok(Math.abs(w.vy) <= 1.2 && Math.abs(w.vx) <= 1.2, `${w.id} moves too fast for a bedtime app`);
    assert.ok(w.opacity <= 0.5, `${w.id} at ${w.opacity} would sit on top of the stars`);
  }
  assert.equal(WEATHER.find((w) => w.id === 'clear').count, 0, 'clear weather is no weather');
});

test('every mark is drawable and stays inside its viewBox', () => {
  for (const mark of MARKS) {
    const [x, y, w, h] = mark.box;
    assert.ok(x >= 0 && y >= 0 && x + w <= 24 && y + h <= 24, `${mark.id} box leaves the 24x24 box`);
    assert.ok(/^[Mm]/.test(mark.path), `${mark.id} path does not start with a move`);
  }
  const tick = MARKS.find((m) => m.id === 'check');
  assert.equal(tick.path, 'M4 12l6 6L20 6', 'the free mark is the tick, unchanged');
  assert.deepEqual(tick.box, [4, 6, 16, 12, 12.15, 12.76], 'to the digit js/dom.js already used');
});

test('every envelope is readable and none of them glare at midnight', () => {
  const lum = (hex) => {
    const parts = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2];
  };
  const contrast = (a, b) => {
    const x = lum(a);
    const y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  for (const env of ENVELOPES) {
    if (env.ink === 'theme') continue;
    // The ink sits on the note, not on the paper — colouring the text without
    // the surface under it is how dark ink on pale paper came out unreadable.
    assert.ok(contrast(env.ink, env.note) >= 4.5,
      `${env.id} ink is ${contrast(env.ink, env.note).toFixed(1)}:1 on its own note`);
    // The eyebrow is the same ink at 62% over the same note, at 11px uppercase,
    // and it is real text somebody reads. It falls away much faster than the
    // reel line does: an ink/note pair can clear 4.5 and leave the eyebrow at
    // 2.9, which is how a paper bright enough to wash it out gets in.
    const eyebrow = '#' + [1, 3, 5].map((i) => {
      const a = parseInt(env.ink.slice(i, i + 2), 16);
      const b = parseInt(env.note.slice(i, i + 2), 16);
      return Math.round(a * 0.62 + b * 0.38).toString(16).padStart(2, '0');
    }).join('');
    assert.ok(contrast(eyebrow, env.note) >= 4.5,
      `${env.id} eyebrow is ${contrast(eyebrow, env.note).toFixed(1)}:1 on its own note`);
    assert.ok(contrast(env.seal, env.paper) >= 1.6, `${env.id} seal vanishes into the paper`);
    // The seal is also the colour of the icon in every reel cell, on the note.
    assert.ok(contrast(env.seal, env.note) >= 1.9, `${env.id} reel icons vanish into the note`);
    assert.ok(contrast(env.flap, env.paper) >= 1.15,
      `${env.id} has no flap to speak of on the shop card, where it is drawn flat`);
    // 0.25 was written when nothing in the list was above 0.015 and is no kind
    // of ceiling: this card is 300x146 at z-index 62 and it opens itself the
    // moment the app does. The panel it floats over is 0.0093.
    assert.ok(lum(env.paper) < 0.04, `${env.id} is a bright rectangle at bedtime`);
  }
  // The seal is stamped with the same stroked-path machinery as a check-off
  // mark, so an emblem that is byte-identical to one is a glyph sold twice.
  const emblems = ENVELOPES.map((e) => e.sealPath).filter(Boolean);
  assert.equal(new Set(emblems).size, emblems.length, 'two envelopes share a seal');
  for (const path of emblems) {
    assert.ok(!MARKS.some((m) => m.path === path), `a seal is wearing a mark that is sold separately`);
  }
  const plain = ENVELOPES.find((e) => e.id === 'plain');
  assert.ok(Object.values(plain).every((v) => v !== 'theme' || true));
  assert.equal(plain.sealPath, null, 'the plain envelope has never had a seal');
  for (const key of ['paper', 'note', 'ink', 'flap', 'seal']) {
    assert.equal(plain[key], 'theme', `plain.${key} must defer to the sky, not restate it`);
  }
});

test('every shelf reads cheapest first', () => {
  // A shelf is a ladder. The catalogs are hand-edited and three of them had
  // drifted simply by having new entries appended, so Skies read 400, 700, 920,
  // 1150, 1550, 620, 840 — which looks arbitrary because it is.
  const buckets = {};
  for (const item of allItems()) (buckets[item.bucket] ||= []).push(item.cost || 0);
  for (const [bucket, costs] of Object.entries(buckets)) {
    for (let i = 1; i < costs.length; i += 1) {
      assert.ok(costs[i] >= costs[i - 1],
        `${bucket} goes ${costs[i - 1]} then ${costs[i]}`);
    }
  }
});

test('there is no price a night could fall into with nothing to buy', () => {
  // A gap between consecutive prices much larger than a night's earnings is a
  // stretch where the market has nothing to offer. A settled night pays about
  // 157, so any gap under that is invisible.
  //
  // The Far Shelf is deliberately not in here. Its prices are a second ladder
  // climbed on a different currency, and a gap in it is not a gap you can save
  // your way across — the whole point is that stardust cannot bring the next
  // rung any closer.
  const costs = [...allItems().filter((i) => i.shelf !== 'far'), ...CONSUMABLES]
    .map((i) => i.cost || 0)
    .filter(Boolean).sort((a, b) => a - b);
  let worst = 0;
  for (let i = 1; i < costs.length; i += 1) worst = Math.max(worst, costs[i] - costs[i - 1]);
  assert.ok(worst <= 400, `the biggest jump between prices is ${worst} stardust`);
});

test('nothing in the market is gated on anything but its price', () => {
  // There were level gates here, twice. Eleven hand-typed ones first, of which
  // nine never bound; then five derived from the measured curve, which did bind
  // — for three weeks. Every band was open by night 23 and never closed again,
  // while thirty-seven of sixty-seven cards went on wearing a "Level 12" chip
  // about a barrier that had been gone for months.
  //
  // Gating them on nights slept on time instead was measured and rejected: the
  // gated items are 80% of the market by cost, and at one on-time night in
  // seven the level-14 band would have moved from night 23 to night 161. That
  // is a reward turned into a restriction on the main sink, landing hardest on
  // whoever is sleeping worst — the Starlight mistake, at four times the scale.
  //
  // So price is the pacing, and this fails if a second condition comes back.
  for (const item of allItems()) {
    assert.equal(item.reqLevel, undefined, `${item.id} carries a level gate again`);
    if (item.shelf === 'far') continue;
    assert.equal(item.reqNights, undefined, `${item.id} carries a nights gate`);
  }
  const state = createInitialState(new Date(2026, 6, 29, 22, 0));
  state.profile.level = 1;
  state.profile.stardust = 99999;
  const dearest = allItems().filter((i) => i.shelf !== 'far')
    .reduce((a, b) => (b.cost > a.cost ? b : a));
  assert.equal(canBuy(state, dearest).ok, true,
    `${dearest.name} costs ${dearest.cost} and level 1 with the money cannot buy it`);
});

test('the only thing that refuses a sale is not having the stardust', () => {
  const state = createInitialState(new Date(2026, 6, 29, 22, 0));
  state.profile.level = 1;
  state.profile.stardust = 0;
  const item = allItems().find((i) => i.cost > 0 && i.shelf !== 'far');
  const poor = canBuy(state, item);
  assert.equal(poor.ok, false);
  assert.match(poor.reason, /more stardust$/);
  state.profile.stardust = item.cost;
  assert.equal(canBuy(state, item).ok, true);
});
test('a save from before any of this arrives whole and unchanged', () => {
  // The migration the whole expansion rests on: five categories, a renamed
  // typeface and a schema bump between this save and today. Everything new must
  // arrive at its free default, everything old must be exactly as it was, and
  // nothing may be handed over that was not paid for.
  const before = {
    version: 2,
    profile: {
      xp: 41_000,
      stardust: 640,
      streak: 12,
      bestStreak: 19,
      nightsLogged: 44,
      tokens: { freeze: 2, raincheck: 1 },
      equipped: { theme: 'frost', sounds: 'synth', trail: 'comet', font: 'aurora', companion: 'fox' },
      inventory: {
        themes: ['midnight', 'aurora', 'frost'],
        sounds: ['chime', 'synth'],
        trails: ['none', 'comet'],
        fonts: ['aurora'],
        companions: ['fox'],
      },
    },
  };
  const after = normalizeState(before, new Date(2026, 6, 29, 22, 0)).profile;

  // Everything they had, still theirs.
  assert.equal(after.xp, 41_000);
  assert.equal(after.streak, 12);
  assert.equal(after.nightsLogged, 44);
  assert.equal(after.equipped.theme, 'frost');
  assert.equal(after.equipped.sounds, 'synth');
  assert.equal(after.equipped.companion, 'fox');
  assert.ok(after.inventory.themes.includes('frost'));
  // The stardust was rebased once at v2 and must not be rebased twice.
  assert.equal(after.stardust, 640);

  // The typeface they had, under the id it has now.
  assert.equal(after.equipped.font, 'sans');
  assert.deepEqual(after.inventory.fonts, ['sans']);

  // Everything new, at its free default and owned.
  for (const [bucket, id] of [['weather', 'clear'], ['moons', 'classic'], ['marks', 'check'], ['envelopes', 'plain']]) {
    assert.ok(after.inventory[bucket].includes(id), `${bucket} did not arrive owning ${id}`);
  }
  for (const [slot, id] of [['weather', 'clear'], ['moon', 'classic'], ['mark', 'check'], ['envelope', 'plain']]) {
    assert.equal(after.equipped[slot], id, `equipped.${slot} did not arrive`);
  }

  // And nothing they never bought.
  const paid = allItems().filter((i) => i.cost > 0);
  const owned = paid.filter((i) => (after.inventory[i.bucket] || []).includes(i.id));
  assert.deepEqual(owned.map((i) => `${i.bucket}/${i.id}`).sort(),
    ['companions/fox', 'sounds/synth', 'themes/aurora', 'themes/frost', 'trails/comet'].sort());
});

/* Every control that spends stardust is built by one helper, because they were
   four hand-typed class strings and all four stayed `btn--primary` while
   disabled. `.btn--primary` carries `color: #0a0c1c` — near-black label text —
   over a full accent gradient, dimmed to 45% by `:disabled`. Measured as
   painted, across all twelve skies: 1.02–1.43:1. The label saying WHY you
   cannot buy the thing was the least readable pixel on the card and also the
   most eye-catching, on nearly every card at once, because you cannot afford
   most of a 24,000-stardust market on most nights. It measures 6.4–7.5:1 now. */

test('a button you cannot use is never dressed as the main action', () => {
  const src = readFileSync(new URL('../js/render/modals.js', import.meta.url), 'utf8');

  // Every button that takes a `disabled:` must get its classes from spendClass
  // or from something other than a literal primary string.
  const buttons = [...src.matchAll(/h\('button',\s*\{([\s\S]*?)\}\s*,/g)].map((m) => m[1]);
  const dressed = buttons.filter((b) => /disabled:/.test(b) && /'btn[^']*btn--primary/.test(b));
  assert.deepEqual(dressed, [],
    'a disabled button is still hardcoded as btn--primary — route it through spendClass');

  assert.match(src, /function spendClass\(/, 'the helper is gone');
  assert.ok(src.match(/spendClass\(/g).length >= 5,
    'the market, the supplies shelf, the feed button and the star map all spend stardust');
});

test('the unaffordable state is a real style, not just a dimmed one', () => {
  const base = readFileSync(new URL('../css/base.css', import.meta.url), 'utf8');
  const block = base.match(/\.btn--cost \{([^}]*)\}/);
  assert.ok(block, 'css/base.css no longer defines .btn--cost');
  assert.match(block[1], /color: var\(--muted\)/, 'the label has to be readable');
  assert.match(block[1], /background: var\(--panel-2\)/, 'no accent gradient under near-black text');
  // .btn:disabled dims to 45%, which is the opposite of what a label you are
  // meant to READ needs. The override has to come after it to win.
  const dim = base.indexOf('.btn:disabled');
  const undim = base.indexOf('.btn--cost:disabled { opacity: 1;');
  assert.ok(undim > dim && dim !== -1,
    '.btn--cost:disabled must follow .btn:disabled — same specificity, source order decides');
});

test('the supplies shelf says why on the button, not in a tooltip', () => {
  // A `title` is a hover affordance and this app is used one-handed in the
  // dark. Every other shelf states its terms in visible text — the market cards
  // label themselves with `canBuy`'s reason, the star map and the feed button
  // carry their price — and this one put the shortfall in a `title` and nowhere
  // else, so the button said "Buy" and did nothing when you tapped it.
  const src = readFileSync(new URL('../js/render/modals.js', import.meta.url), 'utf8');
  const shelf = src.slice(src.indexOf('buyConsumable(item.id)'));
  assert.match(shelf.slice(0, 400), /poor \?[^]*more stardust`/,
    'the supplies button still hides its reason in a tooltip');
});

test('the market card labels itself with the reason it cannot be bought', () => {
  // canBuy returns the shortfall, and the card shows it. There are two reasons
  // in the whole market now — the money, and the Far Shelf's nights — and both
  // are a sentence a person can act on rather than a level number.
  const state = createInitialState(new Date(2026, 6, 29, 22, 0));
  state.profile.stardust = 108;
  const dear = { id: 'x', cost: 430, bucket: 'weather', kind: 'weather' };
  assert.equal(canBuy(state, dear).reason, '322 more stardust');
  // A level, however low, is never a reason any more.
  state.profile.level = 1;
  state.profile.stardust = 99999;
  assert.equal(canBuy(state, dear).ok, true);
  assert.equal(canBuy(state, { ...dear, reqNights: 5 }).reason, '5 more nights on time');
});

/* ------------------------------------------------------------- horizons */

test('every horizon the market sells is one the sky can draw', () => {
  for (const item of allItems().filter((i) => i.bucket === 'horizons')) {
    assert.ok(Number.isFinite(item.band) && item.band >= 0 && item.band <= 0.3,
      `${item.id}: band ${item.band} is not a sane fraction of the height`);
    assert.ok(Array.isArray(item.points), `${item.id} has no points`);
    if (!item.points.length) continue;
    assert.equal(item.points[0][0], 0, `${item.id} does not start at the left edge`);
    assert.equal(item.points.at(-1)[0], 1, `${item.id} does not reach the right edge`);
    let last = -1;
    for (const [x, y] of item.points) {
      // Non-decreasing, not strictly: a repeated x is how a rooftop or a crane
      // gets a vertical wall, and forbidding it would forbid the skyline.
      assert.ok(x >= last, `${item.id}: x goes ${last} then ${x}`);
      assert.ok(x >= 0 && x <= 1, `${item.id}: x ${x} is off the canvas`);
      assert.ok(y >= 0 && y <= 1, `${item.id}: y ${y} is outside its own band`);
      last = x;
    }
  }
});

test('a horizon you pay for is one you can see', () => {
  // The whole reason this shelf was cut the first time. A silhouette is dark,
  // the panels over it are dark, and dark on dark is nothing: measured through
  // the real list at 393x852 the shape alone moves the painted pixels by under
  // one part in 255. What carries it is the lit sky behind — light through a
  // translucent panel still reads lighter. Measured with the glow: Δ30-46 in the
  // gutter beside the panels, Δ0.6-6 through them, and no change at all to the
  // task titles' contrast. So a paid horizon without a glow is one nobody can
  // see, and this is the rule that says so.
  for (const item of allItems().filter((i) => i.bucket === 'horizons' && i.cost > 0)) {
    assert.ok(item.glow, `${item.id} is a silhouette with no lit sky behind it`);
    assert.ok(item.glow.alpha >= 0.4,
      `${item.id}: glow alpha ${item.glow.alpha} does not survive a panel at 0.55`);
    assert.match(item.glow.color, /^#[0-9a-f]{6}$/i, `${item.id}: glow needs a real colour`);
    assert.ok(item.ink, `${item.id} has no silhouette ink`);
  }
});

test('the free horizon is the sky the app has always drawn', () => {
  const free = allItems().find((i) => i.bucket === 'horizons' && !i.cost);
  assert.equal(free.id, 'open', 'the id a save from the cut version would still carry');
  assert.equal(free.points.length, 0, 'nothing in the way');
  assert.equal(free.glow, null);
});

/* --------------------------------------------------------------- far shelf */

test('the far shelf opens on nights slept, and nothing else opens it', () => {
  const state = createInitialState(new Date(2026, 6, 29, 22, 0));
  const far = allItems().filter((i) => i.shelf === 'far').sort((a, b) => a.reqNights - b.reqNights);
  assert.ok(far.length >= 6, 'a ladder needs rungs');
  const first = far[0];

  // All the money and all the levels in the world, and no nights.
  state.profile.stardust = 1_000_000;
  state.profile.xp = 5_000_000;
  state.profile.level = 99;
  const broke = canBuy(state, first);
  assert.equal(broke.ok, false, 'stardust and levels bought a far shelf item');
  assert.equal(broke.sealed, true, 'and the card was not sealed, so it gave itself away');
  assert.match(broke.reason, /nights on time/);

  // Nights, and it opens.
  for (let i = 0; i < first.reqNights; i += 1) {
    const key = `2026-06-${String(i + 1).padStart(2, '0')}`;
    state.history[key] = { key, onTime: true, pct: 90, lightsOutAt: 0 };
  }
  assert.equal(canBuy(state, first).ok, true, 'the nights are on the record and it is still shut');

  // Nights that were not on time do not count, however many there are.
  const late = createInitialState(new Date(2026, 6, 29, 22, 0));
  late.profile.stardust = 1_000_000;
  for (let i = 0; i < 200; i += 1) {
    const key = `2026-01-${String((i % 28) + 1).padStart(2, '0')}-${i}`;
    late.history[key] = { key, onTime: false, pct: 100, lightsOutAt: 0 };
  }
  assert.equal(canBuy(late, first).ok, false, 'two hundred late nights opened the shelf');
});

test('the far shelf is a ladder, not a heap', () => {
  const far = allItems().filter((i) => i.shelf === 'far').sort((a, b) => a.reqNights - b.reqNights);
  let previousNights = 0;
  let previousCost = 0;
  for (const item of far) {
    assert.ok(Number.isInteger(item.reqNights) && item.reqNights > 0, `${item.id} has no rung`);
    assert.ok(item.reqNights > previousNights, `${item.id} shares a rung with the one below it`);
    // Dearer as it goes deeper. A cheap item behind a distant rung is a rung
    // you walk past, and the shelf stops being somewhere you are going.
    assert.ok(item.cost > previousCost, `${item.id} costs less than the rung below it`);
    previousNights = item.reqNights;
    previousCost = item.cost;
  }
  // The first rung has to be reachable from where a real person is standing,
  // and the last has to be a season away or it is not worth hiding.
  assert.ok(far[0].reqNights <= 7, `the first rung is ${far[0].reqNights} nights out`);
  assert.ok(far[far.length - 1].reqNights >= 100, 'nothing here is actually far');
});

test('a far shelf item is an ordinary item once you have it', () => {
  // It equips into the slot its kind names and is owned in the bucket its
  // bucket names — the shelf is a display, not a parallel inventory.
  const fresh = createProfile();
  const state = createInitialState(new Date(2026, 6, 29, 22, 0));
  state.profile.stardust = 1_000_000;
  for (let i = 0; i < 200; i += 1) {
    const key = `2026-02-${String(i + 1).padStart(3, '0')}`;
    state.history[key] = { key, onTime: true, pct: 100, lightsOutAt: 0 };
  }
  replaceState(state);

  for (const item of allItems().filter((i) => i.shelf === 'far')) {
    assert.ok(Object.prototype.hasOwnProperty.call(fresh.inventory, item.bucket),
      `${item.id} wants inventory.${item.bucket}, which does not exist`);
    assert.ok(Object.prototype.hasOwnProperty.call(fresh.equipped, item.kind),
      `${item.id} wants equipped.${item.kind}, which does not exist`);
    assert.ok(!fresh.inventory[item.bucket].includes(item.id), `${item.id} is handed out for free`);

    assert.ok(purchase(item.id, item.bucket), `${item.id} could not be bought with the nights in hand`);
    assert.ok(getState().profile.inventory[item.bucket].includes(item.id),
      `${item.id} was paid for and is not in inventory.${item.bucket}`);
    // Buying equips it, like everything else here. Unequip by hand and put it
    // back, so the round trip through the ordinary machinery is the assertion.
    getState().profile.equipped[item.kind] = fresh.equipped[item.kind];
    assert.ok(equipItem(item.id, item.bucket), `${item.id} cannot be re-equipped`);
    assert.equal(getState().profile.equipped[item.kind], item.id,
      `${item.id} equipped into some other slot than ${item.kind}`);
  }
});

test('what the far shelf shows before you get there', () => {
  // The rung is public and the item is not. A sealed card that leaked its name
  // or its picture would be a countdown to something you had already seen.
  const state = createInitialState(new Date(2026, 6, 29, 22, 0));
  state.profile.stardust = 1_000_000;
  for (const item of allItems().filter((i) => i.shelf === 'far')) {
    const check = canBuy(state, item);
    assert.equal(check.sealed, true, `${item.name} is not sealed at zero nights`);
    assert.doesNotMatch(check.reason, new RegExp(item.name, 'i'),
      `the lock on ${item.id} says its name`);
    assert.match(check.reason, new RegExp(`^${item.reqNights} more nights on time$`));
  }
});

test('a sound card draws a waveform, not a barcode', () => {
  // The first version drew a run of identical bars per tone. Two tones a few
  // milliseconds apart therefore drew two rows of sticks at slightly different
  // offsets and collided instead of adding, and every bar in a run was the same
  // height with a flat top — so nothing rose, nothing fell, and none of it
  // looked like sound. The card samples the mixed envelope now, so these are
  // properties of the picture and not just of the audio.
  for (const pack of SOUND_PACKS) {
    const tones = packTones(pack.id);
    const span = Math.max(...tones.map((t) => t.delay + t.dur));
    const at = (u) => soundAt(u * span, tones).amp;
    const curve = Array.from({ length: 60 }, (_, i) => at(i / 59));

    const peak = Math.max(...curve);
    assert.ok(peak > 0, `${pack.id} draws silence`);
    // It rises. A tone that is already at full amplitude in the first sample
    // has no attack to draw and the card opens on a wall.
    assert.ok(curve[0] < peak * 0.5, `${pack.id} starts at full height`);
    // And it falls, all the way. The tail is what makes a long sound look long.
    assert.ok(curve[curve.length - 1] < peak * 0.05, `${pack.id} never decays`);
    // Overlapping tones add rather than fight. Asserted where they actually
    // overlap rather than at the global peak — the attack is 12ms long and a
    // sixty-sample grid steps past it, so a peak comparison measures the grid.
    for (let i = 0; i < 240; i += 1) {
      const t = (i / 239) * span;
      const each = tones.map((tone) => soundAt(t, [tone]).amp).filter((a) => a > 0);
      if (each.length < 2) continue;
      const mixed = soundAt(t, tones).amp;
      assert.ok(mixed > Math.max(...each),
        `${pack.id} is quieter with both tones than with one`);
      break;
    }
  }

  // A pack whose tones sweep changes pitch across the card, which is what makes
  // Synth's colour move while Temple Bell's does not.
  const synth = packTones('synth');
  const start = soundAt(0.02, synth).hz;
  const end = soundAt(0.14, synth).hz;
  assert.ok(end > start * 1.5, 'a swept tone draws at one pitch the whole way');
});

test('the pitch a sound is drawn in is the pitch it is played at', () => {
  // Colour was by oscillator type, which read as one thing and meant another:
  // five of the eight packs are sine, so five cards came out the same blue.
  const tintOf = (id) => soundTint(packTones(id)[0].freq);
  assert.notEqual(tintOf('crickets'), tintOf('bell'), 'a 4200Hz chirp and a 196Hz bell drew alike');
  assert.equal(tintOf('pulse'), tintOf('bell'), 'two low packs should sit in the same band');
  const bands = new Set(SOUND_PACKS.map((p) => tintOf(p.id)));
  assert.ok(bands.size >= 3, `the whole shelf draws in ${bands.size} colours`);
});
