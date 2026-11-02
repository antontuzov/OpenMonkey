import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { isAllowedPath, readFileAsAttachment, searchFiles } from "../../src/utils/file-search";

let root = "";
let outside = "";

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "openmonkey-files-"));
  outside = mkdtempSync(path.join(os.tmpdir(), "openmonkey-outside-"));
  mkdirSync(path.join(root, "notes"), { recursive: true });
  writeFileSync(path.join(root, "notes", "alpha.md"), "# alpha\n");
  writeFileSync(path.join(root, "beta.txt"), "beta body");
  writeFileSync(path.join(root, "secret.env"), "TOKEN=1");
  writeFileSync(path.join(outside, "gamma.md"), "gamma body");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

test("only the folders the app may read are allowed", () => {
  assert.equal(isAllowedPath(path.join(root, "beta.txt"), [root]), true);
  assert.equal(isAllowedPath(path.join(root, "notes", "alpha.md"), [root]), true);
  assert.equal(isAllowedPath(path.join(outside, "gamma.md"), [root]), false);
  assert.equal(isAllowedPath("/etc/passwd", [root]), false);
});

test("a mention finds the file by name, prefix first", async () => {
  const hits = await searchFiles("alpha", [root]);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].name, "alpha.md");
  assert.equal(hits[0].path, path.join(root, "notes", "alpha.md"));
});

test("a mention that matches nothing finds nothing", async () => {
  assert.deepEqual(await searchFiles("nothing-here", [root]), []);
  assert.deepEqual(await searchFiles("", [root]), []);
});

test("the secret files of a folder are not offered", async () => {
  assert.deepEqual(
    (await searchFiles("secret", [root])).map((file) => file.name),
    []
  );
});

test("a file is found even when the folder holds thousands of others", async () => {
  const crowded = path.join(root, "crowded");
  mkdirSync(crowded, { recursive: true });
  for (let index = 0; index < 7000; index += 1) {
    writeFileSync(path.join(crowded, `filler-${index}.txt`), "x");
  }
  writeFileSync(path.join(root, "needle.txt"), "needle body");

  const hits = await searchFiles("needle", [root]);
  assert.deepEqual(hits.map((file) => file.name), ["needle.txt"]);
});

test("a file outside the allowed folders cannot be read", () => {
  assert.throws(
    () => readFileAsAttachment(path.join(outside, "gamma.md"), [root]),
    /outside the folders/
  );
});

test("a text file is read as text", () => {
  const attachment = readFileAsAttachment(path.join(root, "beta.txt"), [root]);
  assert.equal(attachment.name, "beta.txt");
  assert.equal(attachment.text, "beta body");
  assert.equal(attachment.kind, "text");
  assert.equal(attachment.bytes, 9);
});
