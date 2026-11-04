import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");

/**
 * The brand art is generated into two places — `assets/brand/` for the README and
 * `landing/assets/` for the site — so a swap that misses one of them leaves a
 * picture that 404s only on the page nobody opens locally.
 */
const localSources = (html: string, base: string): string[] => [
  ...html.matchAll(/(?:src|href)="([^"]+)"/g),
  ...html.matchAll(/content="(assets\/[^"]+)"/g),
]
  .map((match) => match[1])
  .filter((value) => !/^(https?:|mailto:|#|data:)/.test(value) && !value.startsWith("."))
  .map((value) => path.resolve(base, value.split("#")[0]));

test("every asset the landing page names is on disk", () => {
  const base = path.join(ROOT, "landing");
  const html = fs.readFileSync(path.join(base, "index.html"), "utf8");
  const missing = localSources(html, base).filter((file) => !fs.existsSync(file));
  assert.deepEqual(missing, []);
});

test("every screenshot and brand picture the README names is on disk", () => {
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  const referenced = [...readme.matchAll(/\]\(([^)]+)\)/g), ...readme.matchAll(/src="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((value) => !/^(https?:|#|mailto:)/.test(value))
    .map((value) => path.resolve(ROOT, value.split("#")[0]));
  const missing = referenced.filter((file) => !fs.existsSync(file));
  assert.deepEqual(missing, []);
});

test("the brand art carries no animation", () => {
  const animated = fs
    .readdirSync(path.join(ROOT, "assets", "brand"))
    .filter((name) => /\.(webp|gif|apng)$/.test(name));
  assert.deepEqual(animated, []);
  assert.deepEqual(fs.readdirSync(path.join(ROOT, "landing", "assets")).filter((name) => /\.(webp|gif)$/.test(name)), []);
});
