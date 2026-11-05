#!/usr/bin/env node
// Bundles the integration tests with a stub `electron` (no display, no keychain)
// and runs them against a throwaway user-data folder.
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const outdir = path.join(root, "test/.build");
const home = mkdtempSync(path.join(os.tmpdir(), "openmonkey-test-"));

mkdirSync(path.join(home, "home"), { recursive: true });
for (const folder of ["Documents", "Downloads", "Desktop"]) {
  mkdirSync(path.join(home, "home", folder), { recursive: true });
}

try {
  await build({
    entryPoints: [
      path.join(here, "storage.test.ts"),
      path.join(here, "storage-migration.test.ts"),
      path.join(here, "backup.test.ts"),
      // Not a suite: the migration test runs it in a child process.
      path.join(here, "migrate-legacy.ts"),
      path.join(here, "paths.test.ts"),
      path.join(here, "approval.test.ts"),
      path.join(here, "task-diff.test.ts"),
      path.join(here, "task-timeline.test.ts"),
      path.join(here, "model-download.test.ts"),
      path.join(here, "model-teardown.test.ts"),
      path.join(here, "agent-messages.test.ts"),
      path.join(here, "agent-composer.test.ts"),
      path.join(here, "memory-browser.test.ts"),
      path.join(here, "workspace-sources.test.ts"),
      path.join(here, "preview-model.test.ts"),
      path.join(here, "mcp-manager.test.ts"),
      path.join(here, "mlx-tokens.test.ts"),
      path.join(here, "updater.test.ts"),
      path.join(here, "asset-paths.test.ts"),
      path.join(here, "web-images.test.ts"),
      path.join(here, "file-inspect.test.ts"),
      path.join(here, "publish.test.ts"),
      path.join(here, "notifications.test.ts"),
      path.join(here, "logger.test.ts"),
      path.join(here, "settings.test.ts"),
    ],
    absWorkingDir: root,
    outdir,
    outExtension: { ".js": ".cjs" },
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["better-sqlite3", "electron-store"],
    alias: {
      electron: path.join(here, "electron-stub.mjs"),
      "electron-updater": path.join(here, "electron-updater-stub.ts"),
    },
    logLevel: "warning",
  });

  const files = [
    "storage.test.cjs",
    "storage-migration.test.cjs",
    "backup.test.cjs",
    "paths.test.cjs",
    "approval.test.cjs",
    "task-diff.test.cjs",
    "task-timeline.test.cjs",
    "model-download.test.cjs",
    "model-teardown.test.cjs",
    "agent-messages.test.cjs",
    "agent-composer.test.cjs",
    "memory-browser.test.cjs",
    "workspace-sources.test.cjs",
    "preview-model.test.cjs",
    "mcp-manager.test.cjs",
    "mlx-tokens.test.cjs",
    "updater.test.cjs",
    "asset-paths.test.cjs",
    "web-images.test.cjs",
    "file-inspect.test.cjs",
    "publish.test.cjs",
    "notifications.test.cjs",
    "logger.test.cjs",
    // Last: it writes config sections other suites read, and the runs are sequential.
    "settings.test.cjs",
  ].map((name) => path.join(outdir, name));
  // The files share one throwaway home (and SQLite file), so run them one at a
  // time: parallel processes can lock each other's writes and drop assertions.
  const run = spawnSync(process.execPath, ["--test", "--test-concurrency=1", ...files], {
    cwd: root,
    stdio: "inherit",
    timeout: 120_000,
    killSignal: "SIGKILL",
    env: { ...process.env, OM_STUB_HOME: home, HOME: path.join(home, "home"), NODE_NO_WARNINGS: "1" },
  });
  if (run.error) throw run.error;
  process.exitCode = run.status ?? 1;
} finally {
  rmSync(home, { recursive: true, force: true });
}
