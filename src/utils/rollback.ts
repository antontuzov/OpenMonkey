/**
 * Which release to go back to.
 *
 * The rules live apart from the code that fetches anything, so they can be checked
 * without a network or a window.
 */

import type { RollbackTarget } from "./types";

export interface GitHubAsset {
  name: string;
  browser_download_url: string;
  size?: number;
}

export interface GitHubRelease {
  tag_name: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: GitHubAsset[];
}

export type { RollbackTarget };

/** The three numbers of a version, so two of them can be compared. */
export function parseVersion(tag: string): number[] | null {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(tag.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

/** Which version is the newer one. */
export function compareVersions(left: number[], right: number[]): number {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

/**
 * The release to go back to: the newest one older than the version running.
 *
 * A draft or a prerelease is not a version to fall back to, and a release without
 * a disk image cannot be fetched, so neither is offered.
 */
export function pickPreviousRelease(
  releases: GitHubRelease[],
  currentVersion: string
): RollbackTarget | null {
  const current = parseVersion(currentVersion);
  if (!current) return null;

  const older = releases
    .filter((release) => !release.draft && !release.prerelease)
    .map((release) => ({ release, version: parseVersion(release.tag_name) }))
    .filter((entry): entry is { release: GitHubRelease; version: number[] } => entry.version !== null)
    .filter((entry) => compareVersions(entry.version, current) < 0)
    .sort((left, right) => compareVersions(right.version, left.version));

  // A release without a disk image cannot be fetched, so it is passed over and the
  // next older one is tried.
  for (const entry of older) {
    const asset = (entry.release.assets ?? []).find((one) => one.name.endsWith(".dmg"));
    if (!asset) continue;
    return {
      version: entry.release.tag_name.replace(/^v/, ""),
      url: asset.browser_download_url,
      size: typeof asset.size === "number" ? asset.size : null,
    };
  }
  return null;
}
