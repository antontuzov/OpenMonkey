import { test, expect } from "@playwright/test";
import { quitApp } from "./helpers.mjs";
import { _electron as electron } from "playwright-core";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function launch(extraConfig = {}) {
  const profile = mkdtempSync(path.join(os.tmpdir(), "openmonkey-palette-"));
  writeFileSync(
    path.join(profile, "openmonkey-config.json"),
    JSON.stringify({ onboarding: { completed: true }, model: { provider: "bonsai" }, ...extraConfig })
  );
  const app = await electron.launch({
    args: [root],
    timeout: 120_000,
    env: { ...process.env, OPENMONKEY_USER_DATA: profile, OPENMONKEY_DEBUG_PORT: "" },
  });
  const page = await app.firstWindow({ timeout: 120_000 });
  await page.waitForLoadState("domcontentloaded");
  await page.setViewportSize({ width: 1280, height: 1000 });
  return { app, page, profile };
}

async function close(app, profile) {
  await quitApp(app, profile);
}

const palette = (page) => page.getByRole("dialog", { name: "Command palette" });
const box = (page) => page.getByRole("combobox");

/**
 * The app has to be up before the palette means anything. The wait is deliberately
 * language-agnostic: the same spec runs in Russian, where every visible name changes.
 */
async function ready(page) {
  await page.locator("header.drag-region").waitFor();
  await page.locator("textarea").first().waitFor();
}

test("Cmd+K opens the palette, and escape closes it", async () => {
  test.setTimeout(120_000);
  const { app, page, profile } = await launch();
  try {
    await ready(page);

    await page.keyboard.press("Meta+k");
    await expect(palette(page)).toBeVisible();
    await expect(box(page)).toBeFocused();
    await expect(page.getByRole("option").first()).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(palette(page)).toBeHidden();
  } finally {
    await close(app, profile);
  }
});

test("the palette finds a setting by a word nobody sees and opens its page", async () => {
  test.setTimeout(120_000);
  const { app, page, profile } = await launch();
  try {
    await ready(page);

    await page.keyboard.press("Meta+k");
    await box(page).fill("keychain");

    const option = page.getByRole("option", { name: /History key/ });
    await expect(option).toBeVisible();
    await option.click();

    await expect(palette(page)).toBeHidden();
    await expect(page.getByRole("heading", { name: "Privacy" })).toBeVisible();
    // The row it named is the one that is marked.
    await expect(page.locator(".row-flash")).toBeVisible();
  } finally {
    await close(app, profile);
  }
});

test("the palette is driven from the keyboard alone", async () => {
  test.setTimeout(120_000);
  const { app, page, profile } = await launch();
  try {
    await ready(page);

    await page.keyboard.press("Meta+k");
    await box(page).fill("panel");

    const options = page.getByRole("option");
    await expect(options.first()).toBeVisible();
    const first = await options.first().getAttribute("aria-selected");
    await page.keyboard.press("ArrowDown");
    const second = await options.nth(1).getAttribute("aria-selected");
    expect(first).toBe("true");
    expect(second).toBe("true");
    await page.keyboard.press("ArrowUp");
    await expect(options.first()).toHaveAttribute("aria-selected", "true");

    // The activity panel is open when the app starts; the command closes it.
    await expect(page.locator(".motion-panel")).toHaveClass(/w-\[300px\]/);
    await page.keyboard.press("Enter");
    await expect(palette(page)).toBeHidden();
    await expect(page.locator(".motion-panel")).toHaveClass(/w-0/);
  } finally {
    await close(app, profile);
  }
});

test("the palette answers in Russian too", async () => {
  test.setTimeout(120_000);
  const { app, page, profile } = await launch({ ui: { language: "ru" } });
  try {
    await ready(page);

    await page.keyboard.press("Meta+k");
    await expect(page.getByRole("dialog", { name: "Палитра команд" })).toBeVisible();
    await box(page).fill("настроение");
    await expect(page.getByRole("option", { name: "Сменить настроение" })).toBeVisible();
  } finally {
    await close(app, profile);
  }
});
