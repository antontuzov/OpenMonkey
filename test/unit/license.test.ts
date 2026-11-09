import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  GRACE_DAYS,
  LICENSE_PUBLIC_KEY,
  TRIAL_DAYS,
  LicenseManager,
  canonicalJson,
  deviceFingerprint,
  verifyLicenseText,
} from "../../src/utils/license";
import type { LicensePayload } from "../../src/utils/types";

const DAY_MS = 86_400_000;

/** A signing pair of the test's own, so nothing here depends on the author's keychain. */
const pair = generateKeyPairSync("ed25519");
const publicKeyB64 = pair.publicKey.export({ format: "der", type: "spki" }).toString("base64");

const tempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "openmonkey-license-"));

const signPayload = (payload: LicensePayload, key = pair.privateKey): string =>
  sign(null, Buffer.from(canonicalJson(payload), "utf8"), key).toString("base64url");

const payloadFor = (over: Partial<LicensePayload> = {}): LicensePayload => ({
  v: 1,
  product: "openmonkey",
  tier: "pro",
  id: "lic_test",
  name: "A Reader",
  issuedAt: 1_700_000_000_000,
  expiresAt: null,
  deviceId: null,
  ...over,
});

const licenseFile = (payload: LicensePayload, signature = signPayload(payload)): string =>
  JSON.stringify({ payload, signature });

test("canonical JSON puts the keys in one order, so a signature is reproducible", () => {
  const a = canonicalJson({ b: 2, a: 1, c: { z: 1, y: 2 } });
  const b = canonicalJson({ c: { y: 2, z: 1 }, a: 1, b: 2 });
  assert.equal(a, b);
  assert.equal(a, '{"a":1,"b":2,"c":{"y":2,"z":1}}');
  assert.equal(canonicalJson({ a: 1, gone: undefined }), '{"a":1}');
});

test("a license signed by the author's key checks out, and only that key", () => {
  const payload = payloadFor();
  const good = verifyLicenseText(licenseFile(payload), publicKeyB64);
  assert.equal(good.ok, true);
  assert.ok(good.ok && good.payload.id === "lic_test");

  // The same payload with one name changed, under the old signature, is not a license.
  const tampered = { ...payload, name: "Someone Else" };
  const bad = verifyLicenseText(licenseFile(tampered, signPayload(payload)), publicKeyB64);
  assert.equal(bad.ok, false);
  assert.ok(!bad.ok && bad.reason.includes("signature"));

  // A license signed by somebody else's key does not open this app either.
  const other = generateKeyPairSync("ed25519");
  const foreign = verifyLicenseText(licenseFile(payload, signPayload(payload, other.privateKey)), publicKeyB64);
  assert.equal(foreign.ok, false);
  assert.ok(!foreign.ok && foreign.reason.includes("signature"));
});

test("a file that is not a license says why instead of crashing", () => {
  for (const text of ["", "not json at all", "{}", '{"payload":{},"signature":"x"}']) {
    const check = verifyLicenseText(text, publicKeyB64);
    assert.equal(check.ok, false, JSON.stringify(text));
  }
  const otherProduct = verifyLicenseText(licenseFile(payloadFor({ product: "something-else" })), publicKeyB64);
  assert.equal(otherProduct.ok, false);
});

test("the shipped public key is a real Ed25519 key", () => {
  const check = verifyLicenseText("{}", LICENSE_PUBLIC_KEY);
  assert.equal(check.ok, false);
  assert.ok(!check.ok && !check.reason.includes("public key is broken"));
});

test("the trial runs for fourteen days and then a grace period, and then Pro stops", () => {
  const dir = tempDir();
  let now = 1_700_000_000_000;
  const manager = new LicenseManager({
    now: () => now,
    publicKey: publicKeyB64,
    licenseFile: path.join(dir, "license.json"),
    trialFile: path.join(dir, "trial.json"),
  });

  const started = manager.startTrial();
  assert.equal(started, now);
  assert.equal(manager.state().status, "trial");
  assert.equal(manager.state().tier, "pro");
  assert.equal(manager.state().daysLeft, TRIAL_DAYS);

  // A restart does not hand out another fortnight.
  now += 3_600_000;
  assert.equal(manager.startTrial(), started);

  now = started + TRIAL_DAYS * DAY_MS;
  assert.equal(manager.state().status, "grace");
  assert.equal(manager.state().tier, "pro");
  assert.equal(manager.state().daysLeft, GRACE_DAYS);

  now = started + (TRIAL_DAYS + GRACE_DAYS) * DAY_MS;
  assert.equal(manager.state().status, "free");
  assert.equal(manager.state().tier, "free");
  assert.equal(manager.entitled(), false);
});

test("a paid action says what it needs and why it is refused", () => {
  const dir = tempDir();
  const started = 1_700_000_000_000;
  let now = started;
  const manager = new LicenseManager({
    now: () => now,
    publicKey: publicKeyB64,
    licenseFile: path.join(dir, "license.json"),
    trialFile: path.join(dir, "trial.json"),
  });
  manager.startTrial();
  now = started + (TRIAL_DAYS + GRACE_DAYS) * DAY_MS;
  assert.equal(manager.entitled(), false);
  assert.throws(
    () => manager.require("Publishing"),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes("Publishing") &&
      error.message.includes("Pro license")
  );
});

test("a license turns Pro on, and taking it off turns Pro off again", () => {
  const dir = tempDir();
  const now = 1_700_000_000_000;
  const manager = new LicenseManager({
    now: () => now,
    publicKey: publicKeyB64,
    licenseFile: path.join(dir, "license.json"),
    trialFile: path.join(dir, "trial.json"),
  });

  const payload = payloadFor({ expiresAt: now + 30 * DAY_MS });
  const result = manager.activate(licenseFile(payload));
  assert.deepEqual(result, { ok: true });
  assert.equal(manager.state().status, "licensed");
  assert.equal(manager.state().tier, "pro");
  assert.equal(manager.state().holder, "A Reader");
  assert.equal(manager.state().daysLeft, 30);

  manager.remove();
  assert.equal(fs.existsSync(path.join(dir, "license.json")), false);
  assert.equal(manager.state().status, "trial");
});

test("a license that ended keeps Pro for a grace period and then stops", () => {
  const dir = tempDir();
  const now = 1_700_000_000_000;
  const manager = new LicenseManager({
    now: () => now,
    publicKey: publicKeyB64,
    licenseFile: path.join(dir, "license.json"),
    trialFile: path.join(dir, "trial.json"),
  });

  const payload = payloadFor({ expiresAt: now - DAY_MS });
  assert.equal(manager.activate(licenseFile(payload)).ok, true);
  assert.equal(manager.state().status, "grace");
  assert.equal(manager.state().tier, "pro");

  const later = new LicenseManager({
    now: () => now + (GRACE_DAYS + 1) * DAY_MS,
    publicKey: publicKeyB64,
    licenseFile: path.join(dir, "license.json"),
    trialFile: path.join(dir, "trial.json"),
  });
  assert.equal(later.state().status, "expired");
  assert.equal(later.entitled(), false);
});

test("a license bound to another Mac is refused here", () => {
  const dir = tempDir();
  const manager = new LicenseManager({
    now: () => 1_700_000_000_000,
    publicKey: publicKeyB64,
    licenseFile: path.join(dir, "license.json"),
    trialFile: path.join(dir, "trial.json"),
    deviceId: "this-mac",
  });

  const foreign = payloadFor({ deviceId: "another-mac" });
  const refused = manager.activate(licenseFile(foreign));
  assert.equal(refused.ok, false);
  assert.ok(refused.error, "the refusal says why");
  assert.match(refused.error, /another Mac/);
  assert.equal(fs.existsSync(path.join(dir, "license.json")), false);

  const own = payloadFor({ deviceId: "this-mac" });
  assert.equal(manager.activate(licenseFile(own)).ok, true);
  assert.equal(manager.state().deviceBound, true);
});

test("a license file that is tampered with on disk stops being a license", () => {
  const dir = tempDir();
  const file = path.join(dir, "license.json");
  const manager = new LicenseManager({
    now: () => 1_700_000_000_000,
    publicKey: publicKeyB64,
    licenseFile: file,
    trialFile: path.join(dir, "trial.json"),
  });
  const payload = payloadFor();
  const signature = signPayload(payload);
  assert.equal(manager.activate(licenseFile(payload, signature)).ok, true);

  // The name in the file changes, but the signature does not: it is no longer a license.
  fs.writeFileSync(
    file,
    JSON.stringify({ payload: { ...payload, name: "Someone Else" }, signature })
  );
  assert.equal(manager.state().status, "trial");
});

test("this Mac has a fingerprint, and it is the same one every time", () => {
  const first = deviceFingerprint();
  assert.equal(first, deviceFingerprint());
  assert.equal(first.length, 32);
});
