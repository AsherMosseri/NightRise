/* localStorage persistence, schema normalisation and JSON export/import. */

import { debounce, deepClone, roundMinutes } from './util.js';
import {
  SCHEMA_VERSION, STORAGE_KEY, createInitialState, createNight, createProfile,
  createSection, emptyTemplate, DEFAULT_MINUTES,
} from './model.js';
import { nightKeyOf } from './time.js';
import { BADGES } from './game.js';

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function mergeDefaults(defaults, incoming) {
  const out = deepClone(defaults);
  if (!isObject(incoming)) return out;
  for (const [key, value] of Object.entries(incoming)) {
    if (isObject(out[key]) && isObject(value)) out[key] = mergeDefaults(out[key], value);
    else if (value !== undefined) out[key] = deepClone(value);
  }
  return out;
}

function normalizeTemplate(raw) {
  const template = emptyTemplate();
  if (!isObject(raw)) return template;

  const rawTasks = isObject(raw.tasks) ? raw.tasks : {};
  for (const [id, task] of Object.entries(rawTasks)) {
    if (!isObject(task)) continue;
    template.tasks[id] = {
      id,
      title: String(task.title ?? 'Untitled').slice(0, 200),
      minutes: roundMinutes(task.minutes) ?? DEFAULT_MINUTES,
      note: String(task.note ?? ''),
    };
  }

  const rawSections = isObject(raw.sections) ? raw.sections : {};
  const claimed = new Set();
  for (const [id, section] of Object.entries(rawSections)) {
    if (!isObject(section)) continue;
    const taskIds = Array.isArray(section.taskIds) ? section.taskIds : [];
    const kept = [];
    for (const taskId of taskIds) {
      if (template.tasks[taskId] && !claimed.has(taskId)) {
        claimed.add(taskId);
        kept.push(taskId);
      }
    }
    template.sections[id] = {
      id,
      title: String(section.title ?? 'Section').slice(0, 200),
      collapsed: Boolean(section.collapsed),
      taskIds: kept,
    };
  }

  const order = Array.isArray(raw.order) ? raw.order : [];
  for (const id of order) {
    if (template.sections[id] && !template.order.includes(id)) template.order.push(id);
  }
  for (const id of Object.keys(template.sections)) {
    if (!template.order.includes(id)) template.order.push(id);
  }

  // Any task that lost its section is rehomed rather than silently dropped.
  const orphans = Object.keys(template.tasks).filter((id) => !claimed.has(id));
  if (orphans.length) {
    let host = template.order[0] && template.sections[template.order[0]];
    if (!host) {
      host = createSection('Recovered');
      template.sections[host.id] = host;
      template.order.push(host.id);
    }
    host.taskIds.push(...orphans);
  }

  return template;
}

function normalizeNight(raw, template, now) {
  const key = typeof raw?.key === 'string' ? raw.key : nightKeyOf(now);
  const night = { ...createNight(key), ...(isObject(raw) ? raw : {}) };
  night.key = key;
  night.done = isObject(night.done) ? night.done : {};
  night.skipped = isObject(night.skipped) ? night.skipped : {};
  night.awards = isObject(night.awards) ? night.awards : {};
  for (const id of Object.keys(night.done)) if (!template.tasks[id]) delete night.done[id];
  for (const id of Object.keys(night.skipped)) if (!template.tasks[id]) delete night.skipped[id];
  for (const id of Object.keys(night.awards)) if (!template.tasks[id]) delete night.awards[id];
  night.bonus = isObject(night.bonus)
    ? { xp: Number(night.bonus.xp) || 0, dust: Number(night.bonus.dust) || 0 }
    : null;
  night.combo = Number(night.combo) || 1;
  night.maxCombo = Math.max(Number(night.maxCombo) || 1, night.combo);
  night.lastDoneAt = Number(night.lastDoneAt) || 0;
  night.lastMinutes = Math.max(0, Number(night.lastMinutes) || 0);
  night.lightsOutAt = Number(night.lightsOutAt) || null;
  night.lightsOutOnTime = Boolean(night.lightsOutOnTime);
  night.reopenedAfterLightsOut = Boolean(night.reopenedAfterLightsOut);
  night.envelope = isObject(night.envelope) ? night.envelope : null;
  if (!isObject(night.quest)) night.quest = createNight(key).quest;
  return night;
}

function normalizeHistory(raw) {
  const history = {};
  if (!isObject(raw)) return history;
  for (const [key, entry] of Object.entries(raw)) {
    if (!isObject(entry)) continue;
    history[key] = {
      total: Number(entry.total) || 0,
      done: Number(entry.done) || 0,
      skipped: Number(entry.skipped) || 0,
      pct: Math.max(0, Math.min(100, Number(entry.pct) || 0)),
      xp: Number(entry.xp) || 0,
      quest: Boolean(entry.quest),
      frozen: Boolean(entry.frozen),
      lightsOutAt: Number(entry.lightsOutAt) || null,
      onTime: Boolean(entry.onTime),
    };
  }
  return history;
}

export function normalizeState(raw, now = new Date()) {
  if (!isObject(raw)) return createInitialState(now);
  const template = normalizeTemplate(raw.template);
  const profile = mergeDefaults(createProfile(), raw.profile);
  profile.xp = Math.max(0, Number(profile.xp) || 0);
  profile.stardust = Math.max(0, Math.round(Number(profile.stardust) || 0));
  profile.streak = Math.max(0, Number(profile.streak) || 0);
  profile.bestStreak = Math.max(profile.streak, Number(profile.bestStreak) || 0);
  profile.maxLevelRewarded = Math.max(1, Number(profile.maxLevelRewarded) || 1);
  profile.lightsOut = {
    streak: Math.max(0, Number(profile.lightsOut?.streak) || 0),
    best: Math.max(0, Number(profile.lightsOut?.best) || 0),
    lastKey: typeof profile.lightsOut?.lastKey === 'string' ? profile.lightsOut.lastKey : null,
  };
  profile.lightsOut.best = Math.max(profile.lightsOut.best, profile.lightsOut.streak);
  // Only badges the app still has. A retired one — "After Hours", which paid
  // you for being awake at 1am in an app about going to bed — should stop
  // showing up in your count, not linger as an id nothing can render.
  const known = new Set(BADGES.map((b) => b.id));
  profile.badges = Array.isArray(profile.badges)
    ? profile.badges.filter((b) => typeof b === 'string' && known.has(b))
    : [];
  const defaultInventory = createProfile().inventory;
  for (const [kind, defaults] of Object.entries(defaultInventory)) {
    const list = Array.isArray(profile.inventory[kind]) ? profile.inventory[kind] : [];
    profile.inventory[kind] = Array.from(new Set([...defaults, ...list.filter((id) => typeof id === 'string')]));
  }
  return {
    version: SCHEMA_VERSION,
    template,
    night: normalizeNight(raw.night, template, now),
    history: normalizeHistory(raw.history),
    profile,
  };
}

function safeLocalStorage() {
  try {
    const probe = '__nightcheck_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}

const store = typeof window !== 'undefined' ? safeLocalStorage() : null;
export const storageAvailable = Boolean(store);

export function loadState(now = new Date()) {
  if (!store) return createInitialState(now);
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return createInitialState(now);
    return normalizeState(JSON.parse(raw), now);
  } catch (err) {
    // A corrupt blob used to mean a silent fresh start — a year of nights gone
    // with no warning and nothing to recover from. Keep the wreckage.
    console.warn('NightCheck: could not read saved data, starting fresh.', err);
    try {
      const raw = store.getItem(STORAGE_KEY);
      if (raw) store.setItem(`${STORAGE_KEY}.corrupt`, raw);
      corruptBackupKey = `${STORAGE_KEY}.corrupt`;
    } catch (nested) {
      console.warn('NightCheck: could not preserve the unreadable data either.', nested);
    }
    return createInitialState(now);
  }
}

let corruptBackupKey = null;

/** Set when the last load found unreadable data and stashed it aside. */
export function recoveredCorruptData() {
  return corruptBackupKey;
}

function writeNow(state) {
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('NightCheck: could not save.', err);
  }
}

/**
 * Writes are debounced, but iOS Safari can suspend a backgrounded tab without
 * warning, so the pending state is held here and `flushPersist()` (wired to
 * pagehide/visibilitychange) commits it synchronously before we lose it.
 */
let pendingState = null;

const scheduleWrite = debounce(() => {
  if (!pendingState) return;
  writeNow(pendingState);
  pendingState = null;
}, 250);

export function persist(state) {
  pendingState = state;
  scheduleWrite();
}

export function flushPersist() {
  if (!pendingState) return;
  writeNow(pendingState);
  pendingState = null;
}

export function serializeState(state) {
  return JSON.stringify({ ...state, exportedAt: new Date().toISOString() }, null, 2);
}

export function parseImport(text, now = new Date()) {
  const parsed = JSON.parse(text);
  if (!isObject(parsed) || !isObject(parsed.template)) {
    throw new Error('That file does not look like a NightCheck backup.');
  }
  return normalizeState(parsed, now);
}

export { STORAGE_KEY };

export function clearStorage() {
  if (store) store.removeItem(STORAGE_KEY);
}
