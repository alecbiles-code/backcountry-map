// Service worker: makes the app installable and usable with no signal.
//   App files      network first (so a push to GitHub Pages shows up on the next open), cache fallback
//   CDN libraries  cache first (URLs are version pinned)
//   Map tiles      cache first; tiles you have viewed are kept up to RUNTIME_TILE_LIMIT, saved offline areas
//                  live in their own cache ('bcm-offline', filled by js/offline.js) and are never trimmed
//   Live data      weather, search, avalanche, public-lands queries: network only

const VERSION = 'v1';
const SHELL = `bcm-shell-${VERSION}`;
const LIBS = 'bcm-libs';
const TILES = 'bcm-tiles';
const RUNTIME_TILE_LIMIT = 6000;

const SHELL_FILES = [
  './', './index.html', './styles.css', './app.webmanifest', './manifest.json',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
  './vendor/togeojson.mjs',
  ...['main', 'config', 'core', 'state', 'ui', 'map', 'dem', 'layers', 'tracks', 'profile', 'weather', 'tools', 'locate', 'search', 'sheet', 'offline']
    .map((m) => `./js/${m}.js`),
];

const LIB_HOSTS = ['unpkg.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];
const TILE_HOSTS = ['tiles.openfreemap.org', 's3.amazonaws.com', 'server.arcgisonline.com', 'services.arcgisonline.com',
  'a.basemaps.cartocdn.com', 'b.basemaps.cartocdn.com', 'c.basemaps.cartocdn.com', 'tile.waymarkedtrails.org'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('bcm-shell-') && k !== SHELL).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function networkFirst(req, cacheName, timeoutMs = 4000) {
  const cache = await caches.open(cacheName);
  try {
    const res = await Promise.race([fetch(req), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs))]);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await caches.match(req, { ignoreSearch: req.mode === 'navigate' });
    if (hit) return hit;
    if (req.mode === 'navigate') return caches.match('./index.html');
    throw err;
  }
}

let putsSinceTrim = 0;
async function trimTiles() {
  const cache = await caches.open(TILES);
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - RUNTIME_TILE_LIMIT))) await cache.delete(k);
}

async function cacheFirst(req, cacheName) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') {
    const cache = await caches.open(cacheName);
    await cache.put(req, res.clone());
    if (cacheName === TILES && ++putsSinceTrim >= 200) { putsSinceTrim = 0; trimTiles(); }
  }
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) { e.respondWith(networkFirst(req, SHELL)); return; }
  if (LIB_HOSTS.includes(url.hostname)) { e.respondWith(cacheFirst(req, LIBS)); return; }
  if (TILE_HOSTS.includes(url.hostname)) {
    if (url.hostname === 's3.amazonaws.com' && !url.pathname.startsWith('/elevation-tiles-prod/')) return;
    // OpenFreeMap's style and TileJSON name the current tile build; refresh them when online.
    const meta = url.hostname === 'tiles.openfreemap.org' && !/\.(pbf|png|json)$/.test(url.pathname) || /\/styles\//.test(url.pathname);
    e.respondWith(meta ? networkFirst(req, TILES) : cacheFirst(req, TILES));
  }
});
