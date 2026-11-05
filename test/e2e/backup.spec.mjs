import { test, expect } from "@playwright/test";
import { quitApp } from "./helpers.mjs";
import { _electron as electron } from "playwright-core";
import { existsSync, mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * The copies are made by the main process out of its own database file, so nothing
 * here needs a model: the page reads what the app already knows.
 */
async function launch() {
  const profile = mkdtempSync(path.join(os.tmpdir(), "openmonkey-backups-"));
  writeFileSync(
    path.join(profile, "openmonkey-config.json"),
    JSON.stringify({
      onboarding: { completed: true },
      model: { provider: "bonsai" },
      memory: { enabled: false, workspaceSearch: false },
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

/**
 * Settings → Privacy, down to the Storage section: the row that owns the integrity
 * chip and the two buttons, the copy rows under it, and the one line the page
 * answers with.
 */
async function openStorage(page) {
  await page.getByRole("textbox", { name: "Message OpenMonkey" }).waitFor();
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.getByRole("navigation").first().getByRole("button", { name: "Privacy", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Privacy" })).toBeVisible();
  const section = page.locator("main section").filter({ hasText: "Copies the app keeps" }).first();
  const copiesRow = section.locator(".row").filter({ hasText: "Copies the app keeps" }).first();
  await expect(copiesRow).toBeVisible();
  return { section, copiesRow, status: section.getByRole("status") };
}

const copyFiles = (profile) => {
  const dir = path.join(profile, "backups");
  return existsSync(dir) ? readdirSync(dir) : [];
};

const modeOf = (file) => (statSync(file).mode & 0o777).toString(8);

test("the Storage row reads the database, copies it on demand and keeps the copies unreadable to others", async () => {
  test.setTimeout(180_000);
  const { app, page, profile } = await launch();
  try {
    const { section, copiesRow, status } = await openStorage(page);

    // Nothing is guessed before the main process has answered.
    await expect(copiesRow.locator(".chip").first()).toHaveText(/not checked|intact|damaged/);

    await copiesRow.getByRole("button", { name: "Check", exact: true }).click();
    await expect(copiesRow.locator(".chip").first()).toHaveText("intact");
    await expect(status).toHaveText("intact");

    // The interval is the one the code runs on, read out of the status rather than typed in.
    await expect(copiesRow.getByText("every 12 h")).toBeVisible();

    await copiesRow.getByRole("button", { name: "Copy now", exact: true }).click();
    await expect(status).toHaveText("A copy of the history is in the backups folder.");
    await expect(section.getByRole("button", { name: "Put back", exact: true }).first()).toBeVisible();

    // The folder and every file in it are readable only by this account.
    expect(modeOf(path.join(profile, "backups"))).toBe("700");
    const names = copyFiles(profile);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(modeOf(path.join(profile, "backups", name))).toBe("600");
  } finally {
    await quitApp(app, profile);
  }
});

test("putting a copy back asks twice and drops the verdict it can no longer stand behind", async () => {
  test.setTimeout(180_000);
  const { app, page, profile } = await launch();
  try {
    const { section, copiesRow, status } = await openStorage(page);
    await copiesRow.getByRole("button", { name: "Copy now", exact: true }).click();
    const restore = section.getByRole("button", { name: "Put back", exact: true }).first();
    await expect(restore).toBeVisible();

    await copiesRow.getByRole("button", { name: "Check", exact: true }).click();
    await expect(copiesRow.locator(".chip").first()).toHaveText("intact");

    // The first press arms; nothing is written yet.
    await restore.click();
    const confirm = section.getByRole("button", { name: "Really put back?", exact: true });
    await expect(confirm).toBeVisible();

    // The second press puts the copy in place, and the history it replaced joins the list.
    await confirm.click();
    await expect(status).toHaveText(
      "That copy is in place. What it replaced was copied first, so it is on the list too."
    );
    expect(copyFiles(profile).length).toBeGreaterThan(1);

    // SQLite's verdict was about the file that used to be here, so the chip asks again.
    await expect(copiesRow.locator(".chip").first()).toHaveText("not checked");
  } finally {
    await quitApp(app, profile);
  }
});
