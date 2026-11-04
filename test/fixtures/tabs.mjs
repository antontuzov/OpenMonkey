import Database from "better-sqlite3";

export const FIRST_CONVERSATION = "conv_tabs_release";
export const SECOND_CONVERSATION = "conv_tabs_model";

/**
 * Writes two chats straight into the app's SQLite file, so the tabs can be
 * opened with something in them and without a model in the loop. Bodies stay
 * plain text: the storage layer reads an unsealed row as written, which keeps
 * this independent of the history key.
 */
export function seedTabThread(dbFile) {
  const now = Date.now();
  const db = new Database(dbFile);
  const conversation = db.prepare(
    "INSERT OR REPLACE INTO conversations (id, title, created_at, updated_at, pinned, archived, kind) VALUES (?, ?, ?, ?, 0, 0, 'chat')"
  );
  conversation.run(FIRST_CONVERSATION, "Release checklist", now, now);
  conversation.run(SECOND_CONVERSATION, "Model notes", now + 1, now + 1);
  const insert = db.prepare(
    "INSERT OR REPLACE INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)"
  );
  insert.run(
    `${FIRST_CONVERSATION}_q`,
    FIRST_CONVERSATION,
    "user",
    "What ships on Friday?",
    now
  );
  insert.run(
    `${FIRST_CONVERSATION}_a`,
    FIRST_CONVERSATION,
    "assistant",
    "The release and the model check. The check comes first.",
    now + 1
  );
  insert.run(
    `${SECOND_CONVERSATION}_q`,
    SECOND_CONVERSATION,
    "user",
    "How fast is the model on this Mac?",
    now + 2
  );
  insert.run(
    `${SECOND_CONVERSATION}_a`,
    SECOND_CONVERSATION,
    "assistant",
    "It answers here, on this Mac, with no network in between.",
    now + 3
  );
  db.close();
  return [FIRST_CONVERSATION, SECOND_CONVERSATION];
}
