const CACHE = 'logbook-2.3.1';
const FILES = ['./', 'index.html', 'styles.css', 'app.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'fonts/b612-400.woff2', 'fonts/b612-700.woff2', 'fonts/b612-mono-400.woff2', 'map.js', 'lib/d3-array.min.js', 'lib/d3-geo.min.js', 'lib/topojson-client.min.js', 'data/airports.json', 'data/countries-50m.json', 'data/land-110m.json', 'data/iata.json', 'lib/netline/parser.js', 'lib/netline/pdf.min.mjs', 'lib/netline/pdf.worker.min.mjs'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
// rete prima, cache se offline: così gli aggiornamenti arrivano subito quando c'è connessione
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => {
    const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
