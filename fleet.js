'use strict';
/* Aircraft: tutte le marche volate o registrate, per famiglia, più i simulatori; si possono aggiungere nuovi aerei e simulatori. */
const FLEET_COL = { 'Dornier 328': '--fam5', 'Piaggio P180': '--fam1', 'Boeing 747': '--fam2', 'Boeing 787': '--fam3', 'Boeing 737': '--fam4' };
function viewFleet(main) {
  const st = viewFleet.st ||= { q: '', add: false, kind: 'ac' };
  const regs = knownRegs(), td = today(), recent = addDays(td, -90);
  const stats = new Map();
  for (const f of data.flights) {
    if (f.planned) continue;
    const k = f.kind === 'sim' ? 'S|' + (f.simReg || '') : 'A|' + (f.reg || '');
    if (k.length < 3) continue;
    const s = stats.get(k) || { n: 0, t: 0, last: '' };
    s.n++; s.t += f.kind === 'sim' ? f.sim || 0 : f.total || 0; if (f.date > s.last) s.last = f.date; stats.set(k, s);
  }
  const ac = [...regs].filter(([r]) => r && r !== 'SIM').map(([reg, type]) => ({ reg, type, fam: familyOf(type), s: stats.get('A|' + reg) || { n: 0, t: 0, last: '' }, mine: !!data.aircraft?.[reg] }));
  const sims = Object.entries(simFleet()).map(([reg, type]) => ({ reg, type, note: SIM_NOTES[reg] || data.simulators?.[reg]?.note || '', s: stats.get('S|' + reg) || { n: 0, t: 0, last: '' } }));
  const q = st.q.trim().toUpperCase(), hit = x => !q || `${x.reg} ${x.type} ${x.fam || ''} ${x.note || ''}`.toUpperCase().includes(q);
  const fams = new Map(); for (const a of ac.filter(hit)) (fams.get(a.fam) || fams.set(a.fam, []).get(a.fam)).push(a);
  const famList = [...fams].map(([fam, list]) => ({ fam, list: list.sort((a, b) => b.s.last.localeCompare(a.s.last) || a.reg.localeCompare(b.reg)), last: list.reduce((m, a) => a.s.last > m ? a.s.last : m, ''), t: list.reduce((m, a) => m + a.s.t, 0) })).sort((a, b) => b.last.localeCompare(a.last));
  const types = [...new Set([...TYPE_ORDER, ...ac.map(a => a.type)].filter(Boolean))];
  const card = (x, sim) => `<button type="button" class="ac-card" data-reg="${esc(x.reg)}" data-sim="${sim ? 1 : ''}">
      <span class="ac-ico" style="${sim ? '' : `--c:var(${FLEET_COL[x.fam] || '--muted'})`}">${sim ? '🎮' : '✈︎'}</span>
      <span class="ac-main"><small>${x.s.n ? `${x.s.n} ${sim ? 'session' : 'flight'}${x.s.n > 1 ? 's' : ''} · ${hm0(x.s.t)}${x.s.last ? ` · last ${dmy(x.s.last)}` : ''}` : sim ? 'no sessions' : 'not flown yet'}</small>
        <b>${esc(x.reg)}</b><span class="ac-type">${esc(sim ? x.type || '—' : easaModel(x.type) || '—')}${x.note ? ` · ${esc(x.note)}` : ''}</span></span>
      ${!sim && x.s.last >= recent ? '<span class="ac-cur">current</span>' : ''}${x.mine && !x.s.n ? '<span class="ac-cur new">added</span>' : ''}</button>`;
  main.innerHTML = `<h1>Aircraft</h1>
  <p class="lede">${ac.length} aircraft · ${sims.length} simulators. Tap one to see its flights.</p>
  <div class="fleet-bar"><input type="search" id="fq" placeholder="Search registration or type" value="${esc(st.q)}" autocapitalize="characters"><button type="button" class="btn primary" id="fAdd">+ Add</button></div>
  <form class="panel fleet-add" id="fForm" ${st.add ? '' : 'hidden'}>
    <div class="seg-mini" role="radiogroup"><button type="button" data-k="ac" class="${st.kind === 'ac' ? 'on' : ''}">Aircraft</button><button type="button" data-k="sim" class="${st.kind === 'sim' ? 'on' : ''}">Simulator</button></div>
    <div class="row" style="margin:12px 0 0">
      <label>Registration <input id="nReg" placeholder="${st.kind === 'sim' ? 'I-T.081' : 'EI-RZI'}" autocapitalize="characters" autocomplete="off" spellcheck="false" required></label>
      <label>Type <input id="nType" list="nTypes" placeholder="${st.kind === 'sim' ? 'BOEING 737-800' : 'B737-8'}" autocapitalize="characters" required></label>
      ${st.kind === 'sim' ? '<label>Note <input id="nNote" placeholder="B737-8 MAX s/n …"></label>' : ''}
      <button class="btn primary" type="submit">Save</button><button class="btn" type="button" id="fCancel">Cancel</button></div>
    <datalist id="nTypes">${(st.kind === 'sim' ? [...new Set([...KNOWN_SIMS, ...Object.values(simFleet())])] : types).map(t => `<option>${esc(t)}</option>`).join('')}</datalist>
  </form>
  ${famList.map(g => `<section class="fleet-fam"><h2><i style="background:var(${FLEET_COL[g.fam] || '--muted'})"></i>${esc(g.fam)}<small>${g.list.length} aircraft · ${hm0(g.t)}</small></h2><div class="ac-grid">${g.list.map(a => card(a)).join('')}</div></section>`).join('')}
  ${sims.filter(hit).length ? `<section class="fleet-fam"><h2><i style="background:var(--muted)"></i>Simulators<small>${sims.length} FSTD</small></h2><div class="ac-grid">${sims.filter(hit).sort((a, b) => b.s.last.localeCompare(a.s.last)).map(s => card(s, true)).join('')}</div></section>` : ''}`;
  let deb; $('#fq').oninput = e => { clearTimeout(deb); deb = setTimeout(() => { st.q = e.target.value; viewFleet(main); const i = $('#fq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); };
  $('#fAdd').onclick = () => { st.add = true; viewFleet(main); $('#nReg').focus(); };
  if ($('#fCancel')) $('#fCancel').onclick = () => { st.add = false; viewFleet(main); };
  main.querySelectorAll('.fleet-add .seg-mini button').forEach(b => b.onclick = () => { st.kind = b.dataset.k; viewFleet(main); $('#nReg').focus(); });
  $('#fForm').onsubmit = async e => {
    e.preventDefault();
    const reg = $('#nReg').value.trim().toUpperCase(), type = $('#nType').value.trim().toUpperCase().replace(/^B(\d)/, 'B$1');
    if (!/^[A-Z0-9][A-Z0-9 ./-]{2,24}$/.test(reg)) { toast('Registration not valid'); return; }
    if (!type) { toast('Type missing'); return; }
    if (st.kind === 'sim') { (data.simulators ||= {})[reg] = { type, ...($('#nNote')?.value.trim() ? { note: $('#nNote').value.trim().toUpperCase() } : {}) }; }
    else { const t = types.find(x => x.toUpperCase() === type) || type; (data.aircraft ||= {})[reg] = t; }
    data.metaMt = Date.now(); st.add = false; st.q = '';
    await save(`${reg} added`); viewFleet(main);
  };
  main.querySelectorAll('.ac-card').forEach(b => b.onclick = () => { viewFlights.st = { year: '', type: '', q: b.dataset.reg, all: false }; location.hash = 'voli'; });
}
