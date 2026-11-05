import { test, expect } from "@playwright/test";
import { quitApp, weightsOnDisk } from "./helpers.mjs";
import { _electron as electron } from "playwright-core";
import Database from "better-sqlite3";
import { existsSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test.describe.configure({ mode: "serial" });

let app;
let page;
let profile;

test.beforeAll(async () => {
  profile = mkdtempSync(path.join(os.tmpdir(), "openmonkey-tabs-"));
  app = await electron.launch({
    args: [root],
    timeout: 120_000,
    env: { ...process.env, OPENMONKEY_USER_DATA: profile, OPENMONKEY_DEBUG_PORT: "" },
  });
  page = await app.firstWindow({ timeout: 120_000 });
  await page.waitForLoadState("domcontentloaded");
  await page.getByRole("button", { name: "Skip setup" }).click();
  await expect(page.getByRole("textbox", { name: "Message OpenMonkey" })).toBeVisible();
});

test.afterAll(async () => {
  await quitApp(app, profile);
});

const tabs = () => page.getByRole("tab");
const composer = () => page.getByRole("textbox", { name: "Message OpenMonkey" });
const tablist = () => page.getByRole("tablist", { name: "Open chats" });

/** The open chats in the order the tabs are shown. */
const openTabIds = () =>
  page.evaluate(() => window.electron.getConfig().then((value) => value.ui.openTabs));

/** The tab that is in front, by the name it shows. */
const activeTabName = () =>
  page.evaluate(
    () => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent ?? null
  );

/** A reply as the model would send it: the start of one, and the end of it. */
const startReply = (conversationId, token) =>
  app.evaluate(
    async ({ BrowserWindow }, { conversationId, token }) => {
      const send = (payload) => BrowserWindow.getAllWindows()[0].webContents.send("chat-event", payload);
      const id = `tab_stream_${Date.now()}`;
      send({
        type: "start",
        conversationId,
        message: { id, role: "assistant", content: "", timestamp: new Date() },
      });
      if (token) send({ type: "token", conversationId, messageId: id, token });
    },
    { conversationId, token }
  );

const finishReply = (conversationId, content) =>
  app.evaluate(
    async ({ BrowserWindow }, { conversationId, content }) => {
      const send = (payload) => BrowserWindow.getAllWindows()[0].webContents.send("chat-event", payload);
      send({
        type: "done",
        conversationId,
        message: { id: "tab_done", role: "assistant", content, timestamp: new Date() },
      });
    },
    { conversationId, content }
  );

test("a second chat opens as a tab beside the first", async () => {
  await expect(tablist()).toBeVisible();
  await expect(tabs()).toHaveCount(1);
  // The one tab cannot be closed away: the window always shows a chat.
  await expect(page.getByRole("button", { name: /^Close / })).toHaveCount(0);

  await page.getByRole("button", { name: "New tab" }).click();
  await expect(tabs()).toHaveCount(2);
  await expect(page.getByRole("button", { name: /^Close / })).toHaveCount(2);
});

test("each tab keeps its own conversation", async () => {
  const order = await openTabIds();
  expect(order.length).toBe(2);
  const [first, second] = order;

  // Two chats with names, so the tabs can be told apart by what they say.
  await page.evaluate(
    ([a, b]) =>
      Promise.all([
        window.electron.renameConversation(a, "First tab"),
        window.electron.renameConversation(b, "Second tab"),
      ]),
    [first, second]
  );

  // A line in each chat, written straight into the history the app reads.
  const dbFile = path.join(profile, "data", "openmonkey.db");
  await expect.poll(() => existsSync(dbFile)).toBe(true);
  const db = new Database(dbFile);
  const now = Date.now();
  const insert = db.prepare(
    "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)"
  );
  insert.run("msg_tab_first", first, "user", "The first chat speaks", now);
  insert.run("msg_tab_second", second, "user", "The second chat speaks", now + 1);
  db.close();

  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await expect(tabs()).toHaveCount(2);
  await expect(tabs().nth(0)).toContainText("First tab");
  await expect(tabs().nth(1)).toContainText("Second tab");

  await tabs().nth(0).click();
  await expect(page.getByRole("main").getByText("The first chat speaks")).toBeVisible();
  await expect(page.getByRole("main").getByText("The second chat speaks")).toHaveCount(0);

  await tabs().nth(1).click();
  await expect(page.getByRole("main").getByText("The second chat speaks")).toBeVisible();
  await expect(page.getByRole("main").getByText("The first chat speaks")).toHaveCount(0);
});

test("the tab that is answering says so", async () => {
  const order = await openTabIds();
  const answering = order[0];
  const answerIndex = order.indexOf(answering);

  await tabs().nth(answerIndex).click();
  await app.evaluate(async ({ BrowserWindow }, { conversationId }) => {
    const send = (payload) => BrowserWindow.getAllWindows()[0].webContents.send("chat-event", payload);
    send({
      type: "start",
      conversationId,
      message: { id: "tab_busy", role: "assistant", content: "", timestamp: new Date() },
    });
  }, { conversationId: answering });

  // The mark belongs to the chat that is answering, not to the one on screen.
  await expect(tabs().nth(answerIndex).locator(".animate-spin")).toBeVisible();
  await expect(tabs().nth(1 - answerIndex).locator(".animate-spin")).toHaveCount(0);
  await expect(page.getByText("Answering", { exact: true })).toBeVisible();

  await finishReply(answering, "The answer is here");
  await expect(tabs().nth(answerIndex).locator(".animate-spin")).toHaveCount(0);
});

test("the open chats come back with the window", async () => {
  const before = await openTabIds();
  await expect
    .poll(() => page.evaluate(() => window.electron.getConfig().then((value) => value.ui.openTabs.length)))
    .toBe(before.length);
  const activeBefore = await activeTabName();

  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await expect(tablist()).toBeVisible();
  await expect(tabs()).toHaveCount(before.length);
  await expect.poll(() => activeTabName()).toBe(activeBefore);
});

test.describe("with the model behind it", () => {
  test.skip(!weightsOnDisk, "no Bonsai GGUF on disk to load");

  test("another tab waits while the answer is running", async () => {
    test.setTimeout(240_000);
    await expect(composer()).toBeEnabled({ timeout: 180_000 });

    const order = await openTabIds();
    const answering = order[0];
    const answerIndex = order.indexOf(answering);

    await tabs().nth(answerIndex).click();
    await startReply(answering);
    await expect(composer()).toHaveAttribute("placeholder", "Answering…");

    // The other tab comes to the front while the answer is still running.
    await tabs().nth(1 - answerIndex).click();
    await expect(composer()).toHaveAttribute("placeholder", "Another chat is still answering.");

    // Sending there is refused: the model answers one chat at a time.
    await composer().fill("Can you answer me as well?");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("Another chat is still answering.").first()).toBeVisible();
    await expect(composer()).toHaveValue("Can you answer me as well?");

    await finishReply(answering, "The answer is here");
  });

  test("the answer in a tab survives a switch to another one", async () => {
    test.setTimeout(420_000);
    await expect(composer()).toBeEnabled({ timeout: 180_000 });

    const order = await openTabIds();
    const answering = order[0];
    const answerIndex = order.indexOf(answering);

    await tabs().nth(answerIndex).click();
    await composer().fill("Answer with one short sentence about tabs.");
    await composer().press("Enter");

    // Another tab comes to the front while the model is still answering.
    await tabs().nth(1 - answerIndex).click();
    await expect(composer()).toHaveAttribute("placeholder", "Another chat is still answering.", {
      timeout: 60_000,
    });

    // The reply lands in the chat it belongs to, not in the one on screen.
    await expect
      .poll(
        () =>
          page.evaluate(
            (id) =>
              window.electron.getMessages(id).then((messages) =>
                messages.filter((message) => message.role === "assistant").length
              ),
            answering
          ),
        { timeout: 240_000 }
      )
      .toBeGreaterThan(0);

    await tabs().nth(answerIndex).click();
    await expect(page.locator(".message-assistant").first()).toBeVisible();
  });
});

test("closing a tab leaves the chat in the history", async () => {
  const before = await page.evaluate(() =>
    window.electron.getConversations().then((list) => list.length)
  );
  await tabs().nth(1).hover();
  await page.getByRole("button", { name: "Close Second tab" }).click();
  await expect(tabs()).toHaveCount(1);

  const after = await page.evaluate(() =>
    window.electron.getConversations().then((list) => list.length)
  );
  expect(after).toBe(before);
});
