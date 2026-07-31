/* Shapes, factories and the starter night. */

import { uid } from './util.js';
import { nightKeyOf } from './time.js';
import { rollQuest } from './quests.js';

export const SCHEMA_VERSION = 1;
export const STORAGE_KEY = 'nightcheck.v1';

export const DEFAULT_MINUTES = 5;

/**
 * The longest a title can be, enforced on the way in.
 *
 * The loader has always clamped to this, so a longer title lived on screen and
 * on disk all evening and was amputated at the next launch — the truncation was
 * real either way, it just happened where nobody could see it.
 */
export const TITLE_MAX = 200;

export function clampTitle(value, fallback) {
  const trimmed = String(value ?? '').trim().slice(0, TITLE_MAX);
  return trimmed || fallback;
}

export function createTask(title, minutes = DEFAULT_MINUTES, note = '') {
  return { id: uid('t'), title: clampTitle(title, 'New task'), minutes, note };
}

export function createSection(title) {
  return { id: uid('s'), title: clampTitle(title, 'New section'), collapsed: false, taskIds: [] };
}

export function createNight(key) {
  return {
    key,
    startedAt: Date.now(),
    done: {},
    skipped: {},
    awards: {},
    // Tasks you have said you are starting. Same shape as `awards` so the
    // advance can be reversed exactly, and deliberately separate from `done`:
    // starting is not finishing and must never count as it.
    started: {},
    combo: 1,
    maxCombo: 1,
    lastDoneAt: 0,
    lastMinutes: 0, // what the last completed task claimed, for momentum
    celebrated: false,
    bonus: null, // what the completion bonus paid, so it can be taken back exactly
    lightsOutAt: null, // when you actually stopped for the night
    lightsOutOnTime: false,
    reopenedAfterLightsOut: false,
    // What stopping paid, so clearing tonight can hand it back.
    lightsOutAward: null,
    envelope: null, // { opened: ms|null } — tonight's unconditional reward
    quest: rollQuest(key),
  };
}

export function createProfile() {
  return {
    xp: 0,
    level: 1,
    maxLevelRewarded: 1, // level-up stardust is paid once per level, ever
    stardust: 0,
    streak: 0,
    bestStreak: 0,
    nightsLogged: 0,
    lastBankedKey: null,
    // One envelope and one quest reward per date, not per fresh start.
    lastEnvelopeKey: null,
    lastQuestKey: null,
    // And one reward for stopping per date, for the same reason.
    lastLightsOutKey: null,
    // Achievement tiers held, by family id, and the highest tier each family
    // has ever been paid for — the same high-water trick as maxLevelRewarded,
    // so falling out of a tier and climbing back is not a stardust faucet.
    tiers: {},
    // The rung banked evidence alone justifies. Tonight can lift `tiers` above
    // it and be taken back; nothing drops below it.
    tiersBanked: {},
    tiersPaid: {},
    bestCombo: 1,
    // Dust taken back that had already been spent. Never shown; the next dust
    // you earn pays it off before it reaches the balance.
    dustDebt: 0,
    inventory: {
      themes: ['midnight'],
      sounds: ['chime'],
      trails: ['none'],
      fonts: ['aurora'],
      companions: [],
    },
    equipped: {
      theme: 'midnight',
      sounds: 'chime',
      trail: 'none',
      font: 'aurora',
      companion: null,
    },
    tokens: { freeze: 1, raincheck: 2 },
    lightsOut: { streak: 0, best: 0, lastKey: null },
    companion: { type: null, name: '', tier: 1, fed: 0 },
    // Per-species progress, so switching companions does not destroy the
    // feeding you paid hundreds of stardust for.
    companions: {},
    constellations: {},
    taskStats: {},
    settings: {
      bedtime: '23:30',
      dim: false,
      muted: true,
      curfew: true,
      autoTimer: false,
      motion: 'auto',
      hideCompleted: false,
      // WCAG 2.1 SC 2.1.4: single-character shortcuts need a way off. The
      // letters in js/keys.js are bound bare on `window` and only inputs are
      // exempt — a focused task row, a heat cell or any button is live.
      shortcuts: true,
    },
  };
}

const STARTER = [
  ['Wind Down', [
    ['Dim the lights', 2],
    ['Stretch or breathe', 5],
    ['Read a few pages', 15],
    ['Screens off', 0.5],
  ]],
  ['Tidy Up', [
    ['Clear the sink', 5],
    ['Reset the living room', 5],
    ['Take the trash out', 3],
  ]],
  ['Tomorrow Prep', [
    ['Set out clothes', 3],
    ['Pack your bag', 5],
    ['Check the calendar', 2],
    ['Fill the water bottle', 1],
  ]],
];

export function starterTemplate() {
  const template = { order: [], sections: {}, tasks: {} };
  for (const [sectionTitle, tasks] of STARTER) {
    const section = createSection(sectionTitle);
    for (const [taskTitle, minutes] of tasks) {
      const task = createTask(taskTitle, minutes);
      template.tasks[task.id] = task;
      section.taskIds.push(task.id);
    }
    template.sections[section.id] = section;
    template.order.push(section.id);
  }
  return template;
}

export function emptyTemplate() {
  return { order: [], sections: {}, tasks: {} };
}

export function createInitialState(now = new Date()) {
  return {
    version: SCHEMA_VERSION,
    template: starterTemplate(),
    night: createNight(nightKeyOf(now)),
    history: {},
    profile: createProfile(),
  };
}
