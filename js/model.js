/* Shapes, factories and the starter night. */

import { uid } from './util.js';
import { nightKeyOf } from './time.js';
import { rollQuest } from './quests.js';

export const SCHEMA_VERSION = 1;
export const STORAGE_KEY = 'nightcheck.v1';

export const DEFAULT_MINUTES = 5;

export function createTask(title, minutes = DEFAULT_MINUTES, note = '') {
  return { id: uid('t'), title, minutes, note };
}

export function createSection(title) {
  return { id: uid('s'), title, collapsed: false, taskIds: [] };
}

export function createNight(key) {
  return {
    key,
    startedAt: Date.now(),
    done: {},
    skipped: {},
    awards: {},
    combo: 1,
    maxCombo: 1,
    lastDoneAt: 0,
    lastMinutes: 0, // what the last completed task claimed, for momentum
    celebrated: false,
    bonus: null, // what the completion bonus paid, so it can be taken back exactly
    lightsOutAt: null, // when you actually stopped for the night
    lightsOutOnTime: false,
    reopenedAfterLightsOut: false,
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
    badges: [],
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
    constellations: {},
    taskStats: {},
    settings: {
      bedtime: '23:30',
      dim: false,
      muted: true,
      curfew: true,
      motion: 'auto',
      hideCompleted: false,
    },
  };
}

const STARTER = [
  ['Wind Down', [
    ['Dim the lights', 2],
    ['Stretch or breathe', 5],
    ['Read a few pages', 15],
    ['Screens off', 1],
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
