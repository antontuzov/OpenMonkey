import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BUNDLE_FORMAT,
  BUNDLE_VERSION,
  decryptBundle,
  encryptBundle,
  readBundleFile,
  validateBundle,
  type ExportBundle,
} from "../../src/utils/portability";

const bundle = (overrides: Partial<ExportBundle> = {}): ExportBundle => ({
  format: BUNDLE_FORMAT,
  version: BUNDLE_VERSION,
  exportedAt: "2026-10-30T10:00:00.000Z",
  schemaVersion: 1,
  settings: { ui: { language: "en" } } as ExportBundle["settings"],
  conversations: [
    {
      id: "conv_1",
      title: "Portability",
      createdAt: "2026-10-30T09:00:00.000Z",
      updatedAt: "2026-10-30T09:30:00.000Z",
      pinned: false,
      archived: false,
      messages: [
        {
          id: "msg_1",
          role: "user",
          content: "the secret body",
          timestamp: "2026-10-30T09:01:00.000Z",
          metadata: { attachment: { name: "note.txt", bytes: 12 } },
        },
      ],
    },
  ],
  facts: [{ id: "fact_1", content: "Likes mint", createdAt: "2026-10-30T09:02:00.000Z" }],
  ...overrides,
});

test("a bundle round-trips through the passphrase envelope", () => {
  const sealed = encryptBundle(bundle(), "correct horse battery");
  assert.ok(sealed.startsWith(`${BUNDLE_FORMAT}.1:`));
  assert.equal(sealed.includes("the secret body"), false);
  assert.equal(sealed.endsWith("."), false);
  const opened = decryptBundle(sealed, "correct horse battery") as ExportBundle;
  assert.equal(opened.conversations[0].messages[0].content, "the secret body");
  assert.equal(opened.conversations[0].messages[0].metadata?.attachment?.name, "note.txt");
});

test("the same body sealed twice differs, so the salt and iv are fresh", () => {
  const first = encryptBundle(bundle(), "correct horse battery");
  const second = encryptBundle(bundle(), "correct horse battery");
  assert.notEqual(first, second);
  assert.equal(decryptBundle(first, "correct horse battery") !== null, true);
});

test("a wrong passphrase and a damaged body both answer null", () => {
  const sealed = encryptBundle(bundle(), "correct horse battery");
  assert.equal(decryptBundle(sealed, "wrong passphrase"), null);
  const parts = sealed.split(":");
  const body = Buffer.from(parts[4], "base64");
  body[0] ^= 0xff;
  parts[4] = body.toString("base64");
  assert.equal(decryptBundle(parts.join(":"), "correct horse battery"), null);
  assert.equal(decryptBundle("not a backup", "correct horse battery"), null);
});

test("a foreign file is refused", () => {
  assert.equal(decryptBundle(JSON.stringify(bundle()), "correct horse battery"), null);
  assert.throws(() => readBundleFile(Buffer.from("{\"format\":\"other\"}", "utf8"), "x", 1), /Wrong passphrase, or the file is damaged/);
});

test("a newer version or layout is refused", () => {
  assert.throws(() => validateBundle(bundle({ version: 2 }), 1), /newer OpenMonkey/);
  assert.throws(() => validateBundle(bundle({ schemaVersion: 2 }), 1), /newer database layout/);
  assert.equal(validateBundle(bundle({ version: 1 }), 1).version, 1);
});

test("unknown fields are dropped and defaults fill gaps", () => {
  const raw = {
    ...bundle(),
    extra: "drop me",
    conversations: [
      {
        id: "conv_x",
        title: "",
        messages: [{ role: "narrator", content: "hi", timestamp: "" }],
      },
    ],
    facts: "not an array",
  };
  const cleaned = validateBundle(raw, 1);
  assert.equal((cleaned as unknown as Record<string, unknown>).extra, undefined);
  assert.equal(cleaned.conversations[0].title, "Imported chat");
  assert.equal(cleaned.conversations[0].messages[0].role, "user");
  assert.ok(cleaned.conversations[0].messages[0].timestamp.length > 0);
  assert.deepEqual(cleaned.facts, []);
});

test("a missing shape is reported before anything is touched", () => {
  assert.throws(() => validateBundle(null, 1), /not an OpenMonkey backup/);
  assert.throws(() => validateBundle({ ...bundle(), format: "x" }, 1), /not an OpenMonkey backup/);
  assert.throws(() => validateBundle({ ...bundle(), version: "1" }, 1), /no version/);
  assert.throws(() => validateBundle({ ...bundle(), settings: null }, 1), /no settings/);
  assert.throws(() => validateBundle({ ...bundle(), conversations: null }, 1), /no conversations/);
});

test("file size is capped before decryption", () => {
  const oversized = Buffer.alloc(64 * 1024 * 1024 + 1);
  assert.throws(() => readBundleFile(oversized, "x", 1), /too large to open/);
});

test("a full file round trip validates against the live schema", () => {
  const sealed = encryptBundle(bundle(), "correct horse battery");
  const restored = readBundleFile(Buffer.from(sealed, "utf8"), "correct horse battery", 1);
  assert.equal(restored.conversations[0].messages[0].content, "the secret body");
  assert.equal(restored.facts[0].content, "Likes mint");
});
