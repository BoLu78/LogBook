// Scarica da OpenStreetMap (Overpass) le mappe degli aeroporti in data/maps/list.txt e le salva in data/maps/ICAO.json,
// già nel formato che usa l'app. Gira su GitHub Actions: così l'app non dipende dalla lentezza dei server Overpass.
// Uso: node .github/scripts/build-maps.mjs [ICAO ...]
import fs from 'node:fs';
const APT = JSON.parse(fs.readFileSync('data/airports.json', 'utf8'));
const list = (process.argv.slice(2).length ? process.argv.slice(2) : fs.readFileSync('data/maps/list.txt', 'utf8').split('\n'))
  .map(s => s.replace(/#.*/, '').trim().toUpperCase()).filter(s => /^[A-Z0-9]{4}$/.test(s));
const OVP = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const rd = p => [Math.round(p.lat * 1e5) / 1e5, Math.round(p.lon * 1e5) / 1e5];
let fail = 0;
for (const icao of list) {
  const a = APT[icao];
  if (!a) { console.log(icao, 'not in airports.json'); fail++; continue; }
  const [lat, lon] = a, dl = 0.045, dn = 0.045 / Math.cos(lat * Math.PI / 180);
  const bb = [lat - dl, lon - dn, lat + dl, lon + dn].map(v => v.toFixed(4)).join(',');
  const q = `[out:json][timeout:120][bbox:${bb}];(way[aeroway~"^(taxiway|apron|terminal|runway|stopway|hangar|tower|parking_position)$"];node[aeroway~"^(holding_position|arresting_gear|windsock|tower)$"];node[navigationaid=papi];);out tags geom;`;
  let ok = false;
  for (const u of OVP) {
    try {
      const r = await fetch(u, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'LogBook map builder (github.com/BoLu78/LogBook)' }, signal: AbortSignal.timeout(180000) });
      if (!r.ok) { console.log(icao, u, r.status); continue; }
      const j = await r.json();
      const ways = (j.elements || []).filter(e => e.geometry?.length > 1 || (e.type === 'node' && isFinite(e.lat))).map(e => ({
        a: e.tags.navigationaid === 'papi' ? 'papi' : e.tags.aeroway, r: e.tags.ref || '', w: parseFloat(e.tags.width) || 0,
        ...(e.tags['holding_position:type'] ? { t: e.tags['holding_position:type'] } : {}),
        g: e.type === 'node' ? [rd(e)] : e.geometry.map(rd)
      }));
      if (!ways.some(w => w.a === 'runway' || w.a === 'taxiway')) { console.log(icao, u, 'no runways'); continue; }
      fs.writeFileSync(`data/maps/${icao}.json`, JSON.stringify({ t: Date.now(), src: 'OpenStreetMap', v: ways }));
      console.log(icao, ways.length, 'elements');
      ok = true; break;
    } catch (e) { console.log(icao, u, e.name, e.message); }
  }
  if (!ok) fail++;
  await new Promise(r => setTimeout(r, 5000));   // gentili con i server Overpass
}
console.log('done, failed:', fail);
