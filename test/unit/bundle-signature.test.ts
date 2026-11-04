import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { bundleIsSigned } from "../../src/utils/bundle-signature";

/**
 * A bundle laid out the way electron-builder lays one out, signed or not. The return
 * value is what `app.getAppPath()` gives the updater inside a packaged app.
 */
const appAsarIn = (signed: boolean) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "openmonkey-bundle-"));
  const contents = path.join(root, "OpenMonkey.app", "Contents");
  mkdirSync(path.join(contents, "Resources"), { recursive: true });
  const appPath = path.join(contents, "Resources", "app.asar");
  writeFileSync(appPath, "packed");
  if (signed) {
    mkdirSync(path.join(contents, "_CodeSignature"), { recursive: true });
    writeFileSync(path.join(contents, "_CodeSignature", "CodeResources"), "signed");
  }
  return { appPath, cleanup: () => rmSync(root, { recursive: true, force: true }) };
};

test("a bundle carrying Apple's signature directory reports signed", () => {
  const { appPath, cleanup } = appAsarIn(true);
  try {
    assert.equal(bundleIsSigned(appPath), true);
  } finally {
    cleanup();
  }
});

test("a locally built bundle reports unsigned", () => {
  const { appPath, cleanup } = appAsarIn(false);
  try {
    assert.equal(bundleIsSigned(appPath), false);
  } finally {
    cleanup();
  }
});

test("a signature directory under Resources is not mistaken for one", () => {
  const { appPath, cleanup } = appAsarIn(false);
  try {
    mkdirSync(path.join(path.dirname(appPath), "_CodeSignature"), { recursive: true });
    assert.equal(bundleIsSigned(appPath), false);
  } finally {
    cleanup();
  }
});
