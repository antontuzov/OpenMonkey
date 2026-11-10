/**
 * Bump the Homebrew cask after a release.
 *
 * Reads the release's own SHA-256 digest from the GitHub API — the same bytes the
 * tag pipeline uploaded — and rewrites `version` and `sha256` in the cask. It never
 * downloads the disk image.
 *
 *   npx tsx scripts/bump-cask.ts --tag v0.9.3 --cask ../homebrew-openmonkey/Casks/openmonkey.rb
 *
 * Flags: --tag (default: the latest release), --cask (the cask file to rewrite).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const REPO = "antontuzov/OpenMonkey";

interface ReleaseAsset {
  name: string;
  digest?: string | null;
}

/** The cask's two pinned lines, rewritten; everything else stays byte-for-byte. */
export function bumpCask(source: string, version: string, sha256: string): string {
  if (!/^\d+\.\d+\.\d+([.-][A-Za-z0-9.]+)?$/.test(version)) {
    throw new Error(`"${version}" is not a version the cask can pin`);
  }
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    throw new Error("the digest is not a SHA-256 hex string");
  }
  const versionLine = /^  version "[^"]+"$/m;
  const shaLine = /^  sha256 "[^"]+"$/m;
  if (!versionLine.test(source)) throw new Error("the cask has no version stanza to rewrite");
  if (!shaLine.test(source)) throw new Error("the cask has no sha256 stanza to rewrite");
  return source
    .replace(versionLine, `  version "${version}"`)
    .replace(shaLine, `  sha256 "${sha256}"`);
}

/** The published DMG's digest, straight from the release's asset metadata. */
export function dmgDigest(assets: ReleaseAsset[], assetName: string): string {
  const asset = assets.find((candidate) => candidate.name === assetName);
  if (!asset) throw new Error(`the release carries no ${assetName}`);
  const digest = asset.digest;
  if (!digest) throw new Error(`${assetName} has no digest — GitHub only records one for assets uploaded since 2025`);
  const [algorithm, hex] = digest.split(":");
  if (algorithm !== "sha256" || !/^[0-9a-f]{64}$/.test(hex ?? "")) {
    throw new Error(`${assetName} carries a digest this script cannot read: ${digest}`);
  }
  return hex;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const valueOf = (flag: string): string | undefined => {
    const at = args.indexOf(flag);
    return at >= 0 && at + 1 < args.length ? args[at + 1] : undefined;
  };
  const caskPath = valueOf("--cask");
  if (!caskPath) {
    console.error("Point at the cask: --cask ../homebrew-openmonkey/Casks/openmonkey.rb");
    process.exit(1);
  }
  const tag = valueOf("--tag");
  const url = `https://api.github.com/repos/${REPO}/releases/${tag ? `tags/${encodeURIComponent(tag)}` : "latest"}`;
  const response = await fetch(url, { headers: { Accept: "application/vnd.github+json" } });
  if (!response.ok) {
    console.error(`GitHub answered ${response.status} for ${url}`);
    process.exit(1);
  }
  const release = (await response.json()) as { tag_name: string; assets: ReleaseAsset[] };
  const pkg = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../package.json"), "utf8"));
  const assetName = String(pkg.build.artifactName).replaceAll("${arch}", "arm64").replaceAll("${ext}", "dmg");
  const version = release.tag_name.replace(/^v/, "");
  const sha256 = dmgDigest(release.assets, assetName);

  const file = path.resolve(caskPath);
  const before = fs.readFileSync(file, "utf8");
  const after = bumpCask(before, version, sha256);
  if (after === before) {
    console.log(`the cask already pins ${version} — nothing to do`);
    return;
  }
  fs.writeFileSync(file, after);
  console.log(`${file} now pins ${version}`);
  console.log(`  sha256: ${sha256}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}