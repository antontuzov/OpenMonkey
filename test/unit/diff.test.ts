import { test } from "node:test";
import assert from "node:assert/strict";
import { diffCounts, diffWindow, lineDiff, renderDiff, MAX_DIFF_LINES } from "../../src/utils/diff";

test("a new file is all additions", () => {
  const lines = lineDiff("", "one\ntwo");
  assert.deepEqual(lines, [
    { kind: "add", text: "one" },
    { kind: "add", text: "two" },
  ]);
  assert.deepEqual(diffCounts(lines!), { added: 2, removed: 0 });
});

test("a changed line shows as one removal and one addition", () => {
  const lines = lineDiff("alpha\nbeta\ngamma", "alpha\ndelta\ngamma");
  assert.deepEqual(lines, [
    { kind: "same", text: "alpha" },
    { kind: "del", text: "beta" },
    { kind: "add", text: "delta" },
    { kind: "same", text: "gamma" },
  ]);
  assert.deepEqual(diffCounts(lines!), { added: 1, removed: 1 });
});

test("the same text on both sides has no changes at all", () => {
  const lines = lineDiff("alpha\nbeta", "alpha\nbeta");
  assert.deepEqual(diffCounts(lines!), { added: 0, removed: 0 });
  assert.ok(lines!.every((line) => line.kind === "same"));
});

test("a file too big to diff line by line is refused instead of guessed", () => {
  const big = Array.from({ length: MAX_DIFF_LINES + 1 }, (_, index) => `line ${index}`).join("\n");
  assert.equal(lineDiff(big, big), null);
  assert.equal(lineDiff(big, "small"), null);
});

test("the window keeps the change and two lines around it", () => {
  const before = Array.from({ length: 10 }, (_, index) => `line ${index}`).join("\n");
  const after = before.replace("line 5", "line five");
  const window = diffWindow(lineDiff(before, after)!);
  assert.deepEqual(
    window.map((line) => line.text),
    ["line 3", "line 4", "line 5", "line five", "line 6", "line 7"]
  );
});

test("a file that changed nothing has an empty window", () => {
  assert.deepEqual(diffWindow(lineDiff("same\ntext", "same\ntext")!), []);
});

test("the rendering keeps the context around a change and drops the rest", () => {
  const before = Array.from({ length: 20 }, (_, index) => `line ${index}`).join("\n");
  const after = before.replace("line 10", "line ten");
  const rendered = renderDiff(lineDiff(before, after)!, "Modify notes.md");
  const rows = rendered.split("\n");
  assert.equal(rows[0], "Modify notes.md");
  assert.ok(rendered.includes("+ line ten"));
  assert.ok(rendered.includes("- line 10"));
  assert.ok(rendered.includes("line 8"), "two lines of context before the change");
  assert.ok(rendered.includes("line 12"), "two lines of context after the change");
  assert.ok(!rendered.includes("line 0"), "distant lines are left out");
  assert.ok(rendered.includes("…"));
});
