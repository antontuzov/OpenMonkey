/**
 * The appearance page in the running app.
 *
 * The unit tests prove that a density reaches the document element as the right
 * value; only the running app can prove that the row a user clicked is the row
 * that changed it, and that the theme on screen is the one whose setting applies.
 * A single density used to serve both themes, so the check here is the difference:
 * pack the dark theme and the light theme must not move. The colours are the same
 * story — what the user picks is what the app paints, and what the app cannot
 * read it says out loud.
 */
import { test, expect } from "@playwright/test";
import { quitApp } from "./helpers.mjs";
import { _electron as electron } from "playwright-core";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function launch(ui = {}) {
  const profile = mkdtempSync(path.join(os.tmpdir(), "openmonkey-appearance-"));
  writeFileSync(
    path.join(profile, "openmonkey-config.json"),
    JSON.stringify({
      onboarding: { completed: true },
      model: { provider: "bonsai" },
      memory: { enabled: false, workspaceSearch: false },
      ui: { theme: "light", language: "en", ...ui },
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

async function openAppearance(page) {
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await expect(page.getByRole("heading").first()).toBeVisible();
  await page.getByRole("navigation").first().getByRole("button", { name: "Appearance", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Appearance" })).toBeVisible();
}

const themeOn = (page) => page.evaluate(() => document.documentElement.dataset.theme);
const densityOn = (page) => page.evaluate(() => document.documentElement.dataset.density);
/**
 * The colour of the page as it is painted.
 *
 * On macOS the window is vibrant, so the body itself is transparent and the paper
 * is painted on the surfaces inside it. Reading the body would find nothing.
 */
const paperOn = (page) =>
  page.evaluate(() => {
    const painted = document.querySelector(".bg-paper");
    return painted ? getComputedStyle(painted).backgroundColor : "";
  });

/**
 * The theme cards, named the way a person would name them.
 *
 * The colour editor has a Dark of its own, so a button called "Dark" is no longer
 * enough to say which one is meant.
 */
const themeCard = (page, name) => page.locator("button.theme-option").filter({ hasText: name });
const colourTheme = (page, name) =>
  page.getByRole("group", { name: "Colours of the theme" }).getByRole("button", { name, exact: true });

test("each theme is packed as tightly as its own setting says", async () => {
  test.setTimeout(120_000);
  const { app, page, profile } = await launch({
    density: { light: "comfortable", dark: "compact" },
  });
  try {
    await openAppearance(page);
    expect(await themeOn(page)).toBe("light");
    expect(await densityOn(page)).toBe("comfortable");

    // The dark theme is the compact one, so the app tightens when it appears.
    await themeCard(page, "Dark").click();
    await expect.poll(() => themeOn(page)).toBe("dark");
    await expect.poll(() => densityOn(page)).toBe("compact");

    // And it loosens again when the light theme comes back.
    await themeCard(page, "Light").click();
    await expect.poll(() => themeOn(page)).toBe("light");
    await expect.poll(() => densityOn(page)).toBe("comfortable");
  } finally {
    await quitApp(app, profile);
    rmSync(profile, { recursive: true, force: true });
  }
});

test("packing one theme leaves the other one alone", async () => {
  test.setTimeout(120_000);
  const { app, page, profile } = await launch();
  try {
    await openAppearance(page);

    await page.getByRole("group", { name: "Dark density" }).getByRole("button", { name: "Compact" }).click();
    // The app is showing the light theme, so nothing about it may change.
    await expect.poll(() => densityOn(page)).toBe("comfortable");

    await themeCard(page, "Dark").click();
    await expect.poll(() => densityOn(page)).toBe("compact");

    await themeCard(page, "Light").click();
    await expect.poll(() => densityOn(page)).toBe("comfortable");

    // The other way round, to prove the two are not wired to the same value: the
    // dark theme is loosened first, so a light change that leaked into it would
    // be visible.
    await page.getByRole("group", { name: "Dark density" }).getByRole("button", { name: "Comfortable" }).click();
    await page.getByRole("group", { name: "Light density" }).getByRole("button", { name: "Compact" }).click();
    await expect.poll(() => densityOn(page)).toBe("compact");
    await themeCard(page, "Dark").click();
    await expect.poll(() => themeOn(page)).toBe("dark");
    await expect.poll(() => densityOn(page)).toBe("comfortable");
  } finally {
    await quitApp(app, profile);
    rmSync(profile, { recursive: true, force: true });
  }
});

test("a packed theme is still packed after a restart", async () => {
  test.setTimeout(120_000);
  const { app, page, profile } = await launch();
  try {
    await openAppearance(page);
    await page.getByRole("group", { name: "Dark density" }).getByRole("button", { name: "Compact" }).click();
    await themeCard(page, "Dark").click();
    await expect.poll(() => densityOn(page)).toBe("compact");

    await page.reload();
    await expect.poll(() => densityOn(page)).toBe("compact");
    expect(await themeOn(page)).toBe("dark");
  } finally {
    await quitApp(app, profile);
    rmSync(profile, { recursive: true, force: true });
  }
});

test("the density of a theme is found by typing its own name", async () => {
  test.setTimeout(120_000);
  const { app, page, profile } = await launch();
  try {
    await openAppearance(page);
    const search = page.getByLabel(/Search settings/);
    const results = page.locator("[data-settings-results]");

    await search.fill("Dark density");
    const hit = results.locator("button", { hasText: "Dark density" });
    await expect(hit).toBeVisible();
    await hit.click();
    await expect(page.getByRole("heading", { name: "Appearance" })).toBeVisible();
    expect(
      await page.evaluate(() => document.querySelector(".row-flash .row-title")?.textContent?.trim() ?? null)
    ).toBe("Dark density");
  } finally {
    await quitApp(app, profile);
    rmSync(profile, { recursive: true, force: true });
  }
});

test("a colour the user picks is the colour the app paints", async () => {
  test.setTimeout(120_000);
  const { app, page, profile } = await launch();
  try {
    await openAppearance(page);
    await page.getByLabel("Hex: Paper", { exact: true }).fill("#101010");

    await expect.poll(() => paperOn(page)).toBe("rgb(16, 16, 16)");

    // The colour is saved, so it is still there after a restart.
    await page.reload();
    await expect.poll(() => paperOn(page)).toBe("rgb(16, 16, 16)");
  } finally {
    await quitApp(app, profile);
    rmSync(profile, { recursive: true, force: true });
  }
});

test("each theme keeps its own colours", async () => {
  test.setTimeout(120_000);
  const { app, page, profile } = await launch();
  try {
    await openAppearance(page);
    await page.getByLabel("Hex: Paper", { exact: true }).fill("#101010");

    await colourTheme(page, "Dark").click();
    await page.getByLabel("Hex: Paper", { exact: true }).fill("#202020");

    // The app is showing the light theme, so the light colour is what is painted.
    await expect.poll(() => paperOn(page)).toBe("rgb(16, 16, 16)");
    await themeCard(page, "Dark").click();
    await expect.poll(() => paperOn(page)).toBe("rgb(32, 32, 32)");
    await themeCard(page, "Light").click();
    await expect.poll(() => paperOn(page)).toBe("rgb(16, 16, 16)");
  } finally {
    await quitApp(app, profile);
    rmSync(profile, { recursive: true, force: true });
  }
});

test("colours that cannot be read are said out loud, and can be put back", async () => {
  test.setTimeout(120_000);
  const { app, page, profile } = await launch();
  try {
    await openAppearance(page);
    await expect(page.getByText("Every pairing clears AA.")).toBeVisible();

    // The faint text painted in the colour of the page is unreadable, and the
    // app has to say so rather than paint it quietly.
    await page.getByLabel("Hex: Faint", { exact: true }).fill("#f6f7f3");
    await expect(page.getByText(/fall below AA/)).toBeVisible();

    await page.getByRole("button", { name: "Reset these colours" }).click();
    await expect(page.getByText("Every pairing clears AA.")).toBeVisible();
    await expect.poll(() => paperOn(page)).toBe("rgb(246, 247, 243)");
  } finally {
    await quitApp(app, profile);
    rmSync(profile, { recursive: true, force: true });
  }
});

test("a colour is found by typing the name of the token", async () => {
  test.setTimeout(120_000);
  const { app, page, profile } = await launch();
  try {
    await openAppearance(page);
    const search = page.getByLabel(/Search settings/);
    const results = page.locator("[data-settings-results]");

    await search.fill("Sidebar");
    const hit = results.locator("button", { hasText: "Sidebar" });
    await expect(hit).toBeVisible();
    await hit.click();
    await expect(page.getByRole("heading", { name: "Appearance" })).toBeVisible();
    expect(
      await page.evaluate(() => document.querySelector(".row-flash .row-title")?.textContent?.trim() ?? null)
    ).toBe("Sidebar");
  } finally {
    await quitApp(app, profile);
    rmSync(profile, { recursive: true, force: true });
  }
});
