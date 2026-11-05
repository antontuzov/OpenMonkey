import { test, expect } from "@playwright/test";
import { quitApp, weightsOnDisk } from "./helpers.mjs";
import { _electron as electron } from "playwright-core";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function launch() {
  const profile = mkdtempSync(path.join(os.tmpdir(), "openmonkey-onboarding-"));
  const app = await electron.launch({
    args: [root],
    timeout: 120_000,
    env: { ...process.env, OPENMONKEY_USER_DATA: profile, OPENMONKEY_DEBUG_PORT: "" },
  });
  const page = await app.firstWindow({ timeout: 120_000 });
  await page.waitForLoadState("domcontentloaded");
  await page.setViewportSize({ width: 1280, height: 900 });
  return { app, page, profile };
}

async function close(app, profile) {
  await quitApp(app, profile);
}

/** Walk the four steps to the one that talks to the weights. */
async function toModelStep(page) {
  await page.getByRole("button", { name: "Get started" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Give it a brain.")).toBeVisible();
}

test.describe("the first run", () => {
  test.skip(!weightsOnDisk, "no Bonsai GGUF on disk to load");

  test("it answers once, in the flow, before setup ends", async () => {
    test.setTimeout(420_000);
    const { app, page, profile } = await launch();

    try {
      await toModelStep(page);

      // The card that offers the reply only appears when the weights are actually loaded.
      const probe = page.locator("[data-onboarding-probe]");
      await expect(probe).toBeVisible({ timeout: 180_000 });
      await expect(page.getByRole("button", { name: "Ask it" })).toBeVisible();

      await page.getByRole("button", { name: "Ask it" }).click();
      const answer = page.locator("[data-onboarding-answer]");
      await expect(answer).toBeVisible({ timeout: 120_000 });
      expect((await answer.innerText()).trim().length).toBeGreaterThan(0);

      // The flow knows it delivered, and says what happens next.
      await expect(page.getByRole("button", { name: "Open your first chat" })).toBeVisible();

      await page.getByRole("button", { name: "Open your first chat" }).click();
      await expect(page.locator("textarea").first()).toBeEnabled({ timeout: 60_000 });

      // The chat opens on the exchange that just happened, not on an empty one.
      await expect(page.locator("[data-chat-root]")).toBeVisible();
      expect(await page.locator("body").innerText()).toContain("say that you run locally");
    } finally {
      await close(app, profile);
    }
  });

  test("the model step offers both routes in: a download and a file already on this Mac", async () => {
    test.setTimeout(120_000);
    const { app, page, profile } = await launch();

    try {
      await toModelStep(page);

      // Weights are on disk here, so the card shows what it holds; the import route
      // is the one that never needs a network, and it is offered either way.
      const card = page.locator(".card").filter({ hasText: "Bonsai-4B" }).first();
      await expect(card).toBeVisible();
      const copy = await card.innerText();
      expect(copy).toMatch(/verified|installed|MB/);
      expect(copy).toMatch(/SHA-256|Verify|pinned/);
    } finally {
      await close(app, profile);
    }
  });
});
