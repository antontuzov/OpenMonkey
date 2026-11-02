import { _electron as electron } from "playwright-core";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { seedMarkdownThread } from "../test/fixtures/markdown-answer.mjs";
import { seedMessageThread } from "../test/fixtures/message-actions.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "docs", "screenshots");
mkdirSync(outDir, { recursive: true });

const modelPath = path.join(root, "models", "Bonsai-4B-gguf", "Bonsai-4B.gguf");
const profile = mkdtempSync(path.join(os.tmpdir(), "openmonkey-docs-"));
const app = await electron.launch({
  args: [root],
  env: { ...process.env, OPENMONKEY_USER_DATA: profile, OPENMONKEY_DEBUG_PORT: "" },
});

try {
  const page = await app.firstWindow();
  const waitForReady = async () => {
    const deadline = Date.now() + 180_000;
    let state = "starting";
    while (Date.now() < deadline && state !== "ready" && state !== "error") {
      state = (await page.evaluate(() => window.electron.getAgentStatus())).state;
      if (state !== "ready") await page.waitForTimeout(300);
    }
    return state;
  };

  await page.waitForLoadState("domcontentloaded");
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.getByRole("button", { name: "Skip setup" }).waitFor();
  await page.screenshot({ path: path.join(outDir, "onboarding.png") });

  await page.getByRole("button", { name: "Skip setup" }).click();
  await page.getByRole("textbox", { name: "Message OpenMonkey" }).waitFor();

  if (existsSync(modelPath)) {
    const state = await waitForReady();
    if (state === "ready") {
      await page.getByRole("textbox", { name: "Message OpenMonkey" }).fill("Greet me in one sentence and say that you run locally. Do not use tools.");
      await page.getByRole("textbox", { name: "Message OpenMonkey" }).press("Enter");
      const replyDeadline = Date.now() + 180_000;
      while (Date.now() < replyDeadline) {
        const [conversation] = await page.evaluate(() => window.electron.getConversations());
        const messages = conversation
          ? await page.evaluate((id) => window.electron.getMessages(id), conversation.id)
          : [];
        if (messages.some((message) => message.role === "assistant" && message.content.trim())) break;
        await page.waitForTimeout(500);
      }
    } else {
      console.warn("model loaded with state:", state);
    }
  } else {
    console.warn("no model at", modelPath, "— chat.png shows the model error state");
  }
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outDir, "chat.png") });

  // The composer itself: a dropped file rides along with the message, @ offers
  // the files of the folders the app may read, and / offers the commands it
  // answers without troubling the model.
  if (existsSync(modelPath) && (await waitForReady()) === "ready") {
    const captureNote = path.join(os.homedir(), "Documents", "openmonkey-capture.txt");
    writeFileSync(captureNote, "a file the composer can attach\n");
    try {
      const composer = page.getByRole("textbox", { name: "Message OpenMonkey" });
      await composer.click();
      // A real drop: the file lands on the composer and the drop zone answers.
      await page.evaluate(() => {
        const file = new File(["a file the composer can attach\n"], "openmonkey-capture.txt", {
          type: "text/plain",
        });
        const transfer = new DataTransfer();
        transfer.items.add(file);
        const target = document.querySelector("[data-composer]");
        for (const type of ["dragenter", "dragover", "drop"]) {
          target.dispatchEvent(new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true }));
        }
      });
      await composer.fill("@openmonkey-capture");
      await page
        .locator("[data-composer] button")
        .filter({ hasText: "openmonkey-capture.txt" })
        .waitFor({ timeout: 30_000 });
      await page.waitForTimeout(400);
      await page.locator("[data-composer]").screenshot({ path: path.join(outDir, "chat-composer.png") });

      await composer.fill("/");
      await page.waitForTimeout(300);
      await page.locator("[data-composer]").screenshot({ path: path.join(outDir, "chat-composer-commands.png") });
      await composer.fill("");
    } finally {
      rmSync(captureNote, { force: true });
    }
  }

  // A seeded thread shows every markdown block the renderer knows; a live answer
  // from a 4B model could not be relied on to produce them all.
  const dbFile = path.join(profile, "data", "openmonkey.db");
  if (existsSync(dbFile)) {
    seedMarkdownThread(dbFile);
    await page.setViewportSize({ width: 1280, height: 1200 });
    await page.reload();
    await page.getByRole("textbox", { name: "Message OpenMonkey" }).waitFor();
    await page.getByRole("button", { name: /Markdown probe/ }).click();
    await page.locator(".message-assistant").last().waitFor();
    await page.waitForTimeout(400);
    await page
      .locator(".message-assistant")
      .last()
      .screenshot({ path: path.join(outDir, "chat-markdown.png") });
    await page.setViewportSize({ width: 1280, height: 820 });
  } else {
    console.warn("no database at", dbFile, "— chat-markdown.png is skipped");
  }

  // The actions around a reply: how long it took, how many tokens it used, and
  // the other answers to the same question.
  if (existsSync(dbFile)) {
    seedMessageThread(dbFile);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.reload();
    await page.getByRole("textbox", { name: "Message OpenMonkey" }).waitFor();
    await page.getByRole("button", { name: /Answer probe/ }).click();
    const turn = page.locator(".message-enter").last();
    await turn.locator(".message-assistant").waitFor();
    await turn.hover();
    await page.waitForTimeout(400);
    await turn.screenshot({ path: path.join(outDir, "chat-message-actions.png") });

    // Editing a question rewrites it in place, with the answer below it dropped.
    if ((await waitForReady()) === "ready") {
      const question = page.locator(".message-enter").first();
      await question.getByRole("button", { name: "Edit message" }).click();
      await question.locator("textarea").waitFor();
      await page.waitForTimeout(300);
      await question.screenshot({ path: path.join(outDir, "chat-edit-message.png") });
      await question.getByRole("button", { name: "Cancel" }).click();
    }
    await page.setViewportSize({ width: 1280, height: 820 });
  } else {
    console.warn("no database at", dbFile, "— chat-message-actions.png is skipped");
  }

  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.getByRole("navigation").first().waitFor();

  // The key that sends is a setting, so the composer can be driven by the key
  // the reader prefers.
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  const sendKey = page.getByText("Send key", { exact: true });
  await sendKey.waitFor();
  await sendKey.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outDir, "settings-send-key.png") });

  await page.getByRole("button", { name: "Privacy", exact: true }).click();
  await page.getByRole("heading", { name: "Privacy" }).waitFor();
  await page.screenshot({ path: path.join(outDir, "settings-privacy.png") });

  const search = page.getByRole("textbox", { name: "Search settings…" });
  await search.fill("bigger text");
  await page.getByText("Appearance", { exact: true }).first().waitFor();
  await page.screenshot({ path: path.join(outDir, "settings-search.png") });
  await search.fill("");

  await page.getByRole("button", { name: "Desktop", exact: true }).click();
  await page.getByText("Update channel", { exact: true }).waitFor();
  await page.screenshot({ path: path.join(outDir, "settings-desktop.png") });

  await page.getByRole("button", { name: "Model", exact: true }).click();
  await page.getByText(/of weights plus/).waitFor();
  const benchmarkButton = page.getByRole("button", { name: /Run benchmark|Measuring/ });
  if (existsSync(modelPath)) {
    await benchmarkButton.waitFor({ timeout: 180_000 });
    await benchmarkButton.click();
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      const status = await page.evaluate(() => window.electron.getModelStatus());
      if (status.lastBenchmark) {
        console.log(`measured ${status.lastBenchmark.tokensPerSecond.toFixed(1)} tokens/s`);
        break;
      }
      await page.waitForTimeout(500);
    }
  }
  await page.waitForTimeout(400);
  await page.evaluate(() => document.querySelector("main")?.scrollTo({ top: 0 }));
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outDir, "settings-model.png") });
  await page
    .locator("section", { hasText: "Generation speed" })
    .locator(".card")
    .screenshot({ path: path.join(outDir, "settings-model-benchmark.png") });
} finally {
  await app.evaluate(({ app }) => app.quit()).catch(() => undefined);
  rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
