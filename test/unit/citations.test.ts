import { test } from "node:test";
import assert from "node:assert/strict";
import { findCitations, parseCitation } from "../../src/utils/citations";
import { parseInline } from "../../src/renderer/markdown";

test("a citation label is read for what it points at", () => {
  const fact = parseCitation("[fact:a1b2c3]");
  assert.deepEqual(fact, { kind: "fact", label: "[fact:a1b2c3]", id: "a1b2c3" });

  const file = parseCitation("[file:/Users/me/notes.md:42]");
  assert.deepEqual(file, { kind: "file", label: "[file:/Users/me/notes.md:42]", path: "/Users/me/notes.md", line: 42 });

  const chat = parseCitation('[chat "Trip to Lisbon"]');
  assert.deepEqual(chat, { kind: "chat", label: '[chat "Trip to Lisbon"]', title: "Trip to Lisbon" });
});

test("text that is not a citation resolves to nothing", () => {
  assert.equal(parseCitation("just some words"), null);
  assert.equal(parseCitation("[fact:]"), null);
  assert.equal(parseCitation("[file:/a/b.ts]"), null);
  assert.equal(parseCitation('[chat "unterminated]'), null);
});

test("every citation in an answer is found, in order, once", () => {
  const answer =
    'First [fact:aaa111]. Then [file:/tmp/notes.md:12]. And [chat "Kickoff"] plus [fact:aaa111] again.';
  const found = findCitations(answer);
  assert.deepEqual(
    found.map((citation) => citation.kind),
    ["fact", "file", "chat", "fact"]
  );
  assert.equal(found[1].kind === "file" ? found[1].line : 0, 12);
  assert.equal(found[2].kind === "chat" ? found[2].title : "", "Kickoff");
});

test("an answer keeps its citation as one span, not as loose text", () => {
  const spans = parseInline("I used [fact:aaa111] and [chat \"Kickoff\"] here.");
  assert.deepEqual(
    spans.map((span) => span.kind),
    ["text", "citation", "text", "citation", "text"]
  );
  assert.equal(spans[1].kind === "citation" ? spans[1].text : "", "[fact:aaa111]");
  assert.equal(spans[3].kind === "citation" ? spans[3].text : "", '[chat "Kickoff"]');
});

test("a citation inside bold text survives the emphasis", () => {
  const spans = parseInline("**See [fact:aaa111]**");
  assert.equal(spans[0].kind, "strong");
  const inner = parseInline(spans[0].kind === "strong" ? spans[0].text : "");
  assert.deepEqual(
    inner.map((span) => span.kind),
    ["text", "citation"]
  );
});

test("an ordinary link is still a link, not a citation", () => {
  const spans = parseInline("[docs](https://example.com)");
  assert.deepEqual(spans, [{ kind: "link", text: "docs", href: "https://example.com" }]);
});
