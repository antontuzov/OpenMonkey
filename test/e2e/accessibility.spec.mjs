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

/**
 * Waits for the screen to stop painting before it is judged.
 *
 * The app fades its panels in, and an element at zero opacity is one nobody can read,
 * so a report taken during the fade describes half a screen. The count is read until
 * two readings agree and the screen has had a moment to settle, which is the point at
 * which what is on the screen is the whole of it.
 */
async function settledReport(page) {
  let previous = -1;
  let stable = 0;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const report = await page.evaluate(() => window.openmonkeyAudit?.());
    if (report && report.checked === previous) {
      stable += 1;
      if (stable >= 2 && attempt >= 4) return report;
    } else {
      stable = 0;
    }
    previous = report?.checked ?? -1;
    await page.waitForTimeout(250);
  }
  return page.evaluate(() => window.openmonkeyAudit?.());
}

/**
 * What each screen has to contain for the report to count as a reading of it.
 *
 * These are floors, not counts: the chat has a composer and a row of controls, and a
 * settings page has a row of them. A report that found none of these has not looked
 * at the screen, and passing it on an empty list would be a gate that never fires.
 */
const FLOORS = {
  chat: { control: 4, field: 1, text: 6 },
  landing: { control: 3, text: 5 },
  appearance: { control: 3, text: 5 },
  privacy: { control: 3, text: 5 },
};

async function audit(page, title, floors) {
  const report = await settledReport(page);
  await test.info().attach(title, {
    body: JSON.stringify(report ?? { error: "no audit hook on the window" }, null, 2),
    contentType: "application/json",
  });
  expect(report, "the renderer did not install its audit hook").toBeTruthy();
  for (const [kind, floor] of Object.entries(floors)) {
    expect(
      report.kinds[kind],
      `the ${title} screen was read without a single ${kind} in it`
    ).toBeGreaterThanOrEqual(floor);
  }
  expect(report.findings, JSON.stringify(report.findings, null, 2)).toEqual([]);
}

for (const theme of ["light", "dark"]) {
  test(`the ${theme} app passes its own accessibility check`, async () => {
    const { app, page, profile } = await launch(theme);
    try {
      await page.getByRole("textbox", { name: "Message OpenMonkey" }).waitFor();
      await page.getByRole("navigation").first().waitFor();
      await audit(page, `chat-${theme}`, FLOORS.chat);

      await page.getByRole("button", { name: "Settings", exact: true }).first().click();
      await expect(page.getByRole("heading").first()).toBeVisible();
      await audit(page, `settings-landing-${theme}`, FLOORS.landing);

      await page.getByRole("navigation").first().getByRole("button", { name: "Appearance", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Appearance" })).toBeVisible();
      await audit(page, `settings-appearance-${theme}`, FLOORS.appearance);

      await page.getByRole("navigation").first().getByRole("button", { name: "Privacy", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Privacy" })).toBeVisible();
      await audit(page, `settings-privacy-${theme}`, FLOORS.privacy);
    } finally {
      await quitApp(app, profile);
      rmSync(profile, { recursive: true, force: true });
    }
  });
}
