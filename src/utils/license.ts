import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { LicensePayload, LicenseState } from "./types";

/**
 * The public half of the signing key, in base64 DER. The private half stays in the
 * author's keychain and never comes near this app: the app can check a license, but
 * it cannot mint one.
 */
export const LICENSE_PUBLIC_KEY =
  "MCowBQYDK2VwAyEAF67aVdlwLsZ6AMPaTnHqmmuxKIZFHrG2AADFl2apzI0=";

/** Where the signing key waits on the author's Mac, for the script that mints licenses. */
export const SIGNING_KEYCHAIN_SERVICE = "OpenMonkey License Signing";
export const SIGNING_KEYCHAIN_ACCOUNT = "license";

/** How long the trial runs before a license is needed, and the grace after it. */
export const TRIAL_DAYS = 14;
export const GRACE_DAYS = 7;
const DAY_MS = 86_400_000;

/**
 * JSON with its keys in a fixed order, so the same payload always signs to the same
 * bytes. Two machines that write the same license must produce the same signature.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

export type LicenseCheck =
  | { ok: true; payload: LicensePayload; signature: string }
  | { ok: false; reason: string };

/**
 * Reads a license file and checks the signature against the public key. Nothing is
 * asked of the network: the answer comes from the bytes in the file.
 */
export function verifyLicenseText(text: string, publicKey: string = LICENSE_PUBLIC_KEY): LicenseCheck {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "That file is not a license: it is not readable JSON." };
  }
  const file = parsed as { payload?: LicensePayload; signature?: unknown } | null;
  const payload = file?.payload;
  const signature = file?.signature;
  if (!payload || typeof payload !== "object" || typeof signature !== "string") {
    return { ok: false, reason: "That file is not a license: it has no payload and no signature." };
  }
  if (payload.product !== "openmonkey") {
    return { ok: false, reason: "That license is for another product." };
  }
  if (payload.v !== 1) {
    return {
      ok: false,
      reason: `That license is in a format this build does not read (version ${payload.v}).`,
    };
  }

  let key;
  try {
    key = createPublicKey({ key: Buffer.from(publicKey, "base64"), format: "der", type: "spki" });
  } catch {
    return { ok: false, reason: "This build cannot read licenses: its public key is broken." };
  }

  let good = false;
  try {
    good = verifySignature(
      null,
      Buffer.from(canonicalJson(payload), "utf8"),
      key,
      Buffer.from(signature, "base64url")
    );
  } catch {
    good = false;
  }
  if (!good) {
    return {
      ok: false,
      reason: "That license's signature does not match. It was not signed by this app's author.",
    };
  }
  return { ok: true, payload, signature };
}

/**
 * What this Mac is called, hashed. A license can be bound to it, so a license bought
 * for one Mac does not quietly work on another. The raw values never leave the app.
 */
export function deviceFingerprint(): string {
  let user = "";
  try {
    user = os.userInfo().username;
  } catch {
    user = "";
  }
  const raw = [os.hostname(), user, os.platform(), os.arch()].join("|");
  return createHash("sha256").update(raw).digest("base64url").slice(0, 32);
}

export interface LicenseDeps {
  now?: () => number;
  publicKey?: string;
  /** Where the license file lives. */
  licenseFile?: string;
  /** Where the day the trial started is remembered. */
  trialFile?: string;
  /** The fingerprint of this Mac, when the license is bound to one. */
  deviceId?: string | null;
}

const dayCount = (from: number, to: number): number =>
  Math.max(0, Math.ceil((to - from) / DAY_MS));

/**
 * The license of this Mac: what it is, when it ends, and whether it is worth
 * anything. Everything is read from disk — the app never asks anyone whether this
 * copy is paid for.
 */
export class LicenseManager {
  private readonly now: () => number;
  private readonly publicKey: string;
  private readonly licenseFile: string;
  private readonly trialFile: string;
  private readonly deviceId: string | null;

  constructor(deps: LicenseDeps = {}) {
    this.now = deps.now ?? (() => Date.now());
    this.publicKey = deps.publicKey ?? LICENSE_PUBLIC_KEY;
    this.licenseFile = deps.licenseFile ?? path.join(process.cwd(), "license.json");
    this.trialFile = deps.trialFile ?? path.join(process.cwd(), "trial.json");
    this.deviceId = deps.deviceId ?? null;
  }

  /**
   * Remembers the day the trial started, so a restart does not hand out another
   * fourteen days.
   */
  startTrial(): number {
    const started = this.readTrial();
    if (started !== null) return started;
    const at = this.now();
    try {
      fs.mkdirSync(path.dirname(this.trialFile), { recursive: true });
      fs.writeFileSync(this.trialFile, JSON.stringify({ startedAt: at }), { mode: 0o600 });
    } catch {
      // A data folder that cannot be written means the app cannot work anyway; the
      // trial simply starts again next time.
    }
    return at;
  }

  private readTrial(): number | null {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.trialFile, "utf8")) as { startedAt?: unknown };
      return typeof parsed.startedAt === "number" ? parsed.startedAt : null;
    } catch {
      return null;
    }
  }

  private readLicense(): { payload: LicensePayload; signature: string } | null {
    try {
      const text = fs.readFileSync(this.licenseFile, "utf8");
      const check = verifyLicenseText(text, this.publicKey);
      return check.ok ? { payload: check.payload, signature: check.signature } : null;
    } catch {
      return null;
    }
  }

  /** Takes a license the user was sent and keeps it on this Mac. */
  activate(text: string): { ok: boolean; error?: string } {
    const check = verifyLicenseText(text, this.publicKey);
    if (!check.ok) return { ok: false, error: check.reason };
    if (check.payload.deviceId && check.payload.deviceId !== this.deviceId) {
      return { ok: false, error: "That license was issued for another Mac." };
    }
    try {
      fs.mkdirSync(path.dirname(this.licenseFile), { recursive: true });
      fs.writeFileSync(
        this.licenseFile,
        JSON.stringify({ payload: check.payload, signature: check.signature }, null, 2),
        { mode: 0o600 }
      );
    } catch (error) {
      return {
        ok: false,
        error: `The license could not be kept on this Mac: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
    return { ok: true };
  }

  /** Takes the license off this Mac. The app falls back to the free tier. */
  remove(): void {
    fs.rmSync(this.licenseFile, { force: true });
  }

  /** Where this Mac stands: the tier, the dates, and a sentence saying so. */
  state(): LicenseState {
    const now = this.now();
    const trialStartedAt = this.startTrial();
    const trialEndsAt = trialStartedAt + TRIAL_DAYS * DAY_MS;
    const license = this.readLicense();

    if (license) {
      const { payload } = license;
      const holder = payload.name ?? null;
      const deviceBound = Boolean(payload.deviceId);
      if (payload.expiresAt === null || payload.expiresAt > now) {
        const expiresAt = payload.expiresAt;
        return {
          tier: "pro",
          status: "licensed",
          daysLeft: expiresAt === null ? null : dayCount(now, expiresAt),
          trialStartedAt,
          trialEndsAt,
          graceEndsAt: null,
          holder,
          expiresAt,
          deviceBound,
          notice: holder
            ? `Pro — licensed to ${holder}.`
            : "Pro — this Mac holds a valid license.",
        };
      }
      const graceEndsAt = payload.expiresAt + GRACE_DAYS * DAY_MS;
      if (now < graceEndsAt) {
        return {
          tier: "pro",
          status: "grace",
          daysLeft: dayCount(now, graceEndsAt),
          trialStartedAt,
          trialEndsAt,
          graceEndsAt,
          holder,
          expiresAt: payload.expiresAt,
          deviceBound,
          notice: `The license ended — ${dayCount(now, graceEndsAt)} days left to renew before Pro stops.`,
        };
      }
      return {
        tier: "free",
        status: "expired",
        daysLeft: 0,
        trialStartedAt,
        trialEndsAt,
        graceEndsAt,
        holder,
        expiresAt: payload.expiresAt,
        deviceBound,
        notice: "The license on this Mac has ended.",
      };
    }

    if (now < trialEndsAt) {
      return {
        tier: "pro",
        status: "trial",
        daysLeft: dayCount(now, trialEndsAt),
        trialStartedAt,
        trialEndsAt,
        graceEndsAt: null,
        holder: null,
        expiresAt: null,
        deviceBound: false,
        notice: `Pro — ${dayCount(now, trialEndsAt)} days left of the ${TRIAL_DAYS}-day trial.`,
      };
    }

    const graceEndsAt = trialEndsAt + GRACE_DAYS * DAY_MS;
    if (now < graceEndsAt) {
      return {
        tier: "pro",
        status: "grace",
        daysLeft: dayCount(now, graceEndsAt),
        trialStartedAt,
        trialEndsAt,
        graceEndsAt,
        holder: null,
        expiresAt: null,
        deviceBound: false,
        notice: `The trial ended — ${dayCount(now, graceEndsAt)} days left to activate a license before Pro stops.`,
      };
    }

    return {
      tier: "free",
      status: "free",
      daysLeft: 0,
      trialStartedAt,
      trialEndsAt,
      graceEndsAt,
      holder: null,
      expiresAt: null,
      deviceBound: false,
      notice:
        "OpenMonkey is free for chat, tools and memory. Publishing needs a Pro license.",
    };
  }

  /** True when the paid tier is switched on: a license, a trial, or a grace period. */
  entitled(): boolean {
    return this.state().tier === "pro";
  }

  /** The gate a paid action goes through. It says why, and says what to do. */
  require(feature: string): void {
    const state = this.state();
    if (state.tier === "pro") return;
    throw new Error(`${feature} needs a Pro license. ${state.notice}`);
  }
}
