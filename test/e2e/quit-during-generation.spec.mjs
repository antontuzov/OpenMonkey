import { test, expect } from "@playwright/test";
import { quitApp } from "./helpers.mjs";
import { _electron as electron } from "playwright-core";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const weightsOnDisk = existsSync(path.join(root, "models", "Bonsai-4B-gguf", "Bonsai-4B.gguf"));

/**
 * Quitting is where the app used to abort: node-llama-cpp runs its work on a libuv
 * thread pool, and if a worker is still outstanding when Node frees the environment,
 * the addon throws into a dead JS context and the process dies with SIGABRT. So the
 * test starts a real generation, quits while tokens are still arriving, and demands
 * a clean exit code.
 */
test("quitting while the model is still answering exits cleanly", async () => {
  test.skip(!weightsOnDisk, "no Bonsai GGUF on disk to generate with");
  test.setTimeout(150_000);

  const profile = mkdtempSync(path.join(os.tmpdir(), "openmonkey-quit-"));
  writeFileSync(
    path.join(profile, "openmonkey-config.json"),
    JSON.stringify({ onboarding: { completed: true }, model: { provider: "bonsai" } })
  );

  const app = await electron.launch({
    args: [root],
    timeout: 120_000,
    env: { ...process.env, OPENMONKEY_USER_DATA: profile, OPENMONKEY_DEBUG_PORT: "" },
  });

  try {
    const page = await app.firstWindow({ timeout: 120_000 });
    await page.waitForLoadState("domcontentloaded");

    // The weights are only warm once the load worker has finished, so anything still
    // outstanding after this point is the generation itself.
    await expect
      .poll(
        async () => {
          const status = await page.evaluate(() => window.electron.getModelStatus());
          return `${status.provider}:${status.warmedUp}`;
        },
        { timeout: 120_000 }
      )
      .toBe("bonsai:true");

    await page.evaluate(() => {
      window.tokenEvents = 0;
      window.electron.onChatEvent((event) => {
        if (event.type === "token") window.tokenEvents += 1;
      });
    });
    const created = await page.evaluate(() => window.electron.createConversation());
    await page.evaluate(
      (id) => {
        window.electron.processMessage(id, "Count out loud from one to sixty, one number per line.");
      },
      created.id
    );

    await expect
      .poll(() => page.evaluate(() => window.tokenEvents), { timeout: 60_000 })
      .toBeGreaterThan(3);

    let exit = null;
    const exited = new Promise((resolve) => {
      app.process().once("exit", (code, signal) => resolve({ code, signal }));
    });
    await app.evaluate(({ app: electronApp }) => electronApp.quit());
    exit = await exited;

    expect(exit?.signal, `app died with ${exit?.signal}; model teardown aborted the process`).toBeNull();
    expect(exit?.code, "the app must exit with 0, not an error code").toBe(0);
  } finally {
    await quitApp(app, profile);
    try {
      await app.close();
    } catch {
      /* already exited */
    }
  }
});
