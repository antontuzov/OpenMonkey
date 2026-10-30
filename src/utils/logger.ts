import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";

type Level = "debug" | "info" | "warn" | "error";

const LOG_FILE = () => path.join(app.getPath("userData"), "logs", "openmonkey.log");
const MAX_BYTES = 2 * 1024 * 1024;
const KEEP = 2;

let written = 0;
let measured = false;

function sizeOf(file: string): number {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

function ensureDir(file: string): void {
  if (measured) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  written = sizeOf(file);
  measured = true;
}

/** openmonkey.log.2 is dropped, .1 becomes .2, and the live file becomes .1. */
function rotate(file: string): void {
  for (let index = KEEP; index >= 1; index -= 1) {
    const from = index === 1 ? file : `${file}.${index - 1}`;
    if (fs.existsSync(from)) fs.renameSync(from, `${file}.${index}`);
  }
  written = 0;
}

function redact(meta?: Record<string, unknown>): string {
  if (!meta) return "";
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (typeof value === "string" && (key === "content" || key === "prompt" || key === "response")) {
      safe[`${key}Length`] = value.length;
    } else if (value instanceof Error) {
      safe[key] = value.message;
    } else {
      safe[key] = value;
    }
  }
  return ` ${JSON.stringify(safe)}`;
}

function write(level: Level, event: string, meta?: Record<string, unknown>): void {
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${event}${redact(meta)}\n`;
  // Appended synchronously: a queued WriteStream can still be flushing into a file
  // that rotation has already renamed, which made the cap and the file size disagree.
  try {
    const file = LOG_FILE();
    ensureDir(file);
    if (written > MAX_BYTES) rotate(file);
    fs.appendFileSync(file, line);
    written += Buffer.byteLength(line);
  } catch {
    /* a log that cannot be written must not take the app down */
  }
  if (level === "error") console.error(line.trim());
  else if (process.env.OPENMONKEY_VERBOSE) console.log(line.trim());
}

export const logger = {
  debug: (event: string, meta?: Record<string, unknown>) => write("debug", event, meta),
  info: (event: string, meta?: Record<string, unknown>) => write("info", event, meta),
  warn: (event: string, meta?: Record<string, unknown>) => write("warn", event, meta),
  error: (event: string, meta?: Record<string, unknown>) => write("error", event, meta),
  /** The newest lines of the live file, oldest first; rotations are history, not the tail. */
  tail: (lines = 200): string => {
    try {
      const file = LOG_FILE();
      if (!fs.existsSync(file)) return "";
      const all = fs.readFileSync(file, "utf8").split("\n");
      if (all[all.length - 1] === "") all.pop();
      return all.slice(-Math.max(1, Math.min(lines, 500))).join("\n");
    } catch {
      return "";
    }
  },
  /** Empties the live file and drops the rotations, so a shared log starts clean. */
  clear: (): void => {
    try {
      const file = LOG_FILE();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, "");
      written = 0;
      measured = true;
      for (let index = 1; index <= KEEP; index += 1) fs.rmSync(`${file}.${index}`, { force: true });
    } catch {
      /* nothing written yet */
    }
  },
  /** Forget the measured size so the next line re-reads the file after it is deleted. */
  reset: () => {
    measured = false;
    written = 0;
  },
  close: () => {
    measured = false;
    written = 0;
  },
};

export default logger;
