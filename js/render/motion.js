/* Shared motion helpers.
 *
 * Three problems keep recurring in this app and they all live here now.
 *
 * 1. THE REDUCED-MOTION BRANCH HAS TO BE IN JAVASCRIPT. base.css crushes
 *    `animation-duration` to 0.001ms under [data-motion="off"], which reaches
 *    CSS animations and nothing else. The Web Animations API ignores it
 *    completely, so an element.animate() ceremony would play at full speed for
 *    exactly the people who asked it not to. Every entry point here checks
 *    `still()` first.
 *
 * 2. EVERY BAR IN THIS APP TELEPORTS. Four separate CSS transitions are
 *    declared — the XP bar, the completion dial, the achievement bars, the
 *    quest bar — and not one of them has ever run, because each render builds a
 *    brand new node and a transition needs an old value to move from. `grow()`
 *    remembers the last value per key and sets it back for one frame so the
 *    transition the stylesheet already declares finally has somewhere to start.
 *
 * 3. ANIMATING A NODE THAT IS ABOUT TO BE DESTROYED. Actions notify
 *    synchronously, so the panel containing the thing you just tapped is often
 *    gone by the next line. Anything that must outlive its origin gets built on
 *    <body> from a measured rect instead.
 */

let bodyLayer = null;

/** The app's own motion setting and the OS preference, in one place. */
export function still() {
  return document.documentElement.dataset.motion === 'off';
}

/** A host on <body> for effects whose origin is about to be re-rendered away. */
function layer() {
  if (bodyLayer && bodyLayer.isConnected) return bodyLayer;
  bodyLayer = document.createElement('div');
  bodyLayer.className = 'fx-layer';
  bodyLayer.setAttribute('aria-hidden', 'true');
  document.body.appendChild(bodyLayer);
  return bodyLayer;
}

/**
 * Run a WAAPI animation and clean up afterwards.
 *
 * `finished` REJECTS when an animation is cancelled, so a bare .then(cleanup)
 * leaves an unhandled rejection and a node on the page forever. Both paths run
 * the same teardown.
 */
export function animate(node, frames, options) {
  const anim = node.animate(frames, { fill: 'both', ...options });
  return anim;
}

/** Play `frames` on a throwaway node over the whole app, then bin it. */
export function fx(node, frames, options, life) {
  layer().appendChild(node);
  const done = () => node.remove();
  if (still()) {
    node.remove();
    return null;
  }
  const anim = animate(node, frames, options);
  anim.finished.then(done, done);
  if (life) setTimeout(done, life);
  return anim;
}

/* ------------------------------------------------------------------- bars */

const lastValue = new Map();

/**
 * Give a freshly-built bar its previous value for one frame so the CSS
 * transition already declared for it has something to travel from.
 *
 * `key` must be stable across renders and unique per bar — the transition is
 * remembered by key, not by node, precisely because the node is new each time.
 */
export function grow(node, key, prop, next) {
  if (!node) return;
  const previous = lastValue.get(key);
  lastValue.set(key, next);
  if (still() || previous === undefined || previous === next) {
    node.style.setProperty(prop, next);
    return;
  }
  node.style.setProperty(prop, previous);
  // Two frames, not one: one to paint the old value, one to start from it.
  // A single rAF lands in the same style recalculation and the browser never
  // sees an intermediate value, which is the classic silent-transition bug.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (node.isConnected) node.style.setProperty(prop, next);
    });
  });
}

/** Forget a remembered value, so the next render starts fresh rather than sliding. */
export function forgetGrow(key) {
  lastValue.delete(key);
}

/* ---------------------------------------------------------------- numbers */

const counting = new WeakMap();

/**
 * Count a number up (or down) in place. A number that lands is an event; a
 * number that was suddenly different is bookkeeping.
 */
export function countTo(node, from, to, { ms = 460, format = (n) => String(n) } = {}) {
  if (!node) return;
  const running = counting.get(node);
  if (running) cancelAnimationFrame(running);
  if (still() || from === to) {
    node.textContent = format(to);
    return;
  }
  const start = performance.now();
  const tick = (now) => {
    const t = Math.min(1, (now - start) / ms);
    const eased = 1 - (1 - t) ** 3;
    node.textContent = format(Math.round(from + (to - from) * eased));
    if (t < 1 && node.isConnected) counting.set(node, requestAnimationFrame(tick));
    else counting.delete(node);
  };
  node.textContent = format(from);
  counting.set(node, requestAnimationFrame(tick));
}

/* ----------------------------------------------------------------- flight */

/**
 * Fly a few motes from one rect to another. Used to connect an action to the
 * counter it changed, when the two are far apart on screen.
 */
export function flyBetween(from, to, { count = 4, className = 'fx-mote', ms = 460, stagger = 45 } = {}) {
  if (still() || !from || !to) return;
  const x0 = from.left + from.width / 2;
  const y0 = from.top + from.height / 2;
  const x1 = to.left + to.width / 2;
  const y1 = to.top + to.height / 2;
  for (let i = 0; i < count; i += 1) {
    const mote = document.createElement('span');
    mote.className = className;
    mote.style.left = `${x0}px`;
    mote.style.top = `${y0}px`;
    const spreadX = (Math.random() - 0.5) * 46;
    const spreadY = (Math.random() - 0.5) * 30;
    // A control point above the straight line, so the motes arc rather than
    // sliding. Two keyframes with an offset is enough to read as a curve.
    fx(mote, [
      { transform: 'translate(-50%, -50%) scale(0.6)', opacity: 0 },
      { transform: `translate(calc(-50% + ${(x1 - x0) * 0.45 + spreadX}px), calc(-50% + ${(y1 - y0) * 0.28 + spreadY - 26}px)) scale(1)`, opacity: 1, offset: 0.42 },
      { transform: `translate(calc(-50% + ${x1 - x0}px), calc(-50% + ${y1 - y0}px)) scale(0.35)`, opacity: 0 },
    ], {
      duration: ms,
      delay: i * stagger,
      easing: 'cubic-bezier(0.32, 0.72, 0.35, 1)',
    }, ms + i * stagger + 400);
  }
}

/** The rect of a node, or null — callers must measure before a re-render. */
export function rectOf(node) {
  if (!node || !node.isConnected) return null;
  const rect = node.getBoundingClientRect();
  return rect.width || rect.height ? rect : null;
}

/** grow() as an expression, for building a bar inline in a render tree. */
export function growTo(node, key, width) {
  grow(node, key, 'width', width);
  return node;
}
