const CACHE = 'logbook-3.2.1';
const FILES = ['./', 'index.html', 'styles.css', 'app.js', 'stats.js', 'ftl.js', 'easapdf.js', 'spacewx.js', 'fleet.js', 'lib/jspdf.umd.min.js', 'lib/jspdf.plugin.autotable.min.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'fonts/b612-400.woff2', 'fonts/b612-700.woff2', 'fonts/b612-mono-400.woff2', 'map.js', 'lib/d3-array.min.js', 'lib/d3-geo.min.js', 'lib/topojson-client.min.js', 'data/airports.json', 'data/countries-50m.json', 'data/land-110m.json', 'data/iata.json', 'data/worlddots.json', 'lib/netline/parser.js', 'lib/netline/pdf.min.mjs', 'lib/netline/pdf.worker.min.mjs'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
// rete prima, ma se la rete non risponde entro 3 secondi (wifi d'hotel, roaming lento) si parte dalla copia salvata
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cached = await caches.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then(r => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); } return r; });
    if (!cached) return net.catch(() => caches.match('index.html'));
    const slow = new Promise(res => setTimeout(() => res(cached), 3000));
    return Promise.race([net.catch(() => cached), slow]);
  })());
});
