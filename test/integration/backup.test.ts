import { test, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import Database from "better-sqlite3";
import storage from "../../src/utils/storage";
import { dataRoot } from "../../src/utils/config";
import {
  backupFolder,
  checkIntegrity,
  listBackups,
  MAX_BACKUPS,
  pruneBackups,
} from "../../src/utils/backup";
import type { Message } from "../../src/utils/types";

const liveFile = () => path.join(dataRoot(), "openmonkey.db");
const copyFile = (name: string) => path.join(backupFolder(), name);
const message = (id: string): Message => ({
  id,
  role: "user",
  content: `body of ${id} — приватный текст`,
  timestamp: new Date(),
});

storage.init();

after(() => {
  storage.close();
});

/** A file with a chosen age, so the rotation has something to order. */
function plant(name: string, at: number): void {
  const file = copyFile(name);
  fs.writeFileSync(file, "not really a database");
  fs.utimesSync(file, new Date(at), new Date(at));
}

/** The launch copy is written without stopping the app, so it lands a moment later. */
async function copyAppearedSince(seen: Set<string>): Promise<string | null> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const fresh = listBackups().find((file) => !seen.has(file.name));
    if (fresh) return fresh.name;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return null;
}

test("a launch copies the history, and a copy that is fresh is not rewritten", async () => {
  for (const file of listBackups()) fs.rmSync(copyFile(file.name), { force: true });

  storage.backupOnLaunch();
  const name = await copyAppearedSince(new Set());
  assert.ok(name, "with nothing to go back to, a launch keeps a copy");
  // The file is the user's conversations: nobody else on the Mac may read it.
  assert.equal(fs.statSync(copyFile(name)).mode & 0o777, 0o600);

  // The copy just taken is inside the interval, so the next launch writes nothing.
  const seen = new Set(listBackups().map((file) => file.name));
  storage.backupOnLaunch();
  assert.equal(await copyAppearedSince(seen), null);
});

test("a copy taken by hand carries the history and stands on its own", async () => {
  const chat = storage.createConversation("Copy me");
  storage.saveMessage(chat.id, message("copy_probe"));

  const before = listBackups().length;
  const file = await storage.backupNow();
  assert.ok(file);
  assert.equal(listBackups().length, before + 1);
  assert.ok(file.bytes > 0);

  // The copy is a real SQLite file, opened here without the app's key at all:
  // the rows are sealed, but the history they hold survives on its own.
  const db = new Database(copyFile(file.name), { readonly: true });
  try {
    const rows = db.prepare("SELECT id FROM messages WHERE conversation_id = ?").all(chat.id) as Array<{
      id: string;
    }>;
    assert.deepEqual(rows.map((row) => row.id), ["copy_probe"]);
  } finally {
    db.close();
  }
});

test("only the newest five copies are kept", () => {
  const hour = 3_600_000;
  const now = Date.now();
  const older = [now - 10 * hour, now - 11 * hour, now - 12 * hour];
  const newer = [now + hour, now + 2 * hour, now + 3 * hour];
  const planted = [
    "openmonkey-older-1.db",
    "openmonkey-older-2.db",
    "openmonkey-older-3.db",
    "openmonkey-newer-1.db",
    "openmonkey-newer-2.db",
    "openmonkey-newer-3.db",
  ];
  // The copies the app wrote itself are at `now`, so they sit between the two groups.
  planted.forEach((name, index) => plant(name, (index < 3 ? older : newer)[index % 3]));

  const kept = pruneBackups();
  assert.equal(kept.length, MAX_BACKUPS);
  for (const name of planted.slice(0, 3)) {
    assert.equal(kept.some((file) => file.name === name), false, `${name} was the oldest kind of copy`);
  }
  for (const name of planted.slice(3)) {
    assert.equal(kept.some((file) => file.name === name), true, `${name} was among the newest`);
  }
  assert.deepEqual(
    kept.map((file) => file.createdAt),
    [...kept.map((file) => file.createdAt)].sort((a, b) => b - a)
  );
  for (const name of planted) fs.rmSync(copyFile(name), { force: true });
});

test("a sound database says so", () => {
  const report = storage.checkIntegrity();
  assert.equal(report.ok, true, report.detail);
  assert.equal(report.detail, "ok");
  // The settings page reads it from the status, not by running the check again.
  assert.deepEqual(storage.backupStatus().integrity, report);
});

test("a database whose pages are scrambled is reported as damaged", () => {
  const file = path.join(backupFolder(), "openmonkey-scratched.db");
  const db = new Database(file);
  try {
    db.exec("CREATE TABLE t (x)");
    db.exec("BEGIN");
    for (let index = 0; index < 400; index++) db.prepare("INSERT INTO t VALUES (?)").run(`row ${index}`);
    db.exec("COMMIT");
  } finally {
    db.close();
  }
  // Write over the middle of the file, leaving the header SQLite reads first.
  const handle = fs.openSync(file, "r+");
  try {
    fs.writeSync(handle, Buffer.alloc(512, 0x2a), 0, 512, 4096);
  } finally {
    fs.closeSync(handle);
  }
  const opened = new Database(file);
  try {
    const report = checkIntegrity(opened);
    assert.equal(report.ok, false);
    assert.notEqual(report.detail, "ok");
  } finally {
    opened.close();
  }
  fs.rmSync(file, { force: true });
});

test("a copy puts the history back the way it was", async () => {
  const chat = storage.createConversation("Before the copy");
  storage.saveMessage(chat.id, message("kept_probe"));
  const file = await storage.backupNow();
  assert.ok(file);

  // Something goes wrong after the copy: a chat nobody meant to start.
  const stray = storage.createConversation("Written after the copy");
  storage.saveMessage(stray.id, message("stray_probe"));
  assert.equal(storage.getMessages(stray.id).length, 1);

  const result = storage.restoreBackup(file.name);
  assert.equal(result.ok, true, result.detail);
  // The check that passed was run over the file that is no longer in place.
  assert.equal(storage.backupStatus().integrity, null);

  assert.equal(storage.listConversations().some((row) => row.id === stray.id), false);
  const back = storage.listConversations().find((row) => row.id === chat.id);
  assert.ok(back, "the chat the copy carried is readable again");
  assert.deepEqual(
    storage.getMessages(chat.id).map((row) => row.id),
    ["kept_probe"]
  );
  // The file that came back is the app's own: the live connection still writes.
  assert.equal(fs.existsSync(liveFile()), true);
  storage.saveMessage(chat.id, message("after_restore_probe"));
  assert.equal(storage.getMessages(chat.id).length, 2);
});

test("a name that is not one of the app's copies is refused", () => {
  const before = fs.readFileSync(liveFile());
  for (const name of ["../../secret.key", "some-other-file.db", "openmonkey-nested/../evil.db", ""]) {
    const result = storage.restoreBackup(name);
    assert.equal(result.ok, false, `${name || "(empty)"} is not a copy this app wrote`);
  }
  assert.deepEqual(fs.readFileSync(liveFile()), before);
  assert.equal(storage.listConversations().length > 0, true);
});

test("the status lists the copies newest first and says how often they are taken", () => {
  const status = storage.backupStatus();
  assert.equal(status.empty, false);
  assert.deepEqual(
    status.backups.map((file) => file.name),
    listBackups().map((file) => file.name)
  );
  assert.equal(status.intervalMs, 12 * 60 * 60 * 1000);
});
