import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { DOCS_INDEX, docsUrl, searchDocs } from "../../src/utils/docs-index";

const ROOT = path.resolve(import.meta.dirname, "../..");

/** GitHub's heading anchor: lowercase, drop punctuation, spaces become hyphens. */
const githubAnchor = (heading: string) =>
  heading
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");

const headingsOf = (relative: string): Set<string> => {
  const text = readFileSync(path.join(ROOT, relative), "utf8");
  return new Set([...text.matchAll(/^#{2,3} (.+)$/gm)].map((m) => githubAnchor(m[1])));
};

test("every document the index names is in the repository", () => {
  for (const entry of DOCS_INDEX) {
    assert.ok(existsSync(path.join(ROOT, entry.doc)), `${entry.doc} is not on disk`);
  }
});

test("every anchor is a heading GitHub will really render", () => {
  for (const entry of DOCS_INDEX) {
    const headings = headingsOf(entry.doc);
    assert.ok(
      headings.has(entry.anchor),
      `${entry.doc} has no heading that produces #${entry.anchor}`,
    );
  }
});

test("the link opens the document in this repository, at the heading", () => {
  for (const entry of DOCS_INDEX) {
    const url = docsUrl(entry);
    assert.ok(url.startsWith("https://github.com/antontuzov/OpenMonkey/blob/main/"), url);
    assert.ok(url.endsWith(`/${entry.doc}#${entry.anchor}`), url);
  }
});

test("a question finds the answer that carries the word", () => {
  const gatekeeper = searchDocs("gatekeeper");
  assert.equal(gatekeeper[0]?.doc, "docs/SUPPORT.md");
  assert.equal(gatekeeper[0]?.anchor, "common-answers");

  const refund = searchDocs("refund");
  assert.equal(refund[0]?.doc, "docs/LEGAL.md");
  assert.equal(refund[0]?.anchor, "refund-policy");

  const hole = searchDocs("vulnerability");
  assert.ok(hole.some((entry) => entry.doc === "SECURITY.md"));

  const weights = searchDocs("model weights memory");
  assert.ok(weights.some((entry) => entry.doc === "docs/MODELS.md"));
});

test("a word that is only part of another word still finds the answer", () => {
  const hits = searchDocs("updat");
  assert.ok(hits.some((entry) => entry.anchor === "common-answers"));
});

test("nothing asked finds nothing", () => {
  assert.deepEqual(searchDocs(""), []);
  assert.deepEqual(searchDocs("   "), []);
  assert.deepEqual(searchDocs("zxcvbnm"), []);
});
