/* ===== Service Worker — Offline Support ===== */
const CACHE_NAME = 'motorcamp-v12';
const TILES_CACHE = 'motorcamp-tiles';
const CDN_CACHE = 'motorcamp-cdn';

// Caches to preserve across version bumps
const PERSISTENT_CACHES = [TILES_CACHE, CDN_CACHE];

// Core app shell — always cache these
const APP_SHELL = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/auth.js',
  '/js/health.js',
  '/js/utils.js',
  '/js/data-loader.js',
  '/js/weather.js',
  '/js/surface-overlay.js',
  '/js/overpass-loader.js',
  '/js/layers.js',
  '/js/gravel-roads.js',
  '/js/route.js',
  '/js/dashboard.js',
  '/js/offline-maps.js',
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

// Activate: clean old app caches but keep tiles + CDN
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && !PERSISTENT_CACHES.includes(k))
          .map(k => { console.log('[SW] Deleting old cache:', k); return caches.delete(k); })
      )
    )
  );
  self.clients.claim();
});

// Hostname patterns for map tile servers
function isTileRequest(url) {
  const host = url.hostname;
  return host.includes('tile.openstreetmap') ||
    host.includes('opentopomap') ||
    host.includes('arcgisonline') ||
    host.includes('basemaps.cartocdn') ||
    host.includes('tiles.') ||
    (url.pathname.match(/\/\d+\/\d+\/\d+/) !== null); // z/x/y pattern
}

// CDN libraries (Leaflet, Font Awesome, Google Fonts, Supabase, etc.)
function isCdnLibrary(url) {
  const host = url.hostname;
  return host.includes('unpkg.com') ||
    host.includes('cdnjs.cloudflare.com') ||
    host.includes('fonts.googleapis.com') ||
    host.includes('fonts.gstatic.com');
}

// Fetch handler
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // === Same-origin: network-first, cache fallback (ensures fresh code) ===
  if (url.hostname === location.hostname) {
    event.respondWith(
      fetch(event.request).then(resp => {
        if (resp.ok) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return resp;
      }).catch(() => caches.match(event.request))
    );
    return;
  }

  // === Map tiles: cache-first, fetch on miss ===
  if (isTileRequest(url)) {
    event.respondWith(
      caches.open(TILES_CACHE).then(cache =>
        cache.match(event.request).then(cached => {
          if (cached) return cached;
          return fetch(event.request).then(resp => {
            if (resp.ok) cache.put(event.request, resp.clone());
            return resp;
          }).catch(() => cached);
        })
      )
    );
    return;
  }

  // === CDN libraries: cache-first (they're versioned/immutable) ===
  if (isCdnLibrary(url)) {
    event.respondWith(
      caches.open(CDN_CACHE).then(cache =>
        cache.match(event.request).then(cached => {
          if (cached) return cached;
          return fetch(event.request).then(resp => {
            if (resp.ok) cache.put(event.request, resp.clone());
            return resp;
          }).catch(() => cached);
        })
      )
    );
    return;
  }

  // === APIs (weather, geocoding, routing): network-first, cache fallback ===
  event.respondWith(
    fetch(event.request)
      .then(resp => {
        if (resp.ok) {
          const clone = resp.clone();
          caches.open('motorcamp-api').then(cache => cache.put(event.request, clone));
        }
        return resp;
      })
      .catch(() => caches.match(event.request))
  );
});
