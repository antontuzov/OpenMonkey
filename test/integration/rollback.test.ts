import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { app, downloads, shell } from "./electron-stub.mjs";
import { downloadRollback, startRollback } from "../../src/main/rollback";
import { config } from "../../src/utils/config";

const pristine = config.get("privacy").networkAllowed;

afterEach(() => {
  config.merge({ privacy: { networkAllowed: pristine } });
  downloads.length = 0;
  shell.openedPaths.length = 0;
});

const TARGET = {
  version: "0.9.1",
  url: "https://example.test/OpenMonkey-0.9.1-arm64.dmg",
  size: 202_711_693,
};

test("the older build is fetched into Downloads and opened", async () => {
  const result = await downloadRollback(TARGET);

  assert.equal(result.ok, true, String(result.error));
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].url, TARGET.url);
  assert.equal(
    downloads[0].savePath,
    path.join(app.getPath("downloads"), "OpenMonkey-0.9.1-arm64.dmg"),
    "the file carries the version, so it never overwrites another one"
  );
  assert.deepEqual(shell.openedPaths, [result.path], "the disk image is mounted for the reader");
});

test("with the network switch off nothing is fetched", async () => {
  config.merge({ privacy: { networkAllowed: false } });

  const result = await startRollback();

  assert.equal(result.ok, false);
  assert.match(String(result.error), /network access is off/i);
  assert.equal(downloads.length, 0);
});
