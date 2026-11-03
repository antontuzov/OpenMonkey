import Database from "better-sqlite3";

export const CONVERSATION_ID = "conv_memory_seed";
export const CONVERSATION_TITLE = "Release checklist";
export const QUESTION = "What is left before we ship?";

/**
 * Writes a chat with one question and one answer straight into the app's SQLite
 * file, so the memory browser has a conversation to show without a model behind
 * it. Bodies stay plain text on purpose: the storage layer reads an unsealed row
 * as written, which keeps this independent of the history key.
 */
export function seedMemoryChat(
  dbFile,
  { conversationId = CONVERSATION_ID, title = CONVERSATION_TITLE, answer = "" } = {}
) {
  const now = Date.now();
  const db = new Database(dbFile);
  db.prepare(
    "INSERT OR REPLACE INTO conversations (id, title, created_at, updated_at, pinned, archived, kind) VALUES (?, ?, ?, ?, 0, 0, 'chat')"
  ).run(conversationId, title, now, now);
  const insert = db.prepare(
    "INSERT OR REPLACE INTO messages (id, conversation_id, role, content, created_at, duration_ms, tokens, variant_of, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  insert.run(`${conversationId}_q`, conversationId, "user", QUESTION, now, null, null, null, 1);
  insert.run(`${conversationId}_a`, conversationId, "assistant", answer, now + 1, 900, 24, null, 1);
  db.close();
  return conversationId;
}
