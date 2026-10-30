import { test, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import Database from "better-sqlite3";
import storage from "../../src/utils/storage";
import config, { dataRoot } from "../../src/utils/config";
import type { Message } from "../../src/utils/types";

const dbFile = () => path.join(dataRoot(), "openmonkey.db");
const raw = () => new Database(dbFile(), { readonly: true });
const body = (id: string) => `body of ${id} — приватный текст`;
const message = (id: string, when = Date.now()): Message => ({
  id,
  role: "user",
  content: body(id),
  timestamp: new Date(when),
});

const chat = (() => {
  storage.init();
  return storage.createConversation("Integration");
})();

let seq = 0;
const save = (when = Date.now()) => {
  const id = `msg_${++seq}`;
  storage.saveMessage(chat.id, message(id, when));
  return id;
};

after(() => {
  storage.close();
});

test("a fresh database is sealed, stamped and carries a 0600 key", () => {
  const db = raw();
  try {
    assert.equal(db.pragma("user_version", { simple: true }), 1);
  } finally {
    db.close();
  }
  assert.equal(storage.keySource, "file");
  const keyFile = path.join(dataRoot(), "secret.key");
  assert.equal(fs.existsSync(keyFile), true);
  assert.equal(fs.statSync(keyFile).mode & 0o777, 0o600);
  const sealed = save();
  const db2 = raw();
  try {
    const row = db2.prepare("SELECT content FROM messages WHERE id = ?").get(sealed) as { content: string };
    assert.ok(row.content.startsWith("enc:v1:"));
    assert.equal(row.content.includes(body(sealed)), false);
  } finally {
    db2.close();
  }
  assert.equal(storage.getMessages(chat.id).find((item) => item.id === sealed)?.content, body(sealed));
});

test("turning encryption off rewrites every row as plaintext and vacuums the ciphertext", () => {
  const id = save();
  storage.setEncryption(false);
  assert.equal(storage.keySource, "off");
  const db = raw();
  try {
    const row = db.prepare("SELECT content FROM messages WHERE id = ?").get(id) as { content: string };
    assert.equal(row.content, body(id));
    const sealed = db.prepare("SELECT COUNT(*) AS count FROM messages WHERE content LIKE 'enc:v1:%'").get() as { count: number };
    assert.equal(sealed.count, 0);
  } finally {
    db.close();
  }
  const bytes = fs.readFileSync(dbFile());
  assert.equal(bytes.includes("enc:v1:"), false, "the vacuum removed old ciphertext from free pages");
  assert.ok(bytes.includes(body(id)), "the body is honestly plaintext on disk");
  assert.equal(storage.getMessages(chat.id).find((item) => item.id === id)?.content, body(id));
});

test("turning encryption back on re-seals under the stored key", () => {
  const id = save();
  storage.setEncryption(true);
  assert.equal(storage.keySource, "file");
  const db = raw();
  try {
    const row = db.prepare("SELECT content FROM messages WHERE id = ?").get(id) as { content: string };
    assert.ok(row.content.startsWith("enc:v1:"));
  } finally {
    db.close();
  }
  assert.equal(storage.getMessages(chat.id).find((item) => item.id === id)?.content, body(id));
});

test("setEncryption is a no-op when the scheme already matches", () => {
  const before = fs.statSync(dbFile()).mtimeMs;
  storage.setEncryption(true);
  assert.equal(storage.keySource, "file");
  assert.ok(fs.statSync(dbFile()).mtimeMs >= before);
});

test("retention prunes old rows and keeps fresh ones", () => {
  config.merge({ privacy: { autoDeleteAfter: 30 } });
  const old = save(Date.now() - 100 * 24 * 60 * 60 * 1000);
  const fresh = save();
  storage.runRetention();
  const ids = storage.getMessages(chat.id, 500).map((item) => item.id);
  assert.equal(ids.includes(old), false);
  assert.equal(ids.includes(fresh), true);
});

test("save-history off writes nothing at all", () => {
  const before = storage.getMessages(chat.id, 500).length;
  config.merge({ privacy: { saveHistory: false } });
  try {
    save();
    assert.equal(storage.getMessages(chat.id, 500).length, before);
  } finally {
    config.merge({ privacy: { saveHistory: true } });
  }
});

test("an export carries plaintext bodies, never the at-rest envelope", () => {
  const id = save();
  const bundle = storage.exportBundle();
  const restored = bundle.conversations.flatMap((conversation) => conversation.messages);
  const found = restored.find((item) => item.id === id);
  assert.equal(found?.content, body(id));
  assert.equal(JSON.stringify(bundle).includes("enc:v1:"), false);
  assert.ok(bundle.schemaVersion >= 1);
});
