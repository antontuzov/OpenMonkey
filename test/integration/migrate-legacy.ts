/**
 * Opens the history in the folder named by OM_STUB_HOME and reports what it found.
 * The migration test drives this in a child process, so an old database file can be
 * upgraded away from the shared integration database.
 */
import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import storage from "../../src/utils/storage";
import { dataRoot } from "../../src/utils/config";

storage.init();

const db = new Database(path.join(dataRoot(), "openmonkey.db"), { readonly: true });
const columns = (db.prepare("PRAGMA table_info(messages)").all() as Array<{ name: string }>).map(
  (column) => column.name
);
const version = Number(db.pragma("user_version", { simple: true }));
const raw = db.prepare("SELECT id, attachments FROM messages ORDER BY created_at").all();
db.close();

const messages = storage
  .listConversations()
  .flatMap((conversation) =>
    storage.getMessages(conversation.id).map((message) => ({
      id: message.id,
      content: message.content,
      attachments: message.metadata?.attachments ?? null,
    }))
  );

storage.close();

const report = JSON.stringify({ columns, version, raw, messages });
const target = process.env.OM_MIGRATE_REPORT;
if (target) fs.writeFileSync(target, report);
else process.stdout.write(report);
