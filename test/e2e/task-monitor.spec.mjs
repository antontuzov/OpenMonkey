import { test, expect } from "@playwright/test";
import { quitApp } from "./helpers.mjs";
import { _electron as electron } from "playwright-core";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const weightsOnDisk = existsSync(path.join(root, "models", "Bonsai-4B-gguf", "Bonsai-4B.gguf"));

async function launch(extraConfig = {}) {
  const profile = mkdtempSync(path.join(os.tmpdir(), "openmonkey-monitor-"));
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

/**
 * The rail is only worth testing with work the agent really did, so the task comes
 * from a live model turn rather than from a seeded row. The 4B model writes its own
 * tool calls when asked in prose and drifts into five calls at a time, so the turn
 * hands it the block to run - and a model that only describes the call is asked
 * again, because this suite is about the rail and not about the weights.
 */
async function runWrite(page, prompt, waitFor) {
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
      // A turn that never reaches the rail is worth a line in the log: the model
      // described the call instead of running it, so ask again like a user would.
      const rail = await page.locator(".motion-panel .card").first().innerText().catch(() => "no rail");
      console.log(`turn ${attempt} did not reach the rail; the rail said: ${rail.replace(/\s+/g, " ")}`);
      await expect(generating).toBeHidden({ timeout: 120_000 });
      if (attempt === 5) throw new Error(`five turns produced no task for the rail: ${error.message}`);
    }
  }
}

const writePrompt = (file, summary) => {
  const call = JSON.stringify({
    type: "file",
    action: "write_file",
    arguments: { path: file, content: "alpha\nbeta\n" },
    summary,
  });
  return `Run exactly this one tool call and no other: \`\`\`task\n${call}\n\`\`\``;
};

/**
 * The rail row of the write. The model echoes the summary when it feels like it and
 * drops it otherwise, which leaves the action name on the row, so either counts.
 */
const taskRow = (page, summary) =>
  page
    .locator("[data-task-row]")
    .filter({ hasText: new RegExp(`${summary}|file\\.write_file`) })
    .first();

/** A duration as the rail prints it: "8ms", "1.5s", "1m 05s". */
const duration = /\d+(\.\d+)?(ms|s|m)/;

const cleanup = (file) => rmSync(file, { force: true, recursive: true });

test.describe("the task monitor", () => {
  test.skip(!weightsOnDisk, "no Bonsai GGUF on disk to load");

  test("it times each stage of a write and shows the lines it changed", async () => {
    test.setTimeout(420_000);
    const note = path.join(os.homedir(), "Documents", "openmonkey-monitor.txt");
    cleanup(note);
    const { app, page, profile } = await launch({ agent: { approvalPolicies: { file: "allow" } } });

    try {
      await runWrite(page, writePrompt(note, "Write the note"), () =>
        expect(
          taskRow(page, "Write the note").locator(".chip").filter({ hasText: "done" })
        ).toBeVisible({ timeout: 60_000 })
      );
      const row = taskRow(page, "Write the note");

      // Every stage the task walked through, each with the time it took.
      const stages = row.locator("[data-task-steps] .chip");
      await expect(stages).toHaveCount(2);
      await expect(stages.nth(0)).toContainText("queued");
      await expect(stages.nth(1)).toContainText("running");
      for (const stage of await stages.all()) expect(await stage.innerText()).toMatch(duration);

      // The whole task is timed too, so the glance and the detail agree.
      expect(await row.locator("[data-task-total]").innerText()).toMatch(duration);

      // The write says what it changed, and opening it shows the lines themselves.
      await row.getByRole("button", { name: /Change \(\+2 \/ −0\)/ }).click();
      const diff = row.locator("[data-task-diff]");
      await expect(diff).toBeVisible();
      await expect(diff.locator(".diff-add")).toHaveCount(2);
      await expect(diff.locator(".diff-del")).toHaveCount(0);
      expect(await diff.locator(".diff-add").nth(0).innerText()).toContain("alpha");
      expect(await diff.locator(".diff-add").nth(1).innerText()).toContain("beta");
      expect(await diff.locator(".font-mono").first().innerText()).toContain("openmonkey-monitor.txt");

      // Copy puts the change on the clipboard, and says so.
      await row.getByRole("button", { name: /^Copy/ }).click();
      await expect(row.getByText("Copied")).toBeVisible();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
        "openmonkey-monitor.txt"
      );

      // What the rail reported is what the tool actually left behind.
      expect(readFileSync(note, "utf8")).toBe("alpha\nbeta\n");
    } finally {
      cleanup(note);
      await close(app, profile);
    }
  });

  test("a denied write keeps its approval stage on the rail and can be retried", async () => {
    test.setTimeout(420_000);
    const note = path.join(os.homedir(), "Documents", "openmonkey-monitor-deny.txt");
    cleanup(note);
    const { app, page, profile } = await launch();

    try {
      // The approval is keyboard-first: Escape is the denial, no mouse involved.
      const dialog = page.getByRole("dialog").filter({ hasText: "Action needs approval" });
      await runWrite(page, writePrompt(note, "Write the note"), () =>
        expect(dialog).toBeVisible({ timeout: 60_000 })
      );
      const row = taskRow(page, "Write the note");
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();

      await expect(row.locator(".chip").filter({ hasText: "denied" })).toBeVisible({ timeout: 180_000 });

      // The wait for the decision is a stage of its own, timed like every other one.
      const stages = row.locator("[data-task-steps] .chip");
      await expect(stages).toHaveCount(2);
      await expect(stages.nth(1)).toContainText("approval");

      // Retrying runs the same request again, which means the approval is asked for again.
      await row.getByRole("button", { name: /again/ }).click();
      await expect(dialog).toBeVisible({ timeout: 180_000 });
      await page.keyboard.press("Escape");

      expect(existsSync(note)).toBe(false);
    } finally {
      cleanup(note);
      await close(app, profile);
    }
  });

  test("the rail reads in Russian too", async () => {
    test.setTimeout(420_000);
    const note = path.join(os.homedir(), "Documents", "openmonkey-monitor-ru.txt");
    cleanup(note);
    const { app, page, profile } = await launch({
      ui: { language: "ru" },
      agent: { approvalPolicies: { file: "allow" } },
    });

    try {
      await runWrite(page, writePrompt(note, "Write the note"), () =>
        expect(
          taskRow(page, "Write the note").locator(".chip").filter({ hasText: "готово" })
        ).toBeVisible({ timeout: 60_000 })
      );
      const row = taskRow(page, "Write the note");
      await expect(row.getByRole("button", { name: /Изменение \(\+2 \/ −0\)/ })).toBeVisible();
      await expect(row.locator("[data-task-steps] .chip").nth(0)).toContainText("в очереди");
      await expect(row.getByRole("button", { name: /Скопировать/ })).toBeVisible();

      await row.getByRole("button", { name: /Изменение \(\+2 \/ −0\)/ }).click();
      await expect(row.locator("[data-task-diff] .diff-add")).toHaveCount(2);
    } finally {
      cleanup(note);
      await close(app, profile);
    }
  });
});
