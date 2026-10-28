'use strict';
/* Mappamondo dei voli: globo trascinabile o planisfero, rotte ad arco di cerchio massimo, aeroporti per frequenza. */

// codici scritti male nel logbook storico, usati solo per trovare le coordinate
const AP_ALIAS = { EBL: 'EBLG', ELBG: 'EBLG', LMJ: 'LIMJ', LMG: 'LIMG', DTNZ: 'DTNH' };
const FAM_VAR = { 'Dornier 328': '--fam5', 'Piaggio P180': '--fam1', 'Boeing 747': '--fam2', 'Boeing 787': '--fam3', 'Boeing 737': '--fam4' };
const NM = 3440.065; // raggio terrestre in miglia nautiche
let MAP = null;      // { airports, land, borders }

async function mapData() {
  if (MAP) return MAP;
  const [airports, world, lite] = await Promise.all([
    fetch('data/airports.json').then(r => r.json()),
    fetch('data/countries-50m.json').then(r => r.json()),
    fetch('data/land-110m.json').then(r => r.json())
  ]);
  MAP = { airports, land: topojson.feature(world, world.objects.countries), borders: topojson.mesh(world, world.objects.countries, (a, b) => a !== b),
    landLite: topojson.feature(lite, lite.objects.land) };
  return MAP;
}
const apOf = code => MAP.airports[code] || MAP.airports[AP_ALIAS[code]];
const regionName = (() => { try { const d = new Intl.DisplayNames(['en'], { type: 'region' }); return cc => { try { return d.of(cc); } catch { return cc; } }; } catch { return cc => cc; } })();

async function viewMap(main) {
  main.innerHTML = '<h1>Map</h1><p class="lede">Loading map…</p>';
  try { await mapData(); } catch (e) { main.innerHTML = `<h1>Map</h1><p class="lede">Map data could not be loaded: ${esc(e.message)}. Open it once while online, then it also works offline.</p>`; return; }
  const st = viewMap.st ||= { period: 'all', fam: '', mode: 'flat', rot: [-12, 0, 0], k: 1 };
  st.mode = 'flat';
  const years = [...new Set(data.flights.map(f => f.date.slice(0, 4)))].sort().reverse();
  const fams = [...new Set(data.flights.filter(f => f.kind === 'flight').map(f => familyOf(f.type)))].sort((a, b) => Object.keys(FAM_VAR).indexOf(a) - Object.keys(FAM_VAR).indexOf(b));

  let list = data.flights.filter(f => f.kind === 'flight' && !f.planned);
  if (st.period === '12m') list = list.filter(f => f.date >= addDays(today(), -365));
  else if (/^\d{4}$/.test(st.period)) list = list.filter(f => f.date.startsWith(st.period));
  if (st.fam) list = list.filter(f => familyOf(f.type) === st.fam);

  // aeroporti e rotte
  const aps = new Map(), routes = new Map(), unknown = new Map(), countries = new Set();
  let dist = 0, longest = null;
  for (const f of list) {
    const A = apOf(f.dep), B = apOf(f.arr);
    for (const [c, p] of [[f.dep, A], [f.arr, B]]) {
      if (!p) { unknown.set(c, (unknown.get(c) || 0) + 1); continue; }
      const k = AP_ALIAS[c] || c;
      const o = aps.get(k) || { code: k, lat: p[0], lon: p[1], name: p[2], cc: p[3], n: 0 };
      o.n++; aps.set(k, o); countries.add(p[3]);
    }
    if (!A || !B) continue;
    const ka = AP_ALIAS[f.dep] || f.dep, kb = AP_ALIAS[f.arr] || f.arr;
    if (ka === kb) continue;
    const key = ka < kb ? ka + '|' + kb : kb + '|' + ka;
    const r = routes.get(key) || { a: [A[1], A[0]], b: [B[1], B[0]], ka: ka < kb ? ka : kb, kb: ka < kb ? kb : ka, n: 0, fam: {} };
    r.n++; const fm = familyOf(f.type); r.fam[fm] = (r.fam[fm] || 0) + 1; routes.set(key, r);
    const d = d3.geoDistance([A[1], A[0]], [B[1], B[0]]) * NM; dist += d;
    if (!longest || d > longest.d) longest = { d, f };
  }
  for (const r of routes.values()) r.main = Object.entries(r.fam).sort((a, b) => b[1] - a[1])[0][0];
  const topAp = [...aps.values()].sort((a, b) => b.n - a.n);
  const topRt = [...routes.values()].sort((a, b) => b.n - a.n);
  const fmt = n => Math.round(n).toLocaleString('en-GB');

  main.innerHTML = `<div class="row" style="justify-content:space-between;align-items:baseline"><h1>Map</h1>
    <div class="row filters" style="margin:0">
      <select id="mPer" aria-label="Period"><option value="all">Whole career</option><option value="12m">Last 12 months</option>${years.map(y => `<option>${y}</option>`).join('')}</select>
      <select id="mFam" aria-label="Family"><option value="">All families</option>${fams.map(f => `<option>${esc(f)}</option>`).join('')}</select>
    </div></div>
  <div class="map-wrap" id="mapWrap"><canvas id="mapCv" aria-label="Flight map"></canvas><div class="map-zoom"><button type="button" data-z="in" aria-label="Zoom in">+</button><button type="button" data-z="out" aria-label="Zoom out">−</button><button type="button" data-z="reset" aria-label="Reset view">⟲</button></div><div class="map-tip" id="mapTip" hidden></div>
    <div class="map-legend">${fams.filter(f => !st.fam || f === st.fam).map(f => `<span><i style="background:var(${FAM_VAR[f] || '--muted'})"></i>${esc(f)}</span>`).join('')}</div></div>
  <p class="lede">${list.length} sectors on ${routes.size} routes. Drag to move, pinch or + / − to zoom; tap an airport to identify it, tap again for its flights.</p>
  <div class="recency">
    <div><b>${aps.size}</b><span>airports</span></div>
    <div><b>${countries.size}</b><span>countries</span></div>
    <div><b>${fmt(dist)} NM</b><span>great-circle distance, ${(dist / (2 * Math.PI * NM)).toFixed(1)} × around the world</span></div>
    <div><b>${longest ? `${esc(longest.f.dep)}–${esc(longest.f.arr)}` : '—'}</b><span>${longest ? `longest sector, ${fmt(longest.d)} NM on ${dmy(longest.f.date)}` : ''}</span></div>
    <div><b>${topAp[0] ? esc(topAp[0].code) : '—'}</b><span>${topAp[0] ? `most visited airport, ${topAp[0].n} movements` : ''}</span></div>
  </div>
  ${unknown.size ? `<p class="hint">Unknown codes, not shown on the map: ${[...unknown].map(([c, n]) => `<a href="#voli" data-q="${esc(c)}">${esc(c)}</a> (${n})`).join(', ')}. Correct them in Flights if they are typos.</p>` : ''}
  <div class="two">
    <div><h2>Top airports</h2><table class="data"><thead><tr><th class="l">ICAO</th><th class="l">Airport</th><th class="l">Country</th><th>Movements</th></tr></thead>
      <tbody>${topAp.slice(0, 12).map(a => `<tr class="click" data-q="${a.code}"><td class="l"><b>${a.code}</b></td><td class="l">${esc(a.name)}</td><td class="l">${esc(regionName(a.cc))}</td><td>${a.n}</td></tr>`).join('')}</tbody></table></div>
    <div><h2>Top routes</h2><table class="data"><thead><tr><th class="l">Route</th><th class="l">Family</th><th>Distance</th><th>Sectors</th></tr></thead>
      <tbody>${topRt.slice(0, 12).map(r => `<tr class="click" data-q="${r.ka}"><td class="l"><b>${r.ka} ⇄ ${r.kb}</b></td><td class="l"><i class="dot" style="background:var(${FAM_VAR[r.main] || '--muted'})"></i> ${esc(r.main)}</td><td>${fmt(d3.geoDistance(r.a, r.b) * NM)} NM</td><td>${r.n}</td></tr>`).join('')}</tbody></table></div>
  </div>`;

  $('#mPer').value = st.period; $('#mFam').value = st.fam;
  $('#mPer').onchange = e => { st.period = e.target.value; viewMap(main); };
  $('#mFam').onchange = e => { st.fam = e.target.value; viewMap(main); };
  main.querySelectorAll('input[name=mMode]').forEach(r => r.onchange = () => { st.mode = r.value; st.k = 1; draw(); });
  main.querySelectorAll('[data-q]').forEach(el => el.addEventListener('click', e => { e.preventDefault(); viewFlights.st = { year: '', type: '', q: el.dataset.q, all: false }; location.hash = 'voli'; }));

  // ---------- disegno su canvas ----------
  const wrap = $('#mapWrap'), cv = $('#mapCv'), ctx = cv.getContext('2d'), tip = $('#mapTip');
  const routeArr = [...routes.values()].sort((a, b) => a.n - b.n);
  const apArr = topAp.slice().reverse();
  const maxN = Math.max(1, ...apArr.map(a => a.n));
  let W = 0, H = 0, C = 1, proj, path, raf = 0;

  function css(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim() || '#888'; }
  function setup() {
    const dpr = window.devicePixelRatio || 1;
    W = wrap.clientWidth; H = st.mode === 'globe' ? Math.min(680, Math.max(420, W * 0.62)) : Math.round(Math.max(W * 0.52, Math.min(innerHeight - 150, W * 1.25)));
    cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (st.mode === 'globe') proj = d3.geoOrthographic().clipAngle(90).translate([W / 2, H / 2]).scale((H / 2 - 12) * st.k).rotate(st.rot);
    else proj = d3.geoNaturalEarth1().rotate([st.rot[0], 0, 0]).fitExtent([[8, 8], [W - 8, H - 8]], { type: 'Sphere' }).precision(.3);
    if (st.mode === 'flat') {
      // sullo schermo verticale il planisfero riempie tutta l'altezza (si scorre di lato), invece di restare una striscia in mezzo
      const bb = d3.geoPath(proj).bounds({ type: 'Sphere' }); C = Math.max(1, (H - 16) / (bb[1][1] - bb[0][1]));
      const s = proj.scale(), t = proj.translate(), kk = st.k * C; proj.scale(s * kk).translate([W / 2 + (t[0] - W / 2) * kk, H / 2 + (t[1] - H / 2) * kk - (st.panY || 0)]);
    }
    path = d3.geoPath(proj, ctx);
  }
  let fast = false, fullTimer = 0;
  function draw() {
    setup();
    const C = { ocean: css('--map-ocean'), land: css('--map-land'), border: css('--map-border'), grid: css('--rule-soft'), ink: css('--ink'), sheet: css('--sheet') };
    ctx.clearRect(0, 0, W, H);
    ctx.beginPath(); path({ type: 'Sphere' }); ctx.fillStyle = C.ocean; ctx.fill();
    ctx.beginPath(); path(d3.geoGraticule10()); ctx.strokeStyle = C.grid; ctx.lineWidth = .5; ctx.stroke();
    ctx.beginPath(); path(fast ? MAP.landLite : MAP.land); ctx.fillStyle = C.land; ctx.fill();
    if (!fast) { ctx.beginPath(); path(MAP.borders); ctx.strokeStyle = C.border; ctx.lineWidth = .5; ctx.stroke(); }
    ctx.beginPath(); path({ type: 'Sphere' }); ctx.strokeStyle = C.border; ctx.lineWidth = 1; ctx.stroke();
    // rotte
    ctx.lineCap = 'round';
    for (const r of routeArr) {
      ctx.beginPath(); path({ type: 'LineString', coordinates: [r.a, r.b] });
      ctx.strokeStyle = css(FAM_VAR[r.main] || '--muted');
      ctx.globalAlpha = Math.min(.95, .45 + Math.log2(r.n + 1) * .12);
      ctx.lineWidth = Math.min(4, .9 + Math.log2(r.n) * .55); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // aeroporti
    const center = proj.invert ? proj.invert([W / 2, H / 2]) : null;
    for (const a of apArr) {
      if (st.mode === 'globe' && d3.geoDistance([a.lon, a.lat], [-st.rot[0], -st.rot[1]]) > Math.PI / 2 - .01) { a.xy = null; continue; }
      const p = proj([a.lon, a.lat]); if (!p) { a.xy = null; continue; }
      a.xy = p; const rad = 1.8 + 4.2 * Math.sqrt(a.n / maxN);
      ctx.beginPath(); ctx.arc(p[0], p[1], rad, 0, 2 * Math.PI);
      ctx.fillStyle = C.sheet; ctx.fill(); ctx.lineWidth = 1.4; ctx.strokeStyle = C.ink; ctx.stroke();
    }
    // etichette dei più frequenti
    ctx.font = '600 11px B612, sans-serif'; ctx.fillStyle = C.ink; ctx.textBaseline = 'middle';
    const boxes = [], maxLab = st.k > 12 ? 300 : st.k > 4 ? 80 : st.k > 2 ? 30 : 14;
    for (const a of topAp) {
      if (!a.xy || boxes.length >= maxLab) continue;
      const bx = [a.xy[0] + 6, a.xy[1] - 13, a.xy[0] + 40, a.xy[1] + 1];
      if (boxes.some(b => bx[0] < b[2] && bx[2] > b[0] && bx[1] < b[3] && bx[3] > b[1])) continue;
      boxes.push(bx);
      ctx.lineWidth = 3; ctx.strokeStyle = C.ocean; ctx.strokeText(a.code, a.xy[0] + 7, a.xy[1] - 6); ctx.fillText(a.code, a.xy[0] + 7, a.xy[1] - 6);
    }
    void center;
  }
  const redraw = () => { fast = true; cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); clearTimeout(fullTimer); fullTimer = setTimeout(() => { fast = false; raf = requestAnimationFrame(draw); }, 180); };
  draw();

  // ---------- interazione: trascina per spostare, due dita o rotella per lo zoom, pulsanti + / − ----------
  const pts = new Map(); let drag = null, pinch = null;
  // zoom intorno a un punto (dita, cursore o centro): il punto sotto le dita resta fermo
  const MAXK = 80;
  const clampPan = () => { const lim = H * (st.k - 1) / 2 + (st.k > 1 ? H * 0.1 : 0); st.panY = Math.max(-lim, Math.min(lim, st.panY || 0)); };
  const zoomAt = (k2, fx, fy, b = { k: st.k, rot: st.rot, panY: st.panY || 0 }, ll = proj.invert?.([fx, fy])) => {
    k2 = Math.max(1, Math.min(MAXK, k2));
    st.rot = [b.rot[0] - (fx - W / 2) * (k2 / b.k - 1) * 180 / (W * k2 * C), 0, 0];
    st.panY = (fy - H / 2 + b.panY) * k2 / b.k - (fy - H / 2);
    st.k = k2; if (k2 === 1) st.panY = 0; clampPan();
    // correzione esatta: il punto geografico che era sotto le dita torna sotto le dita
    if (ll && isFinite(ll[0])) for (let i = 0; i < 2; i++) { setup(); const p = proj(ll); if (!p) break; st.rot[0] += (fx - p[0]) * 180 / (W * st.k * C); if (st.k > 1) { st.panY += p[1] - fy; clampPan(); } }
    redraw();
  };
  const zoomTo = k => zoomAt(k, W / 2, H / 2);
  const local = (x, y) => { const r = cv.getBoundingClientRect(); return [x - r.left, y - r.top]; };
  const nearest = (x, y, max = 400) => { let best = null, bd = max; for (const a of apArr) if (a.xy) { const d = (a.xy[0] - x) ** 2 + (a.xy[1] - y) ** 2; if (d < bd) { bd = d; best = a; } } return best; };
  const showTip = (a, x, y) => { tip.hidden = false; tip.innerHTML = `<b>${a.code}</b> ${esc(a.name)}<br>${esc(regionName(a.cc))}, ${a.n} movements`; tip.style.left = Math.max(4, Math.min(W - 224, x + 14)) + 'px'; tip.style.top = (y + 14) + 'px'; cv.dataset.q = a.code; };
  cv.onpointerdown = e => {
    cv.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 2) { const [p, q] = [...pts.values()]; pinch = { d: Math.hypot(p[0] - q[0], p[1] - q[1]) || 1, m: local((p[0] + q[0]) / 2, (p[1] + q[1]) / 2), b: { k: st.k, rot: st.rot.slice(), panY: st.panY || 0 } }; pinch.ll = proj.invert?.(pinch.m); drag = null; tip.hidden = true; }
    else if (pts.size === 1) drag = { x: e.clientX, y: e.clientY, rot: st.rot.slice(), panY: st.panY || 0, moved: false };
  };
  cv.onpointermove = e => {
    if (pts.has(e.pointerId)) pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pinch && pts.size === 2) {
      const [p, q] = [...pts.values()], m = local((p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
      const k2 = Math.max(1, Math.min(MAXK, pinch.b.k * Math.hypot(p[0] - q[0], p[1] - q[1]) / pinch.d));
      // zoom attorno al punto iniziale tra le dita, poi spostamento se le dita si muovono insieme
      const b = { ...pinch.b, rot: [pinch.b.rot[0] + (m[0] - pinch.m[0]) * 180 / (W * pinch.b.k * C), 0, 0], panY: pinch.b.panY - (m[1] - pinch.m[1]) };
      zoomAt(k2, m[0], m[1], b, pinch.ll); return;
    }
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      if (drag.moved) { tip.hidden = true; st.rot = [drag.rot[0] + dx * (180 / (W * st.k * C)), 0, 0]; st.panY = st.k > 1 ? drag.panY - dy : 0; clampPan(); redraw(); }
      return;
    }
    if (e.pointerType !== 'mouse') return;
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, a = nearest(x, y, 100);
    if (a) { showTip(a, x, y); cv.style.cursor = 'pointer'; } else { tip.hidden = true; cv.style.cursor = 'grab'; delete cv.dataset.q; }
  };
  const up = e => {
    pts.delete(e.pointerId);
    if (pinch) { if (pts.size < 2) pinch = null; drag = null; return; }
    const tap = drag && !drag.moved; drag = null;
    if (!tap) return;
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (e.pointerType === 'mouse') { if (cv.dataset.q) { viewFlights.st = { year: '', type: '', q: cv.dataset.q, all: false }; location.hash = 'voli'; } return; }
    // al tocco: primo tocco mostra l'aeroporto, secondo tocco sullo stesso apre i voli
    const a = nearest(x, y);
    if (!a) { tip.hidden = true; delete cv.dataset.q; return; }
    if (!tip.hidden && cv.dataset.q === a.code) { viewFlights.st = { year: '', type: '', q: a.code, all: false }; location.hash = 'voli'; return; }
    showTip(a, x, y);
  };
  cv.onpointerup = up; cv.onpointercancel = up;
  cv.onpointerleave = e => { if (e.pointerType === 'mouse') tip.hidden = true; };
  cv.addEventListener('wheel', e => { e.preventDefault(); const [x, y] = local(e.clientX, e.clientY); zoomAt(st.k * Math.exp(-e.deltaY * .0015), x, y); }, { passive: false });
  cv.ondblclick = () => { st.rot = [-12, 0, 0]; st.k = 1; st.panY = 0; redraw(); };
  wrap.querySelector('.map-zoom').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.z === 'in') zoomTo(st.k * 1.6); else if (b.dataset.z === 'out') zoomTo(st.k / 1.6); else { st.rot = [-12, 0, 0]; st.k = 1; st.panY = 0; redraw(); }
  };
  const ro = new ResizeObserver(() => redraw()); ro.observe(wrap);
  window.addEventListener('hashchange', () => ro.disconnect(), { once: true });
}
