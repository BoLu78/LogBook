'use strict';
const APP_VERSION = '2.3.1';
const APP_DATE = '26/10/2026';
/* Logbook – PWA locale. Tutti i dati restano nel browser (IndexedDB) e nella cartella di backup scelta. */

// ---------- utilità ----------
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hm = m => { m = Math.round(m || 0); if (!m) return ''; const s = m < 0 ? '-' : ''; m = Math.abs(m); return `${s}${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };
const hm0 = m => hm(m) || '0:00';
const avg = s => s.legs ? hm(Math.round(s.total / s.legs)) : '';
const parseHM = s => { s = String(s || '').trim().replace('.', ':'); if (!s) return 0; const m = s.match(/^(\d{1,5})(?::(\d{1,2}))?$/); if (!m) return NaN; return +m[1] * 60 + (+m[2] || 0); };
const toMin = t => { const m = String(t || '').match(/^(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : null; };
const today = () => new Date().toISOString().slice(0, 10);
const dmy = d => d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)}` : '';
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const num = v => { const n = parseInt(v, 10); return n > 0 ? n : 0; };
const toast = msg => { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2600); };

// Nomi dei tipi nell'ordine della carriera
const TYPE_ORDER = ['Do328-110', 'P180 Avanti 1', 'P180 Avanti 2', 'B747-400', 'B747-8', 'B787-9', 'B737-800', 'B737-8'];
const AVANTI1 = new Set(['I-FXRB', 'I-FXRC', 'I-FXRD', 'I-FXRE']);
const TYPE_ALIAS = { D328: 'Do328-110', B744: 'B747-400', B748: 'B747-8', B789: 'B787-9', B738: 'B737-800', B38M: 'B737-8' };
// correzioni dei codici aeroporto indicate da Luca (applicate una volta, poi sincronizzate)
const CODE_FIX = { LZSZ: 'LSZS', LZSB: 'LSZB', DZNT: 'DTNH' };
function normalizeTypes(d) {
  let n = 0;
  for (const f of d?.flights || []) {
    if (f.kind !== 'flight') continue;
    let ch = false;
    for (const k of ['dep', 'arr']) if (CODE_FIX[f[k]]) { f[k] = CODE_FIX[f[k]]; ch = true; }
    if (ch) { f.mt = Date.now(); n++; }
  }
  for (const f of d?.flights || []) {
    if (f.kind !== 'flight') continue;
    let t = f.type || KNOWN_AIRCRAFT[f.reg] || '';
    if (f.reg === 'I-SWIA' || f.reg === 'I-SWIB') t = 'B747-400';
    else if (t === 'P180') t = AVANTI1.has(f.reg) ? 'P180 Avanti 1' : 'P180 Avanti 2';
    else if (TYPE_ALIAS[t]) t = TYPE_ALIAS[t];
    if (t !== f.type) { f.type = t; n++; }
  }
  // sessioni al simulatore: nome come nella lista FlightLog, tipo ricavato dalle note o dalla flotta del periodo
  const fls = (d?.flights || []).filter(f => f.kind === 'flight' && f.type).sort((a, b) => a.date.localeCompare(b.date));
  const near = date => { let lo = 0, hi = fls.length - 1, best = null; while (lo <= hi) { const m = (lo + hi) >> 1; if (fls[m].date <= date) { best = fls[m]; lo = m + 1; } else hi = m - 1; } return (fls.find(x => x.date >= date) || best)?.type || ''; };
  for (const f of d?.flights || []) {
    if (f.kind !== 'sim' || f.simChecked) continue;
    const old = f.simType;
    const name = simName(f, near(f.date));
    // nell'Excel il campo a volte conteneva il nome dell'istruttore
    const isPerson = old && !/sim|ffs|ftd|lpc|opc|occ|747|737|787|p180|avanti|b7|zftt|skill|refresh|recency|test|\brt\b/i.test(old);
    if (/^self$/i.test(old)) { /* nulla da tenere */ } else if (isPerson && !f.picName) f.picName = old;
    const same = old && old.replace(/\s+/g, ' ').replace(/- (\d)/g, '-$1').replace(/^FFS /i, '').trim().toLowerCase() === name.toLowerCase();
    if (old && !same && !/^self$/i.test(old) && !isPerson && !f.remarks.includes(old)) f.remarks = f.remarks ? `${old} / ${f.remarks}` : old;
    f.simType = name; f.simChecked = 1; n++;
  }
  return n;
}
// Flotta conosciuta (dalla lista aerei di FlightLog): marca -> modello
const KNOWN_AIRCRAFT = {"4K-BBH": "B747-8", "4K-BCH": "B747-400", "4K-BCI": "B747-400", "4K-BCR": "B747-400", "4K-BCV": "B747-400", "4K-SW008": "B747-400", "4K-SW800": "B747-400", "4K-SW888": "B747-400", "EI-HIL": "B737-800", "EI-HIM": "B737-800", "EI-NEO": "B787-9", "EI-NEU": "B787-9", "EI-NEW": "B787-9", "EI-NUA": "B787-9", "EI-NYE": "B787-9", "EI-RZA": "B737-8", "EI-RZB": "B737-8", "EI-RZC": "B737-8", "EI-RZD": "B737-8", "EI-RZE": "B737-8", "EI-RZF": "B737-8", "EI-RZG": "B737-8", "EI-RZH": "B737-8", "EI-XIN": "B787-9", "I-FXRB": "P180 Avanti 1", "I-FXRC": "P180 Avanti 1", "I-FXRD": "P180 Avanti 1", "I-FXRE": "P180 Avanti 1", "I-FXRG": "P180 Avanti 2", "I-FXRH": "P180 Avanti 2", "I-FXRI": "P180 Avanti 2", "I-FXRJ": "P180 Avanti 2", "I-FXRK": "P180 Avanti 2", "I-FXRL": "P180 Avanti 2", "I-NEOU": "B737-800", "I-NEOZ": "B737-800", "I-SWIA": "B747-400", "I-SWIB": "B747-400", "OE-IFB": "B747-400", "OE-IFD": "B747-400", "OE-IFK": "B747-400", "OE-IFM": "B747-400", "OE-ILC": "B747-400", "VP-BYK": "B747-400", "VQ-BBM": "B747-8", "VQ-BVB": "B747-8", "VQ-BVC": "B747-8", "VQ-BWL": "B747-400", "VQ-BWM": "B747-400", "VQ-BWT": "B747-400", "VQBWS": "B747-400"};
// Simulatori dalla lista aerei di FlightLog: sigla -> nome
const SIM_DEVICES = { 'B787/B777 FSTD NL-787': 'Boeing 787-9[3]', 'DE-1A-113': 'Boeing 787-9[3]', 'DE1A-049': 'BOEING 747-400',
  'EU-A0244': 'BOEING 787-9 Dreamliner', 'EU-A0250': 'BOEING 787-9 Dreamliner', 'EU-UKFB607': 'BOEING 787-9 Dreamliner', 'EU-UKFB637': 'BOEING 787-9 Dreamliner',
  'I-T.081': 'BOEING 737-800', 'LT.FSTD.18': 'BOEING 737-800', 'SIM B747': 'BOEING 747-400', 'SIM B748': 'BOEING 747-8',
  'SIM B787/B777 NL-787': 'BOEING 787-9 Dreamliner', 'SIM LU002 B744': 'BOEING 747-400', 'SIM LU003 B748': 'BOEING 747-8' };
const KNOWN_SIMS = ['BOEING 737-800', 'BOEING 787-9 Dreamliner', 'Boeing 787-9[3]', 'BOEING 747-8', 'BOEING 747-400', 'P180 Avanti'];
const SIM_BY_FAMILY = { 'Piaggio P180': 'P180 Avanti', 'Boeing 747': 'BOEING 747-400', 'Boeing 787': 'BOEING 787-9 Dreamliner', 'Boeing 737': 'BOEING 737-800' };
function simName(f, nearType) {
  const raw = (f.simType || '').replace(/\s+/g, ' ').replace(/- (\d)/g, '-$1').replace(/^FFS /i, '').trim();
  const hit = KNOWN_SIMS.find(n => n.toLowerCase() === raw.toLowerCase()); if (hit) return hit;
  const txt = `${f.simType} ${f.remarks}`;
  if (/747-?8|B748|conversion -8/i.test(txt)) return 'BOEING 747-8';
  if (/737|B738|B38M/i.test(txt)) return 'BOEING 737-800';
  if (/787|B789|B777/i.test(txt)) return 'BOEING 787-9 Dreamliner';
  if (/747|B744/i.test(txt)) return 'BOEING 747-400';
  if (/P180|avanti/i.test(txt)) return 'P180 Avanti';
  return SIM_BY_FAMILY[familyOf(nearType)] || '';
}
const FAMILY = { 'Do328-110': 'Dornier 328', 'P180 Avanti 1': 'Piaggio P180', 'P180 Avanti 2': 'Piaggio P180', 'B747-400': 'Boeing 747', 'B747-8': 'Boeing 747', 'B787-9': 'Boeing 787', 'B737-800': 'Boeing 737', 'B737-8': 'Boeing 737' };
const familyOf = t => FAMILY[t] || t || '—';
const typeRank = t => { const i = TYPE_ORDER.indexOf(t); return i < 0 ? 99 : i; };
const SUM_KEYS = ['total', 'spSe', 'spMe', 'mp', 'night', 'ifr', 'pic', 'sic', 'dual', 'instr', 'sim', 'toDay', 'toNight', 'ldgDay', 'ldgNight'];
const EMPTY = () => ({ id: '', date: '', kind: 'flight', dep: '', arr: '', out: '', inn: '', type: '', reg: '', spSe: 0, spMe: 0, mp: 0, total: 0, picName: '', toDay: 0, toNight: 0, ldgDay: 0, ldgNight: 0, night: 0, ifr: 0, pic: 0, sic: 0, dual: 0, instr: 0, simType: '', sim: 0, remarks: '', src: 'app' });

// ---------- archivio locale (IndexedDB) ----------
const idb = {
  db: null,
  open() {
    return this.db || (this.db = new Promise((res, rej) => {
      const r = indexedDB.open('logbook', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    }));
  },
  async get(k) { const db = await this.open(); return new Promise((res, rej) => { const r = db.transaction('kv').objectStore('kv').get(k); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
  async set(k, v) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error); }); }
};

let data = null;           // { version, pilot, opening, flights }
let dirHandle = null;      // cartella di backup
let backupOk = false, lastBackup = null;

function sortFlights() { data.flights.sort((a, b) => (a.date + (a.out || '99:99')).localeCompare(b.date + (b.out || '99:99'))); }
// id unici anche tra dispositivi diversi (Mac, iPhone, iPad)
function nextId() { return 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

async function save(msg) {
  sortFlights();
  data.updated = new Date().toISOString();
  await idb.set('data', data);
  if (msg) toast(msg);
  scheduleBackup();
  scheduleSync();
}

// ---------- backup su cartella (File System Access API, Chrome) ----------
const fsSupported = 'showDirectoryPicker' in window;
let backupTimer;
function scheduleBackup() { clearTimeout(backupTimer); backupTimer = setTimeout(writeBackup, 800); }

async function writeFile(dir, name, text) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable(); await w.write(text); await w.close();
}
async function writeBackup() {
  if (!dirHandle || !data) return renderBackupState();
  try {
    if ((await dirHandle.queryPermission({ mode: 'readwrite' })) !== 'granted') { backupOk = false; return renderBackupState(); }
    const text = JSON.stringify(data);
    await writeFile(dirHandle, 'logbook.json', text);
    const hist = await dirHandle.getDirectoryHandle('storico', { create: true });
    await writeFile(hist, `logbook-${today()}.json`, text);
    backupOk = true; lastBackup = new Date();
  } catch (e) { backupOk = false; console.error(e); toast('Backup non riuscito: ' + e.message); }
  renderBackupState();
}
async function chooseFolder() {
  if (!fsSupported) { toast('Il backup su cartella funziona in Chrome. Usa Esporta nel frattempo.'); return; }
  try {
    const h = await window.showDirectoryPicker({ id: 'logbook-backup', mode: 'readwrite', startIn: 'documents' });
    dirHandle = h; await idb.set('dir', h);
    // se la cartella contiene già un logbook e l'app è vuota, lo carico
    let existing = null;
    try { const fh = await h.getFileHandle('logbook.json'); existing = JSON.parse(await (await fh.getFile()).text()); } catch { /* nessun file */ }
    if (existing && existing.flights) {
      const useIt = !data || !data.flights.length ||
        (existing.updated && data.updated && existing.updated > data.updated &&
         confirm(`Nella cartella c'è un logbook più recente (${existing.flights.length} righe, salvato ${new Date(existing.updated).toLocaleString('it-IT')}). Lo carico al posto di quello nell'app?`));
      if (useIt) { data = existing; await idb.set('data', data); toast('Logbook caricato dalla cartella'); route(); }
    }
    await writeBackup();
    if (backupOk) toast(`Backup attivo nella cartella "${h.name}"`);
  } catch (e) { if (e.name !== 'AbortError') toast('Cartella non disponibile: ' + e.message); }
}
async function reconnectFolder() {
  if (!dirHandle) return chooseFolder();
  if ((await dirHandle.requestPermission({ mode: 'readwrite' })) === 'granted') { await writeBackup(); toast('Backup riattivato'); }
}
function renderBackupState() {
  const el = $('#backupState'); if (!el) return;
  if (!fsSupported) { el.innerHTML = 'Backup su cartella non disponibile in questo browser.<br>Apri l\'app con Chrome.'; return; }
  if (!dirHandle) { el.innerHTML = 'Nessuna cartella di backup.<br><button class="btn small" id="bkChoose">Scegli cartella</button>'; $('#bkChoose').onclick = chooseFolder; return; }
  if (!backupOk) { el.innerHTML = `Backup in pausa: Chrome chiede di confermare l'accesso a <b>${esc(dirHandle.name)}</b>.<br><button class="btn small" id="bkRe">Riattiva backup</button>`; $('#bkRe').onclick = reconnectFolder; return; }
  el.innerHTML = `Backup in <b>${esc(dirHandle.name)}</b><br>salvato alle ${lastBackup.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`;
}

// ---------- geografia: aeroporti, distanze, notte ----------
const AP_FIX = { EBL: 'EBLG', ELBG: 'EBLG', LMJ: 'LIMJ', LMG: 'LIMG', DTNZ: 'DTNH' };
let APT = null, aptLoading = null;
function loadAirports() { return aptLoading ||= fetch('data/airports.json').then(r => r.json()).then(j => (APT = j)).catch(() => { aptLoading = null; return null; }); }
const apt = c => APT && (APT[c] || APT[AP_FIX[c]]);
const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
function gcNM(a, b) {
  const [la1, lo1, la2, lo2] = [a[0], a[1], b[0], b[1]].map(rad);
  const h = Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2;
  return 2 * 3440.065 * Math.asin(Math.min(1, Math.sqrt(h)));
}
const nmCache = new Map();
function nmOf(f) {
  if (f.kind !== 'flight') return 0;
  if (f.nm) return f.nm;
  const k = f.dep + '|' + f.arr; if (nmCache.has(k)) return nmCache.get(k);
  const A = apt(f.dep), B = apt(f.arr); const v = A && B ? Math.round(gcNM(A, B)) : 0;
  if (APT) nmCache.set(k, v); return v;
}
// elevazione del sole in gradi (algoritmo NOAA semplificato, precisione circa 1 grado)
function sunElev(ms, lat, lon) {
  const d = ms / 86400000 + 2440587.5 - 2451545.0;
  const g = rad((357.529 + 0.98560028 * d) % 360), q = (280.459 + 0.98564736 * d) % 360;
  const L = rad(q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)), e = rad(23.439 - 0.00000036 * d);
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)), dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
  const H = rad(gmst * 15 + lon) - ra, la = rad(lat);
  return deg(Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(H)));
}
function gcPoint(A, B, t) {
  const [la1, lo1, la2, lo2] = [A[0], A[1], B[0], B[1]].map(rad);
  const v1 = [Math.cos(la1) * Math.cos(lo1), Math.cos(la1) * Math.sin(lo1), Math.sin(la1)], v2 = [Math.cos(la2) * Math.cos(lo2), Math.cos(la2) * Math.sin(lo2), Math.sin(la2)];
  const w = Math.acos(Math.max(-1, Math.min(1, v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2])));
  if (w < 1e-9) return A;
  const s1 = Math.sin((1 - t) * w) / Math.sin(w), s2 = Math.sin(t * w) / Math.sin(w);
  const v = [0, 1, 2].map(i => s1 * v1[i] + s2 * v2[i]);
  return [deg(Math.asin(v[2])), deg(Math.atan2(v[1], v[0]))];
}
// notte EASA: dalla fine del crepuscolo civile serale all'inizio di quello mattutino (sole sotto -6 gradi), minuto per minuto lungo la rotta
function nightCalc(date, out, inn, dep, arr) {
  const A = apt(dep), B = apt(arr), o = toMin(out), i = toMin(inn);
  if (!A || !B || o == null || i == null || !date) return null;
  const dur = ((i - o) + 1440) % 1440; if (!dur) return null;
  const t0 = Date.parse(`${date}T${String(Math.floor(o / 60)).padStart(2, '0')}:${String(o % 60).padStart(2, '0')}:00Z`);
  let n = 0;
  for (let m = 0; m < dur; m++) { const p = gcPoint(A, B, (m + .5) / dur); if (sunElev(t0 + (m + .5) * 60000, p[0], p[1]) < -6) n++; }
  return { night: n, dur, toNight: sunElev(t0, A[0], A[1]) < -6, ldgNight: sunElev(t0 + dur * 60000, B[0], B[1]) < -6, nm: Math.round(gcNM(A, B)) };
}
const fmtN = n => Math.round(n).toLocaleString('it-IT');
const parseDec = v => { const n = parseFloat(String(v || '').replace(',', '.')); return n > 0 ? n : 0; };

// ---------- calcoli ----------
function sum(list, withOpening) {
  const t = Object.fromEntries(SUM_KEYS.map(k => [k, 0])); t.legs = 0; t.sims = 0;
  if (withOpening && data.opening) for (const k of SUM_KEYS) t[k] += data.opening[k] || 0;
  t.nm = 0; t.pax = 0; t.paxLegs = 0; t.fuelUsed = 0; t.fuelLegs = 0; t.payload = 0;
  for (const f of list) { if (f.planned) continue; for (const k of SUM_KEYS) t[k] += f[k] || 0; if (f.kind === 'sim') t.sims++; else { t.legs++; t.nm += nmOf(f); if (f.pax) { t.pax += f.pax; t.paxLegs++; } if (f.fuelUsed) { t.fuelUsed += f.fuelUsed; t.fuelLegs++; } t.payload += f.payload || 0; } }
  return t;
}
const roleOf = f => f.kind === 'sim' ? 'SIM' : f.pic > 0 ? (/picus/i.test(f.remarks) ? 'PICUS' : 'PIC') : f.dual > 0 ? 'DUAL' : f.sic > 0 ? 'SIC' : '';
function flightsIn(from, to) { return data.flights.filter(f => (!from || f.date >= from) && (!to || f.date <= to)); }

// ---------- router ----------
const views = { riepilogo: viewSummary, voli: viewFlights, mappa: m => loadMap().then(() => viewMap(m)), nuovo: viewEdit, modifica: viewEdit, stampa: viewPrint, dati: viewData };
// librerie della mappa caricate solo quando serve
let mapLoading = null;
function loadMap() {
  const js = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('file ' + src + ' non disponibile')); document.head.append(s); });
  return mapLoading ||= js('lib/d3-array.min.js').then(() => js('lib/d3-geo.min.js')).then(() => js('lib/topojson-client.min.js')).then(() => js('map.js'))
    .catch(e => { mapLoading = null; $('#main').innerHTML = `<h1>Mappa</h1><p class="lede">${esc(e.message)}. Apri l'app una volta con la connessione attiva.</p>`; throw e; });
}
function route() {
  const [v, arg] = (location.hash.slice(1) || 'riepilogo').split('/');
  const view = views[v] ? v : 'riepilogo';
  document.querySelectorAll('.side a').forEach(a => a.classList.toggle('active', a.dataset.view === (view === 'modifica' ? 'voli' : view)));
  const main = $('#main');
  if ((!data || !data.flights.length) && view !== 'dati' && view !== 'nuovo') { main.innerHTML = emptyState(); return; }
  views[view](main, arg);
  main.focus({ preventScroll: true });
}
window.addEventListener('hashchange', route);

function emptyState() {
  return `<h1>Logbook</h1><p class="lede">L'app è vuota.</p>
  <div class="empty"><p>Importa il file <b>logbook.json</b> con lo storico, oppure apri la cartella di backup se l'hai già usata su questo Mac.</p>
  <a class="btn primary" href="#dati">Vai a Dati e backup</a></div>`;
}

// ---------- Riepilogo ----------
function stripHTML(t) {
  const c = (h, v, big) => `<div class="c${big ? ' big' : ''}"><div class="ch">${h}</div><div class="cv">${v}</div></div>`;
  const g = (h, cols) => `<div class="grp"><div class="gh">${h}</div><div class="cols">${cols}</div></div>`;
  return `<div class="strip" role="group" aria-label="Totali">
    ${g('Single pilot', c('SE', hm0(t.spSe)) + c('ME', hm0(t.spMe)))}
    ${g('Multi pilot', c('MP', hm0(t.mp)))}
    ${g('Funzione', c('PIC', hm0(t.pic)) + c('Copilota', hm0(t.sic)) + c('Dual', hm0(t.dual)) + c('Istruttore', hm0(t.instr)))}
    ${g('Condizioni', c('Notte', hm0(t.night)) + c('IFR', hm0(t.ifr)))}
    ${g('Decolli', c('Giorno', t.toDay) + c('Notte', t.toNight))}
    ${g('Atterraggi', c('Giorno', t.ldgDay) + c('Notte', t.ldgNight))}
    ${g('Simulatore', c('FSTD', hm0(t.sim)))}
  </div>`;
}
function splitBar(t, max, cls = 'hbar') {
  const w = v => max ? (100 * v / max).toFixed(2) + '%' : '0';
  return `<div class="${cls}" role="img" aria-label="PIC ${hm0(t.pic)}, copilota ${hm0(t.sic)}, dual ${hm0(t.dual)}"><i class="c-pic" style="width:${w(t.pic)}"></i><i class="c-sic" style="width:${w(t.sic)}"></i><i class="c-dual" style="width:${w(t.dual)}"></i></div>`;
}
function gauge(v, limit) {
  const p = Math.min(100, 100 * v / limit);
  return `<div class="gauge ${p >= 100 ? 'over' : p >= 80 ? 'hi' : ''}"><i style="width:${p.toFixed(1)}%"></i></div>`;
}
function viewSummary(main) {
  const years = [...new Set(data.flights.map(f => f.date.slice(0, 4)))].sort().reverse();
  const sel = viewSummary.period || 'all';
  let list = data.flights, withOpen = true, label = 'dal 2007, riporto precedente incluso';
  if (sel === '12m') { list = flightsIn(addDays(today(), -365)); withOpen = false; label = 'negli ultimi 12 mesi'; }
  else if (/^\d{4}$/.test(sel)) { list = flightsIn(sel + '-01-01', sel + '-12-31'); withOpen = false; label = 'nel ' + sel; }
  const t = sum(list, withOpen);
  const fn = t.pic + t.sic + t.dual;
  const pct = v => fn ? Math.round(100 * v / fn) + '%' : '';

  // limiti e recency
  const td = today();
  const fl = data.flights.filter(f => f.kind === 'flight' && !f.planned);
  const last = (from) => sum(fl.filter(f => f.date >= from && f.date <= td));
  const d28 = last(addDays(td, -27)), y = last(td.slice(0, 4) + '-01-01'), m12 = last(addDays(td, -364)), d90 = last(addDays(td, -89));
  const lastFlight = fl[fl.length - 1];
  const curType = lastFlight ? lastFlight.type : '';
  const typ90 = sum(fl.filter(f => f.type === curType && f.date >= addDays(td, -89)));
  const ok90 = (typ90.toDay + typ90.toNight) >= 3 && (typ90.ldgDay + typ90.ldgNight) >= 3;

  // miglia
  if (!APT) loadAirports().then(j => { if (j && location.hash.replace('#', '') in { '': 1, riepilogo: 1 }) viewSummary(main); });
  const flYears = new Set(list.filter(f => f.kind === 'flight').map(f => f.date.slice(0, 4))).size || 1;
  const m12nm = m12.nm;
  // per tipo
  const byType = {}; for (const f of list) if (f.kind === 'flight') (byType[f.type || '—'] ||= []).push(f);
  const tl = Object.entries(byType).map(([k, v]) => [k, sum(v), v[v.length - 1].date]).sort((a, b) => typeRank(a[0]) - typeRank(b[0]) || a[2].localeCompare(b[2]));
  const tmax = Math.max(...tl.map(x => x[1].total), 1);
  const trows = tl.map(([k, s, ld]) => `<tr><td class="l"><b>${esc(k)}</b></td><td class="barcell">${splitBar(s, tmax)}</td><td>${s.legs}</td><td><b>${hm(s.total)}</b></td><td>${avg(s)}</td><td>${hm(s.pic)}</td><td>${hm(s.sic)}</td><td>${dmy(ld)}</td></tr>`).join('');
  // per famiglia
  const byFam = {}; for (const [k, , ] of tl) (byFam[familyOf(k)] ||= []).push(k);
  const fl2 = Object.entries(byFam).map(([fam, types]) => [fam, types, sum(list.filter(f => f.kind === 'flight' && types.includes(f.type || '—'))), tl.filter(x => types.includes(x[0])).map(x => x[2]).sort().at(-1)]);
  const fmax = Math.max(...fl2.map(x => x[2].total), 1);
  const frows = fl2.map(([fam, types, s, ld]) => `<tr><td class="l"><b>${esc(fam)}</b><br><span class="hint">${types.map(esc).join(' + ')}</span></td><td class="barcell">${splitBar(s, fmax)}</td><td>${s.legs}</td><td><b>${hm(s.total)}</b></td><td>${avg(s)}</td><td>${hm(s.pic)}</td><td>${hm(s.sic)}</td><td>${dmy(ld)}</td></tr>`).join('');
  // per anno
  const byYear = {}; for (const f of data.flights) (byYear[f.date.slice(0, 4)] ||= []).push(f);
  const yl = Object.keys(byYear).sort().reverse().map(yr => [yr, sum(byYear[yr])]);
  const ymax = Math.max(...yl.map(x => x[1].total), 1);
  const yrows = yl.map(([yr, s]) => `<tr class="click" data-year="${yr}" tabindex="0" title="Apri i mesi del ${yr}"><td class="l"><b>${yr}</b> <span class="chev" aria-hidden="true">›</span></td><td class="barcell">${splitBar(s, ymax)}</td><td>${s.legs}</td><td><b>${hm(s.total)}</b></td><td>${avg(s)}</td><td>${hm(s.pic)}</td><td>${hm(s.sic)}</td><td>${hm(s.night)}</td><td>${s.ldgDay + s.ldgNight || ''}</td><td>${s.nm ? fmtN(s.nm) : ''}</td><td>${hm(s.sim)}</td></tr>`).join('');

  main.innerHTML = `<div class="row" style="justify-content:space-between;align-items:baseline"><h1>Riepilogo</h1>
    <label class="row filters" style="margin:0">Periodo
    <select id="per"><option value="all">Tutta la carriera</option><option value="12m">Ultimi 12 mesi</option>${years.map(y => `<option value="${y}">${y}</option>`).join('')}</select></label></div>
  ${plannedBanner()}
  <p class="lede">${t.legs} tratte e ${t.sims} sessioni al simulatore ${label}. Media per tratta ${avg(sum(list.filter(f => f.kind === 'flight')))}.</p>
  <div class="hero">
    <div class="tot">${hm0(t.total)}<small>ore di volo</small></div>
    <div class="split">${splitBar(t, fn, 'bar')}
      <div class="legend">
        <span><i class="dot c-pic"></i>PIC <b>${hm0(t.pic)}</b> ${pct(t.pic)}</span>
        <span><i class="dot c-sic"></i>Copilota <b>${hm0(t.sic)}</b> ${pct(t.sic)}</span>
        <span><i class="dot c-dual"></i>Dual <b>${hm0(t.dual)}</b> ${pct(t.dual)}</span>
      </div></div>
  </div>
  ${stripHTML(t)}
  <h2>Miglia e curiosità</h2>
  <div class="recency">
    <div><b>${fmtN(t.nm)} NM</b><span>${sel === 'all' ? 'percorse in carriera' : 'percorse nel periodo'}, in linea d'aria</span></div>
    <div><b>${fmtN(t.nm / flYears)} NM</b><span>media annuale${flYears > 1 ? ` su ${flYears} anni` : ''}</span></div>
    <div><b>${fmtN(m12nm)} NM</b><span>ultimi 12 mesi</span></div>
    <div><b>${t.legs ? fmtN(t.nm / t.legs) : 0} NM</b><span>distanza media per tratta</span></div>
    ${t.paxLegs ? `<div><b>${fmtN(t.pax)}</b><span>passeggeri trasportati, su ${t.paxLegs} tratte con il dato</span></div>` : ''}
    ${t.fuelLegs ? `<div><b>${fmtN(t.fuelUsed)} t</b><span>carburante usato, su ${t.fuelLegs} tratte con il dato</span></div>` : ''}
  </div>
  <h2>Limiti e recency</h2>
  <div class="recency">
    <div><b>${hm0(d28.total)}</b><span>ultimi 28 giorni, limite 100 h</span>${gauge(d28.total, 6000)}</div>
    <div><b>${hm0(y.total)}</b><span>anno ${td.slice(0, 4)}, limite 900 h</span>${gauge(y.total, 54000)}</div>
    <div><b>${hm0(m12.total)}</b><span>ultimi 12 mesi, limite 1000 h</span>${gauge(m12.total, 60000)}</div>
    <div><b>${d90.toDay + d90.toNight} / ${d90.ldgDay + d90.ldgNight}</b><span>decolli e atterraggi negli ultimi 90 giorni</span></div>
    <div class="${ok90 ? '' : 'warn'}"><b>${typ90.toDay + typ90.toNight} / ${typ90.ldgDay + typ90.ldgNight}</b><span>${esc(curType)} negli ultimi 90 giorni${ok90 ? '' : ': meno di 3, serve recency'}</span></div>
    <div><b>${lastFlight ? dmy(lastFlight.date) : '—'}</b><span>ultimo volo${lastFlight ? `, ${esc(lastFlight.dep)}–${esc(lastFlight.arr)}` : ''}</span></div>
  </div>
  <h2>Per famiglia</h2>
  <table class="data"><thead><tr><th class="l">Famiglia</th><th class="l">PIC, copilota e dual</th><th>Tratte</th><th>Totale</th><th>Media</th><th>PIC</th><th>Copilota</th><th>Ultimo volo</th></tr></thead><tbody>${frows}</tbody></table>
  <h2>Per tipo di aereo</h2>
  <table class="data"><thead><tr><th class="l">Tipo</th><th class="l">PIC, copilota e dual</th><th>Tratte</th><th>Totale</th><th>Media</th><th>PIC</th><th>Copilota</th><th>Ultimo volo</th></tr></thead><tbody>${trows}</tbody></table>
  ${withOpen ? `<p class="hint">Il riporto ante 2007 (${hm(data.opening.total)}) entra nei totali ma non nelle tabelle per tipo e per anno.</p>` : ''}
  <h2>Per anno</h2>
  <table class="data"><thead><tr><th class="l">Anno</th><th class="l">PIC, copilota e dual</th><th>Tratte</th><th>Totale</th><th>Media</th><th>PIC</th><th>Copilota</th><th>Notte</th><th>Atterr.</th><th>NM</th><th>Sim</th></tr></thead><tbody>${yrows}</tbody></table>`;
  const per = $('#per'); per.value = sel; per.onchange = () => { viewSummary.period = per.value; viewSummary(main); };
  bindPlannedBanner(main);
  const yt = main.querySelectorAll('table.data')[2].tBodies[0];
  const open = e => { const tr = e.target.closest('tr[data-year]'); if (tr) showYear(tr.dataset.year); };
  yt.onclick = open; yt.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(e); } };
}

const MESI = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
function showYear(yr) {
  const rows = MESI.map((m, i) => { const mm = String(i + 1).padStart(2, '0'); return [m, mm, sum(data.flights.filter(f => f.date.startsWith(`${yr}-${mm}`)))]; });
  const tot = sum(data.flights.filter(f => f.date.startsWith(yr)));
  const max = Math.max(...rows.map(r => r[2].total), 1);
  const body = rows.map(([m, , s]) => s.legs || s.sims
    ? `<tr><td class="l"><b>${m}</b></td><td class="barcell">${splitBar(s, max)}</td><td>${s.legs || ''}</td><td><b>${hm(s.total)}</b></td><td>${avg(s)}</td><td>${hm(s.pic)}</td><td>${hm(s.sic)}</td><td>${hm(s.dual)}</td><td>${hm(s.night)}</td><td>${s.ldgDay + s.ldgNight || ''}</td><td>${s.nm ? fmtN(s.nm) : ''}</td><td>${hm(s.sim)}</td></tr>`
    : `<tr class="idle"><td class="l">${m}</td><td class="barcell"></td><td colspan="10" class="l hint">nessun volo</td></tr>`).join('');
  const act = rows.filter(r => r[2].total);
  const best = act.length ? act.reduce((a, b) => b[2].total > a[2].total ? b : a) : null;
  let dlg = $('#yearDlg');
  if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'yearDlg'; document.body.append(dlg); dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); }); }
  dlg.innerHTML = `<div class="dlg-head"><div><h2>${yr}, mese per mese</h2>
      <p class="lede">${tot.legs} tratte, ${hm0(tot.total)} di volo, media per tratta ${avg(tot)}, ${fmtN(tot.nm)} NM${act.length ? `, ${hm0(Math.round(tot.total / act.length))} al mese nei mesi con voli` : ''}${best ? `. Il mese più pieno è ${best[0].toLowerCase()} con ${hm0(best[2].total)}` : ''}.</p></div>
      <button class="btn" id="dlgClose" aria-label="Chiudi">Chiudi</button></div>
    <table class="data"><thead><tr><th class="l">Mese</th><th class="l">PIC, copilota e dual</th><th>Tratte</th><th>Totale</th><th>Media</th><th>PIC</th><th>Copilota</th><th>Dual</th><th>Notte</th><th>Atterr.</th><th>NM</th><th>Sim</th></tr></thead>
    <tbody>${body}<tr class="sum"><td class="l">Totale ${yr}</td><td></td><td>${tot.legs}</td><td>${hm0(tot.total)}</td><td>${avg(tot)}</td><td>${hm(tot.pic)}</td><td>${hm(tot.sic)}</td><td>${hm(tot.dual)}</td><td>${hm(tot.night)}</td><td>${tot.ldgDay + tot.ldgNight || ''}</td><td>${tot.nm ? fmtN(tot.nm) : ''}</td><td>${hm(tot.sim)}</td></tr></tbody></table>
    <p class="row" style="margin-top:14px"><button class="btn" id="dlgVoli">Vedi i voli del ${yr}</button></p>`;
  $('#dlgClose').onclick = () => dlg.close();
  $('#dlgVoli').onclick = () => { dlg.close(); viewFlights.st = { year: yr, type: '', q: '', all: false }; location.hash = 'voli'; if (location.hash === '#voli') route(); };
  dlg.showModal();
}

// ---------- Voli ----------
function viewFlights(main) {
  const st = viewFlights.st ||= { year: '', type: '', q: '', all: false };
  const years = [...new Set(data.flights.map(f => f.date.slice(0, 4)))].sort().reverse();
  const types = [...new Set(data.flights.map(f => f.kind === 'sim' ? 'Simulatore' : f.type).filter(Boolean))].sort();
  const q = st.q.toLowerCase();
  let list = data.flights.filter(f => (!st.year || f.date.startsWith(st.year)) &&
    (!st.type || (st.type === 'Simulatore' ? f.kind === 'sim' : st.type === '__planned' ? f.planned : st.type === '__dot' ? f.planned && !f.seen : f.type === st.type)) &&
    (!q || [f.dep, f.arr, f.reg, f.picName, f.remarks, f.simType, f.flightNo].join(' ').toLowerCase().includes(q)));
  const t = sum(list);
  list = list.slice().reverse();
  const shown = st.all ? list : list.slice(0, 300);
  const rows = shown.map(f => {
    const r = roleOf(f);
    if (f.kind === 'sim') return `<tr class="click" data-id="${f.id}"><td class="l">${dmy(f.date)}</td><td class="l" colspan="4">${esc(f.simType)}</td><td class="l"><span class="tag sim">SIM</span></td><td></td><td>${hm(f.sim)}</td><td></td><td></td><td></td><td></td><td class="l">${esc(f.picName)}</td><td class="rem">${esc(f.remarks)}</td></tr>`;
    if (f.planned) return `<tr class="click planned" data-id="${f.id}"><td class="l">${f.seen ? '' : '<i class="newdot" title="Da vedere"></i>'}${dmy(f.date)}</td><td class="l">${esc(f.dep)}</td><td>${esc(f.out)}</td><td class="l">${esc(f.arr)}</td><td>${esc(f.inn)}</td><td class="l">${esc(f.type || f.acHint || '')}</td><td class="l">${esc(f.reg)}</td><td>${hm(f.total)}</td><td><span class="tag plan">${f.date < today() ? 'da completare' : 'programmato'}</span></td><td></td><td></td><td></td><td class="l">${esc(f.picName)}</td><td class="rem">${esc(f.change || f.flightNo || '')}</td></tr>`;
    return `<tr class="click" data-id="${f.id}"><td class="l">${dmy(f.date)}</td><td class="l">${esc(f.dep)}</td><td>${esc(f.out)}</td><td class="l">${esc(f.arr)}</td><td>${esc(f.inn)}</td><td class="l">${esc(f.type)}</td><td class="l">${esc(f.reg)}</td><td>${hm(f.total)}</td><td><span class="tag${r.startsWith('PIC') ? ' pic' : ''}">${r}</span></td><td>${hm(f.night)}</td><td>${(f.toDay + f.toNight) || ''}</td><td>${(f.ldgDay + f.ldgNight) || ''}</td><td class="l">${esc(f.picName)}</td><td class="rem">${esc(f.remarks)}</td></tr>`;
  }).join('');
  const nPlan = data.flights.filter(f => f.planned).length, nDot = data.flights.filter(f => f.planned && !f.seen).length;
  main.innerHTML = `<h1>Voli</h1>
  ${plannedBanner()}
  <p class="lede">${t.legs} tratte, ${hm0(t.total)} di volo${t.sims ? `, ${t.sims} sessioni al simulatore (${hm0(t.sim)})` : ''}.</p>
  <div class="row filters">
    <select id="fy" aria-label="Anno"><option value="">Tutti gli anni</option>${years.map(y => `<option>${y}</option>`).join('')}</select>
    <select id="ft" aria-label="Tipo"><option value="">Tutti i tipi</option>${nPlan ? `<option value="__planned">Programmati da NetLine (${nPlan})</option>` : ''}${nDot ? `<option value="__dot">Con il pallino (${nDot})</option>` : ''}${types.map(y => `<option>${esc(y)}</option>`).join('')}</select>
    ${nDot ? '<button class="btn" id="seenAll">Segna tutti come visti</button>' : ''}
    <input id="fq" type="search" placeholder="Cerca aeroporto, marca, comandante, note" size="36" value="${esc(st.q)}">
    <a class="btn primary" href="#nuovo">Nuovo volo</a>
  </div>
  <div class="scroll" style="max-height:none"><table class="data"><thead><tr><th class="l">Data</th><th class="l">Da</th><th>Off</th><th class="l">A</th><th>On</th><th class="l">Tipo</th><th class="l">Marca</th><th>Totale</th><th>Funzione</th><th>Notte</th><th>T/O</th><th>LDG</th><th class="l">Comandante</th><th class="l">Note</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="14" class="l">Nessun volo con questi filtri.</td></tr>'}</tbody></table></div>
  ${!st.all && list.length > 300 ? `<p><button class="btn" id="more">Mostra tutte le ${list.length} righe</button></p>` : ''}`;
  $('#fy').value = st.year; $('#ft').value = st.type;
  $('#fy').onchange = e => { st.year = e.target.value; viewFlights(main); };
  $('#ft').onchange = e => { st.type = e.target.value; viewFlights(main); };
  let deb; $('#fq').oninput = e => { clearTimeout(deb); deb = setTimeout(() => { st.q = e.target.value; viewFlights(main); const i = $('#fq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); };
  if ($('#more')) $('#more').onclick = () => { st.all = true; viewFlights(main); };
  if ($('#seenAll')) $('#seenAll').onclick = async () => { for (const f of data.flights) if (f.planned && !f.seen) f.seen = true; await save(); updateBadge(); viewFlights(main); };
  bindPlannedBanner(main);
  main.querySelector('tbody').onclick = e => { const tr = e.target.closest('tr[data-id]'); if (tr) location.hash = 'modifica/' + tr.dataset.id; };
}

// ---------- Nuovo / modifica ----------
function viewEdit(main, id) {
  const orig = id ? data.flights.find(f => f.id === id) : null;
  if (id && !orig) { main.innerHTML = '<h1>Volo non trovato</h1><p><a href="#voli">Torna ai voli</a></p>'; return; }
  if (orig?.planned && !orig.seen) { orig.seen = true; save(); updateBadge(); }
  const last = data.flights.filter(f => f.kind === 'flight').at(-1);
  const f = orig ? { ...orig } : { ...EMPTY(), date: today(), type: last?.type || '', reg: '', dep: last?.arr || '' };
  const role = orig ? roleOf(orig) : 'PIC';
  const isSim = f.kind === 'sim';
  const regs = [...new Set([...data.flights.map(x => x.reg), ...Object.keys(KNOWN_AIRCRAFT)].filter(Boolean))].sort();
  const typesL = [...new Set([...TYPE_ORDER, ...data.flights.map(x => x.type)].filter(Boolean))];
  const simTypes = [...new Set([...KNOWN_SIMS, ...Object.keys(SIM_DEVICES)])];
  const mpOn = !orig || f.mp > 0 || !(f.spSe || f.spMe);
  const ifrAll = !orig || f.ifr === f.total;

  main.innerHTML = `<h1>${orig ? 'Modifica' : 'Nuovo'} ${isSim ? 'simulatore' : 'volo'}</h1>
  ${orig?.planned ? `<div class="plan-note"><b>Volo importato da NetLine${orig.flightNo ? ` (${esc(orig.flightNo)})` : ''}</b>: gli orari sono quelli schedulati, ${esc(orig.sched?.out || orig.out)}–${esc(orig.sched?.inn || orig.inn)} UTC. Metti off e on blocks effettivi${orig.acHint && !orig.type ? `, la marca (nel turno: ${esc(orig.acHint)})` : ''} e salva: da quel momento il volo entra nei totali.${orig.change ? `<br>Ultima modifica nel turno: ${esc(orig.change)}` : ''}</div>` : ''}
  <form class="flight sheet" id="ff" novalidate>
    <fieldset><div class="seg" role="radiogroup" aria-label="Tipo di registrazione">
      <label><input type="radio" name="kind" value="flight" ${!isSim ? 'checked' : ''}><span>Volo</span></label>
      <label><input type="radio" name="kind" value="sim" ${isSim ? 'checked' : ''}><span>Simulatore</span></label></div></fieldset>
    <div id="fFlight" ${isSim ? 'hidden' : ''}>
    <section class="sheet-head">
      <div class="chips">
        <label class="chip"><input id="date" type="date" value="${esc(f.date)}" required aria-label="Data"></label>
        <span class="chip" id="chipIfr">IFR</span>
        <span class="chip" id="chipRole">${role === 'SIC' ? 'COPILOTA' : role}</span>
        ${orig?.planned ? '<span class="chip warn">PROGRAMMATO</span>' : ''}
      </div>
      <div class="route">
        <div class="apt"><input id="dep" class="icao" value="${esc(f.dep)}" maxlength="4" placeholder="ICAO" aria-label="Partenza" autocapitalize="characters"><div class="apt-sub" id="depSub"></div></div>
        <div class="mid"><svg viewBox="0 0 200 40" aria-hidden="true"><path d="M8 34 Q100 -8 192 34" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
          <input id="flightNo" class="fno" value="${esc(f.flightNo || '')}" placeholder="N° volo" aria-label="Numero volo"></div>
        <div class="apt"><input id="arr" class="icao" value="${esc(f.arr)}" maxlength="4" placeholder="ICAO" aria-label="Arrivo" autocapitalize="characters"><div class="apt-sub" id="arrSub"></div></div>
      </div>
      <div class="times">
        <div class="t sched"><span>SCHED</span><b>${esc(f.sched?.out || '')}</b><small>UTC</small></div>
        <label class="t"><span>OUT</span><input id="out" value="${esc(f.out)}" placeholder="--:--" inputmode="numeric"></label>
        <label class="t"><span>OFF</span><input id="off" value="${esc(f.off || '')}" placeholder="--:--" inputmode="numeric"></label>
        <label class="t"><span>ON</span><input id="on" value="${esc(f.on || '')}" placeholder="--:--" inputmode="numeric"></label>
        <label class="t"><span>IN</span><input id="inn" value="${esc(f.inn)}" placeholder="--:--" inputmode="numeric"></label>
        <div class="t sched"><span>SCHED</span><b>${esc(f.sched?.inn || '')}</b><small>UTC</small></div>
      </div>
      <div class="blocks">
        <div><span>Blocco schedulato</span><b id="schedBlock">${f.sched ? hm(((toMin(f.sched.inn) - toMin(f.sched.out)) + 1440) % 1440) : '—'}</b></div>
        <label><span>Blocco reale</span><input id="total" value="${hm(f.total)}" placeholder="0:00"></label>
        <div><span>Tempo di volo</span><b id="airTime">—</b></div>
        <label><span>Notte <i class="moon-ico" aria-hidden="true">☾</i></span><input id="night" value="${hm(f.night)}" placeholder="0:00" ${!orig || !f.night || orig.planned ? 'data-auto="1"' : ''}></label>
      </div>
      <p class="hint" id="nightHint" aria-live="polite"></p>
    </section>

    <section class="sheet-card">
      <h3>Volo</h3>
      <div class="flight-grid">
        <div class="col">
          <div class="cap">Partenza</div>
          <div class="counter" id="cTO"><div class="lbl">Decolli <button type="button" class="moon" aria-label="Decollo di notte" aria-pressed="false">☾</button></div>
            <div class="ctl"><button type="button" class="dec" aria-label="Meno">−</button><b>0</b><button type="button" class="inc" aria-label="Più">+</button></div></div>
        </div>
        <div class="col ac">
          <div class="cap">Aeromobile</div>
          <input id="reg" list="regs" class="reg" value="${esc(f.reg)}" placeholder="${esc(f.acHint || 'Marca')}" aria-label="Marca" autocapitalize="characters">
          <input id="type" list="types" class="type" value="${esc(f.type)}" placeholder="Modello" aria-label="Modello">
        </div>
        <div class="col">
          <div class="cap">Arrivo</div>
          <input id="approach" list="apprs" class="appr" value="${esc(f.approach || '')}" placeholder="Avvicinamento" aria-label="Avvicinamento">
          <div class="counter" id="cLDG"><div class="lbl">Atterraggi <button type="button" class="moon" aria-label="Atterraggio di notte" aria-pressed="false">☾</button></div>
            <div class="ctl"><button type="button" class="dec" aria-label="Meno">−</button><b>0</b><button type="button" class="inc" aria-label="Più">+</button></div></div>
        </div>
      </div>
      <input type="hidden" id="toDay" value="${f.toDay || ''}"><input type="hidden" id="toNight" value="${f.toNight || ''}">
      <input type="hidden" id="ldgDay" value="${f.ldgDay || ''}"><input type="hidden" id="ldgNight" value="${f.ldgNight || ''}">
      <div class="func">
        <div class="seg" role="radiogroup" aria-label="Funzione">
          ${['PIC', 'PICUS', 'SIC', 'DUAL'].map(r => `<label><input type="radio" name="role" value="${r}" ${r === role ? 'checked' : ''}><span>${r === 'SIC' ? 'Copilota' : r}</span></label>`).join('')}</div>
        <label class="pic"><span>Nome del PIC</span><input id="picName" value="${esc(f.picName)}"></label>
        <label class="small"><span>IFR</span><input id="ifr" value="${hm(f.ifr)}" ${ifrAll ? 'data-auto="1"' : ''}></label>
        <label class="chk"><input type="checkbox" id="mpOn" ${mpOn ? 'checked' : ''}> Multi pilot</label>
        <label class="chk"><input type="checkbox" id="instrOn" ${f.instr ? 'checked' : ''}> Istruttore</label>
      </div>
      <p class="hint" id="roleHint"></p>
    </section>

    <section class="sheet-card">
      <h3>Payload e carburante</h3>
      <div class="tiles">
        <label><span>Payload</span><input id="payload" inputmode="decimal" value="${f.payload || ''}" placeholder="0"><small>t</small></label>
        <label><span>Pax</span><input id="pax" type="number" min="0" inputmode="numeric" value="${f.pax || ''}" placeholder="0"></label>
        <label><span>Carburante usato</span><input id="fuelUsed" inputmode="decimal" value="${f.fuelUsed || ''}" placeholder="0"><small>t</small></label>
        <label><span>Carburante pianificato</span><input id="fuelPlan" inputmode="decimal" value="${f.fuelPlan || ''}" placeholder="0"><small>t</small></label>
        <div><span>Distanza</span><b id="distNM">—</b><small>NM</small></div>
        <div><span>CO₂</span><b id="co2">—</b><small>t</small></div>
      </div>
    </section>
    </div>
    <div id="fSim" ${isSim ? '' : 'hidden'}>
    <fieldset><legend>Sessione</legend><div class="grid">
      <div class="field"><label for="sdate">Data</label><input id="sdate" type="date" value="${esc(f.date)}"></div>
      <div class="field w2"><label for="simType">Simulatore</label><input id="simType" list="simtypes" value="${esc(f.simType)}" placeholder="BOEING 737-800"></div>
      <div class="field"><label for="sout">Inizio</label><input id="sout" value="${esc(f.out)}"></div>
      <div class="field"><label for="sinn">Fine</label><input id="sinn" value="${esc(f.inn)}"></div>
      <div class="field"><label for="sim">Durata</label><input id="sim" value="${hm(f.sim)}" placeholder="4:00"></div>
      <div class="field w3"><label for="spic">Istruttore o esaminatore</label><input id="spic" value="${esc(f.picName)}"></div>
    </div></fieldset></div>
    <fieldset><div class="grid"><div class="field w6"><label for="remarks">Note e firme</label><textarea id="remarks" rows="2">${esc(f.remarks)}</textarea></div></div></fieldset>
    <div class="actions"><button class="btn primary" type="submit">${orig?.planned ? 'Conferma con gli orari effettivi' : orig ? 'Salva modifiche' : 'Salva volo'}</button>
      ${orig ? '<button class="btn" type="button" id="dup">Duplica</button><button class="btn danger" type="button" id="del">Elimina</button>' : ''}
      <a class="btn" href="#voli">Annulla</a></div>
    <datalist id="regs">${regs.map(r => `<option>${esc(r)}</option>`).join('')}</datalist>
    <datalist id="types">${typesL.map(r => `<option>${esc(r)}</option>`).join('')}</datalist>
    <datalist id="apprs">${['CAT I', 'CAT II', 'CAT IIIA', 'CAT IIIB', 'RNP', 'LNAV/VNAV', 'LNAV', 'VOR', 'NDB', 'LOC', 'Visual', 'Circling'].map(r => `<option>${r}</option>`).join('')}</datalist>
    <datalist id="simtypes">${simTypes.map(r => `<option>${esc(r)}</option>`).join('')}</datalist>
  </form>`;

  const form = $('#ff');
  const kind = () => form.kind.value;
  form.querySelectorAll('input[name=kind]').forEach(r => r.onchange = () => { $('#fFlight').hidden = kind() === 'sim'; $('#fSim').hidden = kind() !== 'sim'; });
  const autoTotal = () => {
    const o = toMin($('#out').value), i = toMin($('#inn').value);
    if (o != null && i != null) { $('#total').value = hm(((i - o) + 1440) % 1440); syncIfr(); }
  };
  const syncIfr = () => { if ($('#ifr').dataset.auto) $('#ifr').value = $('#total').value; };
  $('#ifr').oninput = () => delete $('#ifr').dataset.auto;
  ['out', 'inn'].forEach(k => $('#' + k).addEventListener('change', autoTotal));
  $('#total').addEventListener('change', syncIfr);
  // notte, decollo e atterraggio di giorno o di notte calcolati dalla posizione del sole lungo la rotta
  let calc = null;
  $('#night').addEventListener('input', () => delete $('#night').dataset.auto);
  const placeTOLDG = () => {
    if (!calc) return;
    const to = num($('#toDay').value) + num($('#toNight').value), ld = num($('#ldgDay').value) + num($('#ldgNight').value);
    if (to) { $('#toDay').value = calc.toNight ? '' : to; $('#toNight').value = calc.toNight ? to : ''; }
    if (ld) { $('#ldgDay').value = calc.ldgNight ? '' : ld; $('#ldgNight').value = calc.ldgNight ? ld : ''; }
  };
  const runNight = async () => {
    await loadAirports();
    calc = nightCalc($('#date').value, $('#out').value.trim(), $('#inn').value.trim(), $('#dep').value.trim().toUpperCase(), $('#arr').value.trim().toUpperCase());
    const h = $('#nightHint');
    if (!calc) { h.textContent = ''; return; }
    const tipo = calc.night === 0 ? 'Volo tutto di giorno' : calc.night >= calc.dur ? 'Volo tutto di notte' : `Notte calcolata ${hm(calc.night)} su ${hm(calc.dur)}`;
    h.innerHTML = `${tipo}: decollo ${calc.toNight ? 'di notte' : 'di giorno'}, atterraggio ${calc.ldgNight ? 'di notte' : 'di giorno'}. Distanza ${fmtN(calc.nm)} NM.` +
      (!$('#night').dataset.auto && parseHM($('#night').value) !== calc.night ? ` <button type="button" class="btn small" id="useNight">Usa ${hm(calc.night) || '0:00'}</button>` : '');
    if ($('#night').dataset.auto) $('#night').value = hm(calc.night);
    const u = $('#useNight'); if (u) u.onclick = () => { $('#night').value = hm(calc.night); $('#night').dataset.auto = '1'; placeTOLDG(); runNight(); };
    if (!orig || $('#night').dataset.auto) placeTOLDG();
    if (typeof extras === 'function') setTimeout(extras, 0);
  };
  ['date', 'dep', 'arr', 'out', 'inn'].forEach(k => $('#' + k).addEventListener('change', runNight));
  ['toDay', 'toNight', 'ldgDay', 'ldgNight'].forEach(k => $('#' + k).addEventListener('change', placeTOLDG));
  runNight();
  // contatori decolli e atterraggi con la luna
  const counter = (box, dayId, nightId, calcKey) => {
    const el = $(box), b = el.querySelector('b'), moon = el.querySelector('.moon');
    let manual = null; // scelta a mano della luna, vince sul calcolo
    const night = () => manual ?? (num($(nightId).value) > 0 || (!num($(dayId).value) && !!calc?.[calcKey]));
    const draw = () => { b.textContent = num($(dayId).value) + num($(nightId).value); const n = night(); moon.setAttribute('aria-pressed', n); el.classList.toggle('night', n); };
    const put = tot => { const n = night(); $(dayId).value = n ? '' : (tot || ''); $(nightId).value = n ? (tot || '') : ''; draw(); };
    const tot = () => num($(dayId).value) + num($(nightId).value);
    el.querySelector('.inc').onclick = () => put(tot() + 1);
    el.querySelector('.dec').onclick = () => put(Math.max(0, tot() - 1));
    moon.onclick = () => { manual = !night(); put(tot()); };
    return draw;
  };
  const drawTO = counter('#cTO', '#toDay', '#toNight', 'toNight'), drawLDG = counter('#cLDG', '#ldgDay', '#ldgNight', 'ldgNight');
  const aptLabel = async () => {
    await loadAirports(); IATA ||= await fetch('data/iata.json').then(r => r.json()).catch(() => ({}));
    const rev = c => Object.keys(IATA).find(k => IATA[k] === c) || '';
    for (const [inp, sub] of [['#dep', '#depSub'], ['#arr', '#arrSub']]) { const c = $(inp).value.trim().toUpperCase(), p = apt(c); $(sub).innerHTML = p ? `<b>${esc(rev(AP_FIX[c] || c))}</b> ${esc(p[2])}` : ''; }
  };
  const extras = () => {
    const off = toMin($('#off').value), on = toMin($('#on').value);
    $('#airTime').textContent = off != null && on != null ? hm(((on - off) + 1440) % 1440) || '0:00' : '—';
    $('#distNM').textContent = calc ? fmtN(calc.nm) : (f.nm ? fmtN(f.nm) : '—');
    const fu = parseDec($('#fuelUsed').value); $('#co2').textContent = fu ? (fu * 3.16).toFixed(1).replace('.', ',') : '—';
    $('#chipIfr').hidden = !parseHM($('#ifr').value);
    drawTO(); drawLDG();
  };
  ['off', 'on', 'fuelUsed', 'ifr'].forEach(k => $('#' + k).addEventListener('input', extras));
  ['dep', 'arr'].forEach(k => $('#' + k).addEventListener('change', aptLabel));
  const runNight0 = runNight;
  ['date', 'dep', 'arr', 'out', 'inn'].forEach(k => $('#' + k).addEventListener('change', () => setTimeout(extras, 50)));
  aptLabel(); setTimeout(extras, 80); void runNight0;
  form.querySelectorAll('input[name=role]').forEach(r => r.addEventListener('change', () => { $('#chipRole').textContent = r.value === 'SIC' ? 'COPILOTA' : r.value; }));
  $('#simType').addEventListener('change', () => { const v = $('#simType').value.trim(); if (SIM_DEVICES[v]) { const r = $('#remarks'); if (!r.value.includes(v)) r.value = (r.value ? r.value + ' / ' : '') + v; $('#simType').value = SIM_DEVICES[v]; } });
  const autoSim = () => { const o = toMin($('#sout').value), i = toMin($('#sinn').value); if (o != null && i != null) $('#sim').value = hm(((i - o) + 1440) % 1440); };
  ['sout', 'sinn'].forEach(k => $('#' + k).addEventListener('change', autoSim));
  $('#reg').addEventListener('change', () => {
    const r = $('#reg').value.trim().toUpperCase(); const k = data.flights.findLast(x => x.reg === r);
    const t = k?.type || KNOWN_AIRCRAFT[r]; if (t) $('#type').value = t;
  });
  const hint = () => {
    const r = form.role.value;
    $('#roleHint').textContent = { PIC: 'Tempo registrato come PIC.', PICUS: 'Registrato come PIC con "PICUS" nelle note: serve la controfirma del comandante (nome e numero di licenza).', SIC: 'Tempo registrato come copilota.', DUAL: 'Tempo di istruzione: nel nome del PIC metti l\'istruttore e la sua certificazione nelle note.' }[r];
    if ((r === 'PIC' || r === 'PICUS') && !$('#picName').value) $('#picName').value = 'SELF';
  };
  form.querySelectorAll('input[name=role]').forEach(r => r.onchange = hint); hint();

  if (orig) {
    $('#del').onclick = async () => { if (!confirm('Eliminare questa riga dal logbook?')) return; data.flights = data.flights.filter(x => x.id !== orig.id); (data.deleted ||= {})[orig.id] = Date.now(); await save('Riga eliminata'); location.hash = 'voli'; };
    $('#dup').onclick = () => { viewEdit.dup = orig; location.hash = 'nuovo'; };
  } else if (viewEdit.dup) {
    const d = viewEdit.dup; viewEdit.dup = null;
    for (const k of ['type', 'reg', 'picName', 'flightNo']) if ($('#' + k)) $('#' + k).value = d[k] || '';
    $('#dep').value = d.arr; form.role.value = roleOf(d) === 'SIM' ? 'PIC' : roleOf(d); hint();
  }

  form.onsubmit = async e => {
    e.preventDefault();
    const rec = orig ? { ...orig } : { ...EMPTY(), id: nextId() };
    form.querySelectorAll('.err').forEach(x => x.classList.remove('err'));
    const bad = el => { el.classList.add('err'); el.focus(); toast('Controlla il campo evidenziato'); return false; };
    const remarks = $('#remarks').value.trim();
    if (kind() === 'sim') {
      const sim = parseHM($('#sim').value);
      if (!$('#sdate').value) return bad($('#sdate'));
      if (!sim || isNaN(sim)) return bad($('#sim'));
      Object.assign(rec, EMPTY(), { id: rec.id, src: rec.src, kind: 'sim', date: $('#sdate').value, simType: $('#simType').value.trim(), out: $('#sout').value.trim(), inn: $('#sinn').value.trim(), sim, picName: $('#spic').value.trim(), remarks });
    } else {
      const total = parseHM($('#total').value), night = parseHM($('#night').value), ifr = parseHM($('#ifr').value);
      if (!$('#date').value) return bad($('#date'));
      if (!/^[A-Z0-9]{3,4}$/i.test($('#dep').value.trim())) return bad($('#dep'));
      if (!/^[A-Z0-9]{3,4}$/i.test($('#arr').value.trim())) return bad($('#arr'));
      if (!total || isNaN(total)) return bad($('#total'));
      if (isNaN(night) || night > total) return bad($('#night'));
      if (isNaN(ifr) || ifr > total) return bad($('#ifr'));
      const role = form.role.value, mp = $('#mpOn').checked;
      let rem = remarks;
      if (role === 'PICUS' && !/picus/i.test(rem)) rem = (rem ? rem + '\n' : '') + 'PICUS';
      Object.assign(rec, {
        kind: 'flight', date: $('#date').value, dep: $('#dep').value.trim().toUpperCase(), arr: $('#arr').value.trim().toUpperCase(),
        out: $('#out').value.trim(), inn: $('#inn').value.trim(), off: $('#off').value.trim(), on: $('#on').value.trim(), reg: $('#reg').value.trim().toUpperCase(), type: $('#type').value.trim(),
        flightNo: $('#flightNo').value.trim(), picName: $('#picName').value.trim(), total, night, ifr,
        mp: mp ? total : 0, spMe: mp ? 0 : (rec.spSe ? 0 : total), spSe: mp ? 0 : (rec.spSe ? total : 0),
        pic: role === 'PIC' || role === 'PICUS' ? total : 0, sic: role === 'SIC' ? total : 0, dual: role === 'DUAL' ? total : 0,
        instr: $('#instrOn').checked ? total : 0, toDay: num($('#toDay').value), toNight: num($('#toNight').value),
        ldgDay: num($('#ldgDay').value), ldgNight: num($('#ldgNight').value), sim: 0, simType: '', remarks: rem,
        pax: num($('#pax').value), payload: parseDec($('#payload').value), fuelPlan: parseDec($('#fuelPlan').value), fuelUsed: parseDec($('#fuelUsed').value),
        approach: $('#approach').value.trim(), nm: calc ? calc.nm : (rec.nm || 0)
      });
    }
    rec.mt = Date.now(); delete rec.planned; delete rec.change; rec.seen = true;
    if (orig) data.flights[data.flights.findIndex(x => x.id === orig.id)] = rec; else data.flights.push(rec);
    await save(orig ? 'Modifiche salvate' : 'Volo salvato');
    location.hash = 'voli';
  };
}

// ---------- Stampa EASA ----------
const EASA_COLS = [ // [larghezza mm]
  13, 10, 9, 10, 9, 11, 14, 10, 10, 11, 11, 16, 8, 8, 8, 8, 11, 11, 10, 10, 11, 11, 13, 10, 0];
function easaPages(rowsPerPage) {
  const all = data.flights.filter(f => !f.planned); const pages = [];
  let prev = Object.fromEntries(SUM_KEYS.map(k => [k, data.opening?.[k] || 0]));
  for (let i = 0; i < all.length; i += rowsPerPage) {
    const rows = all.slice(i, i + rowsPerPage);
    const page = sum(rows);
    const tot = Object.fromEntries(SUM_KEYS.map(k => [k, prev[k] + page[k]]));
    pages.push({ n: pages.length + 1, rows, page, prev, tot, first: rows[0].date, lastd: rows[rows.length - 1].date });
    prev = tot;
  }
  return pages;
}
function easaPageHTML(p, rowsPerPage, totalPages) {
  const cg = `<colgroup>${EASA_COLS.map(w => w ? `<col style="width:${w}mm">` : '<col>').join('')}</colgroup>`;
  const head = `<thead><tr><th rowspan="2">DATE<br>(dd/mm/yy)</th><th colspan="2">DEPARTURE</th><th colspan="2">ARRIVAL</th><th colspan="2">AIRCRAFT</th><th colspan="2">SINGLE PILOT<br>TIME</th><th rowspan="2">MULTI<br>PILOT<br>TIME</th><th rowspan="2">TOTAL<br>TIME OF<br>FLIGHT</th><th rowspan="2">NAME<br>PIC</th><th colspan="2">TAKE-OFFS</th><th colspan="2">LANDINGS</th><th colspan="4">PILOT FUNCTION TIME</th><th colspan="2">OPERATIONAL<br>CONDITION TIME</th><th colspan="2">FSTD SESSION</th><th rowspan="2">REMARKS AND<br>ENDORSEMENTS</th></tr>
  <tr class="sub"><th>PLACE</th><th>TIME</th><th>PLACE</th><th>TIME</th><th>MAKE, MODEL<br>VARIANT</th><th>REGIS-<br>TRATION</th><th>SE</th><th>ME</th><th>DAY</th><th>NIGHT</th><th>DAY</th><th>NIGHT</th><th>PIC</th><th>CO-<br>PILOT</th><th>DUAL</th><th>INSTR.</th><th>NIGHT</th><th>IFR</th><th>TYPE</th><th>TOTAL<br>TIME</th></tr></thead>`;
  const n = v => v || '';
  const body = p.rows.map(f => f.kind === 'sim'
    ? `<tr><td>${dmy(f.date)}</td><td></td><td></td><td></td><td></td><td colspan="2">FSTD</td><td></td><td></td><td></td><td></td><td class="pn">${esc(f.picName)}</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td class="pn">${esc(f.simType)}</td><td>${hm(f.sim)}</td><td class="rem">${esc(f.remarks)}</td></tr>`
    : `<tr><td>${dmy(f.date)}</td><td>${esc(f.dep)}</td><td>${esc(f.out)}</td><td>${esc(f.arr)}</td><td>${esc(f.inn)}</td><td class="pn">${esc(f.type)}</td><td>${esc(f.reg)}</td><td>${hm(f.spSe)}</td><td>${hm(f.spMe)}</td><td>${hm(f.mp)}</td><td>${hm(f.total)}</td><td class="pn">${esc(f.picName)}</td><td>${n(f.toDay)}</td><td>${n(f.toNight)}</td><td>${n(f.ldgDay)}</td><td>${n(f.ldgNight)}</td><td>${hm(f.pic)}</td><td>${hm(f.sic)}</td><td>${hm(f.dual)}</td><td>${hm(f.instr)}</td><td>${hm(f.night)}</td><td>${hm(f.ifr)}</td><td></td><td></td><td class="rem">${esc(f.remarks)}</td></tr>`).join('')
    + Array.from({ length: rowsPerPage - p.rows.length }, () => `<tr>${'<td></td>'.repeat(25)}</tr>`).join('');
  const totRow = (lab, t, sig) => `<tr class="tot"><td colspan="7" class="lab">${lab}</td><td>${hm(t.spSe)}</td><td>${hm(t.spMe)}</td><td>${hm(t.mp)}</td><td>${hm(t.total)}</td><td></td><td>${n(t.toDay)}</td><td>${n(t.toNight)}</td><td>${n(t.ldgDay)}</td><td>${n(t.ldgNight)}</td><td>${hm(t.pic)}</td><td>${hm(t.sic)}</td><td>${hm(t.dual)}</td><td>${hm(t.instr)}</td><td>${hm(t.night)}</td><td>${hm(t.ifr)}</td><td></td><td>${hm(t.sim)}</td>${sig}</tr>`;
  const sig = `<td rowspan="3" class="sig">I, ${esc(data.pilot || '')}, certify that the entries in this log are true.<br><br>Pilot's signature ______________</td>`;
  return `<section class="easa-page"><table class="easa">${cg}${head}<tbody>${body}
    ${totRow('TOTAL THIS PAGE', p.page, sig)}${totRow('TOTAL FROM PREVIOUS PAGES', p.prev, '')}${totRow('TOTAL TIME', p.tot, '')}</tbody></table>
    <div class="easa-foot"><span>${esc(data.pilot || '')}</span><span>Page ${p.n} / ${totalPages}</span></div></section>`;
}
function viewPrint(main) {
  const st = viewPrint.st ||= { rpp: 18, from: '', to: '', last: (() => { try { return +localStorage.getItem('lastPages') || 3; } catch { return 3; } })() };
  const pages = easaPages(st.rpp);
  const sel = pages.filter(p => (!st.from || p.lastd >= st.from) && (!st.to || p.first <= st.to));
  const lastN = pages.slice(-Math.max(1, Math.min(st.last, pages.length)));
  const range = ps => ps.length ? `pagine ${ps[0].n}–${ps.at(-1).n}, dal ${dmy(ps[0].first)} al ${dmy(ps.at(-1).lastd)}` : '';
  const print = ps => { if (!ps.length) return; $('#printArea').innerHTML = ps.map(p => easaPageHTML(p, st.rpp, pages.length)).join(''); setTimeout(() => window.print(), 50); };
  main.innerHTML = `<h1>Stampa EASA</h1>
  <p class="lede">Formato logbook EASA (AMC1 FCL.050), ${pages.length} pagine da ${st.rpp} righe. Nel dialogo di stampa scegli "Salva come PDF".</p>
  <div class="panel"><h2>Ultime pagine del logbook</h2>
    <p>Quella che di solito chiede un'azienda: le pagine più recenti, con i riporti e il totale aggiornato.</p>
    <div class="row"><label>Ultime <input type="number" id="lastN" min="1" max="${pages.length}" value="${st.last}" style="width:64px" class="btn"> pagine</label>
      <button class="btn primary" id="doLast">Stampa le ultime ${lastN.length} pagine</button>
      <span class="hint">${range(lastN)}</span></div></div>
  <div class="panel"><h2>Per periodo</h2>
    <div class="row filters" style="margin:0">
      <label>Dal <input type="date" id="pf" value="${st.from}"></label>
      <label>Al <input type="date" id="pt" value="${st.to}"></label>
      <button class="btn" id="doPrint">Stampa ${st.from || st.to ? 'il periodo' : 'tutto il logbook'} (${sel.length} pagine)</button></div>
    <p class="hint" style="margin-top:8px">Le pagine mantengono la numerazione e i riporti del logbook completo.</p></div>
  <div class="row filters"><label>Righe per pagina <select id="rpp">${[14, 16, 18, 20, 22].map(v => `<option ${v === st.rpp ? 'selected' : ''}>${v}</option>`).join('')}</select></label></div>
  <div class="easa-preview" id="pv">${lastN.slice(-1).map(p => easaPageHTML(p, st.rpp, pages.length)).join('')}</div>
  <p class="hint">Anteprima dell'ultima pagina.</p>`;
  $('#rpp').onchange = e => { st.rpp = +e.target.value; viewPrint(main); };
  $('#pf').onchange = e => { st.from = e.target.value; viewPrint(main); };
  $('#pt').onchange = e => { st.to = e.target.value; viewPrint(main); };
  $('#lastN').onchange = e => { st.last = Math.max(1, Math.min(pages.length, parseInt(e.target.value, 10) || 1)); try { localStorage.setItem('lastPages', st.last); } catch { /* ok */ } viewPrint(main); };
  $('#doLast').onclick = () => print(lastN);
  $('#doPrint').onclick = () => print(sel);
}
window.addEventListener('afterprint', () => { $('#printArea').innerHTML = ''; });

// ---------- Dati, import, export ----------
function parseCSV(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const h = rows.shift().map(s => s.trim());
  return rows.filter(r => r.length > 1).map(r => Object.fromEntries(h.map((k, i) => [k, (r[i] ?? '').trim()])));
}
function flightLogRecord(x, regType) {
  const f = { ...EMPTY(), src: 'flightlog' };
  f.date = x['Date']; const reg = (x['Registration'] || '').toUpperCase();
  const m = k => parseHM(x[k]) || 0;
  if (!reg && (!x['Departure'] || x['Departure'] === '---')) {
    const o = toMin(x['Out']), i = toMin(x['In']);
    f.kind = 'sim'; f.out = x['Out']; f.inn = x['In'];
    f.sim = (o != null && i != null ? ((i - o) + 1440) % 1440 : 0) || m('Sim Time') || m('SIC Time') || m('PIC Time') || m('Total Block');
    f.simType = x['Flight Number']; f.picName = x['PIC Name']; f.remarks = x['Notes'];
    return f;
  }
  Object.assign(f, { dep: x['Departure'], arr: x['Arrival'], out: x['Out'], inn: x['In'], reg, type: regType[reg] || '', flightNo: x['Flight Number'] });
  const t = m('Total Block') || m('Total Flight');
  Object.assign(f, { total: t, mp: t, ifr: t, night: m('Night Time'), pic: m('PIC Time'), sic: m('SIC Time'), dual: m('DUAL Time'), instr: m('INS Time'),
    picName: x['PIC Name'], toDay: num(x['Takeoff']), ldgDay: num(x['Day Landing']), ldgNight: num(x['Night Landing']), remarks: x['Notes'],
    pax: num(x['Pax']), payload: parseDec(x['Payload']), fuelUsed: parseDec(x['Fuel']), fuelPlan: parseDec(x['Fuel Prev']), approach: x['Approaches'] || '', nm: num(x['Distance']), off: x['Off'] || '', on: x['On'] || '' });
  return f;
}
// file "sync" della cartella FlightLog Sync: completa i voli passati con pax, carburante, payload, avvicinamento e distanza
async function enrichFromFlightLog(rows) {
  if (!data) throw new Error('importa prima il logbook');
  const td = today(); let filled = 0, notFound = 0;
  const idx = new Map(data.flights.filter(f => f.kind === 'flight').map(f => [`${f.date}|${f.dep}|${f.out}`, f]));
  for (const x of rows) {
    if (x.sessiontype !== 'FLIGHT' || !x.outschedDate || x.outschedDate >= td) continue;
    const f = idx.get(`${x.outschedDate}|${x.OUTOACI}|${x.outreal}`);
    if (!f) { notFound++; continue; }
    const add = { pax: num(x.PAX), payload: parseDec(x.payload), fuelUsed: parseDec(x.fuel), fuelPlan: parseDec(x.fuel_prev), approach: x.ApproachType || '', nm: num(x.ortho), off: x.offtime || '', on: x.ontime || '' };
    let ch = false;
    for (const [k, v] of Object.entries(add)) if (v && !f[k]) { f[k] = v; ch = true; }
    if (ch) { f.mt = Date.now(); filled++; }
  }
  await save(`Completate ${filled} tratte con i dati di FlightLog${notFound ? `, ${notFound} non trovate` : ''}`);
  route();
}
async function importFile(file) {
  const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  if (/\.pdf$/i.test(file.name) || String.fromCharCode(...head) === '%PDF-') return importNetline(await file.arrayBuffer());
  const text = await file.text();
  if (/\.json$/i.test(file.name) || /^[{[]/.test(text.trim())) {
    const d = JSON.parse(text);
    if (Array.isArray(d) && d[0] && 'sessiontype' in d[0]) return enrichFromFlightLog(d);
    if (!d.flights || !Array.isArray(d.flights)) throw new Error('il file non contiene un logbook');
    if (data && data.flights.length && !confirm(`Sostituire il logbook attuale (${data.flights.length} righe) con quello del file (${d.flights.length} righe)?`)) return;
    normalizeTypes(d); d.forcePush = true; data = d; await save(`Importate ${d.flights.length} righe`); route(); return;
  }
  // CSV FlightLog: aggiunge solo le righe nuove
  const rows = parseCSV(text);
  if (!rows.length || !('Date' in rows[0]) || !('Registration' in rows[0])) throw new Error('non sembra un export CSV di FlightLog');
  if (!data) data = { version: 1, pilot: '', opening: Object.fromEntries(SUM_KEYS.map(k => [k, 0])), flights: [] };
  const regType = { ...KNOWN_AIRCRAFT }; for (const f of data.flights) if (f.reg && f.type) regType[f.reg] = f.type;
  const key = f => `${f.date}|${f.kind === 'sim' ? 'SIM' : f.dep}|${f.out}`;
  const have = new Set(data.flights.map(key));
  let added = 0, untyped = 0;
  for (const x of rows) {
    const f = flightLogRecord(x, regType);
    if (!f.date || have.has(key(f))) continue;
    f.id = nextId(); f.mt = Date.now(); data.flights.push(f); have.add(key(f)); added++;
    if (f.kind === 'flight' && !f.type) untyped++;
  }
  await save(added ? `Aggiunte ${added} righe da FlightLog` : 'Nessuna riga nuova nel CSV');
  if (untyped) toast(`${untyped} voli senza modello: completali da Voli`);
  route();
}
function download(name, text, type) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function exportCSV() {
  const cols = ['date', 'kind', 'dep', 'out', 'arr', 'inn', 'type', 'reg', 'spSe', 'spMe', 'mp', 'total', 'picName', 'toDay', 'toNight', 'ldgDay', 'ldgNight', 'night', 'ifr', 'pic', 'sic', 'dual', 'instr', 'simType', 'sim', 'remarks'];
  const timeCols = new Set(['spSe', 'spMe', 'mp', 'total', 'night', 'ifr', 'pic', 'sic', 'dual', 'instr', 'sim']);
  const q = v => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  const lines = [cols.join(','), ...data.flights.map(f => cols.map(c => q(String(timeCols.has(c) ? hm(f[c]) : (f[c] ?? '')))).join(','))];
  download(`logbook-${today()}.csv`, lines.join('\n'), 'text/csv');
}
const THEMES = [
  ['', 'Automatico', 'Neutro di giorno, Cockpit con il Mac in modalità scura', ['#f4f5f7', '#0f766e', '#9aa5b4', '#0b0e12', '#e15bd8']],
  ['neutro', 'Neutro', 'Chiaro e sobrio, PIC in verde petrolio', ['#ffffff', '#1d232c', '#0f766e', '#9aa5b4', '#d97706']],
  ['carta', 'Carta', 'Come un logbook cartaceo, PIC in bordeaux', ['#fffefb', '#22262b', '#8c1c2b', '#8f9aa6', '#c08a1e']],
  ['cockpit', 'Cockpit', 'Scuro, colori dei display Boeing', ['#0b0e12', '#141a21', '#e15bd8', '#3fc1d3', '#f2a900']]
];
function applyTheme(t) {
  if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  try { t ? localStorage.setItem('theme', t) : localStorage.removeItem('theme'); } catch { /* preferenza non salvata */ }
}
function viewData(main) {
  const n = data?.flights.length || 0;
  const cur = document.documentElement.dataset.theme || '';
  main.innerHTML = `<h1>Dati e backup</h1>
  <p class="lede">${n ? `${n} righe nel logbook${data.updated ? `, ultima modifica ${new Date(data.updated).toLocaleString('it-IT')}` : ''}.` : 'Il logbook è vuoto.'}</p>
  ${drivePanelHTML()}
  <div class="panel"><h2>Colori</h2>
    <div class="theme-pick" role="radiogroup" aria-label="Colori">${THEMES.map(([k, name, desc, sw]) => `<label><input type="radio" name="theme" value="${k}" ${k === cur ? 'checked' : ''}><div class="sw">${sw.map(c => `<i style="background:${c}"></i>`).join('')}</div><b>${name}</b><span>${desc}</span></label>`).join('')}</div></div>
  <div class="panel"><h2>Cartella di backup</h2>
    <p>L'app salva <b>logbook.json</b> nella cartella a ogni modifica, più una copia giornaliera nella sottocartella <b>storico</b>. Scegli iCloud Drive › Logbook per averla anche nel cloud.</p>
    <div class="row"><button class="btn primary" id="dChoose">${dirHandle ? 'Cambia cartella' : 'Scegli cartella'}</button>${dirHandle ? `<span class="hint">Attuale: ${esc(dirHandle.name)}</span>` : ''}</div>
    ${fsSupported ? '' : '<p class="hint">Questo browser non permette di scrivere in una cartella: apri l\'app con Chrome.</p>'}</div>
  <div class="panel"><h2>Importa</h2>
    <p><b>logbook.json</b> sostituisce tutto il logbook. Un <b>CSV esportato da FlightLog</b> aggiunge solo i voli che non ci sono ancora (stessa data, partenza e orario). Un <b>PDF Individual duty plan di NetLine</b> aggiunge i voli nuovi con gli orari schedulati, da completare con gli effettivi; i voli già nel logbook non vengono toccati. Il file <b>sync</b> della cartella FlightLog Sync completa i voli passati con passeggeri, carburante, payload, avvicinamento e distanza, senza toccare il resto.</p>
    <div class="row"><input type="file" id="dFile"></div></div>
  <div class="panel"><h2>Esporta</h2>
    <p>Una copia da conservare o da aprire in un foglio di calcolo.</p>
    <div class="row"><button class="btn" id="dJson" ${n ? '' : 'disabled'}>Scarica logbook.json</button><button class="btn" id="dCsv" ${n ? '' : 'disabled'}>Scarica CSV</button></div></div>
  ${n ? `<div class="panel"><h2>Intestazione e riporto iniziale</h2>
    <div class="row"><label>Nome sul logbook <input id="dPilot" value="${esc(data.pilot || '')}" class="btn" style="text-align:left"></label><button class="btn" id="dPilotSave">Salva nome</button></div>
    <p class="hint">Riporto ante 2007: ${hm0(data.opening?.total)} totali, ${hm0(data.opening?.pic)} PIC, ${hm0(data.opening?.sic)} copilota, ${hm0(data.opening?.sim)} simulatore.</p></div>` : ''}`;
  main.querySelectorAll('input[name=theme]').forEach(r => r.onchange = () => applyTheme(r.value));
  bindDrivePanel(main);
  $('#dChoose').onclick = chooseFolder;
  $('#dFile').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { await importFile(f); } catch (err) { toast('Importazione non riuscita: ' + err.message); } e.target.value = ''; };
  if (n) {
    $('#dJson').onclick = () => download(`logbook-${today()}.json`, JSON.stringify(data, null, 1), 'application/json');
    $('#dCsv').onclick = exportCSV;
    $('#dPilotSave').onclick = async () => { data.pilot = $('#dPilot').value.trim(); data.metaMt = Date.now(); await save('Nome salvato'); };
  }
}



// ---------- NetLine: voli programmati dal PDF "Individual duty plan" ----------
// I voli già nel logbook non si toccano mai. Entrano solo i voli nuovi, con i blocchi schedulati, segnati come programmati
// (fuori dai totali) con il pallino finché non si apre il volo. Se un volo ancora programmato cambia nel turno, si aggiorna e riprende il pallino.
let IATA = null;
async function importNetline(buf) {
  if (!data) throw new Error('importa prima il logbook');
  toast('Leggo il PDF NetLine…');
  const pdfjs = await import(new URL('lib/netline/pdf.min.mjs', location.href).href);
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('lib/netline/pdf.worker.min.mjs', location.href).href;
  const { parsePdf } = await import(new URL('lib/netline/parser.js', location.href).href);
  const roster = await parsePdf(pdfjs, buf);
  await loadAirports();
  IATA ||= await fetch('data/iata.json').then(r => r.json());
  const me = roster.meta?.pilotCode || '';
  const icao = c => IATA[c] || c;
  const legs = [];
  for (const d of roster.days || []) for (const l of d.legs || []) if (l.kind === 'flight') legs.push({ d, l });
  if (!legs.length) throw new Error('nel PDF non ho trovato voli: è un Individual duty plan di NetLine?');
  const hhmm = t => t ? `${t.slice(0, 2)}:${t.slice(2)}` : '';
  const key = f => `${f.date}|${f.dep}|${f.arr}`;
  const byKey = new Map(); for (const f of data.flights) if (f.kind === 'flight') byKey.set(key(f), f);
  let added = 0, updated = 0, untouched = 0, gone = 0;
  const seenKeys = new Set();
  for (const { d, l } of legs) {
    const dep = icao(l.dep), arr = icao(l.arr), out = hhmm(l.depTime), inn = hhmm(l.arrTime);
    const k = `${d.date}|${dep}|${arr}`; seenKeys.add(k);
    const cockpit = l.crew?.cockpit || [];
    const mine = cockpit.find(c => c.code === me);
    const iAmCaptain = cockpit.length ? cockpit[0].code === me : true;
    const total = ((toMin(inn) - toMin(out)) + 1440) % 1440;
    const nc = nightCalc(d.date, out, inn, dep, arr);
    const to = /TKO/.test(mine?.tag || '') ? 1 : 0, ld = /LND/.test(mine?.tag || '') ? 1 : 0;
    const fields = {
      date: d.date, dep, arr, out, inn, sched: { out, inn }, flightNo: `${l.airline || ''}${l.number || ''}`, acHint: l.ac || '',
      total, mp: total, ifr: total, pic: iAmCaptain ? total : 0, sic: iAmCaptain ? 0 : total, picName: iAmCaptain ? 'SELF' : (cockpit[0]?.code || ''),
      night: nc ? nc.night : 0, nm: nc ? nc.nm : 0,
      toDay: to && !(nc?.toNight) ? 1 : 0, toNight: to && nc?.toNight ? 1 : 0, ldgDay: ld && !(nc?.ldgNight) ? 1 : 0, ldgNight: ld && nc?.ldgNight ? 1 : 0,
      remarks: cockpit.length ? `Equipaggio: ${cockpit.map(c => c.code).join(' ')}` : ''
    };
    const ex = byKey.get(k);
    if (ex && !ex.planned) { untouched++; continue; }       // già nel logbook con gli effettivi: non si tocca
    if (ex && ex.planned) {
      if (ex.sched?.out !== out || ex.sched?.inn !== inn) {
        ex.change = `orario cambiato da ${ex.sched?.out}–${ex.sched?.inn} a ${out}–${inn}`;
        Object.assign(ex, fields, { seen: false, mt: Date.now() }); updated++;
      } else if (ex.change === 'non più nel turno') { delete ex.change; ex.seen = false; ex.mt = Date.now(); updated++; }
      continue;
    }
    const rec = { ...EMPTY(), ...fields, id: nextId(), kind: 'flight', type: '', reg: '', src: 'netline', planned: true, seen: false, mt: Date.now() };
    data.flights.push(rec); byKey.set(k, rec); added++;
  }
  // voli ancora programmati nel periodo del PDF che nel turno nuovo non ci sono più
  const p0 = roster.meta?.periodStart, p1 = roster.meta?.periodEnd;
  if (p0 && p1) for (const f of data.flights) if (f.planned && f.date >= p0 && f.date <= p1 && !seenKeys.has(key(f)) && f.change !== 'non più nel turno') { f.change = 'non più nel turno'; f.seen = false; f.mt = Date.now(); gone++; }
  const parts = [`${added} voli nuovi`, updated && `${updated} cambiati`, gone && `${gone} non più nel turno`, untouched && `${untouched} già nel logbook non toccati`].filter(Boolean);
  await save('NetLine: ' + parts.join(', '));
  updateBadge(); route();
}
function plannedLate() {
  const now = Date.now();
  return data.flights.filter(f => f.planned && Date.parse(`${f.date}T${f.inn || '23:59'}:00Z`) + (toMin(f.inn) < toMin(f.out) ? 86400000 : 0) < now);
}
function plannedBanner() {
  const late = plannedLate();
  if (!late.length) return '';
  return `<div class="plan-alert" role="alert"><b>${late.length === 1 ? '1 volo già fatto ha' : `${late.length} voli già fatti hanno`} ancora gli orari schedulati.</b> Inserisci gli orari effettivi per farli entrare nei totali.
    <button class="btn small" data-plan-go>Mostrali</button></div>`;
}
function bindPlannedBanner(main) { const b = main.querySelector('[data-plan-go]'); if (b) b.onclick = () => { viewFlights.st = { year: '', type: '__planned', q: '', all: false }; location.hash === '#voli' ? route() : (location.hash = 'voli'); }; }
function updateBadge() {
  const a = document.querySelector('.side a[data-view="voli"]'); if (!a || !data) return;
  const n = data.flights.filter(f => f.planned && !f.seen).length;
  let b = a.querySelector('.badge'); if (!n) { b?.remove(); return; }
  if (!b) { b = document.createElement('span'); b.className = 'badge'; a.append(b); }
  b.textContent = n; b.title = `${n} voli da vedere`;
}

// ---------- Google Drive: un unico logbook per Mac, iPhone e iPad ----------
const GD_CLIENT_ID = '541510620978-gs4am93a0a224qa0lvg7uaqq5c1919tb.apps.googleusercontent.com';   // ID client OAuth di Google (non è segreto); si può anche incollare in Dati e backup
const GD_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const ls = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* ok */ } } };
const ss = { get: k => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch { /* ok */ } } };
const GD = { token: ss.get('gdTok'), exp: +ss.get('gdExp') || 0, state: '', msg: '', busy: false };
const gdClientId = () => GD_CLIENT_ID || ls.get('gdClient') || '';
const gdConnected = () => !!gdClientId() && ls.get('gdOn') === '1';
const gdTokenOk = () => GD.token && Date.now() < GD.exp - 60000;

let gisLoading = null;
function gisLoad() {
  return gisLoading ||= new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.onload = res; s.onerror = () => { gisLoading = null; rej(new Error('Google non raggiungibile, controlla la connessione')); }; document.head.append(s); });
}
async function gdToken(interactive) {
  if (gdTokenOk()) return GD.token;
  if (!interactive) throw Object.assign(new Error('accesso a Google da rinnovare'), { auth: true });
  await gisLoad();
  return new Promise((res, rej) => {
    const tc = google.accounts.oauth2.initTokenClient({
      client_id: gdClientId(), scope: GD_SCOPE,
      callback: r => { if (r.error) return rej(new Error(r.error_description || r.error)); GD.token = r.access_token; GD.exp = Date.now() + r.expires_in * 1000; ss.set('gdTok', GD.token); ss.set('gdExp', GD.exp); res(GD.token); },
      error_callback: e => rej(new Error(e.type === 'popup_closed' ? 'accesso annullato' : e.type === 'popup_failed_to_open' ? 'il browser ha bloccato la finestra di Google' : (e.message || e.type)))
    });
    tc.requestAccessToken({ prompt: ls.get('gdOn') === '1' ? '' : 'consent' });
  });
}
async function gdFetch(url, opt = {}) {
  const r = await fetch(url, { ...opt, headers: { ...(opt.headers || {}), Authorization: 'Bearer ' + GD.token } });
  if (r.status === 401) { GD.token = null; ss.set('gdTok', null); throw Object.assign(new Error('accesso a Google scaduto'), { auth: true }); }
  if (!r.ok) throw new Error(`Google Drive ${r.status}: ${(await r.text()).slice(0, 140)}`);
  return r;
}
const GAPI = 'https://www.googleapis.com/drive/v3/files', GUP = 'https://www.googleapis.com/upload/drive/v3/files';
async function gdFindFile() {
  const known = ls.get('gdFile');
  if (known) {
    try { const j = await (await gdFetch(`${GAPI}/${known}?fields=id,trashed`)).json(); if (!j.trashed) return known; } catch (e) { if (e.auth) throw e; }
  }
  const q = encodeURIComponent("name='logbook.json' and trashed=false and appProperties has { key='logbook' and value='1' }");
  const j = await (await gdFetch(`${GAPI}?q=${q}&fields=files(id,modifiedTime)&orderBy=modifiedTime desc`)).json();
  const id = j.files?.[0]?.id || null; ls.set('gdFile', id); return id;
}
async function gdFolder() {
  const q = encodeURIComponent("name='Logbook' and mimeType='application/vnd.google-apps.folder' and trashed=false");
  const j = await (await gdFetch(`${GAPI}?q=${q}&fields=files(id)`)).json();
  if (j.files?.[0]) return j.files[0].id;
  const c = await (await gdFetch(GAPI, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Logbook', mimeType: 'application/vnd.google-apps.folder' }) })).json();
  return c.id;
}
async function gdUpload(id, obj) {
  const body = JSON.stringify(obj);
  if (id) { await gdFetch(`${GUP}/${id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body }); return id; }
  const meta = { name: 'logbook.json', parents: [await gdFolder()], mimeType: 'application/json', appProperties: { logbook: '1' } };
  const bnd = 'lb' + Date.now();
  const multipart = `--${bnd}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${bnd}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${bnd}--`;
  const j = await (await gdFetch(`${GUP}?uploadType=multipart&fields=id`, { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + bnd }, body: multipart })).json();
  ls.set('gdFile', j.id); return j.id;
}
// unione riga per riga: vince la modifica più recente, le cancellazioni restano cancellate
function mergeData(local, remote) {
  const del = { ...(remote.deleted || {}) };
  for (const [k, v] of Object.entries(local.deleted || {})) del[k] = Math.max(v, del[k] || 0);
  const m = new Map();
  for (const f of remote.flights) m.set(f.id, f);
  for (const f of local.flights) { const o = m.get(f.id); if (!o || (f.mt || 0) >= (o.mt || 0)) m.set(f.id, f); }
  const flights = [...m.values()].filter(f => !(del[f.id] && del[f.id] >= (f.mt || 0)));
  const meta = (local.metaMt || 0) >= (remote.metaMt || 0) ? local : remote;
  return { version: meta.version || 1, pilot: meta.pilot, opening: meta.opening, metaMt: meta.metaMt || 0, generated: meta.generated, updated: [local.updated, remote.updated].sort().at(-1), deleted: del, flights };
}
const sig = d => d ? `${d.flights.length}|${d.flights.reduce((s, f) => s + (f.mt || 0), 0)}|${Object.keys(d.deleted || {}).length}|${d.metaMt || 0}|${d.pilot}` : '';
async function syncNow(interactive) {
  if (!gdClientId() || GD.busy) return;
  GD.busy = true; GD.state = 'sync'; renderSyncState();
  try {
    await gdToken(interactive);
    ls.set('gdOn', '1');
    const id = await gdFindFile();
    const remote = id ? await (await gdFetch(`${GAPI}/${id}?alt=media`)).json() : null;
    let merged;
    if (!remote) merged = data;
    else if (!data || !data.flights.length) merged = remote;
    else if (data.forcePush) merged = data;
    else merged = mergeData(data, remote);
    if (merged) delete merged.forcePush;
    const localChanged = sig(merged) !== sig(data), remoteChanged = !remote || sig(merged) !== sig(remote) || data?.forcePush;
    if (merged && (localChanged || data?.forcePush)) {
      data = merged; normalizeTypes(data); sortFlights(); await idb.set('data', data); scheduleBackup();
      if (localChanged && !/nuovo|modifica/.test(location.hash)) route();
      updateBadge();
    }
    if (merged && remoteChanged) await gdUpload(id, merged);
    GD.state = 'ok'; GD.msg = ''; ls.set('gdLast', new Date().toISOString());
  } catch (e) {
    GD.state = e.auth ? 'login' : 'err'; GD.msg = e.message;
    if (interactive) toast('Sincronizzazione non riuscita: ' + e.message);
  } finally { GD.busy = false; renderSyncState(); if (location.hash === '#dati') route(); }
}
let syncTimer;
function scheduleSync() { if (gdConnected() && gdTokenOk()) { clearTimeout(syncTimer); syncTimer = setTimeout(() => syncNow(false), 1500); } else if (gdConnected()) { GD.state = 'login'; renderSyncState(); } }
function renderSyncState() {
  let el = $('#syncState');
  if (!el) { el = document.createElement('div'); el.id = 'syncState'; el.className = 'sync-state'; $('#backupState').before(el); }
  if (!gdClientId()) { el.innerHTML = ''; el.hidden = true; return; }
  el.hidden = false;
  const last = ls.get('gdLast');
  const when = last ? new Date(last).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '';
  if (!gdConnected()) el.innerHTML = `Google Drive non collegato.<br><button class="btn small" id="sySync">Collega Google Drive</button>`;
  else if (GD.state === 'sync') el.innerHTML = 'Google Drive: sincronizzo…';
  else if (GD.state === 'err') el.innerHTML = `Google Drive: ${esc(GD.msg)}<br><button class="btn small" id="sySync">Riprova</button>`;
  else if (GD.state === 'login' || !gdTokenOk()) el.innerHTML = `Google Drive${when ? `: ultima sincronizzazione alle ${when}` : ''}.<br><button class="btn small" id="sySync">Sincronizza</button>`;
  else el.innerHTML = `Google Drive sincronizzato${when ? ` alle ${when}` : ''}`;
  const b = $('#sySync'); if (b) b.onclick = () => syncNow(true);
}
function drivePanelHTML() {
  const cid = gdClientId(), last = ls.get('gdLast');
  return `<div class="panel"><h2>Google Drive</h2>
    <p>Collega il tuo Google Drive per usare lo stesso logbook sul Mac, sull'iPhone e sull'iPad. Il file è <b>Logbook/logbook.json</b> nel tuo Drive e si aggiorna da solo a ogni modifica.</p>
    ${cid ? `<div class="row">
        <button class="btn primary" id="gdSync">${gdConnected() ? 'Sincronizza ora' : 'Collega Google Drive'}</button>
        ${gdConnected() ? '<button class="btn" id="gdOff">Scollega questo dispositivo</button>' : ''}
        <span class="hint">${gdConnected() ? (last ? `Ultima sincronizzazione ${new Date(last).toLocaleString('it-IT')}` : 'Non ancora sincronizzato') : ''}${GD.state === 'err' ? `. Errore: ${esc(GD.msg)}` : ''}</span></div>`
      : `<p class="hint">Serve prima l'ID client di Google (si crea una volta nella Google Cloud Console). Incollalo qui:</p>
      <div class="row"><input id="gdCid" class="btn" style="flex:1;min-width:260px;text-align:left" placeholder="123456-abc.apps.googleusercontent.com"><button class="btn" id="gdCidSave">Salva</button></div>`}
  </div>`;
}
function bindDrivePanel(main) {
  const s = main.querySelector('#gdSync'); if (s) s.onclick = () => syncNow(true);
  const o = main.querySelector('#gdOff'); if (o) o.onclick = () => { if (!confirm('Scollegare Google Drive da questo dispositivo? I dati restano sia qui sia su Drive.')) return; ls.set('gdOn', null); ls.set('gdFile', null); GD.token = null; ss.set('gdTok', null); renderSyncState(); route(); };
  const c = main.querySelector('#gdCidSave'); if (c) c.onclick = () => { const v = main.querySelector('#gdCid').value.trim(); if (!/\.apps\.googleusercontent\.com$/.test(v)) return toast('Non sembra un ID client di Google'); ls.set('gdClient', v); renderSyncState(); route(); };
}
function driveStartup() {
  renderSyncState();
  if (gdConnected() && gdTokenOk()) syncNow(false);
  window.addEventListener('online', () => { if (gdConnected() && gdTokenOk()) syncNow(false); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && gdConnected() && gdTokenOk()) syncNow(false); });
}

// ---------- avvio ----------
(async () => {
  try { data = await idb.get('data') || null; } catch (e) { toast('Archivio locale non disponibile: ' + e.message); }
  if (data && normalizeTypes(data)) await save('Nomi di aerei e simulatori aggiornati');
  try {
    dirHandle = await idb.get('dir') || null;
    if (dirHandle && (await dirHandle.queryPermission({ mode: 'readwrite' })) === 'granted') { backupOk = true; lastBackup = data?.updated ? new Date(data.updated) : new Date(); }
  } catch { dirHandle = null; }
  $('#version').textContent = `Versione ${APP_VERSION} del ${APP_DATE}`;
  renderBackupState();
  route();
  updateBadge();
  driveStartup();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw?.addEventListener('statechange', () => { if (nw.state === 'activated' && navigator.serviceWorker.controller) toast('App aggiornata: ricarica la pagina per la nuova versione'); });
      });
    }).catch(() => {});
  }
})();
