import { test, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import storage from "../../src/utils/storage";
import { MemoryManager } from "../../src/agent/memory-manager";
import type { Message } from "../../src/utils/types";

storage.init();
const manager = new MemoryManager();

after(() => {
  storage.close();
});

let seq = 0;
const say = (conversationId: string, role: "user" | "assistant", content: string) => {
  const id = `mem_${role}_${++seq}`;
  const message: Message = { id, role, content, timestamp: new Date() };
  storage.saveMessage(conversationId, message);
};

const thread = (title: string) => {
  const conversation = storage.createConversation(title);
  say(conversation.id, "user", "What did we decide about the release?");
  say(conversation.id, "assistant", "We ship on Friday with the model check first.");
  return conversation;
};

test("a fact is rewritten in place and keeps the label that cites it", () => {
  const fact = manager.addFact("I write TypeScript and prefer pnpm");
  const edited = manager.editFact(fact.id, "I write TypeScript and prefer pnpm over npm");
  assert.equal(edited.id, fact.id);
  assert.equal(edited.content, "I write TypeScript and prefer pnpm over npm");
  assert.equal(manager.getFacts().some((entry) => entry.id === fact.id), true);
  assert.equal(manager.getFacts().length, 1);
});

test("an empty fact is refused rather than saved blank", () => {
  assert.throws(() => manager.editFact("missing", "   "), /Write a fact/);
  assert.throws(() => manager.addFact("   "), /Write a fact/);
});

test("a summary the user wrote replaces the digest the model reads", () => {
  const conversation = thread("Release plan");
  const before = manager.summaries().find((entry) => entry.conversationId === conversation.id);
  assert.ok(before);
  assert.equal(before.edited, false);
  assert.ok(before.derived.includes("release"));

  manager.editSummary(conversation.id, "The release ships Friday; the model check runs first.");
  const after = manager.summaries().find((entry) => entry.conversationId === conversation.id);
  assert.ok(after);
  assert.equal(after.edited, true);
  assert.equal(after.content, "The release ships Friday; the model check runs first.");
  // The derived digest stays visible, so nothing is hidden behind the note.
  assert.equal(after.derived, before.derived);

  const prompt = manager.promptSection(null);
  assert.ok(prompt.includes("The release ships Friday; the model check runs first."));
  assert.ok(prompt.includes('[chat "Release plan"]'));
});

test("recall off keeps a chat out of the prompt, and back in again", () => {
  const conversation = thread("Quiet chat");
  manager.editSummary(conversation.id, "A note that should disappear when recall is off.");
  assert.ok(manager.promptSection(null).includes("A note that should disappear when recall is off."));

  manager.setRecall(conversation.id, false);
  assert.equal(manager.promptSection(null).includes("A note that should disappear when recall is off."), false);
  const summary = manager.summaries().find((entry) => entry.conversationId === conversation.id);
  assert.equal(summary?.recall, false);
  // The note itself is still there; only the injection stops.
  assert.equal(summary?.content, "A note that should disappear when recall is off.");

  manager.setRecall(conversation.id, true);
  assert.ok(manager.promptSection(null).includes("A note that should disappear when recall is off."));
});

test("forgetting a chat drops the summary and turns recall off", () => {
  const conversation = thread("Forgotten chat");
  manager.editSummary(conversation.id, "This should be gone.");
  manager.forgetSummary(conversation.id);

  const summary = manager.summaries().find((entry) => entry.conversationId === conversation.id);
  assert.ok(summary);
  assert.equal(summary.edited, false);
  assert.equal(summary.recall, false);
  assert.equal(summary.content, summary.derived);
  assert.equal(manager.promptSection(null).includes("This should be gone."), false);
});

test("the chat in front of the user is never injected into its own prompt", () => {
  const conversation = thread("Current chat");
  manager.editSummary(conversation.id, "The active chat excludes itself.");
  assert.equal(manager.promptSection(conversation.id).includes("The active chat excludes itself."), false);
});

test("a citation resolves to the fact behind it", async () => {
  const fact = manager.addFact("The staging host is called fox");
  const preview = await manager.citationPreview(`[fact:${fact.id.slice(-6)}]`);
  assert.equal(preview.kind, "fact");
  assert.equal(preview.found, true);
  assert.equal(preview.text, "The staging host is called fox");
});

test("a citation to a fact that is gone says so instead of guessing", async () => {
  const fact = manager.addFact("This one will be deleted");
  const label = `[fact:${fact.id.slice(-6)}]`;
  manager.deleteFact(fact.id);
  const preview = await manager.citationPreview(label);
  assert.equal(preview.found, false);
  assert.equal(preview.text.includes("deleted"), true);
});

test("a citation resolves to the summary of the chat it names", async () => {
  const conversation = thread("Cited chat");
  manager.editSummary(conversation.id, "The cited summary the user wrote.");
  const preview = await manager.citationPreview('[chat "Cited chat"]');
  assert.equal(preview.kind, "chat");
  assert.equal(preview.found, true);
  assert.equal(preview.text, "The cited summary the user wrote.");
});

test("a file citation reads the passage around the line", async () => {
  const file = path.join(process.env.HOME ?? "", "Documents", "browser-note.txt");
  const lines = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`);
  fs.writeFileSync(file, lines.join("\n"), "utf8");

  const preview = await manager.citationPreview(`[file:${file}:10]`);
  assert.equal(preview.kind, "file");
  assert.equal(preview.found, true);
  assert.ok(preview.text.includes("line 10"));
  assert.ok(preview.text.includes("line 4"));
  assert.ok(preview.text.includes("line 16"));
  assert.equal(preview.startLine, 4);
  assert.equal(preview.endLine, 16);
});

test("a file citation outside the allowed folders resolves to nothing", async () => {
  const preview = await manager.citationPreview("[file:/etc/hosts:1]");
  assert.equal(preview.found, false);
  assert.ok(preview.text.includes("could not be read"));
});

test("text that is not a citation is reported as such", async () => {
  const preview = await manager.citationPreview("not a citation");
  assert.equal(preview.found, false);
  assert.equal(preview.title, "Not a citation");
});

test("the browser sees every fact and every chat worth recalling", () => {
  const snapshot = manager.snapshot();
  assert.ok(snapshot.facts.length >= 1);
  assert.ok(snapshot.summaries.length >= 1);
  assert.ok(snapshot.summaries.every((entry) => entry.derived.length > 0));
  assert.ok(snapshot.summaries.every((entry) => typeof entry.recall === "boolean"));
  assert.ok(snapshot.summaries.every((entry) => entry.content.length > 0));
});
