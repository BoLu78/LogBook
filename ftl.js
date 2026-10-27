'use strict';
/* FTL EASA secondo OM-A Neos cap. 7: servizi dal roster NetLine (check-in / check-out), ricostruiti dal logbook dove il roster manca.
   È un promemoria personale: fa fede NetLine / Crew Control. Tutti gli orari interni sono in millisecondi UTC. */

const H = 3600e3, MIN = 60e3, DAY = 864e5;
const FTL_LIM = { d7: 60 * 60, d14: 110 * 60, d28: 190 * 60, dYear: 2000 * 60, f28: 100 * 60, fYear: 900 * 60, f12m: 1000 * 60 };
// 7.1.7.1 FDP massimo acclimatato: righe [da, a) in minuti dal giorno locale, colonne 1-2 … 10 tratte
const FDP_ROWS = [
  [360, 810, [780, 750, 720, 690, 660, 630, 600, 570, 540]], [810, 840, [765, 735, 705, 675, 645, 615, 585, 555, 540]],
  [840, 870, [750, 720, 690, 660, 630, 600, 570, 540, 540]], [870, 900, [735, 705, 675, 645, 615, 585, 555, 540, 540]],
  [900, 930, [720, 690, 660, 630, 600, 570, 540, 540, 540]], [930, 960, [705, 675, 645, 615, 585, 555, 540, 540, 540]],
  [960, 990, [690, 660, 630, 600, 570, 540, 540, 540, 540]], [990, 1020, [675, 645, 615, 585, 555, 540, 540, 540, 540]],
  [1020, 1440, [660, 630, 600, 570, 540, 540, 540, 540, 540]], [0, 300, [660, 630, 600, 570, 540, 540, 540, 540, 540]],
  [300, 315, [720, 690, 660, 630, 600, 570, 540, 540, 540]], [315, 330, [735, 705, 675, 645, 615, 585, 555, 540, 540]],
  [330, 345, [750, 720, 690, 660, 630, 600, 570, 540, 540]], [345, 360, [765, 735, 705, 675, 645, 615, 585, 555, 540]]
];
const FDP_UNKNOWN = [660, 630, 600, 570, 540, 540, 540];   // stato di acclimatazione sconosciuto (X)
function maxFdp(refMin, sectors, unknown) {
  const col = sectors <= 2 ? 0 : Math.min(8, sectors - 2);
  if (unknown) return FDP_UNKNOWN[Math.min(6, col)];
  const r = FDP_ROWS.find(([a, b]) => refMin >= a && refMin < b) || FDP_ROWS[0];
  return r[2][col];
}

// ---------- fusi orari
const icaoOf = c => (c && c.length === 3 && typeof IATA !== 'undefined' && IATA && IATA[c]) || c || '';
const tzOf = c => (typeof APT !== 'undefined' && APT && APT[icaoOf(c)]?.[4]) || 'Europe/Rome';
const offCache = new Map();
function offMin(tz, ms) {
  const k = tz + '|' + Math.floor(ms / H); if (offCache.has(k)) return offCache.get(k);
  let o = 0;
  try {
    const v = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(new Date(ms)).find(p => p.type === 'timeZoneName')?.value || 'GMT';
    const m = v.match(/GMT([+-])(\d+)(?::(\d+))?/); if (m) o = (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +(m[3] || 0));
  } catch { /* UTC */ }
  offCache.set(k, o); return o;
}
const utcMs = (date, t) => { const s = String(t || '').replace(':', ''); return Date.parse(`${date}T${s.slice(0, 2)}:${s.slice(2, 4)}:00Z`); };
const pad2 = n => String(n).padStart(2, '0');
const hhmmUTC = ms => { const d = new Date(ms); return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`; };
const localMin = (ms, tz) => { const m = (Math.floor(ms / MIN) + offMin(tz, ms)) % 1440; return (m + 1440) % 1440; };
const hhmmLocal = (ms, tz) => { const m = localMin(ms, tz); return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`; };
const dateUTC = ms => new Date(ms).toISOString().slice(0, 10);
const durHM = m => `${Math.floor(m / 60)}:${pad2(Math.round(m % 60))}`;

// ---------- servizi dal roster
function rosterDuties() {
  const R = data.roster || {}, dates = Object.keys(R).sort(), out = [], days = [];
  let cur = null;
  const close = end => { if (!cur) return; cur.end = end ?? cur.end ?? (cur.legs.at(-1)?.inn ?? cur.start) + 30 * MIN; out.push(cur); cur = null; };
  for (const date of dates) {
    const d = R[date];
    days.push({ date, kind: d.kind, code: d.code, win: d.win });
    if (d.ci) { close(); cur = { src: 'roster', date, start: utcMs(date, d.ci.t), ap: d.ci.ap, label: d.ci.label, legs: [], hotel: d.hotel, kind: d.kind, pickup: d.pickup }; }
    for (const l of d.legs || []) {
      if (!cur) cur = { src: 'roster', date, start: utcMs(date, l.out) - 60 * MIN, ap: l.dep, legs: [], kind: d.kind };
      let o = utcMs(date, l.out); while (cur.legs.length && o < cur.legs.at(-1).out) o += DAY; if (o < cur.start) o += DAY;
      let i = l.inn ? utcMs(date, l.inn) : o; while (i < o) i += DAY;
      cur.legs.push({ ...l, out: o, inn: i, date: dateUTC(o) });
    }
    if (d.hotel && cur) cur.hotel = d.hotel;
    if (d.co) { let e = utcMs(date, d.co.t); if (cur) { while (e < cur.start) e += DAY; cur.coAp = d.co.ap; } close(e); }
    if (d.kind === 'standby' && d.win && !d.ci) out.push({ src: 'roster', date, kind: 'standby', code: d.code, start: utcMs(date, d.win.start) - offMin(tzOf(data.rosterBase || 'MXP'), utcMs(date, d.win.start)) * MIN, end: utcMs(date, d.win.end) - offMin(tzOf(data.rosterBase || 'MXP'), utcMs(date, d.win.end)) * MIN, legs: [], ap: data.rosterBase || 'MXP' });
  }
  close();
  return { duties: out, days, covered: new Set(dates) };
}

// ---------- servizi ricostruiti dal logbook dove manca il roster (7.1.6: 60' prima per il 737, 90' per il 787; fine 30' dopo l'IN)
function logbookDuties(covered) {
  const byDate = new Map();
  for (const f of data.flights) if (!f.planned && !covered.has(f.date) && (f.kind === 'flight' || f.kind === 'sim') && f.out) (byDate.get(f.date) || byDate.set(f.date, []).get(f.date)).push(f);
  const out = [];
  for (const [date, list] of byDate) {
    list.sort((a, b) => a.out.localeCompare(b.out));
    const fl = list.filter(f => f.kind === 'flight'), sim = list.find(f => f.kind === 'sim');
    if (fl.length) {
      const pre = /787|777|747/.test(fl[0].type || '') ? 90 : 60;
      const legs = []; let base = utcMs(date, fl[0].out);
      for (const f of fl) { let o = utcMs(date, f.out); while (o < base) o += DAY; let i = utcMs(date, f.inn); while (i < o) i += DAY; legs.push({ k: 'flight', dep: f.dep, arr: f.arr, out: o, inn: i, n: f.flightNo || '', actual: true, date }); base = o; }
      out.push({ src: 'logbook', date, kind: 'flight', start: legs[0].out - pre * MIN, end: legs.at(-1).inn + 30 * MIN, ap: fl[0].dep, legs });
    } else if (sim) {
      let o = utcMs(date, sim.out), i = utcMs(date, sim.inn || sim.out); while (i < o) i += DAY;
      out.push({ src: 'logbook', date, kind: 'sim', start: o - 60 * MIN, end: i + 60 * MIN, ap: data.rosterBase || 'MXP', legs: [] });
    }
  }
  return out;
}

// ---------- tutto insieme: servizi ordinati con DP, FDP, riposo e segnalazioni
function ftlModel() {
  const home = data.rosterBase || 'MXP', homeTz = tzOf(home);
  const { duties: rd, days, covered } = rosterDuties();
  const all = [...rd, ...logbookDuties(covered)].sort((a, b) => a.start - b.start);
  // orari effettivi dal logbook sulle tratte del roster già volate
  const idx = new Map(); for (const f of data.flights) if (f.kind === 'flight' && !f.planned) idx.set(`${f.date}|${f.dep}|${f.arr}`, f);
  let awaySince = null, prev = null;
  for (const d of all) {
    d.factor = d.kind === 'standby' ? (d.code === 'RESERVE' ? 0 : 0.25) : 1;
    for (const l of d.legs) if (l.k === 'flight' && !l.actual) {
      const f = idx.get(`${l.date}|${icaoOf(l.dep)}|${icaoOf(l.arr)}`) || idx.get(`${dateUTC(l.out - DAY)}|${icaoOf(l.dep)}|${icaoOf(l.arr)}`);
      if (f?.inn && f.out) { let o = utcMs(f.date, f.out), i = utcMs(f.date, f.inn); while (i < o) i += DAY; l.aOut = o; l.aIn = i; }
    }
    const fl = d.legs.filter(l => l.k === 'flight');
    d.sectors = fl.length;
    const lastFl = fl.at(-1);
    const flown = fl.length && fl.every(l => l.aIn || l.actual);
    d.flown = !!flown;
    if (lastFl && lastFl.aIn && d.legs.at(-1) === lastFl) d.end = lastFl.aIn + 30 * MIN;
    d.dp = Math.max(0, (d.end - d.start) / MIN);
    if (fl.length) {
      d.fdpEnd = lastFl.aIn || lastFl.inn;
      d.fdp = (d.fdpEnd - d.start) / MIN;
      // acclimatazione semplificata (7.1.4): entro 2 h dalla base = ora locale; oltre, ora della base se < 48 h dalla partenza, poi stato sconosciuto
      const repTz = tzOf(d.ap), diff = Math.abs(offMin(repTz, d.start) - offMin(homeTz, d.start));
      if (icaoOf(d.ap) === icaoOf(home)) awaySince = null; else awaySince ??= prev && icaoOf(prev.ap) === icaoOf(home) ? prev.start : d.start;
      let refTz = repTz, unknown = false;
      if (diff > 120) { if (!awaySince || d.start - awaySince < 48 * H) refTz = homeTz; else unknown = true; }
      d.refTz = refTz; d.unknown = unknown;
      d.maxFdp = maxFdp(localMin(d.start, refTz), d.sectors, unknown);
      d.tzDiff = diff;
    }
    // segnalazioni nel fuso di acclimatazione
    const tz = d.refTz || tzOf(d.ap), s = localMin(d.start, tz), e = localMin(d.end, tz);
    d.flags = [];
    if (d.factor === 1) {
      if (s >= 300 && s < 360) d.flags.push('early start');
      if (e >= 1380 || e < 120) d.flags.push('late finish');
      const crosses = (a, b) => { for (let t = d.start; t < d.end; t += 15 * MIN) { const m = localMin(t, tz); if (m >= a && m < b) return true; } return false; };
      if (crosses(120, 300)) d.flags.push('night duty');
      else if (crosses(120, 360)) d.flags.push('WOCL');
    }
    // riposo prima (7.1.14): base ≥ max(DP precedente, 12 h); fuori base ≥ max(DP precedente, 10 h), 14 h dopo un FDP con ≥ 4 h di fuso
    if (prev && d.factor > 0 && d.kind !== 'standby') {
      d.rest = (d.start - prev.end) / MIN;
      const atHome = icaoOf(d.ap) === icaoOf(home);
      d.minRest = Math.max(prev.dp, atHome ? 720 : (prev.tzDiff >= 240 ? 840 : 600));
    }
    if (d.factor > 0 && d.kind !== 'standby') prev = d;
  }
  return { duties: all, days, home, homeTz };
}

// ---------- cumulativi su finestre mobili
function dutyIn(duties, a, b) { let m = 0; for (const d of duties) { const o = Math.min(d.end, b) - Math.max(d.start, a); if (o > 0) m += o / MIN * d.factor; } return m; }
function flightIn(a, b) {
  let m = 0;
  for (const f of data.flights) { if (f.kind !== 'flight') continue; const t = utcMs(f.date, f.out || '0000'); if (t >= a && t < b) m += f.total || 0; }
  return m;
}
function windows(model) {
  const td = utcMs(today(), '0000') + DAY, now = Date.now();
  const end = Math.max(td, ...model.duties.map(d => d.end));
  const at = t => ({ d7: dutyIn(model.duties, t - 7 * DAY, t), d14: dutyIn(model.duties, t - 14 * DAY, t), d28: dutyIn(model.duties, t - 28 * DAY, t), f28: flightIn(t - 28 * DAY, t) });
  const cur = at(td);
  const peak = { d7: 0, d14: 0, d28: 0, f28: 0 }, peakDay = {};
  for (let t = td; t <= end + DAY; t += DAY) { const w = at(t); for (const k in peak) if (w[k] > peak[k]) { peak[k] = w[k]; peakDay[k] = dateUTC(t - DAY); } }
  const y0 = Date.parse(today().slice(0, 4) + '-01-01T00:00:00Z');
  return { cur, peak, peakDay, dYear: dutyIn(model.duties, y0, td), fYear: flightIn(y0, td), f12m: flightIn(td - 365 * DAY, td), now };
}
// giorni liberi nel mese (OFF, HOL) dal roster
function daysOff(model, ym) { return model.days.filter(d => d.date.startsWith(ym) && (d.kind === 'off' || d.kind === 'vacation')).length; }
// riposo esteso ricorrente (7.1.14 c): ≥ 36 h con 2 notti locali, al massimo ogni 168 h
function recoveryRests(model) {
  const busy = model.duties.filter(d => d.factor > 0 || d.code === 'RESERVE').map(d => [d.start, d.end]);
  for (const day of model.days) if (day.code === 'RESERVE') { const s = utcMs(day.date, '0000') - offMin(model.homeTz, utcMs(day.date, '1200')) * MIN; busy.push([s, s + DAY]); }
  busy.sort((a, b) => a[0] - b[0]);
  const nights = (a, b) => { let n = 0; for (let t = Math.floor(a / DAY) * DAY - DAY; t < b; t += DAY) { const s = t + (22 * 60 - offMin(model.homeTz, t)) * MIN, e = s + 10 * H; const o = Math.min(e, b) - Math.max(s, a); if (o >= 8 * H) n++; } return n; };
  const rests = [];
  for (let i = 1; i < busy.length; i++) { const a = busy[i - 1][1], b = busy[i][0]; if (b - a >= 36 * H && nights(a, b) >= 2) rests.push([a, b]); }
  return rests;
}

// ---------- pagina FTL
const pct = (v, lim) => Math.round(v / lim * 100);
const lvl = (v, lim) => v > lim ? 'bad' : v >= lim * 0.9 ? 'warn' : 'ok';
function gaugeRow(label, v, lim, peak, peakDay) {
  return `<div class="ftl-g ${lvl(Math.max(v, peak ?? 0), lim)}"><div class="ftl-gh"><span>${label}</span><b>${durHM(v)}</b><small>/ ${lim / 60} h</small></div>
    <div class="ftl-bar"><i style="width:${Math.min(100, pct(v, lim))}%"></i>${peak != null && peak > v ? `<em style="left:${Math.min(100, pct(peak, lim))}%" title="Planned peak"></em>` : ''}</div>
    ${peak != null && peak > v ? `<small class="ftl-peak">planned peak ${durHM(peak)} on ${dmy(peakDay)}</small>` : '<small class="ftl-peak">&nbsp;</small>'}</div>`;
}
function viewFTL(main) {
  if (typeof IATA !== 'undefined' && !IATA) { fetch('data/iata.json').then(r => r.json()).then(j => { IATA = j; viewFTL(main); }); main.innerHTML = '<h1>FTL</h1><p class="lede">Loading…</p>'; return; }
  const model = ftlModel(), w = windows(model), td = today();
  const hasRoster = Object.keys(data.roster || {}).length > 0;
  const ym = td.slice(0, 7), off = daysOff(model, ym);
  const rr = recoveryRests(model), now = Date.now();
  const lastRR = rr.filter(r => r[1] <= now).at(-1), nextRR = rr.find(r => r[1] > now && r[0] > now - DAY);
  const due = lastRR ? lastRR[1] + 168 * H : null;
  const shown = model.duties.filter(d => d.end >= utcMs(td, '0000') - 14 * DAY && d.factor >= 0);
  const row = d => {
    const tz = tzOf(d.ap), past = d.end < now;
    const fdpCls = d.fdp != null ? lvl(d.fdp, d.maxFdp) : '';
    const restCls = d.rest != null ? (d.rest < d.minRest ? 'bad' : 'ok') : '';
    const what = d.kind === 'standby' ? (d.code === 'RESERVE' ? 'Reserve' : 'Stand-by') : d.kind === 'sim' ? 'Simulator' : d.kind === 'transport' ? 'Positioning' : d.kind === 'ground' ? 'Ground' : (d.legs.filter(l => l.k === 'flight').map(l => icaoOf(l.dep)).concat(icaoOf(d.legs.filter(l => l.k === 'flight').at(-1)?.arr)).join('–') || 'Duty');
    return `<tr class="${past ? 'past' : ''}"><td class="l">${dmy(d.date)}</td><td class="l">${esc(what)}${d.src === 'logbook' ? ' <span class="tag est" title="Rebuilt from the logbook: no roster for this day">est.</span>' : ''}</td>
      <td>${hhmmUTC(d.start)}<small>${hhmmLocal(d.start, tz)} LT</small></td><td>${hhmmUTC(d.end)}</td>
      <td>${d.factor === 1 ? durHM(d.dp) : d.factor ? `${durHM(d.dp * d.factor)}<small>25%</small>` : '—'}</td>
      <td class="${fdpCls}">${d.fdp != null ? `${durHM(d.fdp)}<small>max ${durHM(d.maxFdp)}${d.unknown ? ' (X)' : d.refTz !== tz ? ' (B)' : ''}</small>` : ''}</td>
      <td>${d.sectors || ''}</td>
      <td class="${restCls}">${d.rest != null ? `${durHM(d.rest)}<small>min ${durHM(d.minRest)}</small>` : ''}</td>
      <td class="l">${d.flags.map(f => `<span class="tag fl">${f}</span>`).join(' ')}${d.flown ? ' <span class="tag ok">flown</span>' : ''}</td></tr>`;
  };
  main.innerHTML = `<h1>FTL</h1>
  <p class="lede">EASA FTL as in OM-A chapter 7. Duties come from the NetLine roster${hasRoster ? '' : ' (none imported yet)'}; days without a roster are rebuilt from the logbook (report 60' before OUT on the 737, 90' on the 787, end 30' after IN). For awareness only: NetLine and Crew Control are the reference.</p>
  ${hasRoster ? '' : '<p><button class="btn primary" data-act="roster">Import roster</button></p>'}
  <section class="chart-card"><h2>Duty time</h2><div class="ftl-gs">
    ${gaugeRow('7 days', w.cur.d7, FTL_LIM.d7, w.peak.d7, w.peakDay.d7)}${gaugeRow('14 days', w.cur.d14, FTL_LIM.d14, w.peak.d14, w.peakDay.d14)}
    ${gaugeRow('28 days', w.cur.d28, FTL_LIM.d28, w.peak.d28, w.peakDay.d28)}${gaugeRow('Year ' + td.slice(0, 4), w.dYear, FTL_LIM.dYear)}</div></section>
  <section class="chart-card"><h2>Flight time</h2><div class="ftl-gs">
    ${gaugeRow('28 days', w.cur.f28, FTL_LIM.f28, w.peak.f28, w.peakDay.f28)}${gaugeRow('Year ' + td.slice(0, 4), w.fYear, FTL_LIM.fYear)}${gaugeRow('12 months', w.f12m, FTL_LIM.f12m)}</div></section>
  <div class="chart-two">
    <section class="chart-card"><h2>Days off · ${MESI[+ym.slice(5) - 1]}</h2><div class="ftl-big ${hasRoster ? (off >= 7 ? 'ok' : 'warn') : ''}"><b>${hasRoster ? off : '—'}</b><span>/ 7 minimum (OFF + HOL in the roster)</span></div></section>
    <section class="chart-card"><h2>Extended recovery rest</h2><div class="ftl-big ${due ? (due < now ? 'bad' : due - now < 24 * H ? 'warn' : 'ok') : ''}">${lastRR ? `<b>${dmy(dateUTC(lastRR[0]))}</b><span>last one, ${durHM((lastRR[1] - lastRR[0]) / MIN)} h. Next due by ${dmy(dateUTC(due))} ${hhmmUTC(due)} UTC (168 h)${nextRR ? `; planned from ${dmy(dateUTC(nextRR[0]))}` : ''}</span>` : '<span>No 36 h rest with 2 local nights found yet.</span>'}</div></section>
  </div>
  <section class="chart-card"><h2>Duties · last 14 days and roster</h2>
    <div class="scroll"><table class="data ftl-t"><thead><tr><th class="l">Date</th><th class="l">Duty</th><th>Report UTC</th><th>End UTC</th><th>DP</th><th>FDP</th><th>Sect.</th><th>Rest before</th><th class="l"></th></tr></thead>
    <tbody>${shown.map(row).join('') || '<tr><td colspan="9" class="l">No duties.</td></tr>'}</tbody></table></div>
    <p class="hint">FDP max from table 7.1.7.1 at the reference time; (B) acclimatised to home base, (X) unknown state. Home stand-by counts 25%, reserve 0. Rest minimum: home base the longer of the previous duty or 12 h, away 10 h (14 h after an FDP with ≥ 4 h time difference). Flags in the acclimatised time zone.</p></section>`;
}

// ---------- Summary: i prossimi giorni
function nextDaysHTML() {
  const R = data.roster || {}, td = today();
  const dates = Object.keys(R).filter(d => d >= td).sort().slice(0, 7);
  if (!dates.length) return `<section class="next-days empty"><div><b>Next days</b><span>Import the latest NetLine roster to see what's coming.</span></div><button class="btn primary" data-act="roster">Import roster</button></section>`;
  let model = null; try { model = ftlModel(); } catch { /* senza modello niente FDP */ }
  const dayName = d => d === td ? 'Today' : d === addDays(td, 1) ? 'Tomorrow' : new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' });
  const items = dates.map(date => {
    const r = R[date];
    const duty = model?.duties.find(d => d.src === 'roster' && d.date === date && d.kind !== 'standby');
    let body = '';
    if (r.kind === 'off') body = '<span class="nd-tag off">OFF</span>';
    else if (r.kind === 'vacation') body = '<span class="nd-tag off">Holiday</span>';
    else if (r.kind === 'standby') body = `<span class="nd-tag sb">${r.code === 'RESERVE' ? 'Reserve' : 'Stand-by'}</span>${r.win ? ` ${r.win.start.slice(0, 2)}:${r.win.start.slice(2)}–${r.win.end.slice(0, 2)}:${r.win.end.slice(2)} LT` : ''}`;
    else if (r.kind === 'rest' && !r.legs.length) body = `<span class="nd-tag rest">Rest</span>${r.co ? ` C/O ${r.co.t.slice(0, 2)}:${r.co.t.slice(2)} ${esc(icaoOf(r.co.ap))}` : ''}`;
    else {
      const ci = r.ci ? `<div class="nd-ci">${r.pickup ? `Pick-up ${r.pickup.slice(0, 2)}:${r.pickup.slice(2)} · ` : ''}${esc(r.ci.label || 'C/I')} <b>${r.ci.t.slice(0, 2)}:${r.ci.t.slice(2)}</b> UTC ${esc(icaoOf(r.ci.ap))}${duty ? ` <small>${hhmmLocal(duty.start, tzOf(duty.ap))} LT</small>` : ''}</div>` : '';
      const legs = r.legs.map(l => `<div class="nd-leg ${l.k}">${l.k === 'flight' ? `<b>${esc(l.n ? 'NO' + l.n : '')}</b>` : l.k === 'transport' ? '<span class="nd-tag dh">DH</span>' : `<span class="nd-tag sb">${esc(l.c || 'SIM')}</span>`} ${esc(icaoOf(l.dep))}${l.arr ? ' → ' + esc(icaoOf(l.arr)) : ''} <span class="nd-t">${l.out.slice(0, 2)}:${l.out.slice(2)}–${l.inn.slice(0, 2)}:${l.inn.slice(2)}</span></div>`).join('');
      const fdp = duty?.fdp != null ? `<div class="nd-fdp ${lvl(duty.fdp, duty.maxFdp)}">FDP ${durHM(duty.fdp)} / max ${durHM(duty.maxFdp)} · ${duty.sectors} sector${duty.sectors > 1 ? 's' : ''}${duty.flags.length ? ' · ' + duty.flags.join(', ') : ''}</div>` : '';
      body = ci + legs + fdp + (r.hotel ? `<div class="nd-hotel">🛏 ${esc(String(typeof r.hotel === 'string' ? r.hotel : r.hotel.name || '').split(',')[0])}</div>` : '');
    }
    return `<div class="nd ${date === td ? 'today' : ''}"><div class="nd-day">${dayName(date)}</div><div class="nd-body">${body || '—'}</div></div>`;
  }).join('');
  return `<section class="next-days"><div class="nd-head"><h2>Next days</h2><a href="#ftl">FTL →</a></div><div class="nd-list">${items}</div></section>`;
}
