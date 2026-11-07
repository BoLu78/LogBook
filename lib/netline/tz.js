// Copiato da DK3 Roster (BoLu78/DK3-Roster, src/tz.js, v1.10.0).
// Aeroporto -> fuso orario (IANA). Serve per convertire gli orari UTC del PDF
// in ora locale. Le regole dell'ora legale le gestisce il browser (Intl).
//
// Ordine di ricerca: tabella per codice IATA, poi tabella per paese (usando il
// paese scritto nel PDF, valido solo per paesi con un solo fuso).

const BY_AIRPORT = {
  // Isole Canarie
  FUE: 'Atlantic/Canary', ACE: 'Atlantic/Canary', LPA: 'Atlantic/Canary', TFS: 'Atlantic/Canary', TFN: 'Atlantic/Canary', SPC: 'Atlantic/Canary', GMZ: 'Atlantic/Canary', VDE: 'Atlantic/Canary',
  // Portogallo isole
  FNC: 'Atlantic/Madeira', PXO: 'Atlantic/Madeira', PDL: 'Atlantic/Azores', TER: 'Atlantic/Azores',
  // Capo Verde
  SID: 'Atlantic/Cape_Verde', BVC: 'Atlantic/Cape_Verde', RAI: 'Atlantic/Cape_Verde',
  // Africa orientale e Oceano Indiano
  MBA: 'Africa/Nairobi', NBO: 'Africa/Nairobi', MYD: 'Africa/Nairobi', ZNZ: 'Africa/Dar_es_Salaam', JRO: 'Africa/Dar_es_Salaam', DAR: 'Africa/Dar_es_Salaam',
  NOS: 'Indian/Antananarivo', TNR: 'Indian/Antananarivo', DIE: 'Indian/Antananarivo', MLE: 'Indian/Maldives', GAN: 'Indian/Maldives',
  MRU: 'Indian/Mauritius', SEZ: 'Indian/Mahe', RUN: 'Indian/Reunion', CMB: 'Asia/Colombo', HRI: 'Asia/Colombo',
  // Medio Oriente
  SLL: 'Asia/Muscat', MCT: 'Asia/Muscat', DXB: 'Asia/Dubai', AUH: 'Asia/Dubai', SHJ: 'Asia/Dubai', DWC: 'Asia/Dubai', RKT: 'Asia/Dubai',
  AQJ: 'Asia/Amman', AMM: 'Asia/Amman', TLV: 'Asia/Jerusalem', DOH: 'Asia/Qatar', BAH: 'Asia/Bahrain', KWI: 'Asia/Kuwait',
  // Asia
  BKK: 'Asia/Bangkok', HKT: 'Asia/Bangkok', USM: 'Asia/Bangkok', DMK: 'Asia/Bangkok', KBV: 'Asia/Bangkok', DEL: 'Asia/Kolkata', BOM: 'Asia/Kolkata', GOI: 'Asia/Kolkata',
  HAN: 'Asia/Ho_Chi_Minh', SGN: 'Asia/Ho_Chi_Minh', PQC: 'Asia/Ho_Chi_Minh', DPS: 'Asia/Makassar', SIN: 'Asia/Singapore',
  // Caraibi e Americhe
  PUJ: 'America/Santo_Domingo', SDQ: 'America/Santo_Domingo', LRM: 'America/Santo_Domingo', POP: 'America/Santo_Domingo', SAJ: 'America/Santo_Domingo',
  CUN: 'America/Cancun', CZM: 'America/Cancun', TQO: 'America/Cancun', MBJ: 'America/Jamaica', KIN: 'America/Jamaica',
  HAV: 'America/Havana', VRA: 'America/Havana', CCC: 'America/Havana', HOG: 'America/Havana', CYO: 'America/Havana', SNU: 'America/Havana',
  BGI: 'America/Barbados', ANU: 'America/Antigua', AUA: 'America/Aruba', CUR: 'America/Curacao', SXM: 'America/Lower_Princes', PTP: 'America/Guadeloupe', FDF: 'America/Martinique',
  NAS: 'America/Nassau', GND: 'America/Grenada', UVF: 'America/St_Lucia', SJU: 'America/Puerto_Rico', PLS: 'America/Grand_Turk',
  JFK: 'America/New_York', EWR: 'America/New_York', MIA: 'America/New_York', BOS: 'America/New_York', IAD: 'America/New_York', MCO: 'America/New_York', FLL: 'America/New_York',
  YYZ: 'America/Toronto', LAX: 'America/Los_Angeles', SFO: 'America/Los_Angeles', ORD: 'America/Chicago',
  NAT: 'America/Fortaleza', FOR: 'America/Fortaleza', REC: 'America/Recife', MCZ: 'America/Maceio', SSA: 'America/Bahia', GRU: 'America/Sao_Paulo', GIG: 'America/Sao_Paulo',
  CCS: 'America/Caracas', BOG: 'America/Bogota', CTG: 'America/Bogota', LIM: 'America/Lima',
  // Africa
  DJE: 'Africa/Tunis', MIR: 'Africa/Tunis', NBE: 'Africa/Tunis', TUN: 'Africa/Tunis',
  // Marocco: ora GMT fissa dal 20 set 2026 (i fusi di telefoni e computer non lo sanno ancora)
  RAK: 'UTC', AGA: 'UTC', CMN: 'UTC', FEZ: 'UTC', TNG: 'UTC', ESU: 'UTC', OUD: 'UTC', NDR: 'UTC', OZZ: 'UTC', RBA: 'UTC', VIL: 'UTC',
  DSS: 'Africa/Dakar', BJL: 'Africa/Banjul', ACC: 'Africa/Accra', LOS: 'Africa/Lagos', WDH: 'Africa/Windhoek', CPT: 'Africa/Johannesburg', JNB: 'Africa/Johannesburg',
  VFA: 'Africa/Harare', LVI: 'Africa/Lusaka', MPM: 'Africa/Maputo', ADD: 'Africa/Addis_Ababa',
  // Europa
  LCA: 'Asia/Nicosia', PFO: 'Asia/Nicosia', AYT: 'Europe/Istanbul', DLM: 'Europe/Istanbul', BJV: 'Europe/Istanbul', IST: 'Europe/Istanbul', SAW: 'Europe/Istanbul',
  KEF: 'Atlantic/Reykjavik', LHR: 'Europe/London', LGW: 'Europe/London', MAN: 'Europe/London', DUB: 'Europe/Dublin',
};

const BY_COUNTRY = {
  ITALY: 'Europe/Rome', EGYPT: 'Africa/Cairo', SPAIN: 'Europe/Madrid', GREECE: 'Europe/Athens', FRANCE: 'Europe/Paris', GERMANY: 'Europe/Berlin',
  AUSTRIA: 'Europe/Vienna', SWITZERLAND: 'Europe/Zurich', NETHERLANDS: 'Europe/Amsterdam', BELGIUM: 'Europe/Brussels', MALTA: 'Europe/Malta',
  CROATIA: 'Europe/Zagreb', SLOVENIA: 'Europe/Ljubljana', ALBANIA: 'Europe/Tirane', BULGARIA: 'Europe/Sofia', ROMANIA: 'Europe/Bucharest',
  TURKEY: 'Europe/Istanbul', TUNISIA: 'Africa/Tunis', MOROCCO: 'UTC', JORDAN: 'Asia/Amman', ISRAEL: 'Asia/Jerusalem',
  OMAN: 'Asia/Muscat', 'UNITED ARAB EMIRATES': 'Asia/Dubai', KENYA: 'Africa/Nairobi', TANZANIA: 'Africa/Dar_es_Salaam', MALDIVES: 'Indian/Maldives',
  MAURITIUS: 'Indian/Mauritius', SEYCHELLES: 'Indian/Mahe', MADAGASCAR: 'Indian/Antananarivo', 'CAPE VERDE': 'Atlantic/Cape_Verde',
  JAMAICA: 'America/Jamaica', CUBA: 'America/Havana', 'DOMINICAN REPUBLIC': 'America/Santo_Domingo', THAILAND: 'Asia/Bangkok', 'SRI LANKA': 'Asia/Colombo',
  SENEGAL: 'Africa/Dakar', GAMBIA: 'Africa/Banjul', GHANA: 'Africa/Accra', ETHIOPIA: 'Africa/Addis_Ababa', NAMIBIA: 'Africa/Windhoek',
  'SOUTH AFRICA': 'Africa/Johannesburg', ZANZIBAR: 'Africa/Dar_es_Salaam', CYPRUS: 'Asia/Nicosia', ICELAND: 'Atlantic/Reykjavik',
  'UNITED KINGDOM': 'Europe/London', IRELAND: 'Europe/Dublin', PORTUGAL: 'Europe/Lisbon', POLAND: 'Europe/Warsaw', 'CZECH REPUBLIC': 'Europe/Prague',
  HUNGARY: 'Europe/Budapest', SERBIA: 'Europe/Belgrade', MONTENEGRO: 'Europe/Podgorica', 'BOSNIA AND HERZEGOVINA': 'Europe/Sarajevo',
};

// Restituisce il fuso IANA, oppure null se non lo conosciamo (in quel caso
// l'app mostra solo l'orario UTC).
export function timezoneFor(iata, airports = {}) {
  if (!iata) return null;
  if (BY_AIRPORT[iata]) return BY_AIRPORT[iata];
  const country = airports[iata]?.country?.toUpperCase();
  return (country && BY_COUNTRY[country]) || null;
}

export const KNOWN_AIRPORT_COUNT = Object.keys(BY_AIRPORT).length;

// Ora locale di un fuso -> istante UTC (ms). isoDate "AAAA-MM-GG", hhmm "1415".
// L'ora legale la calcola il browser: si parte dall'ipotesi UTC e si corregge
// con lo scarto del fuso in quel momento (due passaggi bastano anche al cambio d'ora).
const tzFormatters = new Map();
function offsetMin(ms, tz) {
  let f = tzFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    tzFormatters.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - Math.floor(ms / 60000) * 60000) / 60000;
}

export function localToUtcMs(isoDate, hhmm, tz) {
  const wall = Date.parse(`${isoDate}T${hhmm.slice(0, 2)}:${hhmm.slice(2, 4)}:00Z`);
  if (!tz) return wall;
  let ms = wall - offsetMin(wall, tz) * 60000;
  ms = wall - offsetMin(ms, tz) * 60000;
  return ms;
}
