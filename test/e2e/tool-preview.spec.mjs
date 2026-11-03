import { test, expect } from "@playwright/test";
import { quitApp } from "./helpers.mjs";
import { _electron as electron } from "playwright-core";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const weightsOnDisk = existsSync(path.join(root, "models", "Bonsai-4B-gguf", "Bonsai-4B.gguf"));
const documents = path.join(os.homedir(), "Documents");

async function launch(extraConfig = {}) {
  const profile = mkdtempSync(path.join(os.tmpdir(), "openmonkey-preview-"));
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

/**
 * The call comes from a live model turn, because that is the only way the app
 * reaches a tool. The 4B model sometimes describes the call instead of running
 * it, so a turn that never reaches the dialog is asked again, like a user would.
 */
async function runTask(page, prompt, waitFor) {
  const composer = page.locator("textarea").first();
  await expect(composer).toBeEnabled({ timeout: 180_000 });
  const generating = page.getByRole("button", { name: /generating|генерацию/i });
  for (let attempt = 1; attempt <= 5; attempt++) {
    await composer.fill(prompt);
    await composer.press("Enter");
    try {
      await waitFor();
      return;
    } catch (error) {
      console.log(`turn ${attempt} did not reach the approval; the rail said: ${await page.locator(".motion-panel .card").first().innerText().catch(() => "no rail")}`);
      await expect(generating).toBeHidden({ timeout: 120_000 });
      if (attempt === 5) throw new Error(`five turns produced no approval: ${error.message}`);
    }
  }
}

const callPrompt = (call) => `Run exactly this one tool call and no other: \`\`\`task\n${JSON.stringify(call)}\n\`\`\``;

const approvalDialog = (page) => page.getByRole("dialog").filter({ hasText: "Action needs approval" });

test.describe("the approval preview", () => {
  test.skip(!weightsOnDisk, "no Bonsai GGUF on disk to load");

  test("a command says what it does and what it could cost", async () => {
    test.setTimeout(420_000);
    const note = path.join(documents, "openmonkey-preview-note.txt");
    writeFileSync(note, "hello\n", "utf8");
    const { app, page, profile } = await launch();

    try {
      const dialog = approvalDialog(page);
      await runTask(
        page,
        callPrompt({
          type: "shell",
          action: "run_command",
          arguments: { command: `chmod 777 ${note}` },
          summary: "Make the note readable by everyone",
        }),
        () => expect(dialog).toBeVisible({ timeout: 60_000 })
      );

      // The card names the command, the folder it runs in and what it means.
      await expect(dialog.getByText("Run a shell command")).toBeVisible();
      await expect(dialog.locator("pre").first()).toContainText("chmod 777");
      await expect(dialog.getByText(/changes who may use a file/)).toBeVisible();

      // And it says what the command could cost, in words rather than a rule name.
      await expect(dialog.getByText(/readable and writable by everyone/)).toBeVisible();

      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    } finally {
      rmSync(note, { force: true });
      await quitApp(app, profile);
    }
  });

  test("a write shows the lines it replaces", async () => {
    test.setTimeout(420_000);
    const note = path.join(documents, "openmonkey-preview-write.txt");
    writeFileSync(note, "the release ships on Friday\nthe model check runs first\n", "utf8");
    const { app, page, profile } = await launch();

    try {
      const dialog = approvalDialog(page);
      await runTask(
        page,
        callPrompt({
          type: "file",
          action: "write_file",
          arguments: { path: note, content: "the release slipped to Monday\nthe model check runs first\n" },
          summary: "Move the release to Monday",
        }),
        () => expect(dialog).toBeVisible({ timeout: 60_000 })
      );

      // The diff is the point of the card: one line out, one line in.
      await expect(dialog.getByText("+1 / −1")).toBeVisible();
      await expect(dialog.getByText(/the release ships on Friday/)).toBeVisible();
      await expect(dialog.getByText(/the release slipped to Monday/)).toBeVisible();

      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    } finally {
      rmSync(note, { force: true });
      await quitApp(app, profile);
    }
  });
});
