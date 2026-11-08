/**
 * The layout has to be able to turn the other way round.
 *
 * A language written from the right has the whole interface mirrored: the side
 * panel sits on the other side of the window, the spacing runs the other way and
 * the arrows point back. This file is the guard that keeps it that way — the
 * source is read for the physical shortcuts that would sit still in a mirrored
 * layout, so a half-finished mirror cannot slip in unnoticed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const RENDERER = path.join(ROOT, "src", "renderer");
const STYLESHEET = path.join(RENDERER, "styles", "global.css");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/** Every string in the file, so prose in a comment is not read as a class. */
function stringsIn(source: string): string[] {
  return [
    ...source.matchAll(/"([^"\n]*)"/g),
    ...source.matchAll(/'([^'\n]*)'/g),
    ...source.matchAll(/`([^`]*)`/g),
  ].map((match) => match[1]);
}

/** The Tailwind utilities that pin something to one side of the window. */
const PHYSICAL_CLASSES: RegExp[] = [
  /^(ml|mr|pl|pr)-/,
  /^(left|right)-/,
  /^text-(left|right)$/,
  /^border-[lr](-[0-9]+)?$/,
  /^rounded-[lr](-[0-9]+)?$/,
  /^(scroll-m|scroll-p)[lr]-/,
  /^float-(left|right)$/,
  /^clear-(left|right)$/,
];

/** The CSS properties that do the same thing by hand. */
const PHYSICAL_PROPERTIES: RegExp[] = [
  /(^|[;{\s])(margin|padding|border|scroll-margin|scroll-padding)-(left|right)\b/,
  /text-align\s*:\s*(left|right)\b/,
  /(^|[;{\s])(left|right)\s*:/m,
  /float\s*:\s*(left|right)\b/,
  /clear\s*:\s*(left|right)\b/,
];

/** The class without its variants and its important mark. */
function bare(token: string): string {
  const withoutBang = token.startsWith("!") ? token.slice(1) : token;
  const parts = withoutBang.split(":");
  return parts[parts.length - 1];
}

const sources = walk(RENDERER).map((file) => ({
  file: path.relative(ROOT, file),
  text: fs.readFileSync(file, "utf8"),
}));

test("no class in the interface is pinned to one side of the window", () => {
  const offenders: string[] = [];

  for (const { file, text } of sources) {
    for (const chunk of stringsIn(text)) {
      for (const token of chunk.split(/\s+/)) {
        if (!token) continue;
        const name = bare(token);
        if (PHYSICAL_CLASSES.some((pattern) => pattern.test(name))) {
          offenders.push(`${file}: ${token}`);
        }
      }
    }
  }

  assert.deepEqual(offenders, []);
});

test("the stylesheet does not push things to one side by hand either", () => {
  const css = fs.readFileSync(STYLESHEET, "utf8");
  const offenders = PHYSICAL_PROPERTIES.filter((pattern) => pattern.test(css)).map(
    (pattern) => pattern.source
  );

  assert.deepEqual(offenders, []);
});

test("the arrows that point somewhere turn the other way round", () => {
  const directional = ["ChevronLeft", "ChevronRight", "ArrowLeft", "ArrowRight", "PanelLeft", "PanelRight"];
  const offenders: string[] = [];

  for (const { file, text } of sources) {
    for (const icon of directional) {
      for (const match of text.matchAll(new RegExp(`<${icon}\\b[^>]*>`, "g"))) {
        if (!match[0].includes("rtl:rotate-180")) offenders.push(`${file}: ${match[0].trim()}`);
      }
    }
  }

  assert.deepEqual(offenders, []);
});

test("the parts that are drawn by hand have a mirrored version too", () => {
  const css = fs.readFileSync(STYLESHEET, "utf8");

  assert.match(css, /\[dir="rtl"\]\s+\.toggle-on::after/);
  assert.match(css, /\[dir="rtl"\]\s+\.theme-preview-system/);
});

test("the document says which way the text runs", () => {
  const html = fs.readFileSync(path.join(RENDERER, "index.html"), "utf8");

  assert.match(html, /<html[^>]*\slang="[a-z-]+"/);
  assert.match(html, /<html[^>]*\sdir="(ltr|rtl)"/);
});

test("the language decides which way the text runs", async () => {
  const original = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = { documentElement: { lang: "en", dir: "ltr" } };

  try {
    const { direction, setLanguage } = await import("../../src/renderer/i18n");

    setLanguage("en");
    assert.equal(direction(), "ltr");
    assert.equal(
      (globalThis as { document: { documentElement: { dir: string } } }).document.documentElement.dir,
      "ltr"
    );
  } finally {
    (globalThis as { document?: unknown }).document = original;
  }
});
