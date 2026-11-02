import Database from "better-sqlite3";

/**
 * One markdown answer, used by the e2e renderer test and by the docs screenshot.
 * It covers every block the renderer claims to know about, in the order a model
 * would realistically write them.
 */
export const QUESTION = "Give me the release plan as markdown.";

export const ANSWER = [
  "# Release plan",
  "",
  "Two **blocks** and a *list* come first, with `inline code` and a [link](https://example.com/docs).",
  "",
  "## Steps",
  "",
  "1. Freeze the branch",
  "2. Ship the build",
  "   - [x] Sign the app",
  "   - [ ] Notarise it",
  "",
  "> Ask design before the icon changes.",
  "",
  "| Surface | Blocks | Status |",
  "| :--- | :--- | ---: |",
  "| Chat | 8 | ok |",
  "| Docs | 2 | wip |",
  "",
  "```ts",
  "// counts the plan",
  "const ready: boolean = true;",
  "const total = rows.reduce((n, row) => n + row.blocks, 0);",
  "```",
  "",
  "```diff",
  "--- a/src/renderer/markdown.ts",
  "+++ b/src/renderer/markdown.ts",
  "@@ -1,2 +1,3 @@",
  "-const FENCE = /x/;",
  "+const FENCE = /y/;",
  " context line",
  "```",
].join("\n");

/**
 * Writes the thread straight into the app's SQLite file, so the answer can be checked
 * without a model behind it. Bodies stay plain text on purpose: the storage layer
 * reads an unsealed row as written, which keeps this independent of the history key.
 */
export function seedMarkdownThread(dbFile, conversationId = "conv_md_seed") {
  const now = Date.now();
  const db = new Database(dbFile);
  db.prepare(
    "INSERT OR REPLACE INTO conversations (id, title, created_at, updated_at, pinned, archived, kind) VALUES (?, ?, ?, ?, 0, 0, 'chat')"
  ).run(conversationId, "Markdown probe", now, now);
  const insert = db.prepare(
    "INSERT OR REPLACE INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)"
  );
  insert.run(`${conversationId}_q`, conversationId, "user", QUESTION, now);
  insert.run(`${conversationId}_a`, conversationId, "assistant", ANSWER, now + 1);
  db.close();
  return conversationId;
}
