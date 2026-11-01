import { test, expect } from "@playwright/test";
import { _electron as electron } from "playwright-core";
import Database from "better-sqlite3";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
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
  await page.waitForFunction(() => [...document.images].every((image) => image.complete));

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
      if (element.complete && element.naturalWidth === 0) {
        problems.push(`image did not load: ${element.currentSrc || element.getAttribute("src")}`);
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

test("the empty chat offers starter prompts that fill the composer", async () => {
  await page.getByRole("button", { name: /Back to app/ }).click();
  await expect(page.getByRole("textbox", { name: "Message OpenMonkey" })).toBeVisible();
  await expect(page.getByText(/^Mood: /)).toBeVisible();

  const composer = page.getByRole("textbox", { name: "Message OpenMonkey" });
  await page.getByRole("button", { name: "Read a folder", exact: true }).click();
  await expect(composer).toHaveValue(
    "Read the files in this project folder and summarize what each one does."
  );
  await expect(composer).toBeFocused();

  await page.getByRole("button", { name: "Plan my day", exact: true }).click();
  await expect(composer).toHaveValue(
    "Help me plan my day: ask me three questions, then propose a schedule."
  );
});

test("hiding the starter prompts sticks across a reload and can be restored", async () => {
  await page.getByRole("button", { name: "Hide", exact: true }).click();
  await expect(page.getByRole("button", { name: "Read a folder", exact: true })).toHaveCount(0);

  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await expect(page.getByRole("button", { name: "Read a folder", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Show prompts", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Show prompts", exact: true }).click();
  await expect(page.getByRole("button", { name: "Read a folder", exact: true })).toBeVisible();
});

test("erasing the history clears the window instead of reloading it", async () => {
  let navigations = 0;
  const countNavigation = () => {
    navigations += 1;
  };
  page.on("framenavigated", countNavigation);
  try {
    const before = await page.evaluate(() =>
      window.electron.getConversations().then((list) => list.map((conversation) => conversation.id))
    );
    const result = await page.evaluate(() => window.electron.eraseAllHistory("ERASE"));
    expect(result.ok).toBe(true);

    // The old chats are gone and the window kept its place: a reload would
    // flash the whole app, which is what the reset event replaced.
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.electron.getConversations().then((list) => list.map((conversation) => conversation.id))
        )
      )
      .not.toEqual(expect.arrayContaining(before));
    await page.waitForTimeout(500);
    expect(navigations).toBe(0);
  } finally {
    page.off("framenavigated", countNavigation);
  }
});

test("Settings → Desktop shows the update channel and stores the choice", async () => {
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
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

test("Quick Ask keeps a history, pins a question and opens it in the chat", async () => {
  const dbFile = path.join(profile, "data", "openmonkey.db");
  await expect.poll(() => existsSync(dbFile)).toBe(true);

  // The popover is a separate window; its own conversation is seeded straight into
  // the database so the history can be checked without a model behind it.
  const db = new Database(dbFile);
  const now = Date.now();
  db.prepare(
    "INSERT INTO conversations (id, title, created_at, updated_at, pinned, archived, kind) VALUES (?, ?, ?, ?, 0, 0, 'quick')"
  ).run("conv_qa_seed", "What is the plan?", now, now);
  db.prepare(
    "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run("msg_qa_seed", "conv_qa_seed", "user", "What is the plan?", now);
  db.prepare(
    "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run("msg_qa_seed_a", "conv_qa_seed", "assistant", "Ship the history today.", now + 1);
  db.prepare(
    "INSERT INTO quick_asks (id, conversation_id, question, answer, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)"
  ).run("qa_seed", "conv_qa_seed", "What is the plan?", "Ship the history today.", now, now);
  db.close();

  await page.evaluate(() => window.electron.openQuickAsk());
  await new Promise((resolve) => setTimeout(resolve, 800));
  const windows = app.windows();
  const quick = windows[windows.length - 1];
  await quick.waitForLoadState("domcontentloaded");

  // The history rail carries the question, and it is reachable with the keyboard.
  await expect(quick.getByRole("button", { name: /What is the plan\?/ })).toBeVisible();
  await expect(quick.getByText("History", { exact: true })).toBeVisible();

  await quick.getByRole("button", { name: /What is the plan\?/ }).focus();
  await quick.keyboard.press("p");
  await expect
    .poll(() => {
      const reader = new Database(dbFile, { readonly: true });
      const row = reader.prepare("SELECT pinned FROM quick_asks WHERE id = ?").get("qa_seed");
      reader.close();
      return row.pinned;
    })
    .toBe(1);

  // Opening the entry shows the thread it kept, question and answer together.
  await quick.keyboard.press("Enter");
  await expect(quick.getByText("Ship the history today.")).toBeVisible();

  // Opening it in the chat turns the quick ask into a normal conversation.
  await quick.getByRole("button", { name: "Open in chat" }).click();
  await expect(page.getByText("What is the plan?", { exact: true }).first()).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => window.electron.getConversations().then((list) => list.map((item) => item.id)))
    )
    .toContain("conv_qa_seed");
});

test("closing the window honours close-to-tray and keeps it hidden and alive", async () => {
  await page.evaluate(() => window.electron.setConfig({ desktop: { closeToTray: true } }));
  // The Quick Ask popover is a window of its own, so the main window is picked by
  // its URL rather than by its position in the list.
  const before = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  expect(before).toBeGreaterThan(0);
  await app.evaluate(({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find((window) => !window.webContents.getURL().includes("quick=1"));
    main?.close();
  });
  await new Promise((resolve) => setTimeout(resolve, 500));
  const after = await app.evaluate(
    ({ BrowserWindow, app }) => ({
      windows: BrowserWindow.getAllWindows().length,
      visible:
        BrowserWindow.getAllWindows().find((window) => !window.webContents.getURL().includes("quick=1"))
          ?.isVisible() ?? false,
      alive: app.isReady(),
    })
  );
  expect(after.alive).toBe(true);
  expect(after.windows).toBe(before);
  expect(after.visible).toBe(false);
});
