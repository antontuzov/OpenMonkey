import { test, expect } from "@playwright/test";
import { quitApp } from "./helpers.mjs";
import { _electron as electron } from "playwright-core";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  seedUnfinishedThread,
  CONVERSATION_ID,
  LOST_ANSWER,
  FINISHED_ANSWER,
} from "../fixtures/stream-resume.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const chatRow = (page, title) =>
  page.locator("[data-session-row]").filter({ hasText: title }).first();

/**
 * An answer the app lost halfway through offers to be carried on, and an answer
 * that ended does not. The thread comes from the shared fixture, so the test is
 * about the renderer and the bridge, not about a model.
 */
test("an answer that was cut off offers to carry on, and a finished one does not", async () => {
  test.setTimeout(120_000);

  const profile = mkdtempSync(path.join(os.tmpdir(), "openmonkey-resume-"));
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
    await page.getByRole("textbox", { name: "Message OpenMonkey" }).waitFor();

    const dbFile = path.join(profile, "data", "openmonkey.db");
    await expect.poll(() => existsSync(dbFile)).toBe(true);
    seedUnfinishedThread(dbFile);

    // The renderer reads its conversation list at start-up, so it reloads to see the row.
    await page.reload();
    await page.getByRole("textbox", { name: "Message OpenMonkey" }).waitFor();
    await chatRow(page, "Lost answer").click();

    const lost = page.locator(`[data-message-id="${CONVERSATION_ID}_lost"]`);
    const done = page.locator(`[data-message-id="${CONVERSATION_ID}_done"]`);

    // The cut-off answer keeps its part and offers to go on.
    await expect(lost.locator(".message-assistant")).toContainText(LOST_ANSWER);
    await expect(lost.getByRole("button", { name: "Continue" })).toBeVisible();

    // The answer that ended has nothing to carry on.
    await expect(done.locator(".message-assistant")).toContainText(FINISHED_ANSWER);
    await expect(done.getByRole("button", { name: "Continue" })).toHaveCount(0);
  } finally {
    await quitApp(app, profile);
  }
});
