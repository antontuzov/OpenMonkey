import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { searchSettings } from "../../src/renderer/settings-search";
import { setLanguage } from "../../src/renderer/i18n";
import { SETTINGS_PAGES } from "../../src/utils/types";

// setLanguage writes the html lang attribute; a unit run has no document to write to.
before(() => {
  Reflect.set(globalThis, "document", { documentElement: {} });
});
after(() => {
  setLanguage("en");
  Reflect.deleteProperty(globalThis, "document");
});

test("an empty query asks for nothing and returns nothing", () => {
  assert.deepEqual(searchSettings(""), []);
  assert.deepEqual(searchSettings("   "), []);
});

test("a keyword nobody sees on screen still finds the row it belongs to", () => {
  const cases: Array<[string, string, string]> = [
    ["dark mode", "appearance", "Interface theme"],
    ["beta", "desktop", "Update channel"],
    ["tokens per second", "model", "Generation speed"],
    ["keychain", "privacy", "History key"],
    ["apple events", "approvals", "Calendar"],
    ["reindex", "memory", "Index status"],
    ["hotkey", "desktop", "Option+Space popover"],
  ];
  for (const [query, page, label] of cases) {
    const hit = searchSettings(query).find((entry) => entry.label === label);
    assert.ok(hit, `“${query}” reaches ${label}`);
    assert.equal(hit.page, page);
  }
});

test("a row named for the words beats a row that merely mentions them", () => {
  assert.equal(searchSettings("Encrypt")[0].label, "Encrypt stored data");
  assert.equal(searchSettings("history")[0].label, "History key");
  assert.equal(searchSettings("shortcut")[0].label, "Focus composer");
});

test("results stop at the requested limit and never repeat a row", () => {
  const capped = searchSettings("shortcut", 3);
  assert.equal(capped.length, 3);
  for (const hits of [capped, searchSettings("notification"), searchSettings("settings")]) {
    const ids = hits.map((hit) => `${hit.page}:${hit.label}`);
    assert.equal(new Set(ids).size, ids.length, JSON.stringify(ids));
  }
});

test("every indexed row is on a real page and is findable by its own title", () => {
  const pages = new Set<string>(SETTINGS_PAGES);
  const titles = new Map<string, Set<string>>();
  const queries = ["avatar", "theme", "language", "login", "tray", "channel", "popover", "policy", "memory"];
  for (const query of queries) {
    for (const hit of searchSettings(query, 100)) {
      assert.ok(pages.has(hit.page), `${hit.page} is a settings page`);
      assert.ok(hit.label.trim(), `${hit.page} has a titled row`);
      const byPage = titles.get(hit.page) ?? new Set<string>();
      assert.ok(!byPage.has(hit.label), `${hit.page} does not title two rows “${hit.label}”`);
      byPage.add(hit.label);
      titles.set(hit.page, byPage);

      // Typing the title itself must bring that row back, or the jump has nothing to mark.
      assert.ok(
        searchSettings(hit.label, 100).some((match) => match.page === hit.page && match.label === hit.label),
        `“${hit.label}” is searchable`
      );
    }
  }
});

test("the index speaks Russian too", () => {
  setLanguage("ru");
  try {
    const russian = searchSettings("история", 100);
    assert.ok(russian.length > 0, "a Russian word finds rows");
    for (const hit of russian) {
      assert.match(hit.label, /[а-яёА-ЯЁ]/, `“${hit.label}” is translated, not left in English`);
    }
    assert.ok(
      russian.some((hit) => hit.page === "privacy"),
      "the privacy rows answer in Russian"
    );
  } finally {
    setLanguage("en");
  }
});
