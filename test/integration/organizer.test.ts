import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import storage from "../../src/utils/storage";
import { registerIpcHandlers } from "../../src/main/ipc-handlers";
import { decryptBundle } from "../../src/utils/portability";
import { dialog, ipcHandlers } from "./electron-stub.mjs";
import type { Message } from "../../src/utils/types";

storage.init();

after(() => {
  storage.close();
});

const message = (id: string): Message => ({
  id,
  role: "user",
  content: `body of ${id} — приватный текст`,
  timestamp: new Date(),
});

const chat = (title: string): string => {
  const conversation = storage.createConversation(title);
  storage.saveMessage(conversation.id, message(`msg_${conversation.id}`));
  return conversation.id;
};

test("a folder holds the chats filed under it and counts them", () => {
  const folder = storage.createFolder("Work");
  const id = chat("Filed chat");

  storage.setConversationFolder(id, folder.id);
  const listed = storage.listFolders();
  const found = listed.find((item) => item.id === folder.id);
  assert.ok(found, "the folder is in the list");
  assert.equal(found.name, "Work");
  assert.equal(found.count, 1);
  assert.equal(storage.getConversation(id)?.folderId, folder.id);

  // A folder with no name is not a folder.
  assert.throws(() => storage.createFolder("   "), /needs a name/);

  storage.renameFolder(folder.id, "Office");
  assert.equal(storage.listFolders().find((item) => item.id === folder.id)?.name, "Office");
});

test("deleting a folder keeps the chats and only takes the filing away", () => {
  const folder = storage.createFolder("Temporary");
  const id = chat("Survivor");
  storage.setConversationFolder(id, folder.id);
  assert.equal(storage.getConversation(id)?.folderId, folder.id);

  storage.deleteFolder(folder.id);
  assert.equal(storage.listFolders().some((item) => item.id === folder.id), false);
  assert.equal(storage.getConversation(id)?.folderId, null);
  assert.equal(storage.getMessages(id).length, 1, "the chat and its turns are still there");
});

test("a chat filed under a folder that does not exist stays where it was", () => {
  const id = chat("Unfiled");
  storage.setConversationFolder(id, "folder_that_never_existed");
  assert.equal(storage.getConversation(id)?.folderId, null);
});

test("labels are counted, lowercased and kept once per chat", () => {
  const first = chat("Tagged once");
  const second = chat("Tagged twice");
  storage.setConversationTags(first, ["Ideas"]);
  storage.setConversationTags(second, ["ideas", "  Work  "]);

  assert.deepEqual(storage.getConversation(first)?.tags, ["ideas"]);
  assert.deepEqual(storage.getConversation(second)?.tags, ["ideas", "work"]);

  const counts = storage.listTags().filter((item) => item.tag === "ideas");
  assert.equal(counts.length, 1);
  assert.equal(counts[0].count, 2);

  // Applying the same word twice does not make a second copy of it.
  storage.setConversationTags(first, ["ideas", "ideas"]);
  assert.deepEqual(storage.getConversation(first)?.tags, ["ideas"]);
});

test("a label on a chat that is deleted goes with it", () => {
  const id = chat("Doomed and tagged");
  storage.setConversationTags(id, ["temporary"]);
  assert.equal(storage.listTags().some((item) => item.tag === "temporary"), true);

  storage.deleteConversation(id);
  assert.equal(storage.listTags().some((item) => item.tag === "temporary"), false);
});

test("an archived chat leaves the list and comes back when it is restored", () => {
  const id = chat("Filed away");
  assert.equal(storage.listConversations().some((item) => item.id === id), true);

  storage.setConversationArchived(id, true);
  assert.equal(storage.listConversations().some((item) => item.id === id), false);
  assert.equal(storage.listArchivedConversations().some((item) => item.id === id), true);

  storage.setConversationArchived(id, false);
  assert.equal(storage.listConversations().some((item) => item.id === id), true);
  assert.equal(storage.listArchivedConversations().some((item) => item.id === id), false);
});

test("a saved search keeps what it was named and what it looks for", () => {
  const search = storage.createSavedSearch("Release notes", "release");
  assert.equal(search.name, "Release notes");
  assert.equal(search.query, "release");
  assert.equal(storage.listSavedSearches().some((item) => item.id === search.id), true);

  assert.throws(() => storage.createSavedSearch("", "release"), /needs a name/);
  assert.throws(() => storage.createSavedSearch("Empty", "  "), /needs a name/);

  storage.deleteSavedSearch(search.id);
  assert.equal(storage.listSavedSearches().some((item) => item.id === search.id), false);
});

test("an export of a selection carries only the chats that were chosen", () => {
  const chosen = chat("Chosen for export");
  const other = chat("Left behind");
  const bundle = storage.exportSelection([chosen]);

  assert.deepEqual(bundle.conversations.map((item) => item.id), [chosen]);
  assert.equal(JSON.stringify(bundle).includes(other), false);
});

test("an export of nothing carries nothing at all", () => {
  // The whole history is the default export, so an empty selection must not fall
  // back to it: that would quietly ship every chat the user never picked.
  const bundle = storage.exportSelection([]);
  assert.equal(bundle.conversations.length, 0);
  assert.equal(bundle.facts.length, 0);
});

test("the export handler writes a sealed file with only the chosen chats", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "openmonkey-export-"));
  const previous = dialog.saveDialogResult;
  try {
    const chosen = chat("Exported by the handler");
    const left = chat("Not exported by the handler");
    const file = path.join(directory, "chats.openmonkey-export");
    dialog.saveDialogResult = { canceled: false, filePath: file };

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

    const handler = ipcHandlers.get("export-conversations");
    assert.ok(handler);
    const result = (await handler({}, [chosen], "a long enough passphrase")) as {
      ok: boolean;
      conversations?: number;
      error?: string;
    };

    assert.equal(result.ok, true, result.error ?? "the export failed");
    assert.equal(result.conversations, 1);

    const bundle = decryptBundle(readFileSync(file, "utf8"), "a long enough passphrase") as {
      conversations: Array<{ id: string }>;
    };
    assert.deepEqual(bundle.conversations.map((item) => item.id), [chosen]);
    assert.equal(JSON.stringify(bundle).includes(left), false);
    // Without the passphrase the file is unreadable, which is the point of it.
    assert.equal(decryptBundle(readFileSync(file, "utf8"), "the wrong passphrase"), null);
  } finally {
    dialog.saveDialogResult = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the export handler refuses an empty selection and a short passphrase", async () => {
  const previous = dialog.saveDialogResult;
  try {
    dialog.saveDialogResult = { canceled: false, filePath: path.join(os.tmpdir(), "never-written") };
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

    const handler = ipcHandlers.get("export-conversations");
    assert.ok(handler);

    const empty = (await handler({}, [], "a long enough passphrase")) as { ok: boolean; error?: string };
    assert.equal(empty.ok, false);
    assert.match(empty.error ?? "", /at least one chat/);

    const short = (await handler({}, ["some_id"], "short")) as { ok: boolean; error?: string };
    assert.equal(short.ok, false);
    assert.match(short.error ?? "", /at least 8 characters/);
  } finally {
    dialog.saveDialogResult = previous;
  }
});
