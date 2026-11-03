import { rmSync } from "node:fs";

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
  if (profile) rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  return status;
}
