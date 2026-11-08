import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { locale, onLanguageChange, setLanguage, t } from "../../src/renderer/i18n";
import {
  formatDate,
  formatDateTime,
  formatNumber,
  formatRelative,
  formatSize,
  formatTime,
} from "../../src/renderer/format";

/**
 * The Mac's own locale is not the app's. A reader who picked Russian on an
 * English Mac must still read Russian dates and Russian figures, so every
 * formatted value here follows the language chosen in the app.
 */

/** A local date, so the assertion holds in whatever timezone the test runs. */
const NOVEMBER = new Date(2026, 10, 5, 15, 0, 0);

const original = (globalThis as { document?: unknown }).document;

before(() => {
  (globalThis as { document?: unknown }).document = { documentElement: { lang: "en" } };
});

after(() => {
  (globalThis as { document?: unknown }).document = original;
});

test("a date reads in the language the app is in", () => {
  setLanguage("en");
  assert.equal(formatDate(NOVEMBER), "Nov 5");

  setLanguage("ru");
  assert.equal(formatDate(NOVEMBER), "5 нояб.");
});

test("a time reads in the language the app is in", () => {
  setLanguage("en");
  assert.equal(formatTime(NOVEMBER), "03:00 PM");

  setLanguage("ru");
  assert.equal(formatTime(NOVEMBER), "15:00");
});

test("a date and a time together read in the language the app is in", () => {
  setLanguage("en");
  const english = formatDateTime(NOVEMBER);

  setLanguage("ru");
  const russian = formatDateTime(NOVEMBER);

  assert.notEqual(english, russian);
  assert.ok(english.includes("Nov"));
  assert.ok(russian.includes("нояб."));
});

test("a figure reads in the language the app is in", () => {
  setLanguage("en");
  assert.equal(formatNumber(1234.5), "1,234.5");

  setLanguage("ru");
  // Russian groups its digits with a non-breaking space, not a plain one.
  assert.equal(formatNumber(1234.5), "1\u00a0234,5");
});

test("the language of the app is the one that is formatted, not the Mac's", () => {
  // The Mac can be set to anything; the app's own language is what counts.
  setLanguage("ru");
  assert.equal(locale(), "ru-RU");
  assert.equal(formatNumber(1000), "1\u00a0000");

  setLanguage("en");
  assert.equal(locale(), "en-US");
  assert.equal(formatNumber(1000), "1,000");
});

test("how long ago it happened reads in the language the app is in", () => {
  const now = new Date(2026, 10, 5, 15, 2, 0).getTime();

  setLanguage("en");
  assert.equal(formatRelative(new Date(2026, 10, 5, 15, 0, 0), now), "2 minutes ago");

  setLanguage("ru");
  assert.equal(formatRelative(new Date(2026, 10, 5, 15, 0, 0), now), "2 минуты назад");
});

test("a size is scaled and reads in the language the app is in", () => {
  setLanguage("en");
  assert.equal(formatSize(512), "512 B");
  assert.equal(formatSize(1536), "1.5 KB");
  assert.equal(formatSize(5_000_000), "4.8 MB");
  assert.equal(formatSize(3_000_000_000), "2.79 GB");

  setLanguage("ru");
  assert.equal(formatSize(1536), "1,5 KB");
  assert.equal(formatSize(5_000_000), "4,8 MB");
  assert.equal(formatSize(3_000_000_000), "2,79 GB");
});

test("a value that is not a date reads as a dash rather than nonsense", () => {
  setLanguage("en");
  assert.equal(formatDate("not a date"), "—");
  assert.equal(formatTime(Number.NaN), "—");
  assert.equal(formatDateTime(undefined as unknown as string), "—");
});

test("a figure that is not a number reads as a dash", () => {
  setLanguage("en");
  assert.equal(formatNumber(Number.NaN), "—");
  assert.equal(formatNumber(Number.POSITIVE_INFINITY), "—");
  assert.equal(formatSize(-1), "—");
});

test("a date written as text is understood", () => {
  setLanguage("en");
  assert.equal(formatDate("2026-11-05T15:00:00"), "Nov 5");
});

test("a count that is put into a sentence keeps the language's own grouping", () => {
  setLanguage("en");
  assert.equal(t("chat.tokens", { count: formatNumber(12_345) }), "12,345 tokens");

  setLanguage("ru");
  assert.equal(t("chat.tokens", { count: formatNumber(12_345) }), "12\u00a0345 ток.");
});

test("changing the language tells whatever is built for one language to follow", () => {
  setLanguage("en");

  let told = 0;
  const off = onLanguageChange(() => {
    told += 1;
  });

  setLanguage("ru");
  setLanguage("en");
  setLanguage("en");
  off();
  setLanguage("ru");

  // Two changes, not three: setting the language it already has changes nothing,
  // and a listener that has stepped aside hears nothing at all.
  assert.equal(told, 2);
});
