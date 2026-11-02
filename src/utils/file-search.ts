import * as fs from "node:fs";
import * as path from "node:path";
import type { Attachment } from "./types";
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_TEXT } from "./attachments";

/** One file the composer can offer when the user types @. */
export interface FileCandidate {
  path: string;
  name: string;
  dir: string;
  bytes: number;
}

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".svn",
  "Library",
  "dist",
  "build",
  "out",
  ".next",
  ".cache",
  "vendor",
  "Pods",
  "models",
  "Applications",
  "venv",
  ".venv",
  "__pycache__",
  "target",
  ".gradle",
]);

const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".markdown", ".rst", ".json", ".jsonc", ".csv", ".tsv", ".ts", ".tsx",
  ".js", ".jsx", ".mjs", ".cjs", ".py", ".rb", ".go", ".rs", ".swift", ".sh", ".zsh",
  ".bash", ".sql", ".c", ".h", ".cpp", ".hpp", ".java", ".kt", ".yml", ".yaml", ".toml",
  ".ini", ".conf", ".cfg", ".xml", ".html", ".css", ".scss", ".vue", ".svelte",
]);

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".heic", ".svg"]);

/** Keys and environment files never travel to the model, not even by name. */
const SECRET_FILE = /^(\.env(\..+)?|.*\.env|\.?id_(rsa|dsa|ecdsa|ed25519)|.*\.(pem|key|p12|pfx|jks|keystore|keychain))$/i;

const MAX_DEPTH = 6;
/**
 * How many entries one search may look at. The bound is generous on purpose: a
 * home folder holds far more files than a fixed index would ever reach, and a
 * file typed by name has to be found wherever it sits.
 */
const MAX_VISITS = 200_000;
const CACHE_MS = 20_000;

/** True when the path is inside one of the folders the app is allowed to read. */
export function isAllowedPath(filePath: string, roots: string[]): boolean {
  const resolved = path.resolve(filePath);
  return roots.some((root) => resolved === root || resolved.startsWith(`${root}${path.sep}`));
}

interface Found {
  path: string;
  name: string;
  dir: string;
  score: number;
}

interface Walk {
  visited: number;
  found: Found[];
}

/**
 * Looks for files whose name contains what the user typed. The whole tree is
 * searched, because a folder can hold more files than any index would keep.
 */
async function walk(dir: string, depth: number, needle: string, out: Walk): Promise<void> {
  if (depth > MAX_DEPTH || out.visited >= MAX_VISITS) return;
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    out.visited += 1;
    if (out.visited >= MAX_VISITS) return;
    const name = entry.name;
    if (name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      await walk(full, depth + 1, needle, out);
      continue;
    }
    if (!entry.isFile() || SECRET_FILE.test(name)) continue;
    const index = name.toLowerCase().indexOf(needle);
    if (index < 0) continue;
    const extension = path.extname(name).toLowerCase();
    if (!TEXT_EXTENSIONS.has(extension) && !IMAGE_EXTENSIONS.has(extension)) continue;
    // A name that starts with the query beats one that merely contains it.
    out.found.push({
      path: full,
      name,
      dir,
      score: (index === 0 ? 0 : 100 + index) + name.length / 1000,
    });
  }
}

const cache = new Map<string, { at: number; files: FileCandidate[] }>();

/**
 * The files whose name matches what the user typed after @. A prefix match wins
 * over a match in the middle of the name, and shorter names come first.
 */
export async function searchFiles(
  query: string,
  roots: string[],
  limit = 12
): Promise<FileCandidate[]> {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const key = `${roots.join("\u0000")}\u0001${needle}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.files;

  const out: Walk = { visited: 0, found: [] };
  for (const root of roots) await walk(root, 0, needle, out);
  out.found.sort((left, right) => left.score - right.score);

  const files: FileCandidate[] = [];
  for (const hit of out.found.slice(0, limit)) {
    let bytes = 0;
    try {
      bytes = fs.statSync(hit.path).size;
    } catch {
      continue;
    }
    files.push({ path: hit.path, name: hit.name, dir: hit.dir, bytes });
  }

  if (cache.size > 8) {
    for (const [entryKey, entry] of cache) {
      if (Date.now() - entry.at >= CACHE_MS) cache.delete(entryKey);
    }
  }
  cache.set(key, { at: Date.now(), files });
  return files;
}

/**
 * Reads a file for the composer. The path must be inside an allowed folder and
 * the file must be plain text: an image is attached by name, never decoded.
 */
export function readFileAsAttachment(filePath: string, roots: string[]): Attachment {
  const resolved = path.resolve(filePath);
  if (!isAllowedPath(resolved, roots)) {
    throw new Error("That file is outside the folders OpenMonkey may read");
  }
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) throw new Error("That is not a file");
  if (stat.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`That file is ${Math.round(stat.size / 1024)} KB. Attachments are capped at 256 KB.`);
  }
  const extension = path.extname(resolved).toLowerCase();
  if (IMAGE_EXTENSIONS.has(extension)) {
    return { name: path.basename(resolved), bytes: stat.size, text: "", kind: "image" };
  }
  const text = fs.readFileSync(resolved, "utf8");
  if (text.includes("\u0000")) throw new Error("That file looks binary, so it was not attached.");
  return {
    name: path.basename(resolved),
    bytes: stat.size,
    text: text.slice(0, MAX_ATTACHMENT_TEXT),
    kind: "text",
  };
}
