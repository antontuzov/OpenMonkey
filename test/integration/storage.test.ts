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

test("a quick ask keeps its own conversation out of the chat list", () => {
  const conversation = storage.createConversation("What is the plan?", "quick");
  const thread = storage.createQuickAsk(conversation.id, "What is the plan?");

  assert.equal(storage.listConversations().some((item) => item.id === conversation.id), false);
  assert.equal(storage.getConversation(conversation.id)?.kind, "quick");
  assert.equal(storage.listQuickAsks().length, 1);
  assert.equal(storage.listQuickAsks()[0].question, "What is the plan?");
  assert.equal(storage.listQuickAsks()[0].answer, "");
  assert.equal(storage.getQuickAsk(thread.id)?.conversationId, conversation.id);

  storage.updateQuickAsk(thread.id, "Ship the history today.");
  assert.equal(storage.listQuickAsks()[0].answer, "Ship the history today.");
});

test("a pinned quick ask stays at the top of the history", () => {
  const first = storage.createQuickAsk(storage.createConversation("Older", "quick").id, "Older question");
  const second = storage.createQuickAsk(storage.createConversation("Newer", "quick").id, "Newer question");
  storage.setQuickAskPinned(first.id, true);

  const order = storage.listQuickAsks().map((item) => item.id);
  assert.equal(order[0], first.id);
  assert.equal(storage.getQuickAsk(first.id)?.pinned, true);
  assert.equal(storage.getQuickAsk(second.id)?.pinned, false);

  storage.setQuickAskPinned(first.id, false);
  assert.equal(storage.getQuickAsk(first.id)?.pinned, false);
});

test("a quick ask's question and answer are sealed like the rest of the history", () => {
  storage.setEncryption(true);
  const conversation = storage.createConversation("Sealed question", "quick");
  const thread = storage.createQuickAsk(conversation.id, "sealed question body");
  storage.updateQuickAsk(thread.id, "sealed answer body");

  const db = raw();
  try {
    const row = db.prepare("SELECT question, answer FROM quick_asks WHERE id = ?").get(thread.id) as {
      question: string;
      answer: string;
    };
    assert.ok(row.question.startsWith("enc:v1:"));
    assert.ok(row.answer.startsWith("enc:v1:"));
    assert.equal(row.question.includes("sealed question body"), false);
    assert.equal(row.answer.includes("sealed answer body"), false);
  } finally {
    db.close();
  }
  assert.equal(storage.getQuickAsk(thread.id)?.question, "sealed question body");
  assert.equal(storage.getQuickAsk(thread.id)?.answer, "sealed answer body");
});

test("opening a quick ask in the chat puts its conversation back in the chat list", () => {
  const conversation = storage.createConversation("Promoted", "quick");
  storage.createQuickAsk(conversation.id, "Promoted question");
  assert.equal(storage.listConversations().some((item) => item.id === conversation.id), false);

  storage.promoteConversation(conversation.id);
  assert.equal(storage.getConversation(conversation.id)?.kind, "chat");
  assert.equal(storage.listConversations().some((item) => item.id === conversation.id), true);
});

test("deleting a quick ask takes its transcript with it", () => {
  const conversation = storage.createConversation("Doomed", "quick");
  const thread = storage.createQuickAsk(conversation.id, "Doomed question");
  storage.saveMessage(conversation.id, message("msg_doomed"));
  assert.equal(storage.getMessages(conversation.id).length, 1);

  storage.deleteConversation(conversation.id);
  assert.equal(storage.getQuickAsk(thread.id), null);
  assert.equal(storage.getConversation(conversation.id), null);
  assert.equal(storage.getMessages(conversation.id).length, 0);
});
