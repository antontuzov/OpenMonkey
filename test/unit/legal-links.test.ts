import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { LEGAL_LINKS } from "../../src/utils/legal";

const ROOT = path.resolve(import.meta.dirname, "../..");
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8");

const LEGAL = read("docs/LEGAL.md");
const LANDING = read("landing/index.html");
const SETTINGS = read("src/renderer/components/SettingsView.tsx");

/** GitHub's heading anchor: lowercase, drop punctuation, spaces become hyphens. */
const githubAnchor = (heading: string) =>
  heading
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");

const anchors = new Set(
  [...LEGAL.matchAll(/^## (.+)$/gm)].map((m) => githubAnchor(m[1])),
);

test("the legal shelf carries the EULA, the refund policy and the export-control note", () => {
  for (const heading of ["End-user license agreement", "Refund policy", "Export control"]) {
    assert.ok(LEGAL.includes(`## ${heading}`), `docs/LEGAL.md is missing "${heading}"`);
  }
  assert.ok(LEGAL.includes("PRIVACY.md"), "the shelf must point at the privacy policy");
  assert.ok(LEGAL.includes("SECURITY.md"), "the shelf must point at the security-report path");
});

test("every fragment the app links to is a heading anchor GitHub will really render", () => {
  const withFragment = Object.entries(LEGAL_LINKS).filter(([, url]) => url.includes("#"));
  assert.ok(withFragment.length >= 3, "the EULA, refund and export rows link to their sections");
  for (const [name, url] of withFragment) {
    const fragment = url.split("#")[1];
    assert.ok(anchors.has(fragment), `LEGAL_LINKS.${name} points at #${fragment}, which no heading produces`);
  }
});

test("every document the app links to exists in the repository", () => {
  for (const [name, url] of Object.entries(LEGAL_LINKS)) {
    assert.ok(url.startsWith("https://github.com/antontuzov/OpenMonkey/"), `${name} leaves the repository`);
    const file = url.match(/\/blob\/main\/([^#]+)/);
    if (file) assert.ok(existsSync(path.join(ROOT, file[1])), `${name} links to ${file[1]}, which is not on disk`);
  }
});

test("the security row leads to the private reporting flow the policy names", () => {
  assert.equal(LEGAL_LINKS.security, "https://github.com/antontuzov/OpenMonkey/security/advisories/new");
  assert.ok(
    read("SECURITY.md").includes(LEGAL_LINKS.security),
    "SECURITY.md must name the same private reporting flow",
  );
});

test("the license page renders a row for every legal link", () => {
  for (const name of Object.keys(LEGAL_LINKS)) {
    assert.ok(SETTINGS.includes(`LEGAL_LINKS.${name}`), `the License page never opens LEGAL_LINKS.${name}`);
  }
});

test("the landing page links the legal shelf and the security policy", () => {
  assert.ok(LANDING.includes("/blob/main/docs/LEGAL.md"), "the footer never links the legal shelf");
  assert.ok(LANDING.includes("/blob/main/SECURITY.md"), "the footer never links the security policy");
});

test("the support page hands security reports to the policy", () => {
  assert.ok(read("docs/SUPPORT.md").includes("SECURITY.md"), "SUPPORT.md must point at SECURITY.md");
});