import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import type { Config, MessageAttachment, MessageMetadata } from "./types";

export const BUNDLE_FORMAT = "openmonkey-export";
export const BUNDLE_VERSION = 1;
const HEADER = `${BUNDLE_FORMAT}.${BUNDLE_VERSION}`;
const MAX_FILE_BYTES = 64 * 1024 * 1024;

/** A stored turn plus the expanded prompt the visible bubble leaves out. */
export interface ExportedMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  /** JSON carries timestamps as ISO strings, never as Date objects. */
  timestamp: string;
  prompt?: string;
  metadata?: MessageMetadata;
}

export interface ExportedConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  pinned: boolean;
  archived: boolean;
  /** A quick ask keeps its own kind so the popover history survives a backup. */
  kind: "chat" | "quick";
  /** false when the user turned memory recall off for this chat. */
  recall?: boolean;
  messages: ExportedMessage[];
}

export interface ExportedFact {
  id: string;
  content: string;
  createdAt: string;
}

/** A summary the user wrote for one conversation. */
export interface ExportedSummary {
  conversationId: string;
  content: string;
  updatedAt: string;
}

export interface ExportBundle {
  format: typeof BUNDLE_FORMAT;
  version: number;
  exportedAt: string;
  /** The database layout the file was written from, so a newer file is refused. */
  schemaVersion: number;
  settings: Config;
  conversations: ExportedConversation[];
  facts: ExportedFact[];
  /** Optional: a bundle written before the memory browser has none. */
  summaries?: ExportedSummary[];
}

function derive(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
}

/**
 * A backup is portable precisely because the history key is not: this envelope is
 * opened by the passphrase the user typed when they exported.
 */
export function encryptBundle(bundle: ExportBundle, passphrase: string): string {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", derive(passphrase, salt), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(bundle), "utf8"), cipher.final()]);
  return [HEADER, salt.toString("base64"), iv.toString("base64"), cipher.getAuthTag().toString("base64"), body.toString("base64")].join(":");
}

/** Null means the file is not ours or the passphrase is wrong; both are the same answer. */
export function decryptBundle(text: string, passphrase: string): unknown | null {
  const parts = text.trim().split(":");
  if (parts.length !== 5 || parts[0] !== HEADER) return null;
  try {
    const [, encodedSalt, encodedIv, encodedTag, encodedBody] = parts;
    const decipher = createDecipheriv("aes-256-gcm", derive(passphrase, Buffer.from(encodedSalt, "base64")), Buffer.from(encodedIv, "base64"));
    decipher.setAuthTag(Buffer.from(encodedTag, "base64"));
    const json = Buffer.concat([decipher.update(Buffer.from(encodedBody, "base64")), decipher.final()]).toString("utf8");
    return JSON.parse(json) as unknown;
  } catch {
    return null;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const str = (value: unknown, max: number): string =>
  typeof value === "string" && value.length <= max ? value : "";

const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

/** Only the fields this build knows about survive; anything else is dropped, not stored. */
function normalizeMetadata(value: unknown): MessageMetadata | undefined {
  if (!isRecord(value)) return undefined;
  const attachments = normalizeAttachments(value.attachments, value.attachment);
  return {
    mood: str(value.mood, 40) || undefined,
    taskType: str(value.taskType, 40) || undefined,
    durationMs: num(value.durationMs),
    tokens: num(value.tokens),
    variantOf: str(value.variantOf, 120) || undefined,
    stopped: value.stopped === true ? true : undefined,
    attachments: attachments.length ? attachments : undefined,
  };
}

/**
 * A backup may carry the list of files a message came with, or the single file an
 * older build wrote. Both are checked field by field before they are stored.
 */
function normalizeAttachments(list: unknown, legacy: unknown): MessageAttachment[] {
  const items = Array.isArray(list) ? list : [];
  const one = isRecord(legacy) ? [legacy] : [];
  return [...items, ...one]
    .filter(isRecord)
    .map((item) => ({
      name: str(item.name, 160),
      bytes: num(item.bytes) ?? 0,
      kind: item.kind === "image" ? ("image" as const) : ("text" as const),
    }))
    .filter((item) => item.name.length > 0)
    .slice(0, 20);
}

/** A file is untrusted input even when the user chose it, so every field is checked. */
export function validateBundle(value: unknown, currentSchemaVersion: number): ExportBundle {
  if (!isRecord(value)) throw new Error("That file is not an OpenMonkey backup");
  if (value.format !== BUNDLE_FORMAT) throw new Error("That file is not an OpenMonkey backup");
  if (typeof value.version !== "number") throw new Error("That backup has no version");
  if (value.version > BUNDLE_VERSION) throw new Error("This backup was written by a newer OpenMonkey");
  if (typeof value.schemaVersion === "number" && value.schemaVersion > currentSchemaVersion) {
    throw new Error("This backup needs a newer database layout");
  }
  if (!isRecord(value.settings)) throw new Error("That backup has no settings");
  if (!Array.isArray(value.conversations)) throw new Error("That backup has no conversations");

  const conversations = value.conversations.slice(0, 5_000).map((entry) => {
    if (!isRecord(entry)) throw new Error("A conversation in that backup is unreadable");
    const messages = Array.isArray(entry.messages)
      ? entry.messages.slice(0, 20_000).map((item) => {
          if (!isRecord(item)) throw new Error("A message in that backup is unreadable");
          const role = str(item.role, 20);
          return {
            id: str(item.id, 120),
            role: (role === "assistant" || role === "system" ? role : "user") as ExportedMessage["role"],
            content: typeof item.content === "string" ? item.content.slice(0, 2_000_000) : "",
            timestamp: str(item.timestamp, 40) || new Date().toISOString(),
            prompt: typeof item.prompt === "string" ? item.prompt.slice(0, 2_000_000) : undefined,
            metadata: normalizeMetadata(item.metadata),
          } satisfies ExportedMessage;
        })
      : [];
    return {
      id: str(entry.id, 120),
      title: str(entry.title, 200) || "Imported chat",
      createdAt: str(entry.createdAt, 40) || new Date().toISOString(),
      updatedAt: str(entry.updatedAt, 40) || new Date().toISOString(),
      pinned: entry.pinned === true,
      archived: entry.archived === true,
      kind: entry.kind === "quick" ? "quick" : "chat",
      recall: entry.recall !== false,
      messages,
    } satisfies ExportedConversation;
  });

  const facts = Array.isArray(value.facts)
    ? value.facts.slice(0, 2_000).map((entry) => {
        if (!isRecord(entry)) throw new Error("A memory fact in that backup is unreadable");
        return {
          id: str(entry.id, 120),
          content: str(entry.content, 4_000),
          createdAt: str(entry.createdAt, 40) || new Date().toISOString(),
        } satisfies ExportedFact;
      })
    : [];

  const summaries = Array.isArray(value.summaries)
    ? value.summaries.slice(0, 2_000).map((entry) => {
        if (!isRecord(entry)) throw new Error("A memory summary in that backup is unreadable");
        return {
          conversationId: str(entry.conversationId, 120),
          content: str(entry.content, 4_000),
          updatedAt: str(entry.updatedAt, 40) || new Date().toISOString(),
        } satisfies ExportedSummary;
      })
    : [];

  return {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    exportedAt: str(value.exportedAt, 40),
    schemaVersion: typeof value.schemaVersion === "number" ? value.schemaVersion : 1,
    settings: value.settings as unknown as Config,
    conversations,
    facts,
    summaries,
  };
}

export function readBundleFile(bytes: Buffer, passphrase: string, schemaVersion: number): ExportBundle {
  if (bytes.byteLength > MAX_FILE_BYTES) throw new Error("That backup file is too large to open");
  const value = decryptBundle(bytes.toString("utf8"), passphrase);
  if (value === null) throw new Error("Wrong passphrase, or the file is damaged");
  return validateBundle(value, schemaVersion);
}

export const EXPORT_FILE_SUFFIX = ".openmonkey-export";
