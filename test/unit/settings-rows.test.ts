import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { searchSettings } from "../../src/renderer/settings-search";

const ROOT = path.resolve(import.meta.dirname, "../..");
const VIEW = readFileSync(path.join(ROOT, "src/renderer/components/SettingsView.tsx"), "utf8");

/**
 * The row titles the settings page puts on screen: the ones written by hand and the
 * ones a list builds for it. The end-to-end sweep walks the pages and types each of
 * these into the search box, but that sweep needs a window; this is the same
 * invariant, checked without one.
 */
const rowTitles = (): string[] => {
  const literal = [...VIEW.matchAll(/className="row-title[^"]*">([^<{]+)</g)].map((match) => match[1].trim());
  const start = VIEW.indexOf("const POLICY_ROWS");
  const block = VIEW.slice(start, VIEW.indexOf("];", start));
  const listed = [...block.matchAll(/name: "([^"]+)"/g)].map((match) => match[1]);
  return [...new Set([...literal, ...listed])];
};

test("every row the settings page titles can be found by typing its own name", () => {
  const titles = rowTitles();
  assert.ok(titles.length >= 15, `the sweep read ${titles.length} row titles`);

  const missing = titles.filter(
    (title) => !searchSettings(title, 100).some((hit) => hit.label === title)
  );
  assert.deepEqual(missing, [], "these rows are not in the settings search index");
});
