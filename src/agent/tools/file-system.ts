import * as fs from "node:fs/promises";
import * as path from "node:path";
import { shell } from "electron";
import { allowedRoots } from "../../utils/config";
import type { TaskType } from "../../utils/types";
import { resolveInWorkspace } from "./paths";

const MAX_READ_BYTES = 256_000;

export class FileSystemTools {
  readonly type: TaskType = "file";

  async execute(action: string, args: Record<string, unknown>): Promise<string> {
    switch (action) {
      case "list_dir":
        return this.listDir(String(args.path ?? ""));
      case "read_file":
        return this.readFile(await resolveInWorkspace(String(args.path ?? "")));
      case "write_file":
        return this.writeFile(await resolveInWorkspace(String(args.path ?? "")), String(args.content ?? ""));
      case "append_file":
        return this.appendFile(await resolveInWorkspace(String(args.path ?? "")), String(args.content ?? ""));
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

  private async writeFile(file: string, content: string): Promise<string> {
    const stat = await fs.stat(file).catch(() => null);
    if (stat?.isDirectory()) throw new Error(`${file} is a folder`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content, "utf8");
    return `Wrote ${Buffer.byteLength(content)} bytes to ${file}`;
  }

  private async appendFile(file: string, content: string): Promise<string> {
    const stat = await fs.stat(file).catch(() => null);
    if (stat?.isDirectory()) throw new Error(`${file} is a folder`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.appendFile(file, content, "utf8");
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
}
