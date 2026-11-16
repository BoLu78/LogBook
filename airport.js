'use strict';
/* Pagina aeroporto: si apre dall'icona accanto a DEP e ARR nella scheda del volo.
   Mappa ingrandibile (OpenStreetMap), distanze SOLO dai dati AIP inseriti in data/aip.json, warning note
   sincronizzata con il logbook (data.aptNotes), METAR/TAF e NOTAM.
   Modulo separato, caricato solo quando serve: se qui qualcosa non va, il resto dell'app non ne risente. */
let APT_AIP = null;
async function aptAipDB() { if (!APT_AIP) { try { APT_AIP = await (await fetch('data/aip.json')).json(); } catch { APT_AIP = {}; } } return APT_AIP; }
const aptM = (lat, lon) => p => [(p[1] - lon) * 111320 * Math.cos(brfRad(lat)), -(p[0] - lat) * 110540];   // metri: x est, y sud
const aptDir = brg => [Math.sin(brfRad(brg)), -Math.cos(brfRad(brg))];                                        // versore della prua vera
// #aeroporto/GCLP oppure #aeroporto/GCLP_2026-11-19.1225 (orario UTC del volo: serve a fuso e NOTAM)
function aptHash(icao, date, hhmm) { return 'aeroporto/' + icao + (date ? '_' + date + (hhmm ? '.' + hhmm : '') : ''); }
function aptParse(arg) {
  const [c, rest = ''] = String(arg || '').split('_'), [date, hhmm] = rest.split('.');
  const d = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : null, t = /^\d{4}$/.test(hhmm || '') ? hhmm : '';
  return { icao: (c || '').toUpperCase(), date: d, hhmm: t, at: d ? Date.parse(`${d}T${t ? t.slice(0, 2) + ':' + t.slice(2) : '12:00'}:00Z`) : null };
}

// ---------- piste: testate con prua vera; se ci sono i dati AIP, soglia e distanze dichiarate ufficiali
function aptHeads(icao, aip) {
  const rws = brfRunwaysOf(icao), heads = [];
  for (const r of rws) {
    for (const [id, thr, end, brg] of [[r.idA, r.A, r.B, r.brg], [r.idB, r.B, r.A, (r.brg + 180) % 360]]) {
      const a = aip?.rwy?.[id];
      heads.push({ id, w: r.w, thr: a?.thr || thr, end, brg: a?.brg ?? brg, aip: a || null, pair: r });
    }
  }
  return heads;
}

// ---------- uscite: raccordi OSM che toccano la pista, misurati dalla soglia AIP lungo l'asse
// (solo con dati AIP; il raccordo è disegnato da OpenStreetMap, quindi la distanza è "circa")
function aptExits(h, ways, P) {
  if (!h.aip) return [];
  const o = P(h.thr), [ux, uy] = aptDir(h.brg), lda = h.aip.lda, half = (h.w || 45) / 2 + 18;
  const st = p => { const [x, y] = P(p), dx = x - o[0], dy = y - o[1]; return [dx * ux + dy * uy, dx * -uy + dy * ux]; };   // lungo asse, di lato
  const hits = [];
  for (const w of ways) {
    if (w.a !== 'taxiway' || !/^[A-Z]{1,2}\d{0,2}[A-Z]?$/.test(w.r)) continue;
    const sc = w.g.map(st);
    for (let i = 0; i < sc.length; i++) {
      // punto della via più vicino all'asse (vertice o attraversamento)
      let s = null;
      const [s0, c0] = sc[i];
      if (Math.abs(c0) <= half) s = s0;
      else if (i + 1 < sc.length) { const [s1, c1] = sc[i + 1]; if (c0 * c1 < 0) { const t = c0 / (c0 - c1); s = s0 + (s1 - s0) * t; } }
      if (s == null || s < 600 || s > lda + 80) continue;   // prima di 600 m non è un'uscita di atterraggio
      // direzione con cui il raccordo lascia la pista, da ciascun lato: utile per l'atterraggio se non torna indietro
      const side = sgn => { let best = null; for (const [ss, cc] of sc) if (cc * sgn > half && Math.abs(cc) < 260 && (!best || Math.abs(cc) > Math.abs(best[1]))) best = [ss, cc]; return best; };
      const outs = [side(1), side(-1)].filter(Boolean).map(([ss, cc]) => { const dx = ss - s, L = Math.hypot(dx, cc) || 1; return { cos: dx / L, c: cc }; });
      const ok = outs.filter(q => q.cos > -0.35);
      if (outs.length && !ok.length) continue;
      const q = ok.sort((a, b) => b.cos - a.cos)[0] || null;
      hits.push({ ref: w.r, s, ret: !!q && q.cos > 0.55, c: q ? Math.sign(q.c) : 1 });
    }
  }
  // stesso raccordo trovato più volte (vertici vicini, due lati): una sola uscita
  hits.sort((a, b) => a.s - b.s);
  const out = [];
  for (const x of hits) { const p = out.find(e => e.ref === x.ref && Math.abs(e.s - x.s) < 90); if (p) { p.ret ||= x.ret; continue; } out.push({ ...x }); }
  return out.map(e => ({ ...e, s: Math.round(e.s / 10) * 10, rem: Math.max(0, Math.round((lda - e.s) / 10) * 10), end: e.s > lda - 60 }));
}

// ---------- mappa: geometria fissa in metri, etichette ridisegnate a ogni zoom con dimensione costante sullo schermo
function aptMapStatic(ways, heads, P) {
  const path = g => g.map((p, i) => { const [x, y] = P(p); return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`; }).join('');
  const ap = ways.filter(w => w.a === 'apron').map(w => `<path d="${path(w.g)}Z" class="ap"/>`).join('');
  const te = ways.filter(w => w.a === 'terminal').map(w => `<path d="${path(w.g)}Z" class="te"/>`).join('');
  const tw = ways.filter(w => w.a === 'taxiway').map(w => `<path d="${path(w.g)}" class="tw" stroke-width="${w.w || 20}"/>`).join('');
  const seen = new Set(), rw = heads.filter(h => !seen.has(h.pair) && seen.add(h.pair)).map(h => { const d = path([h.pair.A, h.pair.B]); return `<path d="${d}" class="rw" stroke-width="${h.w}"/><path d="${d}" class="rwc" stroke-width="1.2" stroke-dasharray="30 20"/>`; }).join('');
  return ap + te + tw + rw;
}
function aptMapOverlay(st, heads, ways, P, exits, mv) {
  const u = st.u, [x0, y0] = [st.cx - st.w / 2, st.cy - st.h / 2], x1 = x0 + st.w, y1 = y0 + st.h;
  const sel = heads.find(h => h.id === st.sel);
  let g = '';
  // TDZ: primi 900 m dalla soglia AIP (o un terzo dell'LDA se più corta), tacche ogni 300 m, fine LDA
  if (sel?.aip && st.tdz) {
    const o = P(sel.thr), [ux, uy] = aptDir(sel.brg), nx = -uy, ny = ux, hw = sel.w / 2, lda = sel.aip.lda, tdz = Math.min(900, lda / 3);
    const at = (s, c) => [o[0] + ux * s + nx * c, o[1] + uy * s + ny * c];
    const poly = (s0, s1, cls) => `<path class="${cls}" d="M${at(s0, -hw)}L${at(s1, -hw)}L${at(s1, hw)}L${at(s0, hw)}Z"/>`;
    g += poly(0, tdz, 'tdz');
    // scritte dal lato della pista dove non ci sono le uscite
    const sd = st.exits && exits.filter(e => e.c > 0).length > exits.filter(e => e.c < 0).length ? -1 : 1;
    const lab = (s, t, cls = '') => { const [a, b] = [at(s, -hw - 3 * u), at(s, hw + 3 * u)], p = at(cls ? s - 22 * u : s, sd * (hw + (cls ? 30 : 16) * u)); return `<path class="tk ${cls}" d="M${a}L${b}" stroke-width="${2 * u}"/><text class="tkl ${cls}" x="${p[0].toFixed(0)}" y="${(p[1] + 3.5 * u).toFixed(0)}" font-size="${9.5 * u}">${t}</text>`; };
    g += `<path class="thr" d="M${at(0, -hw)}L${at(0, hw)}" stroke-width="${Math.max(3 * u, 6)}"/>`;
    for (const s of [300, 600, 900]) if (s <= tdz + 1) g += lab(s, s);
    g += lab(lda, 'LDA END', 'end');
  }
  // uscite (solo pista scelta, solo con AIP)
  if (sel?.aip && st.exits) {
    const o = P(sel.thr), [ux, uy] = aptDir(sel.brg), nx = -uy, ny = ux, hw = sel.w / 2;
    for (const e of exits) {
      const c = e.c || 1, a = [o[0] + ux * e.s + nx * c * hw, o[1] + uy * e.s + ny * c * hw], b = [a[0] + nx * c * 14 * u, a[1] + ny * c * 14 * u];
      const t = `${e.ref} ≈${e.s}`, tw = t.length * 6 * u + 8 * u, cx = b[0] + nx * c * tw / 2, cy = b[1] + ny * c * 8 * u;
      g += `<path class="exl" d="M${a[0].toFixed(0)},${a[1].toFixed(0)}L${b[0].toFixed(0)},${b[1].toFixed(0)}" stroke-width="${1.5 * u}"/><g class="exb${e.ret ? ' ret' : ''}" transform="translate(${cx.toFixed(0)},${cy.toFixed(0)})"><rect x="${-tw / 2}" y="${-7.5 * u}" width="${tw}" height="${15 * u}" rx="${3 * u}"/><text y="${3.8 * u}" font-size="${10 * u}">${esc(t)}</text></g>`;
    }
  }
  // sigle dei raccordi: una per tratto abbastanza lungo sullo schermo, mai due uguali troppo vicine
  const labs = [];
  for (const w of ways) {
    if (w.a !== 'taxiway' || !/^[A-Z]{1,2}\d{0,2}[A-Z]?$/.test(w.r)) continue;
    const pts = w.g.map(P), len = pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);
    if (len / u < 50) continue;
    const m = pts[Math.floor(pts.length / 2)];
    if (m[0] < x0 || m[0] > x1 || m[1] < y0 || m[1] > y1) continue;
    if (labs.some(l => l.r === w.r && Math.hypot(l.p[0] - m[0], l.p[1] - m[1]) < 140 * u)) continue;
    labs.push({ r: w.r, p: m });
  }
  g += labs.map(({ r, p }) => `<g class="twl" transform="translate(${p[0].toFixed(0)},${p[1].toFixed(0)})"><rect x="${-7 * u - (r.length - 1) * 3.2 * u}" y="${-7 * u}" width="${14 * u + (r.length - 1) * 6.4 * u}" height="${14 * u}" rx="${2 * u}"/><text y="${4 * u}" font-size="${10 * u}">${esc(r)}</text></g>`).join('');
  // numeri di pista oltre la testata: si toccano per scegliere la pista di atterraggio
  const R = 13 * u;
  const put = [];
  for (const h of heads) {
    const t = P(h.thr), [ux, uy] = aptDir(h.brg);
    let d = R + 10 * u, c = [t[0] - ux * d, t[1] - uy * d];
    // piste parallele vicine: il secondo numero va un po' più indietro, così non si coprono
    for (let k = 0; k < 4 && put.some(q => Math.hypot(q[0] - c[0], q[1] - c[1]) < 2 * R + 3 * u); k++) { d += 2 * R + 4 * u; c = [t[0] - ux * d, t[1] - uy * d]; }
    put.push(c);
    g += `<g class="rwl${h.id === st.sel ? ' sel' : ''}" data-rw="${esc(h.id)}" transform="translate(${c[0].toFixed(0)},${c[1].toFixed(0)})"><circle r="${R}"/><text y="${4.5 * u}" font-size="${12 * u}">${esc(h.id)}</text></g>`;
  }
  return g;
}
// scala e nord in HTML sopra la mappa (non si ingrandiscono)
function aptScale(st, pxW) {
  const mpp = st.w / pxW, m = [50, 100, 200, 250, 500, 1000, 2000].find(v => v / mpp >= 70) || 2000;
  return `<i style="width:${(m / mpp).toFixed(0)}px"></i><span>${m >= 1000 ? m / 1000 + ' km' : m + ' m'}</span>`;
}

// ---------- vento (METAR) sulle testate: frontale e traverso, solo informativo
function aptWindComp(h, wind) {
  if (!wind || wind.dir == null) return null;
  const a = brfRad(wind.dir - h.brg), g = Math.max(wind.spd, wind.gst || 0);
  return { hw: Math.round(wind.spd * Math.cos(a)), xw: Math.round(Math.abs(g * Math.sin(a))), side: Math.sin(a) > 0 ? 'R' : 'L' };
}

async function viewAirport(main, arg) {
  const q = aptParse(arg);
  if (!/^[A-Z0-9]{4}$/.test(q.icao)) { main.innerHTML = '<h1>Airport</h1><p class="lede">No airport given. Open it from the icon next to DEP or ARR in a flight.</p>'; return; }
  try { await Promise.all([loadAirports(), brfRwyDB(), brfAiracLoad(), aptAipDB()]); } catch { /* si mostra quello che c'è */ }
  if (typeof IATA !== 'undefined' && !IATA) { try { IATA = await (await fetch('data/iata.json')).json(); } catch { /* niente IATA */ } }
  const icao = q.icao, a = apt(icao);
  const my = viewAirport.seq = (viewAirport.seq || 0) + 1;
  const alive = () => my === viewAirport.seq && location.hash.startsWith('#aeroporto/' + icao);
  const aip = APT_AIP?.[icao] || null;
  const ref = q.at || Date.now();
  const mv = a && typeof magVar === 'function' ? magVar(a[0], a[1], ref) : null;
  const P = a ? aptM(a[0], a[1]) : null;
  const heads = a ? aptHeads(icao, aip) : [];
  const st = { cx: 0, cy: 0, w: 4000, h: 3000, u: 10, sel: null, tdz: true, exits: true, full: false };
  let ways = [], exits = [], wind = null, mapStatic = '', status = '';

  const note = () => data?.aptNotes?.[icao]?.txt || '';
  const pickSel = () => {
    if (st.sel && heads.some(h => h.id === st.sel)) return;
    const sc = h => { const c = aptWindComp(h, wind); return [(c ? -c.hw : 0), brfApptRank(icao, h.id), h.aip ? 0 : 1]; };
    st.sel = heads.slice().sort((x, y) => { const [a1, b1, c1] = sc(x), [a2, b2, c2] = sc(y); return (a1 - a2) || (b1 - b2) || (c1 - c2); })[0]?.id || null;
  };
  const fit = (box) => {
    const pts = heads.flatMap(h => [P(h.thr), P(h.end)]); if (!pts.length) { st.cx = 0; st.cy = 0; st.w = 4000; }
    else {
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), pad = 650;
      const bw = Math.max(...xs) - Math.min(...xs) + 2 * pad, bh = Math.max(...ys) - Math.min(...ys) + 2 * pad;
      st.cx = (Math.max(...xs) + Math.min(...xs)) / 2; st.cy = (Math.max(...ys) + Math.min(...ys)) / 2;
      const r = box.height / box.width; st.w = Math.max(bw, bh / r);
    }
  };

  const rwTable = () => {
    if (!heads.length) return '<p class="muted">No runway data for this airport.</p>';
    const rows = heads.map(h => {
      const ap = brfAppr(icao, h.id), c = aptWindComp(h, wind), A = h.aip;
      const mag = mv == null ? '' : String(brfMag(h.brg, mv)).padStart(3, '0') + '°';
      return `<tr class="click${h.id === st.sel ? ' sel' : ''}" data-rw="${esc(h.id)}"><td class="l"><b>${esc(h.id)}</b></td><td>${mag}</td>
        ${aip ? (A ? `<td>${A.tora}</td><td>${A.toda}</td><td>${A.asda}</td><td><b>${A.lda}</b></td><td>${A.elev ?? ''}</td>` : '<td colspan="5" class="muted">not in AIP data</td>') : ''}
        <td class="l">${ap ? esc(ap.all.join(' · ')) : '<span class="muted">—</span>'}</td>
        <td>${c ? `<span class="${c.hw < 0 ? 'tw' : ''}">${c.hw < 0 ? 'TW ' + -c.hw : 'HW ' + c.hw}</span> · XW ${c.xw}${c.xw ? c.side : ''}` : '<span class="muted">—</span>'}</td></tr>`;
    }).join('');
    const ints = (aip?.int || []).map(x => `<li><b>RWY ${esc(x.rwy)}</b> from ${esc(x.from)}: TORA ${x.tora} · TODA ${x.toda} · ASDA ${x.asda}${x.note ? ` <small>${esc(x.note)}</small>` : ''}</li>`).join('');
    return `<div class="scroll-x"><table class="data apt-rw"><thead><tr><th class="l">RWY</th><th>QFU</th>${aip ? '<th>TORA</th><th>TODA</th><th>ASDA</th><th>LDA</th><th>THR ft</th>' : ''}<th class="l">Approaches</th><th>Wind (METAR)</th></tr></thead><tbody>${rows}</tbody></table></div>
      ${ints ? `<h5>Intersection take-off (AIP)</h5><ul class="apt-int">${ints}</ul>` : ''}`;
  };
  const exitList = () => {
    const h = heads.find(x => x.id === st.sel); if (!h) return '';
    if (!h.aip) return `<p class="muted apt-noaip">${aip ? `RWY ${esc(h.id)} is not in the AIP data.` : 'Distances not available: AIP data not entered for this airport.'}</p>`;
    if (!ways.length) return '<p class="muted">Exits: airport map not loaded yet.</p>';
    if (!exits.length) return `<p class="muted">No taxiway exits found on the map for RWY ${esc(h.id)}.</p>`;
    return `<h5>Exits RWY ${esc(h.id)} <small>≈ distance from the AIP threshold · remaining LDA ${h.aip.lda} m</small></h5>
      <div class="apt-exits">${exits.map(e => `<span class="${e.ret ? 'ret' : ''}"><b>${esc(e.ref)}</b> ≈${e.s} m<small>${e.end ? 'runway end' : 'rem ≈' + e.rem + ' m'}${e.ret ? ' · rapid' : ''}</small></span>`).join('')}</div>`;
  };

  const draw = () => {
    if (!alive()) return;
    const wx = brfRead('wx:' + icao), metRaw = wx?.v?.metar || '', tafRaw = wx?.v?.taf || '';
    try { wind = metRaw ? brfDecode(brfMetarBody(metRaw))?.wind || null : null; } catch { wind = null; }
    pickSel();
    const sel = heads.find(h => h.id === st.sel);
    exits = sel ? aptExits(sel, ways, P) : [];
    const tok = t => { const d = brfToken(t); return d && d.lvl !== 'ok' ? `<u class="${d.lvl}">${esc(t)}</u>` : esc(t); };
    const tz = a?.[4], off = tz ? utcLabel(tz, q.date || today(), q.hhmm ? q.hhmm.slice(0, 2) + ':' + q.hhmm.slice(2) : '') : '';
    main.innerHTML = `<div class="brf-head"><div><h1>${esc(icao)} <span class="apt-iata">${esc(brfIataOf(icao))}</span></h1><p class="lede">${esc(a ? cleanAptName(a[2]) : 'Airport not in the database')}${a?.[3] ? ' · ' + esc(a[3]) : ''}</p></div>
      <div class="brf-upd"><button type="button" class="btn small" id="aptBack">← Back</button><span>${esc(status)}</span><button type="button" class="btn small" id="aptRefresh">Refresh</button></div></div>
      <section class="apt-card apt-loc">
        <div><span>Latitude</span><b>${a ? a[0].toFixed(4) : '—'}</b></div><div><span>Longitude</span><b>${a ? a[1].toFixed(4) : '—'}</b></div>
        <div><span>UTC offset</span><b>${esc(off || '—')}</b></div><div><span>Timezone</span><b>${esc(tz || '—')}</b></div>
        <div><span>Variation</span><b>${mv == null ? '—' : magVarTxt(mv)}</b></div>
      </section>
      <section class="apt-card"><h4>Warning note</h4>
        <textarea id="aptNote" rows="3" placeholder="Enter warning notes for this airport…">${esc(note())}</textarea>
        <small class="hint" id="aptNoteSt">${data?.aptNotes?.[icao]?.mt ? 'Saved ' + brfAge(data.aptNotes[icao].mt) + ' · synced with the logbook' : 'Kept for this airport on every flight, synced with the logbook.'}</small></section>
      <section class="apt-card apt-mapcard">
        <div class="apt-map${st.full ? ' full' : ''}" id="aptMap">
          ${a && heads.length ? `<svg class="brf-svg apt-svg" id="aptSvg" role="img" aria-label="Airport diagram"><g id="aptG0">${mapStatic}</g><g id="aptG1"></g></svg>` : `<div class="brf-map-empty">${a ? 'No runway data for this airport.' : 'Airport not in the database.'}</div>`}
          <div class="apt-tools">
            <button type="button" data-t="exits" class="${st.exits && sel?.aip ? 'on' : ''}" ${sel?.aip ? '' : 'disabled'}>EXIT DIST.</button>
            <button type="button" data-t="tdz" class="${st.tdz && sel?.aip ? 'on' : ''}" ${sel?.aip ? '' : 'disabled'}>TDZ</button>
            <button type="button" data-t="notam" disabled title="Coming with the NOTAM service">NOTAMs</button>
          </div>
          <div class="apt-north"><svg viewBox="-8 -14 16 24" aria-hidden="true"><path d="M0,-12L6,8L0,3L-6,8Z"/></svg><b>N</b>${mv == null ? '' : `<small>VAR ${magVarTxt(mv)}</small>`}</div>
          <div class="apt-scale" id="aptScale"></div>
          <div class="apt-zoom"><button type="button" data-z="in" aria-label="Zoom in">+</button><button type="button" data-z="out" aria-label="Zoom out">−</button><button type="button" data-z="reset" aria-label="Reset view">⟲</button><button type="button" data-z="full" aria-label="Full screen">${st.full ? '✕' : '⤢'}</button></div>
          ${sel?.aip ? `<div class="apt-legend"><span class="tdz">TDZ ${Math.min(900, Math.round(sel.aip.lda / 3))} m</span><span class="exi">exit ≈ m from THR</span><span class="end">LDA end</span></div>` : ''}
        </div>
        <div class="apt-src">${aip ? `AIP data: ${esc(aip.src)}, ${esc(aip.amdt || '')}${aip.eff ? ' (' + dmy(aip.eff) + ')' : ''}. Exits ≈ measured from the AIP threshold to OpenStreetMap taxiways.` : 'No AIP data for this airport: map only, no distances.'} Map © OpenStreetMap contributors. Not for navigation.</div>
        <div class="apt-body">${rwTable()}${exitList()}</div>
      </section>
      <section class="apt-card"><h4>Weather</h4>
        <h5>METAR</h5>${metRaw ? `<p class="mono">${metRaw.trim().split(/\s+/).map(tok).join(' ')}</p>` : '<p class="muted">No METAR.</p>'}
        <h5>TAF</h5>${tafRaw ? `<p class="mono">${esc(tafRaw).replace(/ (BECMG|TEMPO|FM\d{6}|PROB\d0)/g, '<br>$1')}</p>` : '<p class="muted">No TAF.</p>'}
      </section>
      <section class="apt-card"><h4>NOTAMs</h4><p class="muted">The NOTAM service is not connected yet: check the official briefing package.</p></section>`;
    bind();
  };

  // ---------- zoom e spostamento
  let raf = 0, ro = null;
  const paint = () => {
    raf = 0;
    const svg = $('#aptSvg', main), box = $('#aptMap', main); if (!svg || !box) return;
    const r = box.getBoundingClientRect(); if (!r.width) return;
    st.h = st.w * r.height / r.width; st.u = st.w / r.width;
    svg.setAttribute('viewBox', `${(st.cx - st.w / 2).toFixed(1)} ${(st.cy - st.h / 2).toFixed(1)} ${st.w.toFixed(1)} ${st.h.toFixed(1)}`);
    $('#aptG1', main).innerHTML = aptMapOverlay(st, heads, ways, P, exits, mv);
    const sc = $('#aptScale', main); if (sc) sc.innerHTML = aptScale(st, r.width);
  };
  const repaint = () => { if (!raf) raf = requestAnimationFrame(paint); };
  const clampW = w => Math.min(30000, Math.max(250, w));
  const zoomAt = (k, fx, fy) => {   // fx, fy: punto fermo in frazione del riquadro (0..1)
    const w2 = clampW(st.w / k), h2 = w2 * st.h / st.w;
    st.cx += (fx - 0.5) * (st.w - w2); st.cy += (fy - 0.5) * (st.h - h2); st.w = w2; st.h = h2; repaint();
  };
  function bind() {
    $('#aptBack', main).onclick = () => { if (history.length > 1) history.back(); else location.hash = 'riepilogo'; };
    $('#aptRefresh', main).onclick = () => load(true);
    const ta = $('#aptNote', main);
    if (ta) { let t; ta.oninput = () => { clearTimeout(t); t = setTimeout(saveNote, 700); }; ta.onblur = () => { clearTimeout(t); saveNote(); }; }
    main.querySelectorAll('tr[data-rw]').forEach(tr => tr.onclick = () => { st.sel = tr.dataset.rw; draw(); });
    main.querySelectorAll('.apt-tools [data-t]').forEach(b => b.onclick = () => { const k = b.dataset.t; if (k === 'exits' || k === 'tdz') { st[k] = !st[k]; draw(); } });
    const box = $('#aptMap', main), svg = $('#aptSvg', main);
    main.querySelector('.apt-zoom').onclick = e => {
      const b = e.target.closest('button'); if (!b) return;
      const z = b.dataset.z;
      if (z === 'in') zoomAt(1.6, .5, .5); else if (z === 'out') zoomAt(1 / 1.6, .5, .5);
      else if (z === 'reset') { fit(box.getBoundingClientRect()); repaint(); }
      else if (z === 'full') { st.full = !st.full; box.classList.toggle('full', st.full); b.textContent = st.full ? '✕' : '⤢'; document.body.classList.toggle('apt-full', st.full); requestAnimationFrame(() => { fit(box.getBoundingClientRect()); paint(); }); }
    };
    if (!svg) return;
    const pts = new Map(); let g0 = null, lastTap = 0;
    const rel = e => { const r = box.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, r]; };
    svg.addEventListener('pointerdown', e => {
      const rw = e.target.closest('[data-rw]');
      if (rw && pts.size === 0) { st.sel = rw.dataset.rw; draw(); return; }
      svg.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]);
      const now = Date.now();
      if (pts.size === 1 && now - lastTap < 300) { const [fx, fy] = rel(e); zoomAt(2, fx, fy); }
      lastTap = now; g0 = null;
    });
    svg.addEventListener('pointermove', e => {
      if (!pts.has(e.pointerId)) return;
      const prev = pts.get(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]);
      const [, , r] = rel(e);
      if (pts.size === 1) { st.cx -= (e.clientX - prev[0]) * st.w / r.width; st.cy -= (e.clientY - prev[1]) * st.w / r.width; repaint(); return; }
      const [p, q2] = [...pts.values()], d = Math.hypot(p[0] - q2[0], p[1] - q2[1]), mx = (p[0] + q2[0]) / 2, my = (p[1] + q2[1]) / 2;
      if (g0) {
        zoomAt(d / g0.d, (mx - r.left) / r.width, (my - r.top) / r.height);
        st.cx -= (mx - g0.mx) * st.w / r.width; st.cy -= (my - g0.my) * st.w / r.width;
      }
      g0 = { d, mx, my };
    });
    const up = e => { pts.delete(e.pointerId); g0 = null; };
    svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
    svg.addEventListener('wheel', e => { e.preventDefault(); const [fx, fy] = rel(e); zoomAt(Math.exp(-e.deltaY * .0015), fx, fy); }, { passive: false });
    if (!st.fitted) { fit(box.getBoundingClientRect()); st.fitted = true; }
    ro?.disconnect(); ro = new ResizeObserver(repaint); ro.observe(box);
    paint();
  }
  async function saveNote() {
    const ta = $('#aptNote', main); if (!ta || !data) return;
    const v = ta.value.replace(/\s+$/, ''); if (v === note()) return;
    (data.aptNotes ||= {})[icao] = { txt: v, mt: Date.now() };
    try { await save(); const s = $('#aptNoteSt', main); if (s) s.textContent = 'Saved · synced with the logbook'; } catch { /* save() mostra già l'errore */ }
  }
  // ---------- dati: meteo e mappa (salvati sul dispositivo come nel briefing)
  async function load(force) {
    status = navigator.onLine ? 'Updating…' : 'Offline · saved data'; draw();
    await brfWeather([icao], force).catch(() => null);
    if (a) { try { await brfMap(icao, a[0], a[1]); } catch (e) { console.warn('map', icao, e); } }
    readMap();
    status = brfRead('wx:' + icao)?.t ? 'Weather ' + brfAge(brfRead('wx:' + icao).t) : ''; draw();
  }
  function readMap() { ways = brfRead('map:' + icao)?.v || []; mapStatic = P && heads.length ? aptMapStatic(ways, heads, P) : ''; }
  // a schermo intero: si esce anche cambiando pagina
  const leave = () => { if (!location.hash.startsWith('#aeroporto/')) { document.body.classList.remove('apt-full'); window.removeEventListener('hashchange', leave); } };
  window.addEventListener('hashchange', leave);
  readMap(); draw(); load(false);
}
