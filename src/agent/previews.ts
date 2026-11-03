import * as fs from "node:fs/promises";
import { allowedRoots } from "../utils/config";
import { describeCommand } from "../utils/command-notes";
import type { TaskRequest, ToolPreview } from "../utils/types";
import { expandPath } from "./tools/paths";
import { MAX_DIFF_LINES, diffCounts, lineDiff, renderDiff } from "../utils/diff";

const MAX_PREVIEW = 4_000;
const MAX_SNIPPET = 600;

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

const field = (label: string, value: unknown): { label: string; value: string } | null =>
  value === undefined || value === null || value === "" ? null : { label, value: String(value) };

const present = (entries: ({ label: string; value: string } | null)[]): { label: string; value: string }[] =>
  entries.filter((entry): entry is { label: string; value: string } => entry !== null);

/** The tools the preview may consult, so it can show what a tool will actually find. */
export interface PreviewTools {
  /** Fetches a page the way the web tool would, so the preview and the tool agree. */
  fetchPage?: (url: string) => Promise<{ title: string; text: string }>;
}

/**
 * Human-facing preview shown before an approval. It never mutates anything and
 * never throws: a preview failure falls back to the raw arguments.
 */
export async function buildPreview(
  request: TaskRequest,
  args: Record<string, unknown>,
  tools: PreviewTools = {}
): Promise<ToolPreview> {
  try {
    const { type, action } = request;

    if (type === "file") {
      const target = typeof args.path === "string" ? expandPath(args.path) : "";
      if (action === "write_file") {
        const before = await readText(target);
        const after = String(args.content ?? "");
        if (before === null) {
          const diff = lineDiff("", after);
          const counts = diff ? diffCounts(diff) : { added: 0, removed: 0 };
          return {
            kind: "diff",
            title: `New file ${target}`,
            body: diff
              ? clip(renderDiff(diff, `New file ${target} (+${counts.added} / -0)`))
              : `New file ${target}\n+ ${after.split("\n").length} lines, ${bytes(Buffer.byteLength(after))}`,
            added: counts.added,
            removed: 0,
            note: `Nothing is overwritten; this file does not exist yet. It will hold ${bytes(
              Buffer.byteLength(after)
            )}.`,
          };
        }
        const diff = lineDiff(before, after);
        if (!diff) {
          return {
            kind: "diff",
            title: `Modify ${target}`,
            body: `${target} has more than ${MAX_DIFF_LINES} lines; the file will be replaced entirely (${after.split("\n").length} new lines).`,
            added: after.split("\n").length,
            removed: before.split("\n").length,
            note: "The replaced text stays in this task's change record.",
          };
        }
        const counts = diffCounts(diff);
        return {
          kind: "diff",
          title: `Modify ${target}`,
          body: clip(renderDiff(diff, `Modify ${target} (+${counts.added} / -${counts.removed})`)),
          added: counts.added,
          removed: counts.removed,
          note: "The replaced text stays in this task's change record, so the change can be undone by hand.",
        };
      }
      if (action === "append_file") {
        const content = String(args.content ?? "");
        const before = (await readText(target)) ?? "";
        const diff = lineDiff(before, `${before}${content}`);
        const counts = diff ? diffCounts(diff) : { added: content.split("\n").length, removed: 0 };
        return {
          kind: "diff",
          title: `Append to ${target}`,
          body: clip(
            diff
              ? renderDiff(diff, `Append to ${target} (+${counts.added} / -${counts.removed})`)
              : `Append to ${target}\n+ ${content.split("\n").length} lines\n\n${content.split("\n").slice(0, 30).join("\n")}`
          ),
          added: counts.added,
          removed: counts.removed,
          note: "The lines before the append stay where they are.",
        };
      }
      if (action === "move_file" || action === "copy_file") {
        const source = expandPath(String(args.source ?? ""));
        const destination = expandPath(String(args.destination ?? ""));
        const destinationState = await describeTarget(destination);
        return {
          kind: "fields",
          title: action === "move_file" ? "Move a file" : "Copy a file",
          fields: [
            { label: "From", value: `${source} (${await describeTarget(source)})` },
            { label: "To", value: `${destination} (${destinationState})` },
          ],
          note:
            destinationState === "does not exist yet"
              ? action === "move_file"
                ? "The file keeps its contents; only its place changes."
                : "A copy is made; the original stays where it is."
              : "The destination already exists, so the tool refuses rather than overwrites it.",
        };
      }
      if (action === "delete_file") {
        return {
          kind: "fields",
          title: "Move to Trash",
          fields: [{ label: "File", value: `${target} (${await describeTarget(target)})` }],
          note: "No bytes are erased immediately; Finder can put it back.",
        };
      }
      if (action === "create_folder") {
        return {
          kind: "fields",
          title: "Create a folder",
          fields: [{ label: "Folder", value: target }],
          note: "Missing parent folders are created too.",
        };
      }
      return { kind: "text", title: `${action} ${target}`.trim(), body: JSON.stringify(args, null, 2) };
    }

    if (type === "shell") {
      const command = String(args.command ?? "");
      const cwd = expandPath(String(args.cwd ?? allowedRoots()[0]));
      const note = describeCommand(command);
      return {
        kind: "command",
        title: "Run a shell command",
        command,
        cwd,
        explanation: note.summary,
        risks: note.risks,
        note: "The command runs as you, with this app's environment.",
      };
    }

    if (type === "calendar") {
      if (action === "create_event") {
        return {
          kind: "fields",
          title: "Create a calendar event",
          fields: present([
            field("Title", args.summary),
            field("Starts", args.start),
            field("Ends", args.end),
            field("Calendar", args.calendar ?? "Calendar"),
          ]),
          note: "The event lands in the calendar you choose; nobody is notified.",
        };
      }
      return {
        kind: "fields",
        title: "Read the calendar",
        fields: present([field("Calendar", args.calendar)]),
        note: "Nothing is changed.",
      };
    }

    if (type === "email") {
      if (action === "draft_mail") {
        const body = String(args.body ?? "");
        return {
          kind: "fields",
          title: "Create a mail draft",
          fields: present([field("To", args.to), field("Subject", args.subject), field("Account", args.account)]),
          body: body.length > 1_500 ? `${body.slice(0, 1_500)}\n…` : body,
          note: "A draft is saved in Mail. Nothing is sent, so you read it before it goes.",
        };
      }
      return {
        kind: "fields",
        title: "Read the mailbox",
        fields: present([field("Account", args.account)]),
        note: "Nothing is changed.",
      };
    }

    if (type === "web") {
      if (action === "fetch_page") {
        const url = String(args.url ?? "");
        if (tools.fetchPage) {
          try {
            const page = await tools.fetchPage(url);
            return {
              kind: "page",
              title: "Show a web page",
              url,
              heading: page.title,
              snippet: clip(page.text.slice(0, MAX_SNIPPET)),
            };
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            return {
              kind: "fields",
              title: "Show a web page",
              fields: [{ label: "Page", value: url }],
              note: `The page could not be read for this preview: ${reason}`,
            };
          }
        }
        return {
          kind: "fields",
          title: "Show a web page",
          fields: [{ label: "Page", value: url }],
          note: "The page is fetched over HTTPS when you allow this.",
        };
      }
      if (action === "search") {
        return {
          kind: "fields",
          title: "Search the web",
          fields: present([field("Query", args.query)]),
          note: "The query goes to DuckDuckGo; the results come back as links and titles.",
        };
      }
      return {
        kind: "fields",
        title: "Open in your browser",
        fields: [{ label: "Page", value: String(args.url ?? "") }],
        note: "It opens in your own browser; the app fetches nothing.",
      };
    }

    if (type === "mcp") {
      const separator = action.indexOf(".");
      const server = separator > 0 ? action.slice(0, separator) : "mcp";
      const tool = separator > 0 ? action.slice(separator + 1) : action;
      return {
        kind: "fields",
        title: `MCP tool ${tool}`,
        fields: [{ label: "Server", value: server }],
        body: clip(JSON.stringify(args, null, 2)),
        note: "The server runs on this Mac; the tool is called with the arguments above.",
      };
    }

    return { kind: "text", title: `${type}.${action}`, body: clip(JSON.stringify(args, null, 2)) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      kind: "text",
      title: "Preview unavailable",
      body: `Preview unavailable: ${message}\n\n${JSON.stringify(args, null, 2)}`,
    };
  }
}
