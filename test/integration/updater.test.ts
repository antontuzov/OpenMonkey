import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { app, dialog, shell } from "electron";
import { autoUpdater, resetAutoUpdater } from "./electron-updater-stub";
import { startUpdates } from "../../src/main/updater";

// Electron's own types mark `isPackaged` and `getAppPath` read-only. The stub object
// behind this import is writable, so the casts below only restate what the harness does.
type PackagedApp = { isPackaged: boolean; getAppPath: () => string };
type DialogRecord = { message?: string; detail?: string; buttons?: string[] };
type MessageBox = (options: DialogRecord) => Promise<{ response: number }>;
type OpenExternal = (url: string) => Promise<boolean>;

const dialogs: DialogRecord[] = [];
const opened: string[] = [];
const bundles: string[] = [];
let nextResponse = 0;

(dialog as unknown as { showMessageBox: MessageBox }).showMessageBox = (options) => {
  dialogs.push(options);
  return Promise.resolve({ response: nextResponse });
};
(shell as unknown as { openExternal: OpenExternal }).openExternal = (url) => {
  opened.push(url);
  return Promise.resolve(true);
};

const pristine = {
  isPackaged: (app as unknown as PackagedApp).isPackaged,
  getAppPath: app.getAppPath,
};

afterEach(() => {
  const target = app as unknown as PackagedApp;
  target.isPackaged = pristine.isPackaged;
  target.getAppPath = pristine.getAppPath;
  resetAutoUpdater();
  dialogs.length = 0;
  opened.length = 0;
  nextResponse = 0;
  while (bundles.length) rmSync(String(bundles.pop()), { recursive: true, force: true });
});

/** Pretend the app runs from a packaged bundle, signed by Apple or not. */
function asPackaged(signed: boolean): void {
  const root = mkdtempSync(path.join(os.tmpdir(), "openmonkey-updater-"));
  bundles.push(root);
  const contents = path.join(root, "OpenMonkey.app", "Contents");
  mkdirSync(path.join(contents, "Resources"), { recursive: true });
  if (signed) mkdirSync(path.join(contents, "_CodeSignature"), { recursive: true });
  const target = app as unknown as PackagedApp;
  target.isPackaged = true;
  target.getAppPath = () => path.join(contents, "Resources", "app.asar");
}

function asUnpackaged(): void {
  (app as unknown as PackagedApp).isPackaged = false;
}

/** The updater reacts asynchronously to an event it did not schedule itself. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

test("an unsigned build names the release instead of downloading one", async () => {
  asPackaged(false);
  nextResponse = 1;
  startUpdates();

  assert.equal(autoUpdater.autoDownload, false, "nothing is fetched that cannot install");
  assert.equal(autoUpdater.autoInstallOnAppQuit, false);

  autoUpdater.emit("update-available", { version: "0.9.2" });
  await settled();
  assert.equal(dialogs.length, 1);
  assert.match(String(dialogs[0].message), /0\.9\.2/);
  assert.match(String(dialogs[0].detail), /sign/i);
  assert.match(String(dialogs[0].buttons?.[0]), /release page/i);
  assert.equal(opened.length, 0, "the browser only moves when the user agrees");

  // A later six-hourly check must not ask twice about one release, and an event this
  // build cannot honestly produce must not be wired at all.
  autoUpdater.emit("update-available", { version: "0.9.2" });
  autoUpdater.emit("update-downloaded", { version: "0.9.2" });
  await settled();
  assert.equal(dialogs.length, 1);
  assert.equal(autoUpdater.quitCalls, 0);
});

test("choosing the release page opens the latest release", async () => {
  asPackaged(false);
  startUpdates();

  autoUpdater.emit("update-available", { version: "0.9.2" });
  await settled();

  assert.equal(opened.length, 1);
  assert.match(opened[0], /OpenMonkey\/releases\/latest$/);
});

test("a signed build keeps downloading and asking before it restarts", async () => {
  asPackaged(true);
  startUpdates();

  assert.equal(autoUpdater.autoDownload, true);
  assert.equal(autoUpdater.autoInstallOnAppQuit, true);

  autoUpdater.emit("update-available", { version: "0.9.2" });
  await settled();
  assert.equal(dialogs.length, 0, "a build that can install does not interrupt");

  autoUpdater.emit("update-downloaded", { version: "0.9.2" });
  await settled();
  assert.equal(dialogs.length, 1);
  assert.match(String(dialogs[0].message), /0\.9\.2/);
  assert.match(String(dialogs[0].detail), /restart/i);
  assert.equal(autoUpdater.quitCalls, 1);
});

test("a declining answer leaves the running app alone", async () => {
  asPackaged(true);
  nextResponse = 1;
  startUpdates();

  autoUpdater.emit("update-downloaded", { version: "0.9.2" });
  await settled();

  assert.equal(autoUpdater.quitCalls, 0);
  assert.equal(opened.length, 0);
});

test("an unpackaged app starts no updater at all", () => {
  asUnpackaged();
  startUpdates();

  assert.equal(autoUpdater.listenerCount("update-available"), 0);
  assert.equal(autoUpdater.listenerCount("update-downloaded"), 0);
});
