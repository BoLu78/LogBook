const CACHE = 'logbook-3.14.2';
const FILES = ['./', 'index.html', 'styles.css', 'app.js', 'stats.js', 'ftl.js', 'easapdf.js', 'spacewx.js', 'fleet.js', 'magvar.js', 'briefing.js', 'brfroute.js', 'lib/jspdf.umd.min.js', 'lib/jspdf.plugin.autotable.min.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'fonts/b612-400.woff2', 'fonts/b612-700.woff2', 'fonts/b612-mono-400.woff2', 'map.js', 'lib/d3-array.min.js', 'lib/d3-geo.min.js', 'lib/d3-contour.min.js', 'lib/topojson-client.min.js', 'data/airports.json', 'data/countries-50m.json', 'data/land-110m.json', 'data/iata.json', 'data/runways.json', 'data/worlddots.json', 'lib/netline/parser.js', 'lib/netline/tz.js', 'lib/netline/pdf.min.mjs', 'lib/netline/pdf.worker.min.mjs'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' }))))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
// copia salvata subito (apertura immediata, anche offline). Gli aggiornamenti arrivano con una nuova versione
// di questo file: il browser la scarica da solo, la installa con tutti i file insieme e l'app si ricarica.
// Così non si mescolano mai file di versioni diverse. "Update app" nel menu svuota la copia e riscarica tutto.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cached = await caches.match(e.request, { ignoreSearch: true });
    if (cached) return cached;
    try {
      const r = await fetch(e.request);
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return r;
    } catch (err) {
      return (e.request.mode === 'navigate' && await caches.match('index.html')) || Response.error();
    }
  })());
});
