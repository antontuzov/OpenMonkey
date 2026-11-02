import { test } from "node:test";
import assert from "node:assert/strict";
import { parseInline, parseMarkdown, isDiff, type Block } from "../../src/renderer/markdown";
import { highlight, type Token } from "../../src/renderer/highlight";

const kinds = (blocks: Block[]): string[] => blocks.map((block) => block.kind);

test("headings, rules and paragraphs come out as their own blocks", () => {
  const blocks = parseMarkdown("# Title\n\nSome prose\n---\n###### Small");
  assert.deepEqual(kinds(blocks), ["heading", "paragraph", "rule", "heading"]);
  assert.equal((blocks[0] as { level: number }).level, 1);
  assert.equal((blocks[3] as { level: number }).level, 6);
  assert.deepEqual((blocks[1] as { spans: unknown }).spans, [{ kind: "text", text: "Some prose" }]);
});

test("lists keep order, nesting and task boxes", () => {
  const blocks = parseMarkdown(
    "- first\n- [ ] open\n  - [x] done inside\n1. one\n2. two\n   wrapped text"
  );
  assert.deepEqual(kinds(blocks), ["list", "list"]);
  const [bullets, numbered] = blocks as Array<Extract<Block, { kind: "list" }>>;
  assert.equal(bullets.ordered, false);
  assert.equal(bullets.items.length, 2);
  assert.equal(bullets.items[1].checked, false);
  assert.equal(bullets.items[1].children[0].checked, true);
  assert.deepEqual(bullets.items[1].children[0].spans, [{ kind: "text", text: "done inside" }]);
  assert.equal(numbered.ordered, true);
  assert.deepEqual(numbered.items[1].spans, [{ kind: "text", text: "two wrapped text" }]);
});

test("a numbered run nested inside bullets keeps its numbering", () => {
  const blocks = parseMarkdown("- plan\n  1. first\n  2. second");
  const list = blocks[0] as Extract<Block, { kind: "list" }>;
  assert.equal(blocks.length, 1);
  assert.equal(list.ordered, false);
  assert.equal(list.items[0].ordered, false);
  assert.equal(list.items[0].children.length, 2);
  assert.equal(list.items[0].children[0].ordered, true);
});

test("a pipe table becomes a header and rows with alignment", () => {
  const blocks = parseMarkdown("| File | Size |\n|:---|---:|\n| a.ts | 1 kB |\n| b.ts | 2 kB |");
  const table = blocks[0] as Extract<Block, { kind: "table" }>;
  assert.equal(blocks.length, 1);
  assert.deepEqual(table.aligns, ["left", "right"]);
  assert.deepEqual(table.header.map((cell) => cell.map((span) => span.text).join("")), ["File", "Size"]);
  assert.equal(table.rows.length, 2);
  assert.deepEqual(table.rows[1].map((cell) => cell.map((span) => span.text).join("")), ["b.ts", "2 kB"]);
});

test("a quote parses the blocks it wraps", () => {
  const blocks = parseMarkdown("> ## Headed quote\n> prose");
  const quote = blocks[0] as Extract<Block, { kind: "quote" }>;
  assert.equal(quote.kind, "quote");
  assert.deepEqual(kinds(quote.blocks), ["heading", "paragraph"]);
});

test("inline spans cover emphasis, code, links and bare angle links", () => {
  const spans = parseInline(
    "**bold** *italic* ~~gone~~ `code` [docs](https://example.com) <https://bare.example> plain"
  );
  assert.deepEqual(
    spans.map((span) => span.kind),
    ["strong", "text", "em", "text", "strike", "text", "code", "text", "link", "text", "link", "text"]
  );
  const anchored = spans[8];
  assert.equal("href" in anchored ? anchored.href : "", "https://example.com");
  const bare = spans[10];
  assert.equal("href" in bare ? bare.href : "", "https://bare.example");
  assert.equal(bare.text, "https://bare.example");
});

test("inline text that is not markup stays literal", () => {
  assert.deepEqual(parseInline("a * b _ c ~~ d ` e [f](g)"), [
    { kind: "text", text: "a * b _ c ~~ d ` e [f](g)" },
  ]);
});

test("a closed fence is code and an unclosed one still is, so streaming reads", () => {
  const done = parseMarkdown("before\n```ts\nconst a = 1;\n```\nafter");
  assert.deepEqual(kinds(done), ["paragraph", "code", "paragraph"]);
  const code = done[1] as Extract<Block, { kind: "code" }>;
  assert.equal(code.language, "ts");
  assert.equal(code.code, "const a = 1;");

  const streaming = parseMarkdown("before\n```ts\nconst a = 1;");
  assert.deepEqual(kinds(streaming), ["paragraph", "code"]);
});

test("blocks already written keep their offset while the answer streams in", () => {
  const full = "# Title\n\nProse here\n\n- one\n- two\n\n```sh\nls\n```";
  const before = parseMarkdown(full.slice(0, full.length - 12));
  const after = parseMarkdown(full);
  assert.deepEqual(kinds(after), ["heading", "paragraph", "list", "code"]);
  assert.deepEqual(
    before.map((block) => block.offset),
    after.slice(0, before.length).map((block) => block.offset)
  );
});

test("diffs are recognised from the language or from their lines", () => {
  assert.equal(isDiff("diff", "whatever"), true);
  assert.equal(isDiff("", "--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new"), true);
  assert.equal(isDiff("ts", "const a = 1;\nconst b = 2;"), false);
  assert.equal(isDiff("", "one line"), false);
});

test("highlighting marks keywords, strings, numbers and comments", () => {
  const lines = highlight('const url = "https://x.dev"; // note\nfn(2)', "ts");
  const significant = lines
    .flat()
    .filter((token) => token.kind !== "punct" && token.text.trim() !== "");
  assert.deepEqual(significant.map((token) => [token.kind, token.text]), [
    ["keyword", "const"],
    ["plain", "url"],
    ["string", '"https://x.dev"'],
    ["comment", "// note"],
    ["func", "fn"],
    ["number", "2"],
  ]);
});

test("a block comment and a triple-quoted string carry across lines", () => {
  const block = highlight("/* one\ntwo */", "ts");
  assert.equal(block.flat().filter((token) => token.kind === "comment").length, 2);

  const python = highlight('text = """\nstill inside\n""" # done', "python");
  const strings = python.flat().filter((token: Token) => token.kind === "string");
  assert.equal(strings.length, 3);
  assert.equal(strings[2].text, '"""');
  assert.equal(python[2].some((token) => token.kind === "comment"), true);
});

test("token text always rebuilds the source line", () => {
  const samples: Array<[string, string]> = [
    ["ts", "export function a(b: string): number {\n  return b.length * 2; // ok\n}"],
    ["sql", "SELECT id, name FROM t WHERE name LIKE '%x%' -- pick"],
    ["bash", "for f in *.ts; do echo \"$f\"; done # loop"],
    ["json", '{"a": [1, 2.5], "b": null}'],
    ["python", "def f(x):\n    return x  # twice"],
  ];
  for (const [language, code] of samples) {
    const lines = highlight(code, language);
    assert.deepEqual(lines.map((line) => line.map((token) => token.text).join("")), code.split("\n"), language);
  }
});

test("an unknown language is left alone instead of guessed", () => {
  const tokens = highlight("totally::unknown @ 1999", "klingon").flat();
  assert.equal(tokens.some((token) => ["keyword", "type", "func", "string", "comment"].includes(token.kind)), false);
  assert.equal(tokens.map((token) => token.text).join(""), "totally::unknown @ 1999");
});
