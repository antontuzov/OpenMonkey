import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Bytes a process may actually write on the volume holding `targetPath`.
 *
 * The directory does not have to exist yet — the nearest existing parent sits on the
 * same volume. `bavail` (not `bfree`) is used because the system keeps part of the
 * free space for root, and an app cannot write into it.
 */
export function availableBytes(targetPath: string): number | null {
  let probe = path.resolve(targetPath);
  while (!fs.existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) return null;
    probe = parent;
  }
  try {
    const stats = fs.statfsSync(probe);
    return stats.bavail * stats.bsize;
  } catch {
    return null;
  }
}

/** Rounded to millions so the number on screen reads the same as the file size next to it. */
export function formatMegabytes(bytes: number): string {
  return `${Math.round(bytes / 1_000_000)} MB`;
}
