// Copiato da DK3 Roster (BoLu78/DK3-Roster, src/tails.js, v1.14.1): stesso codice, così LogBook e DK3 calcolano allo stesso modo.
// Servizi che a ora locale passano la mezzanotte: il giorno dopo contiene la parte finale.
import { buildDuties, localTime } from './timeline.js';

const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);

// data locale dell'aeroporto (se il fuso non è noto, quella della base, poi l'UTC)
export function localDateOf(ms, apt, airports, base) {
  const l = localTime(ms, apt, airports, null) ?? localTime(ms, base, airports, null);
  return l ? l.localDate : isoDate(ms);
}

const addDay = (iso) => new Date(Date.parse(iso + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);

// Map data -> [{ fromDate, endMs, endApt }] per i giorni locali che contengono solo la fine di un servizio
export function dutyTails(days, airports, base) {
  const out = new Map();
  for (const d of buildDuties(days)) {
    const ciApt = d.ci?.airport ?? d.legs[0]?.leg.dep ?? base;
    const coApt = d.co?.airport ?? d.legs.at(-1)?.leg.arr ?? base;
    const start = localDateOf(d.startMs, ciApt, airports, base);
    const end = localDateOf(d.endMs, coApt, airports, base);
    for (let date = addDay(start); date <= end; date = addDay(date)) {
      const list = out.get(date) ?? [];
      list.push({ fromDate: start, endMs: d.endMs, endApt: coApt, label: d.co?.label ?? 'C/O' });
      out.set(date, list);
    }
  }
  return out;
}
