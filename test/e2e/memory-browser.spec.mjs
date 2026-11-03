import { test, expect } from "@playwright/test";
import { quitApp } from "./helpers.mjs";
import { _electron as electron } from "playwright-core";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { seedMemoryChat, CONVERSATION_TITLE } from "../fixtures/memory-browser.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function launch() {
  const profile = mkdtempSync(path.join(os.tmpdir(), "openmonkey-memory-"));
  writeFileSync(
    path.join(profile, "openmonkey-config.json"),
    JSON.stringify({
      onboarding: { completed: true },
      model: { provider: "bonsai" },
      memory: { enabled: true, workspaceSearch: false },
    })
  );
  const app = await electron.launch({
    args: [root],
    timeout: 120_000,
    env: { ...process.env, OPENMONKEY_USER_DATA: profile, OPENMONKEY_DEBUG_PORT: "" },
  });
  const page = await app.firstWindow({ timeout: 120_000 });
  await page.waitForLoadState("domcontentloaded");
  await page.setViewportSize({ width: 1440, height: 1000 });
  return { app, page, profile };
}

async function openMemory(page) {
  const inChat = await page
    .getByRole("textbox", { name: "Message OpenMonkey" })
    .isVisible()
    .catch(() => false);
  if (inChat) await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.getByRole("navigation").first().getByRole("button", { name: "Memory", exact: true }).click();
  await expect(page.getByLabel("Search memory")).toBeVisible();
}

test("the memory browser holds a fact and a chat, and both can be changed", async () => {
  test.setTimeout(180_000);
  const { app, page, profile } = await launch();

  try {
    await page.getByRole("textbox", { name: "Message OpenMonkey" }).waitFor();
    const dbFile = path.join(profile, "data", "openmonkey.db");
    await expect.poll(() => existsSync(dbFile)).toBe(true);
    seedMemoryChat(dbFile);

    // The renderer reads its conversation list at start-up, so it reloads to see the row.
    await page.reload();
    await page.getByRole("textbox", { name: "Message OpenMonkey" }).waitFor();
    await openMemory(page);

    // The seeded chat is in the browser, next to the empty fact list.
    await expect(page.getByRole("button", { name: CONVERSATION_TITLE })).toBeVisible();
    await page.getByRole("button", { name: CONVERSATION_TITLE }).click();
    await expect(page.getByLabel("Your summary")).toBeVisible();
    // The digest the model would read is shown, not hidden behind a summary.
    await expect(page.getByText(/Earlier:/)).toBeVisible();

    // A summary the user writes replaces the digest.
    await page.getByLabel("Your summary").fill("We ship on Friday; the model check runs first.");
    await page.getByRole("button", { name: "Save summary" }).click();
    await expect(page.getByLabel("Your summary")).toHaveValue(
      "We ship on Friday; the model check runs first."
    );
    await expect(page.getByText("recalled", { exact: true })).toBeVisible();

    // Turning recall off takes the chat out of the next prompt.
    await page.getByRole("switch", { name: "Recall this chat" }).click();
    await expect(page.getByText("not recalled", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Your summary")).toHaveValue(
      "We ship on Friday; the model check runs first."
    );

    // A fact is pinned from the browser and lands in the list.
    await page.getByLabel("Pin a fact").fill("The staging host is called fox");
    await page.getByRole("button", { name: "Add fact" }).click();
    await expect(page.getByRole("button", { name: "The staging host is called fox" })).toBeVisible();
    await page.getByRole("button", { name: "The staging host is called fox" }).click();
    await expect(page.getByText(/^\[fact:[A-Za-z0-9]{6}\]$/)).toBeVisible();

    // Rewriting a fact keeps the label that cites it.
    const label = await page.getByText(/^\[fact:[A-Za-z0-9]{6}\]$/).innerText();
    await page.getByLabel("Fact text").fill("The staging host is called fox, on the office network");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "The staging host is called fox, on the office network" })
    ).toBeVisible();
    await expect(page.getByText(label, { exact: true })).toBeVisible();

    // The search narrows the list to what the user typed.
    await page.getByLabel("Search memory").fill("staging");
    await expect(
      page.getByRole("button", { name: "The staging host is called fox, on the office network" })
    ).toBeVisible();
    await expect(page.getByRole("button", { name: CONVERSATION_TITLE })).toHaveCount(0);
    await page.getByLabel("Search memory").fill("");

    // And the fact can be deleted from the same pane.
    await page.getByRole("button", { name: "The staging host is called fox, on the office network" }).click();
    await page.getByRole("button", { name: "Delete fact" }).click();
    await expect(
      page.getByRole("button", { name: "The staging host is called fox, on the office network" })
    ).toHaveCount(0);
  } finally {
    await quitApp(app, profile);
  }
});

test("a citation in an answer opens the source behind it", async () => {
  test.setTimeout(180_000);
  const { app, page, profile } = await launch();

  try {
    await page.getByRole("textbox", { name: "Message OpenMonkey" }).waitFor();

    // A fact the answer may cite, pinned through the same bridge the browser uses.
    const fact = await page.evaluate(async () => {
      const snapshot = await window.electron.addMemoryFact("The staging host is called fox");
      return snapshot.facts[0].id;
    });
    const label = `[fact:${fact.slice(-6)}]`;

    const dbFile = path.join(profile, "data", "openmonkey.db");
    await expect.poll(() => existsSync(dbFile)).toBe(true);
    seedMemoryChat(dbFile, { answer: `The staging host is called fox ${label}.` });

    await page.reload();
    await page.getByRole("textbox", { name: "Message OpenMonkey" }).waitFor();
    await page.getByRole("button", { name: /Release checklist/ }).click();

    const chip = page.locator(`button.citation-chip[title="${label}"]`);
    await expect(chip).toBeVisible();
    await chip.click();

    const panel = page.locator(".citation-panel");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("The staging host is called fox");
  } finally {
    await quitApp(app, profile);
  }
});
