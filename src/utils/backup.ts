import type Database from "better-sqlite3";
import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import logger from "./logger";
import type { BackupFile, IntegrityReport } from "./types";

/** How many backups are kept; the oldest goes when a new one is written. */
export const MAX_BACKUPS = 5;

/** How long a backup stays current before the app takes another one. */
export const BACKUP_INTERVAL_MS = 12 * 60 * 60 * 1000;

const PREFIX = "openmonkey-";
const SUFFIX = ".db";

/** The folder the backups live in, created when it is not there yet. */
export function backupFolder(): string {
  const dir = path.join(app.getPath("userData"), "backups");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

const stamp = (at: number): string => new Date(at).toISOString().replace(/[:.]/g, "-");

/** Every backup on disk, newest first. */
export function listBackups(): BackupFile[] {
  let names: string[];
  try {
    names = fs.readdirSync(backupFolder());
  } catch {
    return [];
  }
  const files: BackupFile[] = [];
  for (const name of names) {
    if (!name.startsWith(PREFIX) || !name.endsWith(SUFFIX)) continue;
    try {
      const stat = fs.statSync(path.join(backupFolder(), name));
      if (!stat.isFile()) continue;
      files.push({ name, bytes: stat.size, createdAt: stat.mtimeMs });
    } catch {
      // A file that vanished between the listing and the stat is simply not there.
    }
  }
  return files.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * A copy of the database that stands on its own: SQLite writes it while the
 * app keeps working, so it is a real file and not a half-written journal.
 */
export async function writeBackup(db: Database.Database): Promise<BackupFile | null> {
  const dir = backupFolder();
  const name = `${PREFIX}${stamp(Date.now())}${SUFFIX}`;
  const file = path.join(dir, name);
  try {
    fs.rmSync(file, { force: true });
    await db.backup(file);
    // The rows are sealed, but the file is still the user's conversations.
    fs.chmodSync(file, 0o600);
  } catch (error) {
    const reason = (error instanceof Error ? error.message : String(error)).slice(0, 120);
    // Quitting the app while a copy is being written closes the connection under
    // it. That is not damage, and the next launch asks again.
    if (reason.includes("not open")) logger.warn("backup.interrupted", { reason });
    else logger.error("backup.failed", { reason });
    fs.rmSync(file, { force: true });
    return null;
  }
  pruneBackups();
  const stat = fs.statSync(file);
  return { name, bytes: stat.size, createdAt: stat.mtimeMs };
}

/** The oldest backups go when there are more than the app keeps. */
export function pruneBackups(keep = MAX_BACKUPS): BackupFile[] {
  const all = listBackups();
  for (const old of all.slice(Math.max(1, keep))) {
    try {
      fs.rmSync(path.join(backupFolder(), old.name), { force: true });
    } catch {
      // A backup that will not go is a nuisance, not a failure.
    }
  }
  return listBackups();
}

/** True when the name is one this app wrote, so a path can never be walked out of. */
export const isBackupName = (name: string): boolean =>
  name.startsWith(PREFIX) && name.endsWith(SUFFIX) && !name.includes("/") && !name.includes("..");

/** What SQLite thinks of the file. */
export function checkIntegrity(db: Database.Database): IntegrityReport {
  try {
    // One row per verdict, under a column named after the pragma. A sound
    // database answers "ok" once and only once.
    const rows = db.prepare("PRAGMA integrity_check").all() as Array<Record<string, string>>;
    const verdicts = rows.flatMap((row) => Object.values(row));
    const broken = verdicts.filter((verdict) => verdict !== "ok");
    if (broken.length === 0) return { ok: true, detail: "ok" };
    return { ok: false, detail: broken.slice(0, 5).join("; ") };
  } catch {
    return { ok: false, detail: "The database could not be read at all." };
  }
}
