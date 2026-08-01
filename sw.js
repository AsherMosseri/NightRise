/* Cache-first service worker. Bump CACHE when shipping changes — the old
   cache is dropped on activate, so an update never leaves a half-stale app.

   js/updates.js drives this from the page: it asks the registration to check
   on launch and on foreground, and messages SKIP_WAITING to take a new build. */

const CACHE = 'nightcheck-v57';

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/base.css',
  './css/themes.css',
  './css/layout.css',
  './css/components.css',
  './js/main.js',
  './js/state.js',
  './js/actions.js',
  './js/storage.js',
  './js/model.js',
  './js/night.js',
  './js/game.js',
  './js/achievements.js',
  './js/quests.js',
  './js/shop.js',
  './js/constellations.js',
  './js/companion.js',
  './js/insights.js',
  './js/audio.js',
  './js/sky.js',
  './js/dnd.js',
  './js/keys.js',
  './js/time.js',
  './js/toast.js',
  './js/util.js',
  './js/dom.js',
  './js/render/motion.js',
  './js/render/envelope-open.js',
  './js/render/finale.js',
  './js/render/checklist.js',
  './js/render/header.js',
  './js/render/modals.js',
  './js/render/sheet.js',
  './js/render/confirm.js',
  './js/render/add-task.js',
  './js/render/cards.js',
  './js/render/goodnight.js',
  './js/envelope.js',
  './js/optical.js',
  './js/reset.js',
  './js/timer.js',
  './js/bedtime.js',
  './js/updates.js',
  './assets/icon.svg',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // `cache: 'reload'` matters more than it looks. Without it these go
      // through the HTTP cache, so a new worker could fill its brand-new cache
      // with the same stale files the old one was already serving, and the
      // "update" would change nothing.
      .then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' }))))
      // Take over as soon as the new files are safely stored. Waiting for every
      // client to close is precisely the state an installed app never reaches —
      // the page decides when to *reload*, but the worker must not be stuck
      // behind an old page that has no idea it is waiting.
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      // Only ours. `caches.keys()` returns every cache on the origin, and on
      // GitHub Pages the origin is shared with every other project a user
      // hosts — this was deleting other people's apps out from under them.
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith('nightcheck-') && key !== CACHE)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  const type = event.data?.type;
  if (type === 'SKIP_WAITING') self.skipWaiting();
  // So Settings can show which build is actually running, rather than which
  // build the files on the server say they are.
  if (type === 'VERSION') event.ports?.[0]?.postMessage(CACHE);
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      // Deliberately no opportunistic `cache.put` here. install() precaches the
      // whole asset list atomically under a fresh CACHE name, and that atomicity
      // is the only thing tying a build's modules together — there is no
      // manifest hash and no per-file version. Writing network responses back
      // into the *active* cache refreshed each file on its own schedule, so a
      // deploy landing mid-session, or a network that died halfway, left one
      // cache name holding a mixture of two builds: index.html from build N with
      // half its ES modules from build N+1, booted that way on next launch.
      // Updates arrive the one way that stays self-consistent — a new version.
      const network = fetch(request)
        .catch(() => {
          if (cached) return cached;
          // Only a navigation may fall back to the shell. Handing index.html to a
          // failed module request produced an HTML/MIME error and a dead app.
          if (request.mode === 'navigate') return caches.match('./index.html');
          return Response.error();
        });
      return cached || network;
    }),
  );
});
