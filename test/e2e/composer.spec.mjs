import { test, expect } from "@playwright/test";
import { _electron as electron } from "playwright-core";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const weightsOnDisk = existsSync(path.join(root, "models", "Bonsai-4B-gguf", "Bonsai-4B.gguf"));

async function launch(extraConfig = {}) {
  const profile = mkdtempSync(path.join(os.tmpdir(), "openmonkey-composer-"));
  writeFileSync(
    path.join(profile, "openmonkey-config.json"),
    JSON.stringify({ onboarding: { completed: true }, model: { provider: "bonsai" }, ...extraConfig })
  );
  const app = await electron.launch({
    args: [root],
    env: { ...process.env, OPENMONKEY_USER_DATA: profile, OPENMONKEY_DEBUG_PORT: "" },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.setViewportSize({ width: 1280, height: 1000 });
  return { app, page, profile };
}

async function close(app, profile) {
  try {
    await app.evaluate(({ app: electronApp }) => electronApp.quit());
  } catch {
    /* already closed */
  }
  rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

/** Waits for the composer to be live: the model has to be loaded first. */
async function readyComposer(page) {
  const composer = page.getByRole("textbox", { name: "Message OpenMonkey" });
  await composer.waitFor();
  await expect(composer).toBeEnabled({ timeout: 120_000 });
  return composer;
}

/** Waits until the model has answered and the composer is free again. */
async function waitForReply(page) {
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible({ timeout: 120_000 });
}

/**
 * The setting that decides which key sends. It lives in the settings page, so it
 * is checked without a model behind it: the value is read back from the config
 * the app wrote.
 */
test("the send key is a setting, and it is written down", async () => {
  test.setTimeout(120_000);
  const { app, page, profile } = await launch();

  try {
    await page.getByRole("textbox", { name: "Message OpenMonkey" }).waitFor();
    await page.getByRole("button", { name: "Settings", exact: true }).first().click();
    await page.getByRole("navigation").first().getByRole("button", { name: "Appearance", exact: true }).click();

    const row = page.getByText("Send key", { exact: true });
    await expect(row).toBeVisible();
    const segmented = row.locator("xpath=ancestor::div[contains(@class,'row')]").getByRole("button");

    await segmented.filter({ hasText: "Cmd+Enter" }).click();
    await expect
      .poll(() => JSON.parse(readFileSync(path.join(profile, "openmonkey-config.json"), "utf8")).ui?.sendKey)
      .toBe("cmd-enter");

    // And back to the default, so the app is left as it was found.
    await segmented.filter({ hasText: /^Enter$/ }).click();
    await expect
      .poll(() => JSON.parse(readFileSync(path.join(profile, "openmonkey-config.json"), "utf8")).ui?.sendKey)
      .toBe("enter");
  } finally {
    await close(app, profile);
  }
});

/**
 * The composer itself: the slash commands it answers, the files it mentions and
 * the key that sends. These need the local model, because the composer is only
 * live while the model is.
 */
test.describe("the composer", () => {
  test.skip(!weightsOnDisk, "no Bonsai GGUF on disk to load");

  test("it offers the slash commands, the file mentions and the attached files", async () => {
    test.setTimeout(180_000);
    const { app, page, profile } = await launch();

    try {
      const composer = await readyComposer(page);

      // A slash command is offered before it is typed in full.
      await composer.type("/");
      await expect(page.getByRole("button", { name: "/clear" })).toBeVisible();
      await expect(page.getByRole("button", { name: "/summarize" })).toBeVisible();
      await expect(page.getByRole("button", { name: "/help" })).toBeVisible();

      // /help explains itself without troubling the model.
      await composer.fill("/help");
      await composer.press("Enter");
      await expect(page.getByText("Type /clear to empty this chat")).toBeVisible();

      // A file mention lists the files of the folders the app may read.
      const note = path.join(os.homedir(), "Documents", "openmonkey-mention.txt");
      writeFileSync(note, "mention body");
      try {
        await composer.fill("");
        await composer.type("@openmonkey-mention");
        const mention = page.getByRole("button", { name: /openmonkey-mention\.txt/ });
        await expect(mention).toBeVisible({ timeout: 30_000 });
        await mention.click();
        await expect(composer).toHaveValue("@openmonkey-mention.txt ");
        // The file rides along with the message.
        await expect(page.getByText("openmonkey-mention.txt").first()).toBeVisible();
      } finally {
        rmSync(note, { force: true });
      }
    } finally {
      await close(app, profile);
    }
  });

  test("Enter sends by default, and Cmd+Enter sends too", async () => {
    test.setTimeout(180_000);
    const { app, page, profile } = await launch();

    try {
      const composer = await readyComposer(page);
      const asked = (text) => page.locator(".message-user").filter({ hasText: text });

      // The default sends on Enter: the question reaches the chat.
      await composer.fill("first question");
      await composer.press("Enter");
      await expect(asked("first question")).toBeVisible();
      await expect(composer).toHaveValue("");
      await waitForReply(page);

      // Cmd+Enter sends as well, even where Enter only adds a line.
      await composer.fill("second question");
      await composer.press("Meta+Enter");
      await expect(asked("second question")).toBeVisible();
      await expect(composer).toHaveValue("");
    } finally {
      await close(app, profile);
    }
  });

  test("with Cmd+Enter chosen, Enter only breaks the line", async () => {
    test.setTimeout(180_000);
    const { app, page, profile } = await launch({ ui: { sendKey: "cmd-enter" } });

    try {
      const composer = await readyComposer(page);
      const asked = (text) => page.locator(".message-user").filter({ hasText: text });

      // Enter adds a line instead of sending.
      await composer.fill("third question");
      await composer.press("Enter");
      await expect(composer).toHaveValue("third question\n");
      await expect(asked("third question")).toHaveCount(0);

      // Cmd+Enter sends it.
      await composer.press("Meta+Enter");
      await expect(asked("third question")).toBeVisible();
      await expect(composer).toHaveValue("");
    } finally {
      await close(app, profile);
    }
  });
});
