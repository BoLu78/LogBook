// Cloudflare Worker "logbook-auth": tiene il client secret di Google e rinnova l'accesso a Drive del Logbook,
// così l'app resta collegata senza chiedere il login ogni ora. Il refresh token resta sul dispositivo di Luca.
// Variabili (Settings → Variables and Secrets): GOOGLE_CLIENT_ID (testo), GOOGLE_CLIENT_SECRET (secret).
const ORIGINS = ['https://bolu78.github.io'];
export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const ok = ORIGINS.includes(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin);
    const cors = { 'Access-Control-Allow-Origin': ok ? origin : ORIGINS[0], 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin' };
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    const path = new URL(req.url).pathname;
    if (path === '/ping') return json({ ok: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) });
    if (!ok || req.method !== 'POST') return json({ error: 'forbidden' }, 403);
    const b = await req.json().catch(() => ({}));
    const p = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET });
    if (path === '/exchange' && b.code) { p.set('code', b.code); p.set('grant_type', 'authorization_code'); p.set('redirect_uri', 'postmessage'); }
    else if (path === '/refresh' && b.refresh_token) { p.set('refresh_token', b.refresh_token); p.set('grant_type', 'refresh_token'); }
    else return json({ error: 'bad_request' }, 400);
    const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: p });
    const j = await r.json().catch(() => ({}));
    return json({ access_token: j.access_token, expires_in: j.expires_in, refresh_token: j.refresh_token, error: j.error, error_description: j.error_description }, r.ok ? 200 : r.status);
  }
};
