import { locale, onLanguageChange } from "./i18n";

/**
 * Dates and figures in the language the app is in.
 *
 * The Mac's own locale is not the app's: a reader who picked Russian on an English
 * Mac should read Russian dates, and the numbers the app shows should follow the
 * same language rather than the system's. Every formatter is built per language and
 * kept, so changing the language changes the reading at once.
 */

const dateFormats = new Map<string, Intl.DateTimeFormat>();
const numberFormats = new Map<string, Intl.NumberFormat>();
const relativeFormats = new Map<string, Intl.RelativeTimeFormat>();

const DATE_DEFAULTS: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
const TIME_DEFAULTS: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };
const DATE_TIME_DEFAULTS: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
};
const NUMBER_DEFAULTS: Intl.NumberFormatOptions = { maximumFractionDigits: 2 };

const cacheKey = (lang: string, options: object): string => `${lang}|${JSON.stringify(options)}`;

function dateFormat(lang: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = cacheKey(lang, options);
  let format = dateFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(lang, options);
    dateFormats.set(key, format);
  }
  return format;
}

function numberFormat(lang: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = cacheKey(lang, options);
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(lang, options);
    numberFormats.set(key, format);
  }
  return format;
}

function relativeFormat(lang: string): Intl.RelativeTimeFormat {
  let format = relativeFormats.get(lang);
  if (!format) {
    format = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
    relativeFormats.set(lang, format);
  }
  return format;
}

/**
 * Builds the formatters of a language before anyone asks for one.
 *
 * The first formatter of a language costs more than the ones after it — the locale
 * data has to be read — and paying that inside a chat render would show up as a
 * stalled frame while an answer is arriving. It is paid at start-up instead.
 */
export function warmFormatters(lang: string = locale()): void {
  dateFormat(lang, DATE_DEFAULTS);
  dateFormat(lang, TIME_DEFAULTS);
  dateFormat(lang, DATE_TIME_DEFAULTS);
  numberFormat(lang, NUMBER_DEFAULTS);
  relativeFormat(lang);
}

onLanguageChange(() => warmFormatters());

/** A date the reader can read, or a dash when the value is not a date at all. */
function toDate(value: string | number | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(
  value: string | number | Date,
  options: Intl.DateTimeFormatOptions = DATE_DEFAULTS
): string {
  const date = toDate(value);
  if (!date) return "—";
  return dateFormat(locale(), options).format(date);
}

export function formatTime(
  value: string | number | Date,
  options: Intl.DateTimeFormatOptions = TIME_DEFAULTS
): string {
  const date = toDate(value);
  if (!date) return "—";
  return dateFormat(locale(), options).format(date);
}

export function formatDateTime(
  value: string | number | Date,
  options: Intl.DateTimeFormatOptions = DATE_TIME_DEFAULTS
): string {
  const date = toDate(value);
  if (!date) return "—";
  return dateFormat(locale(), options).format(date);
}

export function formatNumber(value: number, options: Intl.NumberFormatOptions = NUMBER_DEFAULTS): string {
  if (!Number.isFinite(value)) return "—";
  return numberFormat(locale(), options).format(value);
}

/** A size in the unit a reader would use, with the number in their language. */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${formatNumber(bytes, { maximumFractionDigits: 0 })} B`;
  if (bytes < 1024 * 1024) return `${formatNumber(bytes / 1024, { maximumFractionDigits: 1 })} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${formatNumber(bytes / 1024 / 1024, { maximumFractionDigits: 1 })} MB`;
  return `${formatNumber(bytes / 1024 / 1024 / 1024, { maximumFractionDigits: 2 })} GB`;
}

/** How long ago something happened, in the language the app is in. */
export function formatRelative(date: Date, now: number = Date.now()): string {
  const format = relativeFormat(locale());
  const seconds = Math.round((now - date.getTime()) / 1000);
  if (seconds < 60) return format.format(-seconds, "second");
  if (seconds < 3600) return format.format(-Math.round(seconds / 60), "minute");
  if (seconds < 86_400) return format.format(-Math.round(seconds / 3600), "hour");
  if (seconds < 604_800) return format.format(-Math.round(seconds / 86_400), "day");
  return format.format(-Math.round(seconds / 604_800), "week");
}

// The locale data is read once here, at start-up, rather than inside the first
// render of a message that is arriving.
warmFormatters();
