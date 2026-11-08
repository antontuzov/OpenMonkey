import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { parseChangelog, sectionFor, upcomingSection, type Changelog } from "../utils/release-notes";
import type { ReleaseNotes, ReleaseNotesPayload } from "../utils/types";

/**
 * The changelog that ships with the build.
 *
 * The builder copies it into `Contents/Resources`, so an installed app reads the
 * file it was built with; a run from the repository reads the same file from the
 * root of it.
 */
export function changelogPath(): string {
  const base = app.isPackaged ? process.resourcesPath : app.getAppPath();
  return path.join(base, "CHANGELOG.md");
}

let cached: Changelog | null = null;

/** The changelog as it stands, read once and kept. */
export function changelog(): Changelog {
  if (cached) return cached;
  try {
    cached = parseChangelog(fs.readFileSync(changelogPath(), "utf8"));
  } catch {
    // A build without the file still runs; it simply has no notes to show.
    cached = { sections: [] };
  }
  return cached;
}

/** The notes for one version, when this build carries them. */
export function notesFor(version: string): ReleaseNotes | null {
  return sectionFor(changelog(), version);
}

/** The notes the app can show: for the running version, and for the work in progress. */
export function releaseNotesPayload(version: string): ReleaseNotesPayload {
  return {
    version,
    current: notesFor(version),
    upcoming: upcomingSection(changelog()),
  };
}
