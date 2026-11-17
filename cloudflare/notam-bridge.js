// Cloudflare Worker "notam-bridge": tiene le credenziali FAA (NOTAM Management Service, NMS-API) e passa al Logbook
// i NOTAM di un aeroporto. Le credenziali non arrivano mai sul dispositivo.
// Variabili (Settings → Variables and Secrets):
//   FAA_CLIENT_ID (secret), FAA_CLIENT_SECRET (secret)        — quelle date dalla FAA (7-AWA-NAIMES@faa.gov)
//   NMS_HOST (testo, facoltativo) — https://api-nms.aim.faa.gov (produzione, predefinito)
//                                   https://api-staging.cgifederal-aim.com (staging, solo per prove)
// La produzione FAA rifiuta le richieste troppo ravvicinate (HTTP 429): il Worker le mette in fila, una alla volta,
// e se la FAA risponde 429 riprova da solo fino a 2 volte, aspettando quanto chiede (Retry-After) o 2 s / 4 s.
// Uso: GET /notams?icao=GCLP  →  { icao, t, items: [{ id, number, type, cls, start, end, est, sel, text }] }
//      GET /ping              →  { ok: true se le credenziali ci sono }
//      GET /osm?icao=&bb=     →  mappa aeroporto OpenStreetMap, in cache 30 giorni (vedi sotto)
const ORIGINS = ['https://bolu78.github.io'];
let TOKEN = null;   // { v, exp } finché il Worker resta caldo
const sleep = ms => new Promise(r => setTimeout(r, ms));
// una richiesta alla FAA per volta, almeno 1,5 s tra l'una e l'altra
let QUEUE = Promise.resolve(), LAST = 0;
function faaSlot(fn) {
  const run = QUEUE.then(async () => { const w = LAST + 1500 - Date.now(); if (w > 0) await sleep(w); try { return await fn(); } finally { LAST = Date.now(); } });
  QUEUE = run.catch(() => {});
  return run;
}
// GET alla FAA con nuovo tentativo su 429 (troppe richieste) e su token scaduto
async function faaGet(env, host, path) {
  for (let i = 0; ; i++) {
    const r = await faaSlot(async () => fetch(host + path, { headers: { Authorization: 'Bearer ' + await token(env, host), nmsResponseFormat: 'GEOJSON', Accept: 'application/json' } }));
    if ((r.status === 401 || r.status === 403) && i === 0) { TOKEN = null; continue; }
    if (r.status !== 429 || i >= 2) return r;
    const ra = parseInt(r.headers.get('Retry-After') || '', 10);
    await sleep(Math.min(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 2000 * (i + 1), 6000));
  }
}
async function token(env, host) {
  if (TOKEN && Date.now() < TOKEN.exp) return TOKEN.v;
  const r = await fetch(host + '/v1/auth/token', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + btoa(env.FAA_CLIENT_ID + ':' + env.FAA_CLIENT_SECRET), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials'
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error('auth ' + r.status);
  TOKEN = { v: j.access_token, exp: Date.now() + (parseInt(j.expires_in, 10) || 1799) * 1000 - 60e3 };
  return TOKEN.v;
}
// testo ICAO (con la riga Q) se la FAA lo dà, altrimenti il testo semplice
function pick(f) {
  const core = f?.properties?.coreNOTAMData || {}, n = core.notam || {};
  const tr = (core.notamTranslation || []).find(t => t.type === 'ICAO' && (t.formattedText || t.simpleText));
  return {
    // numero come A8003/26: serie + numero (le specifiche FAA danno "series" e "number" separati)
    id: n.id || '', number: (n.series && !/^[A-Z]/.test(n.number || '') ? n.series : '') + (n.number || ''), type: n.type || '', cls: n.classification || '', loc: n.icaoLocation || n.location || '',
    sched: n.schedule || '',
    start: n.effectiveStart || '', end: n.effectiveEnd || '', est: n.estimated === 'true' || n.estimated === '1' || /EST/.test(n.effectiveEnd || ''),
    sel: n.selectionCode || '', text: String(tr?.formattedText || tr?.simpleText || n.text || '').trim(), plain: String(n.text || '').trim()
  };
}
// Mappe aeroporto: la stessa richiesta a OpenStreetMap (Overpass) che farebbe l'app, ma tenuta 30 giorni nella cache
// di Cloudflare. Così la mappa arriva subito anche quando i server Overpass sono lenti (succede spesso).
// GET /osm?icao=GCLP&bb=lat1,lon1,lat2,lon2  →  JSON Overpass
const OVP = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
async function osm(url, cors, ctx) {
  const icao = (url.searchParams.get('icao') || '').toUpperCase(), bb = url.searchParams.get('bb') || '';
  const hdr = (status, cache) => ({ status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': cache } });
  if (!/^[A-Z0-9]{4}$/.test(icao) || !/^-?\d+\.\d{4}(,-?\d+\.\d{4}){3}$/.test(bb)) return new Response('{"error":"bad_request"}', hdr(400, 'no-store'));
  const key = new Request('https://notam-bridge.cache/osm/v1/' + icao + '/' + bb);
  const hit = await caches.default.match(key);
  if (hit) return new Response(hit.body, hdr(200, 'public, max-age=86400'));
  const q = `[out:json][timeout:90][bbox:${bb}];(way[aeroway~"^(taxiway|apron|terminal|runway|stopway|hangar|tower|parking_position)$"];node[aeroway~"^(holding_position|arresting_gear|windsock|tower)$"];node[navigationaid=papi];);out tags geom;`;
  for (const u of OVP) {
    try {
      const r = await fetch(u, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'LogBook-notam-bridge (bolu78.github.io/LogBook)' } });
      if (!r.ok) continue;
      const t = await r.text();
      if (!/"aeroway"\s*:\s*"(runway|taxiway)"/.test(t)) continue;
      ctx.waitUntil(caches.default.put(key, new Response(t, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=2592000' } })));
      return new Response(t, hdr(200, 'public, max-age=86400'));
    } catch { /* server successivo */ }
  }
  return new Response('{"error":"overpass_unavailable"}', hdr(502, 'no-store'));
}
export default {
  async fetch(req, env, ctx) {
    const origin = req.headers.get('Origin') || '';
    const ok = ORIGINS.includes(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin);
    const cors = { 'Access-Control-Allow-Origin': ok ? origin : ORIGINS[0], 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Max-Age': '86400', Vary: 'Origin' };
    const json = (o, status = 200, cache = 'no-store') => new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': cache } });
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    const url = new URL(req.url);
    const configured = !!(env.FAA_CLIENT_ID && env.FAA_CLIENT_SECRET);
    if (url.pathname === '/ping') return json({ ok: configured });
    if (ok && req.method === 'GET' && url.pathname === '/osm') return osm(url, cors, ctx);
    if (!ok || req.method !== 'GET' || url.pathname !== '/notams') return json({ error: 'forbidden' }, 403);
    if (!configured) return json({ error: 'not_configured' }, 503);
    const icao = (url.searchParams.get('icao') || '').toUpperCase();
    if (!/^[A-Z]{4}$/.test(icao)) return json({ error: 'bad_icao' }, 400);
    // copia di 10 minuti nella cache di Cloudflare: poche richieste alla FAA anche se si aggiorna spesso
    const cache = caches.default, key = new Request('https://notam-bridge.cache/' + icao);
    if (url.searchParams.get('force') !== '1') { const hit = await cache.match(key); if (hit) { const r = new Response(hit.body, hit); for (const [k, v] of Object.entries(cors)) r.headers.set(k, v); return r; } }
    const host = (env.NMS_HOST || 'https://api-nms.aim.faa.gov').replace(/\/+$/, '');
    try {
      const r = await faaGet(env, host, `/nmsapi/v1/notams?location=${icao}`);
      if (!r.ok) return json({ error: 'faa_' + r.status }, r.status === 429 ? 429 : 502);
      const j = await r.json();
      const items = (j?.data?.geojson || []).map(pick).filter(x => x.number || x.text);
      const out = json({ icao, t: Date.now(), items }, 200, 'public, max-age=600');
      ctx.waitUntil(cache.put(key, out.clone()));
      return out;
    } catch (e) {
      return json({ error: String(e.message || e).slice(0, 120) }, 502);
    }
  }
};
