/**
 * The changelog as the app reads it.
 *
 * The file that ships inside the build is the same file the project writes, so the
 * notes the reader sees in the app are the notes the release was made from — there
 * is no second copy to fall out of step.
 */

import type { ReleaseNoteGroup, ReleaseNotes } from "./types";

export interface Changelog {
  /** The sections, newest first, in the order the file lists them. */
  sections: ReleaseNotes[];
}

const SECTION = /^##\s+(.+?)\s*$/;
const GROUP = /^###\s+(.+?)\s*$/;
const ITEM = /^-\s+(.*)$/;

/**
 * Splits a heading into the version and the day it was published.
 *
 * The headings read `0.9.2 — 2026-11-05`; the one for the work in progress reads
 * `Unreleased` and has no day.
 */
function splitHeading(title: string): { version: string; releasedAt: string | null } {
  const match = /^(.*?)\s*[—-]\s*(\d{4}-\d{2}-\d{2})$/.exec(title);
  if (!match) return { version: title, releasedAt: null };
  return { version: match[1].trim(), releasedAt: match[2] };
}

/**
 * Reads a changelog into its sections.
 *
 * A note is a bullet; the lines under it belong to the same note, because the file
 * wraps them. Notes are kept as the markdown they were written in, so the app can
 * render them the way it renders everything else.
 */
export function parseChangelog(markdown: string): Changelog {
  const sections: ReleaseNotes[] = [];
  let section: ReleaseNotes | null = null;
  let group: ReleaseNoteGroup | null = null;

  for (const line of markdown.split(/\r?\n/)) {
    const heading = SECTION.exec(line);
    if (heading) {
      const { version, releasedAt } = splitHeading(heading[1]);
      section = { version, releasedAt, groups: [] };
      sections.push(section);
      group = null;
      continue;
    }
    if (!section) continue;

    const sub = GROUP.exec(line);
    if (sub) {
      group = { name: sub[1].trim(), items: [] };
      section.groups.push(group);
      continue;
    }

    const item = ITEM.exec(line);
    if (item) {
      if (!group) {
        group = { name: "Changes", items: [] };
        section.groups.push(group);
      }
      group.items.push(item[1].trim());
      continue;
    }

    // A wrapped line belongs to the note above it.
    if (group && group.items.length && /^\s+\S/.test(line)) {
      group.items[group.items.length - 1] += ` ${line.trim()}`;
    }
  }

  return { sections };
}

/** The notes for one version, or null when the changelog does not carry them. */
export function sectionFor(changelog: Changelog, version: string): ReleaseNotes | null {
  return changelog.sections.find((section) => section.version === version) ?? null;
}

/** The notes for the work that is not out yet. */
export function upcomingSection(changelog: Changelog): ReleaseNotes | null {
  return changelog.sections.find((section) => section.version === "Unreleased") ?? null;
}
