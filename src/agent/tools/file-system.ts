import * as fs from "node:fs/promises";
import * as path from "node:path";
import { allowedRoots } from "../../utils/config";
import type { TaskType } from "../../utils/types";

const MAX_READ_BYTES = 256_000;

export class FileSystemTools {
  readonly type: TaskType = "file";
  readonly mutatingActions: ReadonlySet<string> = new Set([
    "write_file",
    "append_file",
    "move_file",
    "copy_file",
    "create_folder",
  ]);

  /** Resolve an argument path and refuse anything that escapes the user's folders. */
  private resolve(target: string): string {
    const roots = allowedRoots();
    const absolute = path.resolve(target.startsWith("~") ? path.join(process.env.HOME ?? "", target.slice(1)) : target);
    const matched = roots.find((root) => absolute === root || absolute.startsWith(root + path.sep));
    if (!matched) {
      throw new Error(`${absolute} is outside the allowed folders (${roots.join(", ")})`);
    }
    return absolute;
  }

  async execute(action: string, args: Record<string, unknown>): Promise<string> {
    switch (action) {
      case "list_dir":
        return this.listDir(String(args.path ?? ""));
      case "read_file":
        return this.readFile(this.resolve(String(args.path ?? "")));
      case "write_file":
        return this.writeFile(this.resolve(String(args.path ?? "")), String(args.content ?? ""));
      case "append_file":
        return this.appendFile(this.resolve(String(args.path ?? "")), String(args.content ?? ""));
      case "move_file":
        return this.moveFile(String(args.source ?? ""), String(args.destination ?? ""));
      case "copy_file":
        return this.copyFile(String(args.source ?? ""), String(args.destination ?? ""));
      case "create_folder":
        await fs.mkdir(this.resolve(String(args.path ?? "")), { recursive: true });
        return `Created ${this.resolve(String(args.path ?? ""))}`;
      case "find_files":
        return this.findFiles(String(args.path ?? ""), String(args.pattern ?? ""));
      default:
        throw new Error(`Unknown file action: ${action}`);
    }
  }

  private async listDir(target: string): Promise<string> {
    const dir = this.resolve(target || (process.env.HOME ?? "."));
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const lines = entries.slice(0, 200).map((entry) => {
      const suffix = entry.isDirectory() ? "/" : "";
      return `  ${entry.name}${suffix}`;
    });
    return `${dir}\n${lines.join("\n")}${entries.length > 200 ? `\n  … ${entries.length - 200} more` : ""}`;
  }

  private async readFile(file: string): Promise<string> {
    const stat = await fs.stat(file);
    if (stat.size > MAX_READ_BYTES) {
      return `${file} is ${stat.size} bytes; too large to read in one go (cap ${MAX_READ_BYTES})`;
    }
    return await fs.readFile(file, "utf8");
  }

  private async writeFile(file: string, content: string): Promise<string> {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content, "utf8");
    return `Wrote ${Buffer.byteLength(content)} bytes to ${file}`;
  }

  private async appendFile(file: string, content: string): Promise<string> {
    await fs.appendFile(file, content, "utf8");
    return `Appended ${Buffer.byteLength(content)} bytes to ${file}`;
  }

  private async moveFile(source: string, destination: string): Promise<string> {
    const from = this.resolve(source);
    const to = this.resolve(destination);
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.rename(from, to);
    return `Moved ${from} → ${to}`;
  }

  private async copyFile(source: string, destination: string): Promise<string> {
    const from = this.resolve(source);
    const to = this.resolve(destination);
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.copyFile(from, to);
    return `Copied ${from} → ${to}`;
  }

  /** Shallow recursive name match; `*` is the only wildcard. */
  private async findFiles(target: string, pattern: string): Promise<string> {
    const root = this.resolve(target || (process.env.HOME ?? "."));
    const regex = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`, "i");
    const found: string[] = [];

    const walk = async (dir: string, depth: number): Promise<void> => {
      if (found.length >= 100 || depth > 6) return;
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
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
