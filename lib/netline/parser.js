// Copiato da DK3 Roster (BoLu78/DK3-Roster, src/parser.js): lettore del PDF "Individual duty plan" NetLine.
// Parser del PDF "Individual duty plan" NetLine/Crew (Neos).
//
// Due passi:
//   1. extractPages: pdf.js -> frammenti di testo con coordinate (x, y) già
//      corrette per la rotazione della pagina (le pagine sono ruotate di 270°).
//   2. parseRoster: frammenti -> turni. Lavora per coordinate, non sul testo
//      concatenato. Ogni pagina ha due colonne (split x≈421): prima la sinistra,
//      poi la destra.
//
// Tutti gli orari nel PDF sono UTC e restano stringhe "hhmm"; la conversione
// in minuti/ora locale sta in timeline.js.

const SPLIT_X = 421; // colonna sinistra / destra
const COL_ORIGIN = [31, 432]; // x della data ("Thu01") nelle due colonne
const BODY_MIN_Y = 134; // sotto l'intestazione della tabella ("date H duty ...")
const ROW_GAP = 3; // frammenti con y più vicina di così sono sulla stessa riga

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const RE_DAY_LABEL = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)(\d\d)$/;
const RE_TIME = /^\d{4}$/;
const RE_IATA = /^[A-Z]{3}$/;
const RE_PDF_DATE = /^(\d\d)([A-Z][a-z]{2})(\d\d)$/;

// ---------------------------------------------------------------- estrazione

export async function extractPages(pdfjs, data) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items = [];
    for (const it of content.items) {
      const s = it.str.trim();
      if (!s) continue;
      const t = pdfjs.Util.transform(viewport.transform, it.transform);
      items.push({ x: Math.round(t[4]), y: Math.round(t[5]), s });
    }
    pages.push({ number: n, width: viewport.width, height: viewport.height, items });
  }
  return pages;
}

export async function parsePdf(pdfjs, data) {
  return parseRoster(await extractPages(pdfjs, data));
}

// ------------------------------------------------------------------- utilità

function pdfDateToIso(s) {
  const m = RE_PDF_DATE.exec(s);
  if (!m) return null;
  const mon = MONTHS.indexOf(m[2]);
  if (mon < 0) return null;
  return `${2000 + Number(m[3])}-${String(mon + 1).padStart(2, '0')}-${m[1]}`;
}

function isoAddDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function clusterRows(items) {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows = [];
  for (const it of sorted) {
    const last = rows[rows.length - 1];
    if (last && it.y - last.y <= ROW_GAP) {
      last.items.push(it);
      last.y = Math.max(last.y, it.y);
    } else {
      rows.push({ y: it.y, items: [it] });
    }
  }
  for (const r of rows) r.items.sort((a, b) => a.x - b.x);
  return rows;
}

// Righe del corpo di tutte le pagine, nell'ordine di lettura: sinistra poi destra.
function bodyRows(pages) {
  const out = [];
  for (const page of pages) {
    for (const col of [0, 1]) {
      const origin = COL_ORIGIN[col];
      const items = page.items
        .filter((it) => (it.x < SPLIT_X) === (col === 0) && it.y >= BODY_MIN_Y)
        .map((it) => ({ ...it, rel: it.x - origin }));
      for (const row of clusterRows(items)) {
        row.page = page.number;
        row.col = col;
        row.text = row.items.map((i) => i.s).join(' ');
        out.push(row);
      }
    }
  }
  return out;
}

const within = (it, lo, hi) => it.rel >= lo && it.rel <= hi;

// ----------------------------------------------------------------- intestazione

function parseMeta(pages) {
  const first = pages[0];
  const meta = { source: null, pilotCode: null, pilotName: null, contract: null };
  const all = first.items;
  // intestazione: metà sinistra e metà destra sono righe distinte
  const top = [0, 1].flatMap((col) => clusterRows(all.filter((i) => i.y < 70 && (i.x < SPLIT_X) === (col === 0))));
  for (const row of top) {
    const texts = row.items.map((i) => i.s);
    const line = texts.join(' ');
    if (/NOS\/CREW/.test(line)) meta.source = line;
    const f = texts.indexOf('for');
    if (f >= 0) {
      meta.pilotCode = texts[f + 1] ?? null;
      meta.pilotName = texts.slice(f + 2).join(' ') || null;
    }
    const p = texts.indexOf('Period:');
    if (p >= 0) {
      const dates = texts.slice(p + 1).map((t) => pdfDateToIso(t.replace(/\s*-\s*$/, '')));
      meta.periodStart = dates[0] ?? null;
      meta.periodEnd = dates[1] ?? null;
    }
    const c = texts.indexOf('contract:');
    if (c >= 0) meta.contract = Number(texts[c + 1]) || null;
    const pr = texts.findIndex((t) => /printed by/.test(t));
    if (pr >= 0) {
      meta.printedBy = texts[pr].replace(/^printed by\s*/, '') || null;
      const m = /(\d\d[A-Z][a-z]{2}\d\d)\s+(\d\d):(\d\d)/.exec(texts.slice(pr + 1).join(' '));
      if (m) meta.printedAt = `${pdfDateToIso(m[1])}T${m[2]}:${m[3]}`;
    }
  }
  const base = /^([A-Z]{3})NOS/.exec(meta.source ?? '');
  meta.base = base ? base[1] : 'MXP';
  return meta;
}

// Striscia riepilogativa in cima a ogni pagina: una colonna per giorno del
// mese (Off / Sby / FlD / Tsp / Sim con orario di inizio e fine). Occupa tutta
// la larghezza della pagina, quindi si legge senza dividere in colonne.
// La striscia copre al massimo 31 caselle a partire dall'inizio del periodo:
// con periodi più lunghi (es. 21 ott - 4 dic) i numeri dei giorni si ripetono,
// quindi ogni casella va abbinata alla sua data vera, in ordine da sinistra.
// Restituisce { 'AAAA-MM-GG': { type, start, end } }.
function parseStrip(page, periodStart) {
  const numbers = page.items.filter((i) => i.y >= 70 && i.y <= 80 && /^\d\d$/.test(i.s) && i.x > 100).sort((a, b) => a.x - b.x);
  const strip = {};
  let date = periodStart ? isoAddDays(periodStart, -1) : null;
  const rowY = (lo, hi) => page.items.filter((i) => i.y >= lo && i.y <= hi);
  const typeRow = rowY(81, 85);
  const startRow = rowY(87, 91);
  const endRow = rowY(93, 97);
  for (const n of numbers) {
    if (!date) break;
    // prossima data con quel numero di giorno (di solito il giorno dopo)
    let next = isoAddDays(date, 1);
    for (let k = 0; k < 3 && Number(next.slice(8)) !== Number(n.s); k++) next = isoAddDays(next, 1);
    if (Number(next.slice(8)) !== Number(n.s)) break;
    date = next;
    const pick = (row) => row.find((i) => Math.abs(i.x - (n.x - 6)) <= 8);
    const type = pick(typeRow);
    if (!type) continue;
    const s = pick(startRow);
    const e = pick(endRow);
    strip[date] = { type: type.s, start: s?.s ?? null, end: e?.s ?? null };
  }
  return strip;
}

// ---------------------------------------------------------------- giorni

function emptyDay(date, dow) {
  return {
    date,
    dow,
    kind: 'blank', // flight | transport | standby | sim | off | blank
    code: null, // OFF, STAND-BY, RESERVE ...
    airport: null,
    window: null, // finestra oraria di OFF/STAND-BY
    pickup: null,
    checkIn: null,
    checkOut: null,
    legs: [],
    seq: [], // eventi nell'ordine in cui compaiono nel PDF: pickup, ci, leg, co
    hotel: null,
    ft: null,
    dt: null,
    simFt: null,
    flags: [],
    notes: [],
    strip: null,
  };
}

function cellsOf(row) {
  const cells = { marker: null, hotel: null, duty: [], number: null, dep: null, depTime: null, arrTime: null, arr: null, ac: null, info: '', ft: null, dt: null, simFt: null, notes: [], dateLabel: null };
  for (const it of row.items) {
    const { rel, s } = it;
    if (rel < 14 && RE_DAY_LABEL.test(s)) cells.dateLabel = s;
    else if (rel >= 40 && rel <= 56 && /^(C\/I|C\/O|Briefing|Debriefing)$/.test(s)) cells.marker = s;
    else if (rel >= 30 && rel <= 44 && /^H\d$/.test(s)) cells.hotel = s;
    else if (rel >= 77 && rel <= 110 && /^\d{1,5}$/.test(s) && !cells.number) cells.number = s;
    else if (rel >= 40 && rel < 77 && /^DH\/[A-Z0-9]{2}$/.test(s)) cells.duty.push(s); // positioning, es. "DH/W4"
    else if (rel >= 55 && rel <= 130) cells.duty.push(s); // "OFF", "NO", "Pick" + "Up"
    else if (within(it, 148, 175) && RE_IATA.test(s)) cells.dep = s;
    else if (within(it, 182, 205) && RE_TIME.test(s)) cells.depTime = s;
    else if (within(it, 212, 234) && RE_TIME.test(s)) cells.arrTime = s;
    else if (within(it, 244, 272) && RE_IATA.test(s.trim())) cells.arr = s.trim();
    else if (within(it, 272, 300) && /^[AB]\d{3}/.test(s)) cells.ac = s;
    else if (rel >= 148 && rel < 268) cells.notes.push(s);
    else if (rel < 148) cells.notes.push(s);
  }
  // FT / DT / SIM FT dalla zona destra, ricomposta in testo
  const right = row.items.filter((i) => i.rel >= 268).map((i) => i.s).join(' ');
  let m = /\[SIM\s*FT\s*(\d+:\d\d)\]/.exec(right);
  if (m) cells.simFt = m[1];
  m = /\[FT\s*(\d+:\d\d)\]/.exec(right);
  if (m) cells.ft = m[1];
  m = /\[DT\s*(\d+:\d\d)\]/.exec(right);
  if (m) cells.dt = m[1];
  cells.info = right
    .replace(/\[SIM\s*FT\s*\d+:\d\d\]/g, '')
    .replace(/\[(FT|DT)\s*\d+:\d\d\]/g, '')
    .replace(/\b(B7\d\d|A3\d\d)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  cells.duty = cells.duty.join(' ').trim();
  cells.notes = cells.notes.join(' ').trim();
  return cells;
}

function applyRow(day, c) {
  if (c.hotel) day.hotel = { code: c.hotel, airport: c.dep ?? null };

  if (c.marker === 'C/I' || c.marker === 'Briefing') {
    const ci = { label: c.marker, airport: c.dep, time: c.depTime };
    day.checkIn ??= ci;
    day.seq.push({ t: 'ci', ...ci });
    return;
  }
  if (c.marker === 'C/O' || c.marker === 'Debriefing') {
    const co = { label: c.marker, airport: c.arr, time: c.arrTime };
    day.checkOut = co; // l'ultimo C/O del giorno
    day.seq.push({ t: 'co', ...co });
    if (c.ft) day.ft = c.ft;
    if (c.dt) day.dt = c.dt;
    return;
  }

  const duty = c.duty;
  if (/^(OFF|STAND-BY|RESERVE|HOL)$/.test(duty)) {
    day.code = duty;
    day.airport = c.dep;
    if (c.depTime && c.arrTime && !(c.depTime === '0000' && c.arrTime === '0000')) day.window = { start: c.depTime, end: c.arrTime };
  } else if (/^Pick Up$/.test(duty)) {
    day.pickup ??= c.depTime;
    day.seq.push({ t: 'pickup', time: c.depTime });
  } else if (duty === 'E_FDP') {
    day.flags.push('E_FDP');
  } else if (/^DH\/[A-Z0-9]{2}$/.test(duty) && c.number) {
    // positioning su altra compagnia ("DH/W4 6403"): trasferimento, non settore
    day.legs.push(newLeg('transport', c, { code: `DH ${duty.slice(3)} ${c.number}`, airline: duty.slice(3), number: c.number }));
    day.seq.push({ t: 'leg', index: day.legs.length - 1 });
  } else if (/^(?=.*[A-Z])[A-Z0-9]{2}$/.test(duty) && c.number) {
    // volo: prefisso compagnia di 2 caratteri (NO, IZ, ...)
    day.legs.push(newLeg('flight', c, { airline: duty, number: c.number }));
    day.seq.push({ t: 'leg', index: day.legs.length - 1 });
  } else if (/^[A-Z]{3}-[A-Z]{3}$/.test(duty)) {
    day.legs.push(newLeg('transport', c, { code: duty }));
    day.seq.push({ t: 'leg', index: day.legs.length - 1 });
  } else if (/^[A-Z0-9]{2,5}_[A-Z0-9]{1,4}$/.test(duty)) {
    // attività a terra o simulatore: "MXP_001", "GRT_B78", "MED_PIL"
    day.legs.push(newLeg('ground', c, { code: duty }));
    day.seq.push({ t: 'leg', index: day.legs.length - 1 });
  } else if (duty === 'X') {
    day.code = 'X';
  } else if (duty) {
    day.notes.push(duty);
  } else if (c.notes && !c.dep && !c.depTime) {
    // riga di nota: va all'ultimo servizio ("LC 73 Trainee", "OPC 73 Trainee")
    const last = day.legs[day.legs.length - 1];
    let text = c.notes;
    if (last && /Take-off|Landing/.test(text)) {
      // chi ha fatto decollo e/o atterraggio su questa tratta
      last.takeoff = /Take-off/.test(text);
      last.landing = /Landing/.test(text);
      text = text.replace(/Take-off,?|Landing,?/g, '').replace(/\s+/g, ' ').trim();
    }
    if (text && last) last.note = [last.note, text].filter(Boolean).join(' ');
    else if (text) day.notes.push(text);
  }
  if (c.ft && !day.ft) day.ft = c.ft;
  if (c.dt && !day.dt) day.dt = c.dt;
  if (c.simFt) day.simFt = c.simFt;
}

// tipo di giornata dal contenuto, per i giorni che la striscia non copre
function kindFromContent(day) {
  if (day.legs.some((l) => l.kind === 'flight')) return 'flight';
  if (day.legs.some((l) => l.kind === 'ground')) return 'ground';
  if (day.legs.length) return 'transport';
  if (day.code === 'OFF') return 'off';
  if (day.code === 'HOL') return 'vacation';
  if (day.code === 'STAND-BY' || day.code === 'RESERVE') return 'standby';
  if (day.code === 'X' || day.checkOut || day.hotel) return 'rest';
  return 'blank';
}

const looksLikeSim = (code) => /SIM|FFS|^[A-Z]{3}_\d+$/.test(code ?? '');

function newLeg(kind, c, extra) {
  return {
    kind,
    airline: null,
    number: null,
    code: null,
    dep: c.dep,
    arr: c.arr,
    depTime: c.depTime,
    arrTime: c.arrTime,
    ac: c.ac,
    info: c.info || null,
    note: null,
    takeoff: false,
    landing: false,
    crew: null,
    ...extra,
  };
}

// ---------------------------------------------------------------- sezioni

const SECTION_TITLES = [
  [/^Crew Information on Leg/, 'crewLeg'],
  [/^Crew Information on\s*Ground Activity/, 'crewGround'],
  [/^Hotels$/, 'hotels'],
  [/^Recurrent Training \/ Checks/, 'recurrent'],
  [/^Airport Information/, 'airports'],
  [/^Absence\/Ground Activity Legend/, 'legend'],
];

function parseTotals(row, totals) {
  // le etichette possono arrivare intere ("Duty time") o spezzate ("Duty" + "time")
  const t = row.items.map((i) => i.s).join(' ').replace(/\s+/g, ' ');
  const val = (re) => re.exec(t)?.[1] ?? null;
  const ft = val(/Flight time (\d+:\d\d)/);
  const dt = val(/Duty time (\d+:\d\d)/);
  const offDays = val(/Off days (\d+)/);
  const offClaim = val(/Off claim (\d+)/);
  if (ft) totals.ft = ft;
  if (dt) totals.dt = dt;
  if (offDays) totals.offDays = Number(offDays);
  if (offClaim) totals.offClaim = Number(offClaim);
}

function parseCrewCodes(items) {
  // "MXC", "RON [TRE]", "[LC2]" come frammenti separati o uniti
  const out = [];
  for (const it of items) {
    const m = /^([A-Z0-9]{3})(?:\s*\[(.+)\])?$/.exec(it.s);
    if (m) out.push({ code: m[1], tag: m[2] ?? null });
    else if (/^\[(.+)\]$/.test(it.s) && out.length) out[out.length - 1].tag = it.s.slice(1, -1);
  }
  return out;
}

export function parseRoster(pages) {
  const meta = parseMeta(pages);
  const strip = parseStrip(pages[0], meta.periodStart);
  const totals = { ft: null, dt: null, offDays: null, offClaim: null };
  const hotels = {};
  const airports = {};
  const recurrent = [];
  const crewLegs = []; // {date, number, depTime, cockpit:[], cabin:[]}
  const crewGround = []; // {date, code, crew:[]}
  const dayBlocks = [];

  let state = 'days';
  let curDay = null;
  let curCrew = null;
  let curGroup = null;
  let curHotel = null;
  let curRecurrent = null;

  for (const row of bodyRows(pages)) {
    const title = SECTION_TITLES.find(([re]) => re.test(row.text));
    if (title) {
      state = title[1];
      curCrew = curHotel = curRecurrent = null;
      continue;
    }
    if (/^Flight time/.test(row.text) || /^(Off days|Off claim)/.test(row.text) || row.items.some((i) => i.s === 'Off days' || i.s === 'Off claim')) {
      parseTotals(row, totals);
      continue;
    }

    if (state === 'days') {
      const c = cellsOf(row);
      if (c.dateLabel) {
        curDay = { label: c.dateLabel, cellsList: [] };
        dayBlocks.push(curDay);
      }
      if (curDay) curDay.cellsList.push(c);
    } else if (state === 'hotels') {
      const code = row.items.find((i) => i.rel < 20 && /^H\d$/.test(i.s));
      const rest = row.items.filter((i) => i !== code);
      if (code) {
        curHotel = { code: code.s, name: '', phone: '' };
        hotels[code.s] = curHotel;
      }
      if (!curHotel) continue;
      const phoneAt = rest.findIndex((i) => /^\+\d+$/.test(i.s));
      const nameParts = (phoneAt >= 0 ? rest.slice(0, phoneAt) : rest).map((i) => i.s);
      if (phoneAt >= 0) curHotel.phone = rest.slice(phoneAt).map((i) => i.s).join(' ');
      if (code && /^[A-Z0-9]{2,5}$/.test(nameParts[0] ?? '') && nameParts.length > 1) nameParts.shift();
      curHotel.name = [curHotel.name, ...nameParts].filter(Boolean).join(' ');
    } else if (state === 'recurrent') {
      const d = row.items.find((i) => i.rel < 40 && RE_PDF_DATE.test(i.s));
      if (d) {
        const code = row.items.find((i) => i.rel >= 60 && i.rel < 112);
        const nameParts = row.items.filter((i) => i.rel >= 112).map((i) => i.s);
        // il codice e l'inizio del nome possono stare nello stesso frammento ("EST78_RT EST")
        let codeText = code?.s ?? '';
        const sp = codeText.indexOf(' ');
        if (sp > 0) {
          nameParts.unshift(codeText.slice(sp + 1));
          codeText = codeText.slice(0, sp);
        }
        curRecurrent = { expiry: pdfDateToIso(d.s), code: codeText, nameRaw: nameParts.join(' ') };
        recurrent.push(curRecurrent);
      } else if (curRecurrent) {
        curRecurrent.nameRaw = [curRecurrent.nameRaw, ...row.items.filter((i) => i.rel >= 100).map((i) => i.s)].join(' ').trim();
      }
    } else if (state === 'airports') {
      const iata = row.items.find((i) => i.rel < 20 && RE_IATA.test(i.s));
      if (iata) {
        const country = row.items.find((i) => i.rel >= 60 && i.rel < 130);
        const name = row.items.filter((i) => i.rel >= 130).map((i) => i.s).join(' ');
        airports[iata.s] = { country: country?.s ?? null, name };
      }
    } else if (state === 'crewLeg') {
      const label = row.items.find((i) => i.rel < 16 && RE_DAY_LABEL.test(i.s));
      if (label) {
        const num = row.items.find((i) => i.rel >= 55 && /^\d{1,5}$/.test(i.s));
        const times = row.items.filter((i) => i.rel >= 100 && RE_TIME.test(i.s));
        curCrew = { label: label.s, number: num?.s ?? null, depTime: times[0]?.s ?? null, cockpit: [], cabin: [] };
        crewLegs.push(curCrew);
        curGroup = null;
        continue;
      }
      if (!curCrew || /^date\b/.test(row.text)) continue;
      if (row.items.some((i) => /^cockpit:/.test(i.s))) curGroup = 'cockpit';
      if (row.items.some((i) => /^cabin:/.test(i.s))) curGroup = 'cabin';
      if (curGroup) {
        // "cockpit: MXC" può essere un unico frammento: si toglie l'etichetta
        const items = row.items.map((i) => ({ ...i, s: i.s.replace(/^(cockpit|cabin):\s*/, '') })).filter((i) => i.s && i.rel >= 30);
        curCrew[curGroup].push(...parseCrewCodes(items));
      }
    } else if (state === 'crewGround') {
      const label = row.items.find((i) => i.rel < 16 && RE_DAY_LABEL.test(i.s));
      if (label) {
        const code = row.items.find((i) => i.rel >= 30 && i.rel < 100 && /^[A-Z0-9]{2,5}_[A-Z0-9]{1,4}$/.test(i.s));
        curCrew = { label: label.s, code: code?.s ?? null, crew: [] };
        crewGround.push(curCrew);
        continue;
      }
      if (curCrew && curCrew.crew) curCrew.crew.push(...parseCrewCodes(row.items.filter((i) => i.rel >= 100)));
    }
  }

  // ---- giorni: calendario del periodo + blocchi trovati
  const days = [];
  const byDate = new Map();
  if (meta.periodStart && meta.periodEnd) {
    for (let d = meta.periodStart; d <= meta.periodEnd; d = isoAddDays(d, 1)) {
      const dow = DOW[new Date(d + 'T00:00:00Z').getUTCDay()];
      const day = emptyDay(d, dow);
      days.push(day);
      byDate.set(d, day);
    }
  }
  const dateOfLabel = (label) => {
    const m = RE_DAY_LABEL.exec(label);
    return days.find((d) => d.dow === m[1] && d.date.slice(8) === m[2])?.date ?? null;
  };
  const warnings = [];
  // Il PDF può contenere qualche giorno subito dopo (o prima) del periodo: un servizio
  // che sconfina. Si tengono a parte (spill) e non entrano nei totali.
  const spill = [];
  const spillDay = (label) => {
    const m = RE_DAY_LABEL.exec(label);
    for (let off = 1; off <= 7; off++) {
      for (const d of [isoAddDays(meta.periodEnd, off), isoAddDays(meta.periodStart, -off)]) {
        if (DOW[new Date(d + 'T00:00:00Z').getUTCDay()] === m[1] && d.slice(8) === m[2]) {
          let day = spill.find((x) => x.date === d);
          if (!day) {
            day = emptyDay(d, m[1]);
            spill.push(day);
          }
          return day;
        }
      }
    }
    return null;
  };
  for (const block of dayBlocks) {
    const date = dateOfLabel(block.label);
    const day = byDate.get(date) ?? spillDay(block.label);
    if (!day) {
      warnings.push(`Giorno ${block.label} non riconosciuto`);
      continue;
    }
    for (const c of block.cellsList) applyRow(day, c);
  }
  for (const day of spill) {
    day.spill = true;
    day.kind = day.legs.some((l) => l.kind === 'flight') ? 'flight' : day.code === 'OFF' ? 'off' : day.code === 'HOL' ? 'vacation' : day.code ? 'standby' : 'blank';
  }

  // striscia riepilogativa -> tipo di giornata
  const KIND = { Off: 'off', Sby: 'standby', FlD: 'flight', Tsp: 'transport', Sim: 'sim', Vac: 'vacation', Dty: 'ground' };
  // "X": nessun nuovo servizio (riposo fuori sede) oppure coda di un servizio iniziato il giorno prima
  const kindOfX = (d) => (d.legs.some((l) => l.kind === 'flight') ? 'flight' : d.legs.length ? 'transport' : 'rest');
  for (const day of days) {
    const s = strip[day.date];
    if (s) {
      day.strip = s;
      day.kind = s.type === 'X' ? kindOfX(day) : KIND[s.type] ?? 'other';
    } else day.kind = kindFromContent(day); // giorno oltre la striscia
    // le attività di terra sono simulatore solo se la striscia dice Sim (o, senza striscia, dal codice)
    for (const l of day.legs) {
      if (l.kind === 'ground') l.sim = s ? s.type === 'Sim' : looksLikeSim(l.code);
    }
    if (!s && day.kind === 'ground' && day.legs.some((l) => l.sim)) day.kind = 'sim';
  }

  // equipaggio -> tratte
  for (const cl of crewLegs) {
    const date = dateOfLabel(cl.label);
    const day = byDate.get(date);
    const leg = day?.legs.find((l) => l.kind === 'flight' && l.number === cl.number && l.depTime === cl.depTime);
    if (leg) leg.crew = { cockpit: cl.cockpit, cabin: cl.cabin };
    else warnings.push(`Equipaggio senza tratta: ${cl.label} ${cl.number}`);
  }
  for (const cg of crewGround) {
    const date = dateOfLabel(cg.label);
    const leg = byDate.get(date)?.legs.find((l) => l.kind === 'ground' && l.code === cg.code);
    if (leg) leg.crew = { cockpit: [], cabin: [], other: cg.crew };
  }

  // l'equipaggio è elencato una volta per servizio di volo (sulla prima tratta):
  // le tratte successive dello stesso giorno hanno lo stesso equipaggio
  for (const day of days) {
    let last = null;
    for (const leg of day.legs) {
      if (leg.kind !== 'flight') continue;
      if (leg.crew) last = leg.crew;
      else if (last) leg.crew = { ...last, shared: true };
    }
  }

  // hotel: nome e telefono dalla tabella
  for (const day of days) {
    if (day.hotel && hotels[day.hotel.code]) day.hotel = { ...day.hotel, name: hotels[day.hotel.code].name, phone: hotels[day.hotel.code].phone };
  }

  return { meta, days, spill, totals, hotels, airports, recurrent, warnings };
}

// ------------------------------------------------------------- calcoli sui turni

export function hhmmToMinutes(s) {
  if (!s) return 0;
  const m = /^(\d+):(\d\d)$/.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

export function minutesToHhmm(min) {
  const h = Math.floor(min / 60);
  return `${h}:${String(min % 60).padStart(2, '0')}`;
}

// Somma FT/DT dei giorni e confronto con i totali stampati nel PDF.
export function checkTotals(roster) {
  const ft = roster.days.reduce((a, d) => a + hhmmToMinutes(d.ft), 0);
  const dt = roster.days.reduce((a, d) => a + hhmmToMinutes(d.dt), 0);
  const off = roster.days.filter((d) => d.kind === 'off').length;
  const p = roster.totals;
  return {
    computed: { ft: minutesToHhmm(ft), dt: minutesToHhmm(dt), offDays: off },
    printed: p,
    ftOk: p.ft ? hhmmToMinutes(p.ft) === ft : null,
    dtOk: p.dt ? hhmmToMinutes(p.dt) === dt : null,
    offOk: p.offDays != null ? p.offDays === off : null,
  };
}
