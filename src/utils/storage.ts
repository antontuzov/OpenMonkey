import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { config, dataRoot } from "./config";
import type { Conversation, ConversationSearchHit, Message, Task } from "./types";

const PREFIX = "enc:v1:";
const DEFAULT_TITLE = "New chat";

interface MessageRow {
  id: string;
  conversation_id: string | null;
  role: Message["role"];
  content: string;
  prompt: string | null;
  mood: string | null;
  task_type: string | null;
  attachment_name: string | null;
  attachment_bytes: number | null;
  duration_ms: number | null;
  stopped: number | null;
  created_at: number;
}

interface ConversationRow {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  pinned: number;
  archived: number;
  message_count: number;
  last_content: string | null;
}

const idFor = (prefix: string) =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const clean = (text: string, length: number) =>
  text.replace(/\s+/g, " ").trim().slice(0, length);

/**
 * Conversation and task history live in a local SQLite file. Content is encrypted
 * at rest with a random key that never leaves this machine; the key file is the
 * only thing that can read the rows, so deleting it makes the history unreadable.
 */
export class Storage {
  private db: Database.Database | null = null;
  private key: Buffer | null = null;

  init(): void {
    if (this.db) return;
    const file = path.join(dataRoot(), "openmonkey.db");
    this.db = new Database(file);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        pinned INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS messages (
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
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL,
        emoji TEXT NOT NULL,
        result TEXT,
        error TEXT,
        created_at INTEGER NOT NULL,
        completed_at INTEGER
      );
    `);

    const columns = this.db.prepare("PRAGMA table_info(messages)").all() as Array<{ name: string }>;
    const names = new Set(columns.map((column) => column.name));
    if (!names.has("conversation_id")) this.db.exec("ALTER TABLE messages ADD COLUMN conversation_id TEXT");
    if (!names.has("attachment_name")) this.db.exec("ALTER TABLE messages ADD COLUMN attachment_name TEXT");
    if (!names.has("attachment_bytes")) this.db.exec("ALTER TABLE messages ADD COLUMN attachment_bytes INTEGER");
    if (!names.has("prompt")) this.db.exec("ALTER TABLE messages ADD COLUMN prompt TEXT");
    if (!names.has("duration_ms")) this.db.exec("ALTER TABLE messages ADD COLUMN duration_ms INTEGER");
    if (!names.has("stopped")) this.db.exec("ALTER TABLE messages ADD COLUMN stopped INTEGER");
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages (conversation_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations (updated_at);
    `);

    // The key has to exist before migration reads legacy content to name the thread.
    if (config.get("privacy").encryptData) this.key = this.loadKey();
    this.migrateLegacyMessages();
    this.pruneOlderThan(config.get("privacy").autoDeleteAfter);
  }

  private loadKey(): Buffer {
    const keyFile = path.join(dataRoot(), "secret.key");
    if (fs.existsSync(keyFile)) {
      return Buffer.from(fs.readFileSync(keyFile, "utf8"), "base64");
    }
    const key = randomBytes(32);
    fs.writeFileSync(keyFile, key.toString("base64"), { mode: 0o600 });
    return key;
  }

  private seal(text: string): string {
    if (!this.key) return text;
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
    return `${PREFIX}${iv.toString("base64")}.${cipher.getAuthTag().toString("base64")}.${encrypted.toString("base64")}`;
  }

  private open(stored: string): string {
    if (!stored.startsWith(PREFIX) || !this.key) return stored;
    try {
      const [encodedIv, encodedTag, encodedBody] = stored.slice(PREFIX.length).split(".");
      const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(encodedIv, "base64"));
      decipher.setAuthTag(Buffer.from(encodedTag, "base64"));
      return Buffer.concat([decipher.update(Buffer.from(encodedBody, "base64")), decipher.final()]).toString("utf8");
    } catch {
      // Key was rotated or deleted: the row stays on disk but is unreadable by design.
      return "";
    }
  }

  /** Older builds had a single thread. Give those rows a real conversation instead of losing them. */
  private migrateLegacyMessages(): void {
    if (!this.db) return;
    const summary = this.db
      .prepare(
        "SELECT COUNT(*) AS count, MIN(created_at) AS first, MAX(created_at) AS last FROM messages WHERE conversation_id IS NULL"
      )
      .get() as { count: number; first: number | null; last: number | null };
    if (!summary.count) return;

    const first = this.db
      .prepare("SELECT role, content FROM messages WHERE conversation_id IS NULL ORDER BY created_at ASC, rowid ASC LIMIT 1")
      .get() as { role: Message["role"]; content: string } | undefined;
    const firstText = first ? clean(this.open(first.content), 48) : "";
    const title = first?.role === "user" && firstText ? firstText : "Main Session";
    const id = "conv_legacy";
    const createdAt = summary.first ?? Date.now();
    const updatedAt = summary.last ?? createdAt;

    this.db
      .prepare("INSERT OR IGNORE INTO conversations (id, title, created_at, updated_at, pinned, archived) VALUES (?, ?, ?, ?, 0, 0)")
      .run(id, title, createdAt, updatedAt);
    this.db.prepare("UPDATE messages SET conversation_id = ? WHERE conversation_id IS NULL").run(id);
  }

  saveMessage(conversationId: string, message: Message, prompt?: string): void {
    if (!config.get("privacy").saveHistory || !this.db) return;
    this.db
      .prepare(
        `INSERT OR REPLACE INTO messages
          (id, conversation_id, role, content, prompt, mood, task_type, attachment_name, attachment_bytes,
           duration_ms, stopped, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        message.id,
        conversationId,
        message.role,
        this.seal(message.content),
        prompt ? this.seal(prompt) : null,
        message.metadata?.mood ?? null,
        message.metadata?.taskType ?? null,
        message.metadata?.attachment?.name ?? null,
        message.metadata?.attachment?.bytes ?? null,
        message.metadata?.durationMs ?? null,
        message.metadata?.stopped ? 1 : null,
        message.timestamp.getTime()
      );
    this.touchConversation(conversationId, message.timestamp.getTime());
  }

  private toMessage(row: MessageRow): Message {
    return {
      id: row.id,
      role: row.role,
      content: this.open(row.content),
      timestamp: new Date(row.created_at),
      metadata: {
        mood: row.mood ?? undefined,
        taskType: row.task_type ?? undefined,
        durationMs: row.duration_ms ?? undefined,
        stopped: row.stopped === 1 ? true : undefined,
        attachment:
          row.attachment_name != null
            ? { name: row.attachment_name, bytes: row.attachment_bytes ?? 0 }
            : undefined,
      },
    };
  }

  /** Newest `limit` messages, returned oldest-first so the renderer can append. */
  getMessages(conversationId: string, limit = 80): Message[] {
    if (!this.db) return [];
    const rows = this.db
      .prepare(
        "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?"
      )
      .all(conversationId, limit) as MessageRow[];
    return rows.reverse().map((row) => this.toMessage(row));
  }

  getLastUserMessage(conversationId: string): Message | null {
    if (!this.db) return null;
    const row = this.db
      .prepare(
        "SELECT * FROM messages WHERE conversation_id = ? AND role = 'user' ORDER BY created_at DESC, rowid DESC LIMIT 1"
      )
      .get(conversationId) as MessageRow | undefined;
    return row ? this.toMessage(row) : null;
  }

  /** The expanded prompt includes attachment text, which the visible bubble omits. */
  getLastUserPrompt(conversationId: string): string | null {
    if (!this.db) return null;
    const row = this.db
      .prepare(
        "SELECT prompt FROM messages WHERE conversation_id = ? AND role = 'user' ORDER BY created_at DESC, rowid DESC LIMIT 1"
      )
      .get(conversationId) as { prompt: string | null } | undefined;
    return row?.prompt ? this.open(row.prompt) : null;
  }

  /** Regenerate replaces the previous answer instead of stacking a second one. */
  removeLastAssistantMessage(conversationId: string): void {
    if (!this.db) return;
    const row = this.db
      .prepare(
        "SELECT id, role FROM messages WHERE conversation_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1"
      )
      .get(conversationId) as { id: string; role: Message["role"] } | undefined;
    if (row?.role === "assistant") {
      this.db.prepare("DELETE FROM messages WHERE id = ?").run(row.id);
    }
  }

  private toConversation(row: ConversationRow): Conversation {
    return {
      id: row.id,
      title: row.title,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      pinned: row.pinned === 1,
      archived: row.archived === 1,
      messageCount: row.message_count,
      preview: clean(this.open(row.last_content ?? ""), 90),
    };
  }

  private conversationSelect(where = ""): string {
    return `SELECT c.*,
      (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count,
      (SELECT content FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1) AS last_content
      FROM conversations c ${where}`;
  }

  listConversations(): Conversation[] {
    if (!this.db) return [];
    const rows = this.db
      .prepare(this.conversationSelect("WHERE c.archived = 0 ORDER BY c.pinned DESC, c.updated_at DESC"))
      .all() as ConversationRow[];
    return rows.map((row) => this.toConversation(row));
  }

  getConversation(id: string): Conversation | null {
    if (!this.db) return null;
    const row = this.db.prepare(this.conversationSelect("WHERE c.id = ?")).get(id) as
      | ConversationRow
      | undefined;
    return row ? this.toConversation(row) : null;
  }

  latestConversation(): Conversation | null {
    return this.listConversations()[0] ?? null;
  }

  createConversation(title = DEFAULT_TITLE): Conversation {
    if (!this.db) throw new Error("Storage is not open");
    const id = idFor("conv");
    const now = Date.now();
    this.db
      .prepare("INSERT INTO conversations (id, title, created_at, updated_at, pinned, archived) VALUES (?, ?, ?, ?, 0, 0)")
      .run(id, clean(title, 80) || DEFAULT_TITLE, now, now);
    return this.getConversation(id)!;
  }

  renameConversation(id: string, title: string): void {
    if (!this.db) return;
    const trimmed = clean(title, 80);
    if (!trimmed) return;
    this.db.prepare("UPDATE conversations SET title = ? WHERE id = ?").run(trimmed, id);
  }

  setConversationPinned(id: string, pinned: boolean): void {
    if (!this.db) return;
    this.db.prepare("UPDATE conversations SET pinned = ? WHERE id = ?").run(pinned ? 1 : 0, id);
  }

  touchConversation(id: string, at = Date.now()): void {
    if (!this.db) return;
    this.db.prepare("UPDATE conversations SET updated_at = MAX(updated_at, ?) WHERE id = ?").run(at, id);
  }

  deleteConversation(id: string): Conversation | null {
    if (!this.db) return null;
    const remove = this.db.transaction(() => {
      this.db!.prepare("DELETE FROM messages WHERE conversation_id = ?").run(id);
      this.db!.prepare("DELETE FROM conversations WHERE id = ?").run(id);
    });
    remove();
    return this.latestConversation();
  }

  /**
   * Titles are stored in plain text, message bodies are encrypted, so search decrypts
   * recent rows in memory. That is fast enough for a personal history and keeps the
   * key file as the single thing that makes the database readable.
   */
  searchConversations(query: string): ConversationSearchHit[] {
    if (!this.db) return [];
    const needle = query.trim().toLowerCase();
    if (!needle) return [];

    const conversations = this.listConversations();
    const byId = new Map(conversations.map((conversation) => [conversation.id, conversation]));
    const hits = new Map<string, ConversationSearchHit>();

    for (const conversation of conversations) {
      if (conversation.title.toLowerCase().includes(needle)) {
        hits.set(conversation.id, { conversation, snippet: conversation.preview });
      }
    }

    const rows = this.db
      .prepare(
        "SELECT * FROM messages WHERE conversation_id IS NOT NULL ORDER BY created_at DESC, rowid DESC LIMIT 2000"
      )
      .all() as MessageRow[];

    for (const row of rows) {
      if (!row.conversation_id || hits.has(row.conversation_id)) continue;
      const conversation = byId.get(row.conversation_id);
      if (!conversation) continue;
      const text = this.open(row.content);
      const index = text.toLowerCase().indexOf(needle);
      if (index < 0) continue;
      const start = Math.max(0, index - 40);
      const snippet = text
        .slice(start, index + needle.length + 80)
        .replace(/\s+/g, " ")
        .trim();
      hits.set(row.conversation_id, {
        conversation,
        snippet: `${start > 0 ? "…" : ""}${snippet}${text.length > index + needle.length + 80 ? "…" : ""}`,
      });
      if (hits.size >= 20) break;
    }

    return [...hits.values()].slice(0, 20);
  }

  saveTask(task: Task): void {
    if (!this.db) return;
    this.db
      .prepare(
        `INSERT INTO tasks (id, type, description, status, emoji, result, error, created_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status,
           result = excluded.result,
           error = excluded.error,
           completed_at = excluded.completed_at`
      )
      .run(
        task.id,
        task.type,
        task.description,
        task.status,
        task.emoji,
        task.result ? this.seal(task.result) : null,
        task.error ? this.seal(task.error) : null,
        task.createdAt.getTime(),
        task.completedAt?.getTime() ?? null
      );
  }

  getTasks(limit = 50): Task[] {
    if (!this.db) return [];
    const rows = this.db
      .prepare("SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?")
      .all(limit) as Array<{
      id: string;
      type: Task["type"];
      description: string;
      status: Task["status"];
      emoji: string;
      result: string | null;
      error: string | null;
      created_at: number;
      completed_at: number | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      description: row.description,
      status: row.status,
      emoji: row.emoji,
      result: row.result ? this.open(row.result) : undefined,
      error: row.error ? this.open(row.error) : undefined,
      createdAt: new Date(row.created_at),
      completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
    }));
  }

  private pruneOlderThan(days: number): void {
    if (!this.db || days <= 0) return;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    this.db.prepare("DELETE FROM messages WHERE created_at < ?").run(cutoff);
    this.db.prepare("DELETE FROM tasks WHERE created_at < ?").run(cutoff);
    this.db
      .prepare(
        "DELETE FROM conversations WHERE updated_at < ? AND NOT EXISTS (SELECT 1 FROM messages WHERE conversation_id = conversations.id)"
      )
      .run(cutoff);
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }
}

export const storage = new Storage();
export default storage;
