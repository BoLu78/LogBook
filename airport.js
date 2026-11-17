'use strict';
/* Pagina aeroporto: si apre dall'icona accanto a DEP e ARR nella scheda del volo.
   Mappa ingrandibile (OpenStreetMap), distanze SOLO dai dati AIP inseriti in data/aip.json, warning note
   sincronizzata con il logbook (data.aptNotes), METAR/TAF e NOTAM.
   Modulo separato, caricato solo quando serve: se qui qualcosa non va, il resto dell'app non ne risente. */
let APT_AIP = null;
async function aptAipDB() { if (!APT_AIP) { try { APT_AIP = await (await fetch('data/aip.json')).json(); } catch { APT_AIP = {}; } } return APT_AIP; }
// schema delle piste preferenziali per la partenza (AOI): giorno "first"/"second" e pista per l'orario UTC dato
function aptAoiDep(aoi, date, hhmm, tz) {
  const D = aoi?.dep; if (!D || !date) return null;
  const [y, m, d] = date.split('-').map(Number), ref = D.first?.[y]?.[m - 1];
  if (!ref) return { none: `scheme for ${y} not in the AOI data` };
  const day = Math.abs(d - ref) % 2 === 0 ? 'first' : 'second', per = D.summer.includes(m) ? 'summer' : 'std';
  // ‡ (Lido 7.13): durante l'ora legale gli orari UTC sono un'ora prima. Vale solo per gli orari stampati con ‡
  const dst = (D.dstShift || []).includes(per) && aptIsDst(tz, date);
  const sh = t => { if (!dst) return t; const n = (+t.slice(0, 2) * 60 + +t.slice(2) - 60 + 1440) % 1440; return String(Math.floor(n / 60)).padStart(2, '0') + String(n % 60).padStart(2, '0'); };
  const set = D.schemes[day][per].map(([r, a, b]) => [r, sh(a), sh(b)]);
  const hit = hhmm ? set.find(([, a, b]) => hhmm >= a && hhmm < b) : null;
  return { day, set, dst, rw: hit?.[0] || null, slot: hit ? `${hit[1]}-${hit[2]}` : '' };
}
// ora legale in vigore quel giorno nel fuso dell'aeroporto (offset maggiore di quello di gennaio)
function aptIsDst(tz, date) {
  if (!tz) return false;
  const off = t => { try { const v = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(new Date(t)).find(p => p.type === 'timeZoneName')?.value || 'GMT'; const m = v.match(/GMT([+-]\d+)(?::(\d+))?/); return m ? +m[1] * 60 + Math.sign(+m[1]) * (+m[2] || 0) : 0; } catch { return 0; } };
  const y = date.slice(0, 4);
  return off(Date.parse(date + 'T12:00:00Z')) > Math.min(off(Date.parse(y + '-01-15T12:00:00Z')), off(Date.parse(y + '-07-15T12:00:00Z')));
}
const aptM = (lat, lon) => p => [(p[1] - lon) * 111320 * Math.cos(brfRad(lat)), -(p[0] - lat) * 110540];   // metri: x est, y sud
const aptDir = brg => [Math.sin(brfRad(brg)), -Math.cos(brfRad(brg))];                                        // versore della prua vera
// #aeroporto/GCLP oppure #aeroporto/GCLP_2026-11-19.1225 (orario UTC del volo: serve a fuso e NOTAM)
function aptHash(icao, date, hhmm) { return 'aeroporto/' + icao + (date ? '_' + date + (hhmm ? '.' + hhmm : '') : ''); }
function aptParse(arg) {
  const [c, rest = ''] = String(arg || '').split('_'), parts = rest.split('.'), date = parts[0], hhmm = parts.find(x => /^\d{4}$/.test(x)), role = parts.find(x => x === 'd' || x === 'a');
  const d = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : null, t = hhmm || '';
  return { icao: (c || '').toUpperCase(), date: d, hhmm: t, role: role === 'd' ? 'dep' : role === 'a' ? 'arr' : '', at: d ? Date.parse(`${d}T${t ? t.slice(0, 2) + ':' + t.slice(2) : '12:00'}:00Z`) : null };
}

// ---------- piste: testate con prua vera; se ci sono i dati AIP, soglia e distanze dichiarate ufficiali
function aptHeads(icao, aip) {
  const rws = brfRunwaysOf(icao), heads = [];
  for (const r of rws) {
    for (const [id, thr, end, brg] of [[r.idA, r.A, r.B, r.brg], [r.idB, r.B, r.A, (r.brg + 180) % 360]]) {
      const a = aip?.rwy?.[id];
      heads.push({ id, w: r.w, thr: a?.thr || thr, phys: thr, end, brg: a?.brg ?? brg, aip: a || null, pair: r });
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
// ---------- elementi della mappa preparati una volta: stopway, soglie spostate, holding point, barriere, PAPI, maniche a vento, torre
function aptPrep(ways, heads, P) {
  const V = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1; return [dx / L, dy / L, L]; };
  // asse di una testata: lungo (s, verso la pista) e di lato (c) rispetto alla soglia
  const axis = h => { const o = P(h.thr), [ux, uy] = aptDir(h.brg); return p => { const q = P(p), dx = q[0] - o[0], dy = q[1] - o[1]; return [dx * ux + dy * uy, -dx * uy + dy * ux]; }; };
  for (const h of heads) {
    const ax = axis(h), hw = h.w / 2 + 12;
    h.disp = Math.max(0, ax(h.phys)[0] * -1);                     // soglia AIP più avanti dell'inizio fisico della pista
    let back = h.disp;
    for (const w of ways) if (w.a === 'stopway') for (const p of w.g) { const [s0, c0] = ax(p); if (Math.abs(c0) < hw && s0 < 0) back = Math.max(back, -s0); }
    h.back = back;                                                  // asfalto davanti alla soglia (stopway o soglia spostata)
  }
  const twSegs = [];
  for (const w of ways) if (w.a === 'taxiway') for (let i = 1; i < w.g.length; i++) twSegs.push([P(w.g[i - 1]), P(w.g[i]), w.w || 23]);
  const nearSeg = q => { let best = null; for (const [a, b, wd] of twSegs) { const [ux, uy, L] = V(a, b), t = Math.max(0, Math.min(L, (q[0] - a[0]) * ux + (q[1] - a[1]) * uy)), d = Math.hypot(a[0] + ux * t - q[0], a[1] + uy * t - q[1]); if (!best || d < best.d) best = { d, ux, uy, wd }; } return best; };
  const nearRw = q => { let best = null; for (const h of heads) { const a = P(h.pair.A), b = P(h.pair.B), [ux, uy, L] = V(a, b), t = Math.max(0, Math.min(L, (q[0] - a[0]) * ux + (q[1] - a[1]) * uy)), d = Math.hypot(a[0] + ux * t - q[0], a[1] + uy * t - q[1]); if (!best || d < best.d) best = { d, ux, uy, h, t, a }; } return best; };
  const hold = [], bar = [], papi = [], sock = [];
  let twr = null;
  for (const w of ways) {
    const q = P(w.g[0]);
    if (w.a === 'holding_position') { const n = nearSeg(q); if (n && n.d < 40) hold.push({ q, ux: n.ux, uy: n.uy, wd: n.wd, rw: w.t !== 'intermediate' }); }
    else if (w.a === 'arresting_gear') { const n = nearRw(q); if (n && n.d < 60) bar.push({ q: [n.a[0] + n.ux * n.t, n.a[1] + n.uy * n.t], ux: n.ux, uy: n.uy, w: n.h.w }); }
    else if (w.a === 'papi') { const n = nearRw(q); if (n && n.d < 200) papi.push({ q, ux: n.ux, uy: n.uy }); }
    else if (w.a === 'windsock') sock.push(q);
    else if (w.a === 'tower' && !twr) { const pts = w.g.map(P); twr = [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length]; }
  }
  return { hold, bar, papi, sock, twr };
}
// geometria fissa in metri (si ingrandisce con la mappa)
function aptMapStatic(ways, heads, P) {
  const path = g => g.map((p, i) => { const [x, y] = P(p); return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`; }).join('');
  const area = cls => ways.filter(w => cls.includes(w.a) && w.g.length > 2).map(w => `<path d="${path(w.g)}Z" class="${w.a === 'apron' ? 'ap' : 'bd'}"/>`).join('');
  const ap = area(['apron']), bd = area(['terminal', 'hangar', 'tower']);
  const pk = ways.filter(w => w.a === 'parking_position' && w.g.length > 1).map(w => `<path d="${path(w.g)}" class="pk"/>`).join('');
  const twb = ways.filter(w => w.a === 'taxiway').map(w => `<path d="${path(w.g)}" class="twb" stroke-width="${w.w || 23}"/>`).join('');
  const twc = ways.filter(w => w.a === 'taxiway').map(w => `<path d="${path(w.g)}" class="twc"/>`).join('');
  // stopway: asfalto con le chevron gialle che puntano alla pista
  let sw = '';
  for (const w of ways.filter(w => w.a === 'stopway' && w.g.length > 1)) {
    const a = P(w.g[0]), b = P(w.g.at(-1));
    // quale estremo tocca una pista? le chevron puntano verso quello
    const dEnd = p => Math.min(...heads.map(h => Math.hypot(P(h.phys)[0] - p[0], P(h.phys)[1] - p[1])));
    const [far, near] = dEnd(a) < dEnd(b) ? [b, a] : [a, b];
    const L = Math.hypot(near[0] - far[0], near[1] - far[1]) || 1, ux = (near[0] - far[0]) / L, uy = (near[1] - far[1]) / L, nx = -uy, ny = ux;
    const wd = heads.find(h => Math.hypot(P(h.phys)[0] - near[0], P(h.phys)[1] - near[1]) < 80)?.w || 45, hw = wd / 2;
    sw += `<path d="M${far}L${near}" class="swb" stroke-width="${wd}"/>`;
    for (let t = 8; t + 14 < L; t += 30) {
      const bx = far[0] + ux * t, by = far[1] + uy * t, tip = [bx + ux * 14, by + uy * 14];
      sw += `<path class="chv" d="M${(bx + nx * hw * .85).toFixed(1)},${(by + ny * hw * .85).toFixed(1)}L${tip[0].toFixed(1)},${tip[1].toFixed(1)}L${(bx - nx * hw * .85).toFixed(1)},${(by - ny * hw * .85).toFixed(1)}" stroke-width="2"/>`;
    }
  }
  const seen = new Set();
  let rw = '';
  for (const h of heads) {
    if (!seen.has(h.pair)) { seen.add(h.pair); rw += `<path d="${path([h.pair.A, h.pair.B])}" class="rwb" stroke-width="${h.w}"/>`; }
    // soglia: "piano" bianco (solo dove la soglia viene dall'AIP); soglia spostata: frecce bianche dall'inizio pista alla soglia
    if (!h.aip) continue;
    const o = P(h.thr), [ux, uy] = aptDir(h.brg), nx = -uy, ny = ux, hw = h.w / 2, at = (s, c) => [(o[0] + ux * s + nx * c).toFixed(1), (o[1] + uy * s + ny * c).toFixed(1)];
    const n = Math.max(4, Math.round(h.w / 45 * 12)), gap = (h.w - 6) / n;
    for (let k = 0; k < n; k++) { const c = -hw + 3 + gap * (k + .5); if (Math.abs(c) < gap * .6) continue; rw += `<path class="mk" d="M${at(6, c)}L${at(36, c)}" stroke-width="${Math.min(1.8, gap * .55)}"/>`; }
    rw += `<path class="mk" d="M${at(1.5, -hw + 1)}L${at(1.5, hw - 1)}" stroke-width="3"/>`;
    if (h.disp > 30) for (let s = -h.disp + 20; s < -25; s += 40) rw += `<path class="mk" d="M${at(s, 0)}L${at(s + 18, 0)}M${at(s + 12, -3)}L${at(s + 18, 0)}L${at(s + 12, 3)}" stroke-width="1"/>`;
  }
  return ap + bd + pk + twb + sw + rw + twc;
}
// tutto ciò che deve restare della stessa misura sullo schermo, ridisegnato a ogni zoom
function aptMapOverlay(st, heads, ways, P, exits, mv, prep, icao) {
  const u = st.u, [x0, y0] = [st.cx - st.w / 2, st.cy - st.h / 2], x1 = x0 + st.w, y1 = y0 + st.h;
  const vis = q => q[0] > x0 - 60 * u && q[0] < x1 + 60 * u && q[1] > y0 - 60 * u && q[1] < y1 + 60 * u;
  const F = n => n.toFixed(1);
  const sel = heads.find(h => h.id === st.sel);
  let g = '';
  // asse pista tratteggiato
  const seen = new Set();
  for (const h of heads) if (!seen.has(h.pair)) { seen.add(h.pair); const a = P(h.pair.A), b = P(h.pair.B); g += `<path class="rwc2" d="M${F(a[0])},${F(a[1])}L${F(b[0])},${F(b[1])}" stroke-width="${Math.max(.9, u)}" stroke-dasharray="30 20"/>`; }
  if (st.notam) g += st.nsvg;
  // holding point: barra rossa trasversale al raccordo (gialla se intermedio)
  for (const k of prep.hold) {
    if (!vis(k.q)) continue;
    const L = Math.max(k.wd + 8, 12 * u) / 2, nx = -k.uy, ny = k.ux;
    g += `<path class="hp${k.rw ? '' : ' int'}" d="M${F(k.q[0] - nx * L)},${F(k.q[1] - ny * L)}L${F(k.q[0] + nx * L)},${F(k.q[1] + ny * L)}" stroke-width="${2.4 * u}" stroke-dasharray="${2.2 * u} ${1.4 * u}"/>`;
  }
  // barriere (arresting gear / cable barrier) attraverso la pista
  for (const b of prep.bar) {
    const L = b.w / 2 + 10, nx = -b.uy, ny = b.ux;
    g += `<path class="bar" d="M${F(b.q[0] - nx * L)},${F(b.q[1] - ny * L)}L${F(b.q[0] + nx * L)},${F(b.q[1] + ny * L)}" stroke-width="${2.6 * u}"/>`;
    if (u < 3) g += `<text class="barl" x="${F(b.q[0] + nx * (L + 4 * u))}" y="${F(b.q[1] + ny * (L + 4 * u) + 3 * u)}" font-size="${9 * u}">BARRIER</text>`;
  }
  // PAPI: quattro luci, due bianche e due rosse, di traverso alla pista
  for (const p of prep.papi) {
    if (!vis(p.q)) continue;
    const nx = -p.uy, ny = p.ux, d = 4.2 * u;
    g += [-1.5, -.5, .5, 1.5].map((k, i) => `<circle class="papi${i < 2 ? ' w' : ''}" cx="${F(p.q[0] + nx * k * d)}" cy="${F(p.q[1] + ny * k * d)}" r="${1.8 * u}"/>`).join('');
  }
  for (const q of prep.sock) if (vis(q)) g += `<path class="sock" d="M${F(q[0])},${F(q[1])}l${F(10 * u)},${F(-3 * u)}l${F(-10 * u)},${F(-3 * u)}z"/>`;
  if (prep.twr && vis(prep.twr)) g += `<g class="twr" transform="translate(${F(prep.twr[0])},${F(prep.twr[1])})"><rect x="${-14 * u}" y="${-7 * u}" width="${28 * u}" height="${14 * u}" rx="${3 * u}"/><text y="${3.8 * u}" font-size="${9.5 * u}">TWR</text></g>`;
  // TDZ: primi 900 m dalla soglia AIP (o un terzo dell'LDA se più corta), tacche ogni 300 m, fine LDA
  if (sel?.aip && st.tdz) {
    const o = P(sel.thr), [ux, uy] = aptDir(sel.brg), nx = -uy, ny = ux, hw = sel.w / 2, lda = sel.aip.lda, tdz = Math.min(900, lda / 3);
    const at = (s, c) => [o[0] + ux * s + nx * c, o[1] + uy * s + ny * c];
    const poly = (s0, s1, cls) => `<path class="${cls}" d="M${at(s0, -hw)}L${at(s1, -hw)}L${at(s1, hw)}L${at(s0, hw)}Z"/>`;
    g += poly(0, tdz, 'tdz');
    // scritte dal lato della pista dove non ci sono le uscite
    const sd = st.exits && exits.filter(e => e.c > 0).length > exits.filter(e => e.c < 0).length ? -1 : 1;
    const lab = (s, t, cls = '') => { const [a, b] = [at(s, -hw - 3 * u), at(s, hw + 3 * u)], p = at(cls ? s - 22 * u : s, sd * (hw + (cls ? 30 : 16) * u)); return `<path class="tk ${cls}" d="M${a}L${b}" stroke-width="${2 * u}"/><text class="tkl ${cls}" x="${p[0].toFixed(0)}" y="${(p[1] + 3.5 * u).toFixed(0)}" font-size="${9.5 * u}">${t}</text>`; };
    for (const s of [300, 600, 900]) if (s <= tdz + 1) g += lab(s, s);
    g += lab(lda, 'LDA END', 'end');
    if (sel.disp > 30) { const p = at(-sel.disp / 2, sd * (hw + 30 * u)); g += `<text class="tkl" x="${p[0].toFixed(0)}" y="${(p[1] + 3.5 * u).toFixed(0)}" font-size="${9.5 * u}">DISPL THR ${Math.round(sel.disp)} m</text>`; }
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
  // etichette di pista oltre l'asfalto davanti alla soglia: numero, QFU magnetico, miglior avvicinamento. Si toccano per scegliere la pista
  const put = [];
  for (const h of heads) {
    const t = P(h.thr), [ux, uy] = aptDir(h.brg), ap = brfAppr(icao, h.id);
    const qfu = mv == null ? '' : String(brfMag(h.brg, mv)).padStart(3, '0') + '°';
    const W = 38 * u, H = (ap ? 38 : 29) * u;
    let d = (h.back || 0) + H / 2 + 8 * u, c = [t[0] - ux * d, t[1] - uy * d];
    for (let k = 0; k < 4 && put.some(q => Math.abs(q[0] - c[0]) < W + 2 * u && Math.abs(q[1] - c[1]) < H + 2 * u); k++) { d += H + 4 * u; c = [t[0] - ux * d, t[1] - uy * d]; }
    put.push(c);
    g += `<g class="rwl2${h.id === st.sel ? ' sel' : ''}${h.id === st.pref ? ' pref' : ''}" data-rw="${esc(h.id)}" transform="translate(${F(c[0])},${F(c[1])})"><rect x="${-W / 2}" y="${-H / 2}" width="${W}" height="${H}" rx="${H / 2.6}"/>`
      + `<text y="${(ap ? -5 : -1) * u}" font-size="${13 * u}" class="id">${esc(h.id)}</text><text y="${(ap ? 6 : 10) * u}" font-size="${8.5 * u}">${qfu}</text>${ap ? `<text y="${16 * u}" font-size="${6.8 * u}" class="ap">${esc(ap.best)}</text>` : ''}</g>`;
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

// ---------- NOTAM: dal Worker "notam-bridge" (FAA NMS-API), salvati sul dispositivo per l'uso offline
const APT_NOTAM_BRIDGE = 'https://notam-bridge.bortolotluca.workers.dev';
const APT_NOTAM_FRESH = 15 * 60e3;
async function aptNotams(icao, force) {
  const c = brfRead('notam:' + icao);
  if (!force && c && Date.now() - c.t < APT_NOTAM_FRESH) return { state: 'ok' };
  try {
    const r = await fetch(`${APT_NOTAM_BRIDGE}/notams?icao=${icao}${force ? '&force=1' : ''}`, { cache: 'no-store', signal: AbortSignal.timeout?.(15000) });
    if (r.status === 503) return { state: 'off' };
    if (!r.ok) return { state: 'err', why: 'HTTP ' + r.status };
    const j = await r.json();
    brfSave('notam:' + icao, j.items || []);
    return { state: 'ok' };
  } catch (e) { return { state: 'err', why: e.name === 'TimeoutError' ? 'timeout' : 'not reachable' }; }
}
// campo di un NOTAM in formato ICAO: E) testo, D) orari
function aptNField(txt, L) { const m = String(txt || '').match(new RegExp('(?:^|\\s)' + L + '\\)\\s*([\\s\\S]*?)(?=\\s[A-G]\\)\\s|$)')); return m ? m[1].replace(/\s+/g, ' ').trim() : ''; }
function aptNText(n) { return aptNField(n.text, 'E') || String(n.plain || n.text || '').replace(/\s+/g, ' ').trim(); }
function aptQ(n) {
  let q = String(n.sel || '').toUpperCase(); if (/^[A-Z]{4}$/.test(q)) q = 'Q' + q;
  if (!/^Q[A-Z]{4}$/.test(q)) { const m = String(n.text || '').match(/Q\)\s*[A-Z]{4}\/(Q[A-Z]{4})/); q = m ? m[1] : ''; }
  return q;
}
// rosso: pista, ILS, avvicinamenti, luci di pista e di avvicinamento, aeroporto chiuso
// giallo: raccordi, piazzali, radioaiuti, SID/STAR, ostacoli · grigio: il resto (TACAN compreso, militare)
const APT_N_RED = ['MR', 'FA', 'PI', 'LA', 'LR', 'LC', 'LE', 'LT', 'LZ', 'LH'];
const APT_N_AMB = ['MX', 'MA', 'MN', 'MK', 'MD', 'MS', 'NV', 'ND', 'NM', 'NB', 'NA', 'NL', 'PD', 'PA', 'OB', 'OL', 'LX', 'LY'];
function aptNLvl(n) {
  const q = aptQ(n), sb = q.slice(1, 3), cd = q.slice(3, 5), t = aptNText(n).toUpperCase();
  if (sb) {
    if (sb === 'NT' || /^(AK|AO)$/.test(cd)) return 'low';
    if (sb[0] === 'I' || APT_N_RED.includes(sb)) return 'bad';
    return APT_N_AMB.includes(sb) ? 'warn' : 'low';
  }
  if (/\bTACAN\b/.test(t)) return 'low';
  if ((/\bRWY\b/.test(t) && /\b(CLSD|CLOSED|U\/S|UNSERVICEABLE|REDUCED|DISPLACED|TORA|TODA|ASDA|LDA)\b/.test(t)) || /\b(ILS|LOC|LLZ|GP|GLIDE)\b/.test(t)) return 'bad';
  return /\b(TWY|TAXIWAY|APRON|STAND|VOR|DME|NDB|SID|STAR|CRANE|OBST)\b/.test(t) ? 'warn' : 'low';
}
const aptNTime = v => !v || /PERM/i.test(v) ? null : (x => isFinite(x) ? x : null)(Date.parse(v));
// chiusure da disegnare: solo testi che chiudono un raccordo o una pista per intero (nessun "tra", "parte", "da/a")
function aptNClosed(n) {
  const t = aptNText(n).toUpperCase().replace(/\.$/, '').replace(/\s+DUE\s+(TO\s+)?[A-Z0-9 ]+$/, '');
  if (/\b(BTN|BETWEEN|PORTION|PART|SECTION|FM|FROM|TO|EXC|EXCEPT|FOR|ACFT|WINGSPAN|ONLY)\b/.test(t.replace(/^\S+\s+\S+/, ''))) return null;
  let m = t.match(/^RWY\s+(\d{2}[LCR]?)(?:\/(\d{2}[LCR]?))?\s+CLSD$/);
  if (m) return { rwy: [m[1], m[2]].filter(Boolean) };
  m = t.match(/^TWY\s+([A-Z0-9 ,]+?)\s+CLSD$/);
  if (m) { const refs = m[1].split(/[\s,]+|\bAND\b/).map(x => x.trim()).filter(Boolean); if (refs.length && refs.every(x => /^[A-Z]{1,2}\d{0,2}[A-Z]?$/.test(x))) return { twy: refs }; }
  return null;
}
function aptNotamSVG(list, ways, heads, P) {
  const path = g => g.map((p, i) => { const [x, y] = P(p); return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`; }).join('');
  const tw = new Set(list.flatMap(c => c.twy || [])), rw = new Set(list.flatMap(c => c.rwy || []));
  let g = ways.filter(w => w.a === 'taxiway' && tw.has(w.r)).map(w => `<path class="ncl" d="${path(w.g)}" stroke-width="${(w.w || 20) + 6}"/>`).join('');
  const done = new Set();
  for (const h of heads) if (rw.has(h.id) && !done.has(h.pair)) { done.add(h.pair); g += `<path class="ncl rwy" d="${path([h.pair.A, h.pair.B])}" stroke-width="${h.w + 8}"/>`; }
  return g;
}
const aptNFmt = ms => { if (ms == null) return 'PERM'; const d = new Date(ms); return `${pad2(d.getUTCDate())} ${['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][d.getUTCMonth()]} ${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}Z`; };
function aptNotamHTML(icao, res, ref, refLab, drawn) {
  const rec = brfRead('notam:' + icao), seen = new Set();
  // via i NOTAM di cancellazione e i doppioni (la FAA a volte manda lo stesso NOTAM due volte)
  const items = (rec?.v || []).filter(n => n.type !== 'C' && !seen.has(n.number + '|' + aptNText(n)) && seen.add(n.number + '|' + aptNText(n)));
  const head = `<h4>NOTAMs <small class="apt-nsrc">FAA${rec?.t ? ' · ' + brfAge(rec.t) : ''}</small></h4>`;
  if (!rec) {
    const why = res?.state === 'off' ? 'The NOTAM service is not active yet: the notam-bridge Worker has no FAA credentials.' : res?.state === 'err' ? `NOTAM service ${esc(res.why || 'not reachable')}.` : 'Loading…';
    return head + `<p class="muted">${why} Check the official briefing package.</p>`;
  }
  const lvR = { bad: 0, warn: 1, low: 2 };
  const rows = items.map(n => ({ n, s: aptNTime(n.start), e: aptNTime(n.end), lvl: aptNLvl(n), cl: aptNClosed(n) }))
    .map(x => ({ ...x, act: (x.s == null || x.s <= ref + 3600e3) && (x.e == null || x.e >= ref - 3600e3) }))
    .sort((a, b) => (lvR[a.lvl] - lvR[b.lvl]) || ((a.s || 0) - (b.s || 0)));
  const li = x => `<li class="${x.lvl}"><i></i><div><b>${esc(x.n.number || x.n.id)}</b>${x.cl && x.act && drawn ? ' <span class="nmap">on map</span>' : ''}<p>${esc(aptNText(x.n))}</p>
    <small>${aptNFmt(x.s)} – ${aptNFmt(x.e)}${x.n.est || /C\)\s*\d{10}\s*EST/.test(x.n.text || '') ? ' EST' : ''}${(d => d ? ' · ' + esc(d) : '')(aptNField(x.n.text, 'D') || x.n.sched)}</small></div></li>`;
  const on = rows.filter(x => x.act), off = rows.filter(x => !x.act);
  return head + (res?.state === 'err' ? `<p class="hint">Service ${esc(res.why || 'not reachable')}: saved NOTAMs.</p>` : '')
    + `<h5>Active at ${esc(refLab)} ±1 h <small>${on.length}</small></h5>${on.length ? `<ul class="apt-notams">${on.map(li).join('')}</ul>` : '<p class="muted">None.</p>'}`
    + (off.length ? `<details><summary>Not active at that time (${off.length})</summary><ul class="apt-notams far">${off.map(li).join('')}</ul></details>` : '')
    + '<p class="hint">Red: runway, ILS, approaches and lights · yellow: taxiways, aprons, navaids, SID/STAR, obstacles · grey: the rest. Only whole-taxiway or whole-runway closures are drawn on the map. The official briefing package is the reference.</p>';
}

// vento del METAR sulla mappa: la freccia punta dove va il vento (la mappa è orientata al nord vero), la scritta è in magnetico
function aptWindBox(wind, mv) {
  if (!wind || !(wind.spd > 0 || wind.dir != null)) return '';
  const spd = `${String(wind.spd).padStart(2, '0')}${wind.gst ? 'G' + wind.gst : ''}KT`;
  if (wind.dir == null) return `<div class="apt-wind"><b>VRB</b><span>${spd}</span><small>METAR</small></div>`;
  const mag = mv == null ? null : brfMag(wind.dir, mv);
  return `<div class="apt-wind"><svg viewBox="-12 -12 24 24" aria-hidden="true" style="transform:rotate(${(wind.dir + 180) % 360}deg)"><path d="M0,-11L5,-2L1.6,-2L1.6,11L-1.6,11L-1.6,-2L-5,-2Z"/></svg>`
    + `<b>${mag == null ? String(wind.dir).padStart(3, '0') + '°T' : String(mag).padStart(3, '0') + '°M'}</b><span>${spd}</span><small>METAR</small></div>`;
}
// note fisse dalle AOI (sola lettura), sotto la warning note personale
function aptAoiBox(aoi, dep, q) {
  if (!aoi) return '';
  const fmt = set => set.map(([r, a, b]) => `<b>${esc(r)}</b> ${a}-${b}`).join(' · ');
  const age = aoi.date ? (Date.now() - Date.parse(aoi.date)) / 864e5 : 0;
  let h = `<div class="apt-aoi"><h5>AOI <small>${esc(aoi.src || '')}${aoi.date ? ' · checked ' + dmy(aoi.date) : ''}</small>${age > 183 ? ' <span class="apt-old">older than 6 months: check the AOI</span>' : ''}</h5>${aoi.notes?.length ? `<ul>${aoi.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}`;
  if (aoi.dep) {
    const S = aoi.dep.schemes;
    h += `<h5>${esc(aoi.dep.title)}</h5>`;
    if (dep && !dep.none && q.date) h += `<p class="apt-aoi-today">${dmy(q.date)}: <b>${dep.day === 'first' ? 'First' : 'Second'} day</b> scheme → ${fmt(dep.set)} UTC${dep.dst ? ' <small>(DST: one hour earlier, ‡)</small>' : ''}${dep.rw ? ` · at ${q.hhmm.slice(0, 2)}:${q.hhmm.slice(2)}Z: <b>RWY ${esc(dep.rw)}</b>` : q.hhmm ? ' · no scheme at that time' : ''}</p>`;
    else if (dep?.none) h += `<p class="muted">${esc(dep.none)}</p>`;
    h += `<table class="data apt-aoi-t"><tr><th></th><th>01 JAN–31 MAY, 01 SEP–31 DEC ‡</th><th>01 JUN–31 AUG</th></tr>
      <tr><td>First day</td><td>${fmt(S.first.std)}</td><td>${fmt(S.first.summer)}</td></tr>
      <tr><td>Second day</td><td>${fmt(S.second.std)}</td><td>${fmt(S.second.summer)}</td></tr></table>
      <small class="hint">"First day" and "Second day" alternate; the first-day dates of each month are in the AOI table. Table times in UTC as printed; ${esc(aoi.dep.mark || '')}. The line above already applies it.</small>`;
  }
  if (aoi.text) {
    // testo completo delle AOI: titoli in grassetto, il resto com'è
    const lines = String(aoi.text).split('\n').map(l => {
      const t = esc(l), head = l.length < 48 && /^[A-Z][A-Za-z ,/&()-]+$/.test(l) && !/\b(AVBL|RWY|TWY|MAX|ACFT)\b/.test(l);
      return head ? `<b>${t}</b>` : t;
    }).join('\n');
    h += `<details class="apt-aoi-full"><summary>Full AOI text${aoi.pages ? ` · ${aoi.pages} pages` : ''}${aoi.wef ? ` · WEF ${esc(aoi.wef)}` : ''}</summary><pre>${lines}</pre></details>`;
  }
  return h + '</div>';
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
  const st = { cx: 0, cy: 0, w: 4000, h: 3000, u: 10, sel: null, tdz: true, exits: true, notam: true, full: false, nsvg: '' };
  let nres = null;
  const nref = q.at && q.hhmm ? q.at : Date.now(), nrefLab = q.at && q.hhmm ? `${q.hhmm.slice(0, 2)}:${q.hhmm.slice(2)}Z ${dmy(q.date)}` : 'now';
  let ways = [], exits = [], wind = null, mapStatic = '', status = '', prep = { hold: [], bar: [], papi: [], sock: [], twr: null };

  const note = () => data?.aptNotes?.[icao]?.txt || '';
  const pickSel = () => {
    if (st.sel && heads.some(h => h.id === st.sel)) return;
    const sc = h => { const c = aptWindComp(h, wind); return [(c ? -c.hw : 0), brfApptRank(icao, h.id), h.aip ? 0 : 1]; };
    st.sel = heads.slice().sort((x, y) => { const [a1, b1, c1] = sc(x), [a2, b2, c2] = sc(y); return (a1 - a2) || (b1 - b2) || (c1 - c2); })[0]?.id || null;
  };
  // pista preferenziale col vento del METAR: più vento frontale, a parità il miglior avvicinamento. Con vento calmo o variabile nessuna
  // prima il vento (direzione con più vento frontale; mai vento in coda), poi tra le piste parallele lo schema delle AOI per la partenza,
  // altrimenti il miglior avvicinamento. Con vento calmo o variabile vale solo lo schema AOI, se c'è
  const aoi = data?.aptAoi?.[icao] || null,   // AOI: dati privati del logbook (importati da Settings), mai nel sito pubblico
    aoiDep = q.role !== 'arr' ? aptAoiDep(aoi, q.date, q.hhmm, a?.[4]) : null;
  const prefId = () => {
    st.prefWhy = '';
    const all = heads.map(h => ({ h, c: aptWindComp(h, wind) }));
    const ok = all.filter(x => x.c && x.c.hw > 0);
    const calm = !wind || wind.dir == null || wind.spd <= 3;
    let cand = ok;
    if (ok.length) { const top = Math.max(...ok.map(x => x.c.hw)); cand = ok.filter(x => x.c.hw >= top - 1); }
    else if (calm) cand = all;
    if (!cand.length) return null;
    const aoiHit = aoiDep?.rw && cand.find(x => x.h.id === aoiDep.rw);
    if (aoiHit) { st.prefWhy = `${calm && !ok.length ? 'calm wind' : 'wind HW ' + aoiHit.c.hw} · AOI departure scheme (${aoiDep.day} day, ${aoiDep.slot}Z${aoiDep.dst ? ', DST −1 h' : ''})`; return aoiHit.h.id; }
    if (!ok.length) return null;
    cand.sort((a, b) => (b.c.hw - a.c.hw) || (brfApptRank(icao, a.h.id) - brfApptRank(icao, b.h.id)));
    st.prefWhy = `wind HW ${cand[0].c.hw}` + (cand.length > 1 ? ' · best approach' : '');
    return cand[0].h.id;
  };
  const fit = (box) => {
    const pts = heads.flatMap(h => { const t = P(h.thr), [ux, uy] = aptDir(h.brg), b = (h.back || 0) + 60; return [t, P(h.end), [t[0] - ux * b, t[1] - uy * b]]; }); if (!pts.length) { st.cx = 0; st.cy = 0; st.w = 4000; }
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
      return `<tr class="click${h.id === st.sel ? ' sel' : ''}${h.id === st.pref ? ' pref' : ''}" data-rw="${esc(h.id)}"><td class="l"><b>${esc(h.id)}</b>${h.id === st.pref ? ' <span class="apt-pref">PREF</span>' : ''}</td><td>${mag}</td>
        ${aip ? (A ? `<td>${A.tora}</td><td>${A.toda}</td><td>${A.asda}</td><td><b>${A.lda}</b></td><td>${A.elev ?? ''}</td>` : '<td colspan="5" class="muted">not in AIP data</td>') : ''}
        <td class="l">${ap ? esc(ap.all.join(' · ')) : '<span class="muted">—</span>'}</td>
        <td>${c ? `${c.hw < 0 ? 'TW ' + -c.hw : 'HW ' + c.hw} · XW ${c.xw}${c.xw ? c.side : ''}` : '<span class="muted">—</span>'}</td></tr>`;
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
      <div class="apt-exits">${exits.map(e => `<span class="${e.ret ? 'ret' : ''}${st.ntw?.has(e.ref) ? ' clsd' : ''}"><b>${esc(e.ref)}</b> ≈${e.s} m${st.ntw?.has(e.ref) ? ' <em>CLSD · NOTAM</em>' : ''}<small>${e.end ? 'runway end' : 'rem ≈' + e.rem + ' m'}${e.ret ? ' · rapid' : ''}</small></span>`).join('')}</div>`;
  };

  const draw = () => {
    if (!alive()) return;
    const wx = brfRead('wx:' + icao), metRaw = wx?.v?.metar || '', tafRaw = wx?.v?.taf || '';
    try { wind = metRaw ? brfDecode(brfMetarBody(metRaw))?.wind || null : null; } catch { wind = null; }
    pickSel(); st.pref = prefId();
    const sel = heads.find(h => h.id === st.sel);
    exits = sel ? aptExits(sel, ways, P) : [];
    try {
      const nl = (brfRead('notam:' + icao)?.v || []).filter(n => n.type !== 'C').filter(n => { const a0 = aptNTime(n.start), a1 = aptNTime(n.end); return (a0 == null || a0 <= nref + 3600e3) && (a1 == null || a1 >= nref - 3600e3); }).map(aptNClosed).filter(Boolean);
      st.nsvg = P && heads.length ? aptNotamSVG(nl, ways, heads, P) : '';
      st.ntw = new Set(nl.flatMap(c => c.twy || []));
    } catch (e) { console.warn('notam map', e); st.nsvg = ''; st.ntw = null; }
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
        <small class="hint" id="aptNoteSt">${data?.aptNotes?.[icao]?.mt ? 'Saved ' + brfAge(data.aptNotes[icao].mt) + ' · synced with the logbook' : 'Kept for this airport on every flight, synced with the logbook.'}</small>${aptAoiBox(aoi, aoiDep, q)}</section>
      <section class="apt-card apt-mapcard">
        <div class="apt-map${st.full ? ' full' : ''}" id="aptMap">
          ${a && heads.length ? `<svg class="brf-svg apt-svg" id="aptSvg" role="img" aria-label="Airport diagram"><g id="aptG0">${mapStatic}</g><g id="aptG1"></g></svg>` : `<div class="brf-map-empty">${a ? 'No runway data for this airport.' : 'Airport not in the database.'}</div>`}
          <div class="apt-tools">
            <button type="button" data-t="exits" class="${st.exits && sel?.aip ? 'on' : ''}" ${sel?.aip ? '' : 'disabled'}>EXIT DIST.</button>
            <button type="button" data-t="tdz" class="${st.tdz && sel?.aip ? 'on' : ''}" ${sel?.aip ? '' : 'disabled'}>TDZ</button>
            <button type="button" data-t="notam" class="${st.notam && st.nsvg ? 'on red' : ''}" ${st.nsvg ? '' : 'disabled'} title="Closures from the active NOTAMs">NOTAMs</button>
          </div>
          <div class="apt-north"><svg viewBox="-8 -14 16 24" aria-hidden="true"><path d="M0,-12L6,8L0,3L-6,8Z"/></svg><b>N</b>${mv == null ? '' : `<small>VAR ${magVarTxt(mv)}</small>`}</div>
          ${aptWindBox(wind, mv)}
          <div class="apt-scale" id="aptScale"></div>
          <div class="apt-zoom"><button type="button" data-z="in" aria-label="Zoom in">+</button><button type="button" data-z="out" aria-label="Zoom out">−</button><button type="button" data-z="reset" aria-label="Reset view">⟲</button><button type="button" data-z="full" aria-label="Full screen">${st.full ? '✕' : '⤢'}</button></div>
          ${sel?.aip ? `<div class="apt-legend"><span class="tdz">TDZ ${Math.min(900, Math.round(sel.aip.lda / 3))} m</span><span class="exi">exit ≈ m from THR</span><span class="end">LDA end</span>${st.nsvg && st.notam ? '<span class="ncl">NOTAM closed</span>' : ''}</div>` : ''}
        </div>
        <div class="apt-src">${aip ? `AIP data: ${esc(aip.src)}, ${esc(aip.amdt || '')}${aip.eff ? ' (' + dmy(aip.eff) + ')' : ''}. Exits ≈ measured from the AIP threshold to OpenStreetMap taxiways.` : 'No AIP data for this airport: map only, no distances.'} Map © OpenStreetMap contributors. Not for navigation.</div>
        <div class="apt-body">${rwTable()}${st.pref ? `<p class="apt-why"><span class="apt-pref">PREF</span> RWY ${esc(st.pref)}: ${esc(st.prefWhy)}${q.role === 'dep' || q.role === 'arr' ? ` <small>(${q.role === 'dep' ? 'departure' : 'arrival'}${q.hhmm ? ' ' + q.hhmm.slice(0, 2) + ':' + q.hhmm.slice(2) + 'Z' : ''})</small>` : ''}</p>` : ''}${exitList()}</div>
      </section>
      <section class="apt-card"><h4>Weather</h4>
        <h5>METAR</h5>${metRaw ? `<p class="mono">${metRaw.trim().split(/\s+/).map(tok).join(' ')}</p>` : '<p class="muted">No METAR.</p>'}
        <h5>TAF</h5>${tafRaw ? `<p class="mono">${esc(tafRaw).replace(/ (BECMG|TEMPO|FM\d{6}|PROB\d0)/g, '<br>$1')}</p>` : '<p class="muted">No TAF.</p>'}
      </section>
      <section class="apt-card apt-nsec">${aptNotamHTML(icao, nres, nref, nrefLab, !!st.nsvg && st.notam)}</section>`;
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
    $('#aptG1', main).innerHTML = aptMapOverlay(st, heads, ways, P, exits, mv, prep, icao);
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
    main.querySelectorAll('.apt-tools [data-t]').forEach(b => b.onclick = () => { const k = b.dataset.t; if (k === 'exits' || k === 'tdz' || k === 'notam') { st[k] = !st[k]; draw(); } });
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
    nres = await aptNotams(icao, force).catch(() => ({ state: 'err' })); draw();
    if (a) { try { await brfMap(icao, a[0], a[1]); } catch (e) { console.warn('map', icao, e); } }
    readMap();
    status = brfRead('wx:' + icao)?.t ? 'Weather ' + brfAge(brfRead('wx:' + icao).t) : ''; draw();
  }
  function readMap() { ways = brfMapRec(icao)?.v || []; try { prep = aptPrep(ways, heads, P); } catch (e) { console.warn('prep', e); prep = { hold: [], bar: [], papi: [], sock: [], twr: null }; } mapStatic = P && heads.length ? aptMapStatic(ways, heads, P) : ''; }
  // a schermo intero: si esce anche cambiando pagina
  const leave = () => { if (!location.hash.startsWith('#aeroporto/')) { document.body.classList.remove('apt-full'); window.removeEventListener('hashchange', leave); } };
  window.addEventListener('hashchange', leave);
  readMap(); draw(); load(false);
}
