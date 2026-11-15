import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerIpcHandlers } from "../../src/main/ipc-handlers";
import { dialog, ipcHandlers, shell } from "./electron-stub.mjs";
import type { SupportBundle, SupportFacts } from "../../src/utils/types";

const folder = (): string => mkdtempSync(path.join(os.tmpdir(), "openmonkey-support-"));

const register = (): void => {
  registerIpcHandlers({
    getWindow: () => null,
    getAgent: () => null,
    getTray: () => null,
    showMainWindow: () => undefined,
    openConversation: () => undefined,
    showQuickAsk: () => undefined,
    hideQuickAsk: () => undefined,
    onConfigChanged: () => undefined,
    lockHistory: () => undefined,
    reloadHistoryViews: () => undefined,
    getSafeMode: () => ({ active: false, reason: null, crashes: 0 }),
    restartInSafeMode: () => undefined,
    restartNormally: () => undefined,
    takePendingDocument: () => null,
  });
};

test("the facts name the version and the machine", async () => {
  register();
  const handler = ipcHandlers.get("get-support-facts");
  assert.ok(handler);

  const facts = (await handler({}, undefined)) as SupportFacts;

  assert.equal(facts.version, "0.9.0-test");
  assert.equal(facts.arch, process.arch);
  assert.equal(facts.packaged, false);
  assert.ok(facts.macos.length > 0);
});

test("the bundle is written where the user chose, and nobody else can read it", async () => {
  const directory = folder();
  const previous = dialog.saveDialogResult;
  try {
    const filePath = path.join(directory, "diagnostics.json");
    dialog.saveDialogResult = { canceled: false, filePath };
    register();

    const handler = ipcHandlers.get("save-support-bundle");
    assert.ok(handler);
    const written = (await handler({}, undefined)) as string | null;

    assert.equal(written, filePath);
    const mode = statSync(filePath).mode & 0o777;
    assert.equal(mode, 0o600);
    assert.ok(shell.revealed.includes(filePath));

    const bundle = JSON.parse(readFileSync(filePath, "utf8")) as SupportBundle;
    assert.equal(bundle.app, "OpenMonkey");
    assert.equal(bundle.facts.version, "0.9.0-test");
    assert.equal(typeof bundle.logTail, "string");
    assert.deepEqual(bundle.mcp, []);
  } finally {
    dialog.saveDialogResult = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a cancelled save writes nothing", async () => {
  const directory = folder();
  const previous = dialog.saveDialogResult;
  try {
    const filePath = path.join(directory, "diagnostics.json");
    dialog.saveDialogResult = { canceled: true, filePath: undefined };
    register();

    const handler = ipcHandlers.get("save-support-bundle");
    assert.ok(handler);
    const written = (await handler({}, undefined)) as string | null;

    assert.equal(written, null);
    assert.equal(existsSync(filePath), false);
  } finally {
    dialog.saveDialogResult = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
