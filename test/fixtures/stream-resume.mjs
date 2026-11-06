import Database from "better-sqlite3";

export const CONVERSATION_ID = "conv_resume_seed";
export const QUESTION = "Name the tree in the yard.";
export const LOST_ANSWER = "The tree is called an";
export const FINISHED_ANSWER = "A birch, and it stood there before the house.";

/**
 * Writes a chat with a cut-off answer and a finished one straight into the app's
 * SQLite file. The cut-off answer carries the flag the app writes while an answer
 * is still being written, so the chat offers to carry it on. Bodies stay plain
 * text: the storage layer reads an unsealed row as written, which keeps this
 * independent of the history key.
 */
export function seedUnfinishedThread(dbFile, conversationId = CONVERSATION_ID) {
  const now = Date.now();
  const db = new Database(dbFile);
  db.prepare(
    "INSERT OR REPLACE INTO conversations (id, title, created_at, updated_at, pinned, archived, kind) VALUES (?, ?, ?, ?, 0, 0, 'chat')"
  ).run(conversationId, "Lost answer", now, now);
  const insert = db.prepare(
    "INSERT OR REPLACE INTO messages (id, conversation_id, role, content, created_at, duration_ms, tokens, variant_of, active, stopped, unfinished) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  insert.run(`${conversationId}_q`, conversationId, "user", QUESTION, now, null, null, null, 1, null, null);
  insert.run(`${conversationId}_lost`, conversationId, "assistant", LOST_ANSWER, now + 1, 900, null, null, 1, 1, 1);
  insert.run(`${conversationId}_done`, conversationId, "assistant", FINISHED_ANSWER, now + 2, 1500, 64, null, 1, null, null);
  db.close();
  return conversationId;
}
