/* Service worker for offline use. Registered only when the user enables "Work offline".
   Network-first: online users always get the latest deploy; offline falls back to the cached copy. */
const CACHE = 'web-bms-v2';
const ASSETS = [
  './', './index.html', './manifest.webmanifest', './icon.svg', './css/styles.css',
  './js/app.js', './js/ble.js', './js/bmsmemory.js', './js/chart.js', './js/i18n.js', './js/log.js',
  './js/logformat.js', './js/logstore.js', './js/model.js', './js/offline.js', './js/protocols.js',
  './js/session.js', './js/util.js',
];
const NETWORK_TIMEOUT_MS = 5000;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('web-bms-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

async function networkFirst(request){
  const cache = await caches.open(CACHE);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), NETWORK_TIMEOUT_MS); // why: «полуживая» сеть не должна вешать загрузку
  try{
    const response = await fetch(request, { signal: ac.signal });
    if (response.ok) await cache.put(request, response.clone());
    return response;
  }catch(err){
    const cached = await cache.match(request, { ignoreSearch: true })
      || (request.mode === 'navigate' ? await cache.match('./index.html') : undefined);
    if (cached) return cached;
    throw err;
  }finally{
    clearTimeout(timer);
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(networkFirst(request));
});
