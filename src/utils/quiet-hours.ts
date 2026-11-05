/** The hours the app keeps quiet, in the user's own clock. */
export interface QuietHours {
  enabled: boolean;
  /** "22:00" */
  from: string;
  /** "08:00" */
  to: string;
}

const minutes = (value: string): number | null => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const rest = Number(match[2]);
  if (hours > 23 || rest > 59) return null;
  return hours * 60 + rest;
};

/**
 * True while the quiet window is open. A window that crosses midnight — 22:00 to
 * 08:00 — wraps around; a window that starts and ends at the same hour is empty,
 * because a user who typed that meant nothing rather than all day.
 */
export function withinQuietHours(now: Date, quiet: QuietHours): boolean {
  if (!quiet.enabled) return false;
  const from = minutes(quiet.from);
  const to = minutes(quiet.to);
  if (from === null || to === null || from === to) return false;
  const current = now.getHours() * 60 + now.getMinutes();
  return from < to ? current >= from && current < to : current >= from || current < to;
}

/** True when the two times parse as hours of the day. */
export function validQuietHours(quiet: QuietHours): boolean {
  return minutes(quiet.from) !== null && minutes(quiet.to) !== null;
}
