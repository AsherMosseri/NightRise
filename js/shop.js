/* The Night Market: what Stardust buys, and the rules for buying it. */

import { update, emit } from './state.js';
import { checkAchievements } from './achievements.js';
import { computeStats } from './night.js';
import { COMPANIONS, FEED_COST, TIER_FEEDS, tierForFeeds } from './companion.js';

export const THEMES = [
  { id: 'midnight', name: 'Midnight', cost: 0, desc: 'Deep blue, quiet, the default night.' },
  { id: 'aurora', name: 'Aurora', cost: 400, desc: 'Green and violet curtains over the horizon.' },
  { id: 'deepspace', name: 'Deep Space', cost: 700, reqLevel: 4, desc: 'Nebula purples, far from any city.' },
  { id: 'city', name: 'City Skyline', cost: 920, reqLevel: 6, desc: 'Amber windows under a hazy orange sky.' },
  { id: 'frost', name: 'Frost', cost: 1150, reqLevel: 8, desc: 'Pale ice blue and a very long winter night.' },
  { id: 'bloodmoon', name: 'Blood Moon', cost: 1550, reqLevel: 10, desc: 'Rust and ember. Rare, and a little ominous.' },
];

export const SOUND_PACKS = [
  { id: 'chime', name: 'Chime', cost: 0, desc: 'Soft glass bell on every check.' },
  { id: 'crickets', name: 'Crickets', cost: 260, desc: 'A short chirp from the garden.' },
  { id: 'windchime', name: 'Wind Chime', cost: 440, desc: 'Three notes on a breeze.' },
  { id: 'synth', name: 'Synth', cost: 570, desc: 'Warm analog blip, retro and satisfying.' },
];

export const TRAILS = [
  { id: 'none', name: 'No trail', cost: 0, desc: 'Just the cursor.' },
  { id: 'stardust', name: 'Stardust', cost: 330, desc: 'Fine glittering dust follows the pointer.' },
  { id: 'comet', name: 'Comet', cost: 530, desc: 'A short bright tail with a slow fade.' },
  { id: 'fireflies', name: 'Fireflies', cost: 660, desc: 'Little lights that drift after you.' },
];

export const FONTS = [
  // `sans`, not `aurora`. The Aurora *sky* is also `aurora`, and ids are global
  // in `itemById` — so tapping Equip on this card looked up the theme, and the
  // default typeface could never be equipped again once you left it. Renamed
  // rather than disambiguated alone, because two things in one market sharing a
  // name is a trap whatever the lookup does. Saves are migrated in storage.js.
  { id: 'sans', name: 'Aurora Sans', cost: 0, desc: 'The clean default.' },
  { id: 'mono', name: 'Terminal', cost: 260, desc: 'Monospaced, for the very online.' },
  { id: 'serif', name: 'Bedside', cost: 310, desc: 'A quiet book serif.' },
  { id: 'display', name: 'Neon', cost: 480, reqLevel: 5, desc: 'Wide letterforms with a glow.' },
];

export const CONSUMABLES = [
  {
    id: 'freeze',
    name: 'Streak Freeze',
    cost: 310,
    desc: 'Covers one missed night so your streak survives. Used automatically.',
    icon: 'flame',
  },
  {
    id: 'raincheck',
    name: 'Rain Check',
    cost: 100,
    desc: 'Excuses one task from tonight’s completion percentage.',
    icon: 'skip',
  },
];

const KIND_BY_LIST = [
  ['themes', 'theme', THEMES],
  ['sounds', 'sounds', SOUND_PACKS],
  ['trails', 'trail', TRAILS],
  ['fonts', 'font', FONTS],
];

export const COMPANION_ITEMS = COMPANIONS.map((c) => ({ ...c, kind: 'companion' }));

/** Every equippable item, tagged with its inventory bucket. */
export function allItems() {
  const items = [];
  for (const [bucket, kind, list] of KIND_BY_LIST) {
    for (const item of list) items.push({ ...item, kind, bucket });
  }
  for (const c of COMPANIONS) items.push({ ...c, kind: 'companion', bucket: 'companions' });
  return items;
}

/**
 * Look an item up, optionally within one bucket.
 *
 * Ids are global here, and the market grew until two categories shared one:
 * the Aurora sky and the Aurora Sans typeface were both `aurora`, themes come
 * first, and so the Equip button on the typeface card equipped a sky. Passing
 * the bucket makes the lookup say which shelf it means. The id collision is
 * gone and a test keeps it gone, but every call from the UI carries a bucket
 * now, because relying on a naming convention across ten categories is how the
 * first one happened.
 */
export function itemById(id, bucket = null) {
  return allItems().find((item) => item.id === id && (!bucket || item.bucket === bucket)) || null;
}

export function owns(state, item) {
  return (state.profile.inventory[item.bucket] || []).includes(item.id);
}

export function isEquipped(state, item) {
  return state.profile.equipped[item.kind] === item.id;
}

export function canBuy(state, item) {
  if (owns(state, item)) return { ok: false, reason: 'owned' };
  if (item.reqLevel && state.profile.level < item.reqLevel) {
    return { ok: false, reason: `Reach level ${item.reqLevel}` };
  }
  if (state.profile.stardust < item.cost) {
    return { ok: false, reason: `${item.cost - state.profile.stardust} more stardust` };
  }
  return { ok: true };
}

/**
 * Settle the tiers a purchase just moved.
 *
 * The collector, companion and constellation families are measured off numbers
 * only the shop changes, and nothing in the shop ever settled them — so the
 * board sat at a full bar reading "tier 0" until the next checkbox tap, a bank,
 * or the next launch. Boot settles silently by design, so closing the app first
 * meant the stardust arrived with no announcement at all.
 */
function settleTiers(state) {
  const earned = checkAchievements(state, computeStats(state));
  if (earned.length) emit('achievement', earned);
}

export function purchase(itemId, bucket = null) {
  const item = itemById(itemId, bucket);
  if (!item) return null;
  return update((state) => {
    const check = canBuy(state, item);
    if (!check.ok) {
      emit('purchase:failed', { item, reason: check.reason });
      return null;
    }
    state.profile.stardust -= item.cost;
    state.profile.inventory[item.bucket] = [...(state.profile.inventory[item.bucket] || []), item.id];
    if (item.kind === 'companion' && !state.profile.equipped.companion) {
      state.profile.equipped.companion = item.id;
      state.profile.companion = { type: item.id, name: item.name, tier: 1, fed: 0 };
    } else if (item.kind !== 'companion') {
      state.profile.equipped[item.kind] = item.id;
    }
    emit('purchase', { item });
    settleTiers(state);
    return item;
  });
}

export function equipItem(itemId, bucket = null) {
  const item = itemById(itemId, bucket);
  if (!item) return null;
  return update((state) => {
    if (!owns(state, item)) return null;
    state.profile.equipped[item.kind] = item.id;
    if (item.kind === 'companion') {
      // Each companion keeps its own progress. `profile.companion` is a single
      // slot, so switching used to reset the outgoing one to tier 1 / fed 0
      // with nothing stored anywhere else — an owl fed fourteen times, 210
      // stardust, silently destroyed by trying the cat for one night.
      const current = state.profile.companion || {};
      if (!state.profile.companions) state.profile.companions = {};
      if (current.type) {
        state.profile.companions[current.type] = {
          name: current.name, tier: current.tier || 1, fed: current.fed || 0,
        };
      }
      const kept = state.profile.companions[item.id];
      state.profile.companion = {
        type: item.id,
        name: kept?.name || item.name,
        tier: kept?.tier || 1,
        fed: kept?.fed || 0,
      };
    }
    emit('equip', { item });
    return item;
  });
}

export function unequipCompanion() {
  update((state) => {
    state.profile.equipped.companion = null;
    emit('equip', { item: null });
  });
}

export function buyConsumable(kind) {
  const item = CONSUMABLES.find((c) => c.id === kind);
  if (!item) return null;
  return update((state) => {
    if (state.profile.stardust < item.cost) {
      emit('purchase:failed', { item, reason: `${item.cost - state.profile.stardust} more stardust` });
      return null;
    }
    state.profile.stardust -= item.cost;
    state.profile.tokens[kind] = (state.profile.tokens[kind] || 0) + 1;
    emit('purchase', { item });
    settleTiers(state);
    return item;
  });
}

export function feedCompanion() {
  return update((state) => {
    const companion = state.profile.companion;
    if (!companion?.type) return null;
    if (state.profile.stardust < FEED_COST) {
      emit('purchase:failed', { reason: 'Not enough stardust' });
      return null;
    }
    state.profile.stardust -= FEED_COST;
    companion.fed = (companion.fed || 0) + 1;
    const tier = tierForFeeds(companion.fed);
    const grew = tier > (companion.tier || 1);
    companion.tier = tier;
    emit('companion:fed', { companion, grew });
    settleTiers(state);
    return { companion, grew, maxed: tier >= TIER_FEEDS.length };
  });
}

export function renameCompanion(name) {
  update((state) => {
    if (state.profile.companion?.type) state.profile.companion.name = name.slice(0, 24) || state.profile.companion.name;
  });
}
