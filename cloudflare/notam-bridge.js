// Cloudflare Worker "notam-bridge": tiene le credenziali FAA (NOTAM Management Service, NMS-API) e passa al Logbook
// i NOTAM di un aeroporto. Le credenziali non arrivano mai sul dispositivo.
// Variabili (Settings → Variables and Secrets):
//   FAA_CLIENT_ID (secret), FAA_CLIENT_SECRET (secret)        — quelle date dalla FAA (7-AWA-NAIMES@faa.gov)
//   NMS_HOST (testo, facoltativo) — https://api-nms.aim.faa.gov (produzione, predefinito)
//                                   https://api-staging.cgifederal-aim.com (staging: le prime credenziali FAA sono per questo)
// Uso: GET /notams?icao=GCLP  →  { icao, t, items: [{ id, number, type, cls, start, end, est, sel, text }] }
//      GET /ping              →  { ok: true se le credenziali ci sono }
const ORIGINS = ['https://bolu78.github.io'];
let TOKEN = null;   // { v, exp } finché il Worker resta caldo
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
    if (!ok || req.method !== 'GET' || url.pathname !== '/notams') return json({ error: 'forbidden' }, 403);
    if (!configured) return json({ error: 'not_configured' }, 503);
    const icao = (url.searchParams.get('icao') || '').toUpperCase();
    if (!/^[A-Z]{4}$/.test(icao)) return json({ error: 'bad_icao' }, 400);
    // copia di 10 minuti nella cache di Cloudflare: poche richieste alla FAA anche se si aggiorna spesso
    const cache = caches.default, key = new Request('https://notam-bridge.cache/' + icao);
    if (url.searchParams.get('force') !== '1') { const hit = await cache.match(key); if (hit) { const r = new Response(hit.body, hit); for (const [k, v] of Object.entries(cors)) r.headers.set(k, v); return r; } }
    const host = (env.NMS_HOST || 'https://api-nms.aim.faa.gov').replace(/\/+$/, '');
    try {
      const get = async () => fetch(`${host}/nmsapi/v1/notams?location=${icao}`, { headers: { Authorization: 'Bearer ' + await token(env, host), nmsResponseFormat: 'GEOJSON', Accept: 'application/json' } });
      let r = await get();
      if (r.status === 401 || r.status === 403) { TOKEN = null; r = await get(); }
      if (!r.ok) return json({ error: 'faa_' + r.status }, 502);
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
