import * as fs from "node:fs/promises";
import { allowedRoots } from "../utils/config";
import type { TaskRequest } from "../utils/types";
import { expandPath } from "./tools/paths";
import { MAX_DIFF_LINES, lineDiff, renderDiff } from "../utils/diff";

const MAX_PREVIEW = 4_000;

const bytes = (size: number): string => {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

const clip = (text: string): string =>
  text.length > MAX_PREVIEW ? `${text.slice(0, MAX_PREVIEW)}\n… preview truncated` : text;

async function readText(file: string): Promise<string | null> {
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > 64_000) return null;
    const buffer = await fs.readFile(file);
    if (buffer.includes(0)) return null;
    return buffer.toString("utf8");
  } catch {
    return null;
  }
}

async function describeTarget(file: string): Promise<string> {
  try {
    const stat = await fs.lstat(file);
    if (stat.isSymbolicLink()) return "symbolic link";
    if (stat.isDirectory()) {
      const entries = await fs.readdir(file).catch(() => []);
      return `folder, ${entries.length} item${entries.length === 1 ? "" : "s"}`;
    }
    return `file, ${bytes(stat.size)}`;
  } catch {
    return "does not exist yet";
  }
}

const field = (label: string, value: unknown): string | null =>
  value === undefined || value === null || value === "" ? null : `${label}: ${String(value)}`;

/**
 * Human-facing preview shown before an approval. It never mutates anything and
 * never throws: a preview failure falls back to the raw arguments.
 */
export async function buildPreview(request: TaskRequest, args: Record<string, unknown>): Promise<string> {
  try {
    const { type, action } = request;

    if (type === "file") {
      const target = typeof args.path === "string" ? expandPath(args.path) : "";
      if (action === "write_file") {
        const before = await readText(target);
        const after = String(args.content ?? "");
        if (before === null) {
          const lines = after.split("\n");
          const head = lines.slice(0, 24).join("\n");
          return clip(`New file ${target}\n+ ${lines.length} lines, ${bytes(Buffer.byteLength(after))}\n\n${head}${lines.length > 24 ? "\n…" : ""}`);
        }
        const diff = lineDiff(before, after);
        if (!diff) return `${target} has more than ${MAX_DIFF_LINES} lines; the file will be replaced entirely (${after.split("\n").length} new lines).`;
        const added = diff.filter((line) => line.kind === "add").length;
        const removed = diff.filter((line) => line.kind === "del").length;
        return clip(renderDiff(diff, `Modify ${target} (+${added} / -${removed})`));
      }
      if (action === "append_file") {
        const content = String(args.content ?? "");
        const lines = content.split("\n").slice(0, 30);
        return clip(`Append to ${target}\n+ ${content.split("\n").length} lines\n\n${lines.join("\n")}`);
      }
      if (action === "move_file" || action === "copy_file") {
        const source = expandPath(String(args.source ?? ""));
        const destination = expandPath(String(args.destination ?? ""));
        const destinationState = await describeTarget(destination);
        return clip(
          `${action === "move_file" ? "Move" : "Copy"}\nfrom: ${source} (${await describeTarget(source)})\nto:   ${destination} (${destinationState})`
        );
      }
      if (action === "delete_file") {
        return `Move to Trash\n${target} (${await describeTarget(target)})\n\nNo bytes are erased immediately; Finder can put it back.`;
      }
      return clip(`${action} ${target}`.trim());
    }

    if (type === "shell") {
      const cwd = expandPath(String(args.cwd ?? allowedRoots()[0]));
      return clip(`Command\n$ ${String(args.command ?? "")}\n\ncwd: ${cwd}\n\nThe command runs as you, with this app's environment.`);
    }

    if (type === "calendar") {
      if (action === "create_event") {
        return [
          "Create Calendar event",
          field("Title", args.summary),
          field("Starts", args.start),
          field("Ends", args.end),
          field("Calendar", args.calendar ?? "Calendar"),
        ]
          .filter(Boolean)
          .join("\n");
      }
      return `Calendar · ${action}`;
    }

    if (type === "email") {
      if (action === "draft_mail") {
        const body = String(args.body ?? "");
        return clip(
          [
            "Create Mail draft (not sent)",
            field("To", args.to),
            field("Subject", args.subject),
            field("Account", args.account),
            "",
            body.length > 1_500 ? `${body.slice(0, 1_500)}\n…` : body,
          ]
            .filter((line) => line !== null && line !== undefined)
            .join("\n")
        );
      }
      return `Mail · ${action}`;
    }

    if (type === "web" && action === "open_in_browser") {
      return `Open in your default browser\n${String(args.url ?? "")}`;
    }

    if (type === "mcp") return clip(`MCP tool ${action}\n${JSON.stringify(args, null, 2)}`);

    return clip(JSON.stringify(args, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Preview unavailable: ${message}\n\n${JSON.stringify(args, null, 2)}`;
  }
}
