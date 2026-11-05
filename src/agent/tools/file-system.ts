import * as fs from "node:fs/promises";
import * as path from "node:path";
import { shell } from "electron";
import { allowedRoots } from "../../utils/config";
import { measureText } from "../../utils/data-facts";
import type { TaskType } from "../../utils/types";
import type { ToolContext } from "./context";
import { resolveInWorkspace } from "./paths";

const MAX_READ_BYTES = 256_000;
/** An analysis reads whole tables, not a page of one, so the measuring cap is higher. */
const MAX_MEASURE_BYTES = 4_000_000;
const MAX_INSPECT_FILES = 40;
const MAX_INSPECT_TEXT = 12_000;

const size = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export class FileSystemTools {
  readonly type: TaskType = "file";

  async execute(action: string, args: Record<string, unknown>, context?: ToolContext): Promise<string> {
    switch (action) {
      case "list_dir":
        return this.listDir(String(args.path ?? ""));
      case "read_file":
        return this.readFile(await resolveInWorkspace(String(args.path ?? "")));
      case "write_file":
        return this.writeFile(
          await resolveInWorkspace(String(args.path ?? "")),
          String(args.content ?? ""),
          context
        );
      case "append_file":
        return this.appendFile(
          await resolveInWorkspace(String(args.path ?? "")),
          String(args.content ?? ""),
          context
        );
      case "move_file":
        return this.transfer(
          await resolveInWorkspace(String(args.source ?? "")),
          await resolveInWorkspace(String(args.destination ?? "")),
          true
        );
      case "copy_file":
        return this.transfer(
          await resolveInWorkspace(String(args.source ?? "")),
          await resolveInWorkspace(String(args.destination ?? "")),
          false
        );
      case "delete_file":
        return this.deleteFile(await resolveInWorkspace(String(args.path ?? "")));
      case "create_folder": {
        const folder = await resolveInWorkspace(String(args.path ?? ""));
        await fs.mkdir(folder, { recursive: true });
        return `Created ${folder}`;
      }
      case "find_files":
        return this.findFiles(String(args.path ?? ""), String(args.pattern ?? ""));
      case "inspect":
        return this.inspect(String(args.path ?? ""), String(args.pattern ?? "*"));
      default:
        throw new Error(`Unknown file action: ${action}`);
    }
  }

  private async listDir(target: string): Promise<string> {
    const dir = await resolveInWorkspace(target);
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const lines = entries.slice(0, 200).map((entry) => {
      const suffix = entry.isSymbolicLink() ? "@" : entry.isDirectory() ? "/" : "";
      return `  ${entry.name}${suffix}`;
    });
    return `${dir}\n${lines.join("\n")}${entries.length > 200 ? `\n  … ${entries.length - 200} more` : ""}`;
  }

  private async readFile(file: string): Promise<string> {
    const stat = await fs.stat(file);
    if (!stat.isFile()) throw new Error(`${file} is not a regular file`);
    if (stat.size > MAX_READ_BYTES) {
      return `${file} is ${stat.size} bytes; too large to read in one go (cap ${MAX_READ_BYTES})`;
    }
    const buffer = await fs.readFile(file);
    if (buffer.includes(0)) throw new Error(`${file} looks binary; only UTF-8 text files can be read`);
    return buffer.toString("utf8");
  }

  /** The text a write will replace, so the monitor can show what changed. */
  private async readForDiff(file: string): Promise<string> {
    try {
      const stat = await fs.stat(file);
      if (!stat.isFile() || stat.size > MAX_READ_BYTES) return "";
      const buffer = await fs.readFile(file);
      if (buffer.includes(0)) return "";
      return buffer.toString("utf8");
    } catch {
      return "";
    }
  }

  private async writeFile(file: string, content: string, context?: ToolContext): Promise<string> {
    const stat = await fs.stat(file).catch(() => null);
    if (stat?.isDirectory()) throw new Error(`${file} is a folder`);
    const before = await this.readForDiff(file);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content, "utf8");
    context?.onWrite?.({ path: file, before, after: content });
    return `Wrote ${Buffer.byteLength(content)} bytes to ${file}`;
  }

  private async appendFile(file: string, content: string, context?: ToolContext): Promise<string> {
    const stat = await fs.stat(file).catch(() => null);
    if (stat?.isDirectory()) throw new Error(`${file} is a folder`);
    const before = await this.readForDiff(file);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.appendFile(file, content, "utf8");
    context?.onWrite?.({ path: file, before, after: `${before}${content}` });
    return `Appended ${Buffer.byteLength(content)} bytes to ${file}`;
  }

  private async transfer(from: string, to: string, move: boolean): Promise<string> {
    const stat = await fs.lstat(from);
    const existing = await fs.lstat(to).catch(() => null);
    if (existing) throw new Error(`${to} already exists; refusing to overwrite it`);
    await fs.mkdir(path.dirname(to), { recursive: true });
    if (stat.isDirectory()) {
      if (move) await fs.rename(from, to);
      else await fs.cp(from, to, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
    } else {
      if (move) await fs.rename(from, to);
      else await fs.copyFile(from, to, fs.constants.COPYFILE_EXCL);
    }
    return `${move ? "Moved" : "Copied"} ${from} → ${to}`;
  }

  private async deleteFile(file: string): Promise<string> {
    if (allowedRoots().some((root) => path.resolve(root) === file)) {
      throw new Error(`Refusing to remove the workspace folder itself: ${file}`);
    }
    await fs.lstat(file);
    await shell.trashItem(file);
    return `Moved ${file} to the Trash`;
  }

  /** Shallow recursive name match; `*` is the only wildcard. Symlinks are not followed. */
  private async findFiles(target: string, pattern: string): Promise<string> {
    const root = await resolveInWorkspace(target);
    const regex = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`, "i");
    const found: string[] = [];

    const walk = async (dir: string, depth: number): Promise<void> => {
      if (found.length >= 100 || depth > 6) return;
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full, depth + 1);
        else if (regex.test(entry.name)) found.push(full);
        if (found.length >= 100) return;
      }
    };

    await walk(root, 0);
    return found.length ? found.join("\n") : `No files matching ${pattern} under ${root}`;
  }

  /**
   * The measuring pass an analysis needs: what a folder holds, and inside each file
   * the counts and numbers a reply would otherwise have to guess. It reads text only,
   * stops at the cap instead of guessing the rest, and never writes a thing.
   */
  private async inspect(target: string, pattern: string): Promise<string> {
    const root = await resolveInWorkspace(target);
    const regex = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`, "i");
    const files: { path: string; bytes: number }[] = [];

    const walk = async (dir: string, depth: number): Promise<void> => {
      if (files.length >= MAX_INSPECT_FILES || depth > 6) return;
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full, depth + 1);
        else if (regex.test(entry.name))
          files.push({ path: full, bytes: (await fs.stat(full).catch(() => null))?.size ?? 0 });
        if (files.length >= MAX_INSPECT_FILES) return;
      }
    };

    const rootStat = await fs.stat(root);
    if (rootStat.isFile()) files.push({ path: root, bytes: rootStat.size });
    else await walk(root, 0);

    if (!files.length) return `No files matching ${pattern} under ${root}`;

    const kinds = new Map<string, number>();
    for (const file of files) {
      const extension = path.extname(file.path).toLowerCase() || "no extension";
      kinds.set(extension, (kinds.get(extension) ?? 0) + 1);
    }
    const tally = [...kinds.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([extension, count]) => `${extension} ${count}`)
      .join(", ");

    const blocks: string[] = [];
    let measured = 0;
    let length = 0;
    for (const file of files) {
      const label = rootStat.isFile() ? path.basename(file.path) : path.relative(root, file.path);
      const facts = await this.measureFile(file.path, label);
      if (!facts) continue;
      measured += 1;
      blocks.push(facts);
      length += facts.length + 2;
      if (length > MAX_INSPECT_TEXT) {
        blocks.push(`… stopped here: ${files.length - measured} more files matched but were not measured`);
        break;
      }
    }

    const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
    const skipped = files.length - measured;
    const notes = [
      skipped ? `${skipped} skipped (binary or unreadable)` : "",
      files.length >= MAX_INSPECT_FILES ? `only the first ${MAX_INSPECT_FILES} matches measured` : "",
    ].filter(Boolean);

    return [
      `Measured ${files.length} file${files.length === 1 ? "" : "s"} in ${root}`,
      `${size(totalBytes)} total · ${tally}${notes.length ? ` · ${notes.join(", ")}` : ""}`,
      "",
      ...blocks,
    ].join("\n");
  }

  /** One file, reduced to the facts a report can quote. Null when there is no text to measure. */
  private async measureFile(file: string, label: string): Promise<string | null> {
    const stat = await fs.stat(file).catch(() => null);
    if (!stat?.isFile()) return null;
    const buffer = await readHead(file, MAX_MEASURE_BYTES);
    if (buffer === null) return null;

    const head = `${label} — ${size(stat.size)}`;
    if (buffer.includes(0)) return `${head}\n  binary file, not measured`;

    const truncated = stat.size > buffer.length;
    const facts = measureText(buffer.toString("utf8"), path.extname(label), truncated);
    return `${head}\n${facts.map((line) => `  ${line}`).join("\n")}`;
  }
}

/**
 * The first `maxBytes` of a file, or null when it cannot be opened.
 *
 * Measuring must not load a 2 GB export into memory to count its rows, so the read is
 * bounded at the file handle rather than truncated after the fact.
 */
async function readHead(file: string, maxBytes: number): Promise<Buffer | null> {
  let handle;
  try {
    handle = await fs.open(file);
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead);
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}
