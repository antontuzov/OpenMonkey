import { safeStorage } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { dataRoot } from "./config";
import type { PublisherChannel, PublisherSecret } from "./types";

export const NO_KEYCHAIN =
  "This Mac has no system keychain for the app, so the token cannot be stored safely.";

/**
 * How a secret is wrapped before it touches the disk. The default implementation
 * puts it in the macOS keychain through Electron's safeStorage; the tests pass
 * their own box so they never touch the real one.
 */
export interface SecretBox {
  /** False when this machine cannot keep a secret safely. */
  readonly available: boolean;
  encrypt(plain: string): Buffer;
  decrypt(wrapped: Buffer): string;
}

/** The keychain box: safeStorage holds its key in the OS vault, never in this file. */
export const keychainBox = (): SecretBox => ({
  get available(): boolean {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  },
  encrypt(plain: string): Buffer {
    if (!this.available) throw new Error(NO_KEYCHAIN);
    return safeStorage.encryptString(plain);
  },
  decrypt(wrapped: Buffer): string {
    if (!this.available) throw new Error(NO_KEYCHAIN);
    return safeStorage.decryptString(wrapped);
  },
});

export interface PublisherSecrets {
  /** The stored secret of a channel, or null when there is none. */
  read(channel: PublisherChannel): PublisherSecret | null;
  write(channel: PublisherChannel, secret: PublisherSecret): void;
  clear(channel: PublisherChannel): void;
  /** False when this machine cannot keep a secret safely. */
  available(): boolean;
}

/**
 * One wrapped file per channel. A token is never written to the config file and
 * never printed: the file holds ciphertext the keychain can open, and nothing else
 * on this Mac can read.
 */
export class KeychainPublisherSecrets implements PublisherSecrets {
  constructor(private readonly box: SecretBox = keychainBox()) {}

  private file(channel: PublisherChannel): string {
    return path.join(dataRoot(), `publisher-${channel}.enc`);
  }

  available(): boolean {
    return this.box.available;
  }

  read(channel: PublisherChannel): PublisherSecret | null {
    const file = this.file(channel);
    if (!fs.existsSync(file)) return null;
    const plain = this.box.decrypt(fs.readFileSync(file));
    const parsed = JSON.parse(plain) as PublisherSecret;
    return parsed && typeof parsed === "object" ? parsed : null;
  }

  write(channel: PublisherChannel, secret: PublisherSecret): void {
    const wrapped = this.box.encrypt(JSON.stringify(secret));
    fs.writeFileSync(this.file(channel), wrapped, { mode: 0o600 });
  }

  clear(channel: PublisherChannel): void {
    fs.rmSync(this.file(channel), { force: true });
  }
}

/** The store the app and its tools use. */
export const publisherSecrets = new KeychainPublisherSecrets();

/**
 * The tail of the identifying field, so the user can tell one token from another
 * without the page showing the whole thing.
 */
export function secretTail(secret: PublisherSecret | null, channel: PublisherChannel): string {
  if (!secret) return "";
  const value =
    channel === "telegram"
      ? secret.token
      : channel === "reddit"
        ? secret.clientId
        : channel === "bluesky"
          ? secret.identifier
          : secret.accessToken;
  if (!value || value.length < 4) return "";
  return value.slice(-4);
}
