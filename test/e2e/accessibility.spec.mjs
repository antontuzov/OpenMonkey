/**
 * The accessibility gate.
 *
 * The rules are unit-tested without a window, and so is every colour the palette can
 * paint. What only the running app can answer is what it actually puts on the screen
 * — 11.5px text over a card tinted by the accent, a control whose only label is an
 * icon — so this opens the real app, asks the renderer for its own report and fails
 * on any finding.
 *
 * The report is attached either way, because a gate that says "3 problems" without
 * saying where is not much use at two in the morning.
 */
import { test, expect } from "@playwright/test";
import { quitApp } from "./helpers.mjs";
import { _electron as electron } from "playwright-core";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Slate is the dullest of the eight swatches, so it sets the floor for a button label
 * painted on the accent. The unit test already proves every swatch pair by pair; this
 * checks the app is wearing the palette it claims to.
 */
async function launch(theme) {
  const profile = mkdtempSync(path.join(os.tmpdir(), "openmonkey-a11y-"));
  writeFileSync(
    path.join(profile, "openmonkey-config.json"),
    JSON.stringify({
      onboarding: { completed: true },
      model: { provider: "bonsai" },
      memory: { enabled: false, workspaceSearch: false },
      ui: { theme, accent: "#7b8794", language: "en" },
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

async function audit(page, title) {
  await page.waitForTimeout(500);
  const report = await page.evaluate(() => window.openmonkeyAudit?.());
  await test.info().attach(title, {
    body: JSON.stringify(report ?? { error: "no audit hook on the window" }, null, 2),
    contentType: "application/json",
  });
  expect(report, "the renderer did not install its audit hook").toBeTruthy();
  expect(report.checked, "the audit walked nothing, so it proved nothing").toBeGreaterThan(120);
  expect(report.findings, JSON.stringify(report.findings, null, 2)).toEqual([]);
}

for (const theme of ["light", "dark"]) {
  test(`the ${theme} app passes its own accessibility check`, async () => {
    const { app, page, profile } = await launch(theme);
    try {
      await page.getByRole("textbox", { name: "Message OpenMonkey" }).waitFor();
      await page.getByRole("navigation").first().waitFor();
      await audit(page, `chat-${theme}`);

      await page.getByRole("button", { name: "Settings", exact: true }).first().click();
      await expect(page.getByRole("heading").first()).toBeVisible();
      await audit(page, `settings-landing-${theme}`);

      await page.getByRole("navigation").first().getByRole("button", { name: "Appearance", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Appearance" })).toBeVisible();
      await audit(page, `settings-appearance-${theme}`);

      await page.getByRole("navigation").first().getByRole("button", { name: "Privacy", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Privacy" })).toBeVisible();
      await audit(page, `settings-privacy-${theme}`);
    } finally {
      await quitApp(app, profile);
      rmSync(profile, { recursive: true, force: true });
    }
  });
}
