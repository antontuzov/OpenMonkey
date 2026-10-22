import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { config, dataRoot } from "./config";
import type { Message, Task } from "./types";

const PREFIX = "enc:v1:";

/**
 * Conversation and task history live in a local SQLite file. Content is encrypted
 * at rest with a random key that never leaves this machine; the key file is the
 * only thing that can read the rows, so deleting it makes the history unreadable.
 */
export class Storage {
  private db: Database.Database | null = null;
  private key: Buffer | null = null;

  init(): void {
    const file = path.join(dataRoot(), "openmonkey.db");
    this.db = new Database(file);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        mood TEXT,
        task_type TEXT,
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

    if (config.get("privacy").encryptData) this.key = this.loadKey();
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

  saveMessage(message: Message): void {
    if (!config.get("privacy").saveHistory || !this.db) return;
    this.db
      .prepare("INSERT OR REPLACE INTO messages (id, role, content, mood, task_type, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(
        message.id,
        message.role,
        this.seal(message.content),
        message.metadata?.mood ?? null,
        message.metadata?.taskType ?? null,
        message.timestamp.getTime()
      );
  }

  getRecentMessages(limit = 10): Message[] {
    if (!this.db) return [];
    const rows = this.db
      .prepare("SELECT * FROM messages ORDER BY created_at DESC LIMIT ?")
      .all(limit) as Array<{
      id: string;
      role: Message["role"];
      content: string;
      mood: string | null;
      task_type: string | null;
      created_at: number;
    }>;

    return rows
      .reverse()
      .map((row) => ({
        id: row.id,
        role: row.role,
        content: this.open(row.content),
        timestamp: new Date(row.created_at),
        metadata: { mood: row.mood ?? undefined, taskType: row.task_type ?? undefined },
      }));
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
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }
}

export const storage = new Storage();
export default storage;
