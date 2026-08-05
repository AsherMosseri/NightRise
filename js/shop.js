/* The Night Market: what Stardust buys, and the rules for buying it. */

import { update, emit } from './state.js';
import { checkAchievements } from './achievements.js';
import { computeStats } from './night.js';
import { COMPANIONS, FEED_COST, TIER_FEEDS, tierForFeeds } from './companion.js';
import { MOMENTUM_MIN_GAP_MS } from './game.js';
import { rollQuest } from './quests.js';
import { onTimeNights } from './insights.js';
import {
  THEMES, SOUND_PACKS, TRAILS, FONTS, HORIZONS, WEATHER, MOONS, MARKS, ENVELOPES,
} from './skins.js';

/* Re-exported: the catalogs live in skins.js as data, the rules live here. */
export { THEMES, SOUND_PACKS, TRAILS, FONTS };

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
  {
    id: 'headstart',
    name: 'Head Start',
    cost: 180,
    desc: 'Begin tonight at ×1.5 momentum, without having earned it yet.',
    icon: 'flame',
    // Not a token you hold: it acts on tonight the moment you buy it, so it is
    // spent rather than stockpiled. Buying two on one night would be paying
    // twice for a multiplier you already have.
    instant: true,
  },
  {
    id: 'secondwind',
    name: 'Second Wind',
    cost: 220,
    desc: 'Trade tonight’s bonus quest for a different one. Once a night.',
    icon: 'chart',
    instant: true,
  },
];

/* bucket (where owning it is recorded) -> kind (which equipped slot it fills). */
const KIND_BY_LIST = [
  ['themes', 'theme', THEMES],
  ['horizons', 'horizon', HORIZONS],
  ['weather', 'weather', WEATHER],
  ['moons', 'moon', MOONS],
  ['sounds', 'sounds', SOUND_PACKS],
  ['trails', 'trail', TRAILS],
  ['marks', 'mark', MARKS],
  ['envelopes', 'envelope', ENVELOPES],
  ['fonts', 'font', FONTS],
];

export const COMPANION_ITEMS = COMPANIONS.map((c) => ({ ...c, kind: 'companion' }));

/**
 * There are no level gates any more, and this is where they were.
 *
 * There were eleven hand-typed ones first, and nine never bound: level 13
 * arrives on night 17 and the level-13 sky takes thirteen nights to save for.
 * They were re-derived from the measured curve after that, into five bands that
 * each landed two to nine nights after affordability — honest, and still
 * pointless. Every band expired by night 23 and never bound again for the rest
 * of the app's life, while thirty-seven of sixty-seven cards went on wearing a
 * chip saying "Level 12" about a barrier that had been gone for months.
 *
 * Replacing them with nights slept on time was the obvious move and the wrong
 * one. Those thirty-seven cards are 80% of the market by cost, and at one
 * on-time night in seven the level-14 band would have gone from night 23 to
 * night 161 — five months with most of the shop shut. That is the Starlight
 * mistake again: a reward turned into a restriction on the main sink, and it
 * would land hardest on exactly the person the app is for. It would also punish
 * a bad week twice, since an on-time night already pays half again in stardust,
 * already lights a star, and already opens the Far Shelf.
 *
 * So the market is paced by price alone, which is what it was really paced by.
 * The Far Shelf carries the nights, where it adds rather than subtracts, and
 * levels carry the titles, which cost nothing and gate nothing.
 */

/**
 * Every equippable item, tagged with its inventory bucket, cheapest first.
 *
 * Sorted here rather than in the catalogs, because a shelf is a ladder and the
 * catalogs are edited by hand: skies, type and companions had all drifted out of
 * order simply by having new entries appended to the end, so the Skies tab read
 * 400, 700, 920, 1150, 1550, 620, 840. Price is the only pacing this market has,
 * now literally rather than nearly, so the order it is read in has to be the
 * order it is affordable in.
 */
function byPrice(a, b) {
  return (a.cost || 0) - (b.cost || 0);
}

export function allItems() {
  const items = [];
  const tag = (item, kind, bucket) => ({ ...item, kind, bucket });
  for (const [bucket, kind, list] of KIND_BY_LIST) {
    for (const item of [...list].sort(byPrice)) items.push(tag(item, kind, bucket));
  }
  for (const c of [...COMPANIONS].sort(byPrice)) items.push(tag(c, 'companion', 'companions'));
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

/**
 * How many nights on the record ended on time — the Far Shelf's only currency.
 *
 * Levels stopped being a pacing mechanism a long time ago and the code said so:
 * "levels come far too fast to gate anything". The highest gate in the app was
 * 14, which arrives on night 23, and after that a level-up unlocked nothing
 * anywhere. So the deep ladder is measured in the one number this app exists to
 * move instead.
 *
 * XP would have been the obvious thing to extend and the wrong one. XP comes
 * from ticking tasks, which is time-blind — a long list farmed at one in the
 * morning pays exactly what the same list paid at nine. Putting something worth
 * wanting behind level 40 creates pressure to pad the list and grind it late,
 * which is the app arguing against itself. A rung measured in nights slept on
 * time cannot be rushed, cannot be farmed and cannot be bought.
 */
export function nightsOnTime(state) {
  return onTimeNights(state).length;
}

export function canBuy(state, item) {
  if (owns(state, item)) return { ok: false, reason: 'owned' };
  if (item.reqNights) {
    const have = nightsOnTime(state);
    if (have < item.reqNights) {
      return { ok: false, reason: `${item.reqNights - have} more nights on time`, sealed: true };
    }
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

/**
 * Why an instant supply can be refused for reasons other than the price.
 *
 * A token you hold is always buyable — you can stockpile freezes. These two act
 * on tonight, so buying one twice is paying twice for something you already
 * have, and there is nothing to hold afterwards to show for it.
 */
export function supplyBlocker(state, item) {
  if (item.id === 'headstart') {
    if (state.night.headStartKey === state.night.key) return 'Already going tonight';
    if ((state.night.combo || 1) >= 1.5) return 'Already at speed';
  }
  if (item.id === 'secondwind') {
    if (state.night.rerolledKey === state.night.key) return 'Used tonight';
    // A finished quest is a claim waiting to happen, and rerolling past it
    // would either throw the reward away or hand out a second one.
    if (state.night.quest?.claimed) return 'Tonight’s quest is done';
  }
  return null;
}

export function buyConsumable(kind) {
  const item = CONSUMABLES.find((c) => c.id === kind);
  if (!item) return null;
  return update((state) => {
    if (state.profile.stardust < item.cost) {
      emit('purchase:failed', { item, reason: `${item.cost - state.profile.stardust} more stardust` });
      return null;
    }
    const blocked = supplyBlocker(state, item);
    if (blocked) {
      emit('purchase:failed', { item, reason: blocked });
      return null;
    }
    state.profile.stardust -= item.cost;
    if (item.id === 'headstart') {
      // The envelope's head start, verbatim — including the subtle part. The
      // chain resets when two check-offs are closer together than
      // MOMENTUM_MIN_GAP_MS, so stamping "now" would throw the prize away on
      // the very next tap; and `combo` is 1.25 rather than 1.5 because the
      // chain the next completion earns is derived from it, and 1.25 yields
      // exactly the x1.5 the label promises.
      state.night.combo = Math.max(state.night.combo || 1, 1.25);
      state.night.lastDoneAt = Date.now() - MOMENTUM_MIN_GAP_MS;
      state.night.lastMinutes = 10;
      state.night.headStartKey = state.night.key;
    } else if (item.id === 'secondwind') {
      // Seeded off how many rerolls this night has had, so the new quest is
      // still a pure function of the night and a reload cannot shop for one.
      state.night.rerolledKey = state.night.key;
      state.night.questRerolls = (state.night.questRerolls || 0) + 1;
      state.night.quest = rollQuest(`${state.night.key}#${state.night.questRerolls}`);
    } else {
      state.profile.tokens[kind] = (state.profile.tokens[kind] || 0) + 1;
    }
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
