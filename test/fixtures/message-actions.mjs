import Database from "better-sqlite3";

export const CONVERSATION_ID = "conv_actions_seed";
export const QUESTION = "Which answer should we keep?";
export const SHORT_ANSWER = "The short way: one line, no caveats.";
export const LONG_ANSWER = "The long way: three caveats, a table, and a plan for next week.";

/**
 * Writes a chat with two answers to the same question straight into the app's
 * SQLite file. The second answer is the one on screen and the first one stays
 * in its group, so the switcher has something to walk. Bodies stay plain text:
 * the storage layer reads an unsealed row as written, which keeps this
 * independent of the history key.
 */
export function seedMessageThread(dbFile, conversationId = CONVERSATION_ID) {
  const now = Date.now();
  const db = new Database(dbFile);
  db.prepare(
    "INSERT OR REPLACE INTO conversations (id, title, created_at, updated_at, pinned, archived, kind) VALUES (?, ?, ?, ?, 0, 0, 'chat')"
  ).run(conversationId, "Answer probe", now, now);
  const insert = db.prepare(
    "INSERT OR REPLACE INTO messages (id, conversation_id, role, content, created_at, duration_ms, tokens, variant_of, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  insert.run(`${conversationId}_q`, conversationId, "user", QUESTION, now, null, null, null, 1);
  // The older answer keeps the group root; the newer one is the one on screen.
  insert.run(`${conversationId}_a1`, conversationId, "assistant", SHORT_ANSWER, now + 1, 1200, 42, `${conversationId}_a1`, 0);
  insert.run(`${conversationId}_a2`, conversationId, "assistant", LONG_ANSWER, now + 2, 3400, 128, `${conversationId}_a1`, 1);
  db.close();
  return conversationId;
}
