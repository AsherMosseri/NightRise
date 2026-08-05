/* Every panel that opens over the app: the Night Market, the star map,
   night history, insights, settings and the shortcut list. */

import { h, svg, icon, replace, withFocus, downloadText, rovingGroup } from '../dom.js';
import { getState, update, replaceState, emit } from '../state.js';
import {
  CONSUMABLES, allItems, supplyBlocker,
  canBuy, owns, isEquipped, purchase, equipItem, buyConsumable, nightsOnTime,
  feedCompanion, renameCompanion, unequipCompanion,
} from '../shop.js';
import { CONSTELLATIONS, progressFor, buyStar, collectionSummary, totalRemainingCost } from '../constellations.js';
import { FEED_COST, TIER_NAMES, feedsToNextTier, companionSvg } from '../companion.js';
import { levelFromXp, titleForLevel, titleLadder, HIDDEN_TITLE } from '../game.js';
import { achievementBoard, totalTiers, checkAchievements } from '../achievements.js';
import { taskInsights, reliableTasks, overallRate, nightsFullyCleared, onTimeNights } from '../insights.js';
import {
  forceNewNight, computeStats, effectiveStreak, effectiveLightsOutStreak,
  bedtimeMovesTomorrow, lastCallMovesTomorrow,
} from '../night.js';
import { still, growTo } from './motion.js';
import {
  shiftKey, keyToDate, formatShortDate, formatNightLabel, parseClock, formatClockLabel,
  LAST_CALL_CHOICES, BROWSE_BUDGET_CHOICES, formatLastCall, lastCallCapped,
} from '../time.js';
import { serializeState, parseImport, clearStorage, exportedAtOf } from '../storage.js';
import { createInitialState } from '../model.js';
import { SHORTCUTS } from '../keys.js';
import { previewPack, packTones } from '../audio.js';
import { setSkyPaused, trailSpec, trailTintCss } from '../sky.js';
import { toast } from '../toast.js';
import { formatNumber, plural, clamp } from '../util.js';
import { confirmAction, chooseAction } from './confirm.js';
import { RESET_PARTS, resetPartById, applyReset } from '../reset.js';
import { bedtimeAlarmIcs, ALARM_LEAD_MINUTES } from '../alarm.js';
import { refreshApp, runningVersion } from '../updates.js';
import {
  bedtimeSeries, bedtimeSummary, formatFromNoon, formatShift,
  BEDTIME_EARLIEST_FROM_NOON, BEDTIME_LATEST_FROM_NOON,
} from '../bedtime.js';

let dialog = null;
let bodyHost = null;
let titleHost = null;
let currentView = null;

export function initModals(node) {
  dialog = node;
  titleHost = node.querySelector('[data-modal-title]');
  bodyHost = node.querySelector('[data-modal-body]');
  node.querySelector('[data-modal-close]')?.addEventListener('click', () => closeModal());
  node.addEventListener('click', (event) => {
    if (event.target === node) closeModal();
  });
  // The close event is queued, not synchronous: if the dialog has already been
  // reopened by the time it lands, the new view must survive it.
  node.addEventListener('close', () => {
    // Escape and the backdrop close natively and never go through closeModal.
    settleBrowsing();
    if (!node.open) currentView = null;
    // Escape and the backdrop close the dialog natively, never going through
    // closeModal — so the sky stayed paused for the rest of the session. The
    // whole live canvas, dead, because you dismissed a panel the usual way.
    setSkyPaused(false);
  });
}

const VIEWS = {};

/* The four panels the curfew, last call and the nightly budget all act on. */
export const BROWSING_VIEWS = new Set(['shop', 'starmap', 'history', 'insights']);

/** Which panel is open, so the ticker can shut one that has run out of night. */
export function openView() {
  return currentView;
}

/* When the open browsing panel was opened. Null whenever nothing is being timed. */
let browsingSince = null;

/**
 * Add however long the panel has been open to tonight's browsing clock.
 *
 * Called from every way a panel can stop being looked at — the close button,
 * Escape, the backdrop, a swipe, and the app being backgrounded. Missing one
 * would not lose a little time, it would lose ALL of it: the stamp is cleared
 * on the next open, so an unsettled session simply never happened.
 */
export function settleBrowsing() {
  if (browsingSince === null) return;
  const spent = Math.max(0, Date.now() - browsingSince);
  browsingSince = null;
  if (spent > 0) update((s) => { s.night.browsedMs = (s.night.browsedMs || 0) + spent; }, { silent: true });
}

export function openModal(name) {
  if (!dialog || !VIEWS[name]) return;
  // Cancel a close that is still animating. The close fades the dialog out over
  // 220ms and only clears `is-closing` when that finishes — so re-opening
  // inside the window (a double tap, or a tap that closes and a second that
  // opens) rendered the new panel into a dialog sitting at opacity 0, and then
  // the pending timer closed it underneath. From the outside: the background
  // vanishes and the modal is a ghost.
  cancelClose();
  const changed = currentView !== name;
  currentView = name;
  renderModal({ keepScroll: !changed });
  if (!dialog.open) dialog.showModal();
  // Lock the page behind it. A <dialog> does not stop the document scrolling,
  // and iOS chains a scroll that reaches the end of the modal body straight on
  // to the page underneath — which slides the whole panel up and takes the
  // title and the close button off the top of the screen with it. The bottom
  // sheet has always locked the body for exactly this reason; the modal never
  // did, and it is the bigger surface.
  document.body.classList.add('has-modal');
  setSkyPaused(true);
  // Settle first: opening a second browsing panel straight from the first is a
  // close the app never sees.
  settleBrowsing();
  if (BROWSING_VIEWS.has(name)) browsingSince = Date.now();
}

let closing = null;

function cancelClose() {
  clearTimeout(closing);
  closing = null;
  dialog?.classList.remove('is-closing');
}

export function closeModal() {
  settleBrowsing();
  currentView = null;
  document.body.classList.remove('has-modal');
  setSkyPaused(false);
  if (!dialog?.open) return;
  if (still()) {
    dialog.close();
    return;
  }
  // animationend can be missed — a backgrounded tab, a display change, a
  // reduced-motion switch mid-flight — and a dialog that never closes is a
  // trapped app. The timer is the contract; the event is the nicety.
  clearTimeout(closing);
  dialog.classList.add('is-closing');
  const done = () => {
    dialog.removeEventListener('animationend', done);
    // Only finish the close we started. Re-opening cancels it, and a stale
    // timer firing afterwards would shut a panel the user had just asked for.
    if (closing === null) return;
    cancelClose();
    if (dialog.open) dialog.close();
  };
  dialog.addEventListener('animationend', done);
  closing = setTimeout(done, 220);
}

export function refreshModal() {
  if (currentView) renderModal();
}

function renderModal({ keepScroll = true } = {}) {
  const view = VIEWS[currentView];
  if (!view) return;
  const offset = bodyHost.scrollTop;
  withFocus(bodyHost, () => {
    const built = view();
    titleHost.textContent = built.title;
    replace(bodyHost, built.body);
  });
  // Buying one thing used to fling the shop back to the top of the list.
  bodyHost.scrollTop = keepScroll ? offset : 0;
}

/* -------------------------------------------------------------- shop view */

function priceTag(cost) {
  return h('span', { class: 'price' }, icon('star', { size: 13 }), formatNumber(cost));
}

/**
 * What the card shows you.
 *
 * Skies, sounds, trails and type have hand-written CSS swatches. The six newer
 * categories are drawn from the SAME data the real renderer reads, so a preview
 * cannot promise something the app then does not do — the rule this project
 * already applies to what a task says it pays.
 */
/**
 * Waveform colour by oscillator type, so the card's tint means something: two
 * packs that share a timbre look related, and a pack added later gets a colour
 * without anybody choosing one for it.
 */
/**
 * Waveform colour by pitch, low to high.
 *
 * It was by oscillator type, which sounded like the more meaningful choice and
 * was not: five of the eight packs are sine, so the shelf came out as five
 * identical blue cards. Pitch is the thing the descriptions actually name — a
 * chirp, a low bell, barely a note — and it is the thing that differs.
 */
const SOUND_TINTS = [
  [260, 'var(--accent-2)'],
  [900, 'var(--accent)'],
  [2000, 'var(--good)'],
  [Infinity, 'var(--warn)'],
];

export const soundTint = (hz) => SOUND_TINTS.find(([top]) => hz < top)[1];

/* The amplitude envelope `tone()` actually schedules: a 12ms linear attack to
   `gain`, then an exponential ramp down to silence at `dur`. Drawn from the
   same numbers the oscillator is given, so the picture rises and falls when the
   sound does. */
const ATTACK = 0.012;

function toneAmpAt(t, tone) {
  const u = t - tone.delay;
  if (u < 0 || u > tone.dur) return 0;
  if (u < ATTACK) return tone.gain * (u / ATTACK);
  const span = Math.max(0.001, tone.dur - ATTACK);
  return tone.gain * ((0.0001 / tone.gain) ** ((u - ATTACK) / span));
}

/** Where the pitch has got to, following `sweepTo` when there is one. */
function toneFreqAt(t, tone) {
  if (!tone.sweepTo) return tone.freq;
  const u = clamp((t - tone.delay) / Math.max(0.001, tone.dur), 0, 1);
  return tone.freq * ((tone.sweepTo / tone.freq) ** u);
}

/** The mix at one instant: total amplitude, and the pitch it is centred on. */
export function soundAt(t, tones) {
  let amp = 0;
  let weighted = 0;
  for (const tone of tones) {
    const a = toneAmpAt(t, tone);
    if (a <= 0) continue;
    amp += a;
    weighted += a * Math.log(toneFreqAt(t, tone));
  }
  return { amp, hz: amp > 0 ? Math.exp(weighted / amp) : 0 };
}

/**
 * The longest check sound on the shelf, so every card can be drawn on the same
 * time axis.
 *
 * Scaling each card to its own length made Temple Bell — "low and long", 1.6
 * seconds — and Pulse — "barely a note", 0.14 — come out as the same picture at
 * different heights, which is a preview describing two sounds identically while
 * their descriptions say the opposite. Measured from the catalog rather than
 * written down, so adding a longer pack rescales the shelf instead of running
 * off the end of it.
 */
const SOUND_SPAN = Math.max(0.3, ...allItems()
  .filter((item) => item.bucket === 'sounds')
  .flatMap((item) => packTones(item.id).map((t) => t.delay + t.dur)));

/**
 * The loudest instant on the shelf, so the cards share a vertical scale too.
 *
 * Peak, not loudest single gain: two tones overlapping are louder than either,
 * and Chime's opening is exactly that. Without one scale for all of them the
 * quiet pack and the loud pack draw the same tall bars, and Temple Bell's whole
 * pitch — the one to have on when somebody else is asleep — goes missing.
 */
const SOUND_PEAK = Math.max(0.02, ...allItems()
  .filter((item) => item.bucket === 'sounds')
  .map((item) => {
    const tones = packTones(item.id);
    let peak = 0;
    for (let i = 0; i <= 400; i += 1) peak = Math.max(peak, soundAt((i / 400) * SOUND_SPAN, tones).amp);
    return peak;
  }));

function skinPreview(item) {
  if (item.kind === 'moon') {
    const disc = item.disc === 'theme' ? 'var(--moon)' : item.disc;
    const shadow = item.shadow === 'theme' ? 'var(--moon-shadow)' : item.shadow;
    const parts = [
      svg('circle', { cx: 50, cy: 28, r: 17, fill: shadow }),
      // Drawn at half fill, which is where a moon is most itself.
      svg('path', { d: 'M50 11a17 17 0 0 1 0 34z', fill: disc }),
      ...(item.craters || []).map(([cx, cy, r]) => svg('circle', {
        cx: 50 + cx * 17, cy: 28 + cy * 17, r: Math.max(0.6, r * 17),
        fill: '#000', opacity: item.craterAlpha ?? 0.08,
      })),
    ];
    if (item.ring) {
      parts.push(svg('circle', {
        cx: 50, cy: 28, r: 17 * (item.ring.scale || 1.35), fill: 'none',
        stroke: disc, 'stroke-width': 1, opacity: item.ring.alpha ?? 0.5,
        ...(item.ring.dash ? { 'stroke-dasharray': item.ring.dash } : {}),
      }));
    }
    return svg('svg', { class: 'swatch swatch--drawn', viewBox: '0 0 100 56', 'aria-hidden': 'true' }, ...parts);
  }

  if (item.kind === 'horizon') {
    if (!item.points?.length) return h('div', { class: 'swatch swatch--drawn', 'aria-hidden': 'true' });
    // The same points and the same band the canvas uses, at swatch scale, so the
    // card cannot promise a skyline the sky then draws differently. The glow is
    // here for the same reason it is there: it is the part you can actually see.
    const H = 56;
    const W = 100;
    const bandTop = H * (1 - item.band * 2.6); // the band is a fraction of a tall
    const path = `M0 ${H} `                     // screen; the swatch is a wide one
      + item.points.map(([x, y]) => `L${(x * W).toFixed(1)} ${(bandTop + y * (H - bandTop)).toFixed(1)}`).join(' ')
      + ` L${W} ${H} Z`;
    const parts = [];
    if (item.glow) {
      const id = `hz-${item.id}`;
      parts.push(svg('defs', {}, svg('linearGradient', { id, x1: '0', y1: '0', x2: '0', y2: '1' },
        svg('stop', { offset: '0', 'stop-color': item.glow.color, 'stop-opacity': '0' }),
        svg('stop', { offset: '1', 'stop-color': item.glow.color, 'stop-opacity': String(item.glow.alpha ?? 0.28) }))));
      parts.push(svg('rect', { x: 0, y: bandTop - H * (item.glow.height || 0.3) * 2.6, width: W, height: H, fill: `url(#${id})` }));
    }
    parts.push(svg('path', { d: path, fill: item.ink || 'var(--sky-1)' }));
    // Stretched, not letterboxed. Every other swatch here is a centred motif and
    // the default xMidYMid is right for those; a horizon is the one thing that
    // has to reach both edges, and meet-fitting a 100-wide viewBox into a card
    // three times that wide drew the skyline as a stamp in the middle third.
    return svg('svg', {
      class: 'swatch swatch--drawn', viewBox: '0 0 100 56',
      preserveAspectRatio: 'none', 'aria-hidden': 'true',
    }, ...parts);
  }

  if (item.kind === 'weather') {
    const tint = ['accent', 'star', 'glow'].includes(item.color) ? `var(--${item.color === 'star' ? 'sky-star' : item.color})` : item.color;
    if (!item.count) return h('div', { class: 'swatch swatch--drawn', 'aria-hidden': 'true' });
    // A still frame of the layer: the same shape, size and colour it really has.
    // Wide, like the box — weather is a layer over the whole sky, and in a
    // 100x56 frame it letterboxed into the middle third of the card with two
    // thirds of empty plate either side. Same fault the trails had.
    const W = 300;
    const seeded = (n) => ((Math.sin(n * 12.9898) * 43758.5453) % 1 + 1) % 1;
    const marks = Array.from({ length: 52 }, (_, i) => {
      const x = seeded(i + 1) * W;
      const y = seeded(i + 41) * 52 + 2;
      const r = Math.max(0.7, Math.min(3.4, item.size * 0.35));
      return item.shape === 'streak'
        ? svg('line', { x1: x, y1: y, x2: x - item.vx * 5, y2: y - Math.abs(item.vy) * 5, stroke: tint, 'stroke-width': Math.max(0.7, r * 0.5), opacity: item.opacity })
        : svg(item.shape === 'band' ? 'rect' : 'circle', item.shape === 'band'
          ? { x: x - 26, y, width: 52, height: Math.max(1.4, r), fill: tint, opacity: item.opacity, rx: 1 }
          : { cx: x, cy: y, r, fill: tint, opacity: item.opacity });
    });
    return svg('svg', { class: 'swatch swatch--drawn', viewBox: `0 0 ${W} 56`, 'aria-hidden': 'true' }, ...marks);
  }

  if (item.kind === 'mark') {
    return h('div', { class: 'swatch swatch--drawn swatch--mark', 'aria-hidden': 'true' },
      icon(`mark:${item.id}`, { size: 26 }));
  }

  if (item.kind === 'envelope') {
    const ink = (value, prop) => (value && value !== 'theme' ? `${prop}:${value};` : '');
    return h('div', {
      class: 'swatch swatch--drawn swatch--envelope',
      'aria-hidden': 'true',
      style: ink(item.paper, '--env-paper') + ink(item.flap, '--env-flap') + ink(item.seal, '--env-seal') || null,
    }, h('span', { class: 'swatch__flap' }),
    item.seal && item.seal !== 'theme' ? h('span', { class: 'swatch__seal' }) : null);
  }

  if (item.kind === 'sounds') {
    // A transcript of the pack's own check sound: one run of bars per tone,
    // placed along a time axis, at a height set by pitch. Recorded from the
    // real call rather than described a second time — see js/audio.js.
    const tones = packTones(item.id);
    if (!tones.length) return h('div', { class: 'swatch swatch--drawn', 'aria-hidden': 'true' });
    /* One bar field over the whole mix, not a run of bars per tone.
       Per-tone runs were the first version and they were a barcode: two tones
       a few milliseconds apart drew two independent rows of identical sticks at
       slightly different offsets, so they collided instead of adding — the
       ragged doubling down Chime, the mush on Wind Chime, green interfering
       with blue on Kalimba. And every bar in a run was the same height with a
       flat top, so nothing rose or fell and none of it looked like sound.
       Summing the envelope at each instant fixes both: overlaps add, and the
       attack and decay draw themselves. */
    const W = 300;
    const MID = 28;
    const REACH = 24;                                // half-height at full scale
    const BARS = 48;
    const BAR = 3.6;
    // Decibels, not amplitude. The exponential ramp `tone()` schedules is down
    // to 4% of peak by the midpoint, so a linear scale draws every sound as a
    // spike and a flat line. Loudness is logarithmic and so is every waveform
    // display ever built; a 42dB window puts the taper where the ear puts it.
    const WINDOW = 42;
    const scale = (amp) => (amp <= 0 ? 0
      : clamp((20 * Math.log10(amp / SOUND_PEAK) + WINDOW) / WINDOW, 0, 1));
    // Cube-rooted time. A shared linear axis is honest and unreadable — the
    // shortest pack is a twelfth of the longest and draws as a smudge in the
    // corner — but a square root overcorrected the other way: Pulse reached 30%
    // of the card and Chime 46%, so five of the eight were a small shape at the
    // left with two thirds of empty timeline after it. At a cube root nothing
    // uses less than 43% and the longest still fills the box, so the ordering
    // survives and the cards stop looking unfinished.
    // Peak per bucket, not one sample per bar. A point sample aliases: the cube
    // root stretches the opening and compresses the end, so Crickets' first
    // chirp landed across six bars and its second and third — 30ms each, out in
    // the compressed part — caught one sample apiece and drew as bare sticks
    // beside a full taper. Taking the loudest instant inside each bar's own
    // slice of time is what a waveform display does, and nothing narrow can
    // fall between two bars any more.
    const bars = [];
    const at = (u) => u * u * u * SOUND_SPAN;
    for (let i = 0; i < BARS; i += 1) {
      const u = i / (BARS - 1);
      const t0 = at(Math.max(0, u - 0.5 / (BARS - 1)));
      const t1 = at(Math.min(1, u + 0.5 / (BARS - 1)));
      let amp = 0;
      let hz = 0;
      for (let k = 0; k <= 6; k += 1) {
        const sample = soundAt(t0 + ((t1 - t0) * k) / 6, tones);
        if (sample.amp > amp) { amp = sample.amp; hz = sample.hz; }
      }
      const height = scale(amp) * REACH;
      const x = 5 + u * (W - 10 - BAR);
      if (height < 0.75) {
        // The rest of the timeline, so a short sound reads as short rather than
        // as a card somebody forgot to finish.
        bars.push(svg('rect', {
          x, y: MID - 0.5, width: BAR, height: 1, rx: 0.5,
          fill: 'var(--border-strong)', opacity: 0.5,
        }));
        continue;
      }
      bars.push(svg('rect', {
        x, y: MID - height, width: BAR, height: height * 2, rx: BAR / 2,
        fill: soundTint(hz),
      }));
    }
    return svg('svg', { class: 'swatch swatch--drawn', viewBox: `0 0 ${W} 56`, 'aria-hidden': 'true' }, ...bars);
  }

  if (item.kind === 'trail') {
    const spec = trailSpec(item.id);
    if (!spec) return h('div', { class: 'swatch swatch--drawn swatch--trail-none', 'aria-hidden': 'true' });
    const fill = trailTintCss(spec);
    /* A still frame of the emitter, with the pointer at the right-hand end and
       the tail running back from it.

       Normalised on lifetime, deliberately. Ages scale with the spec's own
       `1/decay`, so every trail fades out across the same box. Running the real
       frame counter instead put Ripple's whole tail in the first eighth of the
       card and Moondust's off the end — and in a *still* frame decay is not
       something you can see anyway, only something that decides how much of the
       picture is left. What the eye can read is density (`per`), grain size
       (`r`, `jitter`), which way it goes (`drift`), whether it twinkles
       (`flicker`) and its colour, and every one of those is the spec's own. */
    const seeded = (n) => ((Math.sin(n * 12.9898) * 43758.5453) % 1 + 1) % 1;
    const lifespan = 0.9 / spec.decay;                    // frames until nearly out
    const dots = [];
    const steps = 46;
    // A wide box, unlike every other swatch here. `.swatch` is 56px tall and as
    // wide as the card — about 5.4:1 — and a 100x56 viewBox meets that by
    // letterboxing itself into the middle third, which is where the whole trail
    // was sitting. A motif wants centring; a ribbon wants the width.
    const W = 300;
    // The canvas is a phone wide and this box is 100 units, so a radius in
    // canvas pixels would land under a third of a unit. The frame is magnified;
    // the ratio between a fine grain and a fat one is what carries over.
    const ZOOM = 2.4;
    for (let i = 0; i < steps; i += 1) {
      const t = i / (steps - 1);
      const age = (1 - t) * lifespan;                     // the pointer is at t = 1
      const life = Math.max(0, 1 - spec.decay * age);
      for (let k = 0; k < spec.per; k += 1) {
        const j = i * 7 + k;
        const rise = spec.drift
          ? -(spec.drift.up + seeded(j + 3) * spec.drift.spread) * age * 0.22
          : (seeded(j + 5) - 0.5) * age * 0.08;
        dots.push(svg('circle', {
          cx: 10 + t * (W - 22) + (seeded(j) - 0.5) * 7,
          cy: clamp(38 - t * 16 + rise + (seeded(j + 61) - 0.5) * 5, 3, 53),
          r: Math.max(0.6, (spec.r + seeded(j + 17) * spec.jitter) * (0.35 + life * 0.65) * ZOOM),
          fill, opacity: Math.min(1, (0.15 + life * 0.8) * (spec.flicker ? 0.5 + seeded(j + 91) * 0.5 : 1)),
        }));
      }
    }
    return svg('svg', { class: 'swatch swatch--drawn', viewBox: `0 0 ${W} 56`, 'aria-hidden': 'true' }, ...dots);
  }

  if (item.kind === 'font') {
    // The face itself, from the item's own stack — see the note in js/skins.js.
    return h('div', {
      class: `swatch swatch--font ${item.glow ? 'swatch--glow' : ''}`.trim(),
      'aria-hidden': 'true',
      style: `font-family:${item.stack};`,
    }, 'Aa');
  }

  return h('div', { class: `swatch swatch--${item.kind} swatch--${item.id}`, 'aria-hidden': 'true' });
}

/**
 * The class list for a button that spends stardust.
 *
 * One helper for all four of them — the market, the supplies shelf, the feed
 * button and the star map — because they had the same class string typed out
 * four times and every one of them stayed `btn--primary` when it was disabled.
 * A gradient with near-black text at 45% opacity is the least readable thing on
 * the card and the most eye-catching, which is the wrong way round for a
 * control you cannot use.
 */
function spendClass(affordable, { small = true } = {}) {
  return ['btn', small && 'btn--sm', affordable ? 'btn--primary' : 'btn--cost']
    .filter(Boolean).join(' ');
}

/** What a sealed card admits to being, so the wait has a shape. */
const SEALED_KIND = {
  themes: 'A sky.',
  horizons: 'A horizon.',
  weather: 'Weather.',
  moons: 'A moon.',
  marks: 'A mark for the checkbox.',
  envelopes: 'An envelope.',
  sounds: 'A sound pack.',
  trails: 'A pointer trail.',
  fonts: 'A typeface.',
};

/**
 * A Far Shelf card you have not reached yet.
 *
 * The rung is shown and the thing is not. You can see how far off it is, what
 * sort of thing it is and what it will cost, so it is something to save for and
 * something to sleep for — and you cannot see which one it is, because the
 * point of a shelf that opens on its own schedule is that there is something
 * still to find out. `· · ·` is the app's own way of writing this: the title
 * ladder in Settings has shown unearned names that way from the start.
 */
function sealedCard(item, check) {
  return h('article', { class: 'card card--sealed' },
    h('div', { class: 'card__head' },
      h('h3', {}, HIDDEN_TITLE),
      priceTag(item.cost)),
    h('div', { class: 'swatch swatch--sealed', 'aria-hidden': 'true' }),
    h('p', { class: 'card__desc' }, SEALED_KIND[item.bucket] || 'Something.'),
    h('div', { class: 'card__foot' },
      h('span', { class: 'card__lock' }, `Opens on night ${item.reqNights} on time`),
      h('button', { type: 'button', class: 'btn btn--sm', disabled: true }, check.reason)));
}

function shopCard(state, item, { onPreview } = {}) {
  const ownedAlready = owns(state, item);
  const equipped = isEquipped(state, item);
  const check = canBuy(state, item);
  if (check.sealed) return sealedCard(item, check);
  const locked = Boolean(item.reqLevel && state.profile.level < item.reqLevel);

  return h('article', {
    class: ['card', ownedAlready && 'card--owned', equipped && 'card--equipped', locked && 'card--locked'].filter(Boolean).join(' '),
  },
  h('div', { class: 'card__head' },
    h('h3', {}, item.name),
    ownedAlready ? h('span', { class: 'card__tag' }, equipped ? 'Equipped' : 'Owned') : priceTag(item.cost)),
  item.kind === 'companion'
    ? h('div', { class: 'card__art' }, companionSvg(item.id, 2, 'happy'))
    : skinPreview(item),
  h('p', { class: 'card__desc' }, item.desc),
  h('div', { class: 'card__foot' },
    locked ? h('span', { class: 'card__lock' }, `Level ${item.reqLevel}`) : null,
    onPreview ? h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onClick: () => onPreview(item) }, 'Preview') : null,
    ownedAlready
      ? (equipped
        ? h('button', { type: 'button', class: 'btn btn--sm', disabled: true }, 'In use')
        : h('button', {
          type: 'button',
          class: 'btn btn--primary btn--sm',
          dataset: { focus: `shop:${item.id}` },
          onClick: () => { equipItem(item.id, item.bucket); refreshModal(); },
        }, 'Equip'))
      : h('button', {
        type: 'button',
        class: spendClass(check.ok),
        disabled: !check.ok,
        title: check.ok ? `Buy for ${item.cost} stardust` : check.reason,
        dataset: { focus: `shop:${item.id}` },
        onClick: () => { purchase(item.id, item.bucket); refreshModal(); },
      }, check.ok ? 'Buy' : check.reason)));
}

function companionPanel(state) {
  const companion = state.profile.companion;
  if (!companion?.type) return null;
  const toNext = feedsToNextTier(companion.fed || 0);
  const tierName = TIER_NAMES[Math.min(TIER_NAMES.length - 1, (companion.tier || 1) - 1)];
  const nameInput = h('input', {
    id: 'companion-name',
    class: 'field__input',
    type: 'text',
    value: companion.name,
    maxlength: '24',
  });
  nameInput.addEventListener('change', () => { renameCompanion(nameInput.value.trim()); refreshModal(); });

  return h('div', { class: 'companion-panel' },
    h('div', { class: 'companion-panel__art' }, companionSvg(companion.type, companion.tier || 1, 'happy')),
    h('div', { class: 'companion-panel__body' },
      // A real <label> here, because a real <input> is what it labels.
      h('div', { class: 'field' }, h('label', { for: 'companion-name' }, 'Name'), nameInput),
      h('p', { class: 'companion-panel__tier' }, `${tierName} · tier ${companion.tier || 1} · fed ${companion.fed || 0} times`),
      h('p', { class: 'muted' }, toNext === null
        ? 'Fully grown. It has seen everything you do at night.'
        : `${plural(toNext, 'feed', 'feeds')} to the next tier.`),
      h('div', { class: 'row' },
        h('button', {
          type: 'button',
          class: spendClass(state.profile.stardust >= FEED_COST),
          disabled: state.profile.stardust < FEED_COST,
          onClick: () => {
            const result = feedCompanion();
            if (result?.grew) toast(`${result.companion.name} grew to tier ${result.companion.tier}`, { tone: 'win', iconName: 'star' });
            refreshModal();
          },
        }, `Feed · ${FEED_COST} stardust`),
        h('button', {
          type: 'button',
          class: 'btn btn--ghost btn--sm',
          onClick: () => { unequipCompanion(); refreshModal(); },
        }, 'Send away'))));
}

let shopTab = 'themes';

VIEWS.shop = () => {
  const state = getState();
  // Built from allItems() so a category added to the catalog cannot be left out
  // of the market it is sold in — the tabs used to hand-map each list, which is
  // one more place to forget.
  // Far Shelf items live in their ordinary buckets — a moon is a moon, it
  // equips into the moon slot and is owned in `inventory.moons` — but they are
  // shown together, because a ladder you have to go and find on nine separate
  // shelves is not a ladder you can see.
  const shelf = (bucket) => allItems().filter((item) => item.bucket === bucket && item.shelf !== 'far');
  const far = allItems().filter((item) => item.shelf === 'far')
    .sort((a, b) => a.reqNights - b.reqNights);
  const tabs = [
    ['themes', 'Skies', shelf('themes')],
    ['horizons', 'Horizons', shelf('horizons')],
    ['weather', 'Weather', shelf('weather')],
    ['moons', 'Moons', shelf('moons')],
    ['companions', 'Companions', shelf('companions')],
    ['marks', 'Marks', shelf('marks')],
    ['envelopes', 'Envelopes', shelf('envelopes')],
    ['sounds', 'Sounds', shelf('sounds')],
    ['trails', 'Trails', shelf('trails')],
    ['fonts', 'Type', shelf('fonts')],
    ['far', 'Far Shelf', far],
    ['supplies', 'Supplies', null],
  ];
  const active = tabs.find(([id]) => id === shopTab) || tabs[0];

  // The role was declared and none of the contract was kept: no tabpanel, no
  // aria-controls, no arrow keys, and every tab its own tab stop. A screen
  // reader told the user to arrow between six things and the arrows did
  // nothing, which is a worse experience than plain unlabelled buttons.
  const PANEL_ID = 'shop-panel';
  const tabBar = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Night Market sections' },
    ...tabs.map(([id, label]) => h('button', {
      type: 'button',
      id: `shop-tab-${id}`,
      class: `tab ${id === active[0] ? 'is-active' : ''}`.trim(),
      role: 'tab',
      'aria-selected': id === active[0] ? 'true' : 'false',
      'aria-controls': PANEL_ID,
      dataset: { focus: `tab:${id}` },
      onClick: () => { shopTab = id; refreshModal(); },
    }, label)));
  rovingGroup(tabBar, { onPick: (node) => node.click() });
  // The strip scrolls, so the chip you are on has to be brought into view — on
  // a fresh render the active tab can otherwise be sitting off the right edge
  // with nothing to say the market has ten shelves rather than four.
  queueMicrotask(() => {
    tabBar.querySelector('.is-active')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  });

  let content;
  if (active[0] === 'supplies') {
    // Sorted like every other shelf. Supplies are not in `allItems()`, so the
    // sort there did not reach them and this one read 310, 100, 180, 220.
    const supplies = [...CONSUMABLES].sort((a, b) => a.cost - b.cost);
    content = h('div', { class: 'cards' }, ...supplies.map((item) => {
      // Two kinds of supply. A freeze or a rain check is a token you hold, and
      // the card counts them. A head start and a second wind act on tonight the
      // moment you buy them, so there is nothing to count — the card says what
      // it will do instead, and why it cannot right now if it cannot.
      const blocked = item.instant ? supplyBlocker(state, item) : null;
      const poor = state.profile.stardust < item.cost;
      return h('article', { class: `card ${blocked ? 'card--locked' : ''}`.trim() },
        h('div', { class: 'card__head' }, h('h3', {}, item.name), priceTag(item.cost)),
        h('div', { class: 'card__icon' }, icon(item.icon, { size: 26 })),
        h('p', { class: 'card__desc' }, item.desc),
        h('div', { class: 'card__foot' },
          h('span', { class: 'card__tag' }, item.instant
            ? (blocked || 'Applies to tonight')
            : `${state.profile.tokens[item.id] || 0} held`),
          h('button', {
            type: 'button',
            class: spendClass(!poor && !blocked),
            disabled: poor || Boolean(blocked),
            title: blocked || (poor ? `${item.cost - state.profile.stardust} more stardust` : `Buy for ${item.cost} stardust`),
            onClick: () => { buyConsumable(item.id); refreshModal(); },
            // The shortfall said only in a `title`, which a phone has no way to
            // show. Every other shelf puts it on the button; this one made you
            // guess why the tap did nothing.
          }, poor ? `${item.cost - state.profile.stardust} more stardust` : 'Buy')));
    }));
  } else {
    // Per item, not per tab. The Far Shelf mixes shelves, and the sound pack on
    // it had no Preview button while every other pack in the market had one.
    const onPreview = (item) => (item.bucket === 'sounds' ? previewPack(item.id) : null);
    content = h('div', { class: 'cards' },
      ...active[2].map((item) => shopCard(state, item, {
        onPreview: item.bucket === 'sounds' ? onPreview : null,
      })));
  }
  content.id = PANEL_ID;
  content.setAttribute('role', 'tabpanel');
  content.setAttribute('aria-labelledby', `shop-tab-${active[0]}`);
  content.tabIndex = 0;

  return {
    title: 'Night Market',
    body: h('div', { class: 'shop' },
      active[0] === 'far'
        ? h('p', { class: 'modal__lead' },
          'This shelf opens by nights you actually went to bed on time — never by XP, '
          + 'and never by stardust. ',
          h('strong', {}, `${plural(nightsOnTime(state), 'night', 'nights')} on time so far.`))
        : h('p', { class: 'modal__lead' },
          'Stardust is earned alongside XP — spending it never costs you a level. ',
          h('strong', {}, `${formatNumber(state.profile.stardust)} in hand.`)),
      tabBar,
      content,
      active[0] === 'companions' ? companionPanel(state) : null),
  };
};

/* ---------------------------------------------------------------- starmap */

function constellationPreview(def, lit, deep = 0) {
  const w = 150;
  const hgt = 96;
  const place = ([x, y]) => ({ x: 10 + x * (w - 20), y: 8 + y * (hgt - 16) });
  const points = def.stars.map(place);
  // The faint stars you have actually bought, so the card shows the figure
  // filling in rather than the depth tier having no visible payoff outside the
  // live sky — which sits behind translucent panels most of the time.
  const faint = (def.faint || []).slice(0, deep).map(place);
  // Named rather than hidden. The shape is what you are deciding whether to
  // spend on, and hiding it left the count carried by one sibling span.
  return svg('svg', {
    viewBox: `0 0 ${w} ${hgt}`,
    class: 'constellation__svg',
    role: 'img',
    'aria-label': `${def.name}: ${lit} of ${def.stars.length} stars lit`
      + (deep ? `, and ${deep} of its ${def.faint.length} fainter stars` : ''),
  },
    ...faint.map((p) => svg('circle', { cx: p.x, cy: p.y, r: 1.2, class: 'constellation__faint' })),
    ...def.lines.map(([a, b]) => svg('line', {
      x1: points[a].x, y1: points[a].y, x2: points[b].x, y2: points[b].y,
      class: a < lit && b < lit ? 'constellation__line is-lit' : 'constellation__line',
    })),
    ...points.map((p, i) => svg('circle', {
      cx: p.x, cy: p.y, r: i < lit ? 3.4 : 2,
      class: i < lit ? 'constellation__star is-lit' : 'constellation__star',
    })));
}

VIEWS.starmap = () => {
  const state = getState();
  const summary = collectionSummary(state);

  const cards = CONSTELLATIONS.map((def) => {
    const info = progressFor(state, def.id);
    const affordable = info.nextCost !== null && state.profile.stardust >= info.nextCost;
    return h('article', { class: `constellation ${info.complete ? 'is-complete' : ''}`.trim() },
      constellationPreview(def, info.lit, info.deep),
      h('div', { class: 'constellation__body' },
        h('div', { class: 'constellation__head' },
          h('h3', {}, def.name),
          h('span', { class: 'constellation__count' }, `${info.lit}/${info.total}`)),
        h('p', { class: 'muted' }, def.lore),
        // Complete used to be the end of the card. Now it is the start of the
        // second tier: the figure is in your sky, and what is left are its
        // fainter real stars — the ones a keen eye would pick up — on the same
        // escalating ladder, drawn dimmer and unjoined.
        info.complete
          ? h('p', { class: 'constellation__done' }, icon('check', { size: 13 }),
            info.deepTotal === 0
              ? 'Shining in your sky'
              : info.deepDone
                ? 'Shining in your sky, every star of it'
                : `Shining in your sky · ${info.deep}/${info.deepTotal} faint stars`)
          : null,
        info.nextCost === null
          ? null
          : h('div', { class: 'row' },
            h('button', {
              type: 'button',
              class: spendClass(affordable),
              dataset: { focus: `star:${def.id}` },
              disabled: !affordable,
              onClick: () => {
                const result = update((s) => {
                  const bought = buyStar(s, def.id);
                  // Lighting a star moves the `constellation` family, and
                  // nothing here settled it — the card sat at a full bar
                  // reading "tier 0" until the next checkbox tap.
                  if (bought) {
                    const earned = checkAchievements(s, computeStats(s));
                    if (earned.length) emit('achievement', earned);
                  }
                  return bought;
                });
                if (result?.complete) {
                  toast(`${def.name} is complete`, {
                    tone: 'win',
                    iconName: 'map',
                    detail: def.faint?.length
                      ? 'It now appears in your night sky. Its fainter stars are still out there.'
                      : 'It now appears in your night sky.',
                  });
                  emit('constellation:complete', { def });
                } else if (result) {
                  emit('star:lit', { def });
                }
                refreshModal();
              },
            }, info.complete ? `A fainter star · ${info.nextCost} stardust` : `Light a star · ${info.nextCost} stardust`),
            // "to finish" means the figure. Past that there is no finish line to
            // quote, so it says what is actually left instead of inventing one.
            h('span', { class: 'muted small' }, info.complete
              ? `${info.deepTotal - info.deep} left`
              : `${formatNumber(totalRemainingCost(state, def.id))} to finish`))));
  });

  return {
    title: 'Star Map',
    body: h('div', {},
      h('p', { class: 'modal__lead' },
        `Light stars one at a time. Finish a constellation and it is drawn into your sky for good — `
        + `then keep going into its fainter stars, which are real too. `,
        h('strong', {}, `${summary.done}/${summary.total} complete · ${summary.litStars}/${summary.totalStars} stars lit`
          + (summary.deepStars ? ` · ${summary.deepStars} faint` : '') + '.')),
      h('div', { class: 'constellations' }, ...cards)),
  };
};

/* ---------------------------------------------------------------- history */

function heatLevel(pct) {
  if (pct >= 100) return 4;
  if (pct >= 70) return 3;
  if (pct >= 40) return 2;
  if (pct > 0) return 1;
  return 0;
}

VIEWS.history = () => {
  const state = getState();
  const today = state.night.key;
  const WEEKS = 18;
  const days = [];
  const firstDate = keyToDate(shiftKey(today, -(WEEKS * 7 - 1)));
  const leadIn = (firstDate.getDay() + 6) % 7; // grid columns start on Monday
  for (let i = 0; i < leadIn; i += 1) days.push(null);
  for (let i = WEEKS * 7 - 1; i >= 0; i -= 1) days.push(shiftKey(today, -i));

  const detail = h('p', {
    class: 'heatmap__detail muted',
    role: 'status',
    'aria-live': 'polite',
  }, 'Hover or click a night for detail.');

  const cells = days.map((key) => {
    if (!key) return h('span', { class: 'heat heat--pad', 'aria-hidden': 'true' });
    const entry = state.history[key];
    const isTonight = key === today;
    const level = entry ? heatLevel(entry.pct) : 0;
    // "Tonight" and "streak freeze used" existed only as a border colour and an
    // outline — the click detail knew both and the label said neither, so a
    // screen reader got 126 identical-sounding cells.
    const marks = `${isTonight ? 'tonight, ' : ''}`;
    const frozen = entry?.frozen ? ', streak freeze used' : '';
    const label = entry
      ? `${marks}${formatShortDate(key)}: ${entry.pct}% (${entry.done}/${entry.total})${frozen}`
      : `${marks}${formatShortDate(key)}: no record`;
    const cell = h('button', {
      type: 'button',
      class: `heat heat--l${level} ${isTonight ? 'heat--today' : ''} ${entry?.frozen ? 'heat--frozen' : ''}`.trim(),
      title: label,
      'aria-label': label,
      // Empty nights are not worth a tab stop; 126 of them buried the panel.
      tabIndex: entry || isTonight ? 0 : -1,
      onClick: () => {
        const stopped = entry?.lightsOutAt
          ? `, lights out ${new Date(entry.lightsOutAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}${entry.onTime ? ' (on time)' : ''}`
          : '';
        detail.textContent = entry
          // The percentage is over what counted, not over the raw total, so
          // printing "4 of 11 done, 100%" side by side read as a plain
          // arithmetic error. Say the denominator the percentage actually used.
          ? `${formatNightLabel(key)} — ${entry.done} of ${Math.max(0, entry.total - (entry.skipped || 0))} counted done, ${entry.pct}%${entry.skipped ? `, ${entry.skipped} rain-checked` : ''}, ${entry.xp} XP${stopped}${entry.quest ? ', quest claimed' : ''}${entry.frozen ? ', streak freeze used' : ''}.`
          : `${formatNightLabel(key)} — nothing recorded.`;
      },
    });
    return cell;
  });

  // "Perfect nights" sat one tile away from "to bed on time" and read like a
  // second bedtime stat. It was never about bedtime: it counts nights you got
  // through the list. So it now says that, and counts it strictly.
  const cleared = nightsFullyCleared(state.history);

  return {
    title: 'Night History',
    body: h('div', {},
      h('div', { class: 'stat-row' },
        // `profile.streak` is a banking implementation detail: it is only ever
        // updated when a night is banked, so after forty days away it still
        // holds the number from the last night you logged — the top bar read 0
        // and this read 10, on the same evening. Both read the live one now.
        h('div', { class: 'stat-box' }, h('strong', {}, String(effectiveStreak(state).streak)), h('span', {}, 'current streak')),
        h('div', { class: 'stat-box' }, h('strong', {}, String(state.profile.bestStreak)), h('span', {}, 'best streak')),
        h('div', {
          class: 'stat-box',
          // A consecutive run, sitting in a row of lifetime totals. The label
          // said "to bed on time" and read as a count of nights.
          title: 'Nights in a row you called it before your target bedtime — the number this app actually cares about',
        }, h('strong', {}, String(effectiveLightsOutStreak(state))), h('span', {}, 'clean nights in a row')),
        h('div', { class: 'stat-box' }, h('strong', {}, String(state.profile.nightsLogged)), h('span', {}, 'nights logged')),
        h('div', { class: 'stat-box' }, h('strong', {}, `${overallRate(state) ?? 0}%`), h('span', {}, 'average night')),
        h('div', {
          class: 'stat-box',
          title: 'Nights you ticked off every task on the list. Nothing to do with what time you went to bed — a rain-checked task does not count as done.',
        }, h('strong', {}, String(cleared)), h('span', {}, 'every task done')),
        // The record, in words as well as in pixels. Every one of these is a
        // star in your own sky, and it is the only thing here you cannot buy.
        h('div', {
          class: 'stat-box',
          title: 'Every one of these is a star in your sky. Not bought — earned by going to bed on time. Look up during the good-night screen.',
        }, h('strong', {}, String(onTimeNights(state).length)), h('span', {}, 'stars in your sky'))),
      h('div', { class: 'heatmap' }, ...cells),
      h('div', { class: 'heatmap__key' },
        h('span', { class: 'muted small' }, 'less'),
        ...[0, 1, 2, 3, 4].map((l) => h('span', { class: `heat heat--l${l}`, 'aria-hidden': 'true' })),
        h('span', { class: 'muted small' }, 'more')),
      detail),
  };
};

/* --------------------------------------------------------------- insights */

/* --------------------------------------------------------------- bedtime */

const CHART_NIGHTS = 21;

/** The bedtime target in minutes from noon, matching the series. */
function targetFromNoon(bedtime) {
  const parsed = parseClock(bedtime);
  if (!parsed) return null;
  // A 1am target belongs to the small hours of the *next* morning, same as the
  // night it ends — otherwise it plots twenty-three hours early. Modulo a day
  // from noon, which pivots where bedtimeInstant pivots: the old `< 4` here
  // disagreed with it for every hour between 4 and noon, so a 5am target plotted
  // a full day below a 5am night that the countdown had resolved forward.
  return ((parsed.hours * 60 + parsed.minutes - 720) % 1440 + 1440) % 1440;
}

/**
 * Three weeks of bedtimes against the line you are aiming at.
 *
 * A calendar grid would say whether each night passed; this says by how much,
 * which is the part that shows a habit moving. The dots are the nights, the
 * dashed line is your target, and the stems make lateness a length rather than
 * a colour you have to decode.
 */
function bedtimeChart(state) {
  const series = bedtimeSeries(state.history, state.night.key, CHART_NIGHTS);
  const recorded = series.filter((n) => n.recorded);
  const target = targetFromNoon(state.profile.settings.bedtime);
  if (!recorded.length) {
    return h('p', { class: 'muted' },
      'Nothing to chart yet. End a night with Lights out and it lands here.');
  }

  const W = 320;
  const H = 116;
  const padX = 8;
  const padTop = 10;
  const padBottom = 18;
  const values = recorded.map((n) => n.minutes);
  if (target !== null) values.push(target);
  let lo = Math.min(...values) - 20;
  let hi = Math.max(...values) + 20;
  if (hi - lo < 90) { // one night should not be drawn on a hairline scale
    const mid = (hi + lo) / 2;
    lo = mid - 45;
    hi = mid + 45;
  }
  const x = (i) => padX + (i * (W - padX * 2)) / (CHART_NIGHTS - 1);
  const y = (m) => padTop + ((m - lo) / (hi - lo)) * (H - padTop - padBottom);
  const baseY = H - padBottom + 6;

  const marks = [];
  if (target !== null) {
    marks.push(svg('line', {
      class: 'bt__target', x1: 0, x2: W, y1: y(target).toFixed(2), y2: y(target).toFixed(2),
    }));
  }

  series.forEach((night, i) => {
    if (!night.recorded) {
      marks.push(svg('line', {
        class: 'bt__gap',
        x1: x(i).toFixed(2), x2: x(i).toFixed(2), y1: baseY, y2: baseY,
      }, svg('title', {}, `${formatShortDate(night.key)}: no Lights out`)));
      return;
    }
    const cy = y(night.minutes);
    const label = `${formatShortDate(night.key)}: ${formatFromNoon(night.minutes, night.key)}`
      + (typeof night.late === 'number'
        ? ` · ${night.late <= 0 ? `${Math.abs(night.late)} min early` : `${night.late} min late`}`
        : '');
    // The stem hangs from the target *that night* was judged against, not from
    // today's. `onTime` is stamped when the night ends and never restamped
    // (js/night.js), so moving your bedtime later used to leave a green dot
    // hanging below the line — the colour telling the truth and the geometry
    // contradicting it on the same pixel. The dashed line is still today's
    // target: that is the line you are aiming at now.
    const own = night.target ? targetFromNoon(night.target) : target;
    if (own !== null) {
      marks.push(svg('line', {
        class: `bt__stem ${night.onTime ? 'is-ontime' : 'is-late'}`,
        x1: x(i).toFixed(2), x2: x(i).toFixed(2), y1: y(own).toFixed(2), y2: cy.toFixed(2),
      }));
      // A tick at its own target whenever that is not where the dashed line is,
      // so a moved bedtime is visible rather than silently reinterpreted.
      if (target === null || Math.abs(own - target) > 1) {
        marks.push(svg('line', {
          class: 'bt__own',
          x1: (x(i) - 3).toFixed(2), x2: (x(i) + 3).toFixed(2),
          y1: y(own).toFixed(2), y2: y(own).toFixed(2),
        }, svg('title', {}, `Target that night: ${formatClockLabel(night.target)}`)));
      }
    }
    // A zero-length round-capped line, not a <circle>. The chart is drawn with
    // `preserveAspectRatio: none` so it can fill any width, which on the 760px
    // insights panel is a 2:1 non-uniform stretch — the stems survived it via
    // `vector-effect`, and the filled circles painted as 15x8 ovals. Stroke
    // geometry is what vector-effect protects, so the dots are stroke now.
    marks.push(svg('line', {
      class: `bt__dot ${night.onTime ? 'is-ontime' : 'is-late'}`,
      x1: x(i).toFixed(2), x2: x(i).toFixed(2), y1: cy.toFixed(2), y2: cy.toFixed(2),
    }, svg('title', {}, label)));
  });

  return h('div', { class: 'bt' },
    svg('svg', {
      class: 'bt__svg',
      viewBox: `0 0 ${W} ${H}`,
      preserveAspectRatio: 'none',
      role: 'img',
      'aria-label': `Bedtime for the last ${CHART_NIGHTS} nights against a target of ${formatClockLabel(state.profile.settings.bedtime)}`,
    }, ...marks),
    h('div', { class: 'bt__axis' },
      h('span', {}, formatShortDate(series[0].key)),
      target !== null
        ? h('span', { class: 'bt__legend' }, `target ${formatClockLabel(state.profile.settings.bedtime)}`)
        : null,
      h('span', {}, 'tonight')));
}

function bedtimeSection(state) {
  const summary = bedtimeSummary(state.history, state.night.key, 7);
  const lights = state.profile.lightsOut || {};

  const box = (value, label, title = null) => h('div', { class: 'stat-box', title },
    h('strong', {}, value), h('span', {}, label));

  return h('div', {},
    h('p', { class: 'modal__lead' },
      'When you actually stopped, night by night. Only nights you ended with ',
      h('strong', {}, 'Lights out'), ' are on the record — close the app without it and there '
      + 'is nothing to measure.'),
    h('div', { class: 'stat-row' },
      box(String(effectiveLightsOutStreak(state)), 'clean nights in a row',
        `Best run: ${lights.best || 0}. This is the number the app is actually about.`),
      box(summary.onTimeRate === null ? '—' : `${summary.onTimeRate}%`, 'on time this week',
        `${summary.onTime} of ${summary.recorded} recorded nights in the last 7`),
      // Not "the last 7 recorded nights" — it is the recorded nights *within*
      // the last 7, and it never reaches further back. With two of seven ended,
      // the tile was a mean of two claiming to be a mean of seven.
      box(formatFromNoon(summary.average), 'average bedtime',
        `Mean of the ${plural(summary.recorded, 'night', 'nights')} you ended in the last 7`),
      box(formatShift(summary.delta), 'vs the week before',
        summary.previous === null
          ? 'Not enough nights yet to compare'
          : `Previously ${formatFromNoon(summary.previous)}`),
      box(formatFromNoon(summary.earliest), 'earliest', 'The earliest of those same nights'),
      box(formatFromNoon(summary.latest), 'latest', 'The latest of those same nights')),
    bedtimeChart(state));
}

VIEWS.insights = () => {
  const state = getState();
  const rows = taskInsights(state);
  const reliable = reliableTasks(state);
  const level = levelFromXp(state.profile.xp);

  const board = achievementBoard(state, computeStats(state));
  const badgeGrid = h('div', { class: 'achs' }, ...board.map((a) => h('div', {
    class: `ach ${a.earned ? 'is-earned' : ''} ${a.complete ? 'is-maxed' : ''}`.trim(),
    title: a.complete ? `${a.name} — every tier earned` : a.goal,
  },
  h('div', { class: 'ach__badge' }, icon(a.icon, { size: 20 })),
  h('div', { class: 'ach__body' },
    h('div', { class: 'ach__head' },
      h('span', { class: 'ach__name' }, a.name),
      // Which rung of how many, so a family that has levelled reads as one
      // thing that grew rather than a badge whose name quietly changed.
      h('span', { class: 'ach__tier' }, `${a.tier}/${a.tiers}`)),
    h('div', {
      class: 'ach__bar',
      role: 'progressbar',
      'aria-valuenow': String(a.pct),
      'aria-valuemin': '0',
      'aria-valuemax': '100',
      'aria-label': a.goal,
    }, growTo(h('span', {}), `ach:${a.id}`, `${a.pct}%`)),
    // Same slot, same case. The goals are authored sentence case, shown that
    // way as the bar's own aria-label two lines up and in the toast when a tier
    // lands — and lowercased only here, beside a capitalised "Every tier earned".
    h('span', { class: 'ach__hint' }, a.complete ? 'Every tier earned' : `${a.progress} · ${a.goal}`)),
  h('div', { class: 'ach__pips' }, ...Array.from({ length: a.tiers }, (_, i) => h('span', {
    class: `ach__pip ${i < a.tier ? 'is-lit' : ''}`.trim(), 'aria-hidden': 'true',
  }))))));

  const table = rows.length
    ? h('ul', { class: 'insight-list', role: 'list' }, ...rows.slice(0, 20).map((row) => h('li', { class: 'insight' },
      h('div', { class: 'insight__head' },
        h('span', { class: 'insight__title' }, row.title,
          row.where ? h('span', { class: 'muted small insight__where' }, ` · ${row.where}`) : null),
        h('span', { class: 'insight__rate' }, row.rate === null ? '—' : `${row.rate}%`)),
      h('div', { class: 'insight__bar' }, h('span', { style: { width: `${row.rate ?? 0}%` } })),
      h('p', { class: 'muted small' },
        `${row.done}/${row.seen} nights`,
        row.skipped ? ` · ${row.skipped} rain-checked` : '',
        row.missStreak >= 2 ? ` · missed ${row.missStreak} in a row` : ''))))
    : h('p', { class: 'muted' }, 'Insights appear once you have banked a night or two.');

  return {
    title: 'Insights',
    body: h('div', {},
      h('div', { class: 'stat-row' },
        h('div', { class: 'stat-box' }, h('strong', {}, String(level.level)), h('span', {}, titleForLevel(level.level))),
        h('div', { class: 'stat-box' }, h('strong', {}, formatNumber(state.profile.xp)), h('span', {}, 'total XP')),
        h('div', { class: 'stat-box' }, h('strong', {}, formatNumber(state.profile.stardust)), h('span', {}, 'stardust')),
        h('div', {
          class: 'stat-box',
          title: 'Achievement tiers you hold, counted across every family',
        }, h('strong', {}, String(totalTiers(state.profile))), h('span', {}, 'tiers earned'))),
      h('h3', { class: 'modal__section' }, 'Bedtime'),
      bedtimeSection(state),
      reliable.length
        ? h('p', { class: 'modal__lead' }, 'Most reliable: ', h('strong', {}, reliable.map((r) => r.title).join(', ')), '.')
        : null,
      h('h3', { class: 'modal__section' }, 'Task by task'),
      table,
      h('h3', { class: 'modal__section' }, 'Achievements'),
      h('p', { class: 'muted small' }, 'Each one levels up. You can see the rung you are climbing toward; every name past it is a surprise.'),
      badgeGrid,
      h('h3', { class: 'modal__section' }, 'Titles'),
      h('p', { class: 'muted small' }, 'You find out what each one is called when you get there.'),
      h('ul', { class: 'titles', role: 'list' }, ...titleLadder(level.level).map((t) => h('li', {
        class: t.earned ? 'is-earned' : 'is-locked',
        'aria-label': t.earned ? `${t.name}, level ${t.level}` : `Unknown title, level ${t.level}`,
      },
      h('strong', {}, t.name ?? HIDDEN_TITLE),
      h('span', { class: 'muted small' }, `level ${t.level}`))))),
  };
};

/* --------------------------------------------------------------- settings */

let fieldSeq = 0;

/**
 * A labelled group. Not a `<label>`: the controls here are `.timepick` and
 * `.chipset` divs, and a `<label>` with no `for` and no wrapped control names
 * nothing at all — the text was orphaned rather than merely redundant. A group
 * with `aria-labelledby` names them properly, and the hint is wired up too.
 */
function field(label, control, hint) {
  fieldSeq += 1;
  const labelId = `field-label-${fieldSeq}`;
  const hintId = hint ? `field-hint-${fieldSeq}` : null;
  if (control?.setAttribute) {
    control.setAttribute('role', control.getAttribute('role') || 'group');
    control.setAttribute('aria-labelledby', labelId);
    if (hintId) control.setAttribute('aria-describedby', hintId);
    // The group's own aria-label would win over the heading beside it.
    control.removeAttribute('aria-label');
  }
  return h('div', { class: 'field' },
    h('div', { class: 'field__label', id: labelId }, label),
    control,
    hint ? h('p', { class: 'muted small', id: hintId }, hint) : null);
}

/**
 * A row of choices instead of a <select>. A native dropdown at midnight is a
 * grey system sheet sliding up over the app in a font we did not pick; this is
 * three buttons you can already see, and it never covers anything.
 */
function choiceRow(label, options, current, onPick) {
  const row = h('div', { class: 'chipset', role: 'radiogroup', 'aria-label': label });
  const buttons = options.map(([value, text]) => h('button', {
    type: 'button',
    class: `chip-toggle ${value === current ? 'is-on' : ''}`.trim(),
    role: 'radio',
    'aria-checked': value === current ? 'true' : 'false',
    onClick: () => {
      for (const [i, other] of buttons.entries()) {
        const on = options[i][0] === value;
        other.classList.toggle('is-on', on);
        other.setAttribute('aria-checked', on ? 'true' : 'false');
      }
      onPick(value);
      sync();
    },
  }, text));
  row.append(...buttons);
  // The role promises arrow keys and a single tab stop; without this it was six
  // tab stops and arrows that did nothing, which is worse than plain buttons.
  const sync = rovingGroup(row);
  return row;
}

const BEDTIME_STEP = 15;
const BEDTIME_PRESETS = ['21:30', '22:00', '22:30', '23:00', '23:30', '00:00'];

/** Same idea for the clock: `<input type="time">` is a native wheel on a phone. */
function bedtimePicker(current, onChange) {
  let value = parseClock(current) ? current : '23:30';

  const readout = h('span', { class: 'timeset__value', role: 'status', 'aria-live': 'polite' },
    formatClockLabel(value));
  const chips = [];

  const sync = () => {
    readout.textContent = formatClockLabel(value);
    for (const [i, chip] of chips.entries()) {
      const on = BEDTIME_PRESETS[i] === value;
      chip.classList.toggle('is-on', on);
      chip.setAttribute('aria-checked', on ? 'true' : 'false');
    }
    rovingSync?.();
    onChange(value);
  };


  // The steppers used to wrap the whole 1440-minute clock, so sixteen taps of
  // "later" from midnight reached 4am — a time the night cycle reads as this
  // morning rather than tomorrow's. Measured from noon, an evening is a simple
  // range: 19:00 is 420 and 03:45 is 945, and there is nothing to wrap through.
  // Shared with suggestBedtime, which writes straight into this setting: the
  // range you can dial in and the range the app may suggest are one range.
  const EARLIEST = BEDTIME_EARLIEST_FROM_NOON; // 19:00
  const LATEST = BEDTIME_LATEST_FROM_NOON; // 03:45 — one step short of the 4am rollover
  const fromNoon = (h, m) => (h * 60 + m - 720 + 1440) % 1440;

  const shift = (minutes) => {
    const parsed = parseClock(value) || { hours: 23, minutes: 30 };
    const next = clamp(fromNoon(parsed.hours, parsed.minutes) + minutes, EARLIEST, LATEST);
    const total = (next + 720) % 1440;
    value = `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
    sync();
  };

  const stepper = h('div', { class: 'timeset' },
    h('button', {
      type: 'button', class: 'timeset__btn', 'aria-label': 'Fifteen minutes earlier', onClick: () => shift(-BEDTIME_STEP),
    }, icon('minus', { size: 16 })),
    readout,
    h('button', {
      type: 'button', class: 'timeset__btn', 'aria-label': 'Fifteen minutes later', onClick: () => shift(BEDTIME_STEP),
    }, icon('plus', { size: 16 })));

  let rovingSync = null;
  const row = h('div', { class: 'chipset', role: 'radiogroup', 'aria-label': 'Common bedtimes' });
  for (const preset of BEDTIME_PRESETS) {
    const chip = h('button', {
      type: 'button',
      class: `chip-toggle ${preset === value ? 'is-on' : ''}`.trim(),
      role: 'radio',
      'aria-checked': preset === value ? 'true' : 'false',
      onClick: () => { value = preset; sync(); },
    }, formatClockLabel(preset));
    chips.push(chip);
    row.append(chip);
  }
  rovingSync = rovingGroup(row);

  return h('div', { class: 'timepick' }, stepper, row);
}

function downloadBackup(state) {
  downloadText(serializeState(state), `nightcheck-${state.night.key}.json`);
}

/**
 * What last call actually does, in the panel that sets it.
 *
 * Every clause here is one the code has to keep. The version this replaced said
 * "what stopping pays keeps shrinking" inside a sentence beginning "Past it",
 * which credited last call with the decaying reward — that follows the bedtime
 * and shrinks the same whether this is on, off, or set to two hours. Naming the
 * wrong cause for a real consequence is how a setting acquires a reputation it
 * did not earn, in either direction.
 */
/**
 * When a change to a target does not apply tonight, say so where it is made.
 *
 * The whole design of the deferral rests on this sentence. Tonight runs on the
 * number it was already running on, so the chip and the countdown keep showing
 * that — and without a word here, Settings says 11:30 while the chip says 9:45
 * and the app is contradicting itself on two screens, which is the exact fault
 * this project keeps finding and fixing. One clause, naming both numbers.
 */
function tomorrowNote(tonight) {
  return ` Tonight is already running against ${tonight}, so this takes effect tomorrow.`;
}

function lastCallTomorrowNote(state) {
  if (!lastCallMovesTomorrow(state)) return '';
  const tonight = state.night.lastCall === 0
    ? 'no last call at all'
    : formatLastCall(state.night.key, state.night.bedtime ?? state.profile.settings.bedtime, state.night.lastCall);
  return ` Tonight already has ${tonight}, so this takes effect tomorrow.`;
}

function lastCallHint(state, settings) {
  if (!settings.lastCall) {
    return 'Off. Bedtime is the only line, and being an hour past it looks the same as being three.'
      + lastCallTomorrowNote(state);
  }
  const key = state.night.key;
  const at = formatLastCall(key, settings.bedtime, settings.lastCall);
  const capped = lastCallCapped(key, settings.bedtime, settings.lastCall);
  const bed = formatClockLabel(settings.bedtime);
  return [
    // When the clamp bites, the offset and the time no longer agree, and saying
    // "120 minutes past 3:45 AM, so 4:00 AM" is arithmetic that does not hold.
    // Name the time the offset would have reached, then say what moved it.
    capped
      ? `${settings.lastCall} minutes past ${bed} would be `
        + `${formatLastCall(key, settings.bedtime, settings.lastCall, { clamp: false })}, `
        + `but the night rolls over at 4am and the list starts again — so last call is ${at}.`
      : `${settings.lastCall} minutes past ${bed}, so ${at}.`,
    'Past it the shop, star map, history and insights stop letting you in, with no way through.',
    'Your list and one-at-a-time are never touched.',
  ].join(' ') + lastCallTomorrowNote(state);
}

VIEWS.settings = () => {
  const state = getState();
  const settings = state.profile.settings;

  const bedtime = bedtimePicker(settings.bedtime, (value) => {
    update((s) => { s.profile.settings.bedtime = value; });
    emit('setting', { key: 'bedtime', value });
    // Last call is an offset from this, and its hint names the clock time it
    // lands on — which is wrong the moment the bedtime under it moves.
    refreshModal();
  });

  const motion = choiceRow('Motion', [
    ['auto', 'Follow my system'],
    ['on', 'Always animate'],
    ['off', 'Reduce motion'],
  ], settings.motion, (value) => {
    update((s) => { s.profile.settings.motion = value; });
    emit('setting', { key: 'motion', value });
  });

  // Numbers, not strings, because it is an offset the clock does arithmetic on.
  // choiceRow compares with ===, so the stored value has to be the same type
  // the chips carry — storage.js snaps anything else back to the default.
  const lastCall = choiceRow('Last call', LAST_CALL_CHOICES.map((minutes) => [
    minutes,
    minutes === 0 ? 'Off' : `${minutes} min past`,
  ]), settings.lastCall, (value) => {
    update((s) => { s.profile.settings.lastCall = value; });
    emit('setting', { key: 'lastCall', value });
    // The hint under this row names the resulting clock time, and it is built
    // once at render — without this it kept saying 10:45 after you picked 120.
    refreshModal();
  });

  const importInput = h('input', { type: 'file', accept: 'application/json,.json', class: 'visually-hidden' });
  importInput.addEventListener('change', async () => {
    const file = importInput.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const next = parseImport(text);
      const current = getState();
      const nights = Object.keys(current.history).length;
      const warning = nights
        ? `This replaces everything in this browser: ${nights} banked ${nights === 1 ? 'night' : 'nights'}, level ${current.profile.level}, ${current.profile.stardust} stardust and every unlock.`
        : 'This replaces everything currently in this browser.';
      // Every export has been stamped with the time it was written since the
      // first version, and nothing ever read it — which is the one fact you
      // want before you overwrite a year of nights with a file.
      const written = exportedAtOf(text);
      const dated = written
        ? `This backup was written ${written.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}. `
        : '';
      const go = await confirmAction({
        title: 'Restore this backup?',
        body: dated + warning,
        confirmLabel: 'Restore it',
        cancelLabel: 'Keep what I have',
        iconName: 'upload',
      });
      if (!go) {
        importInput.value = '';
        return;
      }
      replaceState(next);
      emit('imported', next);
      toast('Backup restored', { tone: 'win', iconName: 'upload' });
      refreshModal();
    } catch (err) {
      toast('That file could not be read', { tone: 'warn', iconName: 'upload', detail: err.message });
    }
    importInput.value = '';
  });

  const toggle = (key, label, hint) => {
    const input = h('input', { type: 'checkbox', checked: Boolean(settings[key]) });
    input.addEventListener('change', () => {
      update((s) => { s.profile.settings[key] = input.checked; });
      emit('setting', { key, value: input.checked });
    });
    return h('label', { class: 'switch' }, input,
      h('span', { class: 'switch__track' }, h('span', { class: 'switch__thumb' })),
      h('span', { class: 'switch__label' }, label, hint ? h('span', { class: 'muted small' }, hint) : null));
  };

  const browseBudget = choiceRow('Browsing budget', BROWSE_BUDGET_CHOICES.map((minutes) => [
    minutes,
    minutes === 0 ? 'Off' : `${minutes} min`,
  ]), settings.browseBudget, (value) => {
    update((s) => { s.profile.settings.browseBudget = value; });
    emit('setting', { key: 'browseBudget', value });
    refreshModal();
  });

  return {
    title: 'Settings',
    body: h('div', { class: 'settings' },
      h('div', { class: 'field' },
        h('div', { class: 'field__label' }, 'A bedtime alarm your phone will fire'),
        h('div', { class: 'row' },
          h('button', {
            type: 'button',
            class: 'btn btn--sm',
            onClick: () => {
              const ics = bedtimeAlarmIcs(settings.bedtime);
              if (!ics) return;
              downloadText(ics, 'nightcheck-bedtime.ics', 'text/calendar');
              toast('Bedtime alarm downloaded', {
                tone: 'info',
                iconName: 'calendar',
                detail: 'Open it to add it to your calendar. It repeats nightly.',
                duration: 7000,
              });
            },
          }, icon('calendar', { size: 14 }), 'Add to my calendar')),
        h('p', { class: 'muted small' },
          `This app cannot reach you when it is closed — no web app can without a server, and`
          + ` a server would mean accounts. A calendar event can. Add it once and your phone`
          + ` warns you ${ALARM_LEAD_MINUTES} minutes out and again at`
          + ` ${formatClockLabel(settings.bedtime)}, every night, offline, whether or not this`
          + ` app is open. Adding it again after changing your bedtime replaces it rather than`
          + ` leaving two.`)),
      field('Target bedtime', bedtime, 'Drives the countdown and the on-pace reading.'
        + (bedtimeMovesTomorrow(state) ? tomorrowNote(formatClockLabel(state.night.bedtime)) : '')),
      field('Last call', lastCall, lastCallHint(state, settings)),
      field('Browsing budget', browseBudget, settings.browseBudget
        ? `${settings.browseBudget} minutes of shop, star map, history and insights a night,`
          + ` spent whenever you like. The curfew is a time; this is a quantity — an evening`
          + ` lost to the market at nine o'clock never crossed the curfew at all. It resets at 4am,`
          + ` and it is counted only while a panel is actually open.`
        : 'Off. The curfew and last call are the only limits, and neither has anything to say'
          + ' about an hour in the shop at nine.'),
      field('Motion', motion, 'The sky, the FLIP animations and the pointer trail.'),
      h('div', { class: 'field' },
        toggle('dim', 'Sleep-safe dim', 'Warms and dims the whole page for late nights.'),
        toggle('muted', 'Mute sounds', 'Sound effects are off by default.'),
        toggle('hideCompleted', 'Hide completed tasks', 'They still count — they just get out of the way.'),
        toggle('autoTimer', 'Start the timer automatically', 'In one-at-a-time, the clock runs the moment a card appears instead of waiting for Start.'),
        toggle('curfew', 'Close the market before bed', 'The shop, star map, history and insights shut 30 minutes before bedtime, so this app is not the thing keeping you up.'),
        toggle('shortcuts', 'Single-key shortcuts', 'N, S, B, H and the rest open things with one keypress. Turn this off if you reach them by accident; Esc always works.')),
      h('h3', { class: 'modal__section' }, 'Your data'),
      h('p', { class: 'muted small' }, 'Everything lives in this browser only. Export if you want it anywhere else.'),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn btn--sm', onClick: () => downloadBackup(getState()) },
          icon('download', { size: 14 }), 'Export JSON'),
        h('button', { type: 'button', class: 'btn btn--sm', onClick: () => importInput.click() },
          icon('upload', { size: 14 }), 'Import JSON'),
        importInput),
      h('h3', { class: 'modal__section' }, 'Night control'),
      h('div', { class: 'row' },
        h('button', {
          type: 'button',
          class: 'btn btn--sm',
          onClick: () => {
            const result = update((s) => forceNewNight(s));
            emit('rollover', result);
            toast('Started a fresh night', { tone: 'info', iconName: 'moon', detail: 'The last one was banked into your history.' });
            refreshModal();
          },
        }, 'Bank tonight and start fresh'),
        h('button', {
          type: 'button',
          class: 'btn btn--sm btn--danger',
          onClick: () => runReset(),
        }, 'Choose what to reset…')),
      h('p', { class: 'muted small' },
        'A night rolls over at 4am, so anything you check off at 1am still counts for the night before.'),
      h('h3', { class: 'modal__section' }, 'This app'),
      appVersionPanel()),
  };
};

/**
 * Pick what to throw away, then confirm exactly that. One button that erased
 * your list, your level, your unlocks and your settings together was the only
 * answer the app had to "I just want the boxes unticked".
 */
async function runReset() {
  const chosen = await chooseAction({
    title: 'What should go?',
    body: 'Everything you leave unticked is kept exactly as it is. Pick as few as you like.',
    options: RESET_PARTS,
    confirmLabel: 'Reset these',
    cancelLabel: 'Cancel',
    danger: true,
    iconName: 'undo',
  });
  if (!chosen || !chosen.length) return;

  const names = chosen.map((id) => resetPartById(id).label.toLowerCase());
  const listed = names.length === 1
    ? names[0]
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  const everything = chosen.length === RESET_PARTS.length;

  const go = await confirmAction({
    title: everything ? 'Erase everything?' : 'Reset these?',
    body: everything
      ? 'Every task, section, level, streak, unlock and setting goes. There is no undo, and no copy anywhere else unless you exported one.'
      : `This clears ${listed}. There is no undo.`,
    confirmLabel: everything ? 'Erase it all' : 'Reset',
    cancelLabel: 'Never mind',
    danger: true,
    iconName: 'trash',
  });
  if (!go) return;

  if (everything) {
    clearStorage();
    replaceState(createInitialState());
    emit('imported', getState());
    toast('Everything reset', { tone: 'warn', iconName: 'undo' });
    closeModal();
    return;
  }

  update((state) => applyReset(state, chosen));
  emit('imported', getState()); // same shape of change: re-apply cosmetics, re-render
  toast(`Reset ${listed}`, { tone: 'warn', iconName: 'undo', detail: 'Everything else is untouched.' });
  refreshModal();
}

/**
 * Installed to a home screen, the app is a cache that boots — and it will
 * happily boot last week's copy for days. This is the lever for when it does.
 */
function appVersionPanel() {
  const line = h('p', { class: 'muted small' }, 'Checking which version is running…');
  runningVersion().then((version) => {
    line.textContent = version
      ? `Running ${version}. It updates itself on launch; this is for when it hasn’t.`
      : 'Running from the network, so you always have the newest one.';
  });

  const button = h('button', {
    type: 'button',
    class: 'btn btn--sm',
    onClick: async () => {
      button.disabled = true;
      button.replaceChildren(icon('undo', { size: 14 }), 'Refreshing…');
      const outcome = await refreshApp();
      if (outcome === 'offline') {
        button.disabled = false;
        button.replaceChildren(icon('undo', { size: 14 }), 'Refresh the app');
        toast('No connection', {
          tone: 'warn',
          iconName: 'download',
          detail: 'A refresh has to fetch the new version first.',
        });
      }
      // Every other outcome ends in a reload, so there is nothing to restore.
    },
  }, icon('undo', { size: 14 }), 'Refresh the app');

  return h('div', { class: 'field' },
    h('div', { class: 'row' }, button),
    line,
    h('p', { class: 'muted small' },
      'Nothing you have done is stored in the app itself — your night, streak, '
      + 'stardust and unlocks live in this browser and are untouched by a refresh.'));
}

/* ------------------------------------------------------------------- help */

VIEWS.help = () => ({
  title: 'Keyboard shortcuts',
  body: h('div', {},
    h('p', { class: 'modal__lead' },
      'Adding a task is a text box, a time and a section — no syntax needed. If you '
      + 'prefer to type, the quick-add box also understands ',
      h('code', {}, '#section'), ' and ', h('code', {}, '!minutes'), ': ',
      h('code', {}, 'Floss #wind-down !2'), '. Odd durations are fine — ',
      h('code', {}, '!7.5'), ' and ', h('code', {}, '!30s'), ' both work.'),
    h('p', { class: 'modal__lead' },
      'Press ', h('kbd', {}, 'F'), ' for one task at a time — a single card with a big '
      + 'target, which is the easy way through a long list at midnight.'),
    h('ul', { class: 'shortcuts', role: 'list' }, ...SHORTCUTS.map(([keys, description]) => h('li', {},
      h('kbd', {}, keys), h('span', {}, description)))),
    h('p', { class: 'muted small' },
      'Single-key shortcuts can be turned off in Settings if you reach them by '
      + 'accident. ', h('kbd', {}, 'Esc'), ' always works either way.')),
});

export const MODAL_NAMES = Object.keys(VIEWS);
