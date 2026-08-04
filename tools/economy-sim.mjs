/* The stardust figures the README quotes, measured rather than remembered.
 *
 * Every number in the economy section of the README comes out of this file.
 * They had drifted twice — once when the market was filled out and once when
 * the lights-out reward started scaling with the night — and both times the
 * prose went on quoting the old figure, because the figure lived only in a
 * chat log. It lives here now.
 *
 *   node tools/economy-sim.mjs
 *
 * It drives the real action layer, not the pure helpers underneath it, so what
 * it reports is what a person clicking through a night actually receives.
 */

import { getState, replaceState, update } from '../js/state.js';
import { toggleTask, claimQuest } from '../js/actions.js';
import { createInitialState, createSection, createTask, emptyTemplate } from '../js/model.js';
import { computeStats, forceNewNight } from '../js/night.js';
import { levelFromXp } from '../js/game.js';
import { lightsOutReward } from '../js/render/goodnight.js';
import { allItems } from '../js/shop.js';
import { CONSTELLATIONS, starCost } from '../js/constellations.js';
import { shiftKey } from '../js/time.js';

/* Momentum keys off the gap between check-offs, so a loop that toggles as fast
   as it can measures a x1 night however many rows it ticks. Pass the gap you
   mean: 1s is hammering the list, 60s is working through it. */
function withClock(stepMs, body) {
  const real = Date.now;
  let t = real.call(Date);
  Date.now = () => { t += stepMs; return t; };
  try { return body(); } finally { Date.now = real; }
}

function listOf(rows, minutes) {
  const state = createInitialState(new Date(2026, 6, 29, 22, 0));
  state.template = emptyTemplate();
  const section = createSection('Night');
  state.template.sections[section.id] = section;
  state.template.order.push(section.id);
  for (let i = 0; i < rows; i += 1) {
    const task = createTask(`t${i}`, minutes);
    state.template.tasks[task.id] = task;
    section.taskIds.push(task.id);
  }
  return state;
}

function playNight(stepMs, minutesEarly) {
  withClock(stepMs, () => {
    for (const id of Object.keys(getState().template.tasks)) toggleTask(id);
  });
  claimQuest();
  update((s) => {
    s.profile.stardust += lightsOutReward(minutesEarly, computeStats(s), s.night.paid).dust;
  });
}

/**
 * A settled night: the recurring income, with every one-time ledger already
 * paid off. The momentum rungs hand over 150 stardust the first time you ever
 * reach x2.5, and level-ups mint more — real money on an early night and none
 * at all later. The sinks are paced against the later number, so the first
 * night is played and discarded and the second is the one reported.
 */
function settled({ rows = 18, minutes = 8, stepMs = 60_000, minutesEarly = 45 } = {}) {
  const state = listOf(rows, minutes);
  // High enough that tonight's XP cannot cross a rung.
  state.profile.xp = 4_000_000;
  state.profile.level = levelFromXp(state.profile.xp).level;
  state.profile.stardust = 0;
  replaceState(state);
  playNight(stepMs, minutesEarly);
  update((s) => forceNewNight(s, '2026-07-30'));
  update((s) => { s.profile.stardust = 0; });
  playNight(stepMs, minutesEarly);
  return getState().profile.stardust;
}

/**
 * The opening run, from a genuinely fresh profile — level-ups and achievement
 * rungs included, which is why the first nights pay well over the settled rate.
 * This is the curve the nights-to-afford figures are counted along.
 */
function openingCurve(nights, { minutesEarly = 45, stepMs = 60_000 } = {}) {
  replaceState(listOf(18, 8));
  const out = [];
  let key = '2026-07-29';
  for (let i = 0; i < nights; i += 1) {
    const before = getState().profile.stardust;
    playNight(stepMs, minutesEarly);
    out.push(getState().profile.stardust - before);
    key = shiftKey(key, 1);
    update((s) => forceNewNight(s, key));
  }
  return out;
}

/** Nights until the cumulative curve covers a price, holding the last rate. */
function nightsFor(total, curve) {
  let acc = 0;
  for (let i = 0; i < 20_000; i += 1) {
    acc += curve[Math.min(i, curve.length - 1)];
    if (acc >= total) return i + 1;
  }
  return Infinity;
}

const marketTotal = allItems().reduce((sum, item) => sum + (item.cost || 0), 0);
const skyTotal = CONSTELLATIONS.reduce(
  (sum, c) => sum + c.stars.reduce((n, _, i) => n + starCost(c.base, i), 0), 0);
const depthTotal = CONSTELLATIONS.reduce(
  (sum, c) => sum + (c.faint || []).reduce((n, _, i) => n + starCost(c.base, c.stars.length + i), 0), 0);

const curve = openingCurve(40);

const lines = [
  ['A settled night, eighteen rows of eight minutes'],
  ['  worked through, 45m early', settled()],
  ['  worked through, on time', settled({ minutesEarly: 0 })],
  ['  worked through, 90m late', settled({ minutesEarly: -90 })],
  ['  hammered, 45m early', settled({ stepMs: 1000 })],
  ['A settled night, eighteen rows totalling ~25 minutes'],
  ['  worked through', settled({ minutes: 1 })],
  ['  hammered', settled({ minutes: 1, stepMs: 1000 })],
  ['The opening run'],
  ['  night 1', curve[0]],
  ['  night 5', curve[4]],
  ['  night 20', curve[19]],
  ['What there is to buy'],
  ['  the whole market', marketTotal],
  ['  all twenty constellation shapes', skyTotal],
  ['  one pass through the faint depth tier', depthTotal],
  ['Nights to afford, counted along the opening curve'],
  ['  all twenty shapes', nightsFor(skyTotal, curve)],
  ['  the whole market', nightsFor(marketTotal, curve)],
  ['  market and sky', nightsFor(marketTotal + skyTotal, curve)],
  ['  everything there is, depth included', nightsFor(marketTotal + skyTotal + depthTotal, curve)],
];

for (const [label, value] of lines) {
  console.log(value === undefined ? `\n${label}` : `${label.padEnd(42)} ${value}`);
}
