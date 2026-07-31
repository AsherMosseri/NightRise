/* localStorage persistence, schema normalisation and JSON export/import. */

import { debounce, deepClone, roundMinutes, clamp } from './util.js';
import { levelFromXp } from './game.js';
import {
  SCHEMA_VERSION, STORAGE_KEY, createInitialState, createNight, createProfile,
  createSection, emptyTemplate, DEFAULT_MINUTES, clampTitle,
} from './model.js';
import { nightKeyOf, parseClock } from './time.js';
import { ACHIEVEMENTS, migrateBadges } from './achievements.js';

/** A tier index a save claims, kept inside what the family actually has. */
function clampTier(value, cap) {
  return Math.max(0, Math.min(cap, Math.round(Number(value) || 0)));
}

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
      title: clampTitle(task.title, 'Untitled'),
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
      title: clampTitle(section.title, 'Section'),
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

/** A night key is a calendar date. Anything else is not a key, it is a string. */
function validKey(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return !Number.isNaN(new Date(`${value}T00:00:00`).getTime());
}

function normalizeNight(raw, template, now) {
  // `night.key = 'not-a-date'` used to survive: keyDiffDays returned NaN, so the
  // "only ever roll forward" guard was skipped, the night was banked, and the
  // history panel rendered "Invalid Date" against it permanently.
  const key = validKey(raw?.key) ? raw.key : nightKeyOf(now);
  const night = { ...createNight(key), ...(isObject(raw) ? raw : {}) };
  night.key = key;
  night.done = isObject(night.done) ? night.done : {};
  night.skipped = isObject(night.skipped) ? night.skipped : {};
  night.awards = isObject(night.awards) ? night.awards : {};
  night.started = isObject(night.started) ? night.started : {};
  night.clocks = isObject(night.clocks) ? night.clocks : {};
  for (const id of Object.keys(night.done)) if (!template.tasks[id]) delete night.done[id];
  for (const id of Object.keys(night.skipped)) if (!template.tasks[id]) delete night.skipped[id];
  for (const [id, clock] of Object.entries(night.clocks)) {
    if (!template.tasks[id] || !isObject(clock)) {
      delete night.clocks[id];
      continue;
    }
    night.clocks[id] = {
      taskId: id,
      plannedMs: Math.max(0, Number(clock.plannedMs) || 0),
      accumulatedMs: Math.max(0, Number(clock.accumulatedMs) || 0),
      // Never restored running. A phone in a pocket must not accumulate an
      // hour, and a clock that keeps running while you scroll is a guilt
      // machine — the pause is the whole design, not a nicety.
      startedAt: null,
    };
  }
  for (const [id, record] of Object.entries(night.started)) {
    if (!template.tasks[id] || !isObject(record)) delete night.started[id];
    else night.started[id] = { at: Number(record.at) || 0, face: Math.max(0, Number(record.face) || 0) };
  }
  for (const [id, award] of Object.entries(night.awards)) {
    // Coerced, not just filtered by task id. `xp: {}` made `profile.xp - xp`
    // NaN on the next un-tick, JSON.stringify wrote it as null, and the reload
    // read it back as zero — every level and title gone, with no throw and so
    // no backup.
    if (!template.tasks[id] || !isObject(award)) {
      delete night.awards[id];
      continue;
    }
    // Built explicitly, not spread. Spreading carried every unknown key through
    // intact — including the poisoned `xp: {}` this coercion exists to stop,
    // which then sat on the record looking like a figure something might read.
    night.awards[id] = {
      // Face, not paid. What the night paid is `night.paid`, derived from the
      // taper — a per-award "paid" figure cannot exist under a curve whose
      // value depends on everything else on the list.
      face: Math.max(0, Number(award.face) || 0),
      faceDust: Math.max(0, Number(award.faceDust) || 0),
      multiplier: Number(award.multiplier) || 1,
      at: Number(award.at) || 0,
      prevCombo: Number(award.prevCombo) || 1,
      prevLastDoneAt: Number(award.prevLastDoneAt) || 0,
      prevMinutes: Math.max(0, Number(award.prevMinutes) || 0),
    };
  }
  night.bonus = isObject(night.bonus)
    ? { face: Math.max(0, Number(night.bonus.face) || 0), faceDust: Math.max(0, Number(night.bonus.faceDust) || 0) }
    : null;
  night.paid = isObject(night.paid)
    ? { xp: Math.max(0, Number(night.paid.xp) || 0), dust: Math.max(0, Number(night.paid.dust) || 0) }
    : { xp: 0, dust: 0 };
  night.combo = Number(night.combo) || 1;
  night.maxCombo = Math.max(Number(night.maxCombo) || 1, night.combo);
  night.lastDoneAt = Number(night.lastDoneAt) || 0;
  night.lastMinutes = Math.max(0, Number(night.lastMinutes) || 0);
  night.lightsOutAt = Number(night.lightsOutAt) || null;
  night.lightsOutOnTime = Boolean(night.lightsOutOnTime);
  night.reopenedAfterLightsOut = Boolean(night.reopenedAfterLightsOut);
  night.lightsOutAward = isObject(night.lightsOutAward)
    ? { xp: Number(night.lightsOutAward.xp) || 0, dust: Number(night.lightsOutAward.dust) || 0 }
    : null;
  night.envelope = isObject(night.envelope) ? night.envelope : null;
  if (!isObject(night.quest)) night.quest = createNight(key).quest;
  return night;
}

function normalizeHistory(raw) {
  const history = {};
  if (!isObject(raw)) return history;
  for (const [key, entry] of Object.entries(raw)) {
    if (!isObject(entry) || !validKey(key)) continue;
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
      bedtime: typeof entry.bedtime === 'string' ? entry.bedtime : null,
      minutesLate: Number.isFinite(Number(entry.minutesLate)) && entry.minutesLate !== null
        ? Math.round(Number(entry.minutesLate))
        : null,
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
  // Derived, never trusted. A save claiming level 40 against 100 XP showed 40
  // in the header until the first check-off, at which point grantXp recomputed
  // it and the number collapsed to 2 — a hand-edited or half-written save
  // presenting as a catastrophic loss the moment you touched anything.
  profile.level = levelFromXp(profile.xp).level;
  profile.maxLevelRewarded = clamp(Math.round(Number(profile.maxLevelRewarded) || 1), 1, Math.max(1, profile.level));
  profile.lightsOut = {
    streak: Math.max(0, Number(profile.lightsOut?.streak) || 0),
    best: Math.max(0, Number(profile.lightsOut?.best) || 0),
    lastKey: typeof profile.lightsOut?.lastKey === 'string' ? profile.lightsOut.lastKey : null,
  };
  profile.lightsOut.best = Math.max(profile.lightsOut.best, profile.lightsOut.streak);
  // Badges were a flat list of ids; they are tiered families now. Whatever a
  // save had earned is carried over at the rung it stood for, and written to
  // `tiersPaid` at the same time so an old save is not a stardust windfall.
  // Read from the raw save, not the merged profile: mergeDefaults has already
  // supplied an empty `tiers: {}`, which would look like a save that simply had
  // no achievements and quietly discard the badges an old one did have.
  const migrated = migrateBadges(profile.badges);
  const savedTiers = isObject(raw.profile?.tiers) ? raw.profile.tiers : migrated;
  // A save from before rungs could be on loan held nothing provisionally, so
  // everything it recorded is banked. Same for a migrated badge list.
  const savedBanked = isObject(raw.profile?.tiersBanked) ? raw.profile.tiersBanked : savedTiers;
  const savedPaid = isObject(raw.profile?.tiersPaid) ? raw.profile.tiersPaid : {};
  profile.tiers = {};
  profile.tiersBanked = {};
  profile.tiersPaid = {};
  for (const family of ACHIEVEMENTS) {
    const cap = family.tiers.length;
    const held = clampTier(savedTiers[family.id], cap);
    if (held > 0) profile.tiers[family.id] = held;
    // A migrated rung is banked, not on loan: an old badge was awarded for
    // something that had already happened, so tonight cannot take it back.
    const banked = Math.min(held, clampTier(savedBanked[family.id], cap));
    if (banked > 0) profile.tiersBanked[family.id] = banked;
    // Never below what is held: a tier you can see must already have been paid,
    // or checkAchievements would pay for it again on the next tick.
    const paid = Math.max(held, clampTier(savedPaid[family.id], cap));
    if (paid > 0) profile.tiersPaid[family.id] = paid;
  }
  delete profile.badges;
  profile.bestCombo = Math.max(1, Number(profile.bestCombo) || 1);
  profile.dustDebt = Math.max(0, Math.round(Number(profile.dustDebt) || 0));
  profile.lastLightsOutKey = typeof profile.lastLightsOutKey === 'string' ? profile.lastLightsOutKey : null;
  profile.lastBankedAt = Math.max(0, Number(profile.lastBankedAt) || 0);
  // mergeDefaults copies a value through whenever it is not an object, so a
  // save carrying `tokens: null` or `inventory: "x"` — hand-edited, imported,
  // half-written, or produced by any future bug — arrived here intact and then
  // threw on first use. That threw inside normalizeState, which loadState
  // catches, so a perfectly readable save was declared corrupt and replaced
  // with a fresh start. Every field the app dereferences without checking gets
  // its default back rather than being trusted.
  const fresh = createProfile();
  for (const key of ['inventory', 'equipped', 'tokens', 'companion', 'companions', 'constellations', 'taskStats', 'settings']) {
    if (!isObject(profile[key])) profile[key] = deepClone(fresh[key]);
  }
  // Counts, not whatever the save said. `raincheck: 'lots'` passed the
  // `<= 0` gate ('lots' <= 0 is false), then `-= 1` made it NaN, and NaN <= 0
  // is false too — the gate never closed again and every task could be
  // rain-checked forever. A negative freeze count failed `>= needed` and quietly
  // reset the streak instead of covering it. Extra token kinds the shop may add
  // go through the same clamp.
  // A bedtime that cannot be parsed is not a setting, it is a hole: the pacing
  // read, the curfew and Front Loaded all fall back to something different when
  // `bedtimeInstant` returns null, and the value arrives here unvalidated from
  // any imported or hand-edited backup.
  if (!parseClock(profile.settings.bedtime)) profile.settings.bedtime = fresh.settings.bedtime;

  const tokens = {};
  for (const [kind, value] of Object.entries({ ...fresh.tokens, ...profile.tokens })) {
    tokens[kind] = Math.max(0, Math.round(Number(value) || 0));
  }
  profile.tokens = tokens;

  const defaultInventory = fresh.inventory;
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

/**
 * Did normalising this save quietly throw away something real?
 *
 * The recovery path only ever fired when `JSON.parse` threw, which is the least
 * likely kind of damage. A save that parses but is structurally wrong — a
 * truncated write that left `template` as a string, a hand-edited file, a
 * half-synced copy — never threw: it was normalised into something plausible,
 * shown as an empty checklist, and committed over the real save 250ms later by
 * the first debounced write. Nothing was kept, and nothing was said.
 *
 * So the test is not "did it throw", it is "did we lose anything". Anything the
 * save claimed to hold that did not survive normalisation counts.
 */
export function damagedSave(parsed, normalized) {
  if (!isObject(parsed)) return true;
  // A container present but not an object is replaced wholesale with a default.
  for (const key of ['template', 'night', 'history', 'profile']) {
    if (parsed[key] !== undefined && !isObject(parsed[key])) return true;
  }
  const rawTasks = isObject(parsed.template?.tasks) ? Object.keys(parsed.template.tasks) : [];
  if (rawTasks.some((id) => !normalized.template.tasks[id])) return true;
  const rawSections = isObject(parsed.template?.sections) ? Object.keys(parsed.template.sections) : [];
  if (rawSections.some((id) => !normalized.template.sections[id])) return true;
  const rawHistory = isObject(parsed.history) ? Object.keys(parsed.history) : [];
  if (rawHistory.some((key) => !normalized.history[key])) return true;
  // A save that has history or a profile but no task list at all lost its
  // template somewhere; an empty `{}` is just a new install and is not damage.
  if (!isObject(parsed.template) && (rawHistory.length > 0 || isObject(parsed.profile))) return true;
  return false;
}

export function loadState(now = new Date()) {
  if (!store) return createInitialState(now);
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return createInitialState(now);
    const parsed = JSON.parse(raw);
    // SCHEMA_VERSION had been written on every save since the first commit and
    // read by nothing. This is the one thing it is actually for: a save from a
    // future build is about to be normalised against today's field list, which
    // drops anything this version has never heard of — so keep the original
    // before that happens.
    if (isObject(parsed) && Number(parsed.version) > SCHEMA_VERSION) {
      futureSaveKey = keepAside('newer');
      console.warn('NightCheck: this save was written by a newer version.');
    }
    const normalized = normalizeState(parsed, now);
    if (damagedSave(parsed, normalized)) {
      damagedBackupKey = keepAside('damaged');
      console.warn('NightCheck: parts of the saved data could not be understood.');
    }
    return normalized;
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
let futureSaveKey = null;
let damagedBackupKey = null;

/** Set when the last load read a save from a newer build and stashed it aside. */
export function recoveredFutureSave() {
  return futureSaveKey;
}

/** Set when the last load read a save that parsed but had lost something. */
export function recoveredDamagedSave() {
  return damagedBackupKey;
}

/** Set when the last load found unreadable data and stashed it aside. */
export function recoveredCorruptData() {
  return corruptBackupKey;
}

let writeFailed = false;
let onWriteFailure = null;

/** Called once, the first time a save is refused. */
export function onSaveFailure(fn) {
  onWriteFailure = fn;
}

function writeNow(state) {
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(state));
    writeFailed = false;
  } catch (err) {
    // A console warning is not a user-facing anything. Storage refuses writes
    // for real reasons — quota, private browsing, a full disk — and every one
    // of them means the night being checked off is going nowhere. Silence here
    // costs somebody their evening.
    console.warn('NightCheck: could not save.', err);
    if (!writeFailed) {
      writeFailed = true;
      onWriteFailure?.(err);
    }
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
  // Through the debounce's own flush, so the armed timer is cleared rather than
  // left to fire into a body that has to re-check `pendingState` to be harmless.
  scheduleWrite.flush();
}

/**
 * Throw away a queued write.
 *
 * Used when this tab adopts another tab's state: our pending copy is now stale
 * by definition, and letting the debounce fire it would overwrite the tab we
 * just synced from — last-writer-wins, reintroduced by the code that exists to
 * prevent it.
 */
export function cancelPersist() {
  pendingState = null;
  scheduleWrite.cancel();
}

export function serializeState(state) {
  return JSON.stringify({ ...state, exportedAt: new Date().toISOString() }, null, 2);
}

/** When a backup file says it was written, if it says at all. */
export function exportedAtOf(text) {
  try {
    const value = JSON.parse(text)?.exportedAt;
    if (typeof value !== 'string') return null;
    const at = new Date(value);
    return Number.isNaN(at.getTime()) ? null : at;
  } catch {
    return null;
  }
}

export function parseImport(text, now = new Date()) {
  const parsed = JSON.parse(text);
  if (!isObject(parsed) || !isObject(parsed.template)) {
    throw new Error('That file does not look like a NightCheck backup.');
  }
  if (!isObject(parsed.template.tasks) || !isObject(parsed.template.sections)) {
    throw new Error('That backup has no task list in it.');
  }
  // Importing replaces the only copy there is. Keep the outgoing one where it
  // can be recovered rather than trusting that the incoming file is what the
  // person thought it was.
  keepAside('replaced');
  return normalizeState(parsed, now);
}

/**
 * Copy the live save aside under a suffix.
 *
 * Used before an import replaces it, and when a save announces a schema newer
 * than this build understands — normalizeState rebuilds history entries from a
 * fixed field list, so an older build opening a newer save silently strips
 * whatever it does not recognise and then writes the loss back 250ms later.
 */
function keepAside(suffix) {
  if (!store) return null;
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return null;
    const key = `${STORAGE_KEY}.${suffix}`;
    store.setItem(key, raw);
    return key;
  } catch (err) {
    console.warn('NightCheck: could not set the old save aside.', err);
    return null;
  }
}

export { STORAGE_KEY };

export function clearStorage() {
  if (!store) return;
  // Every copy, not just the live one. The confirm says "no copy anywhere else
  // unless you exported one", and the recovery stashes — which hold a complete
  // older save — sat behind it untouched.
  store.removeItem(STORAGE_KEY);
  for (const suffix of ['corrupt', 'damaged', 'newer', 'replaced']) {
    store.removeItem(`${STORAGE_KEY}.${suffix}`);
  }
  corruptBackupKey = null;
  damagedBackupKey = null;
  futureSaveKey = null;
}
