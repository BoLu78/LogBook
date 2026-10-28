'use strict';
/* Space weather per la scheda volo: dati pubblici NOAA SWPC (Kp osservato e previsto, scale R/S/G, ovale dell'aurora OVATION).
   Per voli da ieri a fra 3 giorni: lungo la rotta di cerchio massimo calcola la latitudine geomagnetica e segnala aurora, radiazione e blackout HF. */
const SWPC = 'https://services.swpc.noaa.gov';
const SWX_SRC = {
  scales: [SWPC + '/products/noaa-scales.json', 15],
  kp: [SWPC + '/products/noaa-planetary-k-index-forecast.json', 30],
  ovation: [SWPC + '/json/ovation_aurora_latest.json', 10]
};
const swxMem = {};
async function swxGet(name) {
  const [url, maxMin] = SWX_SRC[name], now = Date.now();
  if (swxMem[name] && now - swxMem[name].t < maxMin * 60e3) return swxMem[name].v;
  try {
    const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 12000);
    const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' }); clearTimeout(to);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const v = await r.json(); swxMem[name] = { t: now, v }; return v;
  } catch (e) { if (swxMem[name]) return swxMem[name].v; throw e; }
}
// Kp previsto: accetta sia il vecchio formato (righe con intestazione) sia quello a oggetti
function swxKpRows(j) {
  if (!Array.isArray(j)) return [];
  const rows = Array.isArray(j[0]) ? j.slice(1).map(r => ({ time_tag: r[0], kp: r[1], observed: r[2] })) : j;
  return rows.map(r => ({ t: Date.parse(String(r.time_tag || r.time || '').replace(' ', 'T') + (/[Z+]/.test(r.time_tag || '') ? '' : 'Z')), kp: parseFloat(r.kp ?? r.Kp ?? r.kp_index), obs: r.observed || '' })).filter(r => isFinite(r.t) && isFinite(r.kp));
}
function swxScale(sc, key) { const x = sc?.['0']?.[key]; return { n: parseInt(x?.Scale ?? 0, 10) || 0, text: x?.Text || 'none' }; }
// griglia OVATION: [lon 0-359, lat -90..90, probabilità %]
let ovGrid = null, ovRef = null;
function ovationAt(ov, lat, lon) {
  if (ovRef !== ov) { ovRef = ov; ovGrid = new Uint8Array(360 * 181); for (const [lo, la, p] of ov?.coordinates || []) ovGrid[((Math.round(lo) % 360 + 360) % 360) * 181 + Math.round(la) + 90] = p; }
  return ovGrid[((Math.round(lon) % 360 + 360) % 360) * 181 + Math.max(-90, Math.min(90, Math.round(lat))) + 90] || 0;
}
// latitudine geomagnetica (dipolo, polo nord geomagnetico circa 80.8 N, 72.6 W)
const GM_LAT = 80.8 * Math.PI / 180, GM_LON = -72.6 * Math.PI / 180;
function geomagLat(lat, lon) {
  const a = lat * Math.PI / 180, b = lon * Math.PI / 180;
  return Math.asin(Math.sin(a) * Math.sin(GM_LAT) + Math.cos(a) * Math.cos(GM_LAT) * Math.cos(b - GM_LON)) * 180 / Math.PI;
}
function gcPoints(A, B, n = 64) {
  const r = Math.PI / 180, [la1, lo1] = [A[0] * r, A[1] * r], [la2, lo2] = [B[0] * r, B[1] * r];
  const d = 2 * Math.asin(Math.sqrt(Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2)) || 1e-9;
  const out = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n, a = Math.sin((1 - f) * d) / Math.sin(d), b = Math.sin(f * d) / Math.sin(d);
    const x = a * Math.cos(la1) * Math.cos(lo1) + b * Math.cos(la2) * Math.cos(lo2), y = a * Math.cos(la1) * Math.sin(lo1) + b * Math.cos(la2) * Math.sin(lo2), z = a * Math.sin(la1) + b * Math.sin(la2);
    out.push([Math.atan2(z, Math.hypot(x, y)) / r, Math.atan2(y, x) / r]);
  }
  return out;
}
const kpWord = k => k >= 9 ? 'Extreme storm' : k >= 8 ? 'Severe storm' : k >= 7 ? 'Strong storm' : k >= 6 ? 'Moderate storm' : k >= 5 ? 'Minor storm' : k >= 4 ? 'Active' : k >= 3 ? 'Unsettled' : 'Quiet';
const kpCls = k => k >= 7 ? 'bad' : k >= 5 ? 'warn' : k >= 4 ? 'mid' : 'ok';

// valutazione della tratta: f = { date, dep, arr, out, inn } con orari UTC hh:mm
async function swxAssess(f) {
  const A = APT?.[f.dep], B = APT?.[f.arr];
  if (!A || !B || !f.date) return null;
  const t0 = Date.parse(`${f.date}T${(f.out || '12:00').padStart(5, '0')}:00Z`);
  let t1 = Date.parse(`${f.date}T${(f.inn || f.out || '12:00').padStart(5, '0')}:00Z`); if (t1 < t0) t1 += 864e5;
  const now = Date.now();
  if (t1 < now - 36 * 3600e3 || t0 > now + 3.2 * 864e5) return { skip: true };
  const pts = gcPoints([A[0], A[1]], [B[0], B[1]]);
  const gm = Math.max(...pts.map(([la, lo]) => Math.abs(geomagLat(la, lo))));
  const [sc, kpj, ov] = await Promise.all([swxGet('scales').catch(() => null), swxGet('kp').catch(() => null), Math.abs(t0 - now) < 8 * 3600e3 ? swxGet('ovation').catch(() => null) : null]);
  if (!sc && !kpj) throw new Error('NOAA not reachable');
  const rows = swxKpRows(kpj);
  const win = rows.filter(r => r.t >= t0 - 3 * 3600e3 && r.t <= t1 + 3 * 3600e3);
  const kpNow = rows.filter(r => r.t <= now).at(-1)?.kp ?? null;
  const kp = win.length ? Math.max(...win.map(r => r.kp)) : kpNow;
  const R = swxScale(sc, 'R'), S = swxScale(sc, 'S'), G = swxScale(sc, 'G');
  const boundary = 66 - 2 * (kp ?? 0);    // bordo equatoriale approssimato dell'ovale (latitudine geomagnetica)
  let ovMax = 0, ovWhere = null;
  if (ov) for (const [la, lo] of pts) { const p = ovationAt(ov, la, lo); if (p > ovMax) { ovMax = p; ovWhere = [la, lo]; } }
  const alerts = [];
  if (ovMax >= 30) alerts.push(['bad', `Aurora likely on the route (OVATION ${ovMax}% near ${Math.round(ovWhere[0])}°${ovWhere[0] >= 0 ? 'N' : 'S'} ${Math.abs(Math.round(ovWhere[1]))}°${ovWhere[1] >= 0 ? 'E' : 'W'}): expect HF degradation, possible GNSS errors.`]);
  else if (ovMax >= 10) alerts.push(['warn', `Aurora possible on the route (OVATION ${ovMax}%): HF may be degraded at high latitude.`]);
  else if (kp != null && gm >= boundary) alerts.push([kp >= 6 ? 'bad' : 'warn', `Route reaches ${Math.round(gm)}° geomagnetic latitude, inside the auroral zone for Kp ${kp.toFixed(1)}: possible aurora, HF and GNSS effects.`]);
  if (S.n >= 1 && gm >= 50) alerts.push([S.n >= 3 ? 'bad' : 'warn', `Solar radiation storm S${S.n} (${S.text}): higher radiation dose and HF loss on high-latitude legs.`]);
  if (R.n >= 2) alerts.push([R.n >= 3 ? 'bad' : 'warn', `Radio blackout R${R.n} (${R.text}): HF outages on the sunlit side.`]);
  if (G.n >= 2 && gm >= 50 && !alerts.length) alerts.push(['warn', `Geomagnetic storm G${G.n} (${G.text}).`]);
  return { kp, kpNow, R, S, G, gm, boundary, ovMax, alerts, future: t0 > now + 8 * 3600e3 };
}

// riquadro nella scheda volo; si aggiorna quando cambiano data, tratta o orari
function swxCard(form) {
  const box = form.querySelector('#swxCard'); if (!box) return;
  let seq = 0;
  const run = async () => {
    const my = ++seq, v = id => form.querySelector('#' + id)?.value?.trim() || '';
    const f = { date: v('date'), dep: v('dep').toUpperCase(), arr: v('arr').toUpperCase(), out: v('out') || v('std'), inn: v('inn') || v('sta') };
    if (form.querySelector('input[name=kind]:checked')?.value === 'sim') { box.hidden = true; return; }
    try { await loadAirports(); } catch { /* senza aeroporti niente valutazione */ }
    let r;
    try { r = await swxAssess(f); } catch (e) { if (my !== seq) return; box.hidden = false; box.innerHTML = `<h3>Space weather</h3><p class="hint rows-hint">Space weather not available: ${esc(e.message)}.</p>`; return; }
    if (my !== seq) return;
    if (!r || r.skip) { box.hidden = true; return; }
    box.hidden = false;
    const chip = (l, x) => `<span class="swx-chip ${x.n >= 3 ? 'bad' : x.n >= 1 ? 'warn' : 'ok'}" title="${esc(x.text)}">${l}${x.n}</span>`;
    box.innerHTML = `<h3>Space weather <span class="chk-tag">NOAA SWPC${r.future ? ' · forecast' : ''}</span></h3>
      ${r.alerts.map(([c, t]) => `<div class="swx-alert ${c}"><b>⚠︎</b> ${esc(t)}</div>`).join('') || '<div class="swx-alert ok">No space weather impact expected on this route.</div>'}
      <div class="swx-row"><span class="swx-kp ${kpCls(r.kp ?? 0)}">Kp ${r.kp != null ? r.kp.toFixed(1) : '—'}</span><span>${kpWord(r.kp ?? 0)}${r.future ? ' (max forecast for the flight)' : ''}</span>
        ${chip('R', r.R)}${chip('S', r.S)}${chip('G', r.G)}
        <span class="hint">route up to ${Math.round(r.gm)}° geomagnetic · auroral zone from ${Math.round(r.boundary)}°</span></div>`;
  };
  let t; const later = () => { clearTimeout(t); t = setTimeout(run, 500); };
  for (const id of ['date', 'dep', 'arr', 'out', 'inn', 'std', 'sta']) form.querySelector('#' + id)?.addEventListener('change', later);
  run();
}
