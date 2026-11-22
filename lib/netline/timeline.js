// Copiato da DK3 Roster (BoLu78/DK3-Roster, src/timeline.js, v1.14.1): stesso codice, così LogBook e DK3 calcolano allo stesso modo.
// Dagli orari "hhmm" UTC del PDF agli istanti reali (UTC) e all'ora locale.
import { timezoneFor } from './tz.js';

const MIN = 60000;
const DAY = 86400000;

export function dateToMs(isoDate) {
  return Date.parse(isoDate + 'T00:00:00Z');
}

const hhmmToMin = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(2, 4));

// Eventi di un giorno nell'ordine del PDF: pickup, C/I, tratte, C/O.
// Un servizio notturno può avere il C/I in un giorno e i voli/C/O nel successivo.
export function sequenceOf(day) {
  if (day.seq?.length) return day.seq;
  const seq = [];
  if (day.pickup) seq.push({ t: 'pickup', time: day.pickup });
  if (day.checkIn) seq.push({ t: 'ci', ...day.checkIn });
  day.legs.forEach((_, index) => seq.push({ t: 'leg', index }));
  if (day.checkOut) seq.push({ t: 'co', ...day.checkOut });
  return seq;
}

// Istanti UTC di un giorno. Gli orari sono letti in ordine cronologico: quando un
// orario è più piccolo del precedente significa che si è passati a mezzanotte (+1 giorno).
export function buildDayTimeline(day) {
  // utcBase: data UTC del primo orario, se diversa dalla data del giorno (PDF in ora locale)
  const base = dateToMs(day.utcBase ?? day.date);
  let cursor = base;
  const at = (hhmm) => {
    if (!hhmm || !/^\d{4}$/.test(hhmm)) return null;
    let ms = base + hhmmToMin(hhmm) * MIN;
    while (ms < cursor) ms += DAY;
    cursor = ms;
    return ms;
  };
  const events = [];
  const legs = [];
  for (const e of sequenceOf(day)) {
    if (e.t === 'leg') {
      const leg = day.legs[e.index];
      const ev = { t: 'leg', leg, depMs: at(leg.depTime), arrMs: at(leg.arrTime) };
      events.push(ev);
      legs.push(ev);
    } else {
      events.push({ ...e, ms: at(e.time) });
    }
  }
  const tl = { events, legs, pickupMs: null, checkIn: null, checkOut: null, window: null };
  tl.pickupMs = events.find((e) => e.t === 'pickup')?.ms ?? null;
  tl.checkIn = events.find((e) => e.t === 'ci') ?? null;
  tl.checkOut = [...events].reverse().find((e) => e.t === 'co') ?? null;
  if (day.window) {
    const startMs = base + hhmmToMin(day.window.start) * MIN;
    let endMs = base + hhmmToMin(day.window.end) * MIN;
    if (endMs < startMs) endMs += DAY;
    tl.window = { startMs, endMs, airport: day.airport };
  }
  const all = events.flatMap((e) => (e.t === 'leg' ? [e.depMs, e.arrMs] : [e.ms])).filter((v) => v != null);
  if (tl.window) all.push(tl.window.startMs, tl.window.endMs);
  tl.startMs = all.length ? Math.min(...all) : null;
  tl.endMs = all.length ? Math.max(...all) : null;
  return tl;
}

// Servizi completi (da C/I a C/O) ricostruiti attraverso più giorni.
// days: giorni in ordine di data. Ogni servizio: { startMs, endMs, pickupMs, ci, co, legs, kind, dates, ft, dt, hotel }.
export function buildDuties(days) {
  const duties = [];
  let cur = null;
  let pickup = null;
  const open = (startMs, ci) => ({ startMs, endMs: startMs, pickupMs: pickup, ci, co: null, legs: [], dates: [], ft: null, dt: null, hotel: null });
  const close = () => {
    if (!cur) return;
    cur.kind = cur.legs.some((l) => l.leg.kind === 'flight') ? 'flight' : cur.legs.some((l) => l.leg.kind === 'ground') ? (cur.legs.some((l) => l.leg.kind === 'ground' && l.leg.sim !== false) ? 'sim' : 'ground') : 'transport';
    if (cur.endMs > cur.startMs || cur.legs.length) duties.push(cur);
    cur = null;
  };
  for (const day of days) {
    const tl = buildDayTimeline(day);
    const touch = () => {
      if (cur && !cur.dates.includes(day.date)) cur.dates.push(day.date);
    };
    for (const ev of tl.events) {
      if (ev.t === 'pickup') pickup = ev.ms;
      else if (ev.t === 'ci') {
        close();
        cur = open(ev.ms, ev);
        pickup = null;
        touch();
      } else if (ev.t === 'leg') {
        if (!cur) cur = open(ev.depMs, null);
        cur.legs.push(ev);
        cur.endMs = Math.max(cur.endMs, ev.arrMs ?? ev.depMs ?? 0);
        touch();
        // attività a terra senza C/I (corso, visita medica): è un servizio a sé
        if (ev.leg.kind === 'ground' && !cur.ci) {
          cur.ft = day.ft;
          cur.dt = day.dt;
          close();
        }
      } else if (ev.t === 'co') {
        if (!cur) cur = open(ev.ms, null);
        cur.co = ev;
        cur.endMs = Math.max(cur.endMs, ev.ms);
        touch();
        cur.ft = day.ft;
        cur.dt = day.dt;
        cur.hotel = day.hotel;
        close();
      }
    }
  }
  close();
  return duties;
}

export function fmtUtc(ms) {
  const d = new Date(ms);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

const formatters = new Map();
function formatterFor(tz) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    formatters.set(tz, f);
  }
  return f;
}

// Ora locale dell'aeroporto. `refDate` è la data (UTC) del giorno di servizio:
// serve per segnare "+1" / "-1" quando la data locale è diversa.
export function localTime(ms, iata, airports, refDate) {
  const tz = timezoneFor(iata, airports);
  if (!tz || ms == null) return null;
  const parts = Object.fromEntries(formatterFor(tz).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  const localDate = `${parts.year}-${parts.month}-${parts.day}`;
  const dayDelta = refDate ? Math.round((Date.parse(localDate + 'T00:00:00Z') - Date.parse(refDate + 'T00:00:00Z')) / DAY) : 0;
  const utcDate = new Date(ms).toISOString().slice(0, 10);
  const utcDelta = refDate ? Math.round((Date.parse(utcDate + 'T00:00:00Z') - Date.parse(refDate + 'T00:00:00Z')) / DAY) : 0;
  return { time: `${parts.hour}:${parts.minute}`, tz, localDate, dayDelta, utcDayDelta: utcDelta };
}

// Differenza UTC (in ore, es. +2) dell'aeroporto in quell'istante.
export function utcOffsetHours(ms, iata, airports) {
  const tz = timezoneFor(iata, airports);
  if (!tz) return null;
  const p = Object.fromEntries(formatterFor(tz).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return Math.round(((asUtc - Math.floor(ms / MIN) * MIN) / MIN / 60) * 100) / 100;
}

// Durata in minuti tra due istanti, per mostrare "3h40" di volo.
export function durationMin(aMs, bMs) {
  return aMs == null || bMs == null ? null : Math.round((bMs - aMs) / MIN);
}

export function fmtDuration(min) {
  if (min == null) return '';
  return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
}
