// Copiato da DK3 Roster (BoLu78/DK3-Roster, src/trips.js, v1.14.1): stesso codice, così LogBook e DK3 calcolano allo stesso modo.
// Rotazioni (trip): una o più giornate di servizio consecutive da base a base,
// come la barra continua nella vista mensile di NetLine.
import { buildDuties } from './timeline.js';
import { localDateOf } from './tails.js';

const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);
// giorno di inizio/fine nell'ora locale dell'aeroporto (senza tabella dei fusi: UTC)
const dateOf = (ms, apt, base, airports) => (airports ? localDateOf(ms, apt ?? base, airports, base) : isoDate(ms));

function finish(duties, base, airports) {
  const first = duties[0];
  const last = duties.at(-1);
  const legs = duties.flatMap((d) => d.legs.map((l) => l.leg));
  const stops = [];
  for (const l of legs) for (const a of [l.dep, l.arr]) if (a && a !== base && !stops.includes(a)) stops.push(a);
  const kind = legs.some((l) => l.kind === 'flight') ? 'flight' : legs.some((l) => l.kind === 'ground') ? (legs.some((l) => l.kind === 'ground' && l.sim !== false) ? 'sim' : 'ground') : 'transport';
  return { duties, kind, startMs: first.startMs, endMs: last.endMs, startDate: dateOf(first.startMs, first.ci?.airport ?? first.legs[0]?.leg.dep, base, airports),
    endDate: dateOf(last.endMs, last.co?.airport ?? last.legs.at(-1)?.leg.arr, base, airports),
    stops,
  };
}

// days: tutti i giorni in ordine di data; base: aeroporto base (es. MXP)
export function buildTrips(days, base, airports) {
  const trips = [];
  let cur = [];
  for (const d of buildDuties(days)) {
    cur.push(d);
    // un'attività a terra senza arrivo (corso, visita medica) finisce dove si svolge
    const end = d.co?.airport ?? d.legs.at(-1)?.leg.arr ?? d.legs.at(-1)?.leg.dep;
    if (!base || end === base) {
      trips.push(finish(cur, base, airports));
      cur = [];
    }
  }
  if (cur.length) trips.push(finish(cur, base, airports));
  return trips;
}
