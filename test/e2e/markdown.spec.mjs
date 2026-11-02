import { test, expect } from "@playwright/test";
import { _electron as electron } from "playwright-core";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ANSWER, seedMarkdownThread } from "../fixtures/markdown-answer.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * A model's answer is markdown, so the chat has to render it rather than print it.
 * The thread comes from the shared fixture, which keeps the test about the renderer:
 * no model, no tokens, the exact text on screen every time.
 */
test("a markdown answer renders as headings, lists, a table, highlighted code and a diff", async () => {
  test.setTimeout(120_000);

  const profile = mkdtempSync(path.join(os.tmpdir(), "openmonkey-md-"));
  writeFileSync(
    path.join(profile, "openmonkey-config.json"),
    JSON.stringify({ onboarding: { completed: true }, model: { provider: "bonsai" } })
  );

  const app = await electron.launch({
    args: [root],
    env: { ...process.env, OPENMONKEY_USER_DATA: profile, OPENMONKEY_DEBUG_PORT: "" },
  });

  try {
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    // Tall enough that the whole answer fits without the sticky header overlapping it.
    await page.setViewportSize({ width: 1280, height: 1200 });
    await page.getByRole("textbox", { name: "Message OpenMonkey" }).waitFor();

    const dbFile = path.join(profile, "data", "openmonkey.db");
    await expect.poll(() => existsSync(dbFile)).toBe(true);
    seedMarkdownThread(dbFile);

    // The renderer reads its conversation list at start-up, so it reloads to see the row.
    await page.reload();
    await page.getByRole("textbox", { name: "Message OpenMonkey" }).waitFor();
    await page.getByRole("button", { name: /Markdown probe/ }).click();

    const bubble = page.locator(".message-assistant").last();
    await expect(bubble.getByRole("heading", { level: 1, name: "Release plan" })).toBeVisible();
    await expect(bubble.getByRole("heading", { level: 2, name: "Steps" })).toBeVisible();

    // Emphasis, inline code and a link that opens outside the app.
    await expect(bubble.locator("strong", { hasText: "blocks" })).toBeVisible();
    await expect(bubble.locator("em", { hasText: "list" })).toBeVisible();
    await expect(bubble.locator("p code", { hasText: "inline code" })).toBeVisible();
    await expect(bubble.getByRole("button", { name: "link" })).toHaveAttribute(
      "title",
      "https://example.com/docs"
    );

    // Numbered items, the nested run, and a task list that reads as checked or open.
    await expect(bubble.getByRole("listitem").filter({ hasText: "Freeze the branch" })).toBeVisible();
    await expect(bubble.getByRole("listitem").filter({ hasText: /^Notarise it$/ })).toBeVisible();
    await expect(bubble.getByRole("img", { name: "Done", exact: true })).toBeVisible();
    await expect(bubble.getByRole("img", { name: "Not done", exact: true })).toBeVisible();

    await expect(bubble.locator("blockquote", { hasText: "Ask design before the icon changes." })).toBeVisible();

    // The table keeps its header and the alignment the delimiter asked for.
    await expect(bubble.getByRole("columnheader").filter({ hasText: "Status" })).toHaveCSS(
      "text-align",
      "right"
    );
    await expect(bubble.getByRole("cell").filter({ hasText: "wip" })).toHaveCSS("text-align", "right");

    // Fenced code: a copy button per fence, and a tokenizer that coloured the line.
    await expect(bubble.getByRole("button", { name: "Copy code" })).toHaveCount(2);
    await expect(bubble.locator(".tok-comment", { hasText: "// counts the plan" })).toBeVisible();
    await expect(bubble.locator(".tok-keyword", { hasText: "const" }).first()).toBeVisible();
    await expect(bubble.locator(".tok-type", { hasText: "boolean" })).toBeVisible();
    await expect(bubble.locator(".tok-func", { hasText: "reduce" })).toBeVisible();
    await expect(bubble.locator(".tok-number", { hasText: "0" })).toBeVisible();
    await expect(bubble.locator("code", { hasText: "row.blocks" }).first()).toBeVisible();

    // The diff fence becomes a diff, not highlighted TypeScript.
    await expect(bubble.getByText("diff", { exact: true })).toBeVisible();
    await expect(bubble.locator(".diff-add")).toHaveCount(2);
    await expect(bubble.locator(".diff-del")).toHaveCount(2);
    await expect(bubble.locator(".diff-hunk")).toHaveCount(1);

    // Nothing leaks the raw markup of the structures the renderer turned into elements.
    await expect(bubble.getByText("# Release plan", { exact: true })).toHaveCount(0);
    await expect(bubble.getByText("```ts", { exact: true })).toHaveCount(0);
    await expect(bubble.getByText("[link](", { exact: false })).toHaveCount(0);

    await expect(bubble).toHaveScreenshot("chat-markdown.png");

    // Copying a fence is the last step that has to work, and it writes for real:
    // the label only changes if the clipboard call resolved.
    await bubble.getByRole("button", { name: "Copy code" }).first().click();
    await expect(bubble.getByText("Copied", { exact: true })).toBeVisible();
  } finally {
    try {
      await app.evaluate(({ app: electronApp }) => electronApp.quit());
    } catch {
      /* already closed */
    }
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
