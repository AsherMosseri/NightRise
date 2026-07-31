/* Getting a new build onto a phone that already has the old one.
 *
 * An installed PWA is a cache that boots. The service worker serves whatever it
 * stored last time, and it only reconsiders when the browser happens to
 * re-fetch `sw.js` — which for an iOS home-screen app can be a day later, or
 * not until you delete the app and install it again. Closing it and reopening
 * it does nothing, which is exactly the loop worth breaking.
 *
 * So this asks rather than waits:
 *   - on launch, and whenever the app comes back to the foreground (throttled),
 *     tell the registration to go and look;
 *   - when a new worker takes over, reload straight away if nothing is open —
 *     at launch that is a flicker you will not notice — and otherwise offer a
 *     toast rather than yanking the page out from under a half-typed task;
 *   - `refreshApp()` is the manual lever for Settings: check, and failing that
 *     throw the caches away and reload, which is what deleting and re-adding
 *     the app does, without deleting anything.
 */

const CHECK_EVERY_MS = 10 * 60 * 1000;
/** A reload that lands straight back in another reload would be unusable. */
const APPLY_GUARD_MS = 20 * 1000;
const APPLIED_KEY = 'nightcheck.updated-at';

let registration = null;
let reloading = false;
let lastCheck = 0;
/** Only a page that was already controlled has an old build to replace. */
let hadController = false;
let notify = null;

export function updatesSupported() {
  return 'serviceWorker' in navigator && location.protocol.startsWith('http');
}

function appliedRecently() {
  try {
    return Date.now() - Number(sessionStorage.getItem(APPLIED_KEY) || 0) < APPLY_GUARD_MS;
  } catch {
    return false;
  }
}

function markApplied() {
  try {
    sessionStorage.setItem(APPLIED_KEY, String(Date.now()));
  } catch {
    /* private mode; the worst case is one extra reload */
  }
}

/** Is the app in the middle of something a reload would throw away? */
function busy() {
  // `.onecard:not(:empty)` too. One Card holds `active`, `deferred` and a
  // running timer in module state, so a reload mid-list drops you back on the
  // full checklist with your countdown gone and no explanation.
  if (document.querySelector('dialog[open], .sheet, .goodnight__panel, .inline-edit, .onecard:not(:empty)')) return true;
  const focused = document.activeElement;
  return Boolean(focused && (focused.tagName === 'INPUT' || focused.tagName === 'TEXTAREA'));
}

function reload() {
  if (reloading) return;
  reloading = true;
  markApplied();
  window.location.reload();
}

/** Nudge a worker that installed but is still waiting its turn. */
export function applyUpdate() {
  if (registration?.waiting) {
    registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    return true;
  }
  reload();
  return true;
}

export async function checkNow() {
  if (!registration) return false;
  lastCheck = Date.now();
  try {
    await registration.update();
    return true;
  } catch {
    return false; // offline, or the server is having a moment
  }
}

/** The version string the *running* worker reports, e.g. "v7". */
export function runningVersion(timeoutMs = 1500) {
  return new Promise((resolve) => {
    const worker = navigator.serviceWorker?.controller;
    if (!worker) {
      resolve(null);
      return;
    }
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(null), timeoutMs);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      resolve(typeof event.data === 'string' ? event.data.replace(/^nightcheck-/, '') : null);
    };
    try {
      worker.postMessage({ type: 'VERSION' }, [channel.port2]);
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

/**
 * The Settings button. Resolves to what happened, so the caller can say so:
 * 'offline' | 'reloading'.
 */
export async function refreshApp() {
  if (updatesSupported() && navigator.onLine === false) return 'offline';

  await checkNow();

  // Empty the shelves before reloading. Every request then misses the cache and
  // goes to the network, which is the same result as reinstalling the app,
  // minus the reinstalling. Anything you have done lives in localStorage and is
  // not touched by this.
  try {
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch {
    /* storage locked down — the reload still helps */
  }
  if (registration?.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' });
  reload();
  return 'reloading';
}

export function initUpdates({ onUpdateReady } = {}) {
  if (!updatesSupported()) return;
  hadController = Boolean(navigator.serviceWorker.controller);
  notify = onUpdateReady;

  // The new worker claims the page as soon as it activates. Everything the page
  // has already loaded is the old build, so it has to come round again — the
  // only question is when.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    // At launch nothing is open, so this is a flicker you will not notice. Mid
    // task it would cost you what you were typing, so it asks instead.
    if (!busy() && !appliedRecently()) {
      reload();
      return;
    }
    if (notify) notify();
  });

  navigator.serviceWorker.register('./sw.js').then((reg) => {
    registration = reg;
    // A worker that finished installing while the app was closed can be sitting
    // here waiting, and nothing will hand over to it on its own.
    if (reg.waiting && hadController && !appliedRecently()) {
      reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    }
    checkNow();
  }).catch(() => {
    /* no service worker, no updates to manage */
  });

  // Coming back to the app is the moment to look, and the moment a phone will
  // actually let us: a backgrounded tab gets no timers.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (Date.now() - lastCheck < CHECK_EVERY_MS) return;
    checkNow();
  });
}
