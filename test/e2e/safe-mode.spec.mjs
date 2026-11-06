import { test, expect } from "@playwright/test";
import { _electron as electron } from "playwright-core";
import { quitApp } from "./helpers.mjs";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * A launch that cannot be bricked by its own config.
 *
 * Safe mode opens the app without the three things that can keep a launch from
 * finishing: the local model, the MCP servers and the update check. The page has
 * to say that in words, and the user has to be able to leave it from the page.
 */
test("a launch asked for safe mode comes up without the model, the servers and the update check", async () => {
  test.setTimeout(120_000);
  const profile = mkdtempSync(path.join(os.tmpdir(), "openmonkey-safe-mode-"));

  // The app is set up as it is after the first run, and with one MCP server
  // waiting to be started: a normal launch would try to reach it.
  writeFileSync(
    path.join(profile, "openmonkey-config.json"),
    JSON.stringify({
      onboarding: { completed: true },
      mcp: {
        servers: [
          {
            id: "probe",
            name: "Probe",
            command: "/nonexistent/openmonkey-safe-mode-probe",
            args: [],
            enabled: true,
            approval: "ask",
          },
        ],
      },
    }),
    "utf8"
  );

  const app = await electron.launch({
    args: [root],
    timeout: 120_000,
    env: {
      ...process.env,
      OPENMONKEY_USER_DATA: profile,
      OPENMONKEY_SAFE_MODE: "1",
      OPENMONKEY_DEBUG_PORT: "",
    },
  });

  try {
    const page = await app.firstWindow({ timeout: 120_000 });
    await page.waitForLoadState("domcontentloaded");

    // The banner names what is off and offers the way out.
    const banner = page.locator('[role="status"]').filter({ hasText: "Safe mode" });
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("the model was not loaded");
    await expect(banner).toContainText("the MCP servers did not start");
    await expect(banner).toContainText("no update check ran");
    await expect(page.getByRole("button", { name: "Restart normally" })).toBeVisible();

    // The model was not loaded, and the app says so instead of waiting for a token.
    await expect
      .poll(async () => (await page.evaluate(() => window.electron.getAgentStatus())).state)
      .toBe("error");
    const message = await page.evaluate(() => window.electron.getAgentStatus().then((s) => s.message));
    expect(message).toMatch(/safe mode/i);

    // The MCP server was never started: it is not even listed.
    const servers = await page.evaluate(() => window.electron.getMcpStatus());
    expect(servers, "a configured MCP server must not be started in safe mode").toHaveLength(0);

    // The app came up, so the next launch is an ordinary one.
    const marker = path.join(profile, "safe-mode.json");
    expect(existsSync(marker), "the app keeps no record of how this launch went").toBe(true);
    await expect
      .poll(() => {
        try {
          return JSON.parse(readFileSync(marker, "utf8"));
        } catch {
          return null;
        }
      })
      .toEqual({ crashes: 0, phase: "running" });
  } finally {
    await quitApp(app, profile);
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
