import { test, expect } from "@playwright/test";
import { _electron as electron } from "playwright-core";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test.describe.configure({ mode: "serial" });

let app;
let page;
let profile;

test.beforeAll(async () => {
  profile = mkdtempSync(path.join(os.tmpdir(), "openmonkey-e2e-"));
  app = await electron.launch({
    args: [root],
    env: { ...process.env, OPENMONKEY_USER_DATA: profile, OPENMONKEY_DEBUG_PORT: "" },
  });
  page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
});

test.afterAll(async () => {
  try {
    await app?.evaluate(({ app }) => app.quit());
  } catch {
    /* the app may already be gone */
  }
  rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test("a fresh profile opens the onboarding on Welcome", async () => {
  await expect(page.getByRole("button", { name: "Skip setup" })).toBeVisible();
  await expect(page.getByText("Welcome", { exact: true })).toBeVisible();
  const html = await page.content();
  expect(html.toLowerCase()).not.toContain("openclaw");
});

test("skipping setup lands on the chat surface with a named composer", async () => {
  await page.getByRole("button", { name: "Skip setup" }).click();
  await expect(page.getByRole("textbox", { name: "Message OpenMonkey" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New conversation" }).first()).toBeVisible();

  const violations = await page.evaluate(() => {
    const problems = [];
    const name = (element) =>
      element.getAttribute("aria-label") ||
      element.getAttribute("aria-labelledby") ||
      element.getAttribute("title") ||
      (element.textContent || "").trim();
    for (const element of document.querySelectorAll("button")) {
      if (!name(element)) problems.push(`unnamed button: ${element.outerHTML.slice(0, 80)}`);
    }
    for (const element of document.querySelectorAll("img")) {
      if (element.getAttribute("alt") === null && element.getAttribute("role") !== "presentation") {
        problems.push(`image without alt: ${element.getAttribute("src")}`);
      }
    }
    for (const element of document.querySelectorAll("input, textarea, select")) {
      const labelled =
        element.getAttribute("aria-label") ||
        element.getAttribute("aria-labelledby") ||
        element.getAttribute("placeholder") ||
        (element.id && document.querySelector(`label[for="${element.id}"]`));
      if (!labelled) problems.push(`unlabelled field: ${element.outerHTML.slice(0, 80)}`);
    }
    if (document.querySelectorAll("main").length !== 1) problems.push("expected exactly one main landmark");
    if (!document.documentElement.lang) problems.push("html element has no lang");
    return problems;
  });
  expect(violations).toEqual([]);
});

test("Settings → Privacy states its rows and switches, and every switch has a name", async () => {
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await expect(page.getByRole("navigation").first()).toBeVisible();
  await page.getByRole("button", { name: "Privacy", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Privacy" })).toBeVisible();
  await expect(
    page.getByText("Chat history and tasks live in a local SQLite file. These controls decide how long it stays readable.")
  ).toBeVisible();

  const switches = page.getByRole("switch");
  await expect(switches).toHaveCount(3);
  const names = await switches.evaluateAll((elements) => elements.map((element) => element.getAttribute("aria-label")));
  expect(names).toEqual(["Save conversation history", "Encrypt stored data", "Network access"]);
  for (const element of await switches.all()) await expect(element).toBeEnabled();

  await expect(page).toHaveScreenshot("settings-privacy.png", { fullPage: true });
});

test("the history switch flips and the page stays consistent", async () => {
  const history = page.getByRole("switch", { name: "Save conversation history" });
  await expect(history).toHaveAttribute("aria-checked", "true");
  await history.click();
  await expect(history).toHaveAttribute("aria-checked", "false");
  await expect(page.getByText("When off, messages stay in memory for the current run only.")).toBeVisible();
  await history.click();
  await expect(history).toHaveAttribute("aria-checked", "true");
});

test("switching to Russian translates the page and the html lang", async () => {
  await page.evaluate(() => window.electron.setConfig({ ui: { language: "ru" } }));
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  await page.getByRole("button", { name: "Настройки", exact: true }).first().click();
  await page.getByRole("button", { name: "Приватность", exact: true }).click();
  await expect(page.getByRole("switch", { name: "Сохранять историю диалогов" })).toBeVisible();
  await expect(page.getByPlaceholder("Фраза для копии")).toBeVisible();
  expect(await page.content()).not.toContain("Save conversation history");

  await page.evaluate(() => window.electron.setConfig({ ui: { language: "en" } }));
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.getByRole("button", { name: "Privacy", exact: true }).click();
  await expect(page.getByRole("switch", { name: "Save conversation history" })).toBeVisible();
});

test("Settings → Desktop shows the update channel and stores the choice", async () => {
  await page.getByRole("button", { name: "Desktop", exact: true }).click();
  await expect(page.getByText("Update channel", { exact: true })).toBeVisible();
  await expect(page.getByText(/Checks at launch and every six hours/)).toBeVisible();

  await page.getByRole("button", { name: "Beta", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.electron.getConfig().then((value) => value.desktop.updateChannel)))
    .toBe("beta");

  await page.getByRole("button", { name: "Stable", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.electron.getConfig().then((value) => value.desktop.updateChannel)))
    .toBe("stable");
});

test("closing the window honours close-to-tray and keeps it hidden and alive", async () => {
  await page.evaluate(() => window.electron.setConfig({ desktop: { closeToTray: true } }));
  const before = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  expect(before).toBeGreaterThan(0);
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].close();
  });
  await new Promise((resolve) => setTimeout(resolve, 500));
  const after = await app.evaluate(({ BrowserWindow, app }) => ({
    windows: BrowserWindow.getAllWindows().length,
    visible: BrowserWindow.getAllWindows()[0]?.isVisible() ?? false,
    alive: app.isReady(),
  }));
  expect(after.alive).toBe(true);
  expect(after.windows).toBe(before);
  expect(after.visible).toBe(false);
});
