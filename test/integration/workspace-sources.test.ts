import { test, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import os from "node:os";
import storage from "../../src/utils/storage";
import { config } from "../../src/utils/config";
import { MemoryManager } from "../../src/agent/memory-manager";

storage.init();
const manager = new MemoryManager();

const root = fs.mkdtempSync(path.join(os.tmpdir(), "openmonkey-sources-"));
const notes = path.join(root, "notes");
const vaultFolder = path.join(root, "vault");
fs.mkdirSync(notes, { recursive: true });
fs.mkdirSync(vaultFolder, { recursive: true });

const write = (file: string, lines: string[]) =>
  fs.writeFileSync(file, lines.map((line, index) => `${index + 1}. ${line}`).join("\n"), "utf8");

write(path.join(notes, "release.md"), [
  "The release ships on Friday.",
  "The model check runs first.",
  "Nothing else changes.",
]);
write(path.join(notes, "server.log"), ["the server started", "the server stopped"]);
write(path.join(vaultFolder, "keys.md"), ["the key is here", "the token is here"]);

config.set("memory", { enabled: true, workspaceSearch: true, workspaceIgnore: [] });
config.set("agent", {
  ...config.get("agent"),
  workspaceRoots: [root],
});

after(() => {
  storage.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test("the index lists the files it holds", async () => {
  const status = await manager.rebuild();
  assert.equal(status.state, "ready");
  const sources = manager.sources();
  const paths = sources.map((source) => source.path);
  assert.equal(paths.includes(path.join(notes, "release.md")), true);
  assert.equal(paths.includes(path.join(notes, "server.log")), true);

  const release = sources.find((source) => source.path === path.join(notes, "release.md"));
  assert.ok(release);
  assert.equal(release.chunks, 1);
  assert.equal(release.lines, 3);
  assert.ok(release.bytes > 0);
});

test("a source previews the passages the index cut from it", async () => {
  await manager.rebuild();
  const chunks = manager.preview(path.join(notes, "release.md"));
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].startLine, 1);
  assert.equal(chunks[0].endLine, 3);
  assert.ok(chunks[0].text.includes("The release ships on Friday."));
});

test("a file with no passages previews nothing", async () => {
  await manager.rebuild();
  assert.deepEqual(manager.preview(path.join(root, "not-indexed.md")), []);
});

test("an ignore rule keeps a file out of the index and says how many", async () => {
  const status = await manager.setIgnoreRules(["*.log"]);
  const paths = manager.sources().map((source) => source.path);
  assert.equal(paths.includes(path.join(notes, "server.log")), false);
  assert.equal(paths.includes(path.join(notes, "release.md")), true);
  assert.equal(status.ignoreRules.length, 1);
  assert.ok(status.skipped >= 1);

  await manager.setIgnoreRules([]);
  assert.equal(manager.sources().map((source) => source.path).includes(path.join(notes, "server.log")), true);
});

test("a rule for a folder keeps everything inside it out", async () => {
  await manager.setIgnoreRules(["vault"]);
  const paths = manager.sources().map((source) => source.path);
  assert.equal(paths.includes(path.join(vaultFolder, "keys.md")), false);
  assert.equal(paths.includes(path.join(notes, "release.md")), true);
  await manager.setIgnoreRules([]);
  assert.equal(manager.sources().map((source) => source.path).includes(path.join(vaultFolder, "keys.md")), true);
});

test("a folder reachable through two roots is counted as ignored once", async () => {
  // The notes folder sits inside the temp root and is also a workspace root of its own.
  config.set("agent", { ...config.get("agent"), workspaceRoots: [root, notes] });
  const status = await manager.setIgnoreRules(["*.log"]);
  assert.equal(status.skipped, 1);
  await manager.setIgnoreRules([]);
  config.set("agent", { ...config.get("agent"), workspaceRoots: [root] });
});

test("reindexing one file reads it again", async () => {
  await manager.rebuild();
  const file = path.join(notes, "release.md");
  write(file, ["The release slipped to Monday.", "The model check runs first.", "Nothing else changes."]);
  const status = await manager.reindexSource(file);
  assert.equal(status.state, "ready");
  const chunks = manager.preview(file);
  assert.ok(chunks[0].text.includes("The release slipped to Monday."));
  assert.equal(manager.sources().length >= 1, true);
});

test("a file that is gone leaves the index when it is reindexed", async () => {
  await manager.rebuild();
  const file = path.join(notes, "temporary.md");
  write(file, ["a note that will not be there"]);
  await manager.reindexSource(file);
  assert.equal(manager.sources().map((source) => source.path).includes(file), true);

  fs.rmSync(file);
  await manager.reindexSource(file);
  assert.equal(manager.sources().map((source) => source.path).includes(file), false);
});

test("a file outside the folders the agent may read is refused", async () => {
  await manager.rebuild();
  await assert.rejects(() => manager.reindexSource("/etc/hosts"), /not in a folder/);
});

test("a citation jumps to the passage the index holds", async () => {
  await manager.rebuild();
  const file = path.join(notes, "release.md");
  const preview = await manager.citationPreview(`[file:${file}:2]`);
  assert.equal(preview.found, true);
  assert.equal(preview.kind, "file");
  assert.equal(preview.citedLine, 2);
  assert.equal(preview.startLine, 1);
  assert.equal(preview.endLine, 3);
  assert.ok(preview.text.includes("The model check runs first."));
});

test("a citation to a file that was never indexed still reads the lines around it", async () => {
  const file = path.join(root, "outside.md");
  write(file, ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"]);
  const preview = await manager.citationPreview(`[file:${file}:5]`);
  assert.equal(preview.found, true);
  assert.equal(preview.citedLine, 5);
  assert.ok(preview.text.includes("five"));
});
