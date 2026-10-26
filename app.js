'use strict';
/* Logbook – PWA locale. Tutti i dati restano nel browser (IndexedDB) e nella cartella di backup scelta. */

// ---------- utilità ----------
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hm = m => { m = Math.round(m || 0); if (!m) return ''; const s = m < 0 ? '-' : ''; m = Math.abs(m); return `${s}${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };
const hm0 = m => hm(m) || '0:00';
const parseHM = s => { s = String(s || '').trim().replace('.', ':'); if (!s) return 0; const m = s.match(/^(\d{1,5})(?::(\d{1,2}))?$/); if (!m) return NaN; return +m[1] * 60 + (+m[2] || 0); };
const toMin = t => { const m = String(t || '').match(/^(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : null; };
const today = () => new Date().toISOString().slice(0, 10);
const dmy = d => d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)}` : '';
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const num = v => { const n = parseInt(v, 10); return n > 0 ? n : 0; };
const toast = msg => { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2600); };

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
function nextId() { let n = 0; for (const f of data.flights) { const k = parseInt(String(f.id).slice(1), 10); if (k > n) n = k; } return 'f' + String(n + 1).padStart(5, '0'); }

async function save(msg) {
  sortFlights();
  data.updated = new Date().toISOString();
  await idb.set('data', data);
  if (msg) toast(msg);
  scheduleBackup();
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

// ---------- calcoli ----------
function sum(list, withOpening) {
  const t = Object.fromEntries(SUM_KEYS.map(k => [k, 0])); t.legs = 0; t.sims = 0;
  if (withOpening && data.opening) for (const k of SUM_KEYS) t[k] += data.opening[k] || 0;
  for (const f of list) { for (const k of SUM_KEYS) t[k] += f[k] || 0; if (f.kind === 'sim') t.sims++; else t.legs++; }
  return t;
}
const roleOf = f => f.kind === 'sim' ? 'SIM' : f.pic > 0 ? (/picus/i.test(f.remarks) ? 'PICUS' : 'PIC') : f.dual > 0 ? 'DUAL' : f.sic > 0 ? 'SIC' : '';
function flightsIn(from, to) { return data.flights.filter(f => (!from || f.date >= from) && (!to || f.date <= to)); }

// ---------- router ----------
const views = { riepilogo: viewSummary, voli: viewFlights, nuovo: viewEdit, modifica: viewEdit, stampa: viewPrint, dati: viewData };
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
    ${g('Tempo totale', c('Totale', hm0(t.total), true))}
    ${g('Single pilot', c('SE', hm0(t.spSe)) + c('ME', hm0(t.spMe)))}
    ${g('Multi pilot', c('MP', hm0(t.mp)))}
    ${g('Funzione', c('PIC', hm0(t.pic)) + c('Copilota', hm0(t.sic)) + c('Dual', hm0(t.dual)) + c('Istruttore', hm0(t.instr)))}
    ${g('Condizioni', c('Notte', hm0(t.night)) + c('IFR', hm0(t.ifr)))}
    ${g('Decolli', c('Giorno', t.toDay) + c('Notte', t.toNight))}
    ${g('Atterraggi', c('Giorno', t.ldgDay) + c('Notte', t.ldgNight))}
    ${g('Simulatore', c('FSTD', hm0(t.sim)))}
  </div>`;
}
function viewSummary(main) {
  const years = [...new Set(data.flights.map(f => f.date.slice(0, 4)))].sort().reverse();
  const sel = viewSummary.period || 'all';
  let list = data.flights, withOpen = true, label = 'dall\'inizio della carriera, compreso il riporto ante 2007';
  if (sel === '12m') { list = flightsIn(addDays(today(), -365)); withOpen = false; label = 'ultimi 12 mesi'; }
  else if (/^\d{4}$/.test(sel)) { list = flightsIn(sel + '-01-01', sel + '-12-31'); withOpen = false; label = 'anno ' + sel; }
  const t = sum(list, withOpen);

  // limiti e recency
  const td = today();
  const fl = data.flights.filter(f => f.kind === 'flight');
  const last = (from) => sum(fl.filter(f => f.date >= from && f.date <= td));
  const d28 = last(addDays(td, -27)), y = last(td.slice(0, 4) + '-01-01'), m12 = last(addDays(td, -364)), d90 = last(addDays(td, -89));
  const lastFlight = fl[fl.length - 1];
  const curType = lastFlight ? lastFlight.type : '';
  const typ90 = sum(fl.filter(f => f.type === curType && f.date >= addDays(td, -89)));
  const ok90 = (typ90.toDay + typ90.toNight) >= 3 && (typ90.ldgDay + typ90.ldgNight) >= 3;

  // per anno
  const byYear = {}; for (const f of data.flights) (byYear[f.date.slice(0, 4)] ||= []).push(f);
  const yrows = Object.keys(byYear).sort().reverse().map(yr => { const s = sum(byYear[yr]); return `<tr><td class="l">${yr}</td><td>${s.legs}</td><td>${hm(s.total)}</td><td>${hm(s.pic)}</td><td>${hm(s.sic)}</td><td>${hm(s.dual)}</td><td>${hm(s.night)}</td><td>${s.ldgDay + s.ldgNight || ''}</td><td>${hm(s.sim)}</td></tr>`; }).join('');
  // per tipo
  const byType = {}; for (const f of list) if (f.kind === 'flight') (byType[f.type || '—'] ||= []).push(f);
  const trows = Object.entries(byType).map(([k, v]) => [k, sum(v), v[v.length - 1].date]).sort((a, b) => b[1].total - a[1].total)
    .map(([k, s, ld]) => `<tr><td class="l">${esc(k)}</td><td>${s.legs}</td><td>${hm(s.total)}</td><td>${hm(s.pic)}</td><td>${hm(s.sic)}</td><td>${dmy(ld)}</td></tr>`).join('');

  main.innerHTML = `<h1>Riepilogo</h1>
  <p class="lede">${t.legs} tratte e ${t.sims} sessioni al simulatore, ${label}.</p>
  <div class="row filters"><label for="per">Periodo</label>
    <select id="per"><option value="all">Tutta la carriera</option><option value="12m">Ultimi 12 mesi</option>${years.map(y => `<option value="${y}">${y}</option>`).join('')}</select></div>
  ${stripHTML(t)}
  <h2>Limiti e recency</h2>
  <div class="recency">
    <div><b>${hm0(d28.total)}</b><span>ultimi 28 giorni (limite 100 h)</span></div>
    <div><b>${hm0(y.total)}</b><span>anno ${td.slice(0, 4)} (limite 900 h)</span></div>
    <div><b>${hm0(m12.total)}</b><span>ultimi 12 mesi (limite 1000 h)</span></div>
    <div><b>${d90.toDay + d90.toNight} / ${d90.ldgDay + d90.ldgNight}</b><span>decolli / atterraggi ultimi 90 giorni</span></div>
    <div class="${ok90 ? '' : 'warn'}"><b>${typ90.toDay + typ90.toNight} / ${typ90.ldgDay + typ90.ldgNight}</b><span>${esc(curType)} negli ultimi 90 giorni${ok90 ? '' : ': meno di 3, serve recency'}</span></div>
    <div><b>${lastFlight ? dmy(lastFlight.date) : '—'}</b><span>ultimo volo${lastFlight ? `, ${esc(lastFlight.dep)}–${esc(lastFlight.arr)}` : ''}</span></div>
  </div>
  <div class="two">
    <div><h2>Per anno</h2><div class="scroll"><table class="data"><thead><tr><th class="l">Anno</th><th>Tratte</th><th>Totale</th><th>PIC</th><th>Copilota</th><th>Dual</th><th>Notte</th><th>Atterr.</th><th>Sim</th></tr></thead><tbody>${yrows}</tbody></table></div></div>
    <div><h2>Per tipo di aereo</h2><table class="data"><thead><tr><th class="l">Tipo</th><th>Tratte</th><th>Totale</th><th>PIC</th><th>Copilota</th><th>Ultimo volo</th></tr></thead><tbody>${trows}</tbody></table>
    ${withOpen ? `<p class="hint">Il riporto ante 2007 (${hm(data.opening.total)}) entra nei totali ma non nelle tabelle per anno e per tipo.</p>` : ''}</div>
  </div>`;
  const per = $('#per'); per.value = sel; per.onchange = () => { viewSummary.period = per.value; viewSummary(main); };
}

// ---------- Voli ----------
function viewFlights(main) {
  const st = viewFlights.st ||= { year: '', type: '', q: '', all: false };
  const years = [...new Set(data.flights.map(f => f.date.slice(0, 4)))].sort().reverse();
  const types = [...new Set(data.flights.map(f => f.kind === 'sim' ? 'Simulatore' : f.type).filter(Boolean))].sort();
  const q = st.q.toLowerCase();
  let list = data.flights.filter(f => (!st.year || f.date.startsWith(st.year)) &&
    (!st.type || (st.type === 'Simulatore' ? f.kind === 'sim' : f.type === st.type)) &&
    (!q || [f.dep, f.arr, f.reg, f.picName, f.remarks, f.simType, f.flightNo].join(' ').toLowerCase().includes(q)));
  const t = sum(list);
  list = list.slice().reverse();
  const shown = st.all ? list : list.slice(0, 300);
  const rows = shown.map(f => {
    const r = roleOf(f);
    if (f.kind === 'sim') return `<tr class="click" data-id="${f.id}"><td class="l">${dmy(f.date)}</td><td class="l" colspan="4">${esc(f.simType)}</td><td class="l"><span class="tag sim">SIM</span></td><td></td><td>${hm(f.sim)}</td><td></td><td></td><td></td><td></td><td class="l">${esc(f.picName)}</td><td class="rem">${esc(f.remarks)}</td></tr>`;
    return `<tr class="click" data-id="${f.id}"><td class="l">${dmy(f.date)}</td><td class="l">${esc(f.dep)}</td><td>${esc(f.out)}</td><td class="l">${esc(f.arr)}</td><td>${esc(f.inn)}</td><td class="l">${esc(f.type)}</td><td class="l">${esc(f.reg)}</td><td>${hm(f.total)}</td><td><span class="tag${r.startsWith('PIC') ? ' pic' : ''}">${r}</span></td><td>${hm(f.night)}</td><td>${(f.toDay + f.toNight) || ''}</td><td>${(f.ldgDay + f.ldgNight) || ''}</td><td class="l">${esc(f.picName)}</td><td class="rem">${esc(f.remarks)}</td></tr>`;
  }).join('');
  main.innerHTML = `<h1>Voli</h1>
  <p class="lede">${t.legs} tratte, ${hm0(t.total)} di volo${t.sims ? `, ${t.sims} sessioni al simulatore (${hm0(t.sim)})` : ''}.</p>
  <div class="row filters">
    <select id="fy" aria-label="Anno"><option value="">Tutti gli anni</option>${years.map(y => `<option>${y}</option>`).join('')}</select>
    <select id="ft" aria-label="Tipo"><option value="">Tutti i tipi</option>${types.map(y => `<option>${esc(y)}</option>`).join('')}</select>
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
  main.querySelector('tbody').onclick = e => { const tr = e.target.closest('tr[data-id]'); if (tr) location.hash = 'modifica/' + tr.dataset.id; };
}

// ---------- Nuovo / modifica ----------
function viewEdit(main, id) {
  const orig = id ? data.flights.find(f => f.id === id) : null;
  if (id && !orig) { main.innerHTML = '<h1>Volo non trovato</h1><p><a href="#voli">Torna ai voli</a></p>'; return; }
  const last = data.flights.filter(f => f.kind === 'flight').at(-1);
  const f = orig ? { ...orig } : { ...EMPTY(), date: today(), type: last?.type || '', reg: '', dep: last?.arr || '' };
  const role = orig ? roleOf(orig) : 'PIC';
  const isSim = f.kind === 'sim';
  const regs = [...new Set(data.flights.map(x => x.reg).filter(Boolean))].sort();
  const typesL = [...new Set(data.flights.map(x => x.type).filter(Boolean))].sort();
  const simTypes = [...new Set(data.flights.map(x => x.simType).filter(Boolean))].sort();
  const mpOn = !orig || f.mp > 0 || !(f.spSe || f.spMe);
  const ifrAll = !orig || f.ifr === f.total;

  main.innerHTML = `<h1>${orig ? 'Modifica' : 'Nuovo'} ${isSim ? 'simulatore' : 'volo'}</h1>
  <p class="lede">${orig ? dmy(orig.date) + (isSim ? '' : ` ${esc(orig.dep)}–${esc(orig.arr)}`) : 'I tempi si calcolano da Off e On; puoi correggerli a mano.'}</p>
  <form class="flight" id="ff" novalidate>
    <fieldset><div class="seg" role="radiogroup" aria-label="Tipo di registrazione">
      <label><input type="radio" name="kind" value="flight" ${!isSim ? 'checked' : ''}><span>Volo</span></label>
      <label><input type="radio" name="kind" value="sim" ${isSim ? 'checked' : ''}><span>Simulatore</span></label></div></fieldset>
    <div id="fFlight" ${isSim ? 'hidden' : ''}>
    <fieldset><legend>Tratta</legend><div class="grid">
      <div class="field"><label for="date">Data</label><input id="date" type="date" value="${esc(f.date)}" required></div>
      <div class="field"><label for="dep">Partenza</label><input id="dep" value="${esc(f.dep)}" maxlength="4" style="text-transform:uppercase" placeholder="LIMC"></div>
      <div class="field"><label for="out">Off blocks (UTC)</label><input id="out" value="${esc(f.out)}" placeholder="06:00" inputmode="numeric"></div>
      <div class="field"><label for="arr">Arrivo</label><input id="arr" value="${esc(f.arr)}" maxlength="4" style="text-transform:uppercase"></div>
      <div class="field"><label for="inn">On blocks (UTC)</label><input id="inn" value="${esc(f.inn)}" placeholder="08:30" inputmode="numeric"></div>
      <div class="field"><label for="total">Tempo totale</label><input id="total" value="${hm(f.total)}" placeholder="2:30"></div>
      <div class="field w2"><label for="reg">Marca</label><input id="reg" list="regs" value="${esc(f.reg)}" style="text-transform:uppercase"></div>
      <div class="field"><label for="type">Modello</label><input id="type" list="types" value="${esc(f.type)}"></div>
      <div class="field"><label for="flightNo">Numero volo</label><input id="flightNo" value="${esc(f.flightNo || '')}"></div>
      <div class="field w2"><label for="picName">Nome del PIC</label><input id="picName" value="${esc(f.picName)}"></div>
    </div></fieldset>
    <fieldset><legend>Funzione</legend>
      <div class="row"><div class="seg" role="radiogroup" aria-label="Funzione">
        ${['PIC', 'PICUS', 'SIC', 'DUAL'].map(r => `<label><input type="radio" name="role" value="${r}" ${r === role ? 'checked' : ''}><span>${r === 'SIC' ? 'Copilota' : r}</span></label>`).join('')}</div>
        <label><input type="checkbox" id="instrOn" ${f.instr ? 'checked' : ''}> Istruttore</label>
        <label><input type="checkbox" id="mpOn" ${mpOn ? 'checked' : ''}> Multi pilot</label></div>
      <p class="hint" id="roleHint"></p></fieldset>
    <fieldset><legend>Condizioni, decolli e atterraggi</legend><div class="grid">
      <div class="field"><label for="night">Notte</label><input id="night" value="${hm(f.night)}" placeholder="0:00"></div>
      <div class="field"><label for="ifr">IFR</label><input id="ifr" value="${hm(f.ifr)}" ${ifrAll ? 'data-auto="1"' : ''}></div>
      <div class="field"><label for="toDay">Decolli giorno</label><input id="toDay" type="number" min="0" value="${f.toDay || ''}"></div>
      <div class="field"><label for="toNight">Decolli notte</label><input id="toNight" type="number" min="0" value="${f.toNight || ''}"></div>
      <div class="field"><label for="ldgDay">Atterr. giorno</label><input id="ldgDay" type="number" min="0" value="${f.ldgDay || ''}"></div>
      <div class="field"><label for="ldgNight">Atterr. notte</label><input id="ldgNight" type="number" min="0" value="${f.ldgNight || ''}"></div>
    </div></fieldset>
    </div>
    <div id="fSim" ${isSim ? '' : 'hidden'}>
    <fieldset><legend>Sessione</legend><div class="grid">
      <div class="field"><label for="sdate">Data</label><input id="sdate" type="date" value="${esc(f.date)}"></div>
      <div class="field w2"><label for="simType">Tipo FSTD</label><input id="simType" list="simtypes" value="${esc(f.simType)}" placeholder="FFS BOEING 737-800"></div>
      <div class="field"><label for="sout">Inizio</label><input id="sout" value="${esc(f.out)}"></div>
      <div class="field"><label for="sinn">Fine</label><input id="sinn" value="${esc(f.inn)}"></div>
      <div class="field"><label for="sim">Durata</label><input id="sim" value="${hm(f.sim)}" placeholder="4:00"></div>
      <div class="field w3"><label for="spic">Istruttore o esaminatore</label><input id="spic" value="${esc(f.picName)}"></div>
    </div></fieldset></div>
    <fieldset><div class="grid"><div class="field w6"><label for="remarks">Note e firme</label><textarea id="remarks" rows="2">${esc(f.remarks)}</textarea></div></div></fieldset>
    <div class="actions"><button class="btn primary" type="submit">${orig ? 'Salva modifiche' : 'Salva volo'}</button>
      ${orig ? '<button class="btn" type="button" id="dup">Duplica</button><button class="btn danger" type="button" id="del">Elimina</button>' : ''}
      <a class="btn" href="#voli">Annulla</a></div>
    <datalist id="regs">${regs.map(r => `<option>${esc(r)}</option>`).join('')}</datalist>
    <datalist id="types">${typesL.map(r => `<option>${esc(r)}</option>`).join('')}</datalist>
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
  const autoSim = () => { const o = toMin($('#sout').value), i = toMin($('#sinn').value); if (o != null && i != null) $('#sim').value = hm(((i - o) + 1440) % 1440); };
  ['sout', 'sinn'].forEach(k => $('#' + k).addEventListener('change', autoSim));
  $('#reg').addEventListener('change', () => {
    const r = $('#reg').value.trim().toUpperCase(); const k = data.flights.findLast(x => x.reg === r);
    if (k && !$('#type').value) $('#type').value = k.type; else if (k) $('#type').value = k.type;
  });
  const hint = () => {
    const r = form.role.value;
    $('#roleHint').textContent = { PIC: 'Tempo registrato come PIC.', PICUS: 'Registrato come PIC con "PICUS" nelle note: serve la controfirma del comandante (nome e numero di licenza).', SIC: 'Tempo registrato come copilota.', DUAL: 'Tempo di istruzione: nel nome del PIC metti l\'istruttore e la sua certificazione nelle note.' }[r];
    if ((r === 'PIC' || r === 'PICUS') && !$('#picName').value) $('#picName').value = 'SELF';
  };
  form.querySelectorAll('input[name=role]').forEach(r => r.onchange = hint); hint();

  if (orig) {
    $('#del').onclick = async () => { if (!confirm('Eliminare questa riga dal logbook?')) return; data.flights = data.flights.filter(x => x.id !== orig.id); await save('Riga eliminata'); location.hash = 'voli'; };
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
        out: $('#out').value.trim(), inn: $('#inn').value.trim(), reg: $('#reg').value.trim().toUpperCase(), type: $('#type').value.trim(),
        flightNo: $('#flightNo').value.trim(), picName: $('#picName').value.trim(), total, night, ifr,
        mp: mp ? total : 0, spMe: mp ? 0 : (rec.spSe ? 0 : total), spSe: mp ? 0 : (rec.spSe ? total : 0),
        pic: role === 'PIC' || role === 'PICUS' ? total : 0, sic: role === 'SIC' ? total : 0, dual: role === 'DUAL' ? total : 0,
        instr: $('#instrOn').checked ? total : 0, toDay: num($('#toDay').value), toNight: num($('#toNight').value),
        ldgDay: num($('#ldgDay').value), ldgNight: num($('#ldgNight').value), sim: 0, simType: '', remarks: rem
      });
    }
    if (orig) data.flights[data.flights.findIndex(x => x.id === orig.id)] = rec; else data.flights.push(rec);
    await save(orig ? 'Modifiche salvate' : 'Volo salvato');
    location.hash = 'voli';
  };
}

// ---------- Stampa EASA ----------
const EASA_COLS = [ // [larghezza mm]
  13, 10, 9, 10, 9, 11, 14, 10, 10, 11, 11, 16, 8, 8, 8, 8, 11, 11, 10, 10, 11, 11, 13, 10, 0];
function easaPages(rowsPerPage) {
  const all = data.flights; const pages = [];
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
    : `<tr><td>${dmy(f.date)}</td><td>${esc(f.dep)}</td><td>${esc(f.out)}</td><td>${esc(f.arr)}</td><td>${esc(f.inn)}</td><td>${esc(f.type)}</td><td>${esc(f.reg)}</td><td>${hm(f.spSe)}</td><td>${hm(f.spMe)}</td><td>${hm(f.mp)}</td><td>${hm(f.total)}</td><td class="pn">${esc(f.picName)}</td><td>${n(f.toDay)}</td><td>${n(f.toNight)}</td><td>${n(f.ldgDay)}</td><td>${n(f.ldgNight)}</td><td>${hm(f.pic)}</td><td>${hm(f.sic)}</td><td>${hm(f.dual)}</td><td>${hm(f.instr)}</td><td>${hm(f.night)}</td><td>${hm(f.ifr)}</td><td></td><td></td><td class="rem">${esc(f.remarks)}</td></tr>`).join('')
    + Array.from({ length: rowsPerPage - p.rows.length }, () => `<tr>${'<td></td>'.repeat(25)}</tr>`).join('');
  const totRow = (lab, t, sig) => `<tr class="tot"><td colspan="7" class="lab">${lab}</td><td>${hm(t.spSe)}</td><td>${hm(t.spMe)}</td><td>${hm(t.mp)}</td><td>${hm(t.total)}</td><td></td><td>${n(t.toDay)}</td><td>${n(t.toNight)}</td><td>${n(t.ldgDay)}</td><td>${n(t.ldgNight)}</td><td>${hm(t.pic)}</td><td>${hm(t.sic)}</td><td>${hm(t.dual)}</td><td>${hm(t.instr)}</td><td>${hm(t.night)}</td><td>${hm(t.ifr)}</td><td></td><td>${hm(t.sim)}</td>${sig}</tr>`;
  const sig = `<td rowspan="3" class="sig">I, ${esc(data.pilot || '')}, certify that the entries in this log are true.<br><br>Pilot's signature ______________</td>`;
  return `<section class="easa-page"><table class="easa">${cg}${head}<tbody>${body}
    ${totRow('TOTAL THIS PAGE', p.page, sig)}${totRow('TOTAL FROM PREVIOUS PAGES', p.prev, '')}${totRow('TOTAL TIME', p.tot, '')}</tbody></table>
    <div class="easa-foot"><span>${esc(data.pilot || '')}</span><span>Page ${p.n} / ${totalPages}</span></div></section>`;
}
function viewPrint(main) {
  const st = viewPrint.st ||= { rpp: 18, from: '', to: '' };
  const pages = easaPages(st.rpp);
  const sel = pages.filter(p => (!st.from || p.lastd >= st.from) && (!st.to || p.first <= st.to));
  main.innerHTML = `<h1>Stampa EASA</h1>
  <p class="lede">Formato logbook EASA (AMC1 FCL.050). Il riporto ante 2007 parte come "total from previous pages" della prima pagina.</p>
  <div class="row filters">
    <label>Righe per pagina <select id="rpp">${[14, 16, 18, 20, 22].map(v => `<option ${v === st.rpp ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    <label>Dal <input type="date" id="pf" value="${st.from}"></label>
    <label>Al <input type="date" id="pt" value="${st.to}"></label>
    <button class="btn primary" id="doPrint">Stampa o salva PDF (${sel.length} pagine)</button>
  </div>
  <p class="hint">Le pagine selezionate mantengono numerazione e riporti del logbook completo. Nel dialogo di stampa scegli "Salva come PDF".</p>
  <div class="easa-preview" id="pv">${sel.slice(-2).map(p => easaPageHTML(p, st.rpp, pages.length)).join('') || '<p>Nessuna pagina nel periodo scelto.</p>'}</div>
  <p class="hint">Anteprima delle ultime ${Math.min(2, sel.length)} pagine della selezione.</p>`;
  $('#rpp').onchange = e => { st.rpp = +e.target.value; viewPrint(main); };
  $('#pf').onchange = e => { st.from = e.target.value; viewPrint(main); };
  $('#pt').onchange = e => { st.to = e.target.value; viewPrint(main); };
  $('#doPrint').onclick = () => {
    if (!sel.length) return;
    $('#printArea').innerHTML = sel.map(p => easaPageHTML(p, st.rpp, pages.length)).join('');
    setTimeout(() => window.print(), 50);
  };
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
    picName: x['PIC Name'], toDay: num(x['Takeoff']), ldgDay: num(x['Day Landing']), ldgNight: num(x['Night Landing']), remarks: x['Notes'] });
  return f;
}
async function importFile(file) {
  const text = await file.text();
  if (/\.json$/i.test(file.name) || text.trim().startsWith('{')) {
    const d = JSON.parse(text);
    if (!d.flights || !Array.isArray(d.flights)) throw new Error('il file non contiene un logbook');
    if (data && data.flights.length && !confirm(`Sostituire il logbook attuale (${data.flights.length} righe) con quello del file (${d.flights.length} righe)?`)) return;
    data = d; await save(`Importate ${d.flights.length} righe`); route(); return;
  }
  // CSV FlightLog: aggiunge solo le righe nuove
  const rows = parseCSV(text);
  if (!rows.length || !('Date' in rows[0]) || !('Registration' in rows[0])) throw new Error('non sembra un export CSV di FlightLog');
  if (!data) data = { version: 1, pilot: '', opening: Object.fromEntries(SUM_KEYS.map(k => [k, 0])), flights: [] };
  const regType = {}; for (const f of data.flights) if (f.reg && f.type) regType[f.reg] = f.type;
  const key = f => `${f.date}|${f.kind === 'sim' ? 'SIM' : f.dep}|${f.out}`;
  const have = new Set(data.flights.map(key));
  let added = 0, untyped = 0;
  for (const x of rows) {
    const f = flightLogRecord(x, regType);
    if (!f.date || have.has(key(f))) continue;
    f.id = nextId(); data.flights.push(f); have.add(key(f)); added++;
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
function viewData(main) {
  const n = data?.flights.length || 0;
  main.innerHTML = `<h1>Dati e backup</h1>
  <p class="lede">${n ? `${n} righe nel logbook${data.updated ? `, ultima modifica ${new Date(data.updated).toLocaleString('it-IT')}` : ''}.` : 'Il logbook è vuoto.'}</p>
  <div class="panel"><h2>Cartella di backup</h2>
    <p>L'app salva <b>logbook.json</b> nella cartella a ogni modifica, più una copia giornaliera nella sottocartella <b>storico</b>. Scegli iCloud Drive › Logbook per averla anche nel cloud.</p>
    <div class="row"><button class="btn primary" id="dChoose">${dirHandle ? 'Cambia cartella' : 'Scegli cartella'}</button>${dirHandle ? `<span class="hint">Attuale: ${esc(dirHandle.name)}</span>` : ''}</div>
    ${fsSupported ? '' : '<p class="hint">Questo browser non permette di scrivere in una cartella: apri l\'app con Chrome.</p>'}</div>
  <div class="panel"><h2>Importa</h2>
    <p><b>logbook.json</b> sostituisce tutto il logbook. Un <b>CSV esportato da FlightLog</b> aggiunge solo i voli che non ci sono ancora (stessa data, partenza e orario).</p>
    <div class="row"><input type="file" id="dFile" accept=".json,.csv,application/json,text/csv"></div></div>
  <div class="panel"><h2>Esporta</h2>
    <p>Una copia da conservare o da aprire in un foglio di calcolo.</p>
    <div class="row"><button class="btn" id="dJson" ${n ? '' : 'disabled'}>Scarica logbook.json</button><button class="btn" id="dCsv" ${n ? '' : 'disabled'}>Scarica CSV</button></div></div>
  ${n ? `<div class="panel"><h2>Intestazione e riporto iniziale</h2>
    <div class="row"><label>Nome sul logbook <input id="dPilot" value="${esc(data.pilot || '')}" class="btn" style="text-align:left"></label><button class="btn" id="dPilotSave">Salva nome</button></div>
    <p class="hint">Riporto ante 2007: ${hm0(data.opening?.total)} totali, ${hm0(data.opening?.pic)} PIC, ${hm0(data.opening?.sic)} copilota, ${hm0(data.opening?.sim)} simulatore.</p></div>` : ''}`;
  $('#dChoose').onclick = chooseFolder;
  $('#dFile').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { await importFile(f); } catch (err) { toast('Importazione non riuscita: ' + err.message); } e.target.value = ''; };
  if (n) {
    $('#dJson').onclick = () => download(`logbook-${today()}.json`, JSON.stringify(data, null, 1), 'application/json');
    $('#dCsv').onclick = exportCSV;
    $('#dPilotSave').onclick = async () => { data.pilot = $('#dPilot').value.trim(); await save('Nome salvato'); };
  }
}

// ---------- avvio ----------
(async () => {
  try { data = await idb.get('data') || null; } catch (e) { toast('Archivio locale non disponibile: ' + e.message); }
  try {
    dirHandle = await idb.get('dir') || null;
    if (dirHandle && (await dirHandle.queryPermission({ mode: 'readwrite' })) === 'granted') { backupOk = true; lastBackup = data?.updated ? new Date(data.updated) : new Date(); }
  } catch { dirHandle = null; }
  renderBackupState();
  route();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
