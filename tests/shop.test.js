/* The market is a catalog on one side and a renderer on the other, and nothing
   made them agree. A trail could be sold with no spec to draw it; a companion
   could be sold and come out as a different animal. These tests are the join. */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  THEMES, SOUND_PACKS, TRAILS, FONTS, CONSUMABLES, allItems, itemById,
} from '../js/shop.js';
import { COMPANIONS, SPECIES_IDS } from '../js/companion.js';
import { TRAIL_IDS } from '../js/sky.js';
import { createProfile, createInitialState } from '../js/model.js';
import { equipItem } from '../js/shop.js';
import { getState, replaceState } from '../js/state.js';
import { normalizeState } from '../js/storage.js';

const CATALOGS = [
  ['themes', THEMES], ['sounds', SOUND_PACKS], ['trails', TRAILS],
  ['fonts', FONTS], ['companions', COMPANIONS],
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

test('the whole market costs what the README says it costs', () => {
  // Quoted in prose and used to pace every sink. Measured, not remembered.
  const total = allItems().reduce((sum, item) => sum + (item.cost || 0), 0);
  assert.equal(total, 10950, 'the market total moved');
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
