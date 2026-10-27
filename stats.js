'use strict';
/* Statistics: grafici SVG semplici, colori presi dal tema (PIC, SIC, dual, famiglie). */

const STAT_PERIODS = [['all', 'All'], ['12m', '12M'], ['year', 'Year'], ['month', 'Month'], ['90d', '90D'], ['30d', '30D']];
function statRange(p) {
  const td = today();
  if (p === '12m') return [addDays(td, -365), td];
  if (p === 'year') return [td.slice(0, 4) + '-01-01', td];
  if (p === 'month') return [td.slice(0, 7) + '-01', td];
  if (p === '90d') return [addDays(td, -89), td];
  if (p === '30d') return [addDays(td, -29), td];
  return ['', td];
}
const cssv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const hShort = m => { const h = Math.floor(m / 60); return h >= 1000 ? (h / 1000).toFixed(h >= 10000 ? 0 : 1) + 'k h' : h + ' h'; };
const niceMax = m => { const v = m / 60; if (v <= 0) return 60; const p = 10 ** Math.floor(Math.log10(v)); for (const k of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (k * p >= v) return k * p * 60; return 10 * p * 60; };
const dmyShort = d => { const [y, m] = d.split('-'); return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m - 1]} ${y.slice(2)}`; };

function viewStats(main) {
  const per = viewStats.per ||= 'all';
  const [from, to] = statRange(per);
  const all = data.flights.filter(f => !f.planned && f.date <= to).sort((a, b) => (a.date + (a.out || '')).localeCompare(b.date + (b.out || '')));
  const list = all.filter(f => !from || f.date >= from);
  const fl = list.filter(f => f.kind === 'flight');
  // "All" come nel Summary: con le ore portate avanti prima del 2007
  const withOpen = per === 'all' && !!data.opening?.total;
  const t = sum(list, withOpen), tLog = sum(list);
  const day = Math.max(0, t.total - t.night);

  main.innerHTML = `<h1>Statistics</h1>
  <div class="chips-row" role="radiogroup" aria-label="Period">${STAT_PERIODS.map(([k, l]) => `<button type="button" class="pchip ${k === per ? 'on' : ''}" data-p="${k}" role="radio" aria-checked="${k === per}">${l}</button>`).join('')}
    <span class="hint">${from ? `${dmy(from)} – ${dmy(to)}` : 'Whole career' + (withOpen ? `, including ${hm0(data.opening.total)} brought forward before 2007` : '')}</span></div>
  <div class="stat-tiles">
    <div><b>${hm0(t.total)}</b><span>block time</span></div>
    <div><b>${fmtN(t.legs)}</b><span>sectors</span></div>
    <div><b>${fl.length ? avg(tLog) : '—'}</b><span>average sector</span></div>
    <div><b>${t.total ? Math.round(t.night / t.total * 100) : 0}%</b><span>night</span></div>
    <div><b>${t.ldgDay + t.ldgNight}</b><span>landings</span></div>
    <div><b>${fmtN(t.nm * 1.852)} km</b><small class="nm">${fmtN(t.nm)} NM</small><span>distance flown</span></div>
  </div>
  ${fl.length ? `
  <section class="chart-card"><h2>Cumulative hours</h2><div class="chart" id="chCum"></div></section>
  <section class="chart-card"><h2>Year comparison</h2><p class="hint">Cumulative block time month by month, current year highlighted.</p><div class="chart" id="chYears"></div></section>
  <section class="chart-card"><h2>${per === 'all' ? 'Hours per year' : 'Hours per month'}</h2><div class="chart" id="chBars"></div></section>
  <div class="chart-two">
    <section class="chart-card"><h2>Day / Night</h2><div class="chart donut-box" id="chDN"></div></section>
    <section class="chart-card"><h2>Pilot function</h2><div class="chart donut-box" id="chFn"></div></section>
  </div>
  <section class="chart-card"><h2>Aircraft family</h2><div id="chFam"></div></section>` : '<p class="lede">No flights in this period.</p>'}`;

  main.querySelectorAll('.pchip').forEach(b => b.onclick = () => { viewStats.per = b.dataset.p; viewStats(main); });
  if (!fl.length) return;

  // ---- ore cumulative (con "All" parte dalle ore portate avanti)
  {
    let acc = withOpen ? data.opening.total : 0; const pts = withOpen ? [[list[0].date, acc]] : [];
    for (const f of list) { acc += f.kind === 'sim' ? 0 : f.total; pts.push([f.date, acc]); }
    const dense = []; for (const p of pts) { if (dense.length && dense.at(-1)[0] === p[0]) dense[dense.length - 1] = p; else dense.push(p); }
    lineChart($('#chCum'), [{ name: 'Block time', color: cssv('--accent'), pts: dense.map(([d, v]) => [dayNum(d), v, d]) }], {
      x0: dayNum(from || dense[0][0]), x1: dayNum(to), xLabel: x => dmyShort(dayStr(x)), area: true
    });
  }
  // ---- confronto anni: ultimi 5 anni del periodo
  {
    const yEnd = +to.slice(0, 4), ys = [];
    for (let y = yEnd; y > yEnd - 5; y--) if (all.some(f => f.date.startsWith(y))) ys.push(y);
    const grey = cssv('--muted'), series = ys.reverse().map((y, i) => {
      let acc = 0; const pts = [[0, 0, `${y}-01-01`]];
      for (let m = 1; m <= 12; m++) {
        const mm = String(m).padStart(2, '0'); if (`${y}-${mm}` > to.slice(0, 7)) break;
        acc += sum(all.filter(f => f.date.startsWith(`${y}-${mm}`))).total; pts.push([m, acc, `${y}-${mm}`]);
      }
      const cur = y === yEnd, prev = y === yEnd - 1;
      return { name: String(y), color: cur ? cssv('--accent') : prev ? cssv('--fam3') : grey, width: cur ? 3 : 2, dim: !cur && !prev, pts, label: `${y} ${hShort(acc)}` };
    });
    lineChart($('#chYears'), series, { x0: 0, x1: 12, ticks: [...Array(12)].map((_, i) => [i + 0.5, 'JFMAMJJASOND'[i]]), xTip: x => ['Start', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Math.round(x)], legend: true });
  }
  // ---- ore per anno (All) o per mese (altri periodi)
  {
    const groups = new Map();
    const key = per === 'all' ? f => f.date.slice(0, 4) : f => f.date.slice(0, 7);
    if (per !== 'all') { let d = (from || list[0].date).slice(0, 7); while (d <= to.slice(0, 7)) { groups.set(d, 0); const [y, m] = d.split('-').map(Number); d = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; } }
    for (const f of fl) groups.set(key(f), (groups.get(key(f)) || 0) + f.total);
    barChart($('#chBars'), [...groups].map(([k, v]) => [per === 'all' ? k : dmyShort(k + '-01'), v]));
  }
  // ---- giorno/notte e funzione
  donut($('#chDN'), [['Day', day, cssv('--dual')], ['Night', t.night, cssv('--sic')]], hm0(t.total), 'total');
  const picus = fl.filter(f => f.pic && /picus/i.test(f.remarks)).reduce((a, f) => a + f.total, 0);
  const lifus = fl.filter(f => f.sic && /lifus/i.test(f.remarks)).reduce((a, f) => a + f.total, 0);
  donut($('#chFn'), [['PIC', t.pic - picus, cssv('--accent')], ['PICUS', picus, cssv('--fam3')], ['SIC', t.sic - lifus, cssv('--sic')], ['LIFUS', lifus, cssv('--fam5')], ['Dual', t.dual, cssv('--dual')]].filter(r => r[1] > 0), hm0(t.pic + t.sic + t.dual), 'function time');
  // ---- famiglie: barre orizzontali
  {
    const fam = {}; for (const f of fl) { const k = familyOf(f.type); (fam[k] ||= { t: 0, n: 0 }); fam[k].t += f.total; fam[k].n++; }
    const rows = Object.entries(fam).sort((a, b) => b[1].t - a[1].t), mx = rows[0][1].t;
    $('#chFam').innerHTML = `<div class="hbars">${rows.map(([k, v]) => `<div class="hb" title="${esc(k)}: ${hm0(v.t)} in ${v.n} sectors"><span class="hb-k">${esc(k)}</span><span class="hb-bar"><i style="width:${Math.max(0.6, v.t / mx * 100)}%"></i></span><span class="hb-v">${hm0(v.t)}</span><span class="hb-n">${fmtN(v.n)} sectors</span></div>`).join('')}</div>`;
  }
}
const dayNum = d => Math.round(Date.parse(d + 'T00:00:00Z') / 864e5);
const dayStr = n => new Date(n * 864e5).toISOString().slice(0, 10);

// ---------- grafico a linee con crosshair e tooltip
function lineChart(box, series, o) {
  const W = Math.max(320, box.clientWidth || 700), H = Math.round(Math.min(320, Math.max(220, W * 0.36))), L = 52, R = o.legend ? 92 : 16, T = 12, B = 28;
  const ymax = niceMax(Math.max(...series.flatMap(s => s.pts.map(p => p[1]))));
  const X = x => L + (x - o.x0) / ((o.x1 - o.x0) || 1) * (W - L - R), Y = y => T + (1 - y / ymax) * (H - T - B);
  const grid = [0, 0.5, 1].map(k => `<line x1="${L}" x2="${W - R}" y1="${Y(ymax * k)}" y2="${Y(ymax * k)}" class="gl"/><text x="${L - 8}" y="${Y(ymax * k) + 4}" class="ax" text-anchor="end">${hShort(ymax * k)}</text>`).join('');
  let ticks = '';
  if (o.ticks) ticks = o.ticks.map(([x, l]) => `<text x="${X(x)}" y="${H - 8}" class="ax" text-anchor="middle">${l}</text>`).join('');
  else ticks = `<text x="${L}" y="${H - 8}" class="ax">${o.xLabel(o.x0)}</text><text x="${W - R}" y="${H - 8}" class="ax" text-anchor="end">${o.xLabel(o.x1)}</text>`;
  const path = s => s.pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
  const lines = series.map(s => `${o.area ? `<path d="${path(s)}L${X(s.pts.at(-1)[0])},${Y(0)}L${X(s.pts[0][0])},${Y(0)}Z" fill="${s.color}" opacity=".12"/>` : ''}<path d="${path(s)}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2}" stroke-linejoin="round" stroke-linecap="round" ${s.dim ? 'opacity=".55"' : ''}/>`).join('');
  // etichette a fine linea, spostate per non sovrapporsi
  let labs = '';
  if (o.legend) {
    const ends = series.map(s => ({ s, y: Y(s.pts.at(-1)[1]), x: X(s.pts.at(-1)[0]) })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;
    labs = ends.map(e => `<circle cx="${e.x}" cy="${Y(e.s.pts.at(-1)[1])}" r="3.5" fill="${e.s.color}" stroke="var(--sheet)" stroke-width="2"/><text x="${W - R + 8}" y="${e.y + 4}" class="lab" ${e.s.dim ? 'opacity=".7"' : ''}><tspan fill="${e.s.color}">●</tspan> ${e.s.label}</text>`).join('');
  }
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="${esc(series.map(s => s.name).join(', '))}">${grid}${lines}${labs}${ticks}<line class="xh" y1="${T}" y2="${H - B}" style="display:none"/><g class="dots"></g><rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent"/></svg><div class="ctip" hidden></div>`;
  const svg = box.querySelector('svg'), xh = svg.querySelector('.xh'), dots = svg.querySelector('.dots'), tip = box.querySelector('.ctip');
  const move = e => {
    const r = svg.getBoundingClientRect(), px = (e.clientX - r.left) * W / r.width;
    const xv = o.x0 + (px - L) / (W - L - R) * (o.x1 - o.x0);
    const near = series.map(s => { let best = s.pts[0]; for (const p of s.pts) if (Math.abs(p[0] - xv) < Math.abs(best[0] - xv)) best = p; return [s, best]; });
    const xs = X(near[0][1][0]); xh.setAttribute('x1', xs); xh.setAttribute('x2', xs); xh.style.display = '';
    dots.innerHTML = near.map(([s, p]) => `<circle cx="${X(p[0])}" cy="${Y(p[1])}" r="4.5" fill="${s.color}" stroke="var(--sheet)" stroke-width="2"/>`).join('');
    const head = o.xTip ? o.xTip(near[0][1][0]) : dmy(near[0][1][2]);
    tip.innerHTML = `<b>${head}</b>${near.slice().reverse().map(([s, p]) => `<div><i style="background:${s.color}"></i>${series.length > 1 ? esc(s.name) + ' ' : ''}<b>${hm0(p[1])}</b></div>`).join('')}`;
    tip.hidden = false; const tx = xs / W * r.width; tip.style.left = Math.min(r.width - tip.offsetWidth - 4, Math.max(4, tx + 12)) + 'px';
  };
  svg.addEventListener('pointermove', move); svg.addEventListener('pointerdown', move);
  svg.addEventListener('pointerleave', () => { xh.style.display = 'none'; dots.innerHTML = ''; tip.hidden = true; });
}

// ---------- barre verticali
function barChart(box, rows) {
  const W = Math.max(320, box.clientWidth || 700), H = 220, L = 46, R = 8, T = 16, B = 26;
  const mx = niceMax(Math.max(...rows.map(r => r[1]), 1)), n = rows.length, bw = (W - L - R) / n;
  const Y = v => T + (1 - v / mx) * (H - T - B);
  const every = Math.ceil(n / Math.floor((W - L - R) / 44));
  const best = rows.reduce((a, r) => r[1] > a[1] ? r : a, rows[0]);
  const bars = rows.map(([k, v], i) => { const x = L + i * bw + Math.min(2, bw * 0.1), w = Math.max(1, bw - Math.min(4, bw * 0.2)), h = Y(0) - Y(v);
    return `<g><title>${k}: ${hm0(v)}</title><rect x="${L + i * bw}" y="${T}" width="${bw}" height="${H - T - B}" fill="transparent"/>${v ? `<path d="M${x},${Y(0)}V${Y(v) + Math.min(4, h)}q0,-${Math.min(4, h)} ${Math.min(4, w / 2)},-${Math.min(4, h)}H${x + w - Math.min(4, w / 2)}q${Math.min(4, w / 2)},0 ${Math.min(4, w / 2)},${Math.min(4, h)}V${Y(0)}Z" fill="var(--accent)"/>` : ''}
      ${i % every === 0 ? `<text x="${L + i * bw + bw / 2}" y="${H - 8}" class="ax" text-anchor="middle">${k}</text>` : ''}${k === best[0] && v ? `<text x="${L + i * bw + bw / 2}" y="${Y(v) - 4}" class="lab" text-anchor="middle">${hShort(v)}</text>` : ''}</g>`; }).join('');
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Hours per period">${[0, 0.5, 1].map(k => `<line x1="${L}" x2="${W - R}" y1="${Y(mx * k)}" y2="${Y(mx * k)}" class="gl"/><text x="${L - 8}" y="${Y(mx * k) + 4}" class="ax" text-anchor="end">${hShort(mx * k)}</text>`).join('')}${bars}</svg>`;
}

// ---------- ciambella con legenda
function donut(box, parts, center, sub) {
  const tot = parts.reduce((a, p) => a + p[1], 0) || 1, R = 70, r = 50, C = 90;
  let a0 = -Math.PI / 2;
  const segs = parts.map(([k, v, c]) => {
    const a1 = a0 + v / tot * Math.PI * 2, gap = parts.length > 1 ? 0.012 : 0, s = a0 + gap, e = Math.max(s, a1 - gap), big = e - s > Math.PI ? 1 : 0;
    const P = (rad, a) => `${(C + rad * Math.cos(a)).toFixed(2)},${(C + rad * Math.sin(a)).toFixed(2)}`;
    const d = v / tot > 0.9999 ? `M${C},${C - R}A${R},${R} 0 1 1 ${C - 0.01},${C - R}L${C - 0.01},${C - r}A${r},${r} 0 1 0 ${C},${C - r}Z` : `M${P(R, s)}A${R},${R} 0 ${big} 1 ${P(R, e)}L${P(r, e)}A${r},${r} 0 ${big} 0 ${P(r, s)}Z`;
    a0 = a1; return `<path d="${d}" fill="${c}"><title>${k}: ${hm0(v)} (${Math.round(v / tot * 100)}%)</title></path>`;
  }).join('');
  box.innerHTML = `<svg viewBox="0 0 180 180" width="180" height="180" role="img" aria-label="${esc(parts.map(p => `${p[0]} ${Math.round(p[1] / tot * 100)}%`).join(', '))}">${segs}<text x="90" y="92" class="dc" text-anchor="middle">${center}</text><text x="90" y="110" class="ax" text-anchor="middle">${sub}</text></svg>
    <ul class="dleg">${parts.map(([k, v, c]) => `<li><i style="background:${c}"></i>${k}<b>${hm0(v)}</b><span>${Math.round(v / tot * 100)}%</span></li>`).join('')}</ul>`;
}
