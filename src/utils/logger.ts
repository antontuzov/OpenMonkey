import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";

type Level = "debug" | "info" | "warn" | "error";

const LOG_FILE = () => path.join(app.getPath("userData"), "logs", "openmonkey.log");

let stream: fs.WriteStream | null = null;

/**
 * Local-only logging: no network, and prompt/response text is never written out,
 * only its size, so the log cannot leak conversation content.
 */
function openStream(): fs.WriteStream | null {
  if (stream) return stream;
  try {
    const file = LOG_FILE();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    stream = fs.createWriteStream(file, { flags: "a" });
    return stream;
  } catch {
    return null;
  }
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
  const file = openStream();
  if (file) file.write(line);
  if (level === "error") console.error(line.trim());
  else if (process.env.OPENMONKEY_VERBOSE) console.log(line.trim());
}

export const logger = {
  debug: (event: string, meta?: Record<string, unknown>) => write("debug", event, meta),
  info: (event: string, meta?: Record<string, unknown>) => write("info", event, meta),
  warn: (event: string, meta?: Record<string, unknown>) => write("warn", event, meta),
  error: (event: string, meta?: Record<string, unknown>) => write("error", event, meta),
  close: () => {
    stream?.end();
    stream = null;
  },
};

export default logger;
