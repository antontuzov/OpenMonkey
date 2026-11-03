import { test, expect } from "@playwright/test";
import { quitApp } from "./helpers.mjs";
import { _electron as electron } from "playwright-core";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * The app reads the folders it may touch from HOME, so the test points it at a
 * throwaway home with one folder of notes in it.
 */
async function launch() {
  const profile = mkdtempSync(path.join(os.tmpdir(), "openmonkey-sources-"));
  const home = path.join(profile, "home");
  const notes = path.join(home, "Documents", "notes");
  mkdirSync(notes, { recursive: true });
  writeFileSync(
    path.join(notes, "release.md"),
    "The release ships on Friday.\nThe model check runs first.\nNothing else changes.\n",
    "utf8"
  );
  writeFileSync(path.join(notes, "server.log"), "the server started\nthe server stopped\n", "utf8");

  writeFileSync(
    path.join(profile, "openmonkey-config.json"),
    JSON.stringify({
      onboarding: { completed: true },
      model: { provider: "bonsai" },
      memory: { enabled: true, workspaceSearch: true, workspaceIgnore: [] },
      agent: { workspaceRoots: [notes] },
    })
  );

  const app = await electron.launch({
    args: [root],
    timeout: 120_000,
    env: { ...process.env, HOME: home, OPENMONKEY_USER_DATA: profile, OPENMONKEY_DEBUG_PORT: "" },
  });
  const page = await app.firstWindow({ timeout: 120_000 });
  await page.waitForLoadState("domcontentloaded");
  await page.setViewportSize({ width: 1440, height: 1000 });
  return { app, page, profile, notes };
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

test("the source manager lists what the index holds and keeps files out", async () => {
  test.setTimeout(180_000);
  const { app, page, profile } = await launch();

  try {
    await page.getByRole("textbox", { name: "Message OpenMonkey" }).waitFor();
    await openMemory(page);

    // The index is empty until it is built.
    await expect(page.getByText("No file is indexed yet")).toBeVisible();
    await page.getByRole("button", { name: "Rebuild" }).click();

    // The file the folder holds is listed, and its passages are shown.
    await expect(page.getByRole("button", { name: /^release\.md/ })).toBeVisible();
    await expect(page.getByText("The release ships on Friday.")).toBeVisible();
    await expect(page.getByText(/^lines 1/)).toBeVisible();

    // A rule keeps a file out, and the count says what it did.
    await page.getByLabel("Ignore rules").fill("*.log");
    await page.getByRole("button", { name: "Save rules" }).click();
    await expect(page.getByRole("button", { name: /^release\.md/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^server\.log/ })).toHaveCount(0);
    await expect(page.getByText(/ignored/)).toBeVisible();

    // The rule survives a reload, because it is a setting.
    await page.reload();
    await page.getByRole("textbox", { name: "Message OpenMonkey" }).waitFor();
    await openMemory(page);
    await expect(page.getByLabel("Ignore rules")).toHaveValue("*.log");

    // And a file can be read again on its own.
    await page.getByRole("button", { name: "Reindex release.md" }).click();
    await expect(page.getByRole("button", { name: /^release\.md/ })).toBeVisible();
  } finally {
    await quitApp(app, profile);
  }
});
