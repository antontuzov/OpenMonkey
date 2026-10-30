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

try {
  await build({
    entryPoints: [
      path.join(here, "storage.test.ts"),
      path.join(here, "paths.test.ts"),
      path.join(here, "approval.test.ts"),
      path.join(here, "logger.test.ts"),
    ],
    absWorkingDir: root,
    outdir,
    outExtension: { ".js": ".cjs" },
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["better-sqlite3", "electron-store"],
    alias: { electron: path.join(here, "electron-stub.mjs") },
    logLevel: "warning",
  });

  const files = ["storage.test.cjs", "paths.test.cjs", "approval.test.cjs", "logger.test.cjs"].map((name) =>
    path.join(outdir, name)
  );
  const run = spawnSync(process.execPath, ["--test", ...files], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, OM_STUB_HOME: home, HOME: path.join(home, "home"), NODE_NO_WARNINGS: "1" },
  });
  process.exitCode = run.status ?? 1;
} finally {
  rmSync(home, { recursive: true, force: true });
}
