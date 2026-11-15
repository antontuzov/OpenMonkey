import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSupportBundle, supportTicketUrl } from "../../src/utils/support-bundle";
import type { McpServerStatus, PrivacyStatus, SupportFacts } from "../../src/utils/types";

const facts: SupportFacts = { version: "0.9.2", macos: "15.3", arch: "arm64", packaged: true };

const privacy: PrivacyStatus = {
  keySource: "keychain",
  keychainAvailable: true,
  locked: false,
  passphraseConfigured: false,
  autoLockMinutes: 60,
  schemaVersion: 3,
  networkAllowed: true,
  databaseBytes: 4096,
  lastPruneAt: null,
  requestsAllowed: 2,
  requestsBlocked: 0,
};

const server = (over: Partial<McpServerStatus> = {}): McpServerStatus => ({
  id: "srv",
  name: "Files",
  enabled: true,
  state: "ready",
  toolCount: 3,
  tools: [{ name: "read_file", description: "reads a file", readOnly: true, policy: "ask" }],
  stderr: "TOKEN=hunter2",
  error: "spawn /usr/local/bin/secret-tool failed",
  policy: "ask",
  ...over,
});

test("the bundle carries the facts, the privacy state and the log tail", () => {
  const bundle = buildSupportBundle({
    facts,
    privacy,
    model: null,
    mcp: [],
    logTail: "2026-11-15T10:00:00.000Z INFO app.started",
    now: new Date("2026-11-15T10:00:00.000Z"),
  });

  assert.equal(bundle.app, "OpenMonkey");
  assert.equal(bundle.generatedAt, "2026-11-15T10:00:00.000Z");
  assert.deepEqual(bundle.facts, facts);
  assert.deepEqual(bundle.privacy, privacy);
  assert.equal(bundle.model, null);
  assert.match(bundle.logTail, /app\.started/);
});

test("a server's stderr, error and tools never reach the bundle", () => {
  const bundle = buildSupportBundle({
    facts,
    privacy,
    model: null,
    mcp: [server()],
    logTail: "",
    now: new Date("2026-11-15T10:00:00.000Z"),
  });

  assert.deepEqual(bundle.mcp, [{ name: "Files", enabled: true, state: "ready", toolCount: 3 }]);
  const written = JSON.stringify(bundle);
  assert.doesNotMatch(written, /hunter2/);
  assert.doesNotMatch(written, /secret-tool/);
  assert.doesNotMatch(written, /read_file/);
});

test("the bundle is stamped with the moment it was made", () => {
  const bundle = buildSupportBundle({
    facts,
    privacy,
    model: null,
    mcp: [],
    logTail: "",
  });

  assert.equal(bundle.generatedAt, new Date().toISOString());
});

test("the ticket opens on GitHub with the facts already filled in", () => {
  const url = new URL(supportTicketUrl(facts));
  const body = url.searchParams.get("body") ?? "";

  assert.equal(url.origin + url.pathname, "https://github.com/antontuzov/OpenMonkey/issues/new");
  assert.match(body, /OpenMonkey 0\.9\.2/);
  assert.match(body, /macOS 15\.3/);
  assert.match(body, /arm64/);
  assert.doesNotMatch(body, /from source/);
});

test("a build from source says so on the ticket", () => {
  const url = new URL(supportTicketUrl({ ...facts, packaged: false }));

  assert.match(url.searchParams.get("body") ?? "", /\(from source\)/);
});

test("the ticket asks the three questions and says what the file holds", () => {
  const body = new URL(supportTicketUrl(facts)).searchParams.get("body") ?? "";

  assert.match(body, /What I did/);
  assert.match(body, /What I expected/);
  assert.match(body, /What happened/);
  assert.match(body, /no conversations, keys or credentials/);
});
