'use strict';
/* Meteo lungo la rotta nel briefing: radar (RainViewer), venti in quota e jet stream (Open-Meteo), SIGMET (NOAA tramite il ponte Cloudflare).
   Modulo separato: se qualcosa non va qui, la parte aeroporti del briefing e il resto dell'app restano intatti.
   La rotta è il cerchio massimo tra gli aeroporti, non il piano di volo con le aerovie. */
const RM_W = 1000, RM_H = 620;
const RM_FL = { 300: '300hPa', 340: '250hPa', 390: '200hPa' };   // livello di volo → superficie di pressione
const RM_BRIDGE_DEF = '';                                       // indirizzo del ponte Cloudflare, quando c'è
const RM_HAZ = { TS: ['#e11d48', 'Thunderstorm'], TURB: ['#f59e0b', 'Turbulence'], ICE: ['#0ea5e9', 'Icing'], MTW: ['#a855f7', 'Mountain wave'], VA: ['#78716c', 'Volcanic ash'], TC: ['#dc2626', 'Tropical cyclone'], SS: ['#b45309', 'Sandstorm'], DS: ['#b45309', 'Duststorm'], RDOACT: ['#16a34a', 'Radioactive cloud'] };
let rmLibs = null, rmWorld = null, rmRadarMeta = null;

function rmLoadLibs() {
  if (typeof d3 !== 'undefined' && d3.geoMercator && typeof topojson !== 'undefined') return Promise.resolve();
  const js = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('file ' + src + ' not available')); document.head.append(s); });
  return rmLibs ||= js('lib/d3-array.min.js').then(() => js('lib/d3-geo.min.js')).then(() => js('lib/topojson-client.min.js')).catch(e => { rmLibs = null; throw e; });
}
async function rmWorldData() {
  if (!rmWorld) {
    const w = await (await fetch('data/countries-50m.json')).json();
    rmWorld = { land: topojson.feature(w, w.objects.countries), borders: topojson.mesh(w, w.objects.countries, (a, b) => a !== b) };
  }
  return rmWorld;
}
function rmSettings() { try { return { radar: true, wind: true, sig: true, fl: 340, ...(JSON.parse(localStorage.getItem('brf:rmset')) || {}) }; } catch { return { radar: true, wind: true, sig: true, fl: 340 }; } }
function rmSaveSettings(s) { try { localStorage.setItem('brf:rmset', JSON.stringify(s)); } catch { /* resta per questa sessione */ } }
function rmBridge() { try { return (localStorage.getItem('brf:bridge') || RM_BRIDGE_DEF).replace(/\/+$/, ''); } catch { return RM_BRIDGE_DEF; } }

// ---------- dati
async function rmRadar() {
  if (rmRadarMeta && Date.now() - rmRadarMeta.t < 5 * 60e3) return rmRadarMeta;
  const j = JSON.parse(await brfText('https://api.rainviewer.com/public/weather-maps.json', 10000));
  const last = j?.radar?.past?.at(-1);
  if (!last) throw new Error('no radar frame');
  rmRadarMeta = { t: Date.now(), host: j.host, path: last.path, time: last.time * 1000 };
  return rmRadarMeta;
}
// venti: griglia sulla mappa + punti lungo la rotta, all'ora più vicina a metà volo
async function rmWinds(key, grid, samples, hourMs) {
  const c = brfRead('rmw:' + key);
  if (c && Date.now() - c.t < 60 * 60e3) return c.v;
  const locs = [...grid, ...samples];
  const vars = Object.values(RM_FL).flatMap(h => [`wind_speed_${h}`, `wind_direction_${h}`]).join(',');
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${locs.map(l => l[1].toFixed(2)).join(',')}&longitude=${locs.map(l => l[0].toFixed(2)).join(',')}&hourly=${vars}&wind_speed_unit=kn&timezone=GMT&past_days=1&forecast_days=4`;
  const j = JSON.parse(await brfText(url, 25000)), arr = Array.isArray(j) ? j : [j];
  if (arr.length !== locs.length) throw new Error('wind data incomplete');
  const times = (arr[0].hourly?.time || []).map(t => Date.parse(t + 'Z'));
  let hi = 0; times.forEach((t, i) => { if (Math.abs(t - hourMs) < Math.abs(times[hi] - hourMs)) hi = i; });
  const out = { hour: times[hi], n: grid.length };
  for (const [fl, h] of Object.entries(RM_FL)) out[fl] = arr.map((r, i) => [locs[i][0], locs[i][1], r.hourly?.[`wind_speed_${h}`]?.[hi], r.hourly?.[`wind_direction_${h}`]?.[hi]]);
  brfSave('rmw:' + key, out);
  return out;
}
const rmTime = v => typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : Date.parse(String(v || '').replace(' ', 'T') + (/Z|[+-]\d\d:?\d\d$/.test(String(v || '')) ? '' : 'Z'));
async function rmSigmets() {
  const c = brfRead('sig');
  if (c && Date.now() - c.t < 10 * 60e3) return c.v;
  const b = rmBridge(); if (!b) return null;
  const j = JSON.parse(await brfText(b + '/isigmet', 15000));
  const list = (Array.isArray(j) ? j : j?.features || []).map(x => {
    const p = x.properties || x;
    let ring = Array.isArray(p.coords) ? p.coords.map(k => [+k.lon, +k.lat]) : x.geometry?.type === 'Polygon' ? x.geometry.coordinates[0] : null;
    if (!ring || ring.length < 3 || ring.some(k => !isFinite(k[0]) || !isFinite(k[1]))) return null;
    return { h: String(p.hazard || '').toUpperCase(), q: p.qualifier || '', fir: p.firId || p.icaoId || '', name: p.firName || '', from: rmTime(p.validTimeFrom), to: rmTime(p.validTimeTo),
      base: p.base ?? null, top: p.top ?? null, ring: ring.map(k => [Math.round(k[0] * 100) / 100, Math.round(k[1] * 100) / 100]), raw: String(p.rawSigmet || p.rawAirSigmet || '').slice(0, 900) };
  }).filter(Boolean);
  brfSave('sig', list);
  return list;
}
// poligono per d3 (sferico): l'anello deve girare in senso orario, altrimenti d3 lo intende come "tutto il mondo tranne"
function rmPoly(ring) {
  const r = ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1] ? ring.slice() : [...ring, ring[0]];
  let f = { type: 'Polygon', coordinates: [r] };
  if (d3.geoArea(f) > 2 * Math.PI) f = { type: 'Polygon', coordinates: [r.slice().reverse()] };
  return f;
}

// ---------- vista
function brfRouteNode(legs) {
  const node = document.createElement('section');
  node.className = 'brf-route';
  node.innerHTML = '<h2>Route weather</h2><p class="muted rm-wait">Loading the route map…</p>';
  rmBuild(node, legs).catch(e => { console.error(e); node.innerHTML = `<h2>Route weather</h2><p class="muted">Route map not available: ${esc(e.message)}.</p>`; });
  return node;
}
async function rmBuild(node, legs) {
  await rmLoadLibs();
  const world = await rmWorldData();
  const pts = legs.map(l => [l.lon, l.lat]);
  const t0 = legs[0].at, t1 = legs.at(-1).at, hourMs = t0 && t1 ? (t0 + t1) / 2 : Date.now();
  // campioni lungo la rotta (cerchio massimo), per i venti e per i SIGMET sulla rotta
  const samples = [];
  for (let i = 0; i < pts.length - 1; i++) { const f = d3.geoInterpolate(pts[i], pts[i + 1]); for (let k = 0; k < 40; k++) samples.push(f(k / 40)); }
  samples.push(pts.at(-1));
  // inquadratura: rotta con margine
  const lons = samples.map(p => p[0]), lats = samples.map(p => p[1]);
  const span = Math.max(Math.max(...lons) - Math.min(...lons), Math.max(...lats) - Math.min(...lats), 6), m = Math.max(3, span * 0.22);
  const box = [Math.min(...lons) - m, Math.max(Math.min(...lats) - m, -75), Math.max(...lons) + m, Math.min(Math.max(...lats) + m, 80)];
  const proj = d3.geoMercator().fitExtent([[10, 10], [RM_W - 10, RM_H - 10]], { type: 'MultiPoint', coordinates: [[box[0], box[1]], [box[2], box[3]], [box[0], box[3]], [box[2], box[1]]] });
  const path = d3.geoPath(proj);
  // griglia dei venti: punti sulla mappa visibile
  const inv = (x, y) => proj.invert([x, y]), grid = [];
  for (let gy = 0; gy < 7; gy++) for (let gx = 0; gx < 11; gx++) { const p = inv(45 + gx * (RM_W - 90) / 10, 45 + gy * (RM_H - 90) / 6); if (p) grid.push([Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100]); }
  const wSamples = samples.filter((_, i) => i % 5 === 0);
  const key = legs.map(l => l.icao).join('-') + ':' + Math.round(hourMs / 3600e3);
  const st = { set: rmSettings(), radar: null, winds: brfRead('rmw:' + key)?.v || null, sig: brfRead('sig')?.v || null, err: {} };

  const render = () => {
    const S = st.set, onRoute = [];
    const land = `<path d="${path(world.land)}" class="rm-land"/><path d="${path(world.borders)}" class="rm-bord"/>`;
    // radar: tasselli Web Mercator allineati alla proiezione
    let radar = '';
    if (S.radar && st.radar) {
      const k = proj.scale(), [tx, ty] = proj.translate(), z = Math.max(1, Math.min(7, Math.round(Math.log2(2 * Math.PI * k / 256)))), n = 2 ** z, ts = 2 * Math.PI * k / n;
      const L = tx - Math.PI * k, T = ty - Math.PI * k;
      for (let y = Math.max(0, Math.floor(-T / ts)); y <= Math.min(n - 1, Math.floor((RM_H - T) / ts)); y++)
        for (let x = Math.floor(-L / ts); x <= Math.floor((RM_W - L) / ts); x++)
          radar += `<image href="${st.radar.host}${st.radar.path}/256/${z}/${((x % n) + n) % n}/${y}/2/1_1.png" x="${(L + x * ts).toFixed(1)}" y="${(T + y * ts).toFixed(1)}" width="${ts.toFixed(1)}" height="${ts.toFixed(1)}" preserveAspectRatio="none"/>`;
      radar = `<g class="rm-radar">${radar}</g>`;
    }
    // SIGMET
    let sig = '';
    if (S.sig && st.sig) {
      const win0 = (t0 || Date.now()) - 3600e3, win1 = (t1 || Date.now()) + 3600e3;
      for (const s of st.sig) {
        if (s.to < win0 || s.from > win1) continue;
        const f = rmPoly(s.ring), d = path(f); if (!d) continue;
        const [col] = RM_HAZ[s.h] || ['#64748b'];
        const hit = samples.some(p => d3.geoContains(f, p));
        if (hit) onRoute.push(s);
        sig += `<path d="${d}" class="rm-sig ${hit ? 'hit' : ''}" style="--c:${col}"/>`;
      }
    }
    // venti e jet stream
    let wind = '', comp = '';
    const W = st.winds?.[S.fl];
    if (S.wind && W) {
      const gridW = W.slice(0, st.winds.n);
      const cls = v => v >= 120 ? 'j3' : v >= 100 ? 'j2' : v >= 70 ? 'j1' : 'j0';
      const jet = gridW.filter(w => w[2] >= 100).map(w => { const p = proj([w[0], w[1]]); return p ? `<circle cx="${p[0].toFixed(0)}" cy="${p[1].toFixed(0)}" r="${w[2] >= 120 ? 62 : 52}" class="rm-jet"/>` : ''; }).join('');
      wind = `<g class="rm-jets">${jet}</g>` + gridW.map(w => {
        const p = proj([w[0], w[1]]); if (!p || w[2] == null || w[3] == null) return '';
        const len = Math.min(48, 12 + w[2] * 0.3);
        return `<g class="rm-w ${cls(w[2])}" transform="translate(${p[0].toFixed(0)},${p[1].toFixed(0)}) rotate(${w[3]})"><path d="M0,${-len / 2}V${len / 2}M-4,${len / 2 - 7}L0,${len / 2}L4,${len / 2 - 7}"/></g>${w[2] >= 70 ? `<text x="${p[0].toFixed(0)}" y="${(p[1] + 22).toFixed(0)}" class="rm-wt">${Math.round(w[2])}</text>` : ''}`;
      }).join('');
      // componente lungo la rotta: positivo = vento in coda
      const along = W.slice(st.winds.n).map((w, i) => {
        const a = wSamples[i], b = wSamples[i + 1] || wSamples[i - 1]; if (!a || !b || w[2] == null) return null;
        let trk = brfBearing([a[1], a[0]], [b[1], b[0]]); if (!wSamples[i + 1]) trk = (trk + 180) % 360;
        return -w[2] * Math.cos(brfRad(w[3] - trk));
      }).filter(v => v != null);
      if (along.length) {
        const avg = along.reduce((s, v) => s + v, 0) / along.length, mx = Math.max(...W.slice(st.winds.n).map(w => w[2] || 0));
        comp = `<span><b>FL${S.fl}</b> average ${avg >= 0 ? 'tailwind' : 'headwind'} <b class="${avg >= 0 ? 'tw' : 'hw'}">${Math.abs(Math.round(avg))} kt</b> · max wind on route ${Math.round(mx)} kt · forecast for ${brfHM(st.winds.hour)}</span>`;
      }
    }
    const route = `<path d="${path({ type: 'LineString', coordinates: pts })}" class="rm-route"/>` + legs.map(l => { const p = proj([l.lon, l.lat]); return `<circle cx="${p[0].toFixed(0)}" cy="${p[1].toFixed(0)}" r="6" class="rm-apt"/><text x="${(p[0] + 10).toFixed(0)}" y="${(p[1] - 8).toFixed(0)}" class="rm-at">${esc(l.icao)}</text>`; }).join('');
    const tg = (k, label) => `<button type="button" data-rm="${k}" class="${S[k] ? 'on' : ''}">${label}</button>`;
    const bridge = rmBridge();
    const sigInfo = !bridge ? '<span class="muted">SIGMET: the Cloudflare bridge is not set up yet.</span>'
      : st.err.sig ? `<span class="muted">SIGMET not reachable${st.sig ? ' · saved data' : ''}.</span>`
      : !st.sig ? '<span class="muted">SIGMET loading…</span>'
      : onRoute.length ? onRoute.map(s => `<span class="rm-sl" style="--c:${(RM_HAZ[s.h] || ['#64748b'])[0]}"><b>${esc((RM_HAZ[s.h] || [, s.h || 'SIGMET'])[1])}</b> ${esc(s.q)} · ${esc(s.fir)} ${esc(s.name)} · ${s.base != null || s.top != null ? `${s.base ? 'FL' + Math.round(s.base / 100) : 'SFC'}–${s.top ? 'FL' + Math.round(s.top / 100) : '?'} · ` : ''}${brfHM(s.from)}–${brfHM(s.to)}${s.raw ? `<details><summary>text</summary><p class="mono">${esc(s.raw)}</p></details>` : ''}</span>`).join('')
      : '<span class="ok-t">No SIGMET on the route during the flight.</span>';
    node.innerHTML = `<div class="rm-head"><h2>Route weather</h2><div class="rm-tg">${tg('radar', 'Radar')}${tg('wind', 'Winds · jet')}${tg('sig', 'SIGMET')}
        <span class="rm-fl">${Object.keys(RM_FL).map(f => `<button type="button" data-fl="${f}" class="${+f === S.fl ? 'on' : ''}">FL${f}</button>`).join('')}</span></div></div>
      <div class="rm-map"><svg viewBox="0 0 ${RM_W} ${RM_H}" role="img" aria-label="Route weather map"><rect width="${RM_W}" height="${RM_H}" class="rm-sea"/>${land}${radar}${sig}${wind}${route}</svg></div>
      <div class="rm-info">${comp}${sigInfo}
        <small class="muted">${S.radar ? (st.radar ? `Radar ${brfHM(st.radar.time)} (RainViewer, only where ground radar exists). ` : st.err.radar ? 'Radar not reachable. ' : '') : ''}Winds: Open-Meteo forecast${st.err.wind ? ' not reachable' : ''}. Route drawn as a great circle, not the filed route. For awareness only.</small>
        <details class="rm-br"><summary>SIGMET bridge</summary><p class="hint">Address of the Cloudflare bridge (for example https://sigmet-bridge.yourname.workers.dev).</p>
          <div class="row"><input id="rmBridge" value="${esc(bridge)}" placeholder="https://…workers.dev" autocapitalize="off" spellcheck="false"><button type="button" class="btn small" id="rmBridgeSave">Save and test</button></div><p class="hint" id="rmBridgeMsg"></p></details>
      </div>`;
    node.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { st.set[b.dataset.rm] = !st.set[b.dataset.rm]; rmSaveSettings(st.set); render(); });
    node.querySelectorAll('[data-fl]').forEach(b => b.onclick = () => { st.set.fl = +b.dataset.fl; rmSaveSettings(st.set); render(); });
    node.querySelector('#rmBridgeSave').onclick = async () => {
      const v = node.querySelector('#rmBridge').value.trim().replace(/\/+$/, ''), msg = node.querySelector('#rmBridgeMsg');
      if (v && !/^https:\/\/[^\s/]+/.test(v)) { msg.textContent = 'The address must start with https://'; return; }
      try { if (v) localStorage.setItem('brf:bridge', v); else localStorage.removeItem('brf:bridge'); localStorage.removeItem('brf:sig'); } catch { /* niente */ }
      msg.textContent = 'Testing…';
      try { st.sig = await rmSigmets(); st.err.sig = false; render(); const m2 = node.querySelector('#rmBridgeMsg'); if (m2) m2.textContent = `Bridge OK: ${st.sig?.length ?? 0} SIGMET received.`; node.querySelector('.rm-br')?.setAttribute('open', ''); }
      catch (e) { msg.textContent = 'Bridge not working: ' + e.message; }
    };
  };
  render();
  // dati in parallelo: ognuno ridisegna quando arriva
  rmRadar().then(r => { st.radar = r; render(); }).catch(() => { st.err.radar = true; render(); });
  rmWinds(key, grid, wSamples, hourMs).then(w => { st.winds = w; render(); }).catch(() => { st.err.wind = true; render(); });
  rmSigmets().then(s => { if (s) st.sig = s; render(); }).catch(() => { st.err.sig = true; render(); });
}
