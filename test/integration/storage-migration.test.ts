import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import Database from "better-sqlite3";
import { SCHEMA_VERSION } from "../../src/utils/storage";

const helper = path.join(__dirname, "migrate-legacy.cjs");
const base = path.join(os.tmpdir(), "openmonkey-migrate-test");

/** A history file as an older build wrote it: one file per message, in its own columns. */
function writeLegacyDatabase(dir: string): void {
  const data = path.join(dir, "data");
  fs.mkdirSync(data, { recursive: true });
  const now = Date.now();
  const db = new Database(path.join(data, "openmonkey.db"));
  db.exec(`
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      prompt TEXT,
      mood TEXT,
      task_type TEXT,
      attachment_name TEXT,
      attachment_bytes INTEGER,
      duration_ms INTEGER,
      stopped INTEGER,
      tokens INTEGER,
      created_at INTEGER NOT NULL
    );
  `);
  db.prepare("INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)").run(
    "conv_legacy",
    "Legacy chat",
    now,
    now
  );
  db.prepare(
    "INSERT INTO messages (id, conversation_id, role, content, attachment_name, attachment_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run("msg_legacy", "conv_legacy", "user", "the old body", "notes.txt", 4321, now);
  db.close();
}

after(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

test("an old history file is upgraded: the file becomes a list and the old columns go", () => {
  fs.rmSync(base, { recursive: true, force: true });
  const home = path.join(base, "legacy");
  fs.mkdirSync(path.join(home, "home"), { recursive: true });
  writeLegacyDatabase(home);
  const report = path.join(base, "report.json");

  const run = spawnSync(process.execPath, [helper], {
    cwd: path.resolve(__dirname, "../.."),
    encoding: "utf8",
    timeout: 60_000,
    env: {
      ...process.env,
      OM_STUB_HOME: home,
      OM_MIGRATE_REPORT: report,
      HOME: path.join(home, "home"),
      NODE_NO_WARNINGS: "1",
    },
  });
  assert.equal(run.status, 0, run.stderr);

  const found = JSON.parse(fs.readFileSync(report, "utf8")) as {
    columns: string[];
    version: number;
    raw: Array<{ id: string; attachments: string | null }>;
    messages: Array<{ id: string; content: string; attachments: unknown }>;
  };

  assert.equal(found.version, SCHEMA_VERSION);
  assert.equal(found.columns.includes("attachments"), true);
  assert.equal(found.columns.includes("attachment_name"), false);
  assert.equal(found.columns.includes("attachment_bytes"), false);

  const legacy = found.messages.find((message) => message.id === "msg_legacy");
  assert.ok(legacy, "the old message is still in the history");
  assert.equal(legacy.content, "the old body");
  assert.deepEqual(legacy.attachments, [{ name: "notes.txt", bytes: 4321, kind: "text" }]);

  const raw = found.raw.find((row) => row.id === "msg_legacy");
  assert.deepEqual(JSON.parse(String(raw?.attachments)), [
    { name: "notes.txt", bytes: 4321, kind: "text" },
  ]);
});
