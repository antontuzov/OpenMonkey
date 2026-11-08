import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

/**
 * A number for this install, used to pick a rollout cohort.
 *
 * It is a random string the install made for itself: it does not describe the Mac,
 * it never leaves the machine, and the only thing derived from it is a bucket
 * between 0 and 99.
 */
let cached: string | null = null;

export function installId(): string {
  if (cached) return cached;
  const file = path.join(app.getPath("userData"), "install-id");
  try {
    const existing = fs.readFileSync(file, "utf8").trim();
    if (existing) {
      cached = existing;
      return existing;
    }
  } catch {
    // There is no id yet: one is made below.
  }
  const id = crypto.randomBytes(16).toString("hex");
  try {
    fs.writeFileSync(file, id, { mode: 0o600 });
  } catch {
    // A folder that cannot be written still gets an id for this session.
  }
  cached = id;
  return id;
}
