'use strict';
/* Briefing partenza/arrivo: METAR e TAF da aviationweather.gov (NOAA), mappa dell'aeroporto da OpenStreetMap (Overpass).
   Modulo separato: se qui qualcosa non va, il resto dell'app non ne risente.
   Meteo e mappe restano salvati in localStorage (non nel logbook sincronizzato), così il briefing si apre anche offline. */
const BRF_METNO = 'https://api.met.no/weatherapi/tafmetar/1.0/';   // METAR e TAF mondiali, leggibili dal browser
const BRF_VATSIM = 'https://metar.vatsim.net/';                     // METAR di riserva
const BRF_OVP = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const BRF_OVP_RETRY = 30 * 60e3;     // se OpenStreetMap non risponde, riprova tra 30'
const BRF_WX_FRESH = 10 * 60e3;      // meteo: scarica di nuovo se il dato salvato ha più di 10'
const BRF_MAP_FRESH = 60 * 864e5;    // mappa aeroporto: 60 giorni
// soglie generiche, NON le minime della compagnia
const BRF_LIM = { visRed: 1500, visAmb: 5000, ceilRed: 500, ceilAmb: 1500, windAmb: 15, windRed: 30, gustAmb: 25, gustRed: 40, xwAmb: 15, xwRed: 25 };

// ---------- archivio locale
function brfSave(k, v) {
  const s = JSON.stringify({ t: Date.now(), v });
  try { localStorage.setItem('brf:' + k, s); return; } catch { /* spazio pieno: liberiamo le mappe più vecchie */ }
  try {
    const maps = Object.keys(localStorage).filter(x => x.startsWith('brf:map:') && x !== 'brf:' + k)
      .map(x => [x, (JSON.parse(localStorage.getItem(x)) || {}).t || 0]).sort((a, b) => a[1] - b[1]);
    for (const [x] of maps.slice(0, Math.max(1, Math.ceil(maps.length / 2)))) localStorage.removeItem(x);
    localStorage.setItem('brf:' + k, s);
  } catch { /* pazienza: si lavora senza copia locale */ }
}
// pulizia dei dati meteo vecchi (le mappe degli aeroporti restano: si riusano a ogni volo)
// route = 'LIPE-HEMA' (volo appena chiuso col lucchetto): via anche i suoi venti di rotta già passati
function brfCleanup(route) {
  try {
    const now = Date.now(), keys = Object.keys(localStorage).filter(k => k.startsWith('brf:'));
    for (const k of keys) {
      if (k.startsWith('brf:rmw:')) { localStorage.removeItem(k); continue; }   // formato vecchio dei venti
      if (k.startsWith('brf:rmw2:')) {
        const [legs, h] = k.slice(9).split(':'), at = +h * 3600e3;
        if (!(at > now - 864e5) || (route && at < now && ('-' + legs + '-').includes('-' + route + '-'))) localStorage.removeItem(k);
        continue;
      }
      if (k.startsWith('brf:wx:') || k.startsWith('brf:mapfail:')) { const t = (JSON.parse(localStorage.getItem(k)) || {}).t || 0; if (now - t > 2 * 864e5) localStorage.removeItem(k); }
    }
  } catch { /* pulizia non essenziale */ }
}
function brfRead(k) { try { return JSON.parse(localStorage.getItem('brf:' + k)); } catch { return null; } }

async function brfText(url, ms = 12000) {
  const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), ms);
  try { const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.text(); }
  finally { clearTimeout(to); }
}
// ---------- meteo: download (met.no restituisce i bollettini delle ultime 24 h, l'ultimo è il più recente)
const brfLast = txt => String(txt || '').split('=').map(x => x.replace(/\s+/g, ' ').trim())
  .filter(x => /^[A-Z0-9]{4} \d{6}Z/.test(x.replace(/^(METAR|SPECI|TAF)( AMD| COR)* /, ''))).at(-1) || '';
async function brfWeather(icaos, force) {
  const now = Date.now(), need = icaos.filter(c => force || !brfRead('wx:' + c) || now - brfRead('wx:' + c).t > BRF_WX_FRESH);
  let fails = 0;
  await Promise.all(need.map(async c => {
    const old = brfRead('wx:' + c)?.v || {};
    const [m, t] = await Promise.allSettled([brfText(`${BRF_METNO}metar.txt?icao=${c}`), brfText(`${BRF_METNO}taf.txt?icao=${c}`)]);
    let metar = m.status === 'fulfilled' ? brfLast(m.value) : null;
    if (!metar) { try { const v = brfLast(await brfText(BRF_VATSIM + c, 8000)); if (v) metar = v; } catch { /* riserva non disponibile */ } }
    const taf = t.status === 'fulfilled' ? brfLast(t.value) : null;
    if (metar == null && taf == null) { fails++; return; }
    brfSave('wx:' + c, { metar: metar ?? old.metar ?? '', taf: taf ?? old.taf ?? '' });
  }));
  return { err: need.length && fails === need.length ? new Error('weather not reachable') : null };
}

// ---------- meteo: lettura dei gruppi METAR/TAF
const BRF_WX_RE = /^(\+|-|VC)?(MI|BC|PR|DR|BL|SH|TS|FZ)?((DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|SS|DS)+)?$/;
const BRF_WX_NAME = [['TS', 'Thunderstorm'], ['FC', 'Funnel cloud'], ['VA', 'Volcanic ash'], ['FZ', 'Freezing'], ['GR', 'Hail'], ['PL', 'Ice pellets'], ['SQ', 'Squall'], ['SS', 'Sandstorm'], ['DS', 'Duststorm'], ['SN', 'Snow'], ['SH', 'Showers'], ['FG', 'Fog'], ['RA', 'Rain']];
// gravità crescente: ok < warn < CAT II < CAT IIIA < CAT IIIB < sotto le minime
const BRF_RANK = { ok: 0, warn: 1, cat2: 2, cat3a: 3, cat3b: 4, bad: 5 };
const lvlMax = (...l) => l.reduce((a, b) => (BRF_RANK[b] || 0) > (BRF_RANK[a] || 0) ? b : a, 'ok');
// minime di avvicinamento: valori standard EASA, modificabili nella pagina (vanno allineati all'OM-A)
const BRF_MINS_DEF = { c1v: 550, c1d: 200, c2v: 300, c2d: 100, c3av: 200, c3ad: 50, c3bv: 75 };
let brfMinsC = null;
function brfMins() {
  if (!brfMinsC) { try { brfMinsC = { ...BRF_MINS_DEF, ...(JSON.parse(localStorage.getItem('brf:mins')) || {}) }; } catch { brfMinsC = { ...BRF_MINS_DEF }; } }
  return brfMinsC;
}
const BRF_CAT = [['ok', 'CAT I'], ['cat2', 'CAT II'], ['cat3a', 'CAT IIIA · fail passive'], ['cat3b', 'CAT IIIB · fail operational'], ['bad', 'Below minima']];
function brfCatV(v) { const M = brfMins(); return v == null ? 0 : v >= M.c1v ? 0 : v >= M.c2v ? 1 : v >= M.c3av ? 2 : v >= M.c3bv ? 3 : 4; }
function brfCatC(c) { const M = brfMins(); return c == null ? 0 : c >= M.c1d ? 0 : c >= M.c2d ? 1 : c >= M.c3ad ? 2 : 3; }
// limiti vento B737-800 / B737-8 per codice di condizione pista (RWYCC): [traverso, coda, descrizione]
const BRF_RWYCC = { 6: [33, 15, 'Dry'], 5: [25, 15, 'Wet · frost · slush or snow up to 3 mm'], 4: [18, 10, 'Compacted snow, OAT −15 °C and below'], 3: [15, 10, 'Slippery wet · snow over 3 mm · compacted snow'], 2: [8, 5, 'Standing water or slush over 3 mm'] };
const brfLimLvl = (v, lim) => v > lim ? 'bad' : v >= lim * 0.8 ? 'warn' : 'ok';
function brfToken(t) {
  let m;
  if ((m = t.match(/^R(\d{2}[LCR]?)\/([PM])?(\d{4})(?:V([PM])?(\d{4}))?(FT)?(?:\/?[UDN])?$/))) {
    const v = m[6] ? Math.round(+m[3] * 0.3048) : +m[3];
    return { k: 'rvr', rvr: v, txt: t, lvl: BRF_CAT[brfCatV(v)][0] };
  }
  if ((m = t.match(/^(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?(KT|MPS)$/))) {
    const k = m[4] === 'MPS' ? 1.944 : 1, spd = Math.round(+m[2] * k), gst = m[3] ? Math.round(+m[3] * k) : 0;
    return { k: 'wind', dir: m[1] === 'VRB' ? null : +m[1], spd, gst, txt: `${m[1]}/${pad2(spd)}${gst ? 'G' + gst : ''}KT`, lvl: gst >= BRF_LIM.gustAmb || spd >= BRF_LIM.gustAmb ? 'warn' : 'ok' };
  }
  if (t === 'CAVOK') return { k: 'vis', vis: 10000, cavok: true, txt: 'CAVOK', lvl: 'ok' };
  if (/^\d{4}$/.test(t)) { const v = +t; return { k: 'vis', vis: v, txt: v >= 9999 ? '10 km+' : v + 'm', lvl: BRF_CAT[brfCatV(v)][0] }; }
  if ((m = t.match(/^(P|M)?(\d+)?(?:\/(\d+))?SM$/))) { const sm = m[3] ? (+m[2] || 1) / +m[3] : +m[2]; const v = Math.round(sm * 1609); return { k: 'vis', vis: v, txt: t, lvl: BRF_CAT[brfCatV(v)][0] }; }
  if ((m = t.match(/^(FEW|SCT|BKN|OVC|VV)(\d{3}|\/\/\/)(CB|TCU|\/\/\/)?$/))) {
    const h = /\d/.test(m[2]) ? +m[2] * 100 : null, ceil = (m[1] === 'BKN' || m[1] === 'OVC' || m[1] === 'VV') ? h : null, cb = m[3] === 'CB' || m[3] === 'TCU' ? m[3] : '';
    return { k: 'cloud', cover: m[1], h, ceil, cb, txt: `${m[1]}${h != null ? ' ' + h + 'ft' : ''}${cb ? ' ' + cb : ''}`, lvl: lvlMax(BRF_CAT[brfCatC(ceil)][0], cb === 'CB' ? 'warn' : 'ok') };
  }
  if (/^(NSC|SKC|NCD|CLR|NSW)$/.test(t)) return { k: 'cloud', txt: t, lvl: 'ok' };
  if (t.length >= 2 && (m = t.match(BRF_WX_RE)) && (m[2] || m[3])) {
    const bad = /TS|FZ|GR|FC|SS|DS|VA|SQ|PL/.test(t) || /^\+SN/.test(t), warn = /SN|FG|\+|SH|GS/.test(t) && !/^VCSH$/.test(t);
    return { k: 'wx', txt: t, lvl: bad ? 'bad' : warn ? 'warn' : 'ok' };
  }
  return null;
}
// METAR: solo la parte osservata (senza intestazione, trend e remarks)
function brfMetarBody(raw) {
  const tk = raw.replace(/=/g, ' ').trim().split(/\s+/).filter(t => !/^(METAR|SPECI|COR|AUTO)$/.test(t)).slice(2), out = [];
  for (const t of tk) { if (/^(RMK|NOSIG|BECMG|TEMPO)$/.test(t)) break; out.push(t); }
  return out;
}
function brfDecode(tokens) {
  const g = { items: [], wind: null, vis: null, rvr: null, ceil: null, wx: [], cb: false };
  let visSeen = false;
  for (const t of tokens) {
    const d = brfToken(t); if (!d) continue;
    if (d.k === 'vis') { if (visSeen) continue; visSeen = true; g.vis = d.vis; if (d.cavok) g.cavok = true; }
    if (d.k === 'wind') g.wind = d;
    if (d.k === 'rvr' && (g.rvr == null || d.rvr < g.rvr)) g.rvr = d.rvr;
    if (d.k === 'cloud' && d.ceil != null && (g.ceil == null || d.ceil < g.ceil)) g.ceil = d.ceil;
    if (d.k === 'cloud' && d.cb) g.cb = d.cb;
    if (d.k === 'wx') g.wx.push(d.txt);
    g.items.push(d);
  }
  g.lvl = lvlMax(...g.items.map(i => i.lvl));
  const v = [g.vis, g.rvr].filter(x => x != null);
  g.cat = Math.max(brfCatV(v.length ? Math.min(...v) : null), brfCatC(g.ceil));
  return g;
}
// data UTC da giorno/ora relativi all'emissione del TAF
function brfDay(base, dd, hh, mi = 0) {
  const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), dd, hh, mi));
  if (dd < base.getUTCDate() - 15) d.setUTCMonth(d.getUTCMonth() + 1);
  else if (dd > base.getUTCDate() + 15) d.setUTCMonth(d.getUTCMonth() - 1);
  return d.getTime();
}
function brfTAF(raw) {
  const tk = raw.replace(/=/g, ' ').trim().split(/\s+/).filter(t => !/^(TAF|AMD|COR|RTD)$/.test(t));
  if (tk.length < 3) return null;
  const icao = tk.shift(), now = new Date();
  let issue = now;
  if (/^\d{6}Z$/.test(tk[0])) { const s = tk.shift(); issue = new Date(brfDay(now, +s.slice(0, 2), +s.slice(2, 4), +s.slice(4, 6))); }
  const span = s => { const m = s.match(/^(\d{2})(\d{2})\/(\d{2})(\d{2})$/); return m ? [brfDay(issue, +m[1], +m[2]), brfDay(issue, +m[3], +m[4])] : null; };
  const valid = span(tk[0] || ''); if (!valid) return null; tk.shift();
  const groups = [{ type: 'BASE', from: valid[0], to: valid[1], tokens: [] }];
  for (let i = 0; i < tk.length; i++) {
    const t = tk[i]; let m;
    if ((m = t.match(/^FM(\d{2})(\d{2})(\d{2})$/))) { groups.push({ type: 'FM', from: brfDay(issue, +m[1], +m[2], +m[3]), to: valid[1], tokens: [] }); continue; }
    if (/^(BECMG|TEMPO|PROB\d{2})$/.test(t)) {
      let type = t, prob = 0;
      if (t.startsWith('PROB')) { prob = +t.slice(4); type = 'PROB'; if (tk[i + 1] === 'TEMPO') { type = 'TEMPO'; i++; } }
      const sp = span(tk[i + 1] || '');
      if (sp) i++;
      groups.push({ type, prob, from: sp ? sp[0] : valid[0], to: sp ? sp[1] : valid[1], tokens: [] });
      continue;
    }
    if (/^(TX|TN)/.test(t)) continue;
    groups.at(-1).tokens.push(t);
  }
  // un gruppo FM chiude il precedente gruppo principale
  const main = groups.filter(g => g.type === 'BASE' || g.type === 'FM');
  for (let i = 0; i < main.length - 1; i++) main[i].to = main[i + 1].from;
  for (const g of groups) Object.assign(g, brfDecode(g.tokens));
  return { icao, issue: issue.getTime(), valid, groups };
}

// ---------- mappa aeroporto (OpenStreetMap)
let BRF_RWY = null;
async function brfRwyDB() { if (!BRF_RWY) { try { BRF_RWY = await (await fetch('data/runways.json')).json(); } catch { BRF_RWY = null; } } return BRF_RWY; }
function brfRunwaysOf(icao) {
  return (BRF_RWY?.[icao] || []).map(([i1, a1, o1, i2, a2, o2, len, w]) => ({ A: [a1, o1], B: [a2, o2], idA: i1, idB: i2, len, w: w || 45, brg: brfBearing([a1, o1], [a2, o2]) }));
}
async function brfMap(icao, lat, lon) {
  const c = brfRead('map:' + icao);
  if (c && Date.now() - c.t < BRF_MAP_FRESH) return c;
  const miss = brfRead('mapfail:' + icao);
  if (miss && Date.now() - miss.t < BRF_OVP_RETRY) return c;
  const q = `[out:json][timeout:20];(way["aeroway"~"^(taxiway|apron|terminal|runway)$"](around:5000,${lat},${lon}););out tags geom;`;
  for (const u of BRF_OVP) {
    try {
      const j = JSON.parse(await brfText(u + '?data=' + encodeURIComponent(q), 15000));
      const ways = (j.elements || []).filter(e => e.geometry?.length > 1).map(e => ({
        a: e.tags.aeroway, r: e.tags.ref || '', w: parseFloat(e.tags.width) || 0,
        g: e.geometry.map(p => [Math.round(p.lat * 1e5) / 1e5, Math.round(p.lon * 1e5) / 1e5])
      }));
      if (!ways.length) continue;
      brfSave('map:' + icao, ways);
      return brfRead('map:' + icao) || { t: Date.now(), v: ways };
    } catch { /* server occupato: si prova il successivo */ }
  }
  brfSave('mapfail:' + icao, 1);
  return c;
}
const brfRad = d => d * Math.PI / 180;
function brfBearing(a, b) {
  const y = Math.sin(brfRad(b[1] - a[1])) * Math.cos(brfRad(b[0])), x = Math.cos(brfRad(a[0])) * Math.sin(brfRad(b[0])) - Math.sin(brfRad(a[0])) * Math.cos(brfRad(b[0])) * Math.cos(brfRad(b[1] - a[1]));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
function brfDist(a, b) { const dy = (b[0] - a[0]) * 110540, dx = (b[1] - a[1]) * 111320 * Math.cos(brfRad((a[0] + b[0]) / 2)); return Math.hypot(dx, dy); }
// piste: due testate con designatore, prua vera, lunghezza
function brfRunways(ways, lat, lon) {
  const rws = ways.filter(w => w.a === 'runway' && w.g.length >= 2).map(w => {
    const A = w.g[0], B = w.g.at(-1), brg = brfBearing(A, B), len = Math.round(w.g.slice(1).reduce((s, p, i) => s + brfDist(w.g[i], p), 0));
    const ids = (w.r || '').split('/').map(s => s.trim()).filter(Boolean);
    const diff = (id, h) => Math.abs(((parseInt(id, 10) * 10 - h) % 360 + 540) % 360 - 180);
    const near = h => ids.length ? ids.slice().sort((x, y) => diff(x, h) - diff(y, h))[0] : String(Math.round(h / 10) || 36).padStart(2, '0');
    const idA = near(brg), idB = ids.length === 2 ? ids.find(x => x !== idA) || ids[1] : near((brg + 180) % 360);
    return { A, B, brg, len, w: w.w || 45, idA, idB, d: brfDist([lat, lon], [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2]) };
  }).filter(r => r.len > 600);
  return rws.filter(r => r.d < 4000);
}
// per ogni testata: frontale (vento medio), coda e traverso (con raffica). Con più venti (TAF + TEMPO) vale il peggiore.
function brfComp(rws, winds, cc) {
  const [xl, tl] = BRF_RWYCC[cc] || BRF_RWYCC[6];
  return rws.flatMap(rw => [[rw.idA, rw.brg], [rw.idB, (rw.brg + 180) % 360]].map(([id, h]) => {
    let hw = Infinity, tw = 0, xw = 0, side = '';
    for (const w of winds) {
      const g = Math.max(w.spd, w.gst || 0);
      if (w.dir == null) { hw = Math.min(hw, 0); tw = Math.max(tw, g); if (g >= xw) { xw = g; side = ''; } continue; }
      const a = brfRad(w.dir - h), c = Math.cos(a), sn = Math.sin(a);
      hw = Math.min(hw, Math.round(w.spd * c));
      if (c < 0) tw = Math.max(tw, Math.round(-g * c));
      const x = Math.round(Math.abs(g * sn)); if (x >= xw) { xw = x; side = x ? (sn > 0 ? 'R' : 'L') : ''; }
    }
    hw = hw === Infinity ? 0 : Math.max(hw, 0);
    const lt = brfLimLvl(tw, tl), lx = brfLimLvl(xw, xl);
    return { id, rw, hw, tw, xw, side, lt, lx, lvl: lvlMax(lt, lx), len: rw.len };
  }));
}
// direzione magnetica 001-360 da una vera e dalla variazione (E positiva)
const brfMag = (tru, mv) => { const m = Math.round(((tru - mv) % 360 + 360) % 360); return m === 0 ? 360 : m; };
function brfMapSVG(rws, ways, lat, lon, wind, comps = [], mv = null) {
  if (!rws.length) return '<div class="brf-map-empty">No runway data for this airport.</div>';
  const P = p => [(p[1] - lon) * 111320 * Math.cos(brfRad(lat)), -(p[0] - lat) * 110540];
  const pts = rws.flatMap(r => [P(r.A), P(r.B)]);
  let x0 = Math.min(...pts.map(p => p[0])), x1 = Math.max(...pts.map(p => p[0])), y0 = Math.min(...pts.map(p => p[1])), y1 = Math.max(...pts.map(p => p[1]));
  const pad = Math.max(comps.length ? 900 : 450, Math.max(x1 - x0, y1 - y0) * (comps.length ? 0.34 : 0.14)); x0 -= pad; x1 += pad; y0 -= pad; y1 += pad;
  // proporzioni fisse 4:3
  const W = x1 - x0, H = y1 - y0, want = 4 / 3;
  if (W / H < want) { const d = (H * want - W) / 2; x0 -= d; x1 += d; } else { const d = (W / want - H) / 2; y0 -= d; y1 += d; }
  const VW = x1 - x0, VH = y1 - y0, u = VW / 400;   // u = un "pixel" su 400 di larghezza
  const inBox = w => w.g.some(p => { const [x, y] = P(p); return x > x0 - pad && x < x1 + pad && y > y0 - pad && y < y1 + pad; });
  const path = g => g.map((p, i) => { const [x, y] = P(p); return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`; }).join('');
  const shown = ways.filter(inBox);
  const aprons = shown.filter(w => w.a === 'apron').map(w => `<path d="${path(w.g)}Z" class="ap"/>`).join('');
  const terms = shown.filter(w => w.a === 'terminal').map(w => `<path d="${path(w.g)}Z" class="te"/>`).join('');
  const twys = shown.filter(w => w.a === 'taxiway').map(w => `<path d="${path(w.g)}" class="tw" stroke-width="${Math.max(2 * u, w.w || 18)}"/>`).join('');
  // un'etichetta per sigla di taxiway, sul tratto più lungo
  const twRef = {};
  for (const w of shown.filter(w => w.a === 'taxiway' && /^[A-Z]{1,2}\d{0,2}$/.test(w.r))) { const len = w.g.slice(1).reduce((s, p, i) => s + brfDist(w.g[i], p), 0); if (!twRef[w.r] || len > twRef[w.r].len) twRef[w.r] = { len, p: P(w.g[Math.floor(w.g.length / 2)]) }; }
  const twLab = Object.entries(twRef).filter(([, v]) => v.len > 150).map(([r, v]) => `<g class="twl" transform="translate(${v.p[0].toFixed(0)},${v.p[1].toFixed(0)})"><rect x="${-7 * u - (r.length - 1) * 3 * u}" y="${-7 * u}" width="${14 * u + (r.length - 1) * 6 * u}" height="${14 * u}" rx="${2 * u}"/><text y="${4 * u}" font-size="${10 * u}">${esc(r)}</text></g>`).join('');
  const runways = rws.map(r => `<path d="${path([r.A, r.B])}" class="rw" stroke-width="${Math.max(5 * u, r.w)}"/><path d="${path([r.A, r.B])}" class="rwc" stroke-width="${0.8 * u}" stroke-dasharray="${6 * u} ${5 * u}"/>`).join('');
  const cx0 = (x0 + x1) / 2, cy0 = (y0 + y1) / 2;   // i riquadri vanno verso il centro della mappa
  const rwLab = rws.flatMap(r => {
    const a = P(r.A), b = P(r.B), L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L, off = 22 * u;
    // riquadro delle componenti accanto al numero di pista, spostato di lato rispetto all'asse
    const box = (id, x, y) => {
      const c = comps.find(k => k.id === id && k.rw === r); if (!c) return '';
      const sg = (-uy) * (cx0 - x) + ux * (cy0 - y) >= 0 ? 1 : -1, px = -uy * sg, py = ux * sg, w = 50 * u, hh = 28 * u, dd = 17 * u + Math.abs(px) * w / 2 + Math.abs(py) * hh / 2, bx = x + px * dd, by = y + py * dd;
      return `<g class="cmp ${c.lvl}" transform="translate(${bx.toFixed(0)},${by.toFixed(0)})"><rect x="${-w / 2}" y="${-hh / 2}" width="${w}" height="${hh}" rx="${3 * u}"/>`
        + `<text y="${-2.5 * u}" font-size="${9.5 * u}" class="${c.tw ? c.lt : ''}">${c.tw ? 'TW ' + c.tw : 'HW ' + c.hw}</text><text y="${9 * u}" font-size="${9.5 * u}" class="${c.lx}">XW ${c.xw}${c.side}</text></g>`;
    };
    return [[r.idA, a[0] - ux * off, a[1] - uy * off], [r.idB, b[0] + ux * off, b[1] + uy * off]]
      .map(([id, x, y]) => `<g class="rwl" transform="translate(${x.toFixed(0)},${y.toFixed(0)})"><circle r="${13 * u}"/><text y="${4.5 * u}" font-size="${12 * u}">${esc(id)}</text></g>${box(id, x, y)}`);
  }).join('');
  // scala
  const sc = [250, 500, 1000, 2000].find(m => m / VW * 400 >= 55) || 2000;
  const scale = `<g class="scl" transform="translate(${x0 + 14 * u},${y1 - 14 * u})"><path d="M0,0H${sc}" stroke-width="${2 * u}"/><text y="${-6 * u}" font-size="${10 * u}">${sc >= 1000 ? sc / 1000 + ' km' : sc + ' m'}</text></g>`;
  const north = `<g class="nrt" transform="translate(${x1 - 18 * u},${y0 + 22 * u})"><path d="M0,${-12 * u}L${6 * u},${8 * u}L0,${3 * u}L${-6 * u},${8 * u}Z"/><text y="${20 * u}" font-size="${9 * u}">N</text>${mv == null ? '' : `<text class="var" x="${8 * u}" y="${31 * u}" font-size="${8.5 * u}">VAR ${magVarTxt(mv)}</text>`}</g>`;
  // freccia del vento: la coda indica da dove viene, la punta dove va
  let wnd = '';
  if (wind) {
    const cx = x1 - 50 * u, cy = y0 + 70 * u;
    const arrow = wind.dir == null ? '' : `<g transform="rotate(${wind.dir})"><path d="M0,${-16 * u}V${16 * u}" stroke-width="${2.5 * u}"/><path d="M${-6 * u},${8 * u}L0,${17 * u}L${6 * u},${8 * u}" stroke-width="${2.5 * u}" fill="none"/></g>`;
    // la mappa è orientata al nord vero, quindi la freccia resta vera; l'etichetta è in magnetico, come la dà la torre
    const txt = wind.dir == null || mv == null ? wind.txt : wind.txt.replace(/^\d{3}/, String(brfMag(wind.dir, mv)).padStart(3, '0') + '°M');
    wnd = `<g class="wnd ${wind.lvl}" transform="translate(${cx},${cy})">${arrow}<text y="${34 * u}" font-size="${10.5 * u}">${esc(txt)}</text></g>`;
  }
  return `<svg class="brf-svg" viewBox="${x0.toFixed(0)} ${y0.toFixed(0)} ${VW.toFixed(0)} ${VH.toFixed(0)}" role="img" aria-label="Airport diagram">${aprons}${terms}${twys}${runways}${twLab}${rwLab}${scale}${north}${wnd}</svg>`;
}

// ---------- pagina
const brfT = ms => { const d = new Date(ms); return `${pad2(d.getUTCDate())}/${pad2(d.getUTCHours())}Z`; };
const brfHM = ms => { const d = new Date(ms); return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}Z`; };
const brfAge = ms => { const m = Math.round((Date.now() - ms) / 60e3); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 2880 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' days ago'; };
// #briefing/2026-11-10_LIPE.0630-HEMA.1035
function brfParse(arg) {
  const [date, legs] = String(arg || '').split('_');
  const list = (legs || date || '').split('-').map(s => { const [c, t] = s.split('.'); return { icao: (c || '').toUpperCase(), hhmm: /^\d{4}$/.test(t || '') ? t : '' }; }).filter(x => /^[A-Z0-9]{3,4}$/.test(x.icao));
  const d0 = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
  let base = d0 ? Date.parse(d0 + 'T00:00:00Z') : null, prev = -1;
  for (const x of list) {
    if (base == null || !x.hhmm) { x.at = null; continue; }
    const m = +x.hhmm.slice(0, 2) * 60 + +x.hhmm.slice(2);
    if (m < prev) base += 864e5;
    prev = m; x.at = base + m * 60e3;
  }
  list.forEach((x, i) => { x.role = i === 0 ? 'DEP' : i === list.length - 1 ? 'ARR' : 'STOP'; });
  return { date: d0, list };
}
function brfHash(date, pts) { return 'briefing/' + (date ? date + '_' : '') + pts.filter(p => p.icao).map(p => p.icao + (p.hhmm ? '.' + p.hhmm : '')).join('-'); }
let brfIata = null;
function brfIataOf(icao) {
  if (typeof IATA === 'undefined' || !IATA) return '';
  if (!brfIata) { brfIata = {}; for (const [k, v] of Object.entries(IATA)) if (!brfIata[v]) brfIata[v] = k; }
  return brfIata[icao] || '';
}
function brfCard(p, wx, mapRec, ccSel) {
  const a = APT?.[p.icao];
  const ref = p.at || Date.now(), refLab = p.at ? (p.role === 'DEP' ? 'ETD' : 'ETA') + ' ' + brfHM(p.at) : 'now';
  const metRaw = wx?.v?.metar || '', tafRaw = wx?.v?.taf || '';
  const met = metRaw ? brfDecode(brfMetarBody(metRaw)) : null;
  const taf = tafRaw ? brfTAF(tafRaw) : null;
  // gruppi del TAF attivi all'orario di riferimento (±1 h)
  const near = g => g.from < ref + 3600e3 && g.to > ref - 3600e3;
  const active = taf ? taf.groups.filter(near) : [];
  const metNear = met && Math.abs(ref - Date.now()) < 3 * 3600e3;
  const pool = [...(metNear ? [met] : []), ...active];
  // avvisi sintetici
  const alerts = [];
  // categoria di avvicinamento richiesta da visibilità/RVR e ceiling
  const worst = pool.slice().sort((x, y) => y.cat - x.cat)[0];
  if (worst && worst.cat > 0) {
    const vv = pool.flatMap(g => [g.vis, g.rvr]).filter(x => x != null), cc0 = pool.map(g => g.ceil).filter(x => x != null);
    alerts.push([BRF_CAT[worst.cat][0], 'Approach', `${BRF_CAT[worst.cat][1]}${vv.length ? ' · vis/RVR ' + Math.min(...vv) + ' m' : ''}${cc0.length ? ' · ceiling ' + Math.min(...cc0) + ' ft' : ''}`]);
  }
  const wxs = [...new Set(pool.flatMap(g => g.items.filter(i => i.k === 'wx' && i.lvl !== 'ok').map(i => i.txt)))];
  for (const w of wxs.slice(0, 3)) alerts.push([pool.flatMap(g => g.items).find(i => i.txt === w).lvl, BRF_WX_NAME.find(([k]) => w.includes(k))?.[1] || 'Weather', w]);
  if (pool.some(g => g.cb)) alerts.push(['warn', 'Convective', pool.find(g => g.cb).cb]);
  // vento per le piste: METAR se l'orario è vicino, altrimenti TAF (gruppo prevalente + TEMPO/PROB attivi, vale il peggiore)
  const ways = mapRec?.v || [];
  let rws = brfRunwaysOf(p.icao);
  if (!rws.length && a && ways.length) rws = brfRunways(ways, a[0], a[1]);
  let winds = [], wSrc = '';
  if (metNear && met.wind) { winds = [met.wind]; wSrc = 'METAR'; }
  else if (taf) {
    const mainW = taf.groups.filter(g => g.wind && (g.type === 'BASE' || g.type === 'FM' || g.type === 'BECMG') && g.from <= ref).at(-1)?.wind;
    const temp = active.filter(g => g.wind && (g.type === 'TEMPO' || g.type === 'PROB')).map(g => g.wind);
    winds = [mainW, ...temp].filter(Boolean); wSrc = 'TAF' + (temp.length ? ' incl. TEMPO/PROB' : '');
  }
  // condizione pista: scelta dal pilota, altrimenti 5 (wet) se ci sono precipitazioni, 6 (dry) se no
  const wet = pool.some(g => g.items.some(i => i.k === 'wx' && !/^VC/.test(i.txt) && /(RA|DZ|SN|SG|PL|GS|GR|UP)/.test(i.txt)));
  const cc = ccSel || (wet ? 5 : 6), [xl, tl, ccTxt] = BRF_RWYCC[cc];
  const comps = winds.length ? brfComp(rws, winds, cc) : [];
  // la testata più favorevole: se anche quella è vicina ai limiti, va segnalato
  const best = comps.slice().sort((x, y) => (BRF_RANK[x.lvl] - BRF_RANK[y.lvl]) || (y.hw - x.hw) || (x.tw - y.tw))[0];
  if (best && best.lvl !== 'ok') alerts.push([best.lvl, best.lt !== 'ok' && BRF_RANK[best.lt] >= BRF_RANK[best.lx] ? 'Tailwind' : 'Crosswind', `best RWY ${best.id}: ${best.tw ? 'TW ' + best.tw + '/' + tl : 'HW ' + best.hw} · XW ${best.xw}/${xl} kt`]);
  // orario fuori dal periodo di validità del TAF: va detto chiaramente
  if (taf && p.at && (p.at < taf.valid[0] || p.at > taf.valid[1])) alerts.unshift(['warn', 'TAF', `${p.role === 'DEP' ? 'ETD' : 'ETA'} outside validity (${brfT(taf.valid[0])}–${brfT(taf.valid[1])})`]);
  if (!taf && p.at) alerts.unshift(['warn', 'TAF', 'not available']);

  const tok = t => { const d = brfToken(t); return d && d.lvl !== 'ok' ? `<u class="${d.lvl}">${esc(t)}</u>` : esc(t); };
  const tafRow = g => {
    const lab = g.type === 'BASE' ? '' : g.type === 'FM' ? 'FM' : g.type === 'PROB' ? 'PROB' + g.prob : (g.prob ? 'PROB' + g.prob + ' ' : '') + g.type;
    const cur = g.from <= ref && g.to > ref;
    const items = g.items.map(i => `<span class="${i.lvl !== 'ok' ? 'u ' + i.lvl : ''}">${esc(i.txt)}</span>`).join(' ');
    return `<li class="${cur ? 'cur' : ''} ${near(g) ? '' : 'far'}"><i class="dot ${g.lvl}"></i><span class="per">${brfT(g.from)}–${brfT(g.to)}</span>${lab ? `<b>${lab}</b>` : ''} ${items || '<span class="muted">no change</span>'}${cur ? ` <em>${p.at ? (p.role === 'DEP' ? 'ETD' : 'ETA') : 'NOW'}</em>` : ''}</li>`;
  };
  const mv = a && typeof magVar === 'function' ? magVar(a[0], a[1], ref) : null;   // variazione WMM2025
  const map = !a ? '<div class="brf-map-empty">Airport not in the database.</div>'
    : brfMapSVG(rws, ways, a[0], a[1], winds[0] || null, comps, mv);
  const metAge = metRaw ? (() => { const m = metRaw.match(/\b(\d{2})(\d{2})(\d{2})Z\b/); return m ? brfDay(new Date(), +m[1], +m[2], +m[3]) : null; })() : null;
  return `<section class="brf-card">
    <header><b>${esc(p.icao)}</b><span>${esc(brfIataOf(p.icao))}</span><span class="nm">${esc(a?.[2] || '')}</span><em>${p.role}${p.at ? ' · ' + (p.role === 'DEP' ? 'ETD ' : 'ETA ') + brfHM(p.at) : ''}</em></header>
    <div class="brf-map">${map}</div>
    ${alerts.length ? `<div class="brf-alerts">${alerts.map(([l, k, v]) => `<span class="${l}"><b>${esc(k)}</b> ${esc(v)}</span>`).join('')}</div>` : (pool.length ? '<div class="brf-alerts"><span class="ok"><b>No weather alerts</b> around ' + esc(refLab) + '</span></div>' : '')}
    <div class="brf-rw">
      <div class="brf-cc"><span>RWYCC</span>${[6, 5, 4, 3, 2].map(n => `<button type="button" data-cc="${esc(p.icao)}:${n}" class="${n === cc ? 'on' : ''}">${n}</button>`).join('')}<small>${esc(ccTxt)} · limits B737-800/-8 XW ${xl} · TW ${tl} kt${ccSel ? '' : ' · auto'}</small></div>
      ${comps.length ? `<div class="brf-cmp">${comps.map(c => `<span class="${c.lvl}">RWY <b>${esc(c.id)}</b> ${c.tw ? `<i class="${c.lt}">TW ${c.tw}</i>` : 'HW ' + c.hw} · <i class="${c.lx}">XW ${c.xw}${c.side}</i></span>`).join('')}</div>
      <small class="muted">Wind ${esc(winds.map(w => w.txt).join(', '))} from ${wSrc}, true direction${mv == null ? '' : ` (on the map in magnetic, VAR ${magVarTxt(mv)})`}. Crosswind and tailwind with gusts; yellow from 80% of the limit, red above it.</small>` : `<small class="muted">${rws.length ? 'No wind available for the runway components.' : ''}</small>`}
    </div>
    <div class="brf-sec"><h4>METAR ${metAge ? `<small>${brfHM(metAge)} · ${brfAge(metAge)}</small>` : ''}</h4>
      ${metRaw ? `<p class="mono ${metAge && Date.now() - metAge > 3 * 3600e3 ? 'old' : ''}">${metRaw.trim().split(/\s+/).map(tok).join(' ')}</p>` : '<p class="muted">No METAR available.</p>'}</div>
    <div class="brf-sec"><h4>TAF ${taf ? `<small>issued ${brfHM(taf.issue)}</small>` : ''}</h4>
      ${taf ? `<ul class="brf-taf">${taf.groups.map(tafRow).join('')}</ul><details><summary>raw</summary><p class="mono">${esc(tafRaw)}</p></details>` : tafRaw ? `<p class="mono">${esc(tafRaw)}</p>` : '<p class="muted">No TAF available.</p>'}</div>
  </section>`;
}
// legenda dei colori e minime di compagnia modificabili
function brfMinsHTML() {
  const M = brfMins(), f = (k, u) => `<label><input data-min="${k}" type="number" inputmode="numeric" min="0" value="${M[k]}"><small>${u}</small></label>`;
  return `<div class="brf-legend">${BRF_CAT.map(([c, t]) => `<span class="${c}"><i></i>${t}</span>`).join('')}</div>
  <details class="brf-lim"><summary>Approach minima used for the colours</summary>
    <div class="brf-lim-g">
      <b>CAT I</b>${f('c1v', 'RVR m')}${f('c1d', 'DH ft')}
      <b>CAT II</b>${f('c2v', 'RVR m')}${f('c2d', 'DH ft')}
      <b>CAT IIIA · fail passive</b>${f('c3av', 'RVR m')}${f('c3ad', 'DH ft')}
      <b>CAT IIIB · fail operational</b>${f('c3bv', 'RVR m')}<span></span>
    </div>
    <p class="hint">Defaults are the standard EASA values: set them as in the OM-A. Visibility or RVR (the lower) and ceiling (BKN, OVC, VV) give the category. <button type="button" class="btn small" data-min-reset>Reset</button></p>
  </details>`;
}
async function viewBriefing(main, arg) {
  const q = brfParse(arg);
  if (!q.list.length) { main.innerHTML = '<h1>Briefing</h1><p class="lede">No airports given. Open the briefing from a flight or from Next days.</p>'; return; }
  try { await Promise.all([loadAirports(), brfRwyDB()]); } catch { /* senza database aeroporti solo meteo */ }
  if (typeof IATA !== 'undefined' && !IATA) { try { IATA = await (await fetch('data/iata.json')).json(); } catch { /* niente IATA */ } }
  const icaos = [...new Set(q.list.map(p => p.icao))];
  const seen = new Set(), cards = q.list.filter(p => !seen.has(p.icao + p.role) && seen.add(p.icao + p.role));
  const my = viewBriefing.seq = (viewBriefing.seq || 0) + 1;
  const alive = () => my === viewBriefing.seq && location.hash.startsWith('#briefing');
  let status = '';
  const ccSel = {};
  let routeNode;
  // volo concluso (un'ora dopo l'arrivo, o data passata da più di un giorno): niente download, si vede quello che è salvato
  const lastAt = q.list.at(-1)?.at;
  let done = lastAt ? Date.now() > lastAt + 3600e3 : !!(q.date && Date.parse(q.date + 'T00:00:00Z') + 2 * 864e5 < Date.now());
  const draw = () => {
    if (!alive()) return;
    const wx = Object.fromEntries(icaos.map(c => [c, brfRead('wx:' + c)]));
    const oldest = Math.min(...icaos.map(c => wx[c]?.t || 0));
    main.innerHTML = `<div class="brf-head"><div><h1>Briefing</h1><p class="lede">${q.date ? dmy(q.date) + ' · ' : ''}${esc(q.list.map(p => p.icao).join(' → '))}</p></div>
      <div class="brf-upd"><button type="button" class="btn small" id="brfBack">← Back</button><span id="brfStatus">${status || (oldest ? 'Updated ' + brfAge(oldest) : '')}</span><button type="button" class="btn small" id="brfRefresh">Refresh</button></div></div>
      <div class="brf-grid">${cards.map(p => { try { return brfCard(p, wx[p.icao], brfRead('map:' + p.icao), ccSel[p.icao]); } catch (e) { console.error(e); return `<section class="brf-card"><header><b>${esc(p.icao)}</b></header><p class="muted brf-sec">Could not show this airport (${esc(e.message)}).</p></section>`; } }).join('')}</div>
      <div id="brfRouteSlot"></div>
      <p class="hint">Weather: MET Norway (api.met.no), METAR backup from VATSIM. Runways: OurAirports; taxiways and aprons: © OpenStreetMap contributors. Not for navigation. For awareness only: the official briefing package is the reference.</p>
      ${brfMinsHTML()}`;
    $('#brfRefresh', main).onclick = () => { if (done) { done = false; routeNode = undefined; } load(true); };
    // mappa di rotta: costruita una volta sola e rimessa al suo posto a ogni ridisegno
    const slot = $('#brfRouteSlot', main);
    if (slot && done) slot.innerHTML = '<p class="hint">Route weather not loaded: the flight is completed. Refresh downloads current data.</p>';
    else if (slot && typeof brfRouteNode === 'function') {
      if (routeNode === undefined) {
        const legs = q.list.map(p => ({ icao: p.icao, at: p.at, lat: APT?.[p.icao]?.[0], lon: APT?.[p.icao]?.[1] })).filter(l => isFinite(l.lat) && isFinite(l.lon));
        try { routeNode = legs.length >= 2 ? brfRouteNode(legs) : null; } catch (e) { console.error(e); routeNode = null; }
      }
      if (routeNode) slot.replaceWith(routeNode);
    }
    main.querySelectorAll('[data-cc]').forEach(b => b.onclick = () => { const [c, n] = b.dataset.cc.split(':'); ccSel[c] = +n; draw(); });
    main.querySelectorAll('[data-min]').forEach(inp => inp.onchange = () => {
      const m = { ...brfMins() }, v = parseInt(inp.value, 10); if (isFinite(v) && v >= 0) m[inp.dataset.min] = v;
      try { localStorage.setItem('brf:mins', JSON.stringify(m)); } catch { /* resta per questa sessione */ }
      brfMinsC = m; draw(); const d = main.querySelector('.brf-lim'); if (d) d.open = true;
    });
    const rs = main.querySelector('[data-min-reset]'); if (rs) rs.onclick = () => { try { localStorage.removeItem('brf:mins'); } catch { /* niente */ } brfMinsC = null; draw(); const d = main.querySelector('.brf-lim'); if (d) d.open = true; };
    $('#brfBack', main).onclick = () => { if (history.length > 1) history.back(); else location.hash = 'riepilogo'; };
  };
  const load = async force => {
    status = navigator.onLine ? 'Updating…' : 'Offline · saved data'; draw();
    const r = await brfWeather(icaos, force).catch(e => ({ err: e }));
    status = r.err ? (navigator.onLine ? 'Weather not reachable · saved data' : 'Offline · saved data') : ''; draw();
    for (const p of cards) {
      const a = APT?.[p.icao]; if (!a) continue;
      const mc = brfRead('map:' + p.icao);
      if (mc && Date.now() - mc.t < BRF_MAP_FRESH) continue;
      try { await brfMap(p.icao, a[0], a[1]); } catch (e) { console.warn('map', p.icao, e); }
      draw();
    }
  };
  if (done) { status = 'Flight completed · weather not updated'; draw(); } else { draw(); load(false); }
}
