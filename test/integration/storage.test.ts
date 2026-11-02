import { test, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import Database from "better-sqlite3";
import storage, { SCHEMA_VERSION } from "../../src/utils/storage";
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
    assert.equal(db.pragma("user_version", { simple: true }), SCHEMA_VERSION);
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

const reply = (
  conversationId: string,
  id: string,
  content: string,
  when: number,
  metadata?: Message["metadata"]
): string => {
  storage.saveMessage(conversationId, {
    id,
    role: "assistant",
    content,
    timestamp: new Date(when),
    metadata,
  });
  return id;
};

const ask = (conversationId: string, id: string, when: number): string => {
  storage.saveMessage(conversationId, message(id, when));
  return id;
};

test("a regenerated answer keeps the one it replaced, and the chat shows only the newest", () => {
  const thread = storage.createConversation("Variants");
  const started = Date.now();
  ask(thread.id, "var_q1", started);
  reply(thread.id, "var_a1", "first answer", started + 10, { durationMs: 900, tokens: 12 });
  reply(thread.id, "var_a2", "second answer", started + 20, {
    variantOf: "var_a1",
    durationMs: 1400,
    tokens: 31,
  });

  const shown = storage.getMessages(thread.id, 500);
  assert.deepEqual(
    shown.map((item) => item.id),
    ["var_q1", "var_a2"]
  );
  assert.equal(shown[1].metadata?.variantCount, 2);
  assert.equal(shown[1].metadata?.variantIndex, 2);
  assert.equal(shown[1].metadata?.variantOf, "var_a1");
  assert.equal(shown[1].metadata?.tokens, 31);

  const group = storage.listVariants("var_a2");
  assert.deepEqual(
    group.map((item) => [item.id, item.content, item.metadata?.variantIndex]),
    [
      ["var_a1", "first answer", 1],
      ["var_a2", "second answer", 2],
    ]
  );

  storage.setActiveVariant("var_a1");
  const switched = storage.getMessages(thread.id, 500);
  assert.equal(switched[1].id, "var_a1");
  assert.equal(switched[1].metadata?.variantIndex, 1);
  assert.equal(storage.getLastAssistantMessage(thread.id)?.id, "var_a1");
});

test("the answer regenerating groups onto is only the chat's own last row", () => {
  const thread = storage.createConversation("Variant edges");
  const started = Date.now();
  ask(thread.id, "edge_q1", started);
  reply(thread.id, "edge_a1", "answer", started + 10);
  assert.equal(storage.getLastAssistantMessage(thread.id)?.id, "edge_a1");

  ask(thread.id, "edge_q2", started + 20);
  assert.equal(storage.getLastAssistantMessage(thread.id), null);

  assert.equal(storage.listVariants("edge_a1").length, 1);
  assert.equal(storage.getMessages(thread.id, 500).length, 3);
});

test("editing a question drops it and every turn after it, and nothing before", () => {
  const thread = storage.createConversation("Truncate");
  const started = Date.now();
  ask(thread.id, "tr_q1", started);
  reply(thread.id, "tr_a1", "kept answer", started + 10);
  ask(thread.id, "tr_q2", started + 20);
  reply(thread.id, "tr_a2", "gone answer", started + 30);
  ask(thread.id, "tr_q3", started + 40);

  assert.equal(storage.deleteFromMessage(thread.id, "tr_q2"), 3);
  assert.deepEqual(
    storage.getMessages(thread.id, 500).map((item) => item.id),
    ["tr_q1", "tr_a1"]
  );

  assert.equal(storage.deleteFromMessage(thread.id, "missing_row"), 0);
  assert.equal(storage.deleteFromMessage(thread.id, "tr_q1"), 2);
  assert.equal(storage.getMessages(thread.id, 500).length, 0);
});

test("a branch copies the chat up to one message, with its chosen answer and new ids", () => {
  const thread = storage.createConversation("Branch source");
  const started = Date.now();
  ask(thread.id, "br_q1", started);
  reply(thread.id, "br_a1", "first answer", started + 10, { tokens: 8 });
  reply(thread.id, "br_a2", "second answer", started + 20, { variantOf: "br_a1", tokens: 16 });
  ask(thread.id, "br_q2", started + 30);

  const branch = storage.branchConversationFrom(thread.id, "br_a2", "Branch source (branch)");
  assert.ok(branch);
  assert.equal(branch.title, "Branch source (branch)");
  const copied = storage.getMessages(branch.id, 500);
  assert.equal(storage.getConversation(branch.id)?.messageCount, 2);
  assert.deepEqual(
    copied.map((item) => item.content),
    [body("br_q1"), "second answer"]
  );

  const last = copied[1];
  assert.equal(last.metadata?.tokens, 16);
  // The alternates stay where they were: a branch carries the chat as it looked.
  assert.equal(last.metadata?.variantOf, undefined);
  assert.notEqual(last.id, "br_a2");
  assert.equal(storage.listVariants(last.id).length, 1);
  assert.equal(storage.listVariants("br_a2").length, 2);
  assert.equal(storage.getMessages(thread.id, 500).length, 3);

  assert.equal(storage.listConversations().some((item) => item.id === branch.id), true);
  assert.equal(storage.branchConversationFrom(thread.id, "missing_row", "Nothing"), null);
});

test("a restored backup shows the newest variant of an answer and keeps the others", () => {
  const thread = storage.createConversation("Import group");
  const started = Date.now();
  ask(thread.id, "imp_q1", started);
  reply(thread.id, "imp_a1", "short way", started + 10, { tokens: 5 });
  reply(thread.id, "imp_a2", "long way", started + 20, { variantOf: "imp_a1", tokens: 50 });

  const bundle = storage.exportBundle();
  const source = bundle.conversations.find((item) => item.id === thread.id);
  assert.ok(source);

  // A restore puts rows back under the ids the backup carries, so an occupied id is
  // skipped rather than duplicated. Erasing the chat first is what real restore does.
  storage.deleteConversation(thread.id);
  storage.importBundle({ ...bundle, conversations: [source] }, false);

  const shown = storage.getMessages(thread.id, 500);
  assert.deepEqual(
    shown.map((item) => item.id),
    ["imp_q1", "imp_a2"]
  );
  assert.equal(shown[1].metadata?.tokens, 50);
  assert.equal(shown[1].metadata?.variantCount, 2);
  assert.equal(storage.listVariants("imp_a2").length, 2);
});
