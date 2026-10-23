import { safeStorage } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { dataRoot } from "./config";
import logger from "./logger";

const WRAPPED_FILE = "secret.key.enc";
const PLAIN_FILE = "secret.key";
const PASS_FILE = "secret.key.pass";

/** Raised instead of minting a new key: a fresh key would silently orphan old rows. */
export class HistoryLocked extends Error {
  constructor() {
    super("History is protected by a passphrase");
    this.name = "HistoryLocked";
  }
}

export type KeySource = "keychain" | "file" | "passphrase";

/** False on a Linux box with no agent, where the 0600 file is the only option. */
export function keychainAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function fromBase64(text: string): Buffer | null {
  const key = Buffer.from(text.trim(), "base64");
  return key.length === 32 ? key : null;
}

function readPlain(plain: string): Buffer | null {
  if (!fs.existsSync(plain)) return null;
  const key = fromBase64(fs.readFileSync(plain, "utf8"));
  if (!key) throw new Error("The stored encryption key is not a 32-byte value");
  return key;
}

function loadFromKeychain(wrapped: string): Buffer {
  const key = fromBase64(safeStorage.decryptString(fs.readFileSync(wrapped)));
  if (!key) throw new Error("The stored encryption key is not a 32-byte value");
  return key;
}

/**
 * The history key lives in the OS vault when there is one. The plaintext file is
 * removed only after the wrapped copy has been read back, so a failed wrap cannot
 * strand existing encrypted rows.
 */
export function loadOrCreateKey(): { key: Buffer; source: KeySource } {
  if (passphraseConfigured()) throw new HistoryLocked();
  const key = readStoredKey() ?? randomBytes(32);
  return { key, source: storeKey(key) };
}

/** The copy written by a previous run, if any. Never creates anything. */
function readStoredKey(): Buffer | null {
  const dir = dataRoot();
  const plain = path.join(dir, PLAIN_FILE);
  const wrapped = path.join(dir, WRAPPED_FILE);
  if (keychainAvailable() && fs.existsSync(wrapped)) {
    try {
      return loadFromKeychain(wrapped);
    } catch (error) {
      // A damaged vault entry must not silently be treated as "no key": history
      // would be re-keyed and unreadable. Fall back to the file, or fail loudly.
      logger.error("key.wrapped.unreadable", { error: String(error) });
      const rescued = readPlain(plain);
      if (rescued) return rescued;
      throw new Error("The saved encryption key could not be read from the system keychain");
    }
  }
  return readPlain(plain);
}

/** Persist to the vault where possible, otherwise a 0600 file. Returns where it landed. */
function storeKey(key: Buffer): KeySource {
  const dir = dataRoot();
  const plain = path.join(dir, PLAIN_FILE);
  const wrapped = path.join(dir, WRAPPED_FILE);
  if (!keychainAvailable()) {
    const existed = fs.existsSync(plain);
    fs.writeFileSync(plain, key.toString("base64"), { mode: 0o600 });
    if (!existed) logger.warn("key.file.created", { reason: "no keychain" });
    return "file";
  }
  const hadCopy = fs.existsSync(wrapped) || fs.existsSync(plain);
  fs.writeFileSync(wrapped, safeStorage.encryptString(key.toString("base64")));
  // Read it back before dropping the plaintext copy: an unwritable vault entry
  // would otherwise leave the existing history undecryptable.
  if (!loadFromKeychain(wrapped).equals(key)) throw new Error("The system keychain did not return the stored key");
  fs.rmSync(plain, { force: true });
  if (!hadCopy) logger.info("key.created.in.keychain");
  return "keychain";
}

interface Envelope {
  salt: string;
  wrapped: string;
}

/** CPU-hardened wrap: 32 MiB of work, so an offline copy of the file is slow to attack. */
function derive(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
}

function wrapWithPassphrase(key: Buffer, passphrase: string): Envelope {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", derive(passphrase, salt), iv);
  const body = Buffer.concat([cipher.update(key), cipher.final()]);
  const wrapped = Buffer.concat([cipher.getAuthTag(), iv, body]).toString("base64");
  return { salt: salt.toString("base64"), wrapped };
}

/** Returns null for a wrong passphrase: the GCM tag will not verify. */
function unwrapWithPassphrase(envelope: Envelope, passphrase: string): Buffer | null {
  try {
    const payload = Buffer.from(envelope.wrapped, "base64");
    const tag = payload.subarray(0, 16);
    const iv = payload.subarray(16, 28);
    const body = payload.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", derive(passphrase, Buffer.from(envelope.salt, "base64")), iv);
    decipher.setAuthTag(tag);
    const key = Buffer.concat([decipher.update(body), decipher.final()]);
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}

function passFile(): string {
  return path.join(dataRoot(), PASS_FILE);
}

function readEnvelope(): Envelope | null {
  if (!fs.existsSync(passFile())) return null;
  try {
    return JSON.parse(fs.readFileSync(passFile(), "utf8")) as Envelope;
  } catch {
    throw new Error("The passphrase key file is damaged");
  }
}

export function passphraseConfigured(): boolean {
  return fs.existsSync(passFile());
}

/**
 * Turning the passphrase on removes every copy of the key the vault could open on
 * its own, otherwise the extra prompt would be decoration.
 */
export function setPassphrase(key: Buffer, passphrase: string): void {
  const envelope = wrapWithPassphrase(key, passphrase);
  fs.writeFileSync(passFile(), JSON.stringify(envelope), { mode: 0o600 });
  fs.rmSync(path.join(dataRoot(), WRAPPED_FILE), { force: true });
  fs.rmSync(path.join(dataRoot(), PLAIN_FILE), { force: true });
  logger.info("key.passphrase.set");
}

/** Back to vault-only: the passphrase is checked before the copy is deleted. */
export function clearPassphrase(passphrase: string): boolean {
  const envelope = readEnvelope();
  if (!envelope) return false;
  const key = unwrapWithPassphrase(envelope, passphrase);
  if (!key) return false;
  fs.rmSync(passFile(), { force: true });
  storeKey(key);
  key.fill(0);
  logger.info("key.passphrase.cleared");
  return true;
}

export function unlockKey(passphrase: string): Buffer | null {
  const envelope = readEnvelope();
  if (!envelope) return null;
  const key = unwrapWithPassphrase(envelope, passphrase);
  if (key) logger.info("history.unlocked");
  return key;
}

/** Every copy of the key, vault wrapper and passphrase wrapper included. */
export function destroyKeys(): void {
  const dir = dataRoot();
  for (const name of [WRAPPED_FILE, PLAIN_FILE, PASS_FILE]) {
    fs.rmSync(path.join(dir, name), { force: true });
  }
}

export default loadOrCreateKey;
