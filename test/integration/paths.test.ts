import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { expandPath, resolveInWorkspace } from "../../src/agent/tools/paths";

const home = process.env.HOME as string;
const documents = path.join(home, "Documents");
const outside = path.join(home, "outside");

fs.mkdirSync(path.join(documents, "project"), { recursive: true });
fs.mkdirSync(outside, { recursive: true });
fs.writeFileSync(path.join(documents, "project", "note.txt"), "hello");
fs.writeFileSync(path.join(outside, "secret.txt"), "private");
if (!fs.existsSync(path.join(documents, "escape"))) {
  fs.symlinkSync(outside, path.join(documents, "escape"));
}

test("a path inside the workspace resolves as written", async () => {
  const resolved = await resolveInWorkspace("~/Documents/project/note.txt");
  assert.equal(resolved, path.join(documents, "project", "note.txt"));
});

test("a missing file under the workspace is still allowed, for writes", async () => {
  const resolved = await resolveInWorkspace("~/Documents/project/new.txt");
  assert.equal(resolved, path.join(documents, "project", "new.txt"));
});

test("a path outside every allowed folder is refused", async () => {
  await assert.rejects(resolveInWorkspace("~/outside/secret.txt"), /outside the allowed folders/);
  await assert.rejects(resolveInWorkspace("/etc/hosts"), /outside the allowed folders/);
});

test("a symlink that leaves the workspace is refused after realpath", async () => {
  await assert.rejects(resolveInWorkspace("~/Documents/escape/secret.txt"), /symlink/);
});

test("expandPath leaves absolute paths alone and expands a bare tilde", () => {
  assert.equal(expandPath("/tmp/x"), "/tmp/x");
  assert.equal(expandPath("~/Documents"), path.join(home, "Documents"));
});
