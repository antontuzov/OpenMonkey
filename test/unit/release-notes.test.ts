import { test } from "node:test";
import assert from "node:assert/strict";
import { parseChangelog, sectionFor, upcomingSection } from "../../src/utils/release-notes";

const CHANGELOG = `# Changelog

All notable changes are recorded here.

## Unreleased

### Added

- The panel that shows the version the app is on.
- A way to go back to the build before it.

### Fixed

- The row that said the wrong version.

## 0.9.2 — 2026-11-05

### Added

- The tray that knows your chats.

### Changed

- The settings page now reads in Russian too.
`;

test("a heading becomes a section with a version and a day", () => {
  const changelog = parseChangelog(CHANGELOG);
  const section = changelog.sections.find((entry) => entry.version === "0.9.2");
  assert.ok(section);
  assert.equal(section.releasedAt, "2026-11-05");
});

test("the work that is not out yet has no day", () => {
  const changelog = parseChangelog(CHANGELOG);
  const section = upcomingSection(changelog);
  assert.ok(section);
  assert.equal(section.version, "Unreleased");
  assert.equal(section.releasedAt, null);
});

test("the notes sit under the heading they were written under", () => {
  const changelog = parseChangelog(CHANGELOG);
  const section = sectionFor(changelog, "0.9.2");
  assert.ok(section);
  assert.deepEqual(
    section.groups.map((group) => group.name),
    ["Added", "Changed"]
  );
  assert.deepEqual(section.groups[0].items, ["The tray that knows your chats."]);
});

test("a version the changelog does not mention has no notes", () => {
  const changelog = parseChangelog(CHANGELOG);
  assert.equal(sectionFor(changelog, "0.9.1"), null);
});

test("a wrapped note belongs to the note above it", () => {
  const changelog = parseChangelog(
    ["## 0.9.2", "", "### Added", "", "- The history can be filed and labelled, and a saved search keeps", "  the words you look for.", "- A second note."].join("\n")
  );
  const section = sectionFor(changelog, "0.9.2");
  assert.ok(section);
  assert.equal(section.groups[0].items.length, 2);
  assert.equal(section.groups[0].items[0], "The history can be filed and labelled, and a saved search keeps the words you look for.");
});

test("a note with no heading of its own still lands somewhere", () => {
  const changelog = parseChangelog(["## 0.9.2", "", "- A note without a group."].join("\n"));
  const section = sectionFor(changelog, "0.9.2");
  assert.ok(section);
  assert.deepEqual(section.groups[0].items, ["A note without a group."]);
});

test("a file that is not a changelog yields no sections and no crash", () => {
  const changelog = parseChangelog("just some words");
  assert.deepEqual(changelog.sections, []);
  assert.equal(upcomingSection(changelog), null);
});
