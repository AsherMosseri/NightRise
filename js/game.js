/* XP, levels, titles, combo and badges.
   The pure math lives at the top; the `apply*` helpers mutate a state draft. */

import { clamp } from './util.js';

/**
 * Momentum, not speed.
 *
 * The original combo paid its biggest multiplier for checking seven boxes
 * inside 90 seconds — i.e. for standing in the bathroom tapping the phone
 * rather than doing the things. That is exactly backwards for an app whose
 * whole purpose is getting you off the phone and into bed.
 *
 * Momentum instead rises when the gap between check-offs looks like you
 * actually went and did it: longer than a token tap, shorter than a drift into
 * scrolling. Both failure modes reset it to x1.
 */
export const MOMENTUM_MIN_GAP_MS = 20 * 1000;
export const MOMENTUM_GRACE_MS = 3 * 60 * 1000;
export const COMBO_STEP = 0.25;
export const COMBO_MAX = 2.5;
export const BASE_TASK_XP = 10;
export const STREAK_THRESHOLD_PCT = 60;

/**
 * What a level is worth, now that it is the only thing a level does.
 *
 * The market used to gate items on level and does not any more — the bands all
 * expired by night 23 and gating them on nights instead would have shut 80% of
 * the shop on the person least able to open it. So levels buy nothing and
 * unlock nothing; they name you, and that is the whole job.
 *
 * Which made the ladder stopping at 25 a real hole. Measured against the
 * eight-minute list: level 25 lands on night 91 and the levels keep coming —
 * 30 on night 141, 42 on 314, 60 on 731 — so from three months in, a level-up
 * did not change a single thing anywhere in the app, including your own badge.
 * The tail below runs to 75, which is around three and a half years of nights.
 *
 * The names turn at 25 on purpose. The early ones are fanciful because the
 * early nights are, and everything past "Well Slept" is plain and about habit,
 * because that is what it actually is by then. Three of them were rewritten
 * after the suite caught them: "Old Hand" is already an achievement tier,
 * "Sound Sleeper" sits beside the tier "Sound Asleep", and "The Long Habit"
 * hinged on the same word as "Creature of Habit" — two rungs you cannot tell
 * apart in a toast. None of them names a duration:
 * a title is levels, levels are XP, and XP does not know how long you have been
 * here. "A Year of Nights" would be a lovely rung and a lie on any save that
 * played twice a week.
 */
export const TITLES = [
  { level: 1, name: 'Dreamer' },
  { level: 3, name: 'Night Owl' },
  { level: 5, name: 'Star Gazer' },
  { level: 8, name: 'Moon Walker' },
  { level: 12, name: 'Dusk Warden' },
  { level: 16, name: 'Void Sailor' },
  { level: 20, name: 'Constellation Keeper' },
  { level: 25, name: 'Well Slept' },
  { level: 30, name: 'Practised' },
  { level: 36, name: 'Creature of Habit' },
  { level: 42, name: 'Home by Dark' },
  { level: 50, name: 'Lamplighter' },
  { level: 60, name: 'Undisturbed' },
  { level: 75, name: 'At Rest' },
];

/** XP needed to get from `level` to `level + 1`. */
export function xpForLevel(level) {
  return Math.round(80 * Math.pow(Math.max(1, level), 1.35));
}

export function levelFromXp(xp) {
  let level = 1;
  let remaining = Math.max(0, xp);
  let need = xpForLevel(level);
  while (remaining >= need && level < 999) {
    remaining -= need;
    level += 1;
    need = xpForLevel(level);
  }
  // Clamped. At the 999 cap the loop stops while `remaining` keeps the entire
  // surplus, so pct was computed against one level's requirement: levelFromXp(1e12)
  // reported 111514506%, which the bar hid with Math.min but aria-valuenow did not.
  return { level, into: remaining, need, pct: Math.min(100, Math.round((remaining / need) * 100)) };
}

export function titleForLevel(level) {
  let title = TITLES[0].name;
  for (const entry of TITLES) if (level >= entry.level) title = entry.name;
  return title;
}

export function nextTitle(level) {
  return TITLES.find((entry) => entry.level > level) || null;
}

/** What an unreached title shows instead of its name. */
export const HIDDEN_TITLE = '· · ·';

/**
 * The ladder as it should be shown: you can see how far away each rung is, but
 * not what it is called until you are standing on it. A list of every name you
 * will ever be given is a list of endings, and reading it is most of the fun
 * gone — the reveal is the reward.
 */
export function titleLadder(level) {
  return TITLES.map((entry) => ({
    level: entry.level,
    earned: level >= entry.level,
    name: level >= entry.level ? entry.name : null,
  }));
}

/** Multiplier for the nth task in a back-to-back chain (1-based). */
export function comboMultiplier(chainLength) {
  return clamp(1 + (Math.max(1, chainLength) - 1) * COMBO_STEP, 1, COMBO_MAX);
}

/**
 * The row taper — the same rule as the night's, one level down.
 *
 * `taskXp` was `10 + minutes`, flat, all the way to the 600-minute ceiling the
 * duration field allows. The night taper bounds an evening, not a row, so the
 * cheapest way to earn was still to type one number: a single ten-hour row paid
 * 765 XP for one tap, more than a genuine eighteen-task night pays for eighteen.
 * The taper could not catch it, because one row of face 1,525 is exactly what a
 * long honest night looks like from the outside.
 *
 * So a row's minutes get their own full-pay band and their own log tail. Below
 * `TASK_FULL_MINUTES` nothing changes at all, which is every real task on a
 * bedtime list — a shower, a tidy, a stretch, twenty minutes of reading. Past it
 * a longer estimate is still worth more, just never proportionally more: the
 * ten-hour row is now worth about twice the half-hour one rather than twenty
 * times it.
 *
 * Same three properties as `nightCurve`, for the same reasons: continuous and
 * smooth at the join (slope 1 on both sides), strictly concave after it, and
 * monotonic — so raising a task's estimate can never lower what it pays, and no
 * edit to a minute field can make a tap cost you XP.
 */
export const TASK_FULL_MINUTES = 30;
export const TASK_TAPER_MINUTES = 20;

export function minuteCurve(minutes) {
  const m = Math.max(0, minutes || 0);
  if (m <= TASK_FULL_MINUTES) return m;
  return TASK_FULL_MINUTES + TASK_TAPER_MINUTES
    * Math.log1p((m - TASK_FULL_MINUTES) / TASK_TAPER_MINUTES);
}

export function taskXp(minutes, multiplier = 1) {
  return Math.max(1, Math.round((BASE_TASK_XP + minuteCurve(minutes)) * multiplier));
}

/**
 * Stardust from XP.
 *
 * Was `xp / 5`. An eighteen-task night earned 543 stardust against a total sink
 * of 8,525 — every sky, sound, trail, font and companion owned in a fortnight,
 * and after that the envelope, the quest, lights out, achievement tiers and
 * level-ups all still paid in a currency that bought nothing.
 *
 * The divisor stops at 8 rather than going further because of the floor: past
 * about 12 a six-minute task and a twenty-minute one both round to 1, and a
 * reward that no longer varies with what you did is not a reward. The rest of
 * the rebalance is on the price side, where it belongs — wanting a 1,550
 * stardust sky and earning 27 a night reads better than wanting a 300 one and
 * earning 5.
 */
export function stardustFor(xp) {
  return Math.max(1, Math.round(xp / 8));
}

export function levelUpDust(level) {
  return 40 + level * 10;
}

/* ------------------------------------------------------------ the taper */

/**
 * How much of a night's face value the night actually pays.
 *
 * The economy used to price ROWS, not evenings. `taskXp` was `10 + minutes`, and
 * that flat 10 is a per-row subsidy — so the same forty-five minutes of work
 * paid 183 XP written as four tasks and 6,440 written as four hundred, a factor
 * of thirty-five. `nightCompletionBonus` is `40 + total * 6`, a second per-row
 * payment. Together they meant the highest-yield action in a game about getting
 * off your phone was sitting on your phone typing rows.
 *
 * So `taskXp` is unchanged and is now the row's FACE value — what the row is
 * worth on its own. This curve decides what the night pays for it. The first
 * `NIGHT_FULL_XP` of face pays pound for pound, which covers a good honest
 * night with headroom; past that each further pound pays a little less than the
 * one before. There is no wall — log growth — so a longer list always earns
 * more, just never proportionally more.
 *
 * Continuous and smooth at the join (S'(H⁻) = S'(H⁺) = 1), strictly concave
 * after it, and monotonically increasing everywhere — which is the property
 * that makes a tap unable to pay a negative amount.
 */
export const NIGHT_FULL_XP = 450;
export const NIGHT_TAPER_XP = 150;

export function nightCurve(face) {
  const f = Math.max(0, face || 0);
  if (f <= NIGHT_FULL_XP) return f;
  return NIGHT_FULL_XP + NIGHT_TAPER_XP * Math.log1p((f - NIGHT_FULL_XP) / NIGHT_TAPER_XP);
}

/**
 * The face value tonight has accumulated, derived rather than accumulated.
 *
 * Derived on purpose: an accumulator can drift out of step with the records,
 * and this project has closed that exact class of bug four times.
 */
export function nightFace(night) {
  let xp = 0;
  let dust = 0;
  for (const award of Object.values(night.awards)) {
    xp += award?.face || 0;
    dust += award?.faceDust || 0;
  }
  for (const record of Object.values(night.started)) xp += record?.face || 0;
  xp += night.bonus?.face || 0;
  dust += night.bonus?.faceDust || 0;
  return { xp, dust };
}

/** What the night should have paid, given the face it holds. */
export function nightTarget(night) {
  const face = nightFace(night);
  const xp = Math.round(nightCurve(face.xp));
  // Stardust is discounted in exactly the same proportion as the XP, so the
  // two currencies cannot drift apart and there is one rule to explain.
  const share = face.xp > 0 ? xp / face.xp : 1;
  return { xp, dust: Math.round(face.dust * share) };
}

/**
 * Pay the difference between what tonight has paid and what it should have.
 *
 * This is the whole reversibility contract, and it is structural rather than
 * maintained: the profile's contribution from tonight is a pure function of the
 * records tonight holds, so ANY sequence that returns the records to a previous
 * shape returns the balance with them. Un-tick the third of forty, delete a
 * section and undo it, reset the checkmarks — none of them need to know what
 * anything paid, because nothing is reconciled by amount or by presence. It is
 * simply re-derived.
 *
 * The curve is monotonic, so adding face can only raise the target and removing
 * it can only lower it: a completion can never pay a negative amount.
 */
export function settleNight(state) {
  const night = state.night;
  if (!night.paid) night.paid = { xp: 0, dust: 0 };
  const carried = night.carried || { xp: 0, dust: 0 };
  const target = nightTarget(night);
  // A date pays for its BEST run, not for the sum of its runs. `carried` is what
  // an earlier run of this same date already put in the profile, so the floor
  // here is what stops "Bank tonight and start fresh" from handing out a second
  // budget for a date that has already been paid for — and taking the max
  // rather than adding is what stops it clawing back the earlier run when the
  // fresh night's face is still zero.
  //
  // On every ordinary night `carried` is zero and this is exactly the old
  // arithmetic: target, and the difference from what the night has paid.
  const want = { xp: Math.max(target.xp, carried.xp), dust: Math.max(target.dust, carried.dust) };
  const dXp = want.xp - night.paid.xp;
  const dDust = want.dust - night.paid.dust;
  if (dXp > 0 || dDust > 0) grantXp(state, Math.max(0, dXp), Math.max(0, dDust));
  if (dXp < 0 || dDust < 0) revokeGrant(state, Math.max(0, -dXp), Math.max(0, -dDust));
  night.paid = want;
  return { xp: dXp, dust: dDust };
}

/**
 * What finishing this task would pay right now — the marginal step of the
 * curve, computed with the identical arithmetic the payment uses, so the number
 * on the card before you tap and the number you receive cannot differ.
 */
export function marginalXp(night, face) {
  const held = nightFace(night).xp;
  return Math.max(0, Math.round(nightCurve(held + Math.max(0, face || 0))) - Math.round(nightCurve(held)));
}

/* The badge shelf used to live here as a flat list of thirteen one-shots. It is
   now `js/achievements.js`: tiered families measured off numbers, with progress
   bars. It imports COMBO_MAX from this module, so nothing here may import it
   back — falling out of a tier is reported by `dropUnearnedTiers`, which the
   actions call after a revoke has settled. */

/**
 * Grant XP (and optional stardust). Returns the levels crossed.
 *
 * Level-up stardust is paid against a high-water mark. Without it, crossing a
 * level boundary, un-checking the task and re-checking it paid the level bonus
 * again every time — the level is recomputed from XP, so the same boundary can
 * be crossed all night.
 */
/**
 * Pay stardust, settling any debt first.
 *
 * A debt exists when something was taken back that you had already spent. It is
 * never shown to you and it cannot make the balance negative — it just means
 * the next dust you earn goes to the shortfall before it reaches your pocket.
 */
export function addDust(profile, amount) {
  let credit = Math.max(0, amount || 0);
  const debt = Math.max(0, profile.dustDebt || 0);
  if (debt > 0) {
    const cleared = Math.min(debt, credit);
    profile.dustDebt = debt - cleared;
    credit -= cleared;
  }
  profile.stardust = Math.max(0, profile.stardust + credit);
}

export function grantXp(state, xp, dust = 0) {
  const { profile } = state;
  const before = profile.level;
  profile.xp = Math.max(0, profile.xp + xp);
  addDust(profile, dust);
  const after = levelFromXp(profile.xp).level;
  profile.level = after;
  const levelsGained = [];
  // How much the level-ups actually paid. The high-water mark means crossing a
  // boundary you have crossed before pays nothing, and the toast said "bonus
  // stardust awarded" regardless — a claim that was simply false any time you
  // had fallen back a level and climbed it again.
  let paid = 0;
  for (let lvl = before + 1; lvl <= after; lvl += 1) {
    levelsGained.push(lvl);
    if (lvl > (profile.maxLevelRewarded || 1)) {
      const dustPaid = levelUpDust(lvl);
      addDust(profile, dustPaid);
      paid += dustPaid;
      profile.maxLevelRewarded = lvl;
    }
  }
  // Non-enumerable: callers treat this as a plain array of levels and compare
  // it with deepEqual, so the extra fact rides along without changing its shape.
  Object.defineProperty(levelsGained, 'dust', { value: paid });
  return levelsGained;
}

/** How long a task claiming `minutes` may reasonably take before you have drifted. */
export function momentumWindow(minutes) {
  const expected = Math.max(0, minutes || 0) * 60 * 1000;
  return clamp(expected * 2.5, 4 * 60 * 1000, 25 * 60 * 1000) + MOMENTUM_GRACE_MS;
}

/**
 * And how *fast* is too fast to have been real work.
 *
 * The ceiling has always scaled with the task and the floor was a flat twenty
 * seconds, which is inconsistent in a way that lands entirely on short lists.
 * Twenty seconds is nothing against a fifteen-minute task and is most of a
 * thirty-second one — so a night of half-minute jobs kept failing the floor,
 * sat at x1 all evening, and paid the rounding floor of one stardust a task.
 * A list of quick tasks is not a dishonest list.
 *
 * Proportional now, and still bounded: never less than ten seconds, because the
 * floor exists to stop a phone being tapped in a bathroom, and never more than
 * the twenty it always was.
 */
export function momentumFloor(minutes) {
  const expected = Math.max(0, minutes || 0) * 60 * 1000;
  return clamp(expected * 0.5, 10 * 1000, MOMENTUM_MIN_GAP_MS);
}

/**
 * The chain length this completion earns. 1 means the chain restarted: either
 * the tap came too fast to be real work, or too long after the last one.
 */
export function chainLengthFor(night, at, lastMinutes = 0) {
  const last = night.lastDoneAt;
  if (!last) return 1;
  const gap = at - last;
  if (gap < momentumFloor(lastMinutes)) return 1;
  if (gap > momentumWindow(lastMinutes)) return 1;
  return Math.round((night.combo - 1) / COMBO_STEP) + 2;
}

/**
 * An advance, paid for saying you have started.
 *
 * The whole economy pays at the far end of a task, which for someone who dreads
 * the task means 100% of the reward sits on the other side of the exact moment
 * they bail. This moves a small fixed amount to the moment of highest
 * resistance — and `applyTaskCompletion` deducts it from what finishing pays,
 * so the total for a task is unchanged and nothing is printed.
 *
 * It buys no stardust at all — see applyTaskStart for why that has to be spelled
 * out rather than passed as a zero.
 *
 * The XP it can pay is bounded by the same nightly ceiling as everything else
 * (see `nightBudget`), because "twelve tasks started is only 36 XP" was true of
 * a twelve-task list and of nothing else: five thousand rows started and none
 * finished measured 15,000 XP and level 13. A ceiling that holds only at the
 * size you happened to test it is not a ceiling.
 */
export const START_ADVANCE_XP = 3;

/**
 * Fix tonight's bedtime and last call, once, the moment the night starts costing
 * something. Before that nothing has been measured and changing the target is
 * simply correcting it; after it, a change belongs to tomorrow.
 *
 * One way on purpose. Un-checking everything does NOT release it, or "tick,
 * untick, move the bedtime, re-tick" would be the same loophole with two more
 * steps in it.
 *
 * Written here rather than in night.js because night.js already imports from
 * this module, and it needs nothing but the two fields.
 */
export function lockTonightTargets(state) {
  const { night, profile } = state;
  if (night.bedtime === null || night.bedtime === undefined) night.bedtime = profile.settings.bedtime;
  if (night.lastCall === null || night.lastCall === undefined) night.lastCall = profile.settings.lastCall;
}

export function applyTaskStart(state, task, at = Date.now()) {
  const night = state.night;
  if (night.started[task.id] || night.done[task.id] !== undefined) return null;
  lockTonightTargets(state);
  // Not a completion: it must not touch the combo, `lastDoneAt` or
  // `lastMinutes`. Momentum is for work you finished.
  //
  // Face, and no dust face at all — starting buys no stardust, which is now
  // true by construction rather than by list size. It used to pay through
  // `grantXp(state, XP, 0)`, and that `0` only suppresses the direct dust
  // argument: the level-up loop inside pays `levelUpDust` on its own, so the
  // claim held only until the advances crossed a level boundary. At 27 rows
  // that was 60 stardust and at 5,000 it was 1,380, with nothing completed.
  night.started[task.id] = { at, face: START_ADVANCE_XP };
  const paid = settleNight(state);
  return { xp: paid.xp, at };
}

/** Give back an advance — used when the task itself is deleted. */
export function revokeTaskStart(state, taskId) {
  const record = state.night.started[taskId];
  delete state.night.started[taskId];
  if (record) settleNight(state);
  return record || null;
}

/**
 * Award a task completion. Mutates `state` and records the exact award so
 * un-checking can reverse it precisely.
 */
export function applyTaskCompletion(state, task, at = Date.now()) {
  const night = state.night;
  const chain = chainLengthFor(night, at, night.lastMinutes || 0);
  const multiplier = comboMultiplier(chain);
  // The row's FACE value — what it is worth on its own. What the night pays for
  // it is the taper's business, settled below. The advance already paid against
  // this row comes off the face, so starting and then finishing costs the night
  // exactly what finishing alone would have.
  lockTonightTargets(state);
  const full = taskXp(task.minutes, multiplier);
  const face = Math.max(1, full - (night.started[task.id]?.face || 0));
  const faceDust = stardustFor(full);

  night.done[task.id] = at;
  delete night.skipped[task.id];
  // Remember the chain state this completion replaced so un-checking can put
  // it back; otherwise re-checking one task ratchets the combo upward forever.
  night.awards[task.id] = {
    face, faceDust, multiplier, at, prevCombo: night.combo, prevLastDoneAt: night.lastDoneAt,
  };
  night.awards[task.id].prevMinutes = night.lastMinutes || 0;
  night.combo = multiplier;
  night.maxCombo = Math.max(night.maxCombo || 1, multiplier);
  night.lastDoneAt = at;
  night.lastMinutes = Math.max(0, task.minutes || 0);

  const beforeLevel = state.profile.level;
  const paid = settleNight(state);
  const levels = [];
  for (let lvl = beforeLevel + 1; lvl <= state.profile.level; lvl += 1) levels.push(lvl);
  return { xp: paid.xp, dust: paid.dust, face, multiplier, chain, levels };
}

/** Take back an exact amount, keeping the level in step. */
/**
 * Falling back below a level takes the level's reward with it. Reaching level 5
 * and then un-checking your way back to level 4 should leave you at level 4 in
 * every sense — not level 4 holding level 5's stardust.
 *
 * The one exception is dust you have already spent. It cannot be clawed out of
 * a purchase, and a negative balance is not an answer, so the high-water mark
 * stays up instead: you keep it, and that level is never paid a second time.
 */
function refundLevelUps(profile) {
  let reclaimed = 0;
  while ((profile.maxLevelRewarded || 1) > profile.level) {
    const dust = levelUpDust(profile.maxLevelRewarded);
    if (profile.stardust < dust) break;
    profile.stardust -= dust;
    profile.maxLevelRewarded -= 1;
    reclaimed += dust;
  }
  return reclaimed;
}

/** Reverses a grant exactly, including anything the level it bought paid out. */
export function revokeGrant(state, xp, dust) {
  const { profile } = state;
  const before = profile.level;
  profile.xp = Math.max(0, profile.xp - (xp || 0));
  // Taking back dust you have already spent cannot come out of the balance, and
  // clamping it at zero *forgave* it: earn 100, spend 100, un-tick, and the
  // same 100 could be earned again with the goods already in hand. What cannot
  // be taken is remembered instead, and the next dust you earn pays it off.
  const owed = Math.max(0, dust || 0);
  const taken = Math.min(profile.stardust, owed);
  profile.stardust -= taken;
  if (owed > taken) profile.dustDebt = Math.max(0, profile.dustDebt || 0) + (owed - taken);
  profile.level = levelFromXp(profile.xp).level;
  // How much of the level bonus actually came back. It breaks out the moment
  // the balance cannot cover it, and the toast announced "that level's bonus
  // went back too" either way — telling you something had been reclaimed when
  // nothing had.
  const reclaimed = refundLevelUps(profile);
  const levelsLost = [];
  for (let lvl = before; lvl > profile.level; lvl -= 1) levelsLost.push(lvl);
  return { levelsLost, reclaimed };
}

export function revokeTaskCompletion(state, taskId) {
  const night = state.night;
  const award = night.awards[taskId];
  delete night.done[taskId];
  delete night.awards[taskId];
  if (!award) return null;
  // Nothing is reconciled by amount. The record is gone, so the night's face is
  // lower, so the target is lower — settling hands the difference back.
  const beforeLevel = state.profile.level;
  settleNight(state);
  const undone = { levelsLost: [], reclaimed: 0 };
  for (let lvl = beforeLevel; lvl > state.profile.level; lvl -= 1) undone.levelsLost.push(lvl);
  award.reclaimed = undone.reclaimed;
  // Only the most recent completion owns the current chain.
  if (award.at !== undefined && night.lastDoneAt === award.at) {
    night.combo = award.prevCombo ?? 1;
    night.lastDoneAt = award.prevLastDoneAt ?? 0;
    night.lastMinutes = award.prevMinutes ?? 0;
  }
  return award;
}

/** One-off bonus for clearing everything that still counts tonight. */
export function nightCompletionBonus(stats) {
  const base = 40 + stats.total * 6;
  return { xp: base, dust: stardustFor(base) };
}
