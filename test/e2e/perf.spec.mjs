import { test, expect } from "@playwright/test";
import { onCiRunner, quitApp } from "./helpers.mjs";
import { _electron as electron } from "playwright-core";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const COLD_START_BUDGET_MS = 2500;
const IDLE_MEMORY_CEILING_MB = 900;

test.describe.configure({ mode: "serial" });

let app;
let page;
let profile;
let launchedAt = 0;
let firstSurfaceMs = 0;
const scriptRequests = [];

test.beforeAll(async () => {
  profile = mkdtempSync(path.join(os.tmpdir(), "openmonkey-perf-"));
  launchedAt = performance.now();
  app = await electron.launch({
    args: [root],
    timeout: 120_000,
    env: { ...process.env, OPENMONKEY_USER_DATA: profile, OPENMONKEY_DEBUG_PORT: "" },
  });
  page = await app.firstWindow({ timeout: 120_000 });
  page.on("request", (request) => {
    if (request.resourceType() === "script") scriptRequests.push({ url: request.url(), at: performance.now() - launchedAt });
  });
  await page.waitForLoadState("domcontentloaded");
  await expect(page.getByRole("button", { name: "Skip setup" })).toBeVisible();
  firstSurfaceMs = Math.round(performance.now() - launchedAt);
});

test.afterAll(async () => {
  await quitApp(app, profile);
});

test("cold start reaches its first surface inside the budget", async () => {
  console.log(`launch → first surface: ${firstSurfaceMs} ms`);
  expect(firstSurfaceMs).toBeLessThan(COLD_START_BUDGET_MS);
});

test("shell memory stays under the ceiling before a model is loaded", async () => {
  const processes = await app.evaluate(({ app }) =>
    app.getAppMetrics().map((metric) => ({
      type: metric.type,
      workingSetMB: Math.round(metric.memory.workingSetSize / 1024),
      peakWorkingSetMB: Math.round(metric.memory.peakWorkingSetSize / 1024),
    }))
  );
  const total = processes.reduce((sum, metric) => sum + metric.workingSetMB, 0);
  test.info().annotations.push({ type: "memory", description: JSON.stringify(processes) });
  console.log(`idle working set: ${total} MB`, processes);
  expect(total).toBeLessThan(IDLE_MEMORY_CEILING_MB);
});

test("a long synthetic stream keeps frames inside the jank budget", async () => {
  await page.getByRole("button", { name: "Skip setup" }).click();
  await expect(page.getByRole("textbox", { name: "Message OpenMonkey" })).toBeVisible();
  await page.getByRole("button", { name: "New conversation" }).first().click();

  const conversationId = await page.evaluate(() =>
    window.electron.getConversations().then((list) => list[0]?.id ?? null)
  );
  expect(conversationId).toBeTruthy();

  await page.evaluate(() => {
    window.__omPerf = { longTasks: 0, maxLongTask: 0, frames: 0, maxFrameGap: 0 };
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__omPerf.longTasks += 1;
        window.__omPerf.maxLongTask = Math.max(window.__omPerf.maxLongTask, entry.duration);
      }
    }).observe({ entryTypes: ["longtask"] });
    let last = performance.now();
    const tick = (time) => {
      window.__omPerf.frames += 1;
      window.__omPerf.maxFrameGap = Math.max(window.__omPerf.maxFrameGap, time - last);
      last = time;
      window.__omPerf.handle = requestAnimationFrame(tick);
    };
    window.__omPerf.handle = requestAnimationFrame(tick);
  });

  const tokens = Array.from({ length: 320 }, (_, index) => `word${index} `);
  await app.evaluate(
    async ({ BrowserWindow }, { conversationId, tokens }) => {
      const send = (payload) => BrowserWindow.getAllWindows()[0].webContents.send("chat-event", payload);
      const id = `stream_${Date.now()}`;
      send({
        type: "start",
        conversationId,
        message: { id, role: "assistant", content: "", timestamp: new Date() },
      });
      for (const token of tokens) {
        await new Promise((resolve) => setTimeout(resolve, 8));
        send({ type: "token", conversationId, messageId: id, token });
      }
      send({
        type: "done",
        conversationId,
        message: { id, role: "assistant", content: tokens.join(""), timestamp: new Date() },
      });
    },
    { conversationId, tokens }
  );

  await expect(page.getByText(/word319/)).toBeVisible();
  const stats = await page.evaluate(() => {
    cancelAnimationFrame(window.__omPerf.handle);
    return { ...window.__omPerf, handle: undefined };
  });
  console.log("stream perf:", stats);
  expect(stats.longTasks).toBe(0);
  // A runner has no display of its own, so the compositor paces this window and the
  // gap measures the host, not the renderer: 283 ms on a CI box for the same stream
  // that never exceeds 40 ms here. The number is still printed so a real regression
  // is visible in the log.
  if (!onCiRunner) expect(stats.maxFrameGap).toBeLessThan(120);
});

test("Settings loads from its own chunk after the first paint", async () => {
  await expect
    .poll(() => scriptRequests.some((entry) => /SettingsView/i.test(entry.url)), { timeout: 5000 })
    .toBe(true);

  expect(scriptRequests.some((entry) => /index-.*\.js/.test(entry.url))).toBe(true);
  const chunk = scriptRequests.find((entry) => /SettingsView/i.test(entry.url));
  console.log("settings chunk:", chunk);
  // The split matters only if the chunk is absent from cold start: the prefetch
  // must land after the first surface was already interactive.
  expect(chunk.at).toBeGreaterThan(firstSurfaceMs);

  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await expect(page.getByRole("navigation").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Privacy", exact: true })).toBeVisible();
});
