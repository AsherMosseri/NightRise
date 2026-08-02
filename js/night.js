/* The nightly cycle: live stats, rollover, banking, streaks and freezes. */

import { createNight } from './model.js';
import { nightKeyOf, keyDiffDays, bedtimeInstant } from './time.js';
import { STREAK_THRESHOLD_PCT } from './game.js';
import { checkAchievements } from './achievements.js';
import { questById } from './quests.js';

/**
 * The bedtime and last call TONIGHT is judged against.
 *
 * `night.bedtime` is fixed the first time the night costs you something and is
 * null before that, so this reads the live setting on a night that has not
 * started and the stamped one on a night that has. Everything that judges
 * tonight — the countdown, the pacing chip, the stages, the panel gate, what
 * stopping pays, whether it was on time — has to come through here, or the
 * setting can still be edited out from under the night it is judging.
 *
 * A change made mid-night is not refused. It applies tomorrow, which is also
 * what the morning reckoning has always offered.
 */
export function tonightBedtime(state) {
  return state.night.bedtime ?? state.profile.settings.bedtime;
}

export function tonightLastCall(state) {
  return state.night.lastCall ?? state.profile.settings.lastCall;
}

/** True once tonight's targets are fixed and the setting has moved off them. */
export function bedtimeMovesTomorrow(state) {
  return state.night.bedtime !== null && state.night.bedtime !== undefined
    && state.night.bedtime !== state.profile.settings.bedtime;
}

export function lastCallMovesTomorrow(state) {
  return state.night.lastCall !== null && state.night.lastCall !== undefined
    && state.night.lastCall !== state.profile.settings.lastCall;
}

/** Live view of tonight — used by the header, sky, quests and pacing. */
export function computeStats(state) {
  const { template, night } = state;
  const sections = [];
  let total = 0;
  let done = 0;
  let skipped = 0;
  let minutesRemaining = 0;

  for (const sectionId of template.order) {
    const section = template.sections[sectionId];
    if (!section) continue;
    const entry = { id: sectionId, title: section.title, total: 0, done: 0, skipped: 0, remaining: 0 };
    for (const taskId of section.taskIds) {
      const task = template.tasks[taskId];
      if (!task) continue;
      entry.total += 1;
      total += 1;
      // Presence, not truthiness — a completion timestamp could legitimately be 0.
      if (night.done[taskId] !== undefined) {
        entry.done += 1;
        done += 1;
      } else if (night.skipped[taskId]) {
        entry.skipped += 1;
        skipped += 1;
      } else {
        entry.remaining += 1;
        minutesRemaining += Math.max(0, task.minutes || 0);
      }
    }
    sections.push(entry);
  }

  const counted = total - skipped;
  const remaining = total - done - skipped;
  const pct = total === 0 || counted === 0 ? 0 : Math.round((done / counted) * 100);
  return { total, done, skipped, remaining, counted, pct, minutesRemaining, sections };
}

export function summarizeForHistory(stats, xpEarned) {
  return {
    total: stats.total,
    done: stats.done,
    skipped: stats.skipped,
    pct: stats.pct,
    xp: Math.round(xpEarned || 0),
    quest: false,
    frozen: false,
    lightsOutAt: null,
    onTime: false,
    // The target as it stood that night, so changing your bedtime later cannot
    // rewrite whether you made it, and how far off you were either way.
    bedtime: null,
    minutesLate: null,
  };
}

/** How late the night ended against its own target. Negative is early. */
export function latenessOf(night, bedtime) {
  if (!night.lightsOutAt) return null;
  const target = bedtimeInstant(night.key, bedtime);
  if (!target) return null;
  return Math.round((night.lightsOutAt - target.getTime()) / 60000);
}

function stampBedtime(entry, state) {
  const { night, profile } = state;
  entry.lightsOutAt = night.lightsOutAt || null;
  entry.onTime = Boolean(night.lightsOutOnTime);
  // What the night was JUDGED against, not what the setting says now. They are
  // the same on a night nobody edited, and the stamped one is the honest record
  // on a night somebody did.
  const target = night.bedtime ?? profile.settings?.bedtime;
  entry.bedtime = night.lightsOutAt ? (target || null) : null;
  entry.minutesLate = latenessOf(night, target);
  return entry;
}

/**
 * What tonight actually paid — the number the history entry keeps forever.
 *
 * This summed `night.awards` alone, which is the record of what the *tasks*
 * paid. It omitted the completion bonus, the start advances, the quest and the
 * lights-out reward, so the one place a night's worth is written down
 * permanently understated every cleared night: 313 recorded against 419
 * received, on the shipped list. Understating is still the app claiming
 * something the code does not measure, and it is the direction nobody checks.
 *
 * The test beside this asserts the sum equals the profile's actual delta across
 * `bankNight`, so a future reward that forgets to appear here fails loudly
 * rather than quietly shrinking the record.
 */
function xpEarnedTonight(state) {
  const { night } = state;
  // `night.paid` is what the list actually paid after the taper — the same
  // running total settleNight keeps — so this cannot drift from the profile.
  // The quest and lights-out sit outside the taper and are added on top.
  let sum = night.paid?.xp || 0;
  sum += night.lightsOutAward?.xp || 0;
  if (night.quest?.claimed) sum += questById(night.quest.id)?.xp || 0;
  return sum;
}

function updateTaskStats(state, stats) {
  const { template, night, profile } = state;
  if (!profile.taskStats) profile.taskStats = {};
  for (const task of Object.values(template.tasks)) {
    const entry = profile.taskStats[task.id] || { seen: 0, done: 0, skipped: 0, missStreak: 0, lastDoneKey: null };
    entry.seen += 1;
    if (night.done[task.id] !== undefined) {
      entry.done += 1;
      entry.missStreak = 0;
      entry.lastDoneKey = night.key;
    } else {
      if (night.skipped[task.id]) entry.skipped += 1;
      entry.missStreak += 1;
    }
    profile.taskStats[task.id] = entry;
  }
  // Forget stats for tasks that no longer exist.
  for (const id of Object.keys(profile.taskStats)) {
    if (!template.tasks[id]) delete profile.taskStats[id];
  }
  return stats;
}

/**
 * Fold the finished night into history and update the streak.
 * A Streak Freeze covers one missed night — including nights where the app
 * was never opened, detected via the gap since the last banked night.
 */
export function bankNight(state, stats) {
  const { profile, night } = state;
  const xp = xpEarnedTonight(state);
  const met = stats.total > 0 && stats.pct >= STREAK_THRESHOLD_PCT;

  const result = {
    key: night.key, stats, met, xp,
    streakBefore: profile.streak, streakAfter: profile.streak,
    frozenUsed: 0, missedNights: 0, badges: [], alreadyBanked: false,
  };

  // Banking is idempotent per night key. Without this, "start a fresh night"
  // followed by the 4am rollover banked the same key twice: the second pass saw
  // an empty night, overwrote a 100% history entry with 0%, burned a freeze and
  // reset the streak.
  //
  // The history entry is the exception. Starting fresh gives the same date a
  // second run, and what you did on a date is the best you got to on it — so
  // the entry may improve, while the streak, the freezes and the per-task
  // stats stay counted exactly once.
  if (profile.lastBankedKey === night.key) {
    result.alreadyBanked = true;
    const previous = state.history[night.key];
    if (stats.total > 0 && (!previous || stats.pct > previous.pct)) {
      const better = summarizeForHistory(stats, xp);
      better.quest = Boolean(night.quest?.claimed) || Boolean(previous?.quest);
      stampBedtime(better, state);
      if (!better.lightsOutAt && previous?.lightsOutAt) {
        // A second run at the same night keeps the bedtime the first one recorded.
        better.lightsOutAt = previous.lightsOutAt;
        better.onTime = Boolean(previous.onTime);
        better.bedtime = previous.bedtime ?? null;
        better.minutesLate = previous.minutesLate ?? null;
      }
      better.frozen = Boolean(previous?.frozen);
      state.history[night.key] = better;
    }
    return result;
  }

  // Nothing was ever on the list; don't judge it. But the night was still seen,
  // and `lastBankedKey` is what `gapMissed` measures from — leaving it behind
  // meant six empty nights were "not judged" at the time and then charged all at
  // once against the first night you did work, taking a six-night streak to one.
  // The streak, the freezes, the history entry and the task stats stay untouched.
  if (stats.total === 0) {
    // Forward only, here too. This used to write the key unconditionally, so a
    // backwards clock quietly reset the high-water mark and the next honest
    // night was charged for a gap that never happened.
    if (!profile.lastBankedKey || keyDiffDays(profile.lastBankedKey, night.key) > 0) {
      profile.lastBankedKey = night.key;
    }
    return result;
  }

  // A night older than the last one banked is a wrong clock, not a night.
  //
  // `gapMissed` clamps a negative day-difference to zero, which reads a night
  // dated BACKWARDS as "no gap at all" — so `needed` was 0, the streak grew by
  // one, a history entry appeared and nightsLogged went up, every single time.
  // Marching the key backwards was an unbounded streak, history and
  // achievement farm; the on-time and nights families are measured off exactly
  // these numbers. Treated like the already-banked case: the history entry may
  // still improve, and nothing else is touched.
  if (profile.lastBankedKey && keyDiffDays(profile.lastBankedKey, night.key) < 0) {
    result.alreadyBanked = true;
    return result;
  }

  const gapMissed = profile.lastBankedKey
    ? Math.max(0, keyDiffDays(profile.lastBankedKey, night.key) - 1)
    : 0;
  const needed = gapMissed + (met ? 0 : 1);
  result.missedNights = needed;

  // The list streak is a plain count now, and freezes no longer touch it. A
  // Streak Freeze costs 310 stardust and its own copy says it saves your
  // streak — so it has to guard the one in the top bar, which is the clean-night
  // streak below. Spending it on the demoted chip instead would be the item
  // lying about what it does.
  profile.streak = (met && gapMissed === 0) ? profile.streak + 1 : (met ? 1 : 0);

  profile.bestStreak = Math.max(profile.bestStreak, profile.streak);
  profile.nightsLogged += 1;
  profile.lastBankedKey = night.key;

  // A night that was never explicitly ended still gets a verdict. Skipped when
  // Lights out was pressed, because that already settled this key — pressing it
  // is the strongest evidence there is and must not be second-guessed by an
  // inference from the same night's timestamps.
  const lights = profile.lightsOut;
  if (lights && lights.lastKey !== night.key) {
    const onTime = inferredOnTime(state, night);
    // `lightsOutOnTime` stays the plain fact — you stopped before your bedtime.
    // It is what the history heatmap and the permanent night star are for, and
    // those are earned by sleeping, not by finishing. The streak asks for more.
    if (onTime) night.lightsOutOnTime = true;
    const clean = isCleanNight(stats, onTime);
    result.onTime = onTime;
    result.clean = clean;

    // All-or-nothing, the way it has always been: enough freezes to cover every
    // missed night, or none are spent and the streak goes. Half-covering a gap
    // spends the tokens and loses the streak anyway, which is the worst of both.
    const owed = gapMissed + (clean ? 0 : 1);
    if (owed === 0) {
      advanceLightsOutStreak(lights, night.key, true);
    } else if (lights.streak > 0 && profile.tokens.freeze >= owed) {
      profile.tokens.freeze -= owed;
      result.frozenUsed = owed;
      // The freeze holds the streak where it was; a clean night on top of a
      // covered gap still moves it forward.
      lights.lastKey = night.key;
      if (clean) lights.streak += 1;
      lights.best = Math.max(lights.best || 0, lights.streak);
    } else {
      advanceLightsOutStreak(lights, night.key, clean);
    }
  } else {
    result.onTime = Boolean(night.lightsOutOnTime);
    result.clean = Boolean(night.lightsOutOnTime);
  }

  const entry = summarizeForHistory(stats, xp);
  entry.quest = Boolean(night.quest?.claimed);
  stampBedtime(entry, state);
  entry.frozen = result.frozenUsed > 0;
  state.history[night.key] = entry;

  updateTaskStats(state, stats);
  result.streakAfter = profile.streak;
  result.achievements = checkAchievements(state, stats);
  return result;
}

/**
 * Roll over to a new night if the clock has crossed the 4am boundary.
 * Returns the banking result, or null when nothing changed.
 */
/**
 * The shortest real time in which one night can honestly become the next.
 *
 * A night is at least a day long, so six hours is generous — it only has to be
 * shorter than any real gap and longer than the time it takes to change a
 * device clock twice.
 */
export const MIN_REAL_MS_BETWEEN_BANKS = 6 * 60 * 60 * 1000;

export function rolloverIfNeeded(state, now = new Date()) {
  const key = nightKeyOf(now);
  if (state.night.key === key) return null;
  // Only ever roll forward. A clock correction, a timezone hop westward or a
  // manually-set date could otherwise re-bank an old key and overwrite history.
  //
  // A night dated exactly one day ahead is not a rollover, it is a mistake to
  // undo: "start fresh" used to jump a day forward, which left the app
  // insisting it was tomorrow — tomorrow's date in the header, and "24h 32m
  // left" until a bedtime half an hour away. Retitle it to tonight. Nothing has
  // ended, so nothing is banked. A bigger gap is a wrong clock rather than our
  // bug, and renaming a night across a week could land on a real history entry.
  const drift = keyDiffDays(state.night.key, key);
  if (drift < 0) {
    if (drift === -1) state.night.key = key;
    return null;
  }
  // Every per-date guard in this app keys off the night key, and the night key
  // comes from the device clock — so a clock nudged forward a day and back paid
  // a full night's task XP, completion bonus, envelope, quest and lights-out
  // reward, on a loop, with no limit. A calendar day that arrives without real
  // time passing did not happen: retitle the night so the app is not stuck, and
  // bank nothing.
  const elapsed = now.getTime() - (state.profile.lastBankedAt || 0);
  if (state.profile.lastBankedAt && elapsed < MIN_REAL_MS_BETWEEN_BANKS) {
    state.night.key = key;
    return null;
  }
  const stats = computeStats(state);
  const result = bankNight(state, stats);
  // Stamped here, from the same clock the guard above reads — not inside
  // bankNight from `Date.now()`, which is a different clock the moment anything
  // passes an explicit `now`. And only on this path: "bank tonight and start
  // fresh" does not advance the date, so stamping there would refuse the real
  // 4am rollover for six hours afterwards and the night would never bank.
  state.profile.lastBankedAt = now.getTime();
  state.night = createNight(key);
  return result;
}

/**
 * The lights-out streak: nights you stopped before your bedtime, back to back.
 *
 * "In a row" has to mean consecutive dates. This used to add one whenever there
 * was any previous on-time night at all, so three scattered across a month read
 * as three nights running — and a badge that says "three nights running" has to
 * be telling the truth.
 */
/**
 * Did this night end on time, when nobody pressed Lights out?
 *
 * The bedtime streak is the headline number now, and it used to advance only on
 * an explicit press — so going to bed early and simply closing the app read as a
 * miss. That is the app punishing you for the exact behaviour it exists to
 * cause, over a button.
 *
 * The evidence is the last thing you did here. If your final check-off — or the
 * last task you started, for a night where nothing got finished — was before
 * your bedtime, you were done before your bedtime. A night with no activity at
 * all is not on time: there is nothing to infer from, and a streak that grows
 * while the app sits unopened is measuring nothing.
 *
 * Deliberately NOT `night.startedAt`: that is when the night RECORD was made,
 * which is the 4am rollover, not something you did. It is present on every
 * night including ones nobody opened, and 4am is comfortably before any bedtime
 * — so counting it would have quietly handed the headline streak a night for
 * every day the app sat unopened, which is the exact opposite of the point.
 */
export function inferredOnTime(state, night = state.night) {
  let lastActivity = Number(night.lastDoneAt) || 0;
  for (const record of Object.values(night.started || {})) {
    lastActivity = Math.max(lastActivity, Number(record?.at) || 0);
  }
  if (!lastActivity) return false;
  const bedtime = bedtimeInstant(night.key, night.bedtime ?? state.profile.settings.bedtime);
  return Boolean(bedtime) && lastActivity <= bedtime.getTime();
}

/**
 * A clean night: everything that counted, done, and done before your bedtime.
 *
 * The headline streak used to ask only about the clock. That let one task
 * ticked at nine o'clock — or none at all, merely *started* — carry the streak,
 * which is not a night anybody would call a success. Both halves now have to be
 * true.
 *
 * "Everything that counted" is deliberately not "everything on the list": a
 * rain check takes a task out of the denominator entirely, and that is exactly
 * what rain checks are for. Two come free every night and more cost 100
 * stardust, so an honest bad evening has a way to stay honest without the
 * streak being a lie about it.
 *
 * An empty list is not a clean night. There is nothing to have finished, and a
 * streak that grows on a list with no tasks on it measures nothing — the same
 * hole `inferredOnTime` closes for nights nobody opened.
 */
export function isCleanNight(stats, onTime) {
  if (!onTime || !stats) return false;
  return stats.total > 0 && stats.counted > 0 && stats.pct >= 100;
}

export function advanceLightsOutStreak(lights, key, onTime) {
  if (!lights || lights.lastKey === key) return lights; // once per night, however many presses
  const consecutive = Boolean(lights.lastKey) && keyDiffDays(lights.lastKey, key) === 1;
  lights.streak = onTime ? (consecutive ? (lights.streak || 0) + 1 : 1) : 0;
  lights.best = Math.max(lights.best || 0, lights.streak);
  lights.lastKey = key;
  return lights;
}

/**
 * The bedtime streak as it actually stands.
 *
 * `lightsOut.streak` only changes inside `advanceLightsOutStreak`, which only
 * runs when you press Lights out — so nights you never end never touch it, and
 * the chip cheerfully read "5 on time" nineteen days after the last one. Same
 * problem `effectiveStreak` was written to solve for the list streak.
 *
 * `best` is untouched: a high-water mark is a record of what happened, and the
 * on-time achievement family is measured off it.
 */
export function effectiveLightsOutStreak(state, now = new Date()) {
  const lights = state.profile.lightsOut;
  if (!lights?.lastKey || !lights.streak) return 0;
  // A gap of one day is last night — the streak is live until tonight ends.
  return keyDiffDays(lights.lastKey, nightKeyOf(now)) > 1 ? 0 : lights.streak;
}

/**
 * Manual "start a fresh night" — bank what you did, then hand back a clean list
 * for the *same* night. It is still tonight; you have not gone to bed and woken
 * up, you have just decided to run the evening again.
 *
 * This used to advance to the next key, as a workaround for the 4am rollover
 * banking the same night twice. Banking is idempotent per key now, so the
 * workaround only did harm: it dated the night a day into the future, so the
 * header showed tomorrow and the bedtime countdown read a full day.
 */
export function forceNewNight(state, key, now = new Date()) {
  const stats = computeStats(state);
  const result = bankNight(state, stats);
  state.night = createNight(key || nightKeyOf(now));
  return result;
}

/**
 * Nights that have gone by unbanked since the last one you banked. The streak
 * in `profile` is only updated when a night is banked, so after three nights
 * away the app cheerfully showed the old number until 4am the next morning.
 */
export function pendingMisses(state, now = new Date()) {
  const { lastBankedKey } = state.profile;
  if (!lastBankedKey) return 0;
  return Math.max(0, keyDiffDays(lastBankedKey, nightKeyOf(now)) - 1);
}

/** The streak as it actually stands right now, not as it was last banked. */
export function effectiveStreak(state, now = new Date()) {
  const missed = pendingMisses(state, now);
  if (missed === 0) {
    return { streak: state.profile.streak, missed: 0, covered: 0, atRisk: false };
  }
  // Freezes moved to the clean-night streak, so a gap simply ends this one.
  return { streak: 0, missed, covered: 0, held: 0, atRisk: true };
}

/**
 * The clean-night streak as it stands, and what a freeze will do about a gap.
 *
 * The header has to promise exactly what bankNight will do, which is where the
 * old version of this went wrong for the list streak: it reported
 * `min(missed, held)`, so one freeze against two missed nights read as covered
 * and then 4am spent nothing and took the streak anyway.
 */
export function lightsOutOutlook(state, now = new Date()) {
  const lights = state.profile.lightsOut;
  const streak = effectiveLightsOutStreak(state, now);
  const missed = pendingMisses(state, now);
  const held = state.profile.tokens.freeze || 0;
  if (missed === 0 || !streak) {
    return { streak, missed: 0, covered: 0, held, atRisk: false };
  }
  const enough = held >= missed;
  return {
    streak: enough ? streak : 0,
    missed,
    covered: enough ? missed : 0,
    held,
    atRisk: true,
  };
}

