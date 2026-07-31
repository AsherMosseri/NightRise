/* The moment the list is empty.
 *
 * The design constraint that shaped this: an app whose argument is "go to bed
 * earlier" cannot ask you to sit through anything. So there is no overlay, no
 * scrim, and nothing anywhere changes pointer-events. You can press Lights out
 * at t=50ms and the whole thing carries on playing behind the fade to black.
 * An animation you are free to ignore can never become an obstacle, which is
 * why this one is allowed a full second while the envelope is capped at 860ms.
 *
 * What it actually does: a line of light travels from the checkbox you just
 * tapped up to the moon — because today the celebration happens in the corner
 * while your eyes are on a checkbox in the middle of the screen — the moon
 * sweeps closed and blooms, the star field brightens in a wave travelling
 * outward from it, and the last beat points at the Lights out button.
 *
 * Everything it announces is permanent. The full moon, the sealed dial, the
 * bonus line and the lit button are all still there afterwards, so missing the
 * animation costs nothing. That is the opposite of a toast, which punishes you
 * for looking away.
 */

import { ribbonTo, moonSurge, burstAt, ringAt, starSwell, moonGeometry } from '../sky.js';
import { still } from './motion.js';
import * as audio from '../audio.js';

let timers = [];
let host = null;

function after(ms, fn) {
  timers.push(setTimeout(fn, ms));
}

function clearTimers() {
  for (const t of timers) clearTimeout(t);
  timers = [];
}

export function initFinale(node) {
  host = node;
}

/**
 * `from` is the rect of the checkbox that finished the night, captured before
 * the re-render that destroys it. Null is fine — the ribbon is then skipped and
 * everything else plays.
 */
export function playFinale({ from = null } = {}) {
  clearTimers();

  const tonight = document.querySelector('.tonight');
  // The class goes on the host, which survives re-render, not on a child that
  // every state change rebuilds.
  if (tonight) {
    tonight.classList.add('tonight--complete');
    after(2600, () => tonight.classList.remove('tonight--complete'));
  }

  // The class goes on #nightend, not on .lightsout. The button itself is
  // rebuilt by the very re-render that this ceremony rides in on, so a class
  // put on it lands on a node that is already detached — which is exactly what
  // happened the first time, and the sweep never once played.
  const end = document.getElementById('nightend');
  if (end) {
    end.classList.add('is-arriving');
    after(2400, () => end.classList.remove('is-arriving'));
    // Pointing at the door is worth nothing if the door is below the fold, and
    // on a phone it is. The list is finished; there is nothing above to look at.
    after(520, () => end.scrollIntoView({
      behavior: still() ? 'auto' : 'smooth',
      block: 'end',
    }));
  }

  if (still()) {
    // No shortened animation — a permanent state change instead. moonSurge
    // snaps the fill and holds the glow up for the rest of the night, so the
    // sky you earned simply looks different from now on.
    moonSurge();
    return;
  }

  const moon = moonGeometry();

  if (from) ribbonTo(from.left + from.width / 2, from.top + from.height / 2);

  after(from ? 140 : 0, () => {
    moonSurge(320);
    audio.play('complete');
  });

  after(from ? 380 : 240, () => {
    ringAt(moon.x, moon.y, { r: moon.r * 1.05, vr: 3.4, decay: 0.018, w: 3 });
    starSwell();
    // Aimed down and inward across the sky toward the list, rather than the old
    // uniform circle that fired half its particles off the top-right corner.
    burstAt(moon.x, moon.y, {
      count: 34, aim: Math.PI * 0.72, spread: Math.PI * 0.85, gravity: 0.012, decay: 0.007,
    });
  });
}

/** Nothing may be left running when the tab goes away. */
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearTimers();
  });
}
