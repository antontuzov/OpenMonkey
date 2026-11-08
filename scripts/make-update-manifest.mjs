#!/usr/bin/env node
/**
 * Build one macOS update manifest from the per-arch build outputs.
 *
 * Each package job runs electron-builder for a single arch, so each one writes a
 * `latest-mac.yml` that only knows about its own archive. A GitHub Release is a
 * flat set of files, so whichever job finished last would leave a manifest that
 * points Intel machines at an Apple Silicon build. This script rebuilds the
 * manifest from the archives that are actually on disk, which also means the
 * checksums are taken from the bytes a downloader will really receive.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const ARCHES = ["arm64", "x64"];
const PREFIX = "OpenMonkey-";

const fail = (message) => {
  throw new Error(message);
};

const parseArgs = (argv) => {
  const options = { dir: "release", out: null, version: null, rollout: "100" };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--dir" || flag === "--out" || flag === "--version" || flag === "--rollout") {
      const value = argv[++i];
      if (!value) fail(`${flag} needs a value`);
      options[flag.slice(2)] = value;
    } else {
      fail(`unknown argument: ${flag}`);
    }
  }
  options.out ??= path.join(options.dir, "latest-mac.yml");
  if (!options.version) fail("--version is required (the release tag without refs/tags/)");
  if (!/^\d+\.\d+\.\d+/.test(options.version)) fail(`--version wants a numeric version, got "${options.version}"`);
  const rollout = Number(options.rollout);
  if (!Number.isFinite(rollout) || rollout < 0 || rollout > 100) {
    fail(`--rollout wants a share between 0 and 100, got "${options.rollout}"`);
  }
  options.rollout = String(Math.round(rollout));
  return options;
};

/** electron-updater expects base64, not the hex a checksum tool usually prints. */
const sha512 = async (file) => {
  const hash = createHash("sha512");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(file);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", resolve);
  });
  return hash.digest("base64");
};

const archOf = (name) => {
  if (!name.startsWith(PREFIX) || !name.endsWith(".zip")) return null;
  const arch = name.slice(PREFIX.length, -".zip".length);
  if (!ARCHES.includes(arch)) fail(`${name}: electron-updater cannot pick an arch from this filename`);
  return arch;
};

const collect = async (dir) => {
  const entries = await readdir(dir);
  const seen = new Map();
  for (const name of entries) {
    const arch = archOf(name);
    if (!arch) continue;
    if (seen.has(arch)) fail(`two archives claim to be ${arch}`);
    const file = path.join(dir, name);
    seen.set(arch, { url: name, sha512: await sha512(file), size: (await stat(file)).size });
  }
  if (!seen.size) fail(`no ${PREFIX}<arch>.zip archives in ${dir}`);
  return ARCHES.filter((arch) => seen.has(arch)).map((arch) => seen.get(arch));
};

// The shape electron-builder itself emits when it builds both arches at once:
// every archive in `files`, and the first one repeated at the top level for
// clients too old to read the list.
const manifest = (version, files, rollout) => {
  const lines = [`version: ${version}`, "files:"];
  for (const file of files) {
    lines.push(`  - url: ${file.url}`, `    sha512: ${file.sha512}`, `    size: ${file.size}`);
  }
  lines.push(
    `path: ${files[0].url}`,
    `sha512: ${files[0].sha512}`,
    `releaseDate: '${new Date().toISOString()}'`,
    // The share of installs the release is offered to; the app compares its own
    // number against it, so a build can be let out slowly.
    `rollout: ${rollout}`,
    "",
  );
  return lines.join("\n");
};

const main = async () => {
  const { dir, out, version, rollout } = parseArgs(process.argv.slice(2));
  const files = await collect(dir);
  await writeFile(out, manifest(version, files, rollout));
  console.log(
    `latest-mac.yml for ${version}: ${files.map((f) => `${f.url} (${f.size} bytes)`).join(", ")} — rollout ${rollout}%`
  );
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
