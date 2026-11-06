import * as fs from "node:fs";
import * as path from "node:path";
import type { SafeModeInfo } from "./types";

/** The switch a user can pass on the command line. */
export const SAFE_MODE_FLAG = "--safe-mode";

/** The same switch as an environment variable, for a launcher that cannot pass one. */
export const SAFE_MODE_ENV = "OPENMONKEY_SAFE_MODE";

/** How many launches in a row have to die before the app opens without its extras. */
export const CRASHES_BEFORE_SAFE_MODE = 2;

/** Where the last launch got to, so a crash can be told from a clean exit. */
export interface CrashRecord {
  crashes: number;
  phase: "starting" | "running" | "clean";
}

const EMPTY: CrashRecord = { crashes: 0, phase: "clean" };

/**
 * Whether this launch was asked for safe mode, either on the command line or by
 * the environment.
 */
export function safeModeRequested(
  argv: readonly string[],
  env: Record<string, string | undefined>
): boolean {
  if (argv.includes(SAFE_MODE_FLAG)) return true;
  const value = env[SAFE_MODE_ENV];
  return value === "1" || value === "true";
}

/** The last launch's record, or an empty one when the file is missing or unreadable. */
export function readCrashRecord(file: string): CrashRecord {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<CrashRecord>;
    return {
      crashes: Number.isFinite(parsed.crashes) ? Number(parsed.crashes) : 0,
      phase: parsed.phase === "starting" || parsed.phase === "running" ? parsed.phase : "clean",
    };
  } catch {
    return { ...EMPTY };
  }
}

export function writeCrashRecord(file: string, record: CrashRecord): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(record), "utf8");
  } catch {
    // A profile folder that cannot be written is not worth a crash over: the app
    // simply keeps no count of how it died.
  }
}

/**
 * The start of a launch: the previous one died before it was ready if it never
 * got past "starting", and this one is marked as not ready either.
 */
export function noteLaunch(file: string): CrashRecord {
  const previous = readCrashRecord(file);
  const record: CrashRecord = {
    crashes: previous.phase === "starting" ? previous.crashes + 1 : 0,
    phase: "starting",
  };
  writeCrashRecord(file, record);
  return record;
}

/** The app opened and is usable, whatever it does next. */
export function markRunning(file: string): void {
  const record = readCrashRecord(file);
  writeCrashRecord(file, { ...record, phase: "running" });
}

/** The app was closed by the user: the count starts again from nothing. */
export function noteCleanExit(file: string): void {
  writeCrashRecord(file, { crashes: 0, phase: "clean" });
}

/** The count is cleared, so the next launch is an ordinary one. */
export function clearCrashes(file: string): void {
  writeCrashRecord(file, { crashes: 0, phase: "clean" });
}

/**
 * What this launch does. A launch asked for safe mode always gets it; a launch
 * after a crash only gets it when the app died more than once in a row.
 */
export function planSafeMode(requested: boolean, crashes: number): SafeModeInfo {
  if (requested) return { active: true, reason: "flag", crashes };
  if (crashes >= CRASHES_BEFORE_SAFE_MODE) {
    return { active: true, reason: "crashes", crashes };
  }
  return { active: false, reason: null, crashes };
}

/**
 * The arguments the app is relaunched with. The switch is never left in twice, so
 * a relaunch into safe mode and the next relaunch out of it are both clean.
 */
export function restartArgs(argv: readonly string[], safe: boolean): string[] {
  const args = argv.slice(1).filter((arg) => arg !== SAFE_MODE_FLAG);
  return safe ? [...args, SAFE_MODE_FLAG] : args;
}
