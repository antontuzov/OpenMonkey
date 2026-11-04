import { test, expect } from "@playwright/test";
import { quitApp } from "./helpers.mjs";
import { _electron as electron } from "playwright-core";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  seedMessageThread,
  CONVERSATION_ID,
  SHORT_ANSWER,
  LONG_ANSWER,
} from "../fixtures/message-actions.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * A chat in the list on the left. The tab strip carries the same names, so the
 * row is taken by its own marker rather than by the text alone.
 */
const chatRow = (page, title) =>
  page.locator("[data-session-row]").filter({ hasText: title }).first();

/**
 * The chat around a reply: how long it took, how many tokens it used, and the
 * other answers to the same question. The thread comes from the shared fixture,
 * so the test is about the renderer and the bridge, not about a model.
 */
test("a reply shows its duration and tokens, and the switcher walks the answers", async () => {
  test.setTimeout(120_000);

  const profile = mkdtempSync(path.join(os.tmpdir(), "openmonkey-actions-"));
  writeFileSync(
    path.join(profile, "openmonkey-config.json"),
    JSON.stringify({ onboarding: { completed: true }, model: { provider: "bonsai" } })
  );

  const app = await electron.launch({
    args: [root],
    timeout: 120_000,
    env: { ...process.env, OPENMONKEY_USER_DATA: profile, OPENMONKEY_DEBUG_PORT: "" },
  });

  try {
    const page = await app.firstWindow({ timeout: 120_000 });
    await page.waitForLoadState("domcontentloaded");
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.getByRole("textbox", { name: "Message OpenMonkey" }).waitFor();

    const dbFile = path.join(profile, "data", "openmonkey.db");
    await expect.poll(() => existsSync(dbFile)).toBe(true);
    seedMessageThread(dbFile);

    // The renderer reads its conversation list at start-up, so it reloads to see the row.
    await page.reload();
    await page.getByRole("textbox", { name: "Message OpenMonkey" }).waitFor();
    await chatRow(page, "Answer probe").click();

    const turn = page.locator(".message-enter").last();
    await expect(turn.locator(".message-assistant")).toContainText(LONG_ANSWER);

    // The caption carries the numbers the model reported, not a guess.
    await expect(turn.getByText("3.4s")).toBeVisible();
    await expect(turn.getByText("128 tokens")).toBeVisible();

    // The group has two answers and the newest one is on screen.
    await expect(turn.locator("span.tabular-nums[title]")).toHaveText("2/2");

    // Stepping back swaps the bubble, and the main process records which one is shown.
    await turn.getByRole("button", { name: "Previous answer" }).click();
    await expect(turn.locator(".message-assistant")).toContainText(SHORT_ANSWER);
    await expect(turn.locator("span.tabular-nums[title]")).toHaveText("1/2");

    const db = new Database(dbFile, { readonly: true });
    try {
      const shown = db
        .prepare("SELECT id FROM messages WHERE id LIKE ? AND active = 1")
        .all(`${CONVERSATION_ID}_a%`);
      assert.deepEqual(
        shown.map((row) => row.id),
        [`${CONVERSATION_ID}_a1`]
      );
    } finally {
      db.close();
    }

    // Quoting puts the answer into the composer, line by line.
    await turn.getByRole("button", { name: "Quote in the chat" }).click();
    await expect(page.getByRole("textbox", { name: "Message OpenMonkey" })).toHaveValue(
      `> ${SHORT_ANSWER}\n\n`
    );

    // Copying writes for real: the label only changes if the clipboard call resolved.
    await turn.getByRole("button", { name: "Copy message" }).click();
    await expect(page.getByText("Copied to clipboard")).toBeVisible();

    // Branching copies the chat up to this message into a chat of its own.
    await turn.getByRole("button", { name: "Branch from here" }).click();
    await expect(chatRow(page, "Answer probe (branch)")).toBeVisible();
    await expect(page.getByText("Branched into a new chat")).toBeVisible();
  } finally {
    await quitApp(app, profile);
  }
});
