// Copiato da DK3 Roster (BoLu78/DK3-Roster, src/ftl.js, v1.14.1): stesso codice, così LogBook e DK3 calcolano allo stesso modo.
// Controllo dei limiti FTL (tempi di volo e di servizio) sui servizi del roster.
//
// Le regole sono quelle dell'OMA-A cap. 7 (che applica EASA ORO.FTL): qui ci sono solo i
// numeri, non il testo del manuale. Il risultato è un'indicazione: l'ultima parola è del manuale.
import { buildDuties, localTime, utcOffsetHours } from './timeline.js';
import { buildTrips } from './trips.js';
import { timezoneFor } from './tz.js';
import { tr } from './i18n.js';

const MIN = 60000;
const HOUR = 3600000;
export const WARN_MARGIN_MIN = 30; // sotto questo margine il servizio è "al limite"

const t = (s) => {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
};

// ---------------------------------------------------------------- tabelle FDP
// Inizio FDP (ora di riferimento) -> massimo FDP per 1-2, 3, 4 ... 9, 10+ settori. OMA 7.1.7.1
const BASIC = [
  [360, 809, '13:00 12:30 12:00 11:30 11:00 10:30 10:00 09:30 09:00'],
  [810, 839, '12:45 12:15 11:45 11:15 10:45 10:15 09:45 09:15 09:00'],
  [840, 869, '12:30 12:00 11:30 11:00 10:30 10:00 09:30 09:00 09:00'],
  [870, 899, '12:15 11:45 11:15 10:45 10:15 09:45 09:15 09:00 09:00'],
  [900, 929, '12:00 11:30 11:00 10:30 10:00 09:30 09:00 09:00 09:00'],
  [930, 959, '11:45 11:15 10:45 10:15 09:45 09:15 09:00 09:00 09:00'],
  [960, 989, '11:30 11:00 10:30 10:00 09:30 09:00 09:00 09:00 09:00'],
  [990, 1019, '11:15 10:45 10:15 09:45 09:15 09:00 09:00 09:00 09:00'],
  [1020, 1439, '11:00 10:30 10:00 09:30 09:00 09:00 09:00 09:00 09:00'],
  [0, 299, '11:00 10:30 10:00 09:30 09:00 09:00 09:00 09:00 09:00'],
  [300, 314, '12:00 11:30 11:00 10:30 10:00 09:30 09:00 09:00 09:00'],
  [315, 329, '12:15 11:45 11:15 10:45 10:15 09:45 09:15 09:00 09:00'],
  [330, 344, '12:30 12:00 11:30 11:00 10:30 10:00 09:30 09:00 09:00'],
  [345, 359, '12:45 12:15 11:45 11:15 10:45 10:15 09:45 09:15 09:00'],
].map(([a, b, v]) => [a, b, v.split(' ').map(t)]);

// Stato di acclimatazione sconosciuto (X): 1-2, 3, 4, 5, 6, 7, 8 settori. OMA 7.1.7.1
const UNKNOWN = '11:00 10:30 10:00 09:30 09:00 09:00 09:00'.split(' ').map(t);

// Estensione pianificata (+1 h, solo con "Ext" nel roster): 1-2, 3, 4, 5 settori. OMA 7.1.7.2
const EXT = [
  [360, 374, null],
  [375, 389, '13:15 12:45 12:15 11:45'],
  [390, 404, '13:30 13:00 12:30 12:00'],
  [405, 419, '13:45 13:15 12:45 12:15'],
  [420, 809, '14:00 13:30 13:00 12:30'],
  [810, 839, '13:45 13:15 12:45 -'],
  [840, 869, '13:30 13:00 12:30 -'],
  [870, 899, '13:15 12:45 12:15 -'],
  [900, 929, '13:00 12:30 12:00 -'],
  [930, 959, '12:45 - - -'],
  [960, 989, '12:30 - - -'],
  [990, 1019, '12:15 - - -'],
  [1020, 1049, '12:00 - - -'],
  [1050, 1079, '11:45 - - -'],
  [1080, 1109, '11:30 - - -'],
  [1110, 1139, '11:15 - - -'],
].map(([a, b, v]) => [a, b, v ? v.split(' ').map((x) => (x === '-' ? null : t(x))) : [null, null, null, null]]);

// Acclimatazione per fusi diversi (OMA 7.1.4): righe = differenza oraria, colonne = ore dalla presentazione
const ACCL = [
  [4, ['B', 'D', 'D', 'D', 'D']],
  [6, ['B', 'X', 'D', 'D', 'D']],
  [9, ['B', 'X', 'X', 'D', 'D']],
  [12, ['B', 'X', 'X', 'X', 'D']],
];
const acclColumn = (hours) => (hours < 48 ? 0 : hours < 72 ? 1 : hours < 96 ? 2 : hours < 120 ? 3 : 4);

const sectorIndex = (n) => Math.min(Math.max(n, 1) <= 2 ? 0 : n - 2, 8);

function row(table, minute) {
  return table.find(([a, b]) => minute >= a && minute <= b)?.[2] ?? null;
}

export function basicFdpMax(refMinute, sectors) {
  return row(BASIC, refMinute)?.[sectorIndex(sectors)] ?? null;
}
export function unknownFdpMax(sectors) {
  return UNKNOWN[Math.min(sectorIndex(sectors), 6)];
}
export function extFdpMax(refMinute, sectors) {
  if (sectors > 5) return null;
  return row(EXT, refMinute)?.[sectorIndex(sectors)] ?? null;
}

// WOCL (02:00-05:59 nell'ora a cui l'equipaggio è acclimatato): minuti dell'FDP che la toccano
export function woclEncroachMin(startMinuteOfDay, fdpMin) {
  let n = 0;
  for (let m = 0; m < fdpMin; m++) {
    const x = (startMinuteOfDay + m) % 1440;
    if (x >= 120 && x <= 359) n++;
  }
  return n;
}
// Settori massimi per un FDP esteso (OMA 7.1.7.2): 5 senza WOCL, 4 se la tocca fino a 2 h, 2 oltre
export const extSectorCap = (woclMin) => (woclMin === 0 ? 5 : woclMin <= 120 ? 4 : 2);

// Riposo in volo (equipaggio aumentato), max 3 settori. Classe 2 sul B737, classe 1 sul B787. OMA 7.1.7.3
export function inflightRestMax(crew, sectors, restClass, longSector) {
  if (crew < 3 || sectors > 3) return null;
  let h = crew >= 4 ? (restClass === 1 ? 17 : 16) : restClass === 1 ? 16 : 15;
  if (longSector && sectors <= 2) h += 1;
  return h * 60;
}

// Riposo in volo della cabina (OMA 7.1.7.3 (3)): FDP esteso massimo -> riposo minimo per ogni assistente.
// Righe [FDP massimo in minuti, riposo classe 1, riposo classe 2] (null = non ammesso)
export const CABIN_REST_TABLE = [
  [870, 90, 90], // fino a 14:30
  [900, 105, 120], // 15:00
  [930, 120, 140], // 15:30
  [960, 135, 160], // 16:00
  [990, 155, 180], // 16:30
  [1020, 180, 205], // 17:00
  [1050, 205, null], // 17:30
  [1080, 230, null], // 18:00
];
// riposi selezionabili per la cabina, secondo la classe dei posti (B737 classe 2, B787 classe 1)
export const cabinRestOptions = (restClass) => CABIN_REST_TABLE.map((r) => r[restClass === 1 ? 1 : 2]).filter((x) => x != null);
// FDP esteso massimo che la cabina può fare con quel riposo (null = sotto 1:30, nessuna estensione)
export function cabinInflightMax(restMin, restClass) {
  let best = null;
  for (const r of CABIN_REST_TABLE) {
    const need = r[restClass === 1 ? 1 : 2];
    if (need != null && restMin >= need) best = r[0];
  }
  return best;
}
// riposo minimo della cabina per un certo FDP (null se l'FDP è oltre la tabella)
export function cabinRestNeeded(fdpMin, restClass) {
  const row = CABIN_REST_TABLE.find((r) => fdpMin <= r[0] && r[restClass === 1 ? 1 : 2] != null);
  return row ? row[restClass === 1 ? 1 : 2] : null;
}

// ---------------------------------------------------------------- orari locali
function makeCtx(base, airports) {
  const baseTz = timezoneFor(base, airports);
  return {
    base,
    airports,
    baseTz,
    offset: (ms, apt) => utcOffsetHours(ms, apt, airports) ?? utcOffsetHours(ms, base, airports) ?? 0,
    minuteOfDay(ms, apt) {
      const l = localTime(ms, apt, airports, null) ?? localTime(ms, base, airports, null);
      if (!l) return Math.floor((ms % 86400000) / MIN); // senza fuso si usa l'UTC
      return t(l.time);
    },
    tzKnown: (apt) => !!timezoneFor(apt, airports),
  };
}

const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);
const fmtHM = (min) => `${Math.floor(min / 60)}:${String(Math.abs(min) % 60).padStart(2, '0')}`;
export { fmtHM };

// ---------------------------------------------------------------- analisi di un servizio
export const dutyKey = (d) => `${d.startMs}`;

function analyzeDuty(duty, trip, ctx, crew, extFlag = false, cabinRestMin = null) {
  const legs = duty.legs.map((l) => l.leg);
  const flights = duty.legs.filter((l) => l.leg.kind === 'flight');
  const ciApt = duty.ci?.airport ?? legs[0]?.dep ?? ctx.base;
  const coApt = duty.co?.airport ?? legs.at(-1)?.arr ?? ctx.base;
  const startMs = duty.ci?.ms ?? duty.startMs;
  const endMs = duty.co?.ms ?? duty.endMs;
  const out = { key: dutyKey(duty), duty, startMs, endMs, dutyMin: Math.round((endMs - startMs) / MIN), ciApt, coApt, dates: duty.dates, crew, tags: [], notes: [], status: null };

  // ---- classificazione notte / presto / tardi (ora dell'acclimatazione = base per i fusi vicini)
  const farStart = Math.abs(ctx.offset(startMs, ciApt) - ctx.offset(startMs, ctx.base)) > 2;
  const startLocal = ctx.minuteOfDay(startMs, farStart ? ctx.base : ciApt);
  const endLocal = ctx.minuteOfDay(endMs, farStart ? ctx.base : coApt);
  if (startLocal >= 300 && startLocal <= 359) out.tags.push('presto');
  if (endLocal >= 1380 || endLocal <= 119) out.tags.push('tardi');
  const encroaches = (a, b) => {
    // il servizio tocca 02:00-04:59 locali?
    const len = Math.round((b - a) / MIN);
    for (let m = 0; m <= len; m += 15) if (((startLocal + m) % 1440) >= 120 && ((startLocal + m) % 1440) <= 299) return true;
    return false;
  };
  if (encroaches(startMs, endMs)) out.tags.push('notte');

  if (!flights.length) return out; // trasferimento o simulatore: nessun FDP

  // ---- FDP: dalla presentazione al block-in dell'ultimo volo
  const fdpEndMs = flights.at(-1).arrMs;
  const fdpMin = Math.round((fdpEndMs - startMs) / MIN);
  const sectors = flights.length;
  const lastLeg = flights.at(-1);
  const firstLeg = flights[0];
  out.fdp = {
    startMs, endMs: fdpEndMs, min: fdpMin, sectors, lastDepMs: lastLeg.depMs, lastDepApt: lastLeg.leg.dep, lastBlockMin: Math.round((lastLeg.arrMs - lastLeg.depMs) / MIN),
    // primo sblocco e durata programmata dal primo off-block all'ultimo block-in (voli e soste come da schedulato)
    firstDepMs: firstLeg.depMs, firstDepApt: firstLeg.leg.dep, schedSpanMin: Math.round((lastLeg.arrMs - firstLeg.depMs) / MIN),
    firstDepAtHub: (ctx.hubs ?? new Set([ctx.base])).has(firstLeg.leg.dep),
  };

  // ---- acclimatazione (OMA 7.1.4)
  const diff = Math.abs(ctx.offset(startMs, ciApt) - ctx.offset(startMs, ctx.base));
  const elapsedH = Math.max(0, (startMs - (trip?.startMs ?? startMs)) / HOUR);
  let state = 'local';
  if (diff > 2) {
    const r = ACCL.find(([lim]) => diff <= lim) ?? ACCL.at(-1);
    state = r[1][acclColumn(elapsedH)];
  }
  const refMin = state === 'B' ? ctx.minuteOfDay(startMs, ctx.base) : ctx.minuteOfDay(startMs, ciApt);
  out.acclimatisation = { state, diffH: Math.round(diff * 10) / 10, elapsedH: Math.round(elapsedH) };
  out.refMinute = refMin;
  out.tzUnknown = !ctx.tzKnown(ciApt);

  // ---- limiti
  const basic = state === 'X' ? unknownFdpMax(sectors) : basicFdpMax(refMin, sectors);
  const wocl = woclEncroachMin(refMin, fdpMin);
  const cap = extSectorCap(wocl);
  let ext = state === 'X' ? null : extFdpMax(refMin, sectors);
  let extWhy = ext == null ? (state === 'X' ? tr('acclimatazione sconosciuta', 'unknown acclimatisation') : tr('orario di inizio o numero di settori non ammessi dalla tabella', 'start time or number of sectors not allowed by the table')) : null;
  if (ext != null && sectors > cap) {
    ext = null;
    extWhy = tr(`con ${wocl ? `la WOCL toccata per ${fmtHM(wocl)}` : 'la WOCL non toccata'} l’estensione ammette al massimo ${cap} settori`, `with ${wocl ? `WOCL encroached by ${fmtHM(wocl)}` : 'no WOCL encroachment'} the extension allows at most ${cap} sectors`);
  }
  out.wocl = wocl;
  const longSector = flights.some((l) => (l.arrMs - l.depMs) / MIN > 540);
  const restClass = flights.every((l) => /787/.test(l.leg.ac ?? '')) ? 1 : 2;
  // riposo in volo: vale il più basso tra il limite dei piloti e quello della cabina (OMA 7.1.7.3)
  const inflightPilots = inflightRestMax(crew, sectors, restClass, longSector);
  // riposo cabina non scelto: si assume quello che serve per l'FDP pianificato (1:30 se l'FDP sta nel massimo base,
  // il massimo della tabella se l'FDP è oltre), così il limite dipende dai piloti e la nota dice quanto deve riposare la cabina
  const cabinRestDefault = inflightPilots
    ? fdpMin > (basic ?? 0) ? cabinRestNeeded(fdpMin, restClass) ?? Math.max(...cabinRestOptions(restClass)) : 90
    : null;
  const cabinRest = inflightPilots ? cabinRestMin ?? cabinRestDefault : null;
  const cabinRestAuto = !!inflightPilots && cabinRestMin == null;
  const inflightCabin = inflightPilots ? cabinInflightMax(cabinRest, restClass) : null;
  let inflight = inflightPilots ? Math.min(inflightPilots, inflightCabin ?? 0) : null;
  if (inflight != null && inflight <= (basic ?? 0)) inflight = null; // la cabina non riposa abbastanza: niente estensione
  out.limits = { basic, ext, inflight, inflightPilots, inflightCabin, cabinRest, cabinRestDefault, cabinRestAuto, restClass };
  out.limitedBy = inflightPilots ? (inflight == null ? 'cabin' : inflightCabin < inflightPilots ? 'cabin' : 'pilots') : null;
  if (inflightPilots && !extFlag) {
    out.notes.push(tr(
      `Piloti (${crew}, posti classe ${restClass}): ${fmtHM(inflightPilots)} · cabina (riposo ${fmtHM(cabinRest)}${cabinRestAuto ? ', quello che serve per questo FDP' : ''}): ${inflightCabin ? fmtHM(inflightCabin) : 'nessuna estensione'} → ${out.limitedBy === 'cabin' ? 'limita la cabina' : 'limitano i piloti'}`,
      `Pilots (${crew}, class ${restClass} seats): ${fmtHM(inflightPilots)} · cabin (rest ${fmtHM(cabinRest)}${cabinRestAuto ? ', as needed for this FDP' : ''}): ${inflightCabin ? fmtHM(inflightCabin) : 'no extension'} → ${out.limitedBy === 'cabin' ? 'cabin crew is limiting' : 'pilots are limiting'}`));
    out.notes.push(tr('Riposo in volo: max 3 settori, almeno 1:30 consecutive per ciascuno e 2 h per i piloti ai comandi in atterraggio; riposo dopo almeno 14 h', 'In-flight rest: max 3 sectors, at least 1:30 consecutive for each crew member and 2 h for the pilots at the controls for landing; rest afterwards at least 14 h'));
    if (fdpMin > (basic ?? 0)) {
      const need = cabinRestNeeded(fdpMin, restClass);
      out.cabinRestNeeded = need;
      out.notes.push(need != null
        ? tr(`Per questo FDP (${fmtHM(fdpMin)}) la cabina deve riposare almeno ${fmtHM(need)} a testa`, `For this FDP (${fmtHM(fdpMin)}) each cabin crew member needs at least ${fmtHM(need)} of rest`)
        : tr(`FDP ${fmtHM(fdpMin)} oltre la tabella della cabina`, `FDP ${fmtHM(fdpMin)} beyond the cabin crew table`));
    }
  }

  // E_FDP nel roster = servizio pianificato con estensione ("EXTENSION" nell'app): vale il massimo esteso (OMA 7.1.7.2)
  const extPlanned = extFlag && ext != null;
  if (extFlag && ext == null) out.notes.push(tr(`EXTENSION nel roster ma non ammessa: ${extWhy} → vale il massimo base`, `EXTENSION in the roster but not allowed: ${extWhy} → basic maximum applies`));
  // con Extension il riposo in volo non si può usare (OMA 7.1.7.2/7.1.7.3): l'equipaggio è quello standard
  const used = extPlanned ? ext : inflight ? Math.max(basic ?? 0, inflight) : basic;
  // la discrezione del comandante si calcola sempre sul massimo base (OMA 7.2.1): +2 h
  const discretion = used != null ? (extPlanned ? basic + 120 : used + (inflight ? 180 : 120)) : null;
  out.limits.discretion = discretion;
  out.limits.used = used;
  if (extPlanned) {
    out.extPlanned = true;
    out.notes.push(
      tr(`EXTENSION pianificata: max base ${fmtHM(basic)} + 1 h = ${fmtHM(ext)}`, `Planned EXTENSION: basic max ${fmtHM(basic)} + 1 h = ${fmtHM(ext)}`),
      tr(`Settori: max ${cap} con WOCL ${wocl ? `toccata per ${fmtHM(wocl)}` : 'non toccata'}`, `Sectors: max ${cap} with WOCL ${wocl ? `encroached by ${fmtHM(wocl)}` : 'not encroached'}`),
      tr('Riposo in volo non ammesso con Extension', 'In-flight rest not allowed with Extension'),
      tr(`Cpt Discretion: +2 h sul max base (non sull’esteso) = ${fmtHM(discretion)}`, `Cpt Discretion: +2 h on the basic max (not the extended one) = ${fmtHM(discretion)}`),
      tr('Riposo: +2 h prima e +2 h dopo, oppure +4 h dopo', 'Rest: +2 h before and +2 h after, or +4 h after'),
      tr('Da verificare: remark “Ext” notificato ≥10 h prima dell’FDP; max 2 Extension in 7 giorni', 'To check: “Ext” remark notified ≥10 h before the FDP; max 2 Extensions in 7 days'),
    );
    if (fdpMin <= basic) out.notes.push(tr(`FDP entro il max base (${fmtHM(basic)}): Extension non usata`, `FDP within the basic max (${fmtHM(basic)}): Extension not used`));
  }
  if (crew >= 3 && sectors > 3) out.notes.push(tr('Riposo in volo: max 3 settori', 'In-flight rest: max 3 sectors'));

  if (used == null) return out;
  if (fdpMin <= used) {
    out.gapMin = used - fdpMin;
    out.status = out.gapMin <= WARN_MARGIN_MIN ? 'warn' : 'ok';
    out.limitKind = extPlanned && !(inflight && used === inflight) ? 'ext' : inflight && used === inflight && inflight > (basic ?? 0) ? 'inflight' : 'basic';
    out.usedInflight = out.limitKind === 'inflight' && fdpMin > (basic ?? 0); // serve davvero il riposo in volo
    if (out.usedInflight) out.notes.push(tr('Entro il limite solo con riposo in volo (equipaggio aumentato)', 'Within the limit only with in-flight rest (augmented crew)'));
  } else if (ext != null && fdpMin <= ext) {
    out.gapMin = ext - fdpMin;
    out.status = 'ext';
    out.limitKind = 'ext';
    out.notes.push(tr('Oltre il max base: serve Extension pianificata, con remark “Ext” nel roster', 'Beyond the basic max: a planned Extension is needed, with the “Ext” remark in the roster'));
  } else {
    out.gapMin = used - fdpMin;
    out.status = 'over';
    out.limitKind = extPlanned ? 'ext' : 'basic';
    if (discretion != null && fdpMin <= discretion) out.notes.push(tr('Entro la Cpt Discretion', 'Within Cpt Discretion'));
  }
  return out;
}

// ---------------------------------------------------------------- riposi
function restBetween(prev, next, ctx) {
  const from = prev.endMs;
  const to = next.startMs;
  if (to <= from) return null;
  const restMin = Math.round((to - from) / MIN);
  const atBase = next.ciApt === ctx.base;
  let need = Math.max(prev.dutyMin, atBase ? 720 : 600);
  const why = [atBase ? tr('a base: max(duty precedente, 12 h)', 'at home base: max(preceding duty, 12 h)') : tr('fuori base: max(duty precedente, 10 h)', 'away from base: max(preceding duty, 10 h)')];
  // fuso: servizio con 4 h o più di differenza -> fuori base almeno 14 h
  const tzDiff = Math.abs(ctx.offset(prev.startMs, prev.ciApt) - ctx.offset(prev.endMs, prev.coApt));
  if (!atBase && tzDiff >= 4) {
    need = Math.max(need, 840);
    why.push(tr('fuso ≥4 h: 14 h', 'time difference ≥4 h: 14 h'));
  }
  // riposo in volo usato: 14 h
  if (prev.usedInflight && !atBase) need = Math.max(need, 840);
  // fine tardi / notte seguita da inizio presto a base: serve 1 notte locale
  let localNightNeeded = atBase && (prev.tags.includes('tardi') || prev.tags.includes('notte')) && next.tags.includes('presto');
  let hasNight = true;
  if (localNightNeeded) {
    hasNight = containsLocalNight(from, to, ctx);
    why.push(tr('da fine tardi/notte a inizio presto: 1 notte locale', 'late finish/night to early start: 1 local night'));
  }
  const status = restMin < need || !hasNight ? 'over' : restMin - need < 60 ? 'warn' : 'ok';
  return { fromMs: from, toMs: to, restMin, needMin: need, status, why, atBase, hasNight, dates: [isoDate(to)] };
}

// Dopo e prima di un FDP esteso (OMA 7.1.7.2): riposo +2 h prima E +2 h dopo, oppure +4 h dopo.
// Tra due FDP estesi i supplementi si sommano. Per ogni servizio esteso sceglie l'opzione che dà meno carenza.
function applyExtensionRest(rests, duties) {
  const ext = new Set(duties.filter((d) => d.extPlanned).map((d) => d.key));
  if (!ext.size) return;
  const touched = rests.filter((r) => ext.has(r.prevKey) || ext.has(r.nextKey));
  const keys = [...ext].filter((k) => touched.some((r) => r.prevKey === k || r.nextKey === k));
  if (!keys.length) return;
  const extra = (r, opt) => (ext.has(r.prevKey) ? (opt[r.prevKey] === 'B' ? 240 : 120) : 0) + (ext.has(r.nextKey) && opt[r.nextKey] !== 'B' ? 120 : 0);
  let best = null;
  const n = Math.min(keys.length, 12);
  for (let mask = 0; mask < 1 << n; mask++) {
    const opt = Object.fromEntries(keys.map((k, i) => [k, i < n && (mask >> i) & 1 ? 'B' : 'A']));
    const deficit = touched.reduce((a, r) => a + Math.max(0, r.needMin + extra(r, opt) - r.restMin), 0);
    const total = touched.reduce((a, r) => a + extra(r, opt), 0);
    if (!best || deficit < best.deficit || (deficit === best.deficit && total < best.total)) best = { opt, deficit, total };
  }
  for (const r of touched) {
    const more = extra(r, best.opt);
    r.needMin += more;
    r.extraMin = more;
    r.why.push(tr(`Extension: riposo +${more / 60} h`, `Extension: rest +${more / 60} h`));
    r.status = r.restMin < r.needMin || !r.hasNight ? 'over' : r.restMin - r.needMin < 60 ? 'warn' : 'ok';
  }
}

// "Notte locale" = 8 ore comprese tra le 22:00 e le 08:00 (ora di base): per contarla basta che il
// periodo di riposo copra almeno 8 ore di quella fascia.
function countLocalNights(fromMs, toMs, ctx) {
  const off = ctx.offset(fromMs, ctx.base) * HOUR;
  const startDay = Math.floor((fromMs + off) / 86400000) - 1;
  let n = 0;
  for (let d = startDay; d <= startDay + 30; d++) {
    const a = d * 86400000 + 22 * HOUR - off;
    const overlap = Math.min(a + 10 * HOUR, toMs) - Math.max(a, fromMs);
    if (overlap >= 8 * HOUR) n++;
  }
  return n;
}
const containsLocalNight = (fromMs, toMs, ctx) => countLocalNights(fromMs, toMs, ctx) >= 1;

// ---------------------------------------------------------------- intervalli occupati (duty, stand-by, reserve)
function busyIntervals(days, duties, ctx) {
  const out = duties.map((d) => ({ from: d.startMs, to: d.endMs, kind: 'duty' }));
  for (const day of days) {
    if (day.kind !== 'standby') continue;
    if (day.window) {
      const base = Date.parse((day.utcBase ?? day.date) + 'T00:00:00Z');
      const [h1, m1] = [Number(day.window.start.slice(0, 2)), Number(day.window.start.slice(2))];
      const [h2, m2] = [Number(day.window.end.slice(0, 2)), Number(day.window.end.slice(2))];
      const from = base + (h1 * 60 + m1) * MIN;
      let to = base + (h2 * 60 + m2) * MIN;
      if (to < from) to += 86400000;
      out.push({ from, to, kind: 'standby', date: day.date });
    } else {
      // reserve: tutto il giorno locale
      const off = ctx.offset(Date.parse(day.date + 'T12:00:00Z'), ctx.base) * HOUR;
      const from = Date.parse(day.date + 'T00:00:00Z') - off;
      out.push({ from, to: from + 86400000, kind: 'reserve', date: day.date });
    }
  }
  return out.sort((a, b) => a.from - b.from);
}

// minuti di duty (+25% dello stand-by) che cadono nella finestra [fromMs, toMs)
function dutyInWindow(busy, fromMs, toMs) {
  let total = 0;
  for (const b of busy) {
    if (b.kind === 'reserve') continue; // la reserve non conta come duty
    const a = Math.max(b.from, fromMs);
    const z = Math.min(b.to, toMs);
    if (z > a) total += ((z - a) / MIN) * (b.kind === 'standby' ? 0.25 : 1);
  }
  return Math.round(total);
}

export const LIMITS = { duty7: 3600, duty14: 6600, duty28: 11400, dutyYear: 120000, ft28: 6000, ftYear: 54000, ft12m: 60000 };

// ---------------------------------------------------------------- analisi completa
// piloti in cabina di pilotaggio secondo il PDF (il massimo tra le tratte del servizio), da 2 a 4
function pdfPilots(duty) {
  const n = Math.max(0, ...duty.legs.filter((l) => l.leg.kind === 'flight').map((l) => l.leg.crew?.cockpit?.length ?? 0));
  return n >= 2 ? Math.min(n, 4) : null;
}

// days: tutti i giorni (ordinati). options: { base, airports, crewByDuty: {key: 2|3|4}, cabinRestByDuty: {key: minuti} }
// Se l'utente non ha scelto i piloti, si usa il numero di piloti in cabina di pilotaggio indicato nel PDF.
export function analyze(days, options) {
  const { base = 'MXP', airports = {}, crewByDuty = {}, cabinRestByDuty = {}, hubs = [] } = options;
  const ctx = makeCtx(base, airports);
  ctx.hubs = new Set([base, ...hubs]); // home base e hub della compagnia (OMA 7.2.1: discrezione da evitare)
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const trips = buildTrips(sorted, base);
  const tripOf = new Map();
  for (const tr of trips) for (const d of tr.duties) tripOf.set(d, tr);
  const extDates = new Set(sorted.filter((d) => d.flags?.includes('E_FDP')).map((d) => d.date));
  const duties = buildDuties(sorted).map((d) => {
    const extFlag = d.dates.some((x) => extDates.has(x));
    const key = dutyKey(d);
    const fromPdf = pdfPilots(d);
    const crew = extFlag ? 2 : crewByDuty[key] ?? fromPdf ?? 2;
    const res = analyzeDuty(d, tripOf.get(d), ctx, crew, extFlag, cabinRestByDuty[key] ?? null);
    res.crewFromPdf = !extFlag && crewByDuty[key] == null && fromPdf != null;
    res.crewPdf = fromPdf;
    return res;
  });
  for (const d of duties) if (extDates.size && d.dates.some((x) => extDates.has(x))) d.crewLocked = true;
  const issues = [];
  const add = (severity, date, text, extra = {}) => issues.push({ severity, date, text, ...extra });

  for (const d of duties) {
    const date = isoDate(d.startMs);
    if (d.status === 'over') add('bad', date, tr(`FDP ${fmtHM(d.fdp.min)} sopra il massimo ${fmtHM(d.limits.used)} (${d.fdp.sectors} settori)`, `FDP ${fmtHM(d.fdp.min)} above the maximum ${fmtHM(d.limits.used)} (${d.fdp.sectors} sectors)`));
    else if (d.status === 'ext') add('warn', date, tr(`FDP ${fmtHM(d.fdp.min)} oltre il massimo base ${fmtHM(d.limits.basic)}: richiede Extension, ma nel roster non c’è`, `FDP ${fmtHM(d.fdp.min)} beyond the basic maximum ${fmtHM(d.limits.basic)}: needs an Extension, but none in the roster`));
    else if (d.status === 'warn') add('warn', date, tr(`FDP ${fmtHM(d.fdp.min)} al limite (massimo ${fmtHM(d.limits.used)})`, `FDP ${fmtHM(d.fdp.min)} close to the limit (maximum ${fmtHM(d.limits.used)})`));
    if (d.extPlanned && d.fdp.min > d.limits.basic && d.status !== 'over') add('info', date, tr(`FDP ${fmtHM(d.fdp.min)} con EXTENSION pianificata: massimo ${fmtHM(d.limits.used)}`, `FDP ${fmtHM(d.fdp.min)} with planned EXTENSION: maximum ${fmtHM(d.limits.used)}`));
    if (d.acclimatisation?.state === 'X') add('info', date, tr('Stato di acclimatazione sconosciuto (X): uso la tabella più restrittiva', 'Unknown acclimatisation state (X): using the most restrictive table'));
    if (d.tzUnknown) add('info', date, tr(`Fuso di ${d.ciApt} non noto: uso l’ora di base`, `Time zone of ${d.ciApt} unknown: using home base time`));
  }

  // riposi: dalla fine del servizio o dello stand-by precedente alla presentazione del servizio successivo.
  // La reserve non si considera (senza orari: non si sa quando finisce) e non genera un riposo da rispettare.
  const standbyItems = [];
  for (const day of sorted) {
    if (day.kind !== 'standby' || !day.window) continue;
    const base0 = Date.parse((day.utcBase ?? day.date) + 'T00:00:00Z');
    const toMs = (hhmm) => base0 + (Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(2))) * MIN;
    const startMs = toMs(day.window.start);
    let endMs = toMs(day.window.end);
    if (endMs < startMs) endMs += 86400000;
    standbyItems.push({ standby: true, startMs, endMs, dutyMin: 0, ciApt: day.airport ?? base, coApt: day.airport ?? base, tags: [], dates: [day.date] });
  }
  const timeline = [...duties, ...standbyItems].sort((a, b) => a.startMs - b.startMs);
  const rests = [];
  for (let i = 1; i < timeline.length; i++) {
    const next = timeline[i];
    if (next.standby) continue; // il riposo che conta è quello prima di un servizio
    const prev = timeline.slice(0, i).reduce((a, b) => (b.endMs > a.endMs ? b : a)); // ciò che finisce per ultimo
    const r = restBetween(prev, next, ctx);
    if (!r) continue;
    if (prev.standby) r.why.unshift(tr('dopo stand-by', 'after standby'));
    r.prevKey = prev.standby ? null : prev.key;
    r.nextKey = next.key;
    rests.push(r);
  }
  applyExtensionRest(rests, duties);
  for (const r of rests) {
    if (r.status === 'over') add('bad', isoDate(r.toMs), tr(`Riposo ${fmtHM(r.restMin)} sotto il minimo ${fmtHM(r.needMin)} (${r.why.join('; ')})${r.hasNight ? '' : ' — manca la notte locale'}`, `Rest ${fmtHM(r.restMin)} below the minimum ${fmtHM(r.needMin)} (${r.why.join('; ')})${r.hasNight ? '' : ' — local night missing'}`));
    else if (r.status === 'warn') add('warn', isoDate(r.toMs), tr(`Riposo ${fmtHM(r.restMin)} appena sopra il minimo ${fmtHM(r.needMin)}`, `Rest ${fmtHM(r.restMin)} just above the minimum ${fmtHM(r.needMin)}`));
  }

  // estensioni pianificate: non più di 2 in 7 giorni consecutivi (OMA 7.1.7.2)
  const extDuties = duties.filter((d) => d.extPlanned).sort((a, b) => a.startMs - b.startMs);
  extDuties.forEach((d, i) => {
    const inWeek = extDuties.filter((x, j) => j <= i && d.startMs - x.startMs < 7 * 86400000);
    if (inWeek.length > 2) add('bad', isoDate(d.startMs), tr(`${inWeek.length} Extension FDP in 7 giorni: massimo 2`, `${inWeek.length} FDP Extensions in 7 days: maximum 2`));
  });

  const busy = busyIntervals(sorted, duties, ctx);

  // stand-by e reserve
  let reserveRun = 0;
  let prevReserve = null;
  for (const b of busy) {
    if (b.kind === 'standby' && (b.to - b.from) / HOUR > 16) add('bad', b.date, tr(`Stand-by di ${fmtHM(Math.round((b.to - b.from) / MIN))}: massimo 16 h`, `Standby of ${fmtHM(Math.round((b.to - b.from) / MIN))}: maximum 16 h`));
    if (b.kind === 'reserve') {
      reserveRun = prevReserve && b.date === addDay(prevReserve) ? reserveRun + 1 : 1;
      prevReserve = b.date;
      if (reserveRun > 3) add('bad', b.date, tr(`${reserveRun} giorni di reserve consecutivi: massimo 3`, `${reserveRun} consecutive reserve days: maximum 3`));
    }
  }

  // limiti cumulativi: valore massimo raggiunto e data
  const cumulative = {};
  const dates = sorted.map((d) => d.date);
  const peak = (n, key, limit, label) => {
    let best = { min: 0, date: null };
    for (const date of dates) {
      const end = Date.parse(date + 'T00:00:00Z') + 86400000;
      const v = dutyInWindow(busy, end - n * 86400000, end);
      if (v > best.min) best = { min: v, date };
    }
    cumulative[key] = { ...best, limit };
    if (best.min > limit) add('bad', best.date, tr(`Duty ${label}: ${fmtHM(best.min)} sopra ${fmtHM(limit)}`, `Duty ${label}: ${fmtHM(best.min)} above ${fmtHM(limit)}`));
    else if (best.min > limit * 0.92) add('warn', best.date, tr(`Duty ${label}: ${fmtHM(best.min)} su ${fmtHM(limit)}`, `Duty ${label}: ${fmtHM(best.min)} of ${fmtHM(limit)}`));
  };
  peak(7, 'duty7', LIMITS.duty7, tr('in 7 giorni', 'in 7 days'));
  peak(14, 'duty14', LIMITS.duty14, tr('in 14 giorni', 'in 14 days'));
  peak(28, 'duty28', LIMITS.duty28, tr('in 28 giorni', 'in 28 days'));

  // giorni liberi da servizio, stand-by e reserve (giorno locale di base)
  const freeByMonth = {};
  for (const day of sorted) {
    if (day.spill) continue;
    const off = ctx.offset(Date.parse(day.date + 'T12:00:00Z'), ctx.base) * HOUR;
    const from = Date.parse(day.date + 'T00:00:00Z') - off;
    const to = from + 86400000;
    const free = !busy.some((b) => b.from < to && b.to > from);
    const key = day.date.slice(0, 7);
    freeByMonth[key] ??= { free: 0, days: 0 };
    freeByMonth[key].days++;
    if (free) freeByMonth[key].free++;
  }
  for (const [month, v] of Object.entries(freeByMonth)) {
    const complete = v.days >= 28;
    if (complete && v.free < 7) add('bad', `${month}-01`, tr(`Giorni liberi nel mese: ${v.free} (minimo 7)`, `Days off in the month: ${v.free} (minimum 7)`));
  }

  // recupero esteso: almeno 36 h con 2 notti locali, e non più di 168 h tra uno e l'altro
  const recoveries = [];
  for (let i = 1; i < busy.length; i++) {
    const from = Math.max(...busy.slice(0, i).map((b) => b.to));
    const to = busy[i].from;
    if (to - from >= 36 * HOUR && countLocalNights(from, to, ctx) >= 2) recoveries.push({ fromMs: from, toMs: to });
  }
  const merged = [];
  for (const r of recoveries) {
    const last = merged.at(-1);
    if (last && r.fromMs <= last.toMs) last.toMs = Math.max(last.toMs, r.toMs);
    else merged.push({ ...r });
  }
  for (let i = 1; i < merged.length; i++) {
    const gap = (merged[i].fromMs - merged[i - 1].toMs) / HOUR;
    if (gap > 168) add('bad', isoDate(merged[i].fromMs), tr(`${Math.round(gap)} h tra due recuperi estesi: massimo 168 h`, `${Math.round(gap)} h between two extended recovery rests: maximum 168 h`));
    // 4 o più notti/presto/tardi tra due recuperi: il secondo recupero sale a 60 h
    const between = duties.filter((d) => d.startMs >= merged[i - 1].toMs && d.startMs < merged[i].fromMs);
    const disruptive = between.filter((d) => d.tags.some((x) => ['notte', 'presto', 'tardi'].includes(x))).length;
    if (disruptive >= 4 && (merged[i].toMs - merged[i].fromMs) / HOUR < 60) add('warn', isoDate(merged[i].fromMs), tr(`${disruptive} servizi notte/presto/tardi: il recupero successivo dovrebbe essere di 60 h`, `${disruptive} night/early/late duties: the next recovery rest should be 60 h`));
  }

  issues.sort((a, b) => a.date.localeCompare(b.date) || (a.severity === 'bad' ? -1 : 1));
  return { duties, rests, cumulative, freeByMonth, recoveries: merged, issues, byDate: indexByDate(duties, rests) };
}

function addDay(iso) {
  return new Date(Date.parse(iso + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
}

function indexByDate(duties, rests) {
  const map = new Map();
  for (const d of duties) for (const date of d.dates) (map.get(date) ?? map.set(date, { duties: [], rests: [] }).get(date)).duties.push(d);
  for (const r of rests) {
    const date = isoDate(r.toMs);
    (map.get(date) ?? map.set(date, { duties: [], rests: [] }).get(date)).rests.push(r);
  }
  return map;
}
