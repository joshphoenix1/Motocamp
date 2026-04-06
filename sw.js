/* ===== Service Worker — Offline Support ===== */
const CACHE_NAME = 'lwh-v1';

// Core app shell — always cache these
const APP_SHELL = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/utils.js',
  '/js/data-loader.js',
  '/js/overpass-loader.js',
  '/js/weather.js',
  '/js/layers.js',
  '/js/gravel-roads.js',
  '/js/route.js',
  '/js/dashboard.js',
  '/js/health.js',
  '/js/app.js',
  '/manifest.json',
];

// Install: pre-cache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] Caching app shell');
      return cache.addAll(APP_SHELL);
    })
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: cache-first for app shell & static assets, network-first for API calls
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET and cross-origin API requests that shouldn't be cached
  if (event.request.method !== 'GET') return;

  // Network-first for API calls (weather, overpass, geocoding, routing)
  if (url.hostname !== location.hostname) {
    // For tile servers, use cache-first with network fallback (good for offline maps)
    if (url.pathname.includes('/tile/') || url.hostname.includes('tile.openstreetmap') ||
        url.hostname.includes('opentopomap') || url.hostname.includes('arcgisonline')) {
      event.respondWith(
        caches.open('lwh-tiles').then(cache =>
          cache.match(event.request).then(cached => {
            if (cached) return cached;
            return fetch(event.request).then(resp => {
              if (resp.ok) cache.put(event.request, resp.clone());
              return resp;
            }).catch(() => cached); // offline fallback
          })
        )
      );
      return;
    }

    // Other cross-origin (APIs): network-first, cache fallback
    event.respondWith(
      fetch(event.request)
        .then(resp => {
          if (resp.ok) {
            const clone = resp.clone();
            caches.open('lwh-api').then(cache => cache.put(event.request, clone));
          }
          return resp;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Same-origin: cache-first for app shell
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(resp => {
        if (resp.ok) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return resp;
      });
    })
  );
});
