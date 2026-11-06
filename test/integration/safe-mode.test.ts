import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const home = process.env.OM_STUB_HOME;
assert.ok(home, "the harness gives every suite a throwaway home");

// The profile folder the app writes its marker into.
const marker = path.join(home, "safe-mode.json");

test("a launch after two crashes in a row comes up in safe mode", async () => {
  // The last launch never got past the start, which is what a crash looks like
  // from here: the app never reached the point where it could mark itself running.
  mkdirSync(home, { recursive: true });
  writeFileSync(marker, JSON.stringify({ crashes: 1, phase: "starting" }), "utf8");

  // A profile the harness redirects would send the app somewhere else entirely.
  delete process.env.OPENMONKEY_USER_DATA;

  const { safeMode, crashRecordFile } = await import("../../src/main/bootstrap");

  assert.equal(crashRecordFile, marker, "the marker belongs in the app's own profile folder");
  assert.equal(safeMode.active, true, "the app must come up without its extras");
  assert.equal(safeMode.reason, "crashes");
  assert.equal(safeMode.crashes, 2);

  // The launch that just happened is itself marked as not ready yet, so a crash
  // here counts towards the next one.
  assert.deepEqual(JSON.parse(readFileSync(marker, "utf8")), { crashes: 2, phase: "starting" });
});
