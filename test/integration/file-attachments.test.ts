import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { attachmentFromFile } from "../../src/main/file-attachments";
import { registerIpcHandlers } from "../../src/main/ipc-handlers";
import { dialog, ipcHandlers, recentDocuments } from "./electron-stub.mjs";
import type { Attachment } from "../../src/utils/types";

const folder = (): string => mkdtempSync(path.join(os.tmpdir(), "openmonkey-files-"));

const write = (directory: string, name: string, body: Buffer | string): string => {
  const filePath = path.join(directory, name);
  writeFileSync(filePath, body);
  return filePath;
};

test("a text file rides along with its own text", () => {
  const directory = folder();
  try {
    const file = attachmentFromFile(write(directory, "notes.txt", "the body"));

    assert.equal(file.name, "notes.txt");
    assert.equal(file.text, "the body");
    assert.equal(file.kind, "text");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an image is named, not read: the local models see no pixels", () => {
  const directory = folder();
  try {
    const file = attachmentFromFile(write(directory, "shot.png", Buffer.from([0x89, 0x50, 0x4e, 0x47])));

    assert.equal(file.kind, "image");
    assert.equal(file.text, "");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a file too big for a chat is refused", () => {
  const directory = folder();
  try {
    const big = Buffer.alloc(300 * 1024, "a");
    assert.throws(() => attachmentFromFile(write(directory, "big.txt", big)), /capped at 256 KB/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a file that is not text is refused", () => {
  const directory = folder();
  try {
    const binary = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    assert.throws(() => attachmentFromFile(write(directory, "movie.bin", binary)), /plain text/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a file the user attaches is kept in the Dock's recent documents", async () => {
  const directory = folder();
  const previous = dialog.openDialogResult;
  try {
    const filePath = write(directory, "notes.txt", "the body");
    dialog.openDialogResult = { canceled: false, filePaths: [filePath] };

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

    const handler = ipcHandlers.get("attach-files");
    assert.ok(handler);
    const files = (await handler({}, undefined)) as Attachment[];

    assert.deepEqual(files.map((file) => file.name), ["notes.txt"]);
    assert.equal(recentDocuments[recentDocuments.length - 1], filePath);
  } finally {
    dialog.openDialogResult = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
