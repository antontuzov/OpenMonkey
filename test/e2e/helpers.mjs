import { existsSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "@playwright/test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Whether the pinned Bonsai weights are on this machine.
 *
 * A spec that asks the model for a real answer has nothing to assert without them,
 * and a CI runner is not going to fetch 546 MB of weights to prove the UI works. The
 * suite therefore splits in two: everything the app can show from its own storage
 * runs everywhere, and the turns that need tokens run only where the weights are.
 */
export const weightsOnDisk = existsSync(
  path.join(repoRoot, "models", "Bonsai-4B-gguf", "Bonsai-4B.gguf")
);

/**
 * Empties the chat so the next model turn is asked without the failed attempts in
 * front of it.
 *
 * Repeating the same request inside one chat teaches the opposite of what a retry
 * wants: after two or three copies the model has only text-only answers to imitate,
 * so it keeps describing the tool call instead of running it. /clear is answered by
 * the app itself and drops those turns from the history, which makes every retry
 * the first thing the model sees.
 */
export async function resetChat(page) {
  const composer = page.locator("textarea").first();
  await composer.fill("/clear");
  await composer.press("Enter");
  await expect(page.getByText(/chat cleared|чат очищен/i)).toBeVisible({ timeout: 30_000 });
}

/** Every process below the given one, so a teardown can be waited for. */
function descendantsOf(pid) {
  try {
    const output = execFileSync("/bin/ps", ["-axo", "pid=,ppid="], { encoding: "utf8" });
    const children = new Map();
    for (const line of output.split("\n")) {
      const [child, parent] = line.trim().split(/\s+/);
      if (!child || !parent) continue;
      if (!children.has(Number(parent))) children.set(Number(parent), []);
      children.get(Number(parent)).push(Number(child));
    }
    const found = new Set();
    const walk = (parent) => {
      for (const child of children.get(parent) ?? []) {
        if (found.has(child)) continue;
        found.add(child);
        walk(child);
      }
    };
    walk(pid);
    return [...found];
  } catch {
    return [];
  }
}

const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/**
 * Waits until the given processes are gone.
 *
 * The model runs in a worker of its own, and a worker that outlives the app keeps
 * the weights in memory and the CPU busy: the next spec then starts on a machine
 * that is still busy, which is how a cold start turns into sixteen seconds and a
 * model load turns into a timeout that has nothing to do with the code.
 */
async function waitForGone(pids, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!pids.some(isAlive)) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return !pids.some(isAlive);
}

/**
 * Quits the app the way a user does and waits for the process to be gone.
 *
 * A quit that is still draining when the test ends gets killed by the runner, and a
 * hard kill during a model load is exactly what writes a crash report: the addon
 * completes its worker into a freed JS context and aborts. Waiting for the exit also
 * keeps one app instance per spec instead of a dozen alive at once, which is what
 * makes the cold-start numbers on this machine meaningless.
 */
export async function quitApp(app, profile) {
  if (!app) {
    if (profile) rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    return null;
  }

  const proc = app.process();
  const workers = descendantsOf(proc.pid);
  const exited = new Promise((resolve) => {
    if (proc.exitCode !== null || proc.signalCode !== null) {
      resolve({ code: proc.exitCode, signal: proc.signalCode });
      return;
    }
    proc.once("exit", (code, signal) => resolve({ code, signal }));
  });

  try {
    await app.evaluate(({ app: electronApp }) => electronApp.quit());
  } catch {
    /* already closed */
  }

  const status = await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(() => resolve(null), 60_000)),
  ]);
  if (status === null) {
    proc.kill("SIGKILL");
    await exited;
  }
  await waitForGone(workers, 30_000);
  if (profile) rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  return status;
}
