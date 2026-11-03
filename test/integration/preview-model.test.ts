import { test, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import os from "node:os";
import { buildPreview } from "../../src/agent/previews";
import type { TaskRequest, ToolPreview } from "../../src/utils/types";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "openmonkey-preview-"));
const notes = path.join(root, "notes.md");
fs.writeFileSync(notes, "the release ships on Friday\nthe model check runs first\n", "utf8");

const request = (type: string, action: string): TaskRequest => ({
  type: type as TaskRequest["type"],
  action,
  arguments: {},
  summary: `${type}.${action}`,
  mutating: false,
});

const preview = async (
  type: string,
  action: string,
  args: Record<string, unknown>,
  tools?: Parameters<typeof buildPreview>[2]
): Promise<ToolPreview> => await buildPreview(request(type, action), args, tools);

after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

test("a write shows the lines it replaces", async () => {
  const result = await preview("file", "write_file", {
    path: notes,
    content: "the release slipped to Monday\nthe model check runs first\n",
  });
  assert.equal(result.kind, "diff");
  if (result.kind !== "diff") return;
  assert.equal(result.removed, 1);
  assert.equal(result.added, 1);
  assert.match(result.body, /- the release ships on Friday/);
  assert.match(result.body, /\+ the release slipped to Monday/);
  assert.match(result.note ?? "", /change record/);
});

test("a new file shows what will be created", async () => {
  const result = await preview("file", "write_file", {
    path: path.join(root, "fresh.md"),
    content: "one\ntwo\nthree\n",
  });
  assert.equal(result.kind, "diff");
  if (result.kind !== "diff") return;
  assert.equal(result.removed, 0);
  assert.equal(result.added, 3);
  assert.match(result.body, /\+ one/);
});

test("an append shows only the new lines", async () => {
  const result = await preview("file", "append_file", {
    path: notes,
    content: "nothing else changes\n",
  });
  assert.equal(result.kind, "diff");
  if (result.kind !== "diff") return;
  assert.equal(result.removed, 0);
  assert.equal(result.added, 1);
  assert.match(result.body, /\+ nothing else changes/);
});

test("a delete says the file can be put back", async () => {
  const result = await preview("file", "delete_file", { path: notes });
  assert.equal(result.kind, "fields");
  if (result.kind !== "fields") return;
  assert.match(result.title, /Trash/);
  assert.match(result.note ?? "", /Finder can put it back/);
});

test("a move shows where the file goes", async () => {
  const result = await preview("file", "move_file", {
    source: notes,
    destination: path.join(root, "moved.md"),
  });
  assert.equal(result.kind, "fields");
  if (result.kind !== "fields") return;
  assert.equal(result.fields.length, 2);
  assert.match(result.fields[1].value, /moved\.md/);
  assert.match(result.fields[1].value, /does not exist yet/);
});

test("a shell command explains itself", async () => {
  const result = await preview("shell", "run_command", { command: "ls -la" });
  assert.equal(result.kind, "command");
  if (result.kind !== "command") return;
  assert.equal(result.command, "ls -la");
  assert.match(result.explanation, /lists the files in a folder/);
  assert.deepEqual(result.risks, []);
});

test("a shell command that could bite says so", async () => {
  const result = await preview("shell", "run_command", { command: "sudo rm -rf /tmp/scratch" });
  assert.equal(result.kind, "command");
  if (result.kind !== "command") return;
  assert.ok(result.risks.length >= 2);
  assert.match(result.risks.join(" "), /superuser/);
});

test("a calendar event shows what will be created", async () => {
  const result = await preview("calendar", "create_event", {
    summary: "Release review",
    start: "2026-11-10 10:00",
    calendar: "Work",
  });
  assert.equal(result.kind, "fields");
  if (result.kind !== "fields") return;
  assert.match(result.title, /calendar event/);
  assert.deepEqual(
    result.fields.map((entry) => entry.label),
    ["Title", "Starts", "Calendar"]
  );
  assert.match(result.note ?? "", /nobody is notified/);
});

test("a mail draft shows the body and says it is not sent", async () => {
  const result = await preview("email", "draft_mail", {
    to: "team@example.com",
    subject: "Release notes",
    body: "The release slips to Monday.",
  });
  assert.equal(result.kind, "fields");
  if (result.kind !== "fields") return;
  assert.match(result.body ?? "", /slips to Monday/);
  assert.match(result.note ?? "", /Nothing is sent/);
});

test("a page preview shows the page", async () => {
  const result = await preview(
    "web",
    "fetch_page",
    { url: "https://example.com/release" },
    { fetchPage: async () => ({ title: "Release plan", text: "We ship on Friday." }) }
  );
  assert.equal(result.kind, "page");
  if (result.kind !== "page") return;
  assert.equal(result.url, "https://example.com/release");
  assert.equal(result.heading, "Release plan");
  assert.match(result.snippet, /We ship on Friday/);
});

test("a page that cannot be read still shows the address", async () => {
  const result = await preview(
    "web",
    "fetch_page",
    { url: "https://example.com/gone" },
    {
      fetchPage: async () => {
        throw new Error("HTTP 404 from https://example.com/gone");
      },
    }
  );
  assert.equal(result.kind, "fields");
  if (result.kind !== "fields") return;
  assert.equal(result.fields[0].value, "https://example.com/gone");
  assert.match(result.note ?? "", /HTTP 404/);
});

test("an mcp call names the server and the tool", async () => {
  const result = await preview("mcp", "files.search", { query: "release" });
  assert.equal(result.kind, "fields");
  if (result.kind !== "fields") return;
  assert.match(result.title, /MCP tool search/);
  assert.equal(result.fields[0].value, "files");
  assert.match(result.body ?? "", /release/);
});
