import { _electron as electron } from "playwright-core";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { seedMarkdownThread } from "../test/fixtures/markdown-answer.mjs";
import { seedMessageThread } from "../test/fixtures/message-actions.mjs";
import { seedMemoryChat } from "../test/fixtures/memory-browser.mjs";

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

  // The activity rail: the stages a task walked through, each with the time it
  // took, and the lines a file write changed. The task comes from a live turn, so
  // the numbers on screen are the numbers the agent really spent.
  if (existsSync(modelPath) && (await waitForReady()) === "ready") {
    const railNote = path.join(os.homedir(), "Documents", "openmonkey-rail-note.txt");
    rmSync(railNote, { force: true, recursive: true });
    try {
      await page.evaluate(() => window.electron.setConfig({ agent: { approvalPolicies: { file: "allow" } } }));
      const call = JSON.stringify({
        type: "file",
        action: "write_file",
        arguments: { path: railNote, content: "alpha\nbeta\n" },
        summary: "Write the note",
      });
      const composer = page.getByRole("textbox", { name: "Message OpenMonkey" });
      await composer.fill(`Run exactly this one tool call and no other: \`\`\`task\n${call}\n\`\`\``);
      await composer.press("Enter");
      const railRow = page
        .locator("[data-task-row]")
        .filter({ hasText: /Write the note|file\.write_file/ })
        .first();
      await railRow.locator(".chip").filter({ hasText: "done" }).waitFor({ timeout: 120_000 });
      await railRow.getByRole("button", { name: /Change \(\+2 \/ −0\)/ }).click();
      await page.waitForTimeout(400);
      await page.locator(".motion-panel").screenshot({ path: path.join(outDir, "task-monitor.png") });
    } catch (error) {
      console.warn("task-monitor.png skipped:", error.message);
    } finally {
      rmSync(railNote, { force: true, recursive: true });
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

  // The palette: one box for the chats, the settings and the commands. It opens
  // with Cmd+K and is driven from the keyboard alone.
  await page.keyboard.press("Meta+k");
  const paletteBox = page.getByRole("combobox");
  await paletteBox.waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outDir, "command-palette.png") });
  await paletteBox.fill("answer");
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(outDir, "command-palette-search.png") });
  await page.keyboard.press("Escape");

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

  // The memory browser: the facts the model may use and the chats it may recall,
  // each one editable in place. The chat is seeded, so the browser shows both
  // kinds of memory without a model in the loop.
  if (existsSync(dbFile)) {
    seedMemoryChat(dbFile, { answer: "We ship on Friday; the model check runs first." });
    await page.setViewportSize({ width: 1440, height: 980 });
    await page.getByRole("button", { name: "Memory", exact: true }).click();
    await page.getByLabel("Pin a fact").waitFor();

    await page.getByLabel("Pin a fact").fill("The staging host is called fox");
    await page.getByRole("button", { name: "Add fact" }).click();
    await page.getByRole("button", { name: "The staging host is called fox" }).waitFor();

    await page.getByRole("button", { name: "Release checklist" }).click();
    await page.getByLabel("Your summary").waitFor();
    await page.getByLabel("Your summary").fill("We ship on Friday; the model check runs first.");
    await page.getByRole("button", { name: "Save summary" }).click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(outDir, "settings-memory.png") });
    await page.setViewportSize({ width: 1280, height: 820 });
  } else {
    console.warn("no database at", dbFile, "— settings-memory.png is skipped");
  }
} finally {
  await app.evaluate(({ app }) => app.quit()).catch(() => undefined);
  rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

// The source manager: the files the index holds, the passages it cut from them
// and the rules that keep other files out. It runs in its own throwaway home so
// the shot shows the fixture folder and nothing of the reader's own files.
{
  const home = mkdtempSync(path.join(os.tmpdir(), "openmonkey-docs-home-"));
  const notes = path.join(home, "Documents", "notes");
  mkdirSync(notes, { recursive: true });
  writeFileSync(
    path.join(notes, "release-plan.md"),
    "# Release plan\n\nWe ship on Friday.\n\nThe model check runs first.\n"
  );
  writeFileSync(
    path.join(notes, "checklist.md"),
    "# Checklist\n\n- The digest is verified\n- The first answer is on screen\n"
  );
  writeFileSync(path.join(notes, "server.log"), "the server started\nthe server stopped\n");

  const sourceProfile = mkdtempSync(path.join(os.tmpdir(), "openmonkey-docs-sources-"));
  writeFileSync(
    path.join(sourceProfile, "openmonkey-config.json"),
    JSON.stringify({
      onboarding: { completed: true },
      model: { provider: "bonsai" },
      memory: { enabled: true, workspaceSearch: true, workspaceIgnore: ["*.log"] },
      agent: { workspaceRoots: [notes] },
    })
  );

  const sourceApp = await electron.launch({
    args: [root],
    env: { ...process.env, HOME: home, OPENMONKEY_USER_DATA: sourceProfile, OPENMONKEY_DEBUG_PORT: "" },
  });
  try {
    const page = await sourceApp.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await page.setViewportSize({ width: 1440, height: 980 });
    await page.getByRole("textbox", { name: "Message OpenMonkey" }).waitFor();
    await page.getByRole("button", { name: "Settings", exact: true }).first().click();
    await page.getByRole("navigation").first().waitFor();
    await page.getByRole("button", { name: "Memory", exact: true }).click();
    await page.getByLabel("Search memory").waitFor();

    await page.getByRole("button", { name: "Rebuild" }).click();
    await page.getByRole("button", { name: /^release-plan\.md/ }).waitFor();
    await page.getByRole("button", { name: /^release-plan\.md/ }).click();
    await page.getByText(/^lines 1/).waitFor();
    await page.waitForTimeout(500);

    const sources = page.locator("section", { hasText: "Indexed sources" }).first();
    await sources.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await sources.screenshot({ path: path.join(outDir, "settings-sources.png") });
  } finally {
    await sourceApp.evaluate(({ app }) => app.quit()).catch(() => undefined);
    rmSync(sourceProfile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

// The first run now ends with a reply, and it only happens once per profile, so this
// shot is taken in its own throwaway profile after every other capture has skipped it.
if (existsSync(modelPath)) {
  const firstRunProfile = mkdtempSync(path.join(os.tmpdir(), "openmonkey-docs-first-run-"));
  const firstRun = await electron.launch({
    args: [root],
    env: { ...process.env, OPENMONKEY_USER_DATA: firstRunProfile, OPENMONKEY_DEBUG_PORT: "" },
  });
  try {
    const page = await firstRun.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole("button", { name: "Get started" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByText("Give it a brain.").waitFor();
    await page.locator("[data-onboarding-probe]").waitFor({ timeout: 180_000 });
    await page.getByRole("button", { name: "Ask it" }).click();
    await page.locator("[data-onboarding-answer]").waitFor({ timeout: 180_000 });
    await page.getByRole("button", { name: "Open your first chat" }).waitFor({ timeout: 60_000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(outDir, "onboarding-model.png") });
  } catch (error) {
    console.warn("onboarding-model.png skipped:", error.message);
  } finally {
    await firstRun.evaluate(({ app }) => app.quit()).catch(() => undefined);
    rmSync(firstRunProfile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
