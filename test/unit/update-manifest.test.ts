import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const SCRIPT = path.resolve(import.meta.dirname, "../../scripts/make-update-manifest.mjs");

/** A scratch release directory, filled with the archives electron-builder would leave. */
const staging = (contents: Record<string, string>) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "openmonkey-manifest-"));
  for (const [name, bytes] of Object.entries(contents)) writeFileSync(path.join(dir, name), bytes);
  return dir;
};

const build = (dir: string, version = "1.2.3") =>
  execFileSync(process.execPath, [SCRIPT, "--dir", dir, "--version", version], { encoding: "utf8" });

// js-yaml only arrives here as somebody else's dependency, so the manifest is read
// as the small, fixed set of lines it is meant to be.
const field = (yml: string, key: string) => yml.match(new RegExp(`^${key}: (.*)$`, "m"))?.[1];

test("one manifest carries both archives, arm64 first", () => {
  const dir = staging({
    "OpenMonkey-x64.zip": "intel bytes",
    "OpenMonkey-arm64.zip": "silicon bytes",
    "OpenMonkey-arm64.dmg": "not what the updater reads",
  });
  try {
    build(dir);
    const yml = readFileSync(path.join(dir, "latest-mac.yml"), "utf8");
    assert.equal(field(yml, "version"), "1.2.3");
    assert.equal(field(yml, "path"), "OpenMonkey-arm64.zip");
    const urls = [...yml.matchAll(/^  - url: (.*)$/gm)].map((m) => m[1]);
    assert.deepEqual(urls, ["OpenMonkey-arm64.zip", "OpenMonkey-x64.zip"]);
    const sizes = [...yml.matchAll(/^    size: (\d+)$/gm)].map((match) => Number(match[1]));
    assert.deepEqual(sizes, [Buffer.byteLength("silicon bytes"), Buffer.byteLength("intel bytes")]);
    assert.ok(!yml.includes(".dmg"), "the installer is not part of the update");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the checksum is the base64 sha512 of the bytes on disk", () => {
  const payload = "a real archive is much longer than this";
  const dir = staging({ "OpenMonkey-arm64.zip": payload });
  try {
    const log = build(dir);
    const yml = readFileSync(path.join(dir, "latest-mac.yml"), "utf8");
    const expected = createHash("sha512").update(payload).digest("base64");
    assert.equal(field(yml, "sha512"), expected);
    assert.match(log, /OpenMonkey-arm64\.zip \(\d+ bytes\)/);
    // The updater wants base64; the hex a checksum tool prints is 128 characters.
    assert.match(expected, /^[A-Za-z0-9+/]{86}==$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a single-arch release still produces a usable manifest", () => {
  const dir = staging({ "OpenMonkey-arm64.zip": "only one build" });
  try {
    build(dir);
    const yml = readFileSync(path.join(dir, "latest-mac.yml"), "utf8");
    assert.equal([...yml.matchAll(/^  - url:/gm)].length, 1);
    assert.equal(field(yml, "path"), "OpenMonkey-arm64.zip");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const refuses = (contents: Record<string, string>, expect: RegExp, version?: string) => {
  const dir = staging(contents);
  try {
    assert.throws(
      () => build(dir, version),
      (error: Error) => expect.test((error as unknown as { stdout?: string; stderr?: string }).stderr ?? ""),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test("it refuses a filename the updater could not choose an arch from", () => {
  refuses({ "OpenMonkey-universal.zip": "x" }, /cannot pick an arch|cannot pick/);
});

test("it refuses a directory with no archives, and a tag that is not a version", () => {
  refuses({ "OpenMonkey-arm64.dmg": "x" }, /no OpenMonkey-<arch>\.zip/);
  refuses({ "OpenMonkey-arm64.zip": "x" }, /numeric version/, "not-a-version");
});
