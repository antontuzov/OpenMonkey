/**
 * The third language, and what it proves about the app.
 *
 * Arabic is written from the right, so it is the language that puts the
 * mirrored layout to work: the panel stands on the other side of the window and
 * the text runs the other way. The strings themselves are a translation and not
 * a native review, and this file says so where it can be checked.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { STRINGS, direction, moodLabel, setLanguage, type StringKey } from "../../src/renderer/i18n";
import { formatDate, formatNumber } from "../../src/renderer/format";

const original = (globalThis as { document?: unknown }).document;
(globalThis as { document?: unknown }).document = { documentElement: { lang: "en", dir: "ltr" } };

/** The strings that are the same in every language, because they are technical. */
const SAME_IN_EVERY_LANGUAGE = [
  "appearance.tokenHex",
  "appearance.sendEnter",
  "appearance.sendCmdEnter",
];

const ARABIC = /[؀-ۿ]/;

test.after(() => {
  (globalThis as { document?: unknown }).document = original;
});

test("every language has a word for every word", () => {
  const keys = Object.keys(STRINGS.en) as StringKey[];

  for (const [language, table] of Object.entries(STRINGS)) {
    assert.deepEqual(Object.keys(table).sort(), [...keys].sort(), `${language} is missing a word`);
    for (const key of keys) {
      assert.ok(table[key].trim().length > 0, `${language} has nothing for ${key}`);
    }
  }
});

test("the Arabic words are Arabic", () => {
  for (const [key, value] of Object.entries(STRINGS.ar) as [StringKey, string][]) {
    if (SAME_IN_EVERY_LANGUAGE.includes(key)) continue;
    assert.match(value, ARABIC, `${key} was left in English: ${value}`);
  }
});

test("no Arabic word is the English one with a different name", () => {
  for (const [key, value] of Object.entries(STRINGS.ar) as [StringKey, string][]) {
    if (SAME_IN_EVERY_LANGUAGE.includes(key)) continue;
    assert.notEqual(value, STRINGS.en[key], `${key} is still the English one`);
  }
});

test("Arabic is written from the right, and the document says so", () => {
  setLanguage("ar");
  assert.equal(direction(), "rtl");
  assert.equal(
    (globalThis as { document: { documentElement: { dir: string } } }).document.documentElement.dir,
    "rtl"
  );

  setLanguage("en");
  assert.equal(direction(), "ltr");
  assert.equal(
    (globalThis as { document: { documentElement: { dir: string } } }).document.documentElement.dir,
    "ltr"
  );
});

test("the figures and the dates follow the Arabic", () => {
  setLanguage("ar");

  // Arabic writes its digits the way it writes its letters.
  assert.equal(formatNumber(1234.5), "١٬٢٣٤٫٥");
  assert.equal(formatDate(new Date(2026, 10, 5)), "٥ نوفمبر");
});

test("the mood is named in Arabic as well", () => {
  setLanguage("ar");
  assert.equal(moodLabel("happy"), "سعيد");

  setLanguage("ru");
  assert.equal(moodLabel("happy"), "Радость");
});
