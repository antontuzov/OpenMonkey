import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8");

const LANDING = read("landing/index.html");
const BUILDER = read("landing/app.js");
const PACKAGE = JSON.parse(read("package.json"));
const WORKFLOW = read(".github/workflows/ci.yml");

const ARTIFACT_NAME: string = PACKAGE.build.artifactName;
const ARCH = "arm64";

/** Every filename electron-builder is configured to produce for one arch. */
const builtName = (extension: string) =>
  ARTIFACT_NAME.replaceAll("${arch}", ARCH).replaceAll("${ext}", extension);

test("the landing page links the archive the builder actually names", () => {
  const linked = [...LANDING.matchAll(/releases\/latest\/download\/([A-Za-z0-9._-]+)/g)].map((m) => m[1]);
  assert.ok(linked.length, "the landing page offers at least one direct download");
  for (const href of linked) {
    assert.ok(
      [builtName("dmg"), builtName("zip")].includes(href),
      `${href} is not what artifactName "${ARTIFACT_NAME}" produces — the public URL would 404`,
    );
  }
  assert.ok(
    linked.includes(builtName("dmg")),
    "the installer a reader wants is the .dmg, and nothing links to it",
  );
});

test("the release notes name the same archive", () => {
  const notes = read("docs/RELEASE_NOTES.md");
  assert.ok(notes.includes(builtName("dmg")), "the notes must tell the reader which file to take");
  assert.match(notes, /xattr -dr com\.apple\.quarantine/, "an unsigned build has to say how to launch it");
});

test("the publish step uploads exactly the files electron-builder emits", () => {
  const uploaded = [...WORKFLOW.matchAll(/dist\/([A-Za-z0-9.*_-]+)/g)].map((m) => m[1]);
  assert.ok(uploaded.length, "the release job names what it uploads");
  const expected = new Set([
    builtName("dmg"),
    `${builtName("dmg")}.blockmap`,
    builtName("zip"),
    `${builtName("zip")}.blockmap`,
    "latest-mac.yml",
  ]);
  for (const name of uploaded) {
    assert.ok(expected.has(name), `the release job uploads ${name}, which no build step produces`);
  }
  for (const name of expected) assert.ok(uploaded.includes(name), `${name} is built but never uploaded`);
});

test("the artifact name carries no version, so /latest/download/ stays valid", () => {
  assert.ok(!ARTIFACT_NAME.includes("${version}"), "a version in the filename breaks every permanent link");
  assert.match(ARTIFACT_NAME, /\$\{arch\}/, "the updater picks an archive by the arch in its name");
});

const keysByLanguage = (source: string) => {
  const bounds = { en: source.indexOf("  en: {"), ru: source.indexOf("  ru: {") };
  const end = source.indexOf("\n};", bounds.ru);
  // Keys are camelCase in places, so a lowercase-only pattern silently drops them.
  const pattern = /^\s{4}"([A-Za-z0-9._-]+)":/gm;
  const slice = (from: number, to: number) =>
    new Set([...source.slice(from, to).matchAll(pattern)].map((m) => m[1]));
  return {
    en: slice(bounds.en, bounds.ru),
    ru: slice(bounds.ru, end),
  };
};

test("every phrase the landing page marks for translation exists in both languages", () => {
  const used = new Set([...LANDING.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]));
  assert.ok(used.size > 10, `found ${used.size} translatable phrases`);
  const { en, ru } = keysByLanguage(BUILDER);
  for (const key of used) {
    assert.ok(en.has(key), `"${key}" is on the page but has no English string`);
    assert.ok(ru.has(key), `"${key}" is on the page but has no Russian string`);
  }
});

test("no translation is left unreachable on the page", () => {
  const onPage = new Set([...LANDING.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]));
  // Some phrases are put on screen by the script rather than marked up in the HTML.
  const inScript = new Set([...BUILDER.matchAll(/\bt\("([^"]+)"\)/g)].map((m) => m[1]));
  const { en } = keysByLanguage(BUILDER);
  const orphans = [...en].filter((key) => !onPage.has(key) && !inScript.has(key));
  assert.deepEqual(orphans, [], "strings nobody renders are how a page ends up lying in one language");
});
