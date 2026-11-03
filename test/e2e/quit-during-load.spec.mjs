import { test, expect } from "@playwright/test";
import { quitApp } from "./helpers.mjs";
import { _electron as electron } from "playwright-core";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Quitting mid-load used to free the Node environment under llama.cpp's load worker.
 * The addon completed that worker into a dead JS context and the process aborted, so a
 * first-run user who closed the app while the 572 MB downloaded model was loading got a
 * crash report. The exit has to come back clean, with the shutdown log written.
 */
test("quitting while the weights load exits clean", async () => {
  test.setTimeout(120_000);
  const profile = mkdtempSync(path.join(os.tmpdir(), "openmonkey-quit-load-"));
  const logFile = path.join(profile, "logs", "openmonkey.log");
  const app = await electron.launch({
    args: [root],
    timeout: 120_000,
    env: { ...process.env, OPENMONKEY_USER_DATA: profile, OPENMONKEY_DEBUG_PORT: "" },
  });

  try {
    await app.firstWindow({ timeout: 120_000 });
    const log = () => (existsSync(logFile) ? readFileSync(logFile, "utf8") : "");

    for (let i = 0; i < 300 && !log().includes("gguf.load.start"); i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const started = log().includes("gguf.load.start");
    expect(started, "the model never started loading, so the quit would prove nothing").toBe(true);

    const exited = new Promise((resolve) =>
      app.process().once("exit", (code, signal) => resolve({ code, signal }))
    );
    await app.evaluate(({ app: electronApp }) => electronApp.quit());

    const outcome = await Promise.race([
      exited,
      new Promise((resolve) => setTimeout(() => resolve({ code: "still-running", signal: null }), 60_000)),
    ]);
    expect(outcome, "the app did not leave the load worker alone").toEqual({ code: 0, signal: null });
    expect(log()).toContain("window.closed");
  } finally {
    await quitApp(app, profile);
  }
});
