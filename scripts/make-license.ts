/**
 * Mint a license file.
 *
 * The private key stays in the author's macOS keychain: this script asks macOS for it,
 * signs the payload and writes a file that the app checks offline, on this Mac, with
 * no network call of any kind.
 *
 *   npx tsx scripts/make-license.ts --name "Tim" --email "tim@example.com"
 *   npx tsx scripts/make-license.ts --name "Tim" --days 365 --device
 *
 * Flags: --name, --email, --days (0 = no end date), --device (bind to this Mac),
 * --out (where to write the file).
 */
import { execFileSync } from "node:child_process";
import { createPrivateKey, randomUUID, sign } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  SIGNING_KEYCHAIN_ACCOUNT,
  SIGNING_KEYCHAIN_SERVICE,
  canonicalJson,
  deviceFingerprint,
  verifyLicenseText,
} from "../src/utils/license";
import type { LicensePayload } from "../src/utils/types";

const DAY_MS = 86_400_000;

const args = process.argv.slice(2);
const valueOf = (flag: string): string | undefined => {
  const at = args.indexOf(flag);
  return at >= 0 && at + 1 < args.length ? args[at + 1] : undefined;
};
const has = (flag: string): boolean => args.includes(flag);

const name = valueOf("--name");
const email = valueOf("--email");
const days = Number(valueOf("--days") ?? 0);
const bindDevice = has("--device");

if (!name) {
  console.error("A license needs a holder: --name \"Your Name\"");
  process.exit(1);
}
if (!Number.isFinite(days) || days < 0) {
  console.error("--days must be a number of days, or 0 for a license that does not end.");
  process.exit(1);
}

/**
 * The signing key, straight from the keychain. `security -w` prints the stored bytes
 * as hex, so they are decoded before the PEM is read.
 */
function signingKeyPem(): string {
  let hex: string;
  try {
    hex = execFileSync(
      "security",
      ["find-generic-password", "-w", "-s", SIGNING_KEYCHAIN_SERVICE, "-a", SIGNING_KEYCHAIN_ACCOUNT],
      { encoding: "utf8" }
    ).trim();
  } catch {
    console.error(
      `The signing key is not in the keychain (service "${SIGNING_KEYCHAIN_SERVICE}", account "${SIGNING_KEYCHAIN_ACCOUNT}").`
    );
    process.exit(1);
  }
  const pem = Buffer.from(hex, "hex").toString("utf8");
  if (!pem.includes("-----BEGIN")) {
    console.error("The keychain entry does not hold a PEM private key.");
    process.exit(1);
  }
  return pem;
}

const issuedAt = Date.now();
const payload: LicensePayload = {
  v: 1,
  product: "openmonkey",
  tier: "pro",
  id: randomUUID(),
  name,
  email,
  issuedAt,
  expiresAt: days > 0 ? issuedAt + days * DAY_MS : null,
  deviceId: bindDevice ? deviceFingerprint() : null,
};

const privateKey = createPrivateKey(signingKeyPem());
const signature = sign(null, Buffer.from(canonicalJson(payload), "utf8"), privateKey).toString("base64url");

const file = {
  payload,
  signature,
};

const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "license";
const out = path.resolve(valueOf("--out") ?? `license-${slug}.json`);
fs.writeFileSync(out, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });

// The file is only worth handing over if this build can read it back.
const check = verifyLicenseText(fs.readFileSync(out, "utf8"));
if (!check.ok) {
  console.error(`The license was written but does not verify: ${check.reason}`);
  process.exit(1);
}

console.log(`license written: ${out}`);
console.log(`  holder:   ${name}${email ? ` <${email}>` : ""}`);
console.log(`  ends:     ${payload.expiresAt === null ? "never" : new Date(payload.expiresAt).toISOString()}`);
console.log(`  bound to: ${payload.deviceId ? `this Mac (${payload.deviceId})` : "any Mac"}`);
console.log(`  id:       ${payload.id}`);
