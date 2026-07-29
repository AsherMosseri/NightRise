/* Cache-first service worker. Bump CACHE when shipping changes — the old
   cache is dropped on activate, so an update never leaves a half-stale app. */

const CACHE = 'nightcheck-v1';

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
  './js/render/checklist.js',
  './js/render/header.js',
  './js/render/modals.js',
  './assets/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached || caches.match('./index.html'));
      return cached || network;
    }),
  );
});
