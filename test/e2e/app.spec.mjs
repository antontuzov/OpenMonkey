import { test, expect } from "@playwright/test";
import { _electron as electron } from "playwright-core";
import Database from "better-sqlite3";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { weightsOnDisk } from "./helpers.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test.describe.configure({ mode: "serial" });

let app;
let page;
let profile;
/**
 * The suite's own quit is a real quit, so its exit status doubles as the crash check:
 * teardown that leaves a node-llama-cpp worker outstanding aborts with a signal
 * instead of exiting 0.
 */
let quitStatus = null;

test.beforeAll(async () => {
  profile = mkdtempSync(path.join(os.tmpdir(), "openmonkey-e2e-"));
  app = await electron.launch({
    args: [root],
    timeout: 120_000,
    env: { ...process.env, OPENMONKEY_USER_DATA: profile, OPENMONKEY_DEBUG_PORT: "" },
  });
  app.process().on("exit", (code, signal) => {
    quitStatus = { code, signal };
  });
  page = await app.firstWindow({ timeout: 120_000 });
  await page.waitForLoadState("domcontentloaded");
});

test.afterAll(async () => {
  try {
    await app?.evaluate(({ app }) => app.quit());
  } catch {
    /* the app may already be gone */
  }
  for (let i = 0; quitStatus === null && i < 40; i++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  expect(quitStatus?.signal, `the app died with ${quitStatus?.signal} on quit`).toBeNull();
  expect(quitStatus?.code, "a real quit must exit 0").toBe(0);
  rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

/**
 * The settings view replaces the chat, so a test can arrive with either on screen.
 * Opens the sidebar page by name and leaves settings showing.
 */
async function openSettingsPage(section) {
  const inChat = await page
    .getByRole("textbox", { name: "Message OpenMonkey" })
    .isVisible()
    .catch(() => false);
  if (inChat) await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.getByRole("navigation").first().getByRole("button", { name: section, exact: true }).click();
}

/**
 * Leaves settings and waits for the chat, whichever view is on screen.
 *
 * A spec that measures the chat's own surfaces cannot count on the test before it to
 * have navigated back: the settings view replaces that whole tree, and on a machine
 * with no model the spec that used to end on "Back to app" is skipped.
 */
async function openChat() {
  const back = page.getByRole("button", { name: "Back to app" });
  if (await back.isVisible().catch(() => false)) await back.click();
  await expect(page.getByRole("textbox", { name: "Message OpenMonkey" })).toBeVisible();
}

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

  // The History card, not the whole page: the dashboard above it prints the clock, and a
  // capture that changes every minute is not a check.
  const historyCard = page.locator("main section").filter({ hasText: "Save conversation history" }).first();
  await expect(historyCard).toBeVisible();
  await expect(historyCard).toHaveScreenshot("settings-privacy.png");
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

test("the privacy dashboard answers from what the main process reports", async () => {
  await openSettingsPage("Privacy");
  await expect(page.getByRole("heading", { name: "Privacy" })).toBeVisible();
  await expect(page.getByText("Dashboard", { exact: true })).toBeVisible();

  const reported = await page.evaluate(() => window.electron.getPrivacyStatus());
  const tileText = async (label) =>
    (((await page.locator(`[data-stat="${label}"] p`).first().textContent()) ?? "").trim());

  // Nothing is guessed while the reply is on its way: every tile carries a value.
  for (const label of ["history on disk", "last prune", "requests made", "refused by the switch"]) {
    await expect(page.locator(`[data-stat="${label}"]`)).toBeVisible();
    const value = await tileText(label);
    expect(value.length > 0).toBe(true);
    expect(value.startsWith("—")).toBe(false);
  }

  expect(await tileText("requests made")).toBe(String(reported.requestsAllowed));
  expect(await tileText("refused by the switch")).toBe(String(reported.requestsBlocked));
  const prune = await tileText("last prune");
  expect(prune === "never").toBe(reported.lastPruneAt === null);

  // The key row says where the key actually is, in the main process's own words.
  const keyChip = page.locator(".row", { has: page.getByText("History key", { exact: true }) }).locator(".chip");
  await expect(keyChip.first()).toBeVisible();
  await expect(keyChip.first()).toHaveText(/keychain|0600 file|passphrase|locked|off/);

  // One number, one source: the tile and the storage row read the same size.
  const size = await tileText("history on disk");
  const databaseChip = page
    .locator(".row", { has: page.getByText("Database", { exact: true }) })
    .locator(".chip")
    .first();
  const chipText = ((await databaseChip.textContent()) ?? "").trim();
  expect(chipText.startsWith(`${size} · `)).toBe(true);
  expect(chipText).toMatch(/· (sealed|plain text)$/);
});

test("resetting a page puts its own settings back and leaves every other page alone", async () => {
  await openSettingsPage("Desktop");
  await expect(page.getByRole("heading", { name: "Desktop" })).toBeVisible();

  const read = (keyPath) =>
    page.evaluate((path) => window.electron.getConfig().then((value) => path.reduce((o, key) => o[key], value)), [
      ...keyPath,
    ]);

  const autoLockBefore = await read(["privacy", "autoLockMinutes"]);
  await page.getByRole("button", { name: "Beta", exact: true }).click();
  await expect.poll(() => read(["desktop", "updateChannel"])).toBe("beta");
  // A choice on another page, to prove the reset stays inside its own section.
  await page.evaluate(() => window.electron.setConfig({ privacy: { autoLockMinutes: 60 } }));

  const reset = page.getByRole("button", { name: "Reset page" });
  await expect(reset).toBeVisible();
  await reset.click();
  await expect(reset).toHaveText("Confirm reset");
  // One click only arms the button; the settings are untouched until it is confirmed.
  await expect.poll(() => read(["desktop", "updateChannel"])).toBe("beta");

  await reset.click();
  await expect.poll(() => read(["desktop", "updateChannel"])).toBe("stable");
  expect(await read(["privacy", "autoLockMinutes"])).toBe(60);
  await expect(page.getByText("Desktop is back to its defaults.")).toBeVisible();
  await expect(reset).toHaveText("Reset page");

  await page.evaluate((minutes) => window.electron.setConfig({ privacy: { autoLockMinutes: minutes } }), autoLockBefore);
});

test("the settings search finds a row on another page, opens it and marks it", async () => {
  await openSettingsPage("Profile");
  const search = page.getByLabel(/Search settings/);
  const results = page.locator("[data-settings-results]");

  await search.fill("bigger text");
  await expect(results).toBeVisible();
  const hit = results.locator("button", { hasText: "Text size" });
  await expect(hit).toBeVisible();
  // The result names the page that owns the row, so the jump is not a surprise.
  await expect(hit).toContainText("Appearance");

  await hit.click();
  await expect(page.getByRole("heading", { name: "Appearance" })).toBeVisible();
  expect(
    await page.evaluate(() => document.querySelector(".row-flash .row-title")?.textContent?.trim() ?? null)
  ).toBe("Text size");
  // The query is spent once it has been used, so the sidebar goes back to the pages.
  await expect(search).toHaveValue("");
  await expect(results).toHaveCount(0);

  // A word that appears nowhere on screen still reaches the row it belongs to.
  await search.fill("keychain");
  await results.locator("button", { hasText: "History key" }).click();
  await expect(page.getByRole("heading", { name: "Privacy" })).toBeVisible();
  expect(
    await page.evaluate(() => document.querySelector(".row-flash .row-title")?.textContent?.trim() ?? null)
  ).toBe("History key");

  await search.fill("nothingresemblesthis");
  await expect(results).toHaveCount(0);
  await expect(page.getByText(/No settings match/)).toBeVisible();
  await search.fill("");
});

test("every row a settings page renders can be found by typing its own name", async () => {
  // Run before any test writes facts, digests or audit rows: this sweep reads the
  // rows a page renders by itself, and user data is nobody's business but the index's.
  // Every row is typed into the box, so this is a minute of work rather than a check.
  test.setTimeout(180_000);
  await openSettingsPage("Profile");
  const nav = page.getByRole("navigation").first();
  const search = page.getByLabel(/Search settings/);
  const labels = () =>
    page.locator("[data-settings-results] .truncate").evaluateAll((elements) => elements.map((e) => e.textContent?.trim()));

  const missing = [];
  let rowsSeen = 0;
  for (const pageName of [
    "Profile",
    "Appearance",
    "Desktop",
    "Approvals",
    "Memory",
    "Workspace",
    "Permissions",
    "Privacy",
    "Publishing",
    "MCP servers",
    "Model",
  ]) {
    await nav.getByRole("button", { name: pageName, exact: true }).click();
    const titles = await page.locator("main .row-title").evaluateAll((elements) => [
      ...new Set(elements.map((element) => element.textContent?.trim()).filter(Boolean)),
    ]);
    rowsSeen += titles.length;
    for (const title of titles) {
      await search.fill(title);
      const hits = await labels();
      if (!hits.includes(title)) missing.push(`${pageName}: ${title}`);
    }
    await search.fill("");
  }
  // The sweep is only worth running if it walked the pages.
  expect(rowsSeen).toBeGreaterThan(30);
  console.log(`settings search indexes every rendered row: ${rowsSeen} rows checked, ${missing.length} missing`);
  expect(missing).toEqual([]);
});

test("the empty chat offers starter prompts that fill the composer", async () => {
  // Until the agent is ready, the empty chat shows the card that says where the
  // weights come from instead of the welcome panel; that card is the honest answer
  // for a machine with no model, so the panel is only checked where one exists.
  test.skip(!weightsOnDisk, "no model, so the empty chat shows the weights card");

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
  // Hide and Show prompts are controls on the welcome panel, and that panel is the
  // weights card when there is no model, so there is nothing to hide here.
  test.skip(!weightsOnDisk, "no model, so the empty chat shows the weights card");

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

test("the window feels native: a material sidebar and springs on every panel", async () => {
  // The settings-search sweep above ends inside settings, and the starter-prompt spec
  // that used to navigate back is skipped when there is no model, so come back here.
  await openChat();

  const mac = process.platform === "darwin";
  const toMillis = (value) => {
    const text = String(value).trim();
    if (text.endsWith("ms")) return Number.parseFloat(text);
    return Number.parseFloat(text) * 1000;
  };
  const alphaOf = (value) => {
    const text = String(value).trim();
    if (text.startsWith("color(")) {
      const slash = text.split("/")[1];
      return slash ? Number.parseFloat(slash) : 1;
    }
    const parts = text.split(",");
    return parts.length === 4 ? Number.parseFloat(parts[3]) : 1;
  };

  const motion = await page.evaluate(() => {
    const panel = document.querySelector(".motion-panel");
    const style = panel ? getComputedStyle(panel) : null;
    return {
      duration: style?.transitionDuration ?? "",
      timing: style?.transitionTimingFunction ?? "",
      property: style?.transitionProperty ?? "",
    };
  });
  const millis = toMillis(motion.duration);
  expect(millis).toBeGreaterThanOrEqual(160);
  expect(millis).toBeLessThanOrEqual(220);
  expect(motion.timing).toContain("cubic-bezier");
  expect(motion.property).toContain("width");

  // The panel slides on the spring instead of being torn out of the tree.
  const panelWidth = () =>
    page.evaluate(() => document.querySelector(".motion-panel")?.getBoundingClientRect().width ?? -1);
  const open = await panelWidth();
  await page.getByTitle("Hide activity").click();
  await expect.poll(panelWidth).toBe(0);
  await page.getByTitle("Show activity").click();
  await expect.poll(panelWidth).toBe(open);

  // The window is transparent so the material can show; the sidebar is the only
  // surface thin enough to let it through.
  const surface = await page.evaluate(() => {
    const root = document.documentElement;
    const sidebar = document.querySelector(".bg-sidebar");
    return {
      vibrant: root.dataset.vibrant ?? "",
      body: getComputedStyle(document.body).backgroundColor,
      sidebar: sidebar ? getComputedStyle(sidebar).backgroundColor : "",
    };
  });
  expect(surface.vibrant).toBe(mac ? "true" : "false");
  expect(surface.body).toBe(mac ? "rgba(0, 0, 0, 0)" : "rgb(246, 247, 243)");
  const alpha = alphaOf(surface.sidebar);
  if (mac) {
    expect(alpha).toBeLessThan(1);
    expect(alpha).toBeGreaterThan(0);
  } else {
    expect(alpha).toBe(1);
  }

  // Settings crossfades into the chat rather than swapping in a frame.
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Back to app" })).toBeVisible();
  const crossfade = await page.evaluate(() => {
    const view = document.querySelector(".view-crossfade");
    const style = view ? getComputedStyle(view) : null;
    return { name: style?.animationName ?? "", duration: style?.animationDuration ?? "" };
  });
  expect(crossfade.name).toBe("viewFade");
  const fadeMillis = toMillis(crossfade.duration);
  expect(fadeMillis).toBeGreaterThanOrEqual(160);
  expect(fadeMillis).toBeLessThanOrEqual(220);

  await page.getByRole("button", { name: "Back to app" }).click();
  await expect(page.getByRole("textbox", { name: "Message OpenMonkey" })).toBeVisible();
});

test("Settings → Model offers Auto and reports the weights on disk", async () => {
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.getByRole("button", { name: "Model", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Model" })).toBeVisible();

  // The library card reads the filesystem instead of assuming.
  await expect(page.getByText(/not downloaded|MB on this Mac|SHA-256 matches the pinned release/)).toBeVisible();

  const segments = page.locator(".segmented").first().locator("button");
  await expect(segments).toHaveCount(3);
  expect(await segments.evaluateAll((elements) => elements.map((element) => element.textContent))).toEqual([
    "Auto",
    "Bonsai 4B",
    "MLX",
  ]);
  // Nothing was chosen yet, so the app decides which installed backend to run.
  await expect(segments.nth(0)).toHaveClass(/segmented-active/);

  await expect(page.getByText("Generation speed")).toBeVisible();
  await expect(page.getByRole("button", { name: /Run benchmark|Measuring/ })).toBeVisible();

  await page.getByRole("button", { name: /Back to app/ }).click();
  await expect(page.getByRole("textbox", { name: "Message OpenMonkey" })).toBeVisible();
});

test("Settings → Model estimates the weights before loading them and measures real speed", async () => {
  // Both halves need the real weights, which a CI checkout does not carry.
  test.skip(!weightsOnDisk, "no Bonsai GGUF on disk to estimate or measure");
  // Loading 572 MB of weights and writing 96 tokens is the point of the test, so it
  // gets far more time than a UI check.
  test.setTimeout(240_000);

  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.getByRole("button", { name: "Model", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Model" })).toBeVisible();

  // The estimate comes from the GGUF header, so it is there before the load.
  await expect(page.getByText(/of weights plus .* of KV cache for a 4096-token context/)).toBeVisible();

  const status = () => page.evaluate(() => window.electron.getModelStatus());
  const estimate = await status().then((value) => value.memory);
  expect(estimate.modelBytes).toBeGreaterThan(400_000_000);
  expect(estimate.contextSize).toBe(4096);

  const runButton = page.getByRole("button", { name: /Run benchmark|Measuring/ });
  await expect(runButton).toBeEnabled({ timeout: 180_000 });

  const tokensPerSecond = async () => {
    const text = await page.locator('[data-stat="tokens / second"] p').first().textContent();
    const value = Number.parseFloat((text ?? "").trim());
    return Number.isFinite(value) ? value : 0;
  };
  expect(await tokensPerSecond()).toBe(0);

  await runButton.click();
  await expect.poll(tokensPerSecond, { timeout: 120_000 }).toBeGreaterThan(0);

  const measured = await tokensPerSecond();
  const record = await status();
  console.log(`measured ${measured.toFixed(1)} tokens/s · first token ${record.lastBenchmark.timeToFirstTokenMs} ms`);
  expect(record.lastBenchmark.tokens).toBeGreaterThan(0);
  expect(record.lastBenchmark.generationMs).toBeGreaterThan(0);
  expect(record.provider).toBe(record.lastBenchmark.provider);

  // Generating real tokens means the cold start is paid for.
  await expect(page.getByText("warm", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: /Back to app/ }).click();
  await expect(page.getByRole("textbox", { name: "Message OpenMonkey" })).toBeVisible();
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
