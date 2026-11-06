import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CRASHES_BEFORE_SAFE_MODE,
  SAFE_MODE_ENV,
  SAFE_MODE_FLAG,
  clearCrashes,
  markRunning,
  noteCleanExit,
  noteLaunch,
  planSafeMode,
  readCrashRecord,
  restartArgs,
  safeModeRequested,
} from "../../src/utils/safe-mode";

/** A throwaway folder for the marker file, so a test never touches a real profile. */
const withMarker = (run: (file: string) => void): void => {
  const folder = mkdtempSync(path.join(os.tmpdir(), "openmonkey-safe-mode-"));
  try {
    run(path.join(folder, "safe-mode.json"));
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
};

test("safe mode is asked for by a flag or by the environment", () => {
  const app = "/Applications/OpenMonkey.app/Contents/MacOS/OpenMonkey";
  assert.equal(safeModeRequested([app], {}), false);
  assert.equal(safeModeRequested([app, SAFE_MODE_FLAG], {}), true);
  assert.equal(safeModeRequested([app], { [SAFE_MODE_ENV]: "1" }), true);
  assert.equal(safeModeRequested([app], { [SAFE_MODE_ENV]: "true" }), true);
  assert.equal(safeModeRequested([app], { [SAFE_MODE_ENV]: "0" }), false);
  assert.equal(safeModeRequested([app], { [SAFE_MODE_ENV]: "" }), false);
});

test("a launch asked for safe mode gets it, whatever the count of crashes", () => {
  assert.deepEqual(planSafeMode(true, 0), { active: true, reason: "flag", crashes: 0 });
  assert.deepEqual(planSafeMode(true, 5), { active: true, reason: "flag", crashes: 5 });
});

test("a launch only gets safe mode by itself after the app died twice in a row", () => {
  assert.deepEqual(planSafeMode(false, 0), { active: false, reason: null, crashes: 0 });
  assert.deepEqual(planSafeMode(false, CRASHES_BEFORE_SAFE_MODE - 1), {
    active: false,
    reason: null,
    crashes: CRASHES_BEFORE_SAFE_MODE - 1,
  });
  assert.deepEqual(planSafeMode(false, CRASHES_BEFORE_SAFE_MODE), {
    active: true,
    reason: "crashes",
    crashes: CRASHES_BEFORE_SAFE_MODE,
  });
});

test("a launch that never got past the start counts as a crash", () => {
  withMarker((file) => {
    assert.deepEqual(noteLaunch(file), { crashes: 0, phase: "starting" });
    assert.deepEqual(noteLaunch(file), { crashes: 1, phase: "starting" });
    assert.deepEqual(noteLaunch(file), { crashes: 2, phase: "starting" });
  });
});

test("a launch that came up counts as no crash at all", () => {
  withMarker((file) => {
    noteLaunch(file);
    noteLaunch(file);
    markRunning(file);
    assert.deepEqual(readCrashRecord(file), { crashes: 1, phase: "running" });
    // The app came up, so the next launch starts the count again from nothing.
    assert.deepEqual(noteLaunch(file), { crashes: 0, phase: "starting" });
  });
});

test("a clean exit leaves nothing to count", () => {
  withMarker((file) => {
    noteLaunch(file);
    noteLaunch(file);
    noteCleanExit(file);
    assert.deepEqual(readCrashRecord(file), { crashes: 0, phase: "clean" });
    assert.deepEqual(noteLaunch(file), { crashes: 0, phase: "starting" });
  });
});

test("leaving safe mode forgets the launches that died", () => {
  withMarker((file) => {
    noteLaunch(file);
    noteLaunch(file);
    clearCrashes(file);
    assert.deepEqual(readCrashRecord(file), { crashes: 0, phase: "clean" });
  });
});

test("a marker file that is missing or unreadable counts as no crash", () => {
  withMarker((file) => {
    assert.deepEqual(readCrashRecord(file), { crashes: 0, phase: "clean" });
    rmSync(file, { force: true });
    writeFileSync(file, "not json at all", "utf8");
    assert.deepEqual(readCrashRecord(file), { crashes: 0, phase: "clean" });
  });
});

test("the marker file holds what the app needs to read at the next launch", () => {
  withMarker((file) => {
    noteLaunch(file);
    noteLaunch(file);
    const written = JSON.parse(readFileSync(file, "utf8")) as { crashes: number; phase: string };
    assert.deepEqual(written, { crashes: 1, phase: "starting" });
  });
});

test("the relaunch keeps the app's own arguments and never doubles the switch", () => {
  assert.deepEqual(restartArgs(["/Applications/OpenMonkey.app/Contents/MacOS/OpenMonkey"], false), []);
  assert.deepEqual(restartArgs(["/Applications/OpenMonkey.app/Contents/MacOS/OpenMonkey"], true), [
    SAFE_MODE_FLAG,
  ]);
  assert.deepEqual(restartArgs(["electron", "/app", "--other"], true), ["/app", "--other", SAFE_MODE_FLAG]);
  assert.deepEqual(restartArgs(["electron", "/app", SAFE_MODE_FLAG], false), ["/app"]);
  assert.deepEqual(restartArgs(["electron", "/app", SAFE_MODE_FLAG], true), ["/app", SAFE_MODE_FLAG]);
});
