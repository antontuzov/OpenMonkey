import { test, expect } from "@playwright/test";
import { quitApp, weightsOnDisk } from "./helpers.mjs";
import { _electron as electron } from "playwright-core";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixture = path.join(root, "test", "fixtures", "mcp-server.mjs");
const node = process.execPath;

/**
 * The MCP servers are started by the agent, and the agent stops at the model when
 * the weights are missing. Without them there is no server to read health from, so
 * a runner that never downloaded 546 MB of weights skips the page rather than
 * failing it.
 */
test.skip(!weightsOnDisk, "the agent starts MCP servers only after the model loads");

async function launch(servers) {
  const profile = mkdtempSync(path.join(os.tmpdir(), "openmonkey-mcp-"));
  writeFileSync(
    path.join(profile, "openmonkey-config.json"),
    JSON.stringify({ onboarding: { completed: true }, model: { provider: "bonsai" }, mcp: { servers } })
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

async function openServers(page) {
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.getByRole("navigation").first().getByRole("button", { name: "MCP servers", exact: true }).click();
}

const rowFor = (page, name) => page.locator(".row").filter({ hasText: name }).first();

test("a running server shows its health, its output and a rule per tool", async () => {
  test.setTimeout(240_000);
  const { app, page, profile } = await launch([
    { id: "fixture", name: "Notes tools", command: node, args: [fixture], enabled: true, approval: "ask" },
  ]);

  try {
    await page.getByRole("textbox", { name: "Message OpenMonkey" }).waitFor();
    await openServers(page);

    const row = rowFor(page, "Notes tools");
    await expect(row.locator(".chip").filter({ hasText: "ready" })).toBeVisible();
    await expect(row.locator(".chip").filter({ hasText: "2 tools" })).toBeVisible();

    await row.getByRole("button", { name: "Show tools for Notes tools" }).click();
    // What the server printed is on the page, not only in a log file.
    await expect(page.getByText("fixture server ready on stdio")).toBeVisible();
    await expect(page.getByText("search_notes", { exact: true })).toBeVisible();
    await expect(page.getByText("write_note", { exact: true })).toBeVisible();

    // One tool is allowed while the server as a whole still asks.
    await page.getByRole("button", { name: "Allow write_note" }).click();
    await expect(page.getByRole("button", { name: "Allow write_note" })).toHaveClass(
      /segmented-active/
    );
    await expect(page.getByRole("button", { name: "Ask search_notes" })).toHaveClass(
      /segmented-active/
    );

    // The override is stored, and the reset control appears beside it.
    const stored = await page.evaluate(async () => {
      const config = await window.electron.getConfig();
      return config.mcp.servers[0].toolPolicies;
    });
    expect(stored).toEqual({ write_note: "allow" });

    await page.getByRole("button", { name: "Block search_notes" }).click();
    await expect(page.getByRole("button", { name: "Block search_notes" })).toHaveClass(
      /segmented-active/
    );
    await expect(page.getByRole("button", { name: "Let search_notes follow the server rule" })).toBeVisible();

    // Choosing the server's own answer drops the rule instead of duplicating it.
    await page.getByRole("button", { name: "Ask search_notes" }).click();
    await expect(
      page.getByRole("button", { name: "Let search_notes follow the server rule" })
    ).toHaveCount(0);

    // And what is stored survives a reload of the window.
    await page.reload();
    await page.getByRole("textbox", { name: "Message OpenMonkey" }).waitFor();
    await openServers(page);
    await rowFor(page, "Notes tools")
      .getByRole("button", { name: "Show tools for Notes tools" })
      .click();
    await expect(page.getByRole("button", { name: "Allow write_note" })).toHaveClass(/segmented-active/);
    await expect(page.getByRole("button", { name: "Let write_note follow the server rule" })).toBeVisible();
  } finally {
    await quitApp(app, profile);
  }
});

test("a server that will not start says so, and editing it puts it right", async () => {
  test.setTimeout(240_000);
  const { app, page, profile } = await launch([
    {
      id: "broken",
      name: "Broken server",
      command: "/usr/bin/false",
      args: ["nothing"],
      enabled: true,
      approval: "ask",
    },
  ]);

  try {
    await page.getByRole("textbox", { name: "Message OpenMonkey" }).waitFor();
    await openServers(page);

    const row = rowFor(page, "Broken server");
    await expect(row.locator(".chip").filter({ hasText: "error" })).toBeVisible({ timeout: 60_000 });

    await row.getByRole("button", { name: "Edit Broken server" }).click();
    const command = page.locator("label").filter({ hasText: "Command" }).locator("input");
    await expect(command).toHaveValue("/usr/bin/false");
    await command.fill(node);
    const args = page.locator("label").filter({ hasText: "Arguments" }).locator("input");
    await args.fill(fixture);
    const name = page.locator("label").filter({ hasText: "Display name" }).locator("input");
    await name.fill("Notes tools");
    await page.getByRole("button", { name: "Save and restart" }).click();

    // The saved row is the edited one, and it comes back on its own.
    await expect(rowFor(page, "Notes tools").locator(".chip").filter({ hasText: "ready" })).toBeVisible({
      timeout: 60_000,
    });
    await expect(rowFor(page, "Notes tools").locator(".chip").filter({ hasText: "2 tools" })).toBeVisible();
    await expect(page.locator(".row").filter({ hasText: "Broken server" })).toHaveCount(0);
  } finally {
    await quitApp(app, profile);
  }
});
