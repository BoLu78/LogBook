// Copiato da DK3 Roster (BoLu78/DK3-Roster, src/i18n.js, v1.14.1): stesso codice, così LogBook e DK3 calcolano allo stesso modo.
// Lingua dell'app: italiano (predefinita) o inglese.
// Ogni testo è scritto nelle due lingue nello stesso punto del codice: tr('Volo', 'Flight').
// Così chi modifica un testo vede subito anche l'altra lingua.

let lang = 'it';

export function setLang(l) {
  lang = l === 'en' ? 'en' : 'it';
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
}

export const getLang = () => lang;
export const isEn = () => lang === 'en';

// testo nella lingua scelta
export const tr = (it, en) => (lang === 'en' ? en : it);

// singolare / plurale: plural(3, 'giorno', 'giorni', 'day', 'days') -> "3 giorni"
export const plural = (n, itOne, itMany, enOne, enMany) => `${n} ${lang === 'en' ? (n === 1 ? enOne : enMany) : n === 1 ? itOne : itMany}`;

// nomi di giorni e mesi
const DOW_SHORT = { it: ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'], en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] };
const DOW_LONG = { it: ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'], en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] };
const MONTHS = {
  it: ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};
const MONTHS_SHORT = { it: ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'], en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] };

export const dowShort = (i) => DOW_SHORT[lang][i];
export const dowLong = (i) => DOW_LONG[lang][i];
export const monthName = (i) => MONTHS[lang][i];
export const monthShort = (i) => MONTHS_SHORT[lang][i];
export const locale = () => (lang === 'en' ? 'en-GB' : 'it-IT');
