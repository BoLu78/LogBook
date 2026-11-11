'use strict';
/* Mappa meteo della rotta nel briefing, con filtri: radar (RainViewer), fulmini e temporali osservati (EUMETSAT, Meteosat),
   rischio temporali, turbolenza stimata, jet e venti in quota (modello, via Open-Meteo), SIGMET (NOAA tramite il ponte Cloudflare).
   Modulo separato: se qualcosa non va qui, la parte aeroporti del briefing e il resto dell'app restano intatti.
   La rotta è il cerchio massimo tra gli aeroporti, non il piano di volo con le aerovie. */
const RM_W = 1000, RM_H = 620;
const RM_FL = { 50: '850hPa', 100: '700hPa', 180: '500hPa', 240: '400hPa', 300: '300hPa', 340: '250hPa', 390: '200hPa' };   // livello di volo → superficie di pressione
const RM_BRIDGE_DEF = 'https://sigmet-bridge.bortolotluca.workers.dev';                                       // indirizzo del ponte Cloudflare, quando c'è
const RM_HAZ = { TS: ['#e11d48', 'Thunderstorm'], TURB: ['#f59e0b', 'Turbulence'], ICE: ['#0ea5e9', 'Icing'], MTW: ['#a855f7', 'Mountain wave'], VA: ['#78716c', 'Volcanic ash'], TC: ['#dc2626', 'Tropical cyclone'], SS: ['#b45309', 'Sandstorm'], DS: ['#b45309', 'Duststorm'], RDOACT: ['#16a34a', 'Radioactive cloud'] };
const RM_KMAX = 20, RM_ZW = new Map();   // zoom massimo; venti delle viste ingrandite (solo in memoria, non salvati)
let rmLibs = null, rmWorld = null, rmRadarMeta = null;

function rmLoadLibs() {
  if (typeof d3 !== 'undefined' && d3.geoMercator && d3.contours && typeof topojson !== 'undefined') return Promise.resolve();
  const js = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('file ' + src + ' not available')); document.head.append(s); });
  return rmLibs ||= js('lib/d3-array.min.js').then(() => js('lib/d3-geo.min.js')).then(() => js('lib/d3-contour.min.js')).then(() => js('lib/topojson-client.min.js')).catch(e => { rmLibs = null; throw e; });
}
async function rmWorldData() {
  if (!rmWorld) {
    const w = await (await fetch('data/countries-50m.json')).json();
    rmWorld = { land: topojson.feature(w, w.objects.countries), borders: topojson.mesh(w, w.objects.countries, (a, b) => a !== b) };
  }
  return rmWorld;
}
const RM_DEF = { radar: true, li: true, cbo: true, ts: true, turb: true, jet: true, wind: true, sig: true, fl: 340 };
function rmSettings() { try { return { ...RM_DEF, ...(JSON.parse(localStorage.getItem('brf:rmset2')) || {}) }; } catch { return { ...RM_DEF }; } }
function rmSaveSettings(s) { try { localStorage.setItem('brf:rmset2', JSON.stringify(s)); } catch { /* resta per questa sessione */ } }
function rmBridge() { try { return (localStorage.getItem('brf:bridge') || RM_BRIDGE_DEF).replace(/\/+$/, ''); } catch { return RM_BRIDGE_DEF; } }

// ---------- dati
async function rmRadar() {
  if (rmRadarMeta && Date.now() - rmRadarMeta.t < 5 * 60e3) return rmRadarMeta;
  const j = JSON.parse(await brfText('https://api.rainviewer.com/public/weather-maps.json', 10000));
  const frames = (j?.radar?.past || []).filter(f => f?.path).map(f => ({ path: f.path, time: f.time * 1000 }));   // ultime 2 ore, ogni 10 minuti
  if (!frames.length) throw new Error('no radar frame');
  rmRadarMeta = { t: Date.now(), host: j.host, frames };
  return rmRadarMeta;
}
// tasselli radar (Web Mercator) che coprono la vista; RainViewer arriva al massimo allo zoom 7 e accetta 100 richieste al minuto
const rmTileZ = P => Math.max(1, Math.min(7, Math.round(Math.log2(2 * Math.PI * P.scale() / 256))));
function rmTiles(P, z) {
  const k = P.scale(), [tx, ty] = P.translate(), n = 2 ** z, ts = 2 * Math.PI * k / n, L = tx - Math.PI * k, T = ty - Math.PI * k, out = [];
  for (let y = Math.max(0, Math.floor(-T / ts)); y <= Math.min(n - 1, Math.floor((RM_H - T) / ts)); y++)
    for (let x = Math.floor(-L / ts); x <= Math.floor((RM_W - L) / ts); x++) out.push({ z, x: ((x % n) + n) % n, y, px: L + x * ts, py: T + y * ts, s: ts });
  return out;
}
const rmTileUrl = (R, f, t) => `${R.host}${f.path}/256/${t.z}/${t.x}/${t.y}/2/1_1.png`;
const rmTileImg = (R, f, t) => `<image href="${rmTileUrl(R, f, t)}" x="${t.px.toFixed(1)}" y="${t.py.toFixed(1)}" width="${t.s.toFixed(1)}" height="${t.s.toFixed(1)}" preserveAspectRatio="none"/>`;
// venti: griglia sulla mappa + punti lungo la rotta, all'ora più vicina a metà volo
async function rmWinds(key, grid, samples, hourMs) {
  const c = brfRead('rmw2:' + key);
  if (c && Date.now() - c.t < 60 * 60e3) return c.v;
  const out = { ...await rmFetchWinds([...grid, ...samples], hourMs), n: grid.length };
  brfSave('rmw2:' + key, out);
  return out;
}
async function rmFetchWinds(locs, hourMs) {
  const vars = Object.values(RM_FL).flatMap(h => [`wind_speed_${h}`, `wind_direction_${h}`]).join(',');
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${locs.map(l => l[1].toFixed(2)).join(',')}&longitude=${locs.map(l => l[0].toFixed(2)).join(',')}&hourly=${vars}&wind_speed_unit=kn&timezone=GMT&past_days=1&forecast_days=4`;
  const j = JSON.parse(await brfText(url, 25000)), arr = Array.isArray(j) ? j : [j];
  if (arr.length !== locs.length) throw new Error('wind data incomplete');
  const times = (arr[0].hourly?.time || []).map(t => Date.parse(t + 'Z'));
  let hi = 0; times.forEach((t, i) => { if (Math.abs(t - hourMs) < Math.abs(times[hi] - hourMs)) hi = i; });
  const out = { hour: times[hi] };
  for (const [fl, h] of Object.entries(RM_FL)) out[fl] = arr.map((r, i) => [locs[i][0], locs[i][1], r.hourly?.[`wind_speed_${h}`]?.[hi], r.hourly?.[`wind_direction_${h}`]?.[hi]]);
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


// ---------- rischi sulla griglia fitta: temporali, turbolenza stimata, jet
// Rischio temporali per ogni ora della finestra di volo, poi il peggiore: 3 = temporale previsto dal modello, 2 = CAPE ≥ 1000 e LI ≤ −2, 1 = CAPE ≥ 300 e LI ≤ 0.
// Turbolenza in aria chiara: indice di Ellrod TI2 = taglio verticale × (deformazione + convergenza); ×10⁻⁷ s⁻²: 4 LGT, 8 MOD, 12 SEV. È una stima dal modello, non il WAFS.
const RM_TI = [4e-7, 8e-7, 12e-7], RM_KT = 0.514444, RM_R = 6371e3;
async function rmHazards(key, pts, gx, from, to) {
  const c = brfRead('rmh:' + key);
  if (c && Date.now() - c.t < 60 * 60e3) return c.v;
  const lv = Object.entries(RM_FL), iso = ms => new Date(ms).toISOString().slice(0, 13) + ':00';
  const vars = ['cape', 'lifted_index', 'weather_code', ...lv.flatMap(([, h]) => [`wind_speed_${h}`, `wind_direction_${h}`, `geopotential_height_${h}`])].join(',');
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${pts.map(l => l[1].toFixed(2)).join(',')}&longitude=${pts.map(l => l[0].toFixed(2)).join(',')}&hourly=${vars}&wind_speed_unit=kn&timezone=GMT&start_hour=${iso(from)}&end_hour=${iso(to)}`;
  const j = JSON.parse(await brfText(url, 30000)), arr = Array.isArray(j) ? j : [j];
  if (arr.length !== pts.length) throw new Error('hazard data incomplete');
  const n = pts.length, gy = n / gx, times = (arr[0].hourly?.time || []).map(t => Date.parse(t + 'Z')), H = times.length;
  const midT = (from + to) / 2; let mid = 0; times.forEach((t, i) => { if (Math.abs(t - midT) < Math.abs(times[mid] - midT)) mid = i; });
  const get = (i, v, h) => arr[i].hourly?.[v]?.[h];
  const out = { from: times[0], to: times.at(-1), mid: times[mid], ts: new Array(n).fill(0), turb: {}, jet: {} };
  for (let i = 0; i < n; i++) for (let h = 0; h < H; h++) {
    const code = get(i, 'weather_code', h), cape = get(i, 'cape', h) ?? 0, li = get(i, 'lifted_index', h) ?? 9;
    const cat = code >= 95 ? 3 : cape >= 1000 && li <= -2 ? 2 : cape >= 300 && li <= 0 ? 1 : 0;
    if (cat > out.ts[i]) out.ts[i] = cat;
  }
  // distanze tra i punti della griglia (in Mercatore le righe hanno latitudine costante e le colonne longitudine costante)
  const dist = (a, b) => { const la = brfRad((pts[a][1] + pts[b][1]) / 2); return Math.hypot(brfRad(pts[b][0] - pts[a][0]) * Math.cos(la), brfRad(pts[b][1] - pts[a][1])) * RM_R; };
  const uv = (i, h, hp) => { const s = get(i, `wind_speed_${hp}`, h), d = get(i, `wind_direction_${hp}`, h); return s == null || d == null ? null : [-s * RM_KT * Math.sin(brfRad(d)), -s * RM_KT * Math.cos(brfRad(d))]; };
  lv.forEach(([fl, hp], li) => {
    const up = lv[Math.min(lv.length - 1, li + 1)][1], dn = lv[Math.max(0, li - 1)][1], cats = new Array(n).fill(0);
    for (let h = 0; h < H; h++) {
      const W = pts.map((_, i) => uv(i, h, hp));
      for (let i = 0; i < n; i++) {
        const x = i % gx, y = (i - x) / gx, a = uv(i, h, up), b = uv(i, h, dn), za = get(i, `geopotential_height_${up}`, h), zb = get(i, `geopotential_height_${dn}`, h);
        const l = y * gx + Math.max(0, x - 1), r = y * gx + Math.min(gx - 1, x + 1), t = Math.max(0, y - 1) * gx + x, bo = Math.min(gy - 1, y + 1) * gx + x;
        if (!a || !b || !W[l] || !W[r] || !W[t] || !W[bo] || !(za - zb > 0)) continue;
        const vws = Math.hypot(a[0] - b[0], a[1] - b[1]) / (za - zb), dx = dist(l, r), dy = dist(bo, t);
        const dudx = (W[r][0] - W[l][0]) / dx, dvdx = (W[r][1] - W[l][1]) / dx, dudy = (W[t][0] - W[bo][0]) / dy, dvdy = (W[t][1] - W[bo][1]) / dy;
        const ti = vws * Math.max(0, Math.hypot(dudx - dvdy, dvdx + dudy) - (dudx + dvdy));
        const cat = ti >= RM_TI[2] ? 3 : ti >= RM_TI[1] ? 2 : ti >= RM_TI[0] ? 1 : 0;
        if (cat > cats[i]) cats[i] = cat;
      }
    }
    out.turb[fl] = cats;
    out.jet[fl] = pts.map((_, i) => Math.round(get(i, `wind_speed_${hp}`, mid) ?? 0));
  });
  brfSave('rmh:' + key, out);
  return out;
}
// Meteosat (EUMETSAT, servizio WMS pubblico): fulmini MTG Lightning Imager ogni 5 minuti, temporali in sviluppo (RDT) ogni 15
const RM_EUM = 'https://view.eumetsat.int/geoserver/';
const rmEumTimes = {};
async function rmEumLatest(layer) {   // ora dell'ultimo dato disponibile, letta dal servizio
  const c = rmEumTimes[layer]; if (c && Date.now() - c.t < 4 * 60e3) return c.v;
  const [ws, name] = layer.split(':');
  const xml = await brfText(`${RM_EUM}${ws}/${name}/wms?service=WMS&request=GetCapabilities&version=1.3.0`, 12000);
  const m = xml.match(/<Dimension[^>]*name="time"[^>]*default="([^"]+)"/) || xml.match(/default="(\d{4}-\d\d-\d\dT[^"]+)"/);
  if (!m) throw new Error('no time');
  rmEumTimes[layer] = { t: Date.now(), v: Date.parse(m[1]) };
  return rmEumTimes[layer].v;
}
// immagine WMS che copre esattamente la vista (EPSG:3857 è la stessa proiezione di Mercatore della mappa).
// Il servizio è lento e con un orario esplicito spesso non risponde: si chiede l'ultima immagine, e l'ora del dato
// entra nell'indirizzo solo per non ricevere dal browser una copia vecchia (il servizio la fa tenere una settimana).
function rmEumUrl(P, layer, ver, style = '') {
  const a = P.invert([0, 0]), b = P.invert([RM_W, RM_H]); if (!a || !b) return '';
  const mx = l => 6378137 * brfRad(l), my = l => 6378137 * Math.log(Math.tan(Math.PI / 4 + brfRad(Math.max(-85, Math.min(85, l))) / 2));
  return `${RM_EUM}wms?service=WMS&version=1.3.0&request=GetMap&layers=${layer}&styles=${style}&format=image/png&transparent=true&crs=EPSG:3857&bbox=${mx(a[0]).toFixed(0)},${my(b[1]).toFixed(0)},${mx(b[0]).toFixed(0)},${my(a[1]).toFixed(0)}&width=600&height=372&v=${ver}`;
}

// ---------- vista
function brfRouteNode(legs) {
  const node = document.createElement('section');
  node.className = 'brf-route';
  node.innerHTML = '<h2>Weather map</h2><p class="muted rm-wait">Loading the weather map…</p>';
  rmBuild(node, legs).catch(e => { console.error(e); node.innerHTML = `<h2>Weather map</h2><p class="muted">Weather map not available: ${esc(e.message)}.</p>`; });
  return node;
}
const RM_PLAY = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 2.5v11l9-5.5z" fill="currentColor"/></svg>';
const RM_PAUSE = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z" fill="currentColor"/></svg>';
// filtri: chiave, etichetta, colore
const RM_LAYERS = [['radar', 'Radar', '#2f5fd0'], ['li', 'Lightning', '#dc2626'], ['cbo', 'CB obs', '#7e22ce'], ['ts', 'TS risk', '#ea580c'], ['turb', 'Turb', '#16a34a'],
  ['jet', 'Jet', '#9333ea'], ['wind', 'Winds', '#2563eb'], ['sig', 'SIGMET', '#ca8a04']];
const RM_TSC = ['', '#facc15', '#f97316', '#dc2626'], RM_TBC = ['', '#86efac', '#22c55e', '#15803d'];
const RM_GX = 21, RM_GY = 14;   // griglia fitta dei rischi, sulla vista intera
async function rmBuild(node, legs) {
  await rmLoadLibs();
  const world = await rmWorldData();
  const pts = legs.map(l => [l.lon, l.lat]);
  const t0 = legs[0].at, t1 = legs.at(-1).at, hourMs = t0 && t1 ? (t0 + t1) / 2 : Date.now();
  // campioni lungo la rotta (cerchio massimo), per i venti e per i rischi sulla rotta
  const samples = [];
  for (let i = 0; i < pts.length - 1; i++) { const f = d3.geoInterpolate(pts[i], pts[i + 1]); for (let k = 0; k < 40; k++) samples.push(f(k / 40)); }
  samples.push(pts.at(-1));
  // inquadratura: rotta con margine
  const lons = samples.map(p => p[0]), lats = samples.map(p => p[1]);
  const span = Math.max(Math.max(...lons) - Math.min(...lons), Math.max(...lats) - Math.min(...lats), 6), m = Math.max(3, span * 0.22);
  const box = [Math.min(...lons) - m, Math.max(Math.min(...lats) - m, -75), Math.max(...lons) + m, Math.min(Math.max(...lats) + m, 80)];
  const proj = d3.geoMercator().fitExtent([[10, 10], [RM_W - 10, RM_H - 10]], { type: 'MultiPoint', coordinates: [[box[0], box[1]], [box[2], box[3]], [box[0], box[3]], [box[2], box[1]]] });
  // proiezione della vista ingrandita: punto a schermo = k · (punto nella vista intera) + (x, y)
  const viewProj = v => d3.geoMercator().scale(proj.scale() * v.k).translate([proj.translate()[0] * v.k + v.x, proj.translate()[1] * v.k + v.y]).clipExtent([[-80, -80], [RM_W + 80, RM_H + 80]]);
  // griglia delle frecce del vento: 11 × 7 punti sulla vista
  const gridOf = (P, step) => { const g = []; for (let gy = 0; gy < 7; gy++) for (let gx = 0; gx < 11; gx++) { const p = P.invert([45 + gx * (RM_W - 90) / 10, 45 + gy * (RM_H - 90) / 6]); if (p) g.push([Math.round(p[0] / step) * step, Math.round(p[1] / step) * step].map(v => Math.round(v * 100) / 100)); } return g; };
  const grid = gridOf(proj, 0.01);
  // griglia fitta dei rischi, un po' oltre i bordi della vista intera
  const HX0 = -30, HY0 = -30, HSX = (RM_W + 60) / (RM_GX - 1), HSY = (RM_H + 60) / (RM_GY - 1), hPts = [];
  for (let gy = 0; gy < RM_GY; gy++) for (let gx = 0; gx < RM_GX; gx++) { const p = proj.invert([HX0 + gx * HSX, HY0 + gy * HSY]); hPts.push([Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100]); }
  const hFrom = Math.floor(((t0 || Date.now()) - 3600e3) / 3600e3) * 3600e3, hTo = Math.ceil(((t1 || Date.now() + 4 * 3600e3) + 3600e3) / 3600e3) * 3600e3;
  const wSamples = samples.filter((_, i) => i % 5 === 0);
  const key = legs.map(l => l.icao).join('-') + ':' + Math.round(hourMs / 3600e3);
  const st = { set: rmSettings(), radar: null, winds: brfRead('rmw2:' + key)?.v || null, sig: brfRead('sig')?.v || null, haz: brfRead('rmh:' + key)?.v || null, eum: {}, err: {},
    v: { k: 1, x: 0, y: 0 }, rv: { k: 1, x: 0, y: 0 }, fi: null, play: null, settle: 0, zwq: 0 };
  // valore della griglia dei rischi nel punto della rotta più vicino
  const hAt = (vals, p) => { const q = proj(p); if (!q) return 0; const gx = Math.round((q[0] - HX0) / HSX), gy = Math.round((q[1] - HY0) / HSY); return vals[Math.max(0, Math.min(RM_GY - 1, gy)) * RM_GX + Math.max(0, Math.min(RM_GX - 1, gx))] || 0; };
  // aree a curve di livello dalla griglia, disegnate nella vista corrente
  // la griglia viene prima infittita 3 volte (interpolazione bilineare), così i bordi delle aree sono morbidi
  const UP = 3, UX = (RM_GX - 1) * UP + 1, UY = (RM_GY - 1) * UP + 1;
  const upsample = vals => { const o = new Float32Array(UX * UY); for (let y = 0; y < UY; y++) for (let x = 0; x < UX; x++) {
    const fx = x / UP, fy = y / UP, x0 = Math.min(RM_GX - 2, Math.floor(fx)), y0 = Math.min(RM_GY - 2, Math.floor(fy)), ax = fx - x0, ay = fy - y0, v = (i, j) => vals[(y0 + j) * RM_GX + x0 + i] || 0;
    o[y * UX + x] = (v(0, 0) * (1 - ax) + v(1, 0) * ax) * (1 - ay) + (v(0, 1) * (1 - ax) + v(1, 1) * ax) * ay; } return o; };
  const contours = (vals, thr, colors, cls, op) => {
    const T = ([x, y]) => `${(st.rv.k * (HX0 + (x - 0.5) / UP * HSX) + st.rv.x).toFixed(1)},${(st.rv.k * (HY0 + (y - 0.5) / UP * HSY) + st.rv.y).toFixed(1)}`;
    return d3.contours().size([UX, UY]).thresholds(thr)(upsample(vals)).map((c, i) => c.coordinates.length
      ? `<path d="${c.coordinates.map(poly => poly.map(ring => 'M' + ring.map(T).join('L') + 'Z').join('')).join('')}" class="${cls}" style="--c:${colors[i]};--o:${op[i]}"/>` : '').join('');
  };

  // ---- strati della mappa, disegnati per la vista corrente
  const layers = P => {
    const S = st.set, path = d3.geoPath(P), onRoute = [], z = st.rv.k;
    const land = `<path d="${path(world.land)}" class="rm-land"/><path d="${path(world.borders)}" class="rm-bord"/>`;
    // nomi dei paesi abbastanza grandi da starci
    const names = world.land.features.map(f => { const a = path.area(f); if (a < 9000) return ''; const c = path.centroid(f); return c[0] > 30 && c[0] < RM_W - 30 && c[1] > 20 && c[1] < RM_H - 10 ? `<text x="${c[0].toFixed(0)}" y="${c[1].toFixed(0)}" class="rm-cn">${esc(String(f.properties?.name || '').toUpperCase())}</text>` : ''; }).join('');
    let radar = '';
    if (S.radar && st.radar) {
      const R = st.radar, p = st.play;
      radar = p?.ready ? p.frames.map((f, i) => `<g class="rm-fr${i === p.i ? ' on' : ''}" data-i="${i}">${p.tiles.map(t => rmTileImg(R, f, t)).join('')}</g>`).join('')
        : rmTiles(P, rmTileZ(P)).map(t => rmTileImg(R, R.frames[Math.min(st.fi ?? Infinity, R.frames.length - 1)], t)).join('');
      radar = `<g class="rm-radar">${radar}</g>`;
    }
    const H = st.haz;
    const ts = S.ts && H ? contours(H.ts, [0.5, 1.5, 2.5], RM_TSC.slice(1), 'rm-hz', [0.22, 0.3, 0.38]) : '';
    const turb = S.turb && H?.turb[S.fl] ? contours(H.turb[S.fl], [0.5, 1.5, 2.5], RM_TBC.slice(1), 'rm-hz rm-tb', [0.16, 0.26, 0.36]) : '';
    const jet = S.jet && H?.jet[S.fl] ? contours(H.jet[S.fl], [80, 100, 120], ['#a855f7', '#a855f7', '#d946ef'], 'rm-hz rm-jt', [0.12, 0.2, 0.3]) : '';
    // fulmini degli ultimi 30 minuti, i più recenti più accesi; temporali osservati
    // immagini Meteosat: elenco per la vista, inserite dopo senza ricaricarle a ogni ridisegno
    const eum = [...(S.cbo && st.eum.cbo ? [[rmEumUrl(P, 'msg_fes:rdt', st.eum.cbo), 'rm-cbo']] : []),
      ...(S.li && st.eum.li ? [[rmEumUrl(P, 'mtg_fd:li_afa', st.eum.li), 'rm-li']] : [])].filter(e => e[0]);
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
    // frecce del vento: da vicino una griglia più fitta, scaricata per la vista ingrandita
    let wind = '', comp = '', zoom = null;
    const W = st.winds?.[S.fl];
    if (z >= 1.5) { const g = gridOf(P, 0.02); zoom = { g, key: Math.round(hourMs / 3600e3) + ':' + g.join(';') }; }
    if (W) {
      if (S.wind) {
        const gridW = (zoom && RM_ZW.get(zoom.key)?.[S.fl]) || W.slice(0, st.winds.n);
        const cls = v => v >= 120 ? 'j3' : v >= 100 ? 'j2' : v >= 70 ? 'j1' : 'j0';
        wind = gridW.map(w => {
          const p = P([w[0], w[1]]); if (!p || w[2] == null || w[3] == null) return '';
          const len = Math.min(48, 12 + w[2] * 0.3);
          return `<g class="rm-w ${cls(w[2])}" transform="translate(${p[0].toFixed(0)},${p[1].toFixed(0)}) rotate(${w[3]})"><path d="M0,${-len / 2}V${len / 2}M-4,${len / 2 - 7}L0,${len / 2}L4,${len / 2 - 7}"/></g>${w[2] >= 70 ? `<text x="${p[0].toFixed(0)}" y="${(p[1] + 22).toFixed(0)}" class="rm-wt">${Math.round(w[2])}</text>` : ''}`;
        }).join('');
      }
      // componente lungo la rotta: positivo = vento in coda
      const along = W.slice(st.winds.n).map((w, i) => {
        const a = wSamples[i], b = wSamples[i + 1] || wSamples[i - 1]; if (!a || !b || w[2] == null) return null;
        let trk = brfBearing([a[1], a[0]], [b[1], b[0]]); if (!wSamples[i + 1]) trk = (trk + 180) % 360;
        return -w[2] * Math.cos(brfRad(w[3] - trk));
      }).filter(v => v != null);
      if (along.length) {
        const avg = along.reduce((s, v) => s + v, 0) / along.length, mx = Math.max(...W.slice(st.winds.n).map(w => w[2] || 0));
        comp = `<span><b>FL${String(S.fl).padStart(3, '0')}</b> average ${avg >= 0 ? 'tailwind' : 'headwind'} <b class="${avg >= 0 ? 'tw' : 'hw'}">${Math.abs(Math.round(avg))} kt</b> · max wind on route ${Math.round(mx)} kt · forecast for ${brfHM(st.winds.hour)}</span>`;
      }
    }
    const route = `<path d="${path({ type: 'LineString', coordinates: pts })}" class="rm-route"/>` + legs.map((l, i) => { const p = P([l.lon, l.lat]); return p ? `<circle cx="${p[0].toFixed(0)}" cy="${p[1].toFixed(0)}" r="${i ? 8 : 9}" class="rm-apt ${i === legs.length - 1 ? 'arr' : i ? 'mid' : 'dep'}"/><text x="${(p[0] + 13).toFixed(0)}" y="${(p[1] - 10).toFixed(0)}" class="rm-at">${esc(l.icao)}</text>` : ''; }).join('');
    return { eum, svg: land + `<g class="rm-cns">${names}</g>` + radar + ts + turb + jet + '<g class="rm-eum"></g>' + sig + `<g class="rm-ws">${wind}</g>` + route, onRoute, comp, zoom };
  };
  const eumEls = new Map();
  const placeEum = list => {
    const g = node.querySelector('.rm-eum'); if (!g) return;
    const keep = new Set();
    for (const [url, cls] of list) {
      let el = eumEls.get(url);
      if (!el) {
        el = document.createElementNS('http://www.w3.org/2000/svg', 'image'); el.setAttribute('width', RM_W); el.setAttribute('height', RM_H); el.setAttribute('preserveAspectRatio', 'none');
        if (cls === 'rm-li') el.setAttribute('filter', 'url(#rmGlow)');
        el.onerror = () => { el.dataset.err = 1; const lg = node.querySelector('.rm-legend'); if (lg) lg.innerHTML = legend(); };
        el.onload = () => { el.dataset.ok = 1; const lg = node.querySelector('.rm-legend'); if (lg) lg.innerHTML = legend(); };
        el.setAttribute('href', url); eumEls.set(url, el);
      }
      el.setAttribute('class', cls); g.append(el); keep.add(url);
    }
    for (const u of eumEls.keys()) if (!keep.has(u)) eumEls.delete(u);
  };
  // venti della vista ingrandita: scaricati poco dopo che la mappa si ferma
  const wantZoomWinds = zoom => {
    clearTimeout(st.zwq);
    if (!zoom || !st.set.wind || RM_ZW.has(zoom.key)) return;
    st.zwq = setTimeout(() => rmFetchWinds(zoom.g, hourMs).then(v => {
      RM_ZW.set(zoom.key, v); if (RM_ZW.size > 40) RM_ZW.delete(RM_ZW.keys().next().value);
      if (node.isConnected && st.rv.k >= 1.5) drawMap();
    }).catch(() => { /* restano le frecce della vista intera */ }), 600);
  };
  // comandi sopra la mappa: radar animato
  const radarCtl = () => {
    if (!st.set.radar || !st.radar || st.radar.frames.length < 2) return '';
    const p = st.play, R = st.radar, f = p?.ready ? p.frames[p.i] : R.frames[Math.min(st.fi ?? Infinity, R.frames.length - 1)];
    return `<button type="button" data-rp aria-label="${p ? 'Stop' : 'Play'} radar loop">${p ? (p.ready ? RM_PAUSE : '<span class="rm-sp"></span>') : RM_PLAY}</button><span class="rm-rt">${p && !p.ready ? 'Loading radar…' : 'Radar ' + brfHM(f.time)}</span>`;
  };
  const updateCtl = () => {
    node.querySelector('.rm-map')?.classList.toggle('zoomed', st.v.k > 1.01);
    const rp = node.querySelector('.rm-rp'); if (rp) rp.innerHTML = radarCtl();
  };
  // ridisegna solo la mappa (zoom, fotogrammi radar), senza toccare pulsanti e testi
  const drawMap = () => {
    const g = node.querySelector('.rm-z'); if (!g) return render();
    const L = layers(viewProj(st.rv));
    g.removeAttribute('transform'); g.innerHTML = L.svg; placeEum(L.eum); updateCtl(); const lg = node.querySelector('.rm-legend'); if (lg) lg.innerHTML = legend(); wantZoomWinds(L.zoom);
  };
  // legenda dei filtri accesi
  const legend = () => {
    const S = st.set, sw = (c, t, cls = '') => `<span class="rm-lg ${cls}" style="--c:${c}">${t}</span>`, out = [];
    if (S.ts) out.push(`<span class="rm-lgg"><b>TS risk</b>${sw(RM_TSC[1], 'LOW')}${sw(RM_TSC[2], 'MOD')}${sw(RM_TSC[3], 'HIGH')}</span>`);
    if (S.turb) out.push(`<span class="rm-lgg"><b>Turb FL${String(S.fl).padStart(3, '0')}</b>${sw(RM_TBC[1], 'LGT')}${sw(RM_TBC[2], 'MOD')}${sw(RM_TBC[3], 'SEV')}</span>`);
    if (S.jet) out.push(`<span class="rm-lgg"><b>Jet</b>${sw('#a855f7', '80+')}${sw('#a855f7', '100+', 'b')}${sw('#d946ef', '120+ kt', 'c')}</span>`);
    const eumState = cls => { const el = [...eumEls.values()].find(e => e.getAttribute('class') === cls && e.isConnected); return !el ? 'loading…' : el.dataset.ok ? '' : el.dataset.err ? ' · not reachable' : ' · loading (EUMETSAT is slow)…'; };
    if (S.li) out.push(`<span class="rm-lgg"><b>Lightning</b>${sw('#facc15', 'last 5 min')}${st.eum.li ? brfHM(st.eum.li) + eumState('rm-li') : 'loading…'}</span>`);
    if (S.cbo) out.push(`<span class="rm-lgg"><b>CB obs</b>${sw('#ef4444', 'red outline')}${st.eum.cbo ? brfHM(st.eum.cbo) + eumState('rm-cbo') : 'loading…'}</span>`);
    return out.join('');
  };
  // che cosa tocca la rotta
  const routeSummary = () => {
    const H = st.haz, S = st.set; if (!H) return st.err.haz ? '<span class="muted">TS risk and turbulence not reachable.</span>' : '<span class="muted">TS risk and turbulence loading…</span>';
    const mx = vals => Math.max(0, ...samples.map(p => hAt(vals, p)));
    const tsm = mx(H.ts), tbm = mx(H.turb[S.fl] || []), w = `${brfHM(H.from)}–${brfHM(H.to)}`;
    const tag = (c, t) => `<b class="rm-tag" style="--c:${c}">${t}</b>`;
    return `<span>On the route, ${w}: TS risk ${tsm ? tag(RM_TSC[tsm], ['', 'LOW', 'MOD', 'HIGH'][tsm]) : '<b class="ok-t">none</b>'} · turbulence at FL${String(S.fl).padStart(3, '0')} ${tbm ? tag(RM_TBC[tbm], ['', 'LGT', 'MOD', 'SEV'][tbm]) : '<b class="ok-t">none</b>'} <small class="muted">(model estimate)</small></span>`;
  };

  const render = () => {
    const S = st.set, L = layers(viewProj(st.rv));
    const tg = ([k, label, c]) => `<button type="button" data-rm="${k}" class="${S[k] ? 'on' : ''}" style="--c:${c}">${label}</button>`;
    const bridge = rmBridge();
    const sigInfo = !S.sig ? '' : !bridge ? '<span class="muted">SIGMET: the Cloudflare bridge is not set up yet.</span>'
      : st.err.sig ? `<span class="muted">SIGMET not reachable${st.sig ? ' · saved data' : ''}.</span>`
      : !st.sig ? '<span class="muted">SIGMET loading…</span>'
      : L.onRoute.length ? L.onRoute.map(s => `<span class="rm-sl" style="--c:${(RM_HAZ[s.h] || ['#64748b'])[0]}"><b>${esc((RM_HAZ[s.h] || [, s.h || 'SIGMET'])[1])}</b> ${esc(s.q)} · ${esc(s.fir)} ${esc(s.name)} · ${s.base != null || s.top != null ? `${s.base ? 'FL' + Math.round(s.base / 100) : 'SFC'}–${s.top ? 'FL' + Math.round(s.top / 100) : '?'} · ` : ''}${brfHM(s.from)}–${brfHM(s.to)}${s.raw ? `<details><summary>text</summary><p class="mono">${esc(s.raw)}</p></details>` : ''}</span>`).join('')
      : '<span class="ok-t">No SIGMET on the route during the flight.</span>';
    const R = st.radar;
    const brOpen = node.querySelector('.rm-br')?.open, scr = node.querySelector('.rm-tg')?.scrollLeft || 0;
    node.innerHTML = `<div class="rm-head"><h2>Weather map</h2>
        <div class="rm-tg">${RM_LAYERS.map(tg).join('')}</div>
        <div class="rm-fl">${Object.keys(RM_FL).map(f => `<button type="button" data-fl="${f}" class="${+f === S.fl ? 'on' : ''}">FL${String(f).padStart(3, '0')}</button>`).join('')}</div></div>
      <div class="rm-map${st.v.k > 1.01 ? ' zoomed' : ''}"><svg viewBox="0 0 ${RM_W} ${RM_H}" role="img" aria-label="Weather map"><defs><filter id="rmGlow"><feMorphology operator="dilate" radius="2.5"/></filter></defs><rect width="${RM_W}" height="${RM_H}" class="rm-sea"/><g class="rm-z">${L.svg}</g></svg>
        <div class="rm-zc"><button type="button" data-z="fit">Whole route</button><button type="button" data-z="in" aria-label="Zoom in">+</button><button type="button" data-z="out" aria-label="Zoom out">−</button></div>
        <div class="rm-rp">${radarCtl()}</div></div>
      <div class="rm-legend">${legend()}</div>
      <div class="rm-info">${routeSummary()}${L.comp}${sigInfo}
        <small class="muted">${S.radar ? (R ? `Radar ${brfHM(R.frames[0].time)}–${brfHM(R.frames.at(-1).time)} (RainViewer, only where ground radar exists). ` : st.err.radar ? 'Radar not reachable. ' : '') : ''}Lightning (MTG) and CB obs (RDT) from Meteosat, EUMETSAT: Europe, Africa, Middle East and Atlantic only. TS risk, turbulence (Ellrod index), jet and winds from the model forecast (Open-Meteo), not WAFS. Pinch with two fingers to zoom, double-tap to zoom in. Route drawn as a great circle, not the filed route. For awareness only.</small>
        <details class="rm-br"${brOpen ? ' open' : ''}><summary>SIGMET bridge</summary><p class="hint">Address of the Cloudflare bridge (for example https://sigmet-bridge.yourname.workers.dev).</p>
          <div class="row"><input id="rmBridge" value="${esc(bridge)}" placeholder="https://…workers.dev" autocapitalize="off" spellcheck="false"><button type="button" class="btn small" id="rmBridgeSave">Save and test</button></div><p class="hint" id="rmBridgeMsg"></p></details>
      </div>`;
    node.querySelector('.rm-tg').scrollLeft = scr; placeEum(L.eum); node.querySelector('.rm-legend').innerHTML = legend();
    if (st.v.k !== st.rv.k || st.v.x !== st.rv.x || st.v.y !== st.rv.y) apply();   // gesto in corso mentre arrivano i dati
    wantZoomWinds(L.zoom);
    node.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { const k = b.dataset.rm; if (k === 'radar') stopRadar(false); st.set[k] = !st.set[k]; rmSaveSettings(st.set); if (st.set[k]) loadEum(); render(); });
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
  // ora dell'ultimo dato Meteosat; se il servizio non risponde con l'ora, si chiede comunque l'ultima immagine
  const loadEum = () => {
    for (const [k, layer, lag] of [['li', 'mtg_fd:li_afa', 15], ['cbo', 'msg_fes:rdt', 30]]) {
      if (!st.set[k] || st.eum[k]) continue;
      rmEumLatest(layer).then(t => { st.eum[k] = t; }).catch(() => { st.eum[k] = Math.floor((Date.now() - lag * 60e3) / 300e3) * 300e3; })
        .finally(() => { if (!node.isConnected) return; drawMap(); const lg = node.querySelector('.rm-legend'); if (lg) lg.innerHTML = legend(); });
    }
  };

  // ---- radar animato: gli ultimi fotogrammi (2 ore, ogni 10 minuti) in loop, fermo qualche istante sull'ultimo
  const playRadar = async () => {
    if (!st.radar || st.play) return;
    const all = st.radar.frames.map((f, idx) => ({ ...f, idx })), P = viewProj(st.rv);
    let z = rmTileZ(P), tiles = rmTiles(P, z);
    while (z > 1 && tiles.length * all.length > 80) tiles = rmTiles(P, --z);   // resta sotto il limite di RainViewer
    const frames = tiles.length * all.length > 80 ? all.filter((_, i) => (all.length - 1 - i) % 2 === 0) : all;
    const play = st.play = { frames, tiles, i: frames.length - 1, ready: false, timer: 0 };
    updateCtl();
    await Promise.all(frames.flatMap(f => tiles.map(t => new Promise(r => { const im = new Image(); im.onload = im.onerror = r; im.src = rmTileUrl(st.radar, f, t); }))));
    if (st.play !== play || !node.isConnected) return;
    play.ready = true; play.i = 0; drawMap();
    let hold = 0;
    play.timer = setInterval(() => {
      if (!node.isConnected || st.play !== play) { clearInterval(play.timer); return; }
      if (play.i === frames.length - 1 && hold++ < 3) return;
      hold = 0; play.i = (play.i + 1) % frames.length;
      node.querySelectorAll('.rm-fr').forEach(g => g.classList.toggle('on', +g.dataset.i === play.i));
      const t = node.querySelector('.rm-rt'); if (t) t.textContent = 'Radar ' + brfHM(frames[play.i].time);
    }, 500);
  };
  function stopRadar(redraw = true) {
    const p = st.play; if (!p) return;
    clearInterval(p.timer); st.play = null;
    if (p.ready) st.fi = p.frames[p.i].idx;   // resta sul fotogramma dove l'hai fermato
    if (redraw) drawMap();
  }

  // ---- zoom e spostamento
  const clampV = v => { const k = Math.min(RM_KMAX, Math.max(1, v.k)); return { k, x: Math.min(0, Math.max(RM_W * (1 - k), v.x)), y: Math.min(0, Math.max(RM_H * (1 - k), v.y)) }; };
  // durante il gesto sposta e ingrandisce il disegno già fatto; quando ti fermi lo ridisegna nitido
  function apply() {
    const g = node.querySelector('.rm-z'); if (!g) return;
    const s = st.v.k / st.rv.k;
    g.setAttribute('transform', `translate(${(st.v.x - st.rv.x * s).toFixed(2)} ${(st.v.y - st.rv.y * s).toFixed(2)}) scale(${s.toFixed(4)})`);
    node.querySelector('.rm-map')?.classList.toggle('zoomed', st.v.k > 1.01);
  }
  const settle = (ms = 0) => {
    clearTimeout(st.settle);
    st.settle = setTimeout(() => {
      if (st.v.k === st.rv.k && st.v.x === st.rv.x && st.v.y === st.rv.y) return;
      stopRadar(false); st.rv = { ...st.v }; drawMap();
    }, ms);
  };
  const setView = (k, x, y) => { st.v = clampV({ k, x, y }); apply(); };
  const zoomAt = ([cx, cy], f, ms = 0) => { const k = Math.min(RM_KMAX, Math.max(1, st.v.k * f)), s = k / st.v.k; setView(k, cx - (cx - st.v.x) * s, cy - (cy - st.v.y) * s); settle(ms); };
  const svgOf = e => e.target?.closest?.('.rm-map svg');
  const vb = (svg, cx, cy) => { const r = svg.getBoundingClientRect(); return [(cx - r.left) * RM_W / r.width, (cy - r.top) * RM_H / r.height]; };

  // dita (iPhone, iPad): due dita per ingrandire e spostare, doppio tocco per ingrandire; un dito fa scorrere la pagina
  let pin = null, tap = null, lastTap = null, lastTouch = 0;
  node.addEventListener('touchstart', e => {
    const svg = svgOf(e); if (!svg) return;
    lastTouch = Date.now();
    if (e.touches.length >= 2) {
      e.preventDefault(); tap = null;
      const [a, b] = e.touches, c = vb(svg, (a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
      pin = { svg, d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1, k: st.v.k, px: (c[0] - st.v.x) / st.v.k, py: (c[1] - st.v.y) / st.v.k };
    } else tap = { x: e.touches[0].clientX, y: e.touches[0].clientY, moved: false, svg };
  }, { passive: false });
  node.addEventListener('touchmove', e => {
    if (pin && e.touches.length >= 2) {
      e.preventDefault();
      const [a, b] = e.touches, c = vb(pin.svg, (a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
      const k = Math.min(RM_KMAX, Math.max(1, pin.k * Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) / pin.d));
      setView(k, c[0] - k * pin.px, c[1] - k * pin.py);
    } else if (tap && Math.hypot(e.touches[0].clientX - tap.x, e.touches[0].clientY - tap.y) > 10) tap.moved = true;
  }, { passive: false });
  node.addEventListener('touchend', e => {
    lastTouch = Date.now();
    if (pin) { if (e.touches.length < 2) { pin = null; settle(0); } return; }
    if (!tap || tap.moved || e.touches.length) { tap = null; return; }
    const now = Date.now();
    if (lastTap && now - lastTap.t < 320 && Math.hypot(tap.x - lastTap.x, tap.y - lastTap.y) < 30) {
      e.preventDefault(); zoomAt(vb(tap.svg, tap.x, tap.y), 2); lastTap = null;
    } else lastTap = { x: tap.x, y: tap.y, t: now };
    tap = null;
  }, { passive: false });
  node.addEventListener('touchcancel', () => { if (pin) { pin = null; settle(0); } tap = null; });
  node.addEventListener('gesturestart', e => { if (svgOf(e)) e.preventDefault(); });   // Safari: niente zoom della pagina sopra la mappa
  // Mac: pizzico sul trackpad, doppio clic, trascinamento col mouse
  node.addEventListener('wheel', e => { const svg = svgOf(e); if (!svg || !e.ctrlKey) return; e.preventDefault(); zoomAt(vb(svg, e.clientX, e.clientY), Math.exp(-e.deltaY * 0.01), 200); }, { passive: false });
  node.addEventListener('dblclick', e => { const svg = svgOf(e); if (!svg || Date.now() - lastTouch < 1000) return; e.preventDefault(); zoomAt(vb(svg, e.clientX, e.clientY), 2); });
  let drag = null;
  node.addEventListener('pointerdown', e => {
    const svg = svgOf(e); if (!svg || e.pointerType !== 'mouse' || e.button !== 0 || st.v.k <= 1.01) return;
    e.preventDefault(); svg.setPointerCapture?.(e.pointerId);
    drag = { svg, x: e.clientX, y: e.clientY, vx: st.v.x, vy: st.v.y };
  });
  node.addEventListener('pointermove', e => {
    if (!drag) return;
    const r = drag.svg.getBoundingClientRect();
    setView(st.v.k, drag.vx + (e.clientX - drag.x) * RM_W / r.width, drag.vy + (e.clientY - drag.y) * RM_H / r.height);
  });
  const endDrag = () => { if (drag) { drag = null; settle(0); } };
  node.addEventListener('pointerup', endDrag); node.addEventListener('pointercancel', endDrag);
  // pulsanti sopra la mappa
  node.addEventListener('click', e => {
    const z = e.target.closest?.('[data-z]');
    if (z) { const c = [RM_W / 2, RM_H / 2]; if (z.dataset.z === 'fit') { setView(1, 0, 0); settle(0); } else zoomAt(c, z.dataset.z === 'in' ? 2 : 0.5); return; }
    if (e.target.closest?.('[data-rp]')) st.play ? stopRadar() : playRadar();
  });

  render();
  // dati in parallelo: ognuno ridisegna quando arriva
  loadEum();
  rmRadar().then(r => { st.radar = r; render(); }).catch(() => { st.err.radar = true; render(); });
  rmWinds(key, grid, wSamples, hourMs).then(w => { st.winds = w; render(); }).catch(() => { st.err.wind = true; render(); });
  rmHazards(key, hPts, RM_GX, hFrom, hTo).then(h => { st.haz = h; render(); }).catch(e => { console.error(e); st.err.haz = true; render(); });
  rmSigmets().then(s => { if (s) st.sig = s; render(); }).catch(() => { st.err.sig = true; render(); });
}
