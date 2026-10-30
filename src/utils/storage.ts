import Database from "better-sqlite3";
import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { config, dataRoot } from "./config";
import logger from "./logger";
import {
  HistoryLocked,
  clearPassphrase,
  destroyKeys,
  loadOrCreateKey,
  passphraseConfigured,
  setPassphrase,
  unlockKey,
  type KeySource,
} from "./secret-key";
import type {
  AuditEntry,
  Config,
  ConfigPatch,
  Conversation,
  ConversationSearchHit,
  MemoryFact,
  Message,
  Task,
} from "./types";
import type { ExportBundle, ExportedMessage } from "./portability";

const PREFIX = "enc:v1:";
const DEFAULT_TITLE = "New chat";
const RETENTION_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** Bumped when the table layout changes; an export carries it so a newer file is refused. */
export const SCHEMA_VERSION = 1;

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
 * Conversation and task history lives in a local SQLite file. Content is encrypted
 * at rest with a random key that never leaves this machine — the system keychain
 * holds it where one exists. The key is the only thing that can read the rows, so
 * losing it makes the history unreadable on purpose.
 */
export class Storage {
  private db: Database.Database | null = null;
  private key: Buffer | null = null;
  /** Where the history key came from, so Settings can state it truthfully. */
  keySource: KeySource | "locked" | "off" = "off";
  /** True when the database is closed and its contents unreadable until unlocked. */
  locked = false;
  private retentionTimer: NodeJS.Timeout | null = null;

  init(): void {
    if (this.db || this.locked) return;
    if (!config.get("privacy").encryptData) {
      this.keySource = "off";
      this.openDatabase();
      return;
    }
    let key: Buffer;
    let source: KeySource;
    try {
      ({ key, source } = loadOrCreateKey());
    } catch (error) {
      if (!(error instanceof HistoryLocked)) throw error;
      // A passphrase-protected database is not opened at all until it is unlocked.
      this.locked = true;
      this.keySource = "locked";
      logger.info("history.locked.at.start");
      return;
    }
    this.key = key;
    this.keySource = source;
    this.openDatabase();
  }

  private openDatabase(): void {
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
        command TEXT,
        cwd TEXT,
        created_at INTEGER NOT NULL,
        completed_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS audit (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        conversation_id TEXT,
        type TEXT NOT NULL,
        action TEXT NOT NULL,
        summary TEXT NOT NULL,
        arguments TEXT NOT NULL,
        decision TEXT NOT NULL,
        status TEXT NOT NULL,
        result TEXT,
        error TEXT,
        created_at INTEGER NOT NULL,
        completed_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS memory_facts (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL
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

    const taskColumns = this.db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>;
    const taskNames = new Set(taskColumns.map((column) => column.name));
    if (!taskNames.has("command")) this.db.exec("ALTER TABLE tasks ADD COLUMN command TEXT");
    if (!taskNames.has("cwd")) this.db.exec("ALTER TABLE tasks ADD COLUMN cwd TEXT");

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages (conversation_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations (updated_at);
      CREATE INDEX IF NOT EXISTS idx_audit_created ON audit (created_at);
      CREATE INDEX IF NOT EXISTS idx_memory_facts_created ON memory_facts (created_at);
    `);

    this.migrateLegacyMessages();
    // Builds before this stamped nothing, so an old file arrives at 0 and is brought
    // up to the layout it now actually has. Never lower it: a newer file stays newer.
    if (this.schemaVersion() < SCHEMA_VERSION) this.db.pragma(`user_version = ${SCHEMA_VERSION}`);
    this.runRetention();
    // A laptop that stays asleep for a week must still honour its retention policy,
    // so pruning is a timer as well as a launch step.
    this.retentionTimer = setInterval(() => this.runRetention(), RETENTION_INTERVAL_MS);
    this.retentionTimer.unref();
  }

  /** Delete rows older than the configured window. Safe to call any time. */
  runRetention(): void {
    if (!this.db) return;
    this.pruneOlderThan(config.get("privacy").autoDeleteAfter);
  }

  /** The layout on disk; 0 while the history is locked or not yet opened. */
  schemaVersion(): number {
    if (!this.db) return 0;
    return Number(this.db.pragma("user_version", { simple: true }) ?? 0);
  }

  /**
   * Everything worth moving to another machine: decrypted chat bodies, memory and
   * settings. The history key is deliberately absent — the caller seals this with a
   * passphrase the user chooses, and the receiving install re-encrypts with its own.
   */
  exportBundle(): ExportBundle {
    if (!this.db) throw new Error("History is locked");
    const chats = this.db
      .prepare("SELECT id, title, created_at, updated_at, pinned, archived FROM conversations ORDER BY updated_at DESC")
      .all() as Array<Pick<ConversationRow, "id" | "title" | "created_at" | "updated_at" | "pinned" | "archived">>;
    const messages = this.db
      .prepare("SELECT * FROM messages ORDER BY created_at ASC, rowid ASC")
      .all() as MessageRow[];
    const byChat = new Map<string, ExportedMessage[]>();
    for (const row of messages) {
      if (!row.conversation_id) continue;
      const list = byChat.get(row.conversation_id) ?? [];
      list.push({
        id: row.id,
        role: row.role,
        content: this.open(row.content),
        timestamp: new Date(row.created_at).toISOString(),
        prompt: row.prompt ? this.open(row.prompt) : undefined,
        metadata: this.metadataOf(row),
      });
      byChat.set(row.conversation_id, list);
    }
    return {
      format: "openmonkey-export",
      version: 1,
      exportedAt: new Date().toISOString(),
      schemaVersion: this.schemaVersion(),
      settings: config.getAll(),
      conversations: chats.map((row) => ({
        id: row.id,
        title: row.title,
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString(),
        pinned: row.pinned === 1,
        archived: row.archived === 1,
        messages: byChat.get(row.id) ?? [],
      })),
      facts: this.getMemoryFacts(2_000).map((fact) => ({
        id: fact.id,
        content: fact.content,
        createdAt: fact.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Merge a backup into this database instead of replacing it, and re-seal every body
   * with this install's key. A chat whose id is already here is left alone, so
   * importing the same file twice cannot double the history.
   */
  importBundle(
    bundle: ExportBundle,
    restoreSettings: boolean
  ): { conversations: number; messages: number; facts: number } {
    if (!this.db) throw new Error("History is locked");
    const stamp = (iso: string, fallback: number) => {
      const parsed = Date.parse(iso);
      return Number.isFinite(parsed) ? parsed : fallback;
    };
    let conversations = 0;
    let messages = 0;
    let facts = 0;

    const merge = this.db.transaction(() => {
      for (const exported of bundle.conversations) {
        if (!exported.id) continue;
        if (this.db!.prepare("SELECT 1 FROM conversations WHERE id = ?").get(exported.id)) continue;
        const createdAt = stamp(exported.createdAt, Date.now());
        this.db!
          .prepare("INSERT INTO conversations (id, title, created_at, updated_at, pinned, archived) VALUES (?, ?, ?, ?, ?, ?)")
          .run(
            exported.id,
            clean(exported.title, 80) || DEFAULT_TITLE,
            createdAt,
            Math.max(createdAt, stamp(exported.updatedAt, createdAt)),
            exported.pinned ? 1 : 0,
            exported.archived ? 1 : 0
          );
        conversations += 1;
        for (const message of exported.messages) {
          // An empty body means the row was unreadable where it was written; restoring
          // it would only add blank bubbles.
          if (!message.content.trim() && !message.prompt?.trim()) continue;
          const at = stamp(message.timestamp, Date.now());
          this.db!
            .prepare(
              `INSERT OR IGNORE INTO messages
                (id, conversation_id, role, content, prompt, mood, task_type, attachment_name,
                 attachment_bytes, duration_ms, stopped, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              message.id || idFor("msg"),
              exported.id,
              message.role,
              this.seal(message.content),
              message.prompt ? this.seal(message.prompt) : null,
              message.metadata?.mood ?? null,
              message.metadata?.taskType ?? null,
              message.metadata?.attachment?.name ?? null,
              message.metadata?.attachment?.bytes ?? null,
              message.metadata?.durationMs ?? null,
              message.metadata?.stopped ? 1 : null,
              at
            );
          messages += 1;
        }
      }

      const known = new Set(this.getMemoryFacts(2_000).map((fact) => fact.content.trim()));
      for (const fact of bundle.facts) {
        const content = fact.content.trim();
        if (!content || known.has(content)) continue;
        this.db!
          .prepare("INSERT INTO memory_facts (id, content, created_at) VALUES (?, ?, ?)")
          .run(fact.id || idFor("fact"), this.seal(content), stamp(fact.createdAt, Date.now()));
        known.add(content);
        facts += 1;
      }
    });
    merge();

    if (restoreSettings) this.importSettings(bundle.settings);
    return { conversations, messages, facts };
  }

  /**
   * Only sections this build knows about are applied, and a backup cannot turn local
   * encryption off — that switch belongs to the machine it lands on.
   */
  private importSettings(settings: Config): void {
    if (!settings) return;
    const local = config.getAll();
    const known = new Set(Object.keys(local));
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(settings)) {
      if (!known.has(key) || value == null) continue;
      patch[key] = key === "privacy" ? { ...value, encryptData: local.privacy.encryptData } : value;
    }
    if (Object.keys(patch).length) config.merge(patch as unknown as ConfigPatch);
  }

  /**
   * Require the passphrase before the history is readable, and drop every copy of
   * the key the vault could open on its own.
   */
  protect(passphrase: string): void {
    if (!this.key) throw new Error("Turn on encrypted history first");
    if (passphrase.length < 6) throw new Error("Use at least 6 characters");
    setPassphrase(this.key, passphrase);
    this.keySource = "passphrase";
  }

  /** Returns false when the passphrase does not match, leaving protection in place. */
  unprotect(passphrase: string): boolean {
    if (!clearPassphrase(passphrase)) return false;
    const { key, source } = loadOrCreateKey();
    this.key?.fill(0);
    this.key = key;
    this.keySource = source;
    return true;
  }

  unlock(passphrase: string): boolean {
    if (!this.locked) return true;
    const key = unlockKey(passphrase);
    if (!key) return false;
    this.key = key;
    this.keySource = "passphrase";
    this.locked = false;
    this.openDatabase();
    return true;
  }

  /**
   * Only a passphrase profile has something to lock: without one the key is the
   * login session's, and pretending otherwise would be theatre.
   */
  get lockable(): boolean {
    return passphraseConfigured();
  }

  lock(): void {
    if (!this.lockable) return;
    this.close();
    this.key?.fill(0);
    this.key = null;
    this.keySource = "locked";
    this.locked = true;
    logger.info("history.locked");
  }

  /**
   * Remove the database, the key in every form it exists in and the logs, then
   * start again with an empty file and a fresh key. Settings are untouched because
   * they never hold conversation text.
   */
  eraseAll(): void {
    this.close();
    destroyKeys();
    const dir = dataRoot();
    for (const name of ["openmonkey.db", "openmonkey.db-wal", "openmonkey.db-shm"]) {
      fs.rmSync(path.join(dir, name), { force: true });
    }
    fs.rmSync(path.join(app.getPath("userData"), "logs"), { recursive: true, force: true });
    // The log handle points at a deleted inode until it is reopened.
    logger.reset();
    this.key = null;
    this.keySource = "off";
    this.locked = false;
    logger.info("history.erased");
    this.init();
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
      metadata: this.metadataOf(row) as Message["metadata"],
    };
  }

  /** Side columns that do not belong to the message body itself, for both reads and backups. */
  private metadataOf(row: MessageRow): Record<string, unknown> {
    const attachment =
      row.attachment_name != null ? { name: row.attachment_name, bytes: row.attachment_bytes ?? 0 } : undefined;
    return {
      mood: row.mood ?? undefined,
      taskType: row.task_type ?? undefined,
      durationMs: row.duration_ms ?? undefined,
      stopped: row.stopped === 1 ? true : undefined,
      attachment,
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
   * key — which never leaves this machine — as the single thing that can read the rows.
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
        `INSERT INTO tasks (id, type, description, status, emoji, result, error, command, cwd, created_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        task.command ?? null,
        task.cwd ? this.seal(task.cwd) : null,
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
      command: string | null;
      cwd: string | null;
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
      command: row.command ?? undefined,
      cwd: row.cwd ? this.open(row.cwd) : undefined,
      createdAt: new Date(row.created_at),
      completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
    }));
  }

  addMemoryFact(content: string): MemoryFact {
    const fact: MemoryFact = { id: idFor("fact"), content, createdAt: new Date() };
    this.db
      ?.prepare("INSERT INTO memory_facts (id, content, created_at) VALUES (?, ?, ?)")
      .run(fact.id, this.seal(content), fact.createdAt.getTime());
    return fact;
  }

  /** Newest first, so the UI and the prompt both prefer recent facts. */
  getMemoryFacts(limit = 100): MemoryFact[] {
    if (!this.db) return [];
    const rows = this.db
      .prepare("SELECT * FROM memory_facts ORDER BY created_at DESC LIMIT ?")
      .all(limit) as Array<{ id: string; content: string; created_at: number }>;
    return rows.map((row) => ({
      id: row.id,
      content: this.open(row.content),
      createdAt: new Date(row.created_at),
    }));
  }

  deleteMemoryFact(id: string): void {
    this.db?.prepare("DELETE FROM memory_facts WHERE id = ?").run(id);
  }

  clearMemoryFacts(): void {
    this.db?.prepare("DELETE FROM memory_facts").run();
  }

  saveAudit(entry: AuditEntry): void {
    if (!this.db) return;
    this.db
      .prepare(
        `INSERT INTO audit (id, task_id, conversation_id, type, action, summary, arguments, decision, status, result, error, created_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           decision = excluded.decision,
           status = excluded.status,
           result = excluded.result,
           error = excluded.error,
           completed_at = excluded.completed_at`
      )
      .run(
        entry.id,
        entry.taskId,
        entry.conversationId,
        entry.type,
        entry.action,
        entry.summary,
        this.seal(JSON.stringify(entry.arguments)),
        entry.decision,
        entry.status,
        entry.result ? this.seal(entry.result.slice(0, 8_000)) : null,
        entry.error ? this.seal(entry.error.slice(0, 4_000)) : null,
        entry.createdAt.getTime(),
        entry.completedAt?.getTime() ?? null
      );
  }

  getAuditLog(limit = 100): AuditEntry[] {
    if (!this.db) return [];
    const rows = this.db
      .prepare("SELECT * FROM audit ORDER BY created_at DESC LIMIT ?")
      .all(Math.min(Math.max(1, limit), 500)) as Array<{
      id: string;
      task_id: string;
      conversation_id: string | null;
      type: AuditEntry["type"];
      action: string;
      summary: string;
      arguments: string;
      decision: AuditEntry["decision"];
      status: AuditEntry["status"];
      result: string | null;
      error: string | null;
      created_at: number;
      completed_at: number | null;
    }>;

    return rows.map((row) => {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(this.open(row.arguments)) as Record<string, unknown>;
      } catch {
        args = {};
      }
      return {
        id: row.id,
        taskId: row.task_id,
        conversationId: row.conversation_id,
        type: row.type,
        action: row.action,
        summary: row.summary,
        arguments: args,
        decision: row.decision,
        status: row.status,
        result: row.result ? this.open(row.result) : undefined,
        error: row.error ? this.open(row.error) : undefined,
        createdAt: new Date(row.created_at),
        completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
      };
    });
  }

  clearAuditLog(): void {
    this.db?.prepare("DELETE FROM audit").run();
  }

  private pruneOlderThan(days: number): void {
    if (!this.db || days <= 0) return;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    this.db.prepare("DELETE FROM messages WHERE created_at < ?").run(cutoff);
    this.db.prepare("DELETE FROM tasks WHERE created_at < ?").run(cutoff);
    this.db.prepare("DELETE FROM audit WHERE created_at < ?").run(cutoff);
    this.db
      .prepare(
        "DELETE FROM conversations WHERE updated_at < ? AND NOT EXISTS (SELECT 1 FROM messages WHERE conversation_id = conversations.id)"
      )
      .run(cutoff);
  }

  close(): void {
    if (this.retentionTimer) {
      clearInterval(this.retentionTimer);
      this.retentionTimer = null;
    }
    // Fold the write-ahead log back into the database so a quit leaves one file,
    // not a half-replayed journal.
    try {
      this.db?.pragma("wal_checkpoint(TRUNCATE)");
    } catch {
      /* a damaged database should still close */
    }
    this.db?.close();
    this.db = null;
  }
}

export const storage = new Storage();
export default storage;
