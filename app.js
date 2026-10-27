'use strict';
const APP_VERSION = '2.9.5';
const APP_DATE = '27/10/2026';
/* Logbook – PWA locale. Tutti i dati restano nel browser (IndexedDB) e nella cartella di backup scelta. */

// ---------- utilità ----------
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hm = m => { m = Math.round(m || 0); if (!m) return ''; const s = m < 0 ? '-' : ''; m = Math.abs(m); return `${s}${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };
const hm0 = m => hm(m) || '0:00';
const avg = s => s.legs ? hm(Math.round(s.total / s.legs)) : '';
// durate: "5:40", "5.40", "540" (= 5:40), "5" (= 5:00)
const parseHM = s => { s = String(s || '').trim().replace('.', ':'); if (!s) return 0; if (/^\d{3,6}$/.test(s)) s = s.slice(0, -2) + ':' + s.slice(-2); const m = s.match(/^(\d{1,5})(?::(\d{1,2}))?$/); if (!m) return NaN; return +m[1] * 60 + (+m[2] || 0); };
// orari: "0636", "636", "06:36", "6.36", "6" diventano "06:36" / "06:00"
function normTime(v) {
  v = String(v || '').trim().replace(/[.,h ]/g, ':'); if (!v) return '';
  let h, m;
  if (/^\d{1,2}:\d{1,2}$/.test(v)) [h, m] = v.split(':').map(Number);
  else if (/^\d{3,4}$/.test(v)) { h = +v.slice(0, -2); m = +v.slice(-2); }
  else if (/^\d{1,2}$/.test(v)) { h = +v; m = 0; }
  else return v;
  if (h > 23 || m > 59) return v;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
const normDur = v => { const n = parseHM(v); return v && !isNaN(n) ? hm0(n) : v; };
const toMin = t => { const m = normTime(t).match(/^(\d{2}):(\d{2})$/); return m ? +m[1] * 60 + +m[2] : null; };
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
const CODE_FIX = { LZSZ: 'LSZS', LZSB: 'LSZB', DZNT: 'DTNH', EGRP: 'EGPH' };
// doppioni: stessa tratta (data, partenza, arrivo, OUT) registrata due volte, o un volo pianificato già volato.
// Tiene la riga più completa (bloccata, con gli effettivi), le aggiunge i campi che mancano, e cancella le altre anche sugli altri dispositivi.
function dedupe(d) {
  if (!d?.flights) return 0;
  const filled = f => Object.entries(f).filter(([k, v]) => v && !['id', 'mt', 'src', 'seen'].includes(k)).length;
  const score = f => (f.locked ? 1000 : 0) + (f.planned ? 0 : 500) + filled(f);
  const groups = new Map();
  for (const f of d.flights) {
    const k = f.kind === 'sim' ? `S|${f.date}|${f.out}|${f.sim}` : f.planned ? null : `F|${f.date}|${f.dep}|${f.arr}|${f.out}`;
    if (k) (groups.get(k) || groups.set(k, []).get(k)).push(f);
  }
  // pianificati già volati: stessa data, partenza e arrivo di una tratta con gli effettivi
  const flown = new Map(); for (const f of d.flights) if (f.kind === 'flight' && !f.planned) flown.set(`${f.date}|${f.dep}|${f.arr}`, f);
  for (const f of d.flights) if (f.planned) { const a = flown.get(`${f.date}|${f.dep}|${f.arr}`); if (a && Math.abs(((toMin(a.out) - toMin(f.sched?.out || f.out)) + 2160) % 1440 - 720) <= 240) { const k = `F|${a.date}|${a.dep}|${a.arr}|${a.out}`; groups.get(k).push(f); } }
  const gone = new Set(), now = Date.now();
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => score(b) - score(a));
    const keep = list[0];
    for (const o of list.slice(1)) {
      for (const [k, v] of Object.entries(o)) if (v && !keep[k] && !['id', 'planned', 'mt', 'change', 'seen'].includes(k)) keep[k] = v;
      if (o.flightNo && !keep.flightNo) keep.flightNo = o.flightNo;
      if (o.sched && !keep.sched) keep.sched = o.sched;
      gone.add(o.id);
    }
    keep.mt = now;
  }
  if (!gone.size) return 0;
  const del = (d.deleted ||= {}); for (const id of gone) del[id] = now;
  d.flights = d.flights.filter(f => !gone.has(f.id));
  return gone.size;
}
function normalizeTypes(d) {
  let n = dedupe(d);
  for (const f of d?.flights || []) if (f.kind === 'sim' && !f.simReg && SIM_SESSIONS[f.date] && !d.simRegDone) { f.simReg = SIM_SESSIONS[f.date]; f.mt = Date.now(); n++; }
  if (d && !d.simRegDone) { d.simRegDone = 1; n++; }
  // una volta sola: lucchetto a tutte le tratte già registrate (non ai voli pianificati dal roster)
  if (d && !d.lockAllDone) { const now = Date.now(); for (const f of d.flights || []) if (!f.planned && !f.locked) { f.locked = true; f.mt = now; } d.lockAllDone = 1; n++; }
  // marche scritte senza trattino (EIRZE) -> come nella flotta (EI-RZE)
  const byNorm = new Map(Object.keys(KNOWN_AIRCRAFT).map(r => [r.replace(/[^A-Z0-9]/g, ''), r]));
  for (const f of d?.flights || []) if (f.kind === 'flight' && f.reg && !KNOWN_AIRCRAFT[f.reg]) { const r = byNorm.get(f.reg.toUpperCase().replace(/[^A-Z0-9]/g, '')); if (r && r !== f.reg) { f.reg = r; if (!f.type) f.type = KNOWN_AIRCRAFT[r]; f.mt = Date.now(); n++; } }
  for (const f of d?.flights || []) if (f.src === 'netline' && /^Equipaggio: /.test(f.remarks || '')) { f.crew = f.remarks.replace(/^Equipaggio: /, ''); f.remarks = ''; f.mt = Date.now(); n++; }
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
// simulatori: matricola del dispositivo -> tipo (dalla flotta FlightLog), più quelli aggiunti a mano in data.simulators
const SIM_FLEET = { 'B787/B777 FSTD NL-787': 'Boeing 787-9[3]', 'DE-1A-113': 'Boeing 787-9[3]', 'DE1A-049': 'BOEING 747-400', 'EU-A0244': 'BOEING 787-9 Dreamliner', 'EU-A0250': 'BOEING 787-9 Dreamliner', 'EU-UKFB607': 'BOEING 787-9 Dreamliner', 'EU-UKFB637': 'BOEING 787-9 Dreamliner', 'I-T.081': 'BOEING 737-800', 'LT.FSTD.18': 'BOEING 737-800', 'SIM B747': 'BOEING 747-400', 'SIM B748': 'BOEING 747-8', 'SIM B787/B777 NL-787': 'BOEING 787-9 Dreamliner', 'SIM LU002 B744': 'BOEING 747-400', 'SIM LU003 B748': 'BOEING 747-8' };
const SIM_NOTES = { 'I-T.081': 'B737-800W', 'LT.FSTD.18': 'B737-8 MAX s/n 2051' };
// sessioni FlightLog: data -> simulatore usato
const SIM_SESSIONS = {"2026-10-20":"I-T.081","2026-08-28":"I-T.081","2026-08-27":"I-T.081","2026-08-26":"I-T.081","2026-07-06":"I-T.081","2026-07-04":"LT.FSTD.18","2026-07-03":"LT.FSTD.18","2026-07-02":"LT.FSTD.18","2026-07-01":"LT.FSTD.18","2026-06-27":"I-T.081","2026-06-26":"I-T.081","2026-06-24":"I-T.081","2026-06-23":"I-T.081","2026-06-22":"I-T.081","2026-06-19":"I-T.081","2026-06-18":"I-T.081","2026-01-24":"EU-UKFB607","2026-01-23":"EU-UKFB607","2025-09-07":"EU-UKFB607","2025-09-06":"EU-UKFB607","2025-02-24":"EU-A0250","2025-02-23":"EU-A0250","2024-09-06":"DE-1A-113","2024-09-05":"DE-1A-113","2024-03-17":"DE-1A-113","2024-03-16":"DE-1A-113","2024-03-15":"DE-1A-113","2024-02-19":"B787/B777 FSTD NL-787","2024-02-18":"SIM B787/B777 NL-787","2024-02-17":"SIM B787/B777 NL-787","2024-02-16":"SIM B787/B777 NL-787","2024-02-14":"SIM B787/B777 NL-787","2024-02-13":"SIM B787/B777 NL-787","2024-02-12":"SIM B787/B777 NL-787","2023-10-22":"SIM LU002 B744","2023-10-21":"SIM LU003 B748","2023-05-24":"SIM B747","2023-05-21":"SIM B748","2023-05-20":"SIM B748","2023-05-19":"SIM B747","2022-10-27":"SIM B747","2022-10-26":"SIM B747","2022-07-14":"SIM B747","2022-07-13":"SIM B747","2022-05-25":"DE1A-049","2022-02-28":"DE1A-049","2022-02-25":"DE1A-049","2022-02-22":"DE1A-049","2021-09-02":"DE1A-049","2021-09-01":"DE1A-049","2021-05-07":"DE1A-049","2021-05-06":"DE1A-049"};
const simFleet = () => ({ ...SIM_FLEET, ...Object.fromEntries(Object.entries(data?.simulators || {}).map(([k, v]) => [k, v.type])) });
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
  } catch (e) { backupOk = false; console.error(e); toast('Backup failed: ' + e.message); }
  renderBackupState();
}
async function chooseFolder() {
  if (!fsSupported) { toast('Folder backup requires Chrome. Use Export in the meantime.'); return; }
  try {
    const h = await window.showDirectoryPicker({ id: 'logbook-backup', mode: 'readwrite', startIn: 'documents' });
    dirHandle = h; await idb.set('dir', h);
    // se la cartella contiene già un logbook e l'app è vuota, lo carico
    let existing = null;
    try { const fh = await h.getFileHandle('logbook.json'); existing = JSON.parse(await (await fh.getFile()).text()); } catch { /* nessun file */ }
    if (existing && existing.flights) {
      const useIt = !data || !data.flights.length ||
        (existing.updated && data.updated && existing.updated > data.updated &&
         confirm(`The folder contains a newer logbook (${existing.flights.length} entries, saved ${new Date(existing.updated).toLocaleString('en-GB')}). Load it instead of the one in the app?`));
      if (useIt) { data = existing; await idb.set('data', data); toast('Logbook loaded from folder'); route(); }
    }
    await writeBackup();
    if (backupOk) toast(`Backup active in folder "${h.name}"`);
  } catch (e) { if (e.name !== 'AbortError') toast('Folder not available: ' + e.message); }
}
async function reconnectFolder() {
  if (!dirHandle) return chooseFolder();
  if ((await dirHandle.requestPermission({ mode: 'readwrite' })) === 'granted') { await writeBackup(); toast('Backup re-enabled'); }
}
function renderBackupState() {
  const el = $('#backupState'); if (!el) return;
  if (!fsSupported) { el.innerHTML = 'Folder backup not available in this browser.<br>Open the app in Chrome.'; return; }
  if (!dirHandle) { el.innerHTML = 'No backup folder.<br><button class="btn small" id="bkChoose">Choose folder</button>'; $('#bkChoose').onclick = chooseFolder; return; }
  if (!backupOk) { el.innerHTML = `Backup paused: Chrome needs you to confirm access to <b>${esc(dirHandle.name)}</b>.<br><button class="btn small" id="bkRe">Resume backup</button>`; $('#bkRe').onclick = reconnectFolder; return; }
  el.innerHTML = `Backup in <b>${esc(dirHandle.name)}</b><br>saved at ${lastBackup.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
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
const fmtN = n => Math.round(n).toLocaleString('en-GB');
const parseDec = v => { const n = parseFloat(String(v || '').replace(',', '.')); return n > 0 ? n : 0; };

// ---------- calcoli ----------
function sum(list, withOpening) {
  const t = Object.fromEntries(SUM_KEYS.map(k => [k, 0])); t.legs = 0; t.sims = 0;
  if (withOpening && data.opening) for (const k of SUM_KEYS) t[k] += data.opening[k] || 0;
  t.nm = 0; t.pax = 0; t.paxLegs = 0; t.fuelUsed = 0; t.fuelLegs = 0; t.payload = 0;
  for (const f of list) { if (f.planned) continue; for (const k of SUM_KEYS) t[k] += f[k] || 0; if (f.kind === 'sim') t.sims++; else { t.legs++; t.nm += nmOf(f); if (f.pax) { t.pax += f.pax; t.paxLegs++; } if (f.fuelUsed) { t.fuelUsed += f.fuelUsed; t.fuelLegs++; } t.payload += f.payload || 0; } }
  return t;
}
const roleOf = f => f.kind === 'sim' ? 'SIM' : f.pic > 0 ? (/picus/i.test(f.remarks) ? 'PICUS' : 'PIC') : f.dual > 0 ? 'DUAL' : f.sic > 0 ? (/lifus/i.test(f.remarks) ? 'LIFUS' : 'SIC') : '';
function flightsIn(from, to) { return data.flights.filter(f => (!from || f.date >= from) && (!to || f.date <= to)); }

// ---------- router ----------
const views = { riepilogo: viewSummary, voli: viewFlights, mappa: m => loadMap().then(() => viewMap(m)), nuovo: viewEdit, modifica: viewEdit, stampa: viewPrint, dati: viewData, stat: m => viewStats(m) };
// librerie della mappa caricate solo quando serve
let mapLoading = null;
function loadMap() {
  const js = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('file ' + src + ' not available')); document.head.append(s); });
  return mapLoading ||= js('lib/d3-array.min.js').then(() => js('lib/d3-geo.min.js')).then(() => js('lib/topojson-client.min.js')).then(() => js('map.js'))
    .catch(e => { mapLoading = null; $('#main').innerHTML = `<h1>Map</h1><p class="lede">${esc(e.message)}. Open the app once while online.</p>`; throw e; });
}
function route() {
  const [v, arg] = (location.hash.slice(1) || 'riepilogo').split('/');
  const view = views[v] ? v : 'riepilogo';
  document.querySelectorAll('.side a').forEach(a => a.classList.toggle('active', a.dataset.view === (view === 'modifica' ? 'voli' : view)));
  const pt = $('#pageTitle'); if (pt) pt.textContent = { riepilogo: 'Summary', voli: 'Flights', mappa: 'Map', nuovo: 'New flight', modifica: 'Flight', stampa: 'EASA print', dati: 'Settings', stat: 'Statistics' }[view] || 'Logbook';
  closeMenu();
  const main = $('#main');
  if ((!data || !data.flights.length) && view !== 'dati' && view !== 'nuovo') { main.innerHTML = emptyState(); return; }
  views[view](main, arg);
  main.focus({ preventScroll: true });
}
window.addEventListener('hashchange', route);

function emptyState() {
  return `<h1>Logbook</h1><p class="lede">The logbook is empty.</p>
  <div class="empty"><p>Import your <b>logbook.json</b> file, or open the backup folder if you have already used it on this Mac.</p>
  <a class="btn primary" href="#dati">Go to Settings</a></div>`;
}

// ---------- Riepilogo ----------
function stripHTML(t) {
  const c = (h, v, big) => `<div class="c${big ? ' big' : ''}"><div class="ch">${h}</div><div class="cv">${v}</div></div>`;
  const g = (h, cols) => `<div class="grp"><div class="gh">${h}</div><div class="cols">${cols}</div></div>`;
  return `<div class="strip" role="group" aria-label="Totals">
    ${g('Single pilot', c('SE', hm0(t.spSe)) + c('ME', hm0(t.spMe)))}
    ${g('Multi-pilot', c('MP', hm0(t.mp)))}
    ${g('Pilot function', c('PIC', hm0(t.pic)) + c('SIC', hm0(t.sic)) + c('Dual', hm0(t.dual)) + c('Instructor', hm0(t.instr)))}
    ${g('Operational condition', c('Night', hm0(t.night)) + c('IFR', hm0(t.ifr)))}
    ${g('Takeoffs', c('Day', t.toDay) + c('Night', t.toNight))}
    ${g('Landings', c('Day', t.ldgDay) + c('Night', t.ldgNight))}
    ${g('Simulator', c('FSTD', hm0(t.sim)))}
  </div>`;
}
function splitBar(t, max, cls = 'hbar') {
  const w = v => max ? (100 * v / max).toFixed(2) + '%' : '0';
  return `<div class="${cls}" role="img" aria-label="PIC ${hm0(t.pic)}, SIC ${hm0(t.sic)}, dual ${hm0(t.dual)}"><i class="c-pic" style="width:${w(t.pic)}"></i><i class="c-sic" style="width:${w(t.sic)}"></i><i class="c-dual" style="width:${w(t.dual)}"></i></div>`;
}
function gauge(v, limit) {
  const p = Math.min(100, 100 * v / limit);
  return `<div class="gauge ${p >= 100 ? 'over' : p >= 80 ? 'hi' : ''}"><i style="width:${p.toFixed(1)}%"></i></div>`;
}
function viewSummary(main) {
  const years = [...new Set(data.flights.map(f => f.date.slice(0, 4)))].sort().reverse();
  const sel = viewSummary.period || 'all';
  let list = data.flights, withOpen = true, label = 'since 2007, including hours brought forward';
  if (sel === '12m') { list = flightsIn(addDays(today(), -365)); withOpen = false; label = 'in the last 12 months'; }
  else if (/^\d{4}$/.test(sel)) { list = flightsIn(sel + '-01-01', sel + '-12-31'); withOpen = false; label = 'in ' + sel; }
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
  const byType = {}; for (const f of list) if (f.kind === 'flight' && !f.planned) (byType[f.type || '—'] ||= []).push(f);
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
  const yrows = yl.map(([yr, s]) => `<tr class="click" data-year="${yr}" tabindex="0" title="Show ${yr} month by month"><td class="l"><b>${yr}</b> <span class="chev" aria-hidden="true">›</span></td><td class="barcell">${splitBar(s, ymax)}</td><td>${s.legs}</td><td><b>${hm(s.total)}</b></td><td>${avg(s)}</td><td>${hm(s.pic)}</td><td>${hm(s.sic)}</td><td>${hm(s.night)}</td><td>${s.ldgDay + s.ldgNight || ''}</td><td>${s.nm ? fmtN(s.nm) : ''}</td><td>${hm(s.sim)}</td></tr>`).join('');

  main.innerHTML = `<div class="row" style="justify-content:space-between;align-items:baseline"><h1>Summary</h1>
    <div class="row" style="margin:0;gap:10px;align-items:center"><button type="button" class="btn" data-act="roster">Import roster</button><button type="button" class="btn" data-act="next">Next leg →</button>
    <label class="row filters" style="margin:0">Period
    <select id="per"><option value="all">Whole career</option><option value="12m">Last 12 months</option>${years.map(y => `<option value="${y}">${y}</option>`).join('')}</select></label></div></div>
  ${plannedBanner()}
  <p class="lede">${fmtN(t.legs)} sectors and ${t.sims} simulator sessions ${label}. Average sector ${avg(sum(list.filter(f => f.kind === 'flight')))}.</p>
  <div class="hero">
    <div class="tot">${hm0(t.total)}<small>total time</small></div>
    <div class="split">${splitBar(t, fn, 'bar')}
      <div class="legend">
        <span><i class="dot c-pic"></i>PIC <b>${hm0(t.pic)}</b> ${pct(t.pic)}</span>
        <span><i class="dot c-sic"></i>SIC <b>${hm0(t.sic)}</b> ${pct(t.sic)}</span>
        <span><i class="dot c-dual"></i>Dual <b>${hm0(t.dual)}</b> ${pct(t.dual)}</span>
      </div></div>
  </div>
  ${stripHTML(t)}
  <h2>Distance · PAX · Fuel</h2>
  <div class="recency">
    <div><b>${fmtN(t.nm)} NM</b><span>${sel === 'all' ? 'career distance' : 'distance in period'}, great circle</span></div>
    <div><b>${fmtN(t.nm / flYears)} NM</b><span>yearly average${flYears > 1 ? ` over ${flYears} years` : ''}</span></div>
    <div><b>${fmtN(m12nm)} NM</b><span>last 12 months</span></div>
    <div><b>${t.legs ? fmtN(t.nm / t.legs) : 0} NM</b><span>average sector distance</span></div>
    ${t.paxLegs ? `<div><b>${fmtN(t.pax)}</b><span>passengers carried, from ${t.paxLegs} sectors with data</span></div>` : ''}
    ${t.fuelLegs ? `<div><b>${fmtN(t.fuelUsed)} t</b><span>fuel burned, from ${t.fuelLegs} sectors with data</span></div>` : ''}
  </div>
  <h2>FTL limits · Recency</h2>
  <div class="recency">
    <div><b>${hm0(d28.total)}</b><span>last 28 days, limit 100 h</span>${gauge(d28.total, 6000)}</div>
    <div><b>${hm0(y.total)}</b><span>calendar year ${td.slice(0, 4)}, limit 900 h</span>${gauge(y.total, 54000)}</div>
    <div><b>${hm0(m12.total)}</b><span>last 12 months, limit 1000 h</span>${gauge(m12.total, 60000)}</div>
    <div><b>${d90.toDay + d90.toNight} / ${d90.ldgDay + d90.ldgNight}</b><span>takeoffs / landings, last 90 days</span></div>
    <div class="${ok90 ? '' : 'warn'}"><b>${typ90.toDay + typ90.toNight} / ${typ90.ldgDay + typ90.ldgNight}</b><span>${esc(curType)} takeoffs / landings, last 90 days${ok90 ? '' : ': fewer than 3, recency required'}</span></div>
    <div><b>${lastFlight ? dmy(lastFlight.date) : '—'}</b><span>last flight${lastFlight ? `, ${esc(lastFlight.dep)}–${esc(lastFlight.arr)}` : ''}</span></div>
  </div>
  <h2>By family</h2>
  <table class="data"><thead><tr><th class="l">Family</th><th class="l">PIC · SIC · Dual</th><th>Sectors</th><th>Total</th><th>Avg</th><th>PIC</th><th>SIC</th><th>Last flight</th></tr></thead><tbody>${frows}</tbody></table>
  <h2>By aircraft type</h2>
  <table class="data"><thead><tr><th class="l">Type</th><th class="l">PIC · SIC · Dual</th><th>Sectors</th><th>Total</th><th>Avg</th><th>PIC</th><th>SIC</th><th>Last flight</th></tr></thead><tbody>${trows}</tbody></table>
  ${withOpen ? `<p class="hint">Hours brought forward before 2007 (${hm(data.opening.total)}) are included in the totals but not in the tables by type and year.</p>` : ''}
  <h2>By year</h2>
  <table class="data"><thead><tr><th class="l">Year</th><th class="l">PIC · SIC · Dual</th><th>Sectors</th><th>Total</th><th>Avg</th><th>PIC</th><th>SIC</th><th>Night</th><th>LDG</th><th>NM</th><th>Sim</th></tr></thead><tbody>${yrows}</tbody></table>`;
  const per = $('#per'); per.value = sel; per.onchange = () => { viewSummary.period = per.value; viewSummary(main); };
  bindPlannedBanner(main);
  const yt = main.querySelectorAll('table.data')[2].tBodies[0];
  const open = e => { const tr = e.target.closest('tr[data-year]'); if (tr) showYear(tr.dataset.year); };
  yt.onclick = open; yt.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(e); } };
}

const MESI = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function showYear(yr) {
  const rows = MESI.map((m, i) => { const mm = String(i + 1).padStart(2, '0'); return [m, mm, sum(data.flights.filter(f => f.date.startsWith(`${yr}-${mm}`)))]; });
  const tot = sum(data.flights.filter(f => f.date.startsWith(yr)));
  const max = Math.max(...rows.map(r => r[2].total), 1);
  const body = rows.map(([m, , s]) => s.legs || s.sims
    ? `<tr><td class="l"><b>${m}</b></td><td class="barcell">${splitBar(s, max)}</td><td>${s.legs || ''}</td><td><b>${hm(s.total)}</b></td><td>${avg(s)}</td><td>${hm(s.pic)}</td><td>${hm(s.sic)}</td><td>${hm(s.dual)}</td><td>${hm(s.night)}</td><td>${s.ldgDay + s.ldgNight || ''}</td><td>${s.nm ? fmtN(s.nm) : ''}</td><td>${hm(s.sim)}</td></tr>`
    : `<tr class="idle"><td class="l">${m}</td><td class="barcell"></td><td colspan="10" class="l hint">no flights</td></tr>`).join('');
  const act = rows.filter(r => r[2].total);
  const best = act.length ? act.reduce((a, b) => b[2].total > a[2].total ? b : a) : null;
  let dlg = $('#yearDlg');
  if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'yearDlg'; document.body.append(dlg); dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); }); }
  dlg.innerHTML = `<div class="dlg-head"><div><h2>${yr} by month</h2>
      <p class="lede">${tot.legs} sectors, ${hm0(tot.total)} flight time, average sector ${avg(tot)}, ${fmtN(tot.nm)} NM${act.length ? `, ${hm0(Math.round(tot.total / act.length))} per active month` : ''}${best ? `. Busiest month: ${best[0]} with ${hm0(best[2].total)}` : ''}.</p></div>
      <button class="btn" id="dlgClose" aria-label="Close">Close</button></div>
    <table class="data"><thead><tr><th class="l">Month</th><th class="l">PIC · SIC · Dual</th><th>Sectors</th><th>Total</th><th>Avg</th><th>PIC</th><th>SIC</th><th>Dual</th><th>Night</th><th>LDG</th><th>NM</th><th>Sim</th></tr></thead>
    <tbody>${body}<tr class="sum"><td class="l">Totale ${yr}</td><td></td><td>${tot.legs}</td><td>${hm0(tot.total)}</td><td>${avg(tot)}</td><td>${hm(tot.pic)}</td><td>${hm(tot.sic)}</td><td>${hm(tot.dual)}</td><td>${hm(tot.night)}</td><td>${tot.ldgDay + tot.ldgNight || ''}</td><td>${tot.nm ? fmtN(tot.nm) : ''}</td><td>${hm(tot.sim)}</td></tr></tbody></table>
    <p class="row" style="margin-top:14px"><button class="btn" id="dlgVoli">Show ${yr} flights</button></p>`;
  $('#dlgClose').onclick = () => dlg.close();
  $('#dlgVoli').onclick = () => { dlg.close(); viewFlights.st = { year: yr, type: '', q: '', all: false }; location.hash = 'voli'; if (location.hash === '#voli') route(); };
  dlg.showModal();
}

// ---------- Voli ----------
function viewFlights(main) {
  const st = viewFlights.st ||= { year: '', type: '', q: '', all: false };
  const years = [...new Set(data.flights.map(f => f.date.slice(0, 4)))].sort().reverse();
  const types = [...new Set(data.flights.map(f => f.kind === 'sim' ? 'Simulator' : f.type).filter(Boolean))].sort();
  const q = st.q.toLowerCase();
  let list = data.flights.filter(f => (!st.year || f.date.startsWith(st.year)) &&
    (!st.type || (st.type === 'Simulator' ? f.kind === 'sim' : st.type === '__planned' ? f.planned : st.type === '__dot' ? f.planned && !f.seen : f.type === st.type)) &&
    (!q || [f.dep, f.arr, f.reg, f.picName, f.remarks, f.simType, f.flightNo].join(' ').toLowerCase().includes(q)));
  const t = sum(list);
  list = list.slice().reverse();
  const shown = st.all ? list : list.slice(0, 300);
  const rows = shown.map(f => {
    const r = roleOf(f);
    if (f.kind === 'sim') return `<tr class="click" data-id="${f.id}"><td class="l">${dmy(f.date)}</td><td class="l" colspan="4">${esc(f.simType)}</td><td class="l"><span class="tag sim">SIM</span></td><td class="l">${esc(f.simReg || '')}</td><td>${hm(f.sim)}</td><td></td><td class="o"></td><td class="o"></td><td class="o"></td><td class="l">${esc(f.picName)}</td><td class="rem o"><div>${esc(f.remarks)}</div></td></tr>`;
    if (f.planned) return `<tr class="click planned" data-id="${f.id}"><td class="l">${f.seen ? '' : '<i class="newdot" title="Unseen"></i>'}${dmy(f.date)}</td><td class="l">${esc(f.dep)}</td><td>${esc(f.out)}</td><td class="l">${esc(f.arr)}</td><td>${esc(f.inn)}</td><td class="l">${esc(f.type || f.acHint || '')}</td><td class="l">${esc(f.reg)}</td><td>${hm(f.total)}</td><td><span class="tag plan">${f.date < today() ? 'actuals missing' : 'planned'}</span></td><td class="o"></td><td class="o"></td><td class="o"></td><td class="l">${esc(f.picName)}</td><td class="rem o"><div>${esc(f.change || f.flightNo || '')}</div></td></tr>`;
    return `<tr class="click" data-id="${f.id}"><td class="l">${dmy(f.date)}</td><td class="l">${esc(f.dep)}</td><td>${esc(f.out)}</td><td class="l">${esc(f.arr)}</td><td>${esc(f.inn)}</td><td class="l">${esc(f.type)}</td><td class="l">${esc(f.reg)}</td><td>${hm(f.total)}</td><td><span class="tag${r.startsWith('PIC') ? ' pic' : ''}">${r}</span></td><td class="o">${hm(f.night)}</td><td class="o">${(f.toDay + f.toNight) || ''}</td><td class="o">${(f.ldgDay + f.ldgNight) || ''}</td><td class="l">${esc(f.picName)}</td><td class="rem o"><div>${esc(f.remarks)}</div></td></tr>`;
  }).join('');
  const nPlan = data.flights.filter(f => f.planned).length, nDot = data.flights.filter(f => f.planned && !f.seen).length;
  main.innerHTML = `<h1>Flights</h1>
  ${plannedBanner()}
  <p class="lede">${fmtN(t.legs)} sectors, ${hm0(t.total)} flight time${t.sims ? `, ${t.sims} simulator sessions (${hm0(t.sim)})` : ''}.</p>
  <div class="row filters">
    <select id="fy" aria-label="Year"><option value="">All years</option>${years.map(y => `<option>${y}</option>`).join('')}</select>
    <select id="ft" aria-label="Type"><option value="">All types</option>${nPlan ? `<option value="__planned">Planned from NetLine (${nPlan})</option>` : ''}${nDot ? `<option value="__dot">Unseen (${nDot})</option>` : ''}${types.map(y => `<option>${esc(y)}</option>`).join('')}</select>
    ${nDot ? '<button class="btn" id="seenAll">Mark all as seen</button>' : ''}
    <input id="fq" type="search" placeholder="Search airport, reg, PIC, remarks" size="36" value="${esc(st.q)}">
    <a class="btn primary" href="#nuovo">New flight</a>
  </div>
  <div class="scroll" style="max-height:none"><table class="data"><thead><tr><th class="l">Date</th><th class="l">DEP</th><th>OUT</th><th class="l">ARR</th><th>IN</th><th class="l">Type</th><th class="l">Reg</th><th>Total</th><th>Function</th><th class="o">Night</th><th class="o">T/O</th><th class="o">LDG</th><th class="l">PIC name</th><th class="l o">Remarks</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="14" class="l">No flights match these filters.</td></tr>'}</tbody></table></div>
  ${!st.all && list.length > 300 ? `<p><button class="btn" id="more">Show all ${list.length} entries</button></p>` : ''}`;
  $('#fy').value = st.year; $('#ft').value = st.type;
  $('#fy').onchange = e => { st.year = e.target.value; viewFlights(main); };
  $('#ft').onchange = e => { st.type = e.target.value; viewFlights(main); };
  let deb; $('#fq').oninput = e => { clearTimeout(deb); deb = setTimeout(() => { st.q = e.target.value; viewFlights(main); const i = $('#fq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); };
  if ($('#more')) $('#more').onclick = () => { st.all = true; viewFlights(main); };
  if ($('#seenAll')) $('#seenAll').onclick = async () => { for (const f of data.flights) if (f.planned && !f.seen) f.seen = true; await save(); updateBadge(); viewFlights(main); };
  bindPlannedBanner(main);
  main.querySelector('tbody').onclick = e => { const tr = e.target.closest('tr[data-id]'); if (tr) location.hash = 'modifica/' + tr.dataset.id; };
  if (viewFlights.hl) { const tr = main.querySelector(`tr[data-id="${viewFlights.hl}"]`); viewFlights.hl = null; if (tr) { tr.classList.add('hl'); tr.scrollIntoView({ block: 'center' }); } }
}

// ---------- Nuovo / modifica ----------
function viewEdit(main, id) {
  const orig = id ? data.flights.find(f => f.id === id) : null;
  if (id && !orig) { main.innerHTML = '<h1>Flight not found</h1><p><a href="#voli">Back to Flights</a></p>'; return; }
  if (orig?.planned && !orig.seen) { orig.seen = true; save(); updateBadge(); }
  const last = data.flights.filter(f => f.kind === 'flight' && !f.planned && f.date <= today()).at(-1);
  const f = orig ? { ...orig } : { ...EMPTY(), date: today(), reg: '', type: '', dep: last?.arr || '' };
  const recId = orig ? orig.id : nextId();
  let locked = !!orig?.locked;
  let confirmed = !orig?.planned;          // un volo NetLine resta programmato finché non scrivi un orario effettivo
  let created = !!orig;
  const role = orig ? roleOf(orig) : 'PIC';
  const isSim = f.kind === 'sim';
  const simTypes = [...new Set([...KNOWN_SIMS, ...Object.keys(SIM_DEVICES)])];
  const mpOn = !orig || f.mp > 0 || !(f.spSe || f.spMe);
  const ifrAll = !orig || f.ifr === f.total;
  const lockBtn = cls => `<button type="button" class="lock keep ${cls}" aria-pressed="${locked}" aria-label="Lock flight" title="Grey: editable · Orange: locked">${LOCK_SVG}</button>`;

  main.innerHTML = `
  ${orig?.planned ? `<div class="plan-note"><b>NetLine${orig.flightNo ? ` · ${esc(orig.flightNo)}` : ''}</b>: STD ${esc(orig.sched?.out || orig.out)} · STA ${esc(orig.sched?.inn || orig.inn)} UTC from the roster. Enter actual OUT, OFF, ON and IN: the flight counts in the totals as soon as actual times are entered.${orig.change ? `<br>Roster change: ${esc(orig.change.replace(/^orario cambiato da (.*) a (.*)$/, 'times changed from $1 to $2'))}` : ''}</div>` : ''}
  <form class="flight sheet" id="ff" novalidate>
    <div class="sheet-bar">
      <div class="seg keep" role="radiogroup" aria-label="Entry type">
        <label><input type="radio" name="kind" value="flight" ${!isSim ? 'checked' : ''}><span>Flight</span></label>
        <label><input type="radio" name="kind" value="sim" ${isSim ? 'checked' : ''}><span>Simulator</span></label></div>
      <span class="save-state" id="saveState" aria-live="polite">${orig ? (locked ? 'Locked' : '') : 'New entry'}</span>
    </div>
    <div id="fFlight" ${isSim ? 'hidden' : ''}>
    <section class="sheet-head">
      <canvas class="worldbg" id="worldbg" aria-hidden="true"></canvas>
      <div class="head-top">
        <div class="chips">
          <label class="chip"><input id="date" type="date" value="${esc(f.date)}" required aria-label="Date"></label>
          ${orig?.planned ? '<span class="chip warn" id="chipPlan">PLANNED</span>' : ''}
        </div>
        ${lockBtn('')}
      </div>
      <div class="route">
        <div class="apt"><input id="dep" class="icao" value="${esc(f.dep)}" maxlength="4" placeholder="ICAO" aria-label="Departure" autocapitalize="characters">
          <div class="apt-sub" id="depSub"></div><div class="tz" id="depTz"></div>
          <label class="sch"><span>STD</span><input id="std" value="${esc(f.sched?.out || '')}" placeholder="--:--" aria-label="Scheduled time of departure"></label></div>
        <div class="mid"><input id="flightNo" class="fno" value="${esc(f.flightNo || '')}" placeholder="FLT NO" aria-label="Flight number"></div>
        <div class="apt"><input id="arr" class="icao" value="${esc(f.arr)}" maxlength="4" placeholder="ICAO" aria-label="Arrival" autocapitalize="characters">
          <div class="apt-sub" id="arrSub"></div><div class="tz" id="arrTz"></div>
          <label class="sch"><span>STA</span><input id="sta" value="${esc(f.sched?.inn || '')}" placeholder="--:--" aria-label="Scheduled time of arrival"></label></div>
      </div>
      <div class="actual">
        <div class="ah">Actual times UTC</div>
        <div class="times4">
          <label class="t"><span>OUT</span><input id="out" value="${esc(f.out)}" placeholder="--:--"><small class="d" id="dOut"></small></label>
          <label class="t"><span>OFF</span><input id="off" value="${esc(f.off || '')}" placeholder="--:--"><small class="d" id="dOff"></small></label>
          <label class="t"><span>ON</span><input id="on" value="${esc(f.on || '')}" placeholder="--:--"><small class="d" id="dOn"></small></label>
          <label class="t"><span>IN</span><input id="inn" value="${esc(f.inn)}" placeholder="--:--"><small class="d" id="dIn"></small></label>
        </div>
      </div>
      <div class="blocks">
        <div><span>SCHED BLOCK</span><b id="schedBlock">—</b><small class="d"></small></div>
        <label><span>BLOCK TIME</span><input id="total" value="${hm(f.total)}" placeholder="0:00"><small class="d" id="dBlock"></small></label>
        <div><span>FLIGHT TIME</span><b id="airTime">—</b><small class="d"></small></div>
        <label><span>NIGHT</span><input id="night" value="${hm(f.night)}" placeholder="0:00" ${!orig || !f.night || orig.planned ? 'data-auto="1"' : ''}><small class="d" id="nightCalc"></small></label>
        <div><span>DISTANCE</span><b id="distNM">—</b><small class="d">NM</small></div>
      </div>
    </section>

    <section class="sheet-card">
      <h3>Flight</h3>
      <div class="ac-row">
        <span class="cap">Aircraft</span>
        <div class="reg-box">
          <input id="reg" class="reg" value="${esc(f.reg)}" placeholder="REG" aria-label="Registration" autocapitalize="characters" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="false" aria-controls="regList">
          <ul class="reg-list" id="regList" role="listbox" hidden></ul>
        </div>
        <span class="ac-type" id="acType">${esc(f.type)}</span>
        <input type="hidden" id="type" value="${esc(f.type)}">
      </div>
      <div class="ac-new" id="acNew" hidden>
        <span class="nf">Not found: <b id="nfReg"></b>. Aircraft type?</span>
        <select id="newType" aria-label="Aircraft type">${[...new Set([...TYPE_ORDER, ...data.flights.map(x => x.type)].filter(Boolean))].map(t => `<option>${esc(t)}</option>`).join('')}</select>
        <button type="button" class="btn small primary" id="addReg">Add aircraft</button>
      </div>
      <div class="flight-grid">
        <div class="col">
          <div class="cap">DEP</div>
          <div class="counter" id="cTO"><div class="lbl">Takeoffs <button type="button" class="moon" aria-label="Night takeoff" aria-pressed="false">☾</button></div>
            <div class="ctl"><button type="button" class="dec" aria-label="Minus">−</button><b>0</b><button type="button" class="inc" aria-label="Plus">+</button></div></div>
        </div>
        <div class="col">
          <div class="cap">ARR</div>
          <div class="counter" id="cLDG"><div class="lbl">Landings <button type="button" class="moon" aria-label="Night landing" aria-pressed="false">☾</button></div>
            <div class="ctl"><button type="button" class="dec" aria-label="Minus">−</button><b>0</b><button type="button" class="inc" aria-label="Plus">+</button></div></div>
        </div>
      </div>
      <label class="ri appr-row"><span>Approach</span>${approachSelect(f.approach)}</label>
      <input type="hidden" id="toDay" value="${f.toDay || ''}"><input type="hidden" id="toNight" value="${f.toNight || ''}">
      <input type="hidden" id="ldgDay" value="${f.ldgDay || ''}"><input type="hidden" id="ldgNight" value="${f.ldgNight || ''}">
    </section>

    <section class="sheet-card">
      <h3>Function</h3>
      <div class="rows">
        <div class="ri"><span>Function</span><div class="seg" role="radiogroup" aria-label="Pilot function">
          ${['PIC', 'PICUS', 'SIC', 'LIFUS', 'DUAL'].map(r => `<label><input type="radio" name="role" value="${r}" ${r === role ? 'checked' : ''}><span>${r}</span></label>`).join('')}</div></div>
        <label class="ri"><span>PIC name</span><input id="picName" value="${esc(f.picName)}"></label>
        <label class="ri"><span>IFR</span><input id="ifr" class="short" value="${hm(f.ifr)}" ${ifrAll ? 'data-auto="1"' : ''}></label>
        <label class="ri"><span>Multi-pilot</span><input type="checkbox" class="sw" id="mpOn" ${mpOn ? 'checked' : ''}></label>
        <label class="ri"><span>Instructor</span><input type="checkbox" class="sw" id="instrOn" ${f.instr ? 'checked' : ''}></label>
      </div>
      <p class="hint rows-hint" id="roleHint"></p>
      ${f.crew ? `<p class="hint rows-hint">NetLine crew: ${esc(f.crew)}</p>` : ''}
    </section>

    <section class="sheet-card">
      <h3>Payload · Fuel</h3>
      <div class="tiles">
        <label><span>Payload</span><input id="payload" inputmode="decimal" value="${f.payload || ''}" placeholder="0"><small>t</small></label>
        <label><span>PAX</span><input id="pax" type="number" min="0" inputmode="numeric" value="${f.pax || ''}" placeholder="0"></label>
        <label><span>Fuel used</span><input id="fuelUsed" inputmode="decimal" value="${f.fuelUsed || ''}" placeholder="0"><small id="fuelDiff">t</small></label>
        <label><span>Planned fuel burn</span><input id="fuelPlan" inputmode="decimal" value="${f.fuelPlan || ''}" placeholder="0"><small>t</small></label>
      </div>
      <p class="hint rows-hint">CO₂ <b id="co2">—</b> t</p>
    </section>
    </div>
    <div id="fSim" ${isSim ? '' : 'hidden'}>
    <section class="sheet-card">
      <h3 class="h3-lock">FSTD session ${lockBtn('on-dark')}</h3>
      <div class="grid sim-grid">
        <div class="field"><label for="sdate">Date</label><input id="sdate" type="date" value="${esc(f.date)}"></div>
        <div class="field w2"><label for="simReg">FSTD registration</label><input id="simReg" list="simregs" value="${esc(f.simReg || '')}" placeholder="e.g. I-T.081" autocapitalize="characters" autocomplete="off" spellcheck="false"><small class="hint" id="simRegHint"></small></div>
        <div class="field w2"><label for="simType">FSTD type</label><input id="simType" list="simtypes" value="${esc(f.simType)}" placeholder="BOEING 737-800"></div>
        <div class="field"><label for="sout">Start</label><input id="sout" value="${esc(f.out)}"></div>
        <div class="field"><label for="sinn">End</label><input id="sinn" value="${esc(f.inn)}"></div>
        <div class="field"><label for="sim">Duration</label><input id="sim" value="${hm(f.sim)}" placeholder="4:00"></div>
        <div class="field w3"><label for="spic">Instructor / examiner</label><input id="spic" value="${esc(f.picName)}"></div>
      </div>
    </section></div>
    <section class="sheet-card"><h3>Remarks · Signature</h3>
      <textarea id="remarks" class="note" rows="2" placeholder="Tap to add remarks">${esc(f.remarks)}</textarea>
      <div class="sig-wrap"><div class="sig-head"><span>Signature</span><button type="button" class="btn small" id="sigClear">Clear signature</button></div>
        <canvas id="sig" aria-label="Signature box: sign with your finger or the mouse"></canvas>
        <p class="hint" id="sigHint">${f.signature ? 'Signature saved: sign again to replace it.' : 'Sign here with your finger or the mouse.'}</p></div>
    </section>
    <details class="sheet-card check-card" id="chkBox" ${f.check ? 'open' : ''}>
      <summary><h3>Check · Examiner <span class="chk-tag" id="chkTag">${f.check?.type ? esc(f.check.type) : 'Line check, OPC, LPC…'}</span></h3></summary>
      <div class="rows">
        <label class="ri"><span>Check</span><select id="chkType"><option value="">—</option>${CHECKS.map(c => `<option ${c === f.check?.type ? 'selected' : ''}>${c}</option>`).join('')}${f.check?.type && !CHECKS.includes(f.check.type) ? `<option selected>${esc(f.check.type)}</option>` : ''}</select></label>
        <label class="ri"><span>Examiner</span><input id="chkName" value="${esc(f.check?.name || '')}" placeholder="Name" autocapitalize="characters"></label>
        <label class="ri"><span>Licence no.</span><input id="chkLic" value="${esc(f.check?.lic || '')}" placeholder="e.g. IT.FCL.12345"></label>
      </div>
      <div class="sig-wrap"><div class="sig-head"><span>Examiner signature</span><button type="button" class="btn small" id="chkClear">Clear signature</button></div>
        <canvas id="chkSig" aria-label="Examiner signature box"></canvas>
        <p class="hint">Appears in the remarks of the EASA logbook print.</p></div>
    </details>
    <div class="actions">
      <div class="leg-nav keep">
        <button class="btn keep" type="button" id="prevLeg"><span aria-hidden="true">←</span> Previous leg</button>
        <button class="btn primary keep" type="button" id="nextLeg">Next leg <span aria-hidden="true">→</span></button>
      </div>
      <button class="btn danger" type="button" id="del">Delete</button>
    </div>
    <datalist id="simregs">${Object.entries(simFleet()).map(([r, t]) => `<option value="${esc(r)}">${esc(t)}${SIM_NOTES[r] ? ' · ' + esc(SIM_NOTES[r]) : ''}</option>`).join('')}</datalist>
    <datalist id="simtypes">${simTypes.map(r => `<option>${esc(r)}</option>`).join('')}</datalist>
  </form>`;

  const form = $('#ff');
  const g = k => form.querySelector('#' + k);           // funziona anche quando la pagina è già cambiata
  // ---------- campi orario: al tocco il valore va in grigio e si riscrive, senza bisogno dei due punti
  const TIME_IDS = ['std', 'sta', 'out', 'off', 'on', 'inn', 'sout', 'sinn'], DUR_IDS = ['total', 'night', 'ifr', 'sim'];
  const isTD = el => TIME_IDS.includes(el.id) || DUR_IDS.includes(el.id) || el.id === 'dep' || el.id === 'arr';
  for (const k of [...TIME_IDS, ...DUR_IDS]) { const el = g(k); if (el) { el.setAttribute('inputmode', 'numeric'); el.setAttribute('autocomplete', 'off'); el.dataset.ph = el.placeholder; } }
  for (const k of ['dep', 'arr']) g(k).dataset.ph = 'ICAO';
  form.addEventListener('focusin', e => { const el = e.target; if (!isTD(el) || !el.value) return; el.dataset.prev = el.value; el.placeholder = el.value; el.value = ''; });
  form.addEventListener('focusout', e => { const el = e.target; if (!isTD(el)) return; if (el.value === '' && el.dataset.prev) el.value = el.dataset.prev; delete el.dataset.prev; el.placeholder = el.dataset.ph || ''; });
  form.addEventListener('change', e => { const el = e.target; if (TIME_IDS.includes(el.id)) el.value = normTime(el.value); else if (DUR_IDS.includes(el.id)) el.value = normDur(el.value); }, true);
  const kind = () => form.kind.value;
  form.querySelectorAll('input[name=kind]').forEach(r => r.onchange = () => { g('fFlight').hidden = kind() === 'sim'; g('fSim').hidden = kind() !== 'sim'; });

  // ---------- blocco, notte, decolli e atterraggi
  const syncIfr = () => { if (g('ifr').dataset.auto) g('ifr').value = g('total').value; };
  const autoTotal = () => { const o = toMin(g('out').value), i = toMin(g('inn').value); if (o != null && i != null) { g('total').value = hm(((i - o) + 1440) % 1440); syncIfr(); } };
  g('ifr').oninput = () => delete g('ifr').dataset.auto;
  ['out', 'inn'].forEach(k => g(k).addEventListener('change', autoTotal));
  g('total').addEventListener('change', syncIfr);
  let calc = null;
  g('night').addEventListener('input', () => delete g('night').dataset.auto);
  const placeTOLDG = () => {
    if (!calc) return;
    const to = num(g('toDay').value) + num(g('toNight').value), ld = num(g('ldgDay').value) + num(g('ldgNight').value);
    if (to) { g('toDay').value = calc.toNight ? '' : to; g('toNight').value = calc.toNight ? to : ''; }
    if (ld) { g('ldgDay').value = calc.ldgNight ? '' : ld; g('ldgNight').value = calc.ldgNight ? ld : ''; }
  };
  const counter = (box, dayId, nightId, calcKey) => {
    const el = g(box), b = el.querySelector('b'), moon = el.querySelector('.moon');
    let manual = null;
    const night = () => manual ?? (num(g(nightId).value) > 0 || (!num(g(dayId).value) && !!calc?.[calcKey]));
    const draw = () => { b.textContent = num(g(dayId).value) + num(g(nightId).value); const n = night(); moon.setAttribute('aria-pressed', n); el.classList.toggle('night', n); };
    const put = tot => { const n = night(); g(dayId).value = n ? '' : (tot || ''); g(nightId).value = n ? (tot || '') : ''; draw(); schedule(); };
    const tot = () => num(g(dayId).value) + num(g(nightId).value);
    el.querySelector('.inc').onclick = () => { if (!locked) put(tot() + 1); };
    el.querySelector('.dec').onclick = () => { if (!locked) put(Math.max(0, tot() - 1)); };
    moon.onclick = () => { if (locked) return; manual = !night(); put(tot()); };
    return draw;
  };
  const drawTO = counter('cTO', 'toDay', 'toNight', 'toNight'), drawLDG = counter('cLDG', 'ldgDay', 'ldgNight', 'ldgNight');
  const punct = d => d <= 3 ? 'ok' : d <= 15 ? 'warn' : 'bad';   // verde entro 3 min, arancione fino a 15, rosso oltre
  const extras = () => {
    const off = toMin(g('off').value), on = toMin(g('on').value);
    g('airTime').textContent = off != null && on != null ? hm(((on - off) + 1440) % 1440) || '0:00' : '—';
    g('distNM').textContent = calc ? fmtN(calc.nm) : (f.nm ? fmtN(f.nm) : '—');
    const std = g('std').value, sta = g('sta').value;
    const delay = (a, b, small, input) => {
      const x = toMin(a), y = toMin(b), e = g(small), inp = input && g(input);
      if (inp) inp.classList.remove('p-ok', 'p-warn', 'p-bad');
      if (x == null || y == null) { e.textContent = ''; e.className = 'd'; return; }
      let d = ((x - y) + 1440) % 1440; if (d > 720) d -= 1440;
      if (!input) { e.textContent = `Taxi ${Math.abs(d)} min`; e.className = 'd'; return; }
      const c = punct(d); inp.classList.add('p-' + c);
      e.textContent = d === 0 ? 'On time' : `${d > 0 ? '+' : '−'}${Math.abs(d)} min`; e.className = 'd p-' + c;
    };
    delay(g('out').value, std, 'dOut', 'out'); delay(g('inn').value, sta, 'dIn', 'inn');
    delay(g('off').value, g('out').value, 'dOff'); delay(g('inn').value, g('on').value, 'dOn');
    const sb = toMin(std) != null && toMin(sta) != null ? ((toMin(sta) - toMin(std)) + 1440) % 1440 : null, rb = parseHM(g('total').value);
    g('schedBlock').textContent = sb != null ? hm0(sb) : '—';
    g('dBlock').textContent = sb != null && rb ? (rb === sb ? '' : `${rb > sb ? '+' : '−'}${Math.abs(rb - sb)} min`) : '';
    const fu = parseDec(g('fuelUsed').value), fp = parseDec(g('fuelPlan').value);
    g('fuelDiff').textContent = fu && fp ? `t, ${fu - fp > 0 ? '+' : '−'}${Math.abs(fu - fp).toFixed(1)} vs plan` : 't';
    g('fuelDiff').className = fu && fp ? (fu > fp ? 'late' : 'early') : '';
    g('co2').textContent = fu ? (fu * 3.16).toFixed(1) : '—';
    drawTO(); drawLDG();
  };
  const runNight = async () => {
    await loadAirports();
    calc = nightCalc(g('date').value, g('out').value.trim(), g('inn').value.trim(), g('dep').value.trim().toUpperCase(), g('arr').value.trim().toUpperCase());
    const h = g('nightCalc');
    if (calc) {
      h.innerHTML = !g('night').dataset.auto && parseHM(g('night').value) !== calc.night ? `<button type="button" class="linkbtn" id="useNight" title="Use the calculated night time">calc. ${hm(calc.night) || '0:00'}</button>` : '';
      if (g('night').dataset.auto) g('night').value = hm(calc.night);
      const u = g('useNight'); if (u) u.onclick = () => { if (locked) return; g('night').value = hm(calc.night); g('night').dataset.auto = '1'; placeTOLDG(); runNight(); schedule(); };
      if (!orig || g('night').dataset.auto) placeTOLDG();
    } else h.textContent = '';
    extras();
  };
  // ---------- aeroporti: IATA, nome, fuso orario, planisfero con la rotta
  const aptInfo = async () => {
    await loadAirports(); IATA ||= await fetch('data/iata.json').then(r => r.json()).catch(() => ({}));
    const rev = c => Object.keys(IATA).find(k => IATA[k] === c) || '';
    for (const [inp, sub, tz, time] of [['dep', 'depSub', 'depTz', 'out'], ['arr', 'arrSub', 'arrTz', 'inn']]) {
      const c = g(inp).value.trim().toUpperCase(), p = apt(c);
      g(sub).innerHTML = p ? `<b>${esc(rev(AP_FIX[c] || c))}</b> ${esc(cleanAptName(p[2]))}` : '';
      g(tz).textContent = p?.[4] ? utcLabel(p[4], g('date').value, g(time).value || g(inp === 'dep' ? 'std' : 'sta').value) : '';
    }
    drawWorld(g('worldbg'), apt(g('dep').value.trim().toUpperCase()), apt(g('arr').value.trim().toUpperCase()));
  };
  ['date', 'dep', 'arr', 'out', 'inn'].forEach(k => g(k).addEventListener('change', runNight));
  ['date', 'dep', 'arr', 'out', 'inn'].forEach(k => g(k).addEventListener('change', aptInfo));
  ['std', 'sta', 'off', 'on', 'total', 'fuelUsed', 'fuelPlan', 'ifr', 'night'].forEach(k => g(k).addEventListener('change', () => setTimeout(extras, 0)));
  runNight(); aptInfo();
  const ro = new ResizeObserver(() => drawWorld(g('worldbg'), apt(g('dep').value.trim().toUpperCase()), apt(g('arr').value.trim().toUpperCase())));
  ro.observe(form.querySelector('.sheet-head'));

  // ---------- marca: si scrive, l'app suggerisce le marche note e compila il tipo; marca nuova -> chiede il tipo
  const fleet = knownRegs();
  const regInp = g('reg'), list = g('regList');
  let hi = -1, shown = [];
  const setType = t => { g('type').value = t || ''; g('acType').textContent = t || ''; };
  const pick = r => { regInp.value = r; setType(fleet.get(r)); closeList(); g('acNew').hidden = true; schedule(); };
  const closeList = () => { list.hidden = true; regInp.setAttribute('aria-expanded', 'false'); hi = -1; };
  const showList = () => {
    const q = normReg(regInp.value);
    shown = !q ? [] : [...fleet.keys()].map(r => [r, normReg(r)]).filter(([, n]) => n.includes(q))
      .sort((a, b) => (b[1].startsWith(q) - a[1].startsWith(q)) || a[1].length - b[1].length || a[0].localeCompare(b[0])).slice(0, 7).map(x => x[0]);
    list.innerHTML = shown.map((r, i) => `<li role="option" id="ro${i}" data-r="${esc(r)}" class="${i === hi ? 'on' : ''}"><b>${esc(r)}</b><span>${esc(fleet.get(r) || '')}</span></li>`).join('')
      + (q.length >= 3 && !shown.length ? `<li class="nf-li" data-new="1">Not found · add "${esc(regInp.value.trim().toUpperCase())}"</li>` : '');
    list.hidden = !list.innerHTML; regInp.setAttribute('aria-expanded', String(!list.hidden));
  };
  const resolve = () => {
    const v = regInp.value.trim().toUpperCase(); regInp.value = v;
    if (!v) { setType(''); g('acNew').hidden = true; return; }
    const exact = [...fleet.keys()].find(r => normReg(r) === normReg(v));
    if (exact) { regInp.value = exact; setType(fleet.get(exact)); g('acNew').hidden = true; return; }
    const fv = formatReg(v, fleet); regInp.value = fv;
    setType(''); g('nfReg').textContent = fv; g('acNew').hidden = false;
    const guess = guessType(v); if (guess) g('newType').value = guess;
  };
  regInp.addEventListener('input', () => { hi = -1; showList(); });
  regInp.addEventListener('focus', () => { if (regInp.value) showList(); });
  regInp.addEventListener('keydown', e => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); hi = Math.max(0, Math.min(shown.length - 1, hi + (e.key === 'ArrowDown' ? 1 : -1))); showList(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (hi >= 0 && shown[hi]) pick(shown[hi]); else { closeList(); resolve(); } }
    else if (e.key === 'Escape') closeList();
  });
  list.addEventListener('pointerdown', e => {
    e.preventDefault(); const li = e.target.closest('li'); if (!li) return;
    if (li.dataset.new) { closeList(); resolve(); g('newType').focus(); } else pick(li.dataset.r);
  });
  regInp.addEventListener('blur', () => setTimeout(() => { closeList(); resolve(); }, 120));
  g('addReg').onclick = async () => {
    const r = regInp.value.trim().toUpperCase(), t = g('newType').value;
    if (!/^[A-Z0-9-]{3,10}$/.test(r)) { toast('Registration not valid, e.g. EI-RZI'); return; }
    (data.aircraft ||= {})[r] = t; data.metaMt = Date.now(); fleet.set(r, t);
    setType(t); g('acNew').hidden = true;
    await save(`${r} added as ${t}`); schedule();
  };

  // ---------- funzione
  const hint = () => {
    const r = form.role.value;
    g('roleHint').textContent = { PIC: 'Logged as PIC.', PICUS: 'Logged as PIC with "PICUS" in the remarks: needs the PIC countersignature (name and licence number).', SIC: 'Logged as SIC (co-pilot).', LIFUS: 'Line flying under supervision: logged as co-pilot time with "LIFUS" in the remarks.', DUAL: 'Dual instruction: put the instructor as PIC name and his certification in the remarks.' }[r];
    if ((r === 'PIC' || r === 'PICUS') && !g('picName').value) g('picName').value = 'SELF';
  };
  form.querySelectorAll('input[name=role]').forEach(r => r.addEventListener('change', hint)); hint();
  const simRegInfo = () => {
    const v = g('simReg').value.trim().toUpperCase(), fl = simFleet(), h = g('simRegHint');
    const hit = Object.keys(fl).find(k => k.toUpperCase() === v);
    if (hit) { g('simReg').value = hit; g('simType').value = fl[hit]; h.textContent = SIM_NOTES[hit] || ''; h.className = 'hint'; }
    else if (v) { g('simReg').value = v; h.textContent = 'New FSTD: enter its type, it will be remembered.'; h.className = 'hint warn'; if (!g('simType').value) g('simType').focus(); }
    else h.textContent = '';
  };
  g('simReg').addEventListener('change', simRegInfo);
  if (g('simReg').value) { const v = g('simReg').value; g('simRegHint').textContent = SIM_NOTES[v] || (simFleet()[v] ? '' : ''); }
  g('simType').addEventListener('change', () => { const v = g('simType').value.trim(); const fl = simFleet(); if (fl[v]) { g('simReg').value = v; g('simType').value = fl[v]; simRegInfo(); } });
  const autoSim = () => { const o = toMin(g('sout').value), i = toMin(g('sinn').value); if (o != null && i != null) g('sim').value = hm(((i - o) + 1440) % 1440); };
  ['sout', 'sinn'].forEach(k => g(k).addEventListener('change', autoSim));
  const sig = signaturePad(g('sig'), f.signature, () => { g('sigHint').textContent = 'Signature ready.'; schedule(); });
  g('sigClear').onclick = () => { if (locked) return; sig.clear(); g('sigHint').textContent = 'Signature cleared.'; schedule(); };
  let chk = null;
  const chkInit = () => { if (!chk && g('chkBox').open) chk = signaturePad(g('chkSig'), f.check?.sig, schedule); };
  g('chkBox').addEventListener('toggle', chkInit); chkInit();
  g('chkClear').onclick = () => { if (locked) return; chkInit(); chk?.clear(); schedule(); };
  g('chkType').addEventListener('change', () => { g('chkTag').textContent = g('chkType').value || 'Line check, OPC, LPC…'; });
  form.addEventListener('input', e => { if (e.target.id === 'chkName' || e.target.id === 'chkLic') schedule(); });
  if (!orig && viewEdit.dup) {
    const d = viewEdit.dup; viewEdit.dup = null;
    g('reg').value = d.reg || ''; g('type').value = d.type || ''; g('acType').textContent = d.type || '';
    g('picName').value = d.picName || ''; g('mpOn').checked = d.mp > 0 || !(d.spSe || d.spMe);
    g('dep').value = d.arr; g('date').value = legDate(d); form.role.value = roleOf(d) === 'SIM' ? 'PIC' : roleOf(d); hint(); aptInfo();
  }

  // ---------- salvataggio automatico e lucchetto
  const state = (txt, cls = '') => { const s = g('saveState'); s.textContent = txt; s.className = 'save-state ' + cls; };
  const collect = () => {
    const rec = orig ? { ...(data.flights.find(x => x.id === recId) || orig) } : { ...EMPTY(), id: recId };
    rec.id = recId;
    const remarks = g('remarks').value.trim();
    if (kind() === 'sim') {
      const sim = parseHM(g('sim').value);
      if (!g('sdate').value) return { err: 'date missing', el: g('sdate') };
      if (!sim || isNaN(sim)) return { err: 'duration missing', el: g('sim') };
      Object.assign(rec, EMPTY(), { id: rec.id, src: rec.src || 'app', kind: 'sim', date: g('sdate').value, simReg: g('simReg').value.trim().toUpperCase(), simType: g('simType').value.trim(), out: normTime(g('sout').value), inn: normTime(g('sinn').value), sim, picName: g('spic').value.trim(), remarks });
      delete rec.planned;
      if (!rec.simReg) delete rec.simReg;
      else if (!simFleet()[rec.simReg] && rec.simType) { (data.simulators ||= {})[rec.simReg] = { type: rec.simType }; data.metaMt = Date.now(); }
    } else {
      for (const k of ['std', 'sta', 'out', 'off', 'on', 'inn']) { const el = g(k); el.value = normTime(el.value); if (el.value && toMin(el.value) == null) return { err: `${k.toUpperCase()} not valid`, el }; }
      if (!g('date').value) return { err: 'date missing', el: g('date') };
      if (!/^[A-Z0-9]{3,4}$/i.test(g('dep').value.trim())) return { err: 'DEP missing', el: g('dep') };
      if (!/^[A-Z0-9]{3,4}$/i.test(g('arr').value.trim())) return { err: 'ARR missing', el: g('arr') };
      if (!g('out').value) return { err: 'OUT missing', el: g('out') };
      if (!g('inn').value) return { err: 'IN missing', el: g('inn') };
      let total = parseHM(g('total').value);
      if (!total || isNaN(total)) total = ((toMin(g('inn').value) - toMin(g('out').value)) + 1440) % 1440;
      if (!total) return { err: 'block time is zero', el: g('total') };
      let night = parseHM(g('night').value), ifr = parseHM(g('ifr').value);
      if (isNaN(night)) night = calc ? calc.night : 0;
      if (isNaN(ifr)) ifr = total;
      night = Math.min(night, total); ifr = Math.min(ifr, total);
      const role = form.role.value, mp = g('mpOn').checked;
      let rem = remarks;
      if (role === 'PICUS' && !/picus/i.test(rem)) rem = (rem ? rem + '\n' : '') + 'PICUS';
      if (role === 'LIFUS' && !/lifus/i.test(rem)) rem = (rem ? rem + '\n' : '') + 'LIFUS';
      if (role !== 'PICUS') rem = rem.replace(/^PICUS$/m, '').trim();
      if (role !== 'LIFUS') rem = rem.replace(/^LIFUS$/m, '').trim();
      const std = g('std').value, sta = g('sta').value;
      Object.assign(rec, {
        kind: 'flight', date: g('date').value, dep: g('dep').value.trim().toUpperCase(), arr: g('arr').value.trim().toUpperCase(),
        out: g('out').value, inn: g('inn').value, off: g('off').value, on: g('on').value, reg: g('reg').value.trim().toUpperCase(), type: g('type').value.trim(),
        flightNo: g('flightNo').value.trim(), picName: g('picName').value.trim(), total, night, ifr,
        mp: mp ? total : 0, spMe: mp ? 0 : (rec.spSe ? 0 : total), spSe: mp ? 0 : (rec.spSe ? total : 0),
        pic: role === 'PIC' || role === 'PICUS' ? total : 0, sic: role === 'SIC' || role === 'LIFUS' ? total : 0, dual: role === 'DUAL' ? total : 0,
        instr: g('instrOn').checked ? total : 0, toDay: num(g('toDay').value), toNight: num(g('toNight').value),
        ldgDay: num(g('ldgDay').value), ldgNight: num(g('ldgNight').value), sim: 0, simType: '', remarks: rem,
        pax: num(g('pax').value), payload: parseDec(g('payload').value), fuelPlan: parseDec(g('fuelPlan').value), fuelUsed: parseDec(g('fuelUsed').value),
        approach: g('approach').value, nm: calc ? calc.nm : (rec.nm || 0)
      });
      if (std || sta) rec.sched = { out: std, inn: sta }; else delete rec.sched;
      if (confirmed) { delete rec.planned; delete rec.change; } else rec.planned = true;
    }
    const sv = sig.value(); if (sv) rec.signature = sv; else delete rec.signature;
    const ck = { type: g('chkType').value, name: g('chkName').value.trim().toUpperCase(), lic: g('chkLic').value.trim(), sig: chk ? chk.value() : f.check?.sig || null };
    if (ck.type || ck.name || ck.lic || ck.sig) { if (!ck.sig) delete ck.sig; rec.check = ck; } else delete rec.check;
    rec.locked = locked; if (!locked) delete rec.locked;
    rec.seen = true; rec.mt = Date.now();
    return { rec };
  };
  const commit = async () => {
    const r = collect();
    if (r.err) { state(created ? `Not saved: ${r.err}` : `Draft: ${r.err}`, 'warn'); return r; }
    const i = data.flights.findIndex(x => x.id === recId);
    if (i >= 0) data.flights[i] = r.rec; else data.flights.push(r.rec);
    created = true;
    await save(); updateBadge();
    if (confirmed) { g('chipPlan')?.remove(); main.querySelector('.plan-note')?.remove(); }
    state(`${locked ? 'Locked' : 'Saved'} ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`, locked ? 'lockd' : 'ok');
    return r;
  };
  let timer = null;
  function schedule() { if (locked) return; clearTimeout(timer); state('Saving…'); timer = setTimeout(() => { timer = null; commit(); }, 600); }
  form.addEventListener('change', e => {
    if (['out', 'off', 'on', 'inn'].includes(e.target.id)) confirmed = true;
    if (e.target.id === 'newReg' || e.target.id === 'newType' || e.target.name === 'kind') return;
    schedule();
  });
  form.addEventListener('input', e => { if (e.target.id === 'remarks' || e.target.id === 'picName') schedule(); });
  const flush = () => {
    if (!timer) return; clearTimeout(timer); timer = null;
    const r = collect();
    if (r.err) { if (created) toast(`Last change not saved: ${r.err}`); else toast(`Flight not saved: ${r.err}`); return; }
    const i = data.flights.findIndex(x => x.id === recId); if (i >= 0) data.flights[i] = r.rec; else data.flights.push(r.rec);
    save(); updateBadge();
  };
  const leave = () => { flush(); ro.disconnect(); window.removeEventListener('pagehide', flush); };
  window.addEventListener('hashchange', leave, { once: true });
  window.addEventListener('pagehide', flush);
  form.onsubmit = e => { e.preventDefault(); clearTimeout(timer); timer = null; commit(); };

  const applyLock = () => {
    form.classList.toggle('locked', locked);
    for (const el of form.elements) if (!el.closest('.keep')) el.disabled = locked;
    form.querySelectorAll('.lock').forEach(b => { b.setAttribute('aria-pressed', locked); b.setAttribute('aria-label', locked ? 'Unlock flight' : 'Lock flight'); });
    if (locked) state('Locked', 'lockd');
  };
  form.querySelectorAll('.lock').forEach(b => b.onclick = async () => {
    clearTimeout(timer); timer = null;
    if (!locked) {
      locked = true; confirmed = true;
      const r = await commit();
      if (r.err) { locked = false; toast(`Cannot lock: ${r.err}`); r.el?.scrollIntoView({ block: 'center' }); applyLock(); return; }
      toast('Flight locked');
    } else {
      locked = false; await commit(); toast('Flight unlocked');
    }
    applyLock();
  });
  applyLock();

  g('del').onclick = async () => {
    if (locked) return;
    if (!created) { location.hash = 'voli'; return; }
    if (!confirm('Delete this entry from the logbook?')) return;
    clearTimeout(timer); timer = null;
    data.flights = data.flights.filter(x => x.id !== recId); (data.deleted ||= {})[recId] = Date.now();
    await save('Entry deleted'); created = false; location.hash = 'voli';
  };
  // navigazione tra le tratte registrate, in ordine cronologico
  const legKey = x => x.date + ' ' + (x.out || '') + ' ' + x.id;
  const legs = () => data.flights.filter(x => x.kind === 'flight' || x.id === recId).sort((a, b) => legKey(a).localeCompare(legKey(b)));
  const neighbour = dir => {
    const cur = data.flights.find(x => x.id === recId) || { ...f, id: recId, date: g('date').value || f.date, out: g('out').value };
    const L = legs().filter(x => x.id !== recId), k = legKey(cur);
    return dir > 0 ? L.find(x => legKey(x) > k) : L.filter(x => legKey(x) < k).at(-1);
  };
  const navBtns = () => {
    const p = neighbour(-1), n = neighbour(1);
    g('prevLeg').disabled = !p; g('prevLeg').title = p ? `${dmy(p.date)} ${p.dep}–${p.arr}` : 'No earlier leg';
    g('nextLeg').innerHTML = n ? 'Next leg <span aria-hidden="true">→</span>' : 'New next leg <span aria-hidden="true">+</span>';
    g('nextLeg').title = n ? `${dmy(n.date)} ${n.dep}–${n.arr}` : 'Create a new leg from this arrival';
  };
  navBtns();
  g('prevLeg').onclick = () => { flush(); const p = neighbour(-1); if (p) location.hash = 'modifica/' + p.id; };
  g('nextLeg').onclick = () => {
    flush(); const n = neighbour(1);
    if (n) { location.hash = 'modifica/' + n.id; return; }
    if (!created) { const r = collect(); if (r.err) { toast(`Complete this leg first: ${r.err}`); r.el?.focus(); return; } }
    nextLeg(data.flights.find(x => x.id === recId) || f);
  };
}

const CHECKS = ['LINE CHECK', 'OPC', 'LPC', 'OPC/LPC', 'ROUTE CHECK', 'LIFUS', 'LINE TRAINING', 'SKILL TEST', 'FINAL LINE CHECK', 'COMMAND CHECK'];
// tratta successiva: parte da dove è arrivato l'aereo, stessa marca, stesso giorno (o il giorno dopo se si è atterrati dopo mezzanotte)
const legDate = d => d.out && d.inn && toMin(d.inn) < toMin(d.out) ? addDays(d.date, 1) : d.date;
function lastLeg() {
  const td = today();
  return data.flights.filter(f => f.kind === 'flight' && f.date <= td && (!f.planned || f.date === td)).sort((a, b) => (a.date + a.out).localeCompare(b.date + b.out)).at(-1);
}
function nextLeg(base) {
  if (!data) return;
  const [v, id] = location.hash.slice(1).split('/');
  base ||= (v === 'modifica' && data.flights.find(f => f.id === id)) || lastLeg();
  if (!base || !base.arr) { location.hash = 'nuovo'; return; }
  viewEdit.dup = base;
  if (location.hash === '#nuovo') route(); else location.hash = 'nuovo';
}
const LOCK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4.5" y="10.5" width="15" height="10.5" rx="2.2" fill="currentColor"/><path class="shackle" d="M8 10.5V7.5a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
// marca -> tipo: storico del logbook, flotta FlightLog, marche aggiunte a mano
function regTypeOf(r) {
  if (!r) return '';
  return data.aircraft?.[r] || data.flights.findLast(x => x.reg === r && x.type)?.type || KNOWN_AIRCRAFT[r] || '';
}
// tutte le marche conosciute con il loro tipo: flotta FlightLog, storico del logbook, marche aggiunte a mano
function knownRegs() {
  const m = new Map(Object.entries(KNOWN_AIRCRAFT));
  for (const x of data.flights) if (x.kind === 'flight' && x.reg && x.type) m.set(x.reg, x.type);
  for (const [r, t] of Object.entries(data.aircraft || {})) m.set(r, t);
  return m;
}
const normReg = r => String(r || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
// EIRZY -> EI-RZY, con il trattino dove ce l'hanno le marche della stessa serie
function formatReg(v, fleet) {
  if (v.includes('-')) return v;
  const n = normReg(v); let best = null, len = 0;
  for (const k of fleet.keys()) { const kn = normReg(k); let i = 0; while (i < kn.length && kn[i] === n[i]) i++; if (i > len && i >= 2 && k.includes('-')) { len = i; best = k; } }
  if (!best) return v;
  const at = best.indexOf('-'); return at > 0 && at < n.length ? n.slice(0, at) + '-' + n.slice(at) : v;
}
// tipo probabile per una marca nuova, dalla stessa serie (EI-RZx -> B737-8)
function guessType(r) {
  const n = normReg(r), m = knownRegs(); let best = '', len = 0;
  for (const [k, t] of m) { const kn = normReg(k); let i = 0; while (i < kn.length && kn[i] === n[i]) i++; if (i > len && i >= 3) { len = i; best = t; } }
  return best;
}
// "UTC+1" all'ora e alla data del volo, dal fuso dell'aeroporto
function utcLabel(tz, date, time) {
  try {
    const t = Date.parse(`${date || today()}T${normTime(time) || '12:00'}:00Z`);
    const v = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(new Date(t)).find(p => p.type === 'timeZoneName')?.value || '';
    return v === 'GMT' ? 'UTC+0' : v.replace('GMT', 'UTC');
  } catch { return ''; }
}
// planisfero a puntini con l'arco di cerchio massimo della rotta
let WORLD = null, worldLoading = null;
function drawWorld(cv, A, B) {
  if (!cv) return;
  if (!WORLD) { (worldLoading ||= fetch('data/worlddots.json').then(r => r.json()).then(j => { const raw = atob(j.bits); j.b = Uint8Array.from(raw, c => c.charCodeAt(0)); WORLD = j; })).then(() => drawWorld(cv, A, B)).catch(() => {}); return; }
  const r = cv.getBoundingClientRect(); if (!r.width) return;
  const dpr = devicePixelRatio || 1; cv.width = r.width * dpr; cv.height = r.height * dpr;
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, r.width, r.height);
  const { w, h, step, lat0, b } = WORLD;
  // sul telefono il mondo intero è troppo piccolo: lo ingrandisco e lo centro sulla rotta
  const k = Math.max(1, Math.min(2.6, 640 / r.width)), cs = r.width * k / w, mapW = cs * w, mapH = cs * h;
  const midLon = A && B ? gcPoint(A, B, .5)[1] : 10;
  const x0 = Math.max(r.width - mapW, Math.min(0, r.width / 2 - (midLon + 180) / 360 * mapW));
  const y0 = Math.max(Math.min(0, r.height - mapH), Math.min(18, r.height - mapH));
  const ink = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || '#222';
  ctx.fillStyle = ink; ctx.globalAlpha = .13;
  const rad = Math.max(.6, cs * .3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; if (b[i >> 3] & (1 << (i & 7))) { ctx.beginPath(); ctx.arc(x0 + (x + .5) * cs, y0 + (y + .5) * cs, rad, 0, 6.283); ctx.fill(); } }
  ctx.globalAlpha = 1;
  if (!A || !B) return;
  const P = ([la, lo]) => [x0 + (lo + 180) / 360 * mapW, y0 + (lat0 - la) / step * cs];
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--dual').trim() || '#d90'; ctx.lineWidth = 3.2; ctx.lineCap = 'round'; ctx.globalAlpha = .85;
  ctx.beginPath(); let prev = null;
  for (let i = 0; i <= 90; i++) { const p = P(gcPoint(A, B, i / 90)); if (!prev || Math.abs(p[0] - prev[0]) > mapW / 2) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); prev = p; }
  ctx.stroke(); ctx.globalAlpha = 1; ctx.fillStyle = ctx.strokeStyle;
  for (const q of [A, B]) { const p = P(q); ctx.beginPath(); ctx.arc(p[0], p[1], 3.6, 0, 6.283); ctx.fill(); }
}

// ---------- scheda volo: avvicinamenti, nomi aeroporto, firma ----------
const APPROACHES = [
  ['PA, precisione', ['CAT I', 'CAT II', 'CAT 3A', 'CAT 3B', 'CAT 3C', 'ILS PRM', 'GLS', 'GBAS', 'PAR']],
  ['APV, with vertical guidance', ['LNAV/VNAV', 'LPV', 'RNP-AR']],
  ['NPA, non-precision', ['LOC', 'LOC/DME', 'LDA', 'VOR', 'VOR/DME', 'NDB', 'NDB/DME', 'LNAV', 'SRA']],
  ['A vista', ['Visual', 'Circling']]
];
const APPR_ALIAS = { 'CAT IIIA': 'CAT 3A', 'CAT IIIB': 'CAT 3B', 'CAT IIIC': 'CAT 3C', VISUAL: 'Visual' };
function approachSelect(v) {
  v = APPR_ALIAS[String(v || '').toUpperCase()] || v || '';
  const all = APPROACHES.flatMap(g => g[1]);
  return `<select id="approach" aria-label="Approach"><option value="">—</option>${v && !all.includes(v) ? `<option selected>${esc(v)}</option>` : ''}${APPROACHES.map(([g, list]) => `<optgroup label="${g}">${list.map(a => `<option ${a === v ? 'selected' : ''}>${a}</option>`).join('')}</optgroup>`).join('')}</select>`;
}
// "Rome–Fiumicino Leonardo da Vinci International Airport" -> "Rome–Fiumicino Leonardo da Vinci"
function cleanAptName(n) {
  return String(n || '')
    .replace(/^(Aeroporto Internazionale|Aéroport international|Aeroporto|Aeropuerto|Aéroport)\s+(di |de |d'|del |della )?/i, '')
    .replace(/\s*\b(International|Intl\.?)?\s*(Airport|Aerodrome|Airfield|Flughafen)\b/gi, '')
    .replace(/\s*[-–,]\s*$/, '').replace(/\s{2,}/g, ' ').trim();
}
// riquadro per la firma con il dito o con il mouse; la firma salvata è un PNG piccolo
function signaturePad(cv, initial, onDraw) {
  const ctx = cv.getContext('2d');
  let drawn = false, drawing = false, dirty = false, last = null;
  const box = () => cv.getBoundingClientRect();
  const fit = () => {
    const r = box(), dpr = devicePixelRatio || 1;
    cv.width = Math.max(1, Math.round(r.width * dpr)); cv.height = Math.max(1, Math.round(r.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.lineWidth = 2.2; ctx.lineCap = ctx.lineJoin = 'round';
    ctx.strokeStyle = ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || '#111';
  };
  fit();
  if (initial) {
    const im = new Image();
    im.onload = () => { const r = box(), k = Math.min(r.width / im.width, r.height / im.height); ctx.drawImage(im, (r.width - im.width * k) / 2, (r.height - im.height * k) / 2, im.width * k, im.height * k); drawn = true; };
    im.src = initial;
  }
  const pt = e => { const r = box(); return [e.clientX - r.left, e.clientY - r.top]; };
  cv.addEventListener('pointerdown', e => {
    if (!dirty && drawn) { const r = box(); ctx.clearRect(0, 0, r.width, r.height); drawn = false; }
    cv.setPointerCapture(e.pointerId); drawing = true; dirty = true; last = pt(e);
    ctx.beginPath(); ctx.arc(last[0], last[1], 1.1, 0, Math.PI * 2); ctx.fill(); drawn = true;
  });
  cv.addEventListener('pointermove', e => {
    if (!drawing) return; const p = pt(e);
    ctx.beginPath(); ctx.moveTo(last[0], last[1]); ctx.lineTo(p[0], p[1]); ctx.stroke(); last = p;
  });
  const end = () => { if (drawing) onDraw?.(); drawing = false; };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  return {
    clear() { const r = box(); ctx.clearRect(0, 0, r.width, r.height); drawn = false; dirty = true; },
    value() {
      if (!dirty) return initial || null;
      if (!drawn) return null;
      const out = document.createElement('canvas'); out.width = 360; out.height = 120;
      const o = out.getContext('2d'); o.drawImage(cv, 0, 0, out.width, out.height);
      // sempre inchiostro scuro, anche se la firma è stata fatta col tema scuro
      const d = o.getImageData(0, 0, out.width, out.height);
      for (let i = 0; i < d.data.length; i += 4) { d.data[i] = d.data[i + 1] = d.data[i + 2] = 20; }
      o.putImageData(d, 0, 0);
      return out.toDataURL('image/png');
    }
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
    ? `<tr><td>${dmy(f.date)}</td><td></td><td></td><td></td><td></td><td class="pn">FSTD</td><td class="pn">${esc(f.simReg || '')}</td><td></td><td></td><td></td><td></td><td class="pn">${esc(f.picName)}</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td class="pn">${esc(f.simType)}</td><td>${hm(f.sim)}</td><td class="rem">${esc(f.remarks)}</td></tr>`
    : `<tr><td>${dmy(f.date)}</td><td>${esc(f.dep)}</td><td>${esc(f.out)}</td><td>${esc(f.arr)}</td><td>${esc(f.inn)}</td><td class="pn">${esc(f.type)}</td><td>${esc(f.reg)}</td><td>${hm(f.spSe)}</td><td>${hm(f.spMe)}</td><td>${hm(f.mp)}</td><td>${hm(f.total)}</td><td class="pn">${esc(f.picName)}</td><td>${n(f.toDay)}</td><td>${n(f.toNight)}</td><td>${n(f.ldgDay)}</td><td>${n(f.ldgNight)}</td><td>${hm(f.pic)}</td><td>${hm(f.sic)}</td><td>${hm(f.dual)}</td><td>${hm(f.instr)}</td><td>${hm(f.night)}</td><td>${hm(f.ifr)}</td><td></td><td></td><td class="rem">${esc(f.remarks)}${f.check ? `<div class="chk-rem">${esc([f.check.type, f.check.name, f.check.lic].filter(Boolean).join(' · '))}${f.check.sig ? `<img class="sig-img" src="${f.check.sig}" alt="">` : ''}</div>` : ''}${f.signature ? `<img class="sig-img" src="${f.signature}" alt="">` : ''}</td></tr>`).join('')
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
  const range = ps => ps.length ? `pages ${ps[0].n}–${ps.at(-1).n}, ${dmy(ps[0].first)} to ${dmy(ps.at(-1).lastd)}` : '';
  const print = ps => { if (!ps.length) return; $('#printArea').innerHTML = ps.map(p => easaPageHTML(p, st.rpp, pages.length)).join(''); setTimeout(() => window.print(), 50); };
  main.innerHTML = `<h1>EASA logbook print</h1>
  <p class="lede">EASA logbook format (AMC1 FCL.050), ${pages.length} pages of ${st.rpp} lines. In the print dialog choose "Save as PDF".</p>
  <div class="panel"><h2>Last pages</h2>
    <p>What an operator usually asks for: the most recent pages, with totals brought forward and up to date.</p>
    <div class="row"><label>Last <input type="number" id="lastN" min="1" max="${pages.length}" value="${st.last}" style="width:64px" class="btn"> pages</label>
      <button class="btn primary" id="doLast">Print last ${lastN.length} pages</button>
      <span class="hint">${range(lastN)}</span></div></div>
  <div class="panel"><h2>By period</h2>
    <div class="row filters" style="margin:0">
      <label>From <input type="date" id="pf" value="${st.from}"></label>
      <label>To <input type="date" id="pt" value="${st.to}"></label>
      <button class="btn" id="doPrint">Print ${st.from || st.to ? 'period' : 'whole logbook'} (${sel.length} pages)</button></div>
    <p class="hint" style="margin-top:8px">Pages keep the numbering and totals brought forward of the full logbook.</p></div>
  <div class="row filters"><label>Lines per page <select id="rpp">${[14, 16, 18, 20, 22].map(v => `<option ${v === st.rpp ? 'selected' : ''}>${v}</option>`).join('')}</select></label></div>
  <div class="easa-preview" id="pv">${lastN.slice(-1).map(p => easaPageHTML(p, st.rpp, pages.length)).join('')}</div>
  <p class="hint">Preview of the last page.</p>`;
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
// completa solo i campi vuoti: non sovrascrive mai, vale anche per i voli col lucchetto
function fillGaps(f, add) {
  let ch = false;
  for (const [k, v] of Object.entries(add)) {
    if (k === 'sched') { if (v.out && v.inn && !(f.sched?.out && f.sched?.inn)) { f.sched = { out: f.sched?.out || v.out, inn: f.sched?.inn || v.inn }; ch = true; } continue; }
    if (v && !f[k]) { f[k] = v; ch = true; }
  }
  if (ch) f.mt = Date.now();
  return ch;
}
async function enrichFromFlightLog(rows) {
  if (!data) throw new Error('import the logbook first');
  const td = today(); let filled = 0, notFound = 0;
  const idx = new Map(data.flights.filter(f => f.kind === 'flight').map(f => [`${f.date}|${f.dep}|${f.out}`, f]));
  for (const x of rows) {
    if (x.sessiontype === 'SIMULATOR' && x.outschedDate) {
      const sm = data.flights.find(f => f.kind === 'sim' && f.date === x.outschedDate);
      if (sm && fillGaps(sm, { simReg: x.immat || '', picName: x.instructorName || '' })) filled++;
      if (x.immat && !simFleet()[x.immat] && x.aircraftname) (data.simulators ||= {})[x.immat] = { type: x.aircraftname };
      continue;
    }
    if (x.sessiontype !== 'FLIGHT' || !x.outschedDate || x.outschedDate > td) continue;
    const f = idx.get(`${x.outschedDate}|${x.OUTOACI}|${x.outreal}`);
    if (!f) { notFound++; continue; }
    const add = { sched: { out: x.outsched || '', inn: x.insched || '' }, off: x.offtime || '', on: x.ontime || '', pax: num(x.PAX), payload: parseDec(x.payload), fuelUsed: parseDec(x.fuel), fuelPlan: parseDec(x.fuel_prev), approach: x.ApproachType || '', nm: num(x.ortho), flightNo: x.flightnumber || '' };
    if (fillGaps(f, add)) filled++;
  }
  await save(`${filled} entries completed with FlightLog data${notFound ? `, ${notFound} not found` : ''}`);
  route();
}
async function importFile(file) {
  const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  if (/\.pdf$/i.test(file.name) || String.fromCharCode(...head) === '%PDF-') return importNetline(await file.arrayBuffer());
  const text = await file.text();
  if (/\.json$/i.test(file.name) || /^[{[]/.test(text.trim())) {
    const d = JSON.parse(text);
    if (Array.isArray(d) && d[0] && 'sessiontype' in d[0]) return enrichFromFlightLog(d);
    if (!d.flights || !Array.isArray(d.flights)) throw new Error('the file does not contain a logbook');
    if (data && data.flights.length && !confirm(`Replace the current logbook (${data.flights.length} entries) with the one in the file (${d.flights.length} entries)?`)) return;
    normalizeTypes(d); d.forcePush = true; data = d; await save(`${d.flights.length} entries imported`); route(); return;
  }
  // CSV FlightLog: aggiunge solo le righe nuove
  const rows = parseCSV(text);
  if (!rows.length || !('Date' in rows[0]) || !('Registration' in rows[0])) throw new Error('this does not look like a FlightLog CSV export');
  if (!data) data = { version: 1, pilot: '', opening: Object.fromEntries(SUM_KEYS.map(k => [k, 0])), flights: [] };
  const regType = { ...KNOWN_AIRCRAFT }; for (const f of data.flights) if (f.reg && f.type) regType[f.reg] = f.type;
  const key = f => `${f.date}|${f.kind === 'sim' ? 'SIM' : f.dep}|${f.out}`;
  const have = new Set(data.flights.map(key));
  let added = 0, untyped = 0, completed = 0;
  for (const x of rows) {
    const f = flightLogRecord(x, regType);
    if (!f.date) continue;
    const pl = f.kind === 'flight' && data.flights.find(e => e.planned && e.date === f.date && e.dep === f.dep && e.arr === f.arr);
    if (pl) {   // volo del roster ora volato: diventa la tratta con gli effettivi, stesso id
      const sched = pl.sched || { out: pl.out, inn: pl.inn };
      Object.assign(pl, f, { id: pl.id, flightNo: f.flightNo || pl.flightNo, crew: pl.crew, mt: Date.now() });
      pl.sched = (x.SchedOut && x.SchedIn) ? { out: x.SchedOut, inn: x.SchedIn } : sched;
      delete pl.planned; delete pl.change; have.add(key(pl)); completed++;
      continue;
    }
    if (have.has(key(f))) {
      const ex = data.flights.find(e => key(e) === key(f));
      if (ex && ex.kind === 'flight' && fillGaps(ex, { sched: { out: x.SchedOut || '', inn: x.SchedIn || '' }, off: x.Off || '', on: x.On || '', pax: num(x.Pax), payload: parseDec(x.Payload), fuelUsed: parseDec(x.Fuel), fuelPlan: parseDec(x['Fuel Prev']), approach: x.Approaches || '', nm: num(x.Distance) })) completed++;
      continue;
    }
    f.id = nextId(); f.mt = Date.now(); data.flights.push(f); have.add(key(f)); added++;
    if (f.kind === 'flight' && !f.type) untyped++;
  }
  const msg = [added && `${added} entries added`, completed && `${completed} completed`].filter(Boolean).join(', ');
  await save(msg ? msg + ' from FlightLog' : 'Nothing new in the CSV');
  if (untyped) toast(`${untyped} flights without aircraft type: complete them in Flights`);
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
  ['', 'Automatic', 'Neutral by day, Cockpit when the device is in dark mode', ['#f4f5f7', '#0f766e', '#9aa5b4', '#0b0e12', '#e15bd8']],
  ['neutro', 'Neutral', 'Light and clean, PIC in teal', ['#ffffff', '#1d232c', '#0f766e', '#9aa5b4', '#d97706']],
  ['carta', 'Paper', 'Like a paper logbook, PIC in burgundy', ['#fffefb', '#22262b', '#8c1c2b', '#8f9aa6', '#c08a1e']],
  ['cockpit', 'Cockpit', 'Dark, Boeing display colours', ['#0b0e12', '#141a21', '#e15bd8', '#3fc1d3', '#f2a900']]
];
function applyTheme(t) {
  if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  try { t ? localStorage.setItem('theme', t) : localStorage.removeItem('theme'); } catch { /* preferenza non salvata */ }
}
function viewData(main) {
  const n = data?.flights.length || 0;
  const cur = document.documentElement.dataset.theme || '';
  const cid = gdClientId(), last = ls.get('gdLast');
  const sec = (icon, title, body) => `<section class="set-sec"><h2><svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>${title}</h2><div class="set-group">${body}</div></section>`;
  const I = {
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
    cloud: '<path d="M7 18h10a4 4 0 0 0 .6-7.96A6 6 0 0 0 6.2 9.1 4.5 4.5 0 0 0 7 18z"/>',
    folder: '<path d="M3 7.5V18a1.5 1.5 0 0 0 1.5 1.5h15A1.5 1.5 0 0 0 21 18V9a1.5 1.5 0 0 0-1.5-1.5H12L10 5H4.5A1.5 1.5 0 0 0 3 6.5z"/>',
    imp: '<path d="M12 3v12M7.5 10.5 12 15l4.5-4.5M4 17v2.5h16V17"/>',
    exp: '<path d="M12 15V3M7.5 7.5 12 3l4.5 4.5M4 17v2.5h16V17"/>',
    theme: '<circle cx="12" cy="12" r="8.5"/><circle cx="8.5" cy="10" r="1.3"/><circle cx="12" cy="7.5" r="1.3"/><circle cx="15.5" cy="10" r="1.3"/><path d="M12 20.5c-1.5 0-2-1-2-2s1-1.8 2.2-1.8"/>'
  };
  main.innerHTML = `<h1>Settings</h1>
  <p class="lede">${n ? `${fmtN(n)} entries${data.updated ? ` · last modified ${new Date(data.updated).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}` : 'The logbook is empty.'}</p>
  ${n ? sec(I.user, 'Profile', `
    <label class="set-row"><span class="k">Name in logbook</span><input id="dPilot" value="${esc(data.pilot || '')}" placeholder="SURNAME NAME" autocapitalize="characters"></label>
    <div class="set-row"><span class="k">Printed on</span><span class="v">EASA pages and certification line</span></div>`) : ''}
  ${sec(I.cloud, 'Google Drive', cid ? `
    <div class="set-row"><span class="k">Status</span><span class="v">${gdConnected() ? (last ? `Synced ${new Date(last).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : 'Connected, not synced yet') : 'Not connected'}${GD.state === 'err' ? ` · <span class="bad">${esc(GD.msg)}</span>` : ''}</span></div>
    <div class="set-row"><span class="k">File</span><span class="v">Logbook/logbook.json</span></div>
    <div class="set-row act"><button class="btn primary" id="gdSync">${gdConnected() ? 'Sync now' : 'Connect Google Drive'}</button>${gdConnected() ? '<button class="btn" id="gdOff">Disconnect this device</button>' : ''}</div>`
    : `<div class="set-row col"><span class="k">Google OAuth client ID</span><div class="row" style="margin:0"><input id="gdCid" style="flex:1;min-width:240px" placeholder="123456-abc.apps.googleusercontent.com"><button class="btn" id="gdCidSave">Save</button></div></div>`)}
  ${sec(I.folder, 'Backup folder', `
    <div class="set-row"><span class="k">Folder</span><span class="v">${dirHandle ? esc(dirHandle.name) : fsSupported ? 'None' : 'Needs Chrome on the Mac'}</span></div>
    ${fsSupported ? `<div class="set-row act"><button class="btn" id="dChoose">${dirHandle ? 'Change folder' : 'Choose folder'}</button><span class="hint">logbook.json on every change, daily copy in “storico”.</span></div>` : '<div class="set-row"><span class="hint">Safari cannot write to a folder. Google Drive keeps the copy in the cloud.</span></div>'}`)}
  ${sec(I.imp, 'Import', `
    <div class="set-row act"><label class="btn primary file-btn">Choose file<input type="file" id="dFile" hidden></label><button type="button" class="btn" data-act="roster">Import roster</button></div>
    <details class="set-row col more"><summary>What can be imported</summary>
      <ul><li><b>NetLine Individual duty plan (PDF)</b>: adds new flights, updates changed ones, removes cancelled ones. Flights with actual times or locked are never touched.</li>
      <li><b>FlightLog CSV export</b>: adds only flights not yet in the logbook.</li>
      <li><b>FlightLog sync file</b>: completes past flights with PAX, fuel, payload, approach and distance.</li>
      <li><b>logbook.json</b>: replaces the whole logbook.</li></ul></details>`)}
  ${sec(I.exp, 'Export', `
    <div class="set-row act"><button class="btn" id="dJson" ${n ? '' : 'disabled'}>logbook.json</button><button class="btn" id="dCsv" ${n ? '' : 'disabled'}>CSV for spreadsheets</button><a class="btn" href="#stampa">EASA print</a></div>`)}
  ${n ? sec('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>', 'Lock', `
    <div class="set-row"><span class="k">Locked entries</span><span class="v">${fmtN(data.flights.filter(f => f.locked).length)} of ${fmtN(data.flights.filter(f => !f.planned).length)} completed</span></div>
    <div class="set-row act"><button class="btn" id="dLockAll">Lock all completed entries</button><span class="hint">Planned flights from the roster stay editable.</span></div>`) : ''}
  ${sec(I.theme, 'Theme', `
    <div class="set-row col"><div class="theme-pick" role="radiogroup" aria-label="Theme">${THEMES.map(([k, name, desc, sw]) => `<label><input type="radio" name="theme" value="${k}" ${k === cur ? 'checked' : ''}><div class="sw">${sw.map(c => `<i style="background:${c}"></i>`).join('')}</div><b>${name}</b><span>${desc}</span></label>`).join('')}</div></div>`)}
  <p class="hint set-ver">Logbook ${APP_VERSION} · ${APP_DATE}</p>`;
  main.querySelectorAll('input[name=theme]').forEach(r => r.onchange = () => applyTheme(r.value));
  bindDrivePanel(main);
  $('#dChoose')?.addEventListener('click', chooseFolder);
  $('#dFile').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { await importFile(f); } catch (err) { toast('Import failed: ' + err.message); } e.target.value = ''; };
  if (n) {
    $('#dJson').onclick = () => download(`logbook-${today()}.json`, JSON.stringify(data, null, 1), 'application/json');
    $('#dCsv').onclick = exportCSV;
    $('#dLockAll').onclick = async () => { const now = Date.now(); let k = 0; for (const f of data.flights) if (!f.planned && !f.locked) { f.locked = true; f.mt = now; k++; } await save(k ? `${k} entries locked` : 'All completed entries are already locked'); viewData(main); };
    const p = $('#dPilot');
    p.onchange = async () => { const v = p.value.trim().toUpperCase(); p.value = v; if (v === (data.pilot || '')) return; data.pilot = v; data.metaMt = Date.now(); await save('Name saved'); };
  }
}



// ---------- NetLine: voli programmati dal PDF "Individual duty plan" ----------
// I voli già nel logbook non si toccano mai. Entrano solo i voli nuovi, con i blocchi schedulati, segnati come programmati
// (fuori dai totali) con il pallino finché non si apre il volo. Se un volo ancora programmato cambia nel turno, si aggiorna e riprende il pallino.
let IATA = null;
async function importNetline(buf) {
  if (!data) throw new Error('import the logbook first');
  toast('Reading NetLine PDF…');
  // Safari (iPad) non sa ancora scorrere un ReadableStream con for await: lo aggiungo prima di caricare pdf.js
  if (typeof ReadableStream !== 'undefined' && !ReadableStream.prototype[Symbol.asyncIterator]) {
    ReadableStream.prototype[Symbol.asyncIterator] = async function* () {
      const reader = this.getReader();
      try { for (;;) { const { done, value } = await reader.read(); if (done) return; yield value; } } finally { reader.releaseLock(); }
    };
  }
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
  if (!legs.length) throw new Error('no flights found in the PDF: is it a NetLine Individual duty plan?');
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
      remarks: '', crew: cockpit.map(c => c.code).join(' ')
    };
    const ex = byKey.get(k);
    if (ex && !ex.planned) { untouched++; continue; }       // già nel logbook con gli effettivi: non si tocca
    if (ex && ex.planned) {
      if (ex.sched?.out !== out || ex.sched?.inn !== inn) {
        ex.change = `times changed from ${ex.sched?.out}–${ex.sched?.inn} to ${out}–${inn}`;
        Object.assign(ex, fields, { seen: false, mt: Date.now() }); updated++;
      }
      continue;
    }
    const rec = { ...EMPTY(), ...fields, id: nextId(), kind: 'flight', type: '', reg: '', src: 'netline', planned: true, seen: false, mt: Date.now() };
    data.flights.push(rec); byKey.set(k, rec); added++;
  }
  // voli ancora programmati nel periodo del PDF che nel turno nuovo non ci sono più
  const p0 = roster.meta?.periodStart, p1 = roster.meta?.periodEnd;
  // vengono tolti: se non sono più nel turno non si fanno. I voli confermati o bloccati non si toccano mai.
  if (p0 && p1) {
    const goneIds = data.flights.filter(f => f.kind === 'flight' && f.planned && !f.locked && f.date >= p0 && f.date <= p1 && !seenKeys.has(key(f))).map(f => f.id);
    if (goneIds.length) {
      const del = (data.deleted ||= {}); for (const id of goneIds) del[id] = Date.now();
      data.flights = data.flights.filter(f => !goneIds.includes(f.id)); gone = goneIds.length;
    }
  }
  const parts = [`${added} added`, updated && `${updated} changed`, gone && `${gone} removed (no longer in roster)`, untouched && `${untouched} already flown, unchanged`].filter(Boolean);
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
  return `<div class="plan-alert" role="alert"><b>${late.length === 1 ? '1 past flight still has' : `${late.length} past flights still have`} scheduled times only.</b> Enter actual times to include them in the totals.
    <button class="btn small" data-plan-go>Show</button></div>`;
}
function bindPlannedBanner(main) { const b = main.querySelector('[data-plan-go]'); if (b) b.onclick = () => { viewFlights.st = { year: '', type: '__planned', q: '', all: false }; location.hash === '#voli' ? route() : (location.hash = 'voli'); }; }
function updateBadge() {
  const a = document.querySelector('.side a[data-view="voli"]'); if (!a || !data) return;
  const n = data.flights.filter(f => f.planned && !f.seen).length;
  let b = a.querySelector('.badge'); if (!n) { b?.remove(); return; }
  if (!b) { b = document.createElement('span'); b.className = 'badge'; a.append(b); }
  b.textContent = n; b.title = `${n} unseen flights`;
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
  return gisLoading ||= new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.onload = res; s.onerror = () => { gisLoading = null; rej(new Error('Google unreachable, check the connection')); }; document.head.append(s); });
}
async function gdToken(interactive) {
  if (gdTokenOk()) return GD.token;
  if (!interactive) throw Object.assign(new Error('Google sign-in needs renewing'), { auth: true });
  await gisLoad();
  return new Promise((res, rej) => {
    const tc = google.accounts.oauth2.initTokenClient({
      client_id: gdClientId(), scope: GD_SCOPE,
      callback: r => { if (r.error) return rej(new Error(r.error_description || r.error)); GD.token = r.access_token; GD.exp = Date.now() + r.expires_in * 1000; ss.set('gdTok', GD.token); ss.set('gdExp', GD.exp); res(GD.token); },
      error_callback: e => rej(new Error(e.type === 'popup_closed' ? 'sign-in cancelled' : e.type === 'popup_failed_to_open' ? 'the browser blocked the Google window' : (e.message || e.type)))
    });
    tc.requestAccessToken({ prompt: ls.get('gdOn') === '1' ? '' : 'consent' });
  });
}
async function gdFetch(url, opt = {}) {
  const r = await fetch(url, { ...opt, headers: { ...(opt.headers || {}), Authorization: 'Bearer ' + GD.token } });
  if (r.status === 401) { GD.token = null; ss.set('gdTok', null); throw Object.assign(new Error('Google sign-in expired'), { auth: true }); }
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
  return { version: meta.version || 1, aircraft: { ...(remote.aircraft || {}), ...(local.aircraft || {}) }, simulators: { ...(remote.simulators || {}), ...(local.simulators || {}) }, simRegDone: local.simRegDone || remote.simRegDone, lockAllDone: local.lockAllDone || remote.lockAllDone, pilot: meta.pilot, opening: meta.opening, metaMt: meta.metaMt || 0, generated: meta.generated, updated: [local.updated, remote.updated].sort().at(-1), deleted: del, flights };
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
    if (interactive) toast('Sync failed: ' + e.message);
  } finally { GD.busy = false; renderSyncState(); if (location.hash === '#dati') route(); }
}
let syncTimer;
function scheduleSync() { if (gdConnected() && gdTokenOk()) { clearTimeout(syncTimer); syncTimer = setTimeout(() => syncNow(false), 1500); } else if (gdConnected()) { GD.state = 'login'; renderSyncState(); } }
// ---------- menu a scomparsa (iPad e telefono) ----------
function openMenu() { document.body.classList.add('menu-open'); $('#scrim').hidden = false; $('#menuBtn')?.setAttribute('aria-expanded', 'true'); $('#sideNav a')?.focus(); }
function closeMenu() { if (!document.body.classList.contains('menu-open')) return; document.body.classList.remove('menu-open'); $('#scrim').hidden = true; $('#menuBtn')?.setAttribute('aria-expanded', 'false'); }
document.addEventListener('DOMContentLoaded', () => {});
(() => {
  const mb = document.getElementById('menuBtn'); if (!mb) return;
  mb.onclick = () => document.body.classList.contains('menu-open') ? closeMenu() : openMenu();
  document.getElementById('scrim').onclick = closeMenu;
  document.getElementById('sideNav').addEventListener('click', e => { if (e.target.closest('a')) closeMenu(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-act]'); if (!a) return;
    e.preventDefault(); closeMenu();
    if (a.dataset.act === 'next') nextLeg();
    else if (a.dataset.act === 'roster') document.getElementById('rosterFile').click();
  });
  document.getElementById('rosterFile').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { await importFile(f); route(); } catch (err) { toast('Import failed: ' + err.message); }
    e.target.value = '';
  };
  document.getElementById('tbSync').onclick = () => { if (gdClientId()) syncNow(true); else location.hash = 'dati'; };
})();
function renderSyncState() {
  const tb = $('#tbSync');
  if (tb) { const ok = gdConnected() && GD.state !== 'err' && GD.state !== 'login' && gdTokenOk(); tb.classList.toggle('ok', ok); tb.classList.toggle('busy', GD.state === 'sync'); tb.classList.toggle('warn', gdConnected() && !ok && GD.state !== 'sync'); tb.title = ok ? `Google Drive synced${ls.get('gdLast') ? ' ' + new Date(ls.get('gdLast')).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''}` : gdConnected() ? 'Tap to sync with Google Drive' : 'Google Drive not connected'; }
  let el = $('#syncState');
  if (!el) { el = document.createElement('div'); el.id = 'syncState'; el.className = 'sync-state'; $('#backupState').before(el); }
  if (!gdClientId()) { el.innerHTML = ''; el.hidden = true; return; }
  el.hidden = false;
  const last = ls.get('gdLast');
  const when = last ? new Date(last).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
  if (!gdConnected()) el.innerHTML = `Google Drive not connected.<br><button class="btn small" id="sySync">Connect Google Drive</button>`;
  else if (GD.state === 'sync') el.innerHTML = 'Google Drive: syncing…';
  else if (GD.state === 'err') el.innerHTML = `Google Drive: ${esc(GD.msg)}<br><button class="btn small" id="sySync">Retry</button>`;
  else if (GD.state === 'login' || !gdTokenOk()) el.innerHTML = `Google Drive${when ? `: last sync ${when}` : ''}.<br><button class="btn small" id="sySync">Sync</button>`;
  else el.innerHTML = `Google Drive synced${when ? ` at ${when}` : ''}`;
  const b = $('#sySync'); if (b) b.onclick = () => syncNow(true);
}
function drivePanelHTML() {
  const cid = gdClientId(), last = ls.get('gdLast');
  return `<div class="panel"><h2>Google Drive</h2>
    <p>Connect Google Drive to use the same logbook on Mac and iPad. The file is <b>Logbook/logbook.json</b> in your Drive and updates automatically on every change.</p>
    ${cid ? `<div class="row">
        <button class="btn primary" id="gdSync">${gdConnected() ? 'Sync now' : 'Connect Google Drive'}</button>
        ${gdConnected() ? '<button class="btn" id="gdOff">Disconnect this device</button>' : ''}
        <span class="hint">${gdConnected() ? (last ? `Last sync ${new Date(last).toLocaleString('en-GB')}` : 'Not synced yet') : ''}${GD.state === 'err' ? `. Error: ${esc(GD.msg)}` : ''}</span></div>`
      : `<p class="hint">A Google OAuth client ID is required first (created once in the Google Cloud Console). Paste it here:</p>
      <div class="row"><input id="gdCid" class="btn" style="flex:1;min-width:260px;text-align:left" placeholder="123456-abc.apps.googleusercontent.com"><button class="btn" id="gdCidSave">Save</button></div>`}
  </div>`;
}
function bindDrivePanel(main) {
  const s = main.querySelector('#gdSync'); if (s) s.onclick = () => syncNow(true);
  const o = main.querySelector('#gdOff'); if (o) o.onclick = () => { if (!confirm('Disconnect Google Drive from this device? Data stays both here and on Drive.')) return; ls.set('gdOn', null); ls.set('gdFile', null); GD.token = null; ss.set('gdTok', null); renderSyncState(); route(); };
  const c = main.querySelector('#gdCidSave'); if (c) c.onclick = () => { const v = main.querySelector('#gdCid').value.trim(); if (!/\.apps\.googleusercontent\.com$/.test(v)) return toast('This does not look like a Google client ID'); ls.set('gdClient', v); renderSyncState(); route(); };
}
function driveStartup() {
  renderSyncState();
  if (gdConnected() && gdTokenOk()) syncNow(false);
  window.addEventListener('online', () => { if (gdConnected() && gdTokenOk()) syncNow(false); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && gdConnected() && gdTokenOk()) syncNow(false); });
}

// ---------- avvio ----------
(async () => {
  try { data = await idb.get('data') || null; } catch (e) { toast('Local storage not available: ' + e.message); }
  if (data && normalizeTypes(data)) await save('Logbook updated');
  try {
    dirHandle = await idb.get('dir') || null;
    if (dirHandle && (await dirHandle.queryPermission({ mode: 'readwrite' })) === 'granted') { backupOk = true; lastBackup = data?.updated ? new Date(data.updated) : new Date(); }
  } catch { dirHandle = null; }
  $("#version").textContent = `Version ${APP_VERSION} · ${APP_DATE}`;
  renderBackupState();
  route();
  updateBadge();
  driveStartup();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw?.addEventListener('statechange', () => { if (nw.state === 'activated' && navigator.serviceWorker.controller) toast('App updated: reload the page for the new version'); });
      });
    }).catch(() => {});
  }
})();
