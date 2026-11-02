import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAttachmentPrompt, MAX_ATTACHMENTS_PER_MESSAGE } from "../../src/utils/attachments";
import type { Attachment } from "../../src/utils/types";

const text = (name: string, body: string): Attachment => ({
  name,
  bytes: body.length,
  text: body,
  kind: "text",
});

test("a message without files is sent as it was typed", () => {
  assert.equal(buildAttachmentPrompt("hello", []), "hello");
  assert.equal(buildAttachmentPrompt("  ", []), "  ");
});

test("a text file is quoted in full, with its name around it", () => {
  const prompt = buildAttachmentPrompt("what does it say?", [text("notes.txt", "the body")]);
  assert.match(prompt, /notes\.txt/);
  assert.match(prompt, /the body/);
  assert.match(prompt, /what does it say\?/);
  assert.equal(prompt.indexOf("the body") < prompt.indexOf("what does it say?"), true);
});

test("several files all reach the prompt", () => {
  const prompt = buildAttachmentPrompt("compare them", [
    text("one.md", "first body"),
    text("two.md", "second body"),
  ]);
  assert.match(prompt, /first body/);
  assert.match(prompt, /second body/);
  assert.equal(prompt.split("--- end ").length - 1, 2);
});

test("an image is named honestly: the local models read text only", () => {
  const prompt = buildAttachmentPrompt("what is this?", [
    { name: "shot.png", bytes: 2048, text: "", kind: "image" },
  ]);
  assert.match(prompt, /shot\.png/);
  assert.match(prompt, /read text only/);
  assert.equal(prompt.includes("--- shot.png ---"), false);
});

test("a long file is cut instead of flooding the context", () => {
  const prompt = buildAttachmentPrompt("read it", [text("big.txt", "x".repeat(500_000))]);
  assert.equal(prompt.length < 420_000, true);
  assert.match(prompt, /truncated/);
});

test("the composer never carries more files than the app allows", () => {
  assert.equal(MAX_ATTACHMENTS_PER_MESSAGE, 8);
});
