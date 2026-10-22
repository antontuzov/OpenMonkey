import { shell } from "electron";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AutomationProbe } from "../utils/types";

const execFileAsync = promisify(execFile);

const SETTINGS_URLS = {
  automation: "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation",
  notifications: "x-apple.systempreferences:com.apple.Notifications-Settings.extension",
} as const;

const PROBES = {
  calendar: 'tell application "Calendar" to count calendars',
  mail: 'tell application "Mail" to count mailboxes',
} as const;

/**
 * macOS has no query API for Apple Events access, so this sends a harmless command.
 * It only runs when the person clicks Check, because it may open the target app and
 * show the system consent dialog.
 */
export async function probeAutomation(area: "calendar" | "mail"): Promise<AutomationProbe> {
  if (process.platform !== "darwin") {
    return { state: "unknown", message: "Automation permissions are macOS-only." };
  }

  try {
    await execFileAsync("osascript", ["-e", PROBES[area]], { timeout: 12_000 });
    return { state: "granted" };
  } catch (error) {
    const detail = error as { stderr?: string; message?: string; killed?: boolean };
    const text = `${detail.stderr ?? ""} ${detail.message ?? ""}`;
    if (text.includes("-1743") || /not authori[sz]ed|not allowed/i.test(text)) {
      return { state: "denied", message: "macOS blocked the request. Allow OpenMonkey under Automation." };
    }
    if (detail.killed) {
      return { state: "unknown", message: "The check timed out. Try again from the permissions page." };
    }
    return { state: "unknown", message: text.trim().split("\n").at(-1) ?? "The check did not complete." };
  }
}

export async function openPermissionSettings(area: "automation" | "notifications"): Promise<void> {
  if (process.platform !== "darwin") return;
  await shell.openExternal(SETTINGS_URLS[area]);
}
