import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { app } from "electron";
import { assetPath } from "../../src/utils/config";

// The builder decides where the folder actually lands; the resolver has to agree with
// it, which is the mismatch that left installed builds without any mood art.
const extra = JSON.parse(readFileSync(path.resolve(process.cwd(), "package.json"), "utf8")).build
  .extraResources as { from: string; to: string }[];
const shipped = extra.find((entry) => entry.from === "assets");

const pristine = {
  isPackaged: (app as unknown as { isPackaged: boolean }).isPackaged,
  resourcesPath: process.resourcesPath,
};

// Electron's types mark `resourcesPath` read-only; the process object is not.
const proc = process as unknown as { resourcesPath?: string };

afterEach(() => {
  const target = app as unknown as { isPackaged: boolean };
  target.isPackaged = pristine.isPackaged;
  proc.resourcesPath = pristine.resourcesPath;
});

test("extraResources carries the assets folder into the bundle", () => {
  assert.ok(shipped, "the builder config ships assets/");
  assert.equal(shipped.to, "assets");
});

test("a packaged app reads its assets from the copied folder", () => {
  const target = app as unknown as { isPackaged: boolean };
  target.isPackaged = true;
  proc.resourcesPath = "/Applications/OpenMonkey.app/Contents/Resources";

  assert.equal(
    assetPath("logos", "monkey-neutral-blue.png"),
    "/Applications/OpenMonkey.app/Contents/Resources/assets/logos/monkey-neutral-blue.png"
  );
});

test("a development run reads the same names from the repository folder", () => {
  const target = app as unknown as { isPackaged: boolean };
  target.isPackaged = false;

  assert.equal(
    assetPath("logos", "monkey-neutral-blue.png"),
    path.join(app.getAppPath(), "assets", "logos", "monkey-neutral-blue.png")
  );
});
