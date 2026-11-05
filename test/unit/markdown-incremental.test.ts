import { test } from "node:test";
import assert from "node:assert/strict";
import { createIncrementalParser, parseMarkdown, type Block } from "../../src/renderer/markdown";
import {
  cachedCharacterCount,
  clearMarkdownCache,
  parseMarkdownCached,
} from "../../src/renderer/markdown-cache";

const kinds = (blocks: Block[]): string[] => blocks.map((block) => block.kind);

test("a growing answer keeps the blocks that are finished", () => {
  const parser = createIncrementalParser();
  parser.update("First paragraph.\n\n");
  const first = parser.blocks;
  assert.equal(first.length, 1);

  parser.update("First paragraph.\n\nSecond paragraph.");
  assert.equal(parser.blocks.length, 2);
  assert.equal(parser.blocks[0], first[0], "the finished block is the same one");
});

test("the growing answer is parsed the same way as the whole one", () => {
  const parser = createIncrementalParser();
  const text = "# Title\n\nSome prose\n\n- one\n- two\n\n```js\nconst a = 1;\n```\n\nLast line";
  let grown = "";
  for (const character of text) {
    grown += character;
    parser.update(grown);
  }
  assert.deepEqual(kinds(parser.blocks), kinds(parseMarkdown(text)));
  assert.deepEqual(
    parser.blocks.map((block) => block.offset),
    parseMarkdown(text).map((block) => block.offset)
  );
});

test("an answer that was replaced is parsed again", () => {
  const parser = createIncrementalParser();
  parser.update("The first answer.\n\n");
  parser.update("A different answer entirely.");
  assert.deepEqual(kinds(parser.blocks), ["paragraph"]);
  assert.equal((parser.blocks[0] as { spans: { text: string }[] }).spans[0].text, "A different answer entirely.");
});

test("a fence that is still open is parsed again", () => {
  const parser = createIncrementalParser();
  parser.update("Text.\n\n```js\nconst a =");
  assert.equal(parser.blocks.length, 2, "the open fence is a block of its own");

  parser.update("Text.\n\n```js\nconst a = 1;\n```");
  assert.equal(parser.blocks.length, 2);
  assert.equal(parser.blocks[1].kind, "code");
  assert.equal((parser.blocks[1] as { code: string }).code, "const a = 1;");
});

test("a quote that grows is parsed again", () => {
  const parser = createIncrementalParser();
  parser.update("> a quoted line");
  parser.update("> a quoted line\n> and another");
  assert.equal(parser.blocks.length, 1);
  assert.equal(parser.blocks[0].kind, "quote");
});

test("the same answer is parsed once and kept", () => {
  clearMarkdownCache();
  const first = parseMarkdownCached("A short answer.");
  const second = parseMarkdownCached("A short answer.");
  assert.equal(first, second, "the second read hands back the first parse");
  assert.ok(cachedCharacterCount() > 0);
  clearMarkdownCache();
  assert.equal(cachedCharacterCount(), 0);
});
