/* Opening tonight's envelope.
 *
 * The transaction is already finished before a single pixel moves — openEnvelope()
 * has run, the stardust is banked, and the permanent "you got this" row is
 * already correct. Everything here is decoration, and it is built so that it can
 * be skipped, backgrounded, or thrown out at any moment without costing anything.
 *
 * The mechanic that makes it worth watching more than twice is the reel: four
 * cells spin past and stop on the one you got. The three you did not get are
 * seeded from the night key, so a reload replays the identical spin — the same
 * rule the drop itself follows — and they are *ordered* rather than shuffled:
 * win something common and the last cell before the landing is the rarest thing
 * you missed; win something rare and the last cell is common, so the landing
 * reads as an upgrade. That ordering is the whole difference between a reveal
 * you watch once and one that still works in a month.
 */

import { h, icon, svg } from '../dom.js';
import { DROPS } from '../envelope.js';
import { envelopeById } from '../skins.js';
import { getState } from '../state.js';
import { hashString, seededRandom } from '../util.js';
import { still, countTo } from './motion.js';
import * as audio from '../audio.js';

const CELL_H = 44; // integer px: a fractional translate blurs the text
const SPIN_CELLS = 3;

let stage = null;
let live = [];
let timers = [];
let dismiss = null;

/** One line per possible outcome — the reel cell and the final answer share it. */
function cellFor(drop, amount) {
  const text = drop.id === 'dust-small' || drop.id === 'dust-big'
    ? `+${amount} stardust`
    : drop.label;
  return h('div', { class: 'env-cell' }, icon(iconFor(drop), { size: 15 }), h('span', {}, text));
}

function iconFor(drop) {
  if (drop.id.startsWith('dust')) return 'star';
  if (drop.id === 'raincheck') return 'undo';
  if (drop.id === 'freeze') return 'flame';
  if (drop.id === 'headstart') return 'play';
  return 'moon';
}

/**
 * The three decoys, then the winner last.
 *
 * Sorted by rarity relative to what you won, so the cell immediately before the
 * landing is the one that makes the landing feel like something: a near-miss
 * when you won small, a step up when you won big.
 */
export function reelStrip(winner, key) {
  const pool = DROPS.filter((d) => d.id !== winner.id);
  const rand = seededRandom(hashString(`reel:${key}:${winner.id}`));
  const shuffled = pool
    .map((d) => ({ d, r: rand() }))
    .sort((a, b) => a.r - b.r)
    .map((x) => x.d)
    .slice(0, SPIN_CELLS);

  // Rarer means a lower weight. If the winner is common, put the rarest decoy
  // last; if the winner is rare, put the commonest last.
  const winnerIsCommon = winner.weight >= 19;
  shuffled.sort((a, b) => (winnerIsCommon ? a.weight - b.weight : b.weight - a.weight));
  return [...shuffled, winner];
}

/** A guessed amount for a decoy cell — never banked, only ever shown mid-spin. */
function decoyAmount(drop, rand) {
  if (drop.id === 'dust-small') return 12 + Math.floor(rand() * 18);
  if (drop.id === 'dust-big') return 45 + Math.floor(rand() * 40);
  return 1;
}

function teardown() {
  for (const t of timers) clearTimeout(t);
  timers = [];
  for (const a of live) { try { a.cancel(); } catch { /* already gone */ } }
  live = [];
  if (dismiss) {
    window.removeEventListener('pointerdown', dismiss, { capture: true });
    document.removeEventListener('keydown', dismiss, { capture: true });
    dismiss = null;
  }
  if (stage) {
    stage.remove();
    stage = null;
  }
}

function after(ms, fn) {
  timers.push(setTimeout(fn, ms));
}

/**
 * Play the ceremony. `rect` is the sealed button's position, measured by the
 * caller *before* the state update, because notifying subscribers destroys the
 * button synchronously and there is nothing left to measure afterwards.
 */
/** The seal's emblem: a stroked path in a 24x24 box, drawn like every icon. */
function sealEmblem(d) {
  return svg('svg', { viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
    svg('path', {
      d,
      stroke: 'currentColor',
      'stroke-width': 2,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    }));
}

export function playEnvelopeOpen({ drop, amount, rect, key }) {
  teardown();
  if (still() || !rect) return false;

  const rand = seededRandom(hashString(`decoy:${key}:${drop.id}`));
  const strip = reelStrip(drop, key);
  const reel = h('div', { class: 'env-reel' },
    ...strip.map((d) => cellFor(d, d === drop ? amount : decoyAmount(d, rand))));

  // The equipped skin, as four custom properties the stylesheet already reads.
  // A skin that says 'theme' for a colour sets nothing, so the CSS fallback —
  // the sky you have on — wins, and "Plain" stays a true no-op.
  const skin = envelopeById(getState().profile.equipped.envelope || 'plain');
  const ink = (value, prop) => (value && value !== 'theme' ? `${prop}:${value};` : '');
  const style = ink(skin.paper, '--env-paper') + ink(skin.note, '--env-note')
    + ink(skin.ink, '--env-ink') + ink(skin.flap, '--env-flap')
    + ink(skin.seal, '--env-seal');

  const card = h('div', { class: 'env-card', style: style || null },
    h('div', { class: 'env-card__flap', 'aria-hidden': 'true' }),
    h('div', { class: 'env-card__note' },
      h('span', { class: 'env-card__eyebrow' }, 'Tonight’s envelope'),
      h('div', { class: 'env-slot' }, reel)),
    h('div', { class: 'env-card__front', 'aria-hidden': 'true' }),
    // No seal on the plain envelope, because it has never had one.
    skin.seal && skin.seal !== 'theme'
      ? h('div', { class: 'env-card__seal', 'aria-hidden': 'true' },
        skin.sealPath ? sealEmblem(skin.sealPath) : null)
      : null);

  // pointer-events:none from birth to death. There is no scrim, nothing to
  // dismiss, and the tap that ends this also lands on whatever is underneath.
  // The whole ceremony is decoration and is hidden from assistive tech: it
  // carried a live region wrapping the entire reel, so a screen reader was
  // read all three seeded decoys as though you had won them, and then the
  // count-up rewrote the winning cell every frame for 260ms, announcing it
  // over and over. The result is said once, plainly, in its own live region.
  stage = h('div', { class: 'env-stage', 'aria-hidden': 'true' }, card);
  document.body.appendChild(stage);
  const said = h('p', { class: 'visually-hidden', role: 'status' },
    `${drop.label}. ${drop.detail(amount)}`);
  stage.after(said);
  setTimeout(() => said.remove(), 4000);

  const box = card.getBoundingClientRect();
  const dx = (rect.left + rect.width / 2) - (box.left + box.width / 2);
  const dy = (rect.top + rect.height / 2) - (box.top + box.height / 2);
  const sx = Math.max(0.05, rect.width / box.width);
  const sy = Math.max(0.05, rect.height / box.height);

  // Inverted FLIP: the card is built at its final size and pushed back into the
  // button's footprint, so it unfolds out of the thing you touched rather than
  // appearing over it. Non-uniform scale is the point — it is squashed flat.
  live.push(card.animate([
    { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
    { transform: 'none' },
  ], { duration: 240, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'both' }));
  // Opacity on its own, much shorter track. Fading over the full 240ms left the
  // card ghosting over the panel for a third of the ceremony.
  live.push(card.animate([{ opacity: 0 }, { opacity: 1 }],
    { duration: 90, easing: 'linear', fill: 'both' }));

  live.push(card.querySelector('.env-card__flap').animate([
    { transform: 'rotateX(0deg)' },
    { transform: 'rotateX(-168deg)' },
  ], { duration: 200, delay: 100, easing: 'cubic-bezier(0.34, 1.45, 0.5, 1)', fill: 'both' }));

  live.push(card.querySelector('.env-card__note').animate([
    { transform: 'translateY(30%)', opacity: 0 },
    { transform: 'none', opacity: 1 },
  ], { duration: 250, delay: 150, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'both' }));

  // The spin: fast, then a hard decelerate into the last cell.
  live.push(reel.animate([
    { transform: 'translateY(0)' },
    { transform: `translateY(-${CELL_H * SPIN_CELLS}px)` },
  ], { duration: 250, delay: 150, easing: 'cubic-bezier(0.10, 0.85, 0.20, 1)', fill: 'both' }));

  const slot = card.querySelector('.env-slot');
  after(400, () => {
    if (!stage) return;
    card.querySelector('.env-card__note').classList.add('env-card__note--landed');
    live.push(slot.animate([
      { transform: 'scale(1)' }, { transform: 'scale(1.045)' }, { transform: 'scale(1)' },
    ], { duration: 90, easing: 'ease-out' }));
    audio.play('quest');
    // The number lands as an event rather than as a label already sitting there.
    if (drop.id.startsWith('dust')) {
      const span = reel.lastElementChild?.querySelector('span');
      countTo(span, Math.max(0, Math.round(amount * 0.35)), amount, { ms: 260, format: (n) => `+${n} stardust` });
    }
  });

  after(700, () => {
    if (!stage) return;
    const out = stage.animate([
      { opacity: 1, transform: 'none' },
      { opacity: 0, transform: 'translateY(-10px) scale(0.97)' },
    ], { duration: 160, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'both' });
    live.push(out);
    out.finished.then(teardown, teardown);
  });

  // Any tap ends it early — and is not consumed, so it still does what you
  // meant it to do. Registered late so the tap that opened the envelope cannot
  // immediately close it.
  after(200, () => {
    if (!stage) return;
    dismiss = () => teardown();
    window.addEventListener('pointerdown', dismiss, { capture: true, passive: true });
    document.addEventListener('keydown', dismiss, { capture: true, passive: true });
  });

  // Nothing here may outlive its welcome, whatever else happens.
  after(2600, teardown);
  return true;
}

/** A backgrounded tab must not come back to a stranded card. */
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) teardown();
  });
}
