import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTaskBlocks, parseTaskRequest } from "../../src/agent/task-fence";

const block = (body: string) => "```task\n" + body + "\n```";

test("plain reply has no requests and keeps its text", () => {
  const result = parseTaskBlocks("Just an answer.");
  assert.deepEqual(result.requests, []);
  assert.deepEqual(result.errors, []);
  assert.equal(result.visibleText, "Just an answer.");
  assert.equal(result.repaired, 0);
});

test("a valid block is removed from the reply and parsed", () => {
  const response = `Reading it now.\n${block('{"type":"file","action":"read","arguments":{"path":"/tmp/a.txt"},"summary":"Read a"}')}`;
  const result = parseTaskBlocks(response);
  assert.equal(result.visibleText, "Reading it now.");
  assert.equal(result.errors.length, 0);
  assert.equal(result.requests.length, 1);
  assert.equal(result.requests[0].type, "file");
  assert.equal(result.requests[0].action, "read");
  assert.deepEqual(result.requests[0].arguments, { path: "/tmp/a.txt" });
});

test("a missing type is inferred from the summary", () => {
  const result = parseTaskBlocks(block('{"action":"start","summary":"compose a draft email"}'));
  assert.equal(result.requests[0].type, "email");
});

test("Bonsai's doubled closing brace is repaired, not rejected", () => {
  const result = parseTaskBlocks(block('{"type":"shell","action":"run","arguments":{"command":"echo hi"}}}'));
  assert.equal(result.errors.length, 0);
  assert.equal(result.requests.length, 1);
  assert.equal(result.requests[0].action, "run");
  assert.equal(result.repaired, 1);
});

test("several surplus braces are repaired too", () => {
  const result = parseTaskBlocks(block('{"type":"file","action":"list","arguments":{}}}}'));
  assert.equal(result.errors.length, 0);
  assert.equal(result.requests.length, 1);
});

test("braces inside strings do not confuse the repair", () => {
  const body = '{"type":"shell","action":"run","arguments":{"command":"echo }}}","summary":"braces"}}}';
  const result = parseTaskBlocks(block(body));
  assert.equal(result.errors.length, 0);
  assert.equal(result.requests.length, 1);
  assert.equal(result.requests[0].arguments.command, "echo }}}");
});

test("genuinely broken JSON still fails with a readable error", () => {
  const result = parseTaskBlocks(block('{"type":"file","action":'));
  assert.equal(result.requests.length, 0);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /not valid JSON/);
});

test("a request without an action is refused by name", () => {
  const result = parseTaskBlocks(block('{"type":"file"}'));
  assert.equal(result.requests.length, 0);
  assert.match(result.errors[0], /needs an "action" string/);
});

test("an empty block runs nothing", () => {
  const result = parseTaskBlocks("```task\n```");
  assert.equal(result.requests.length, 0);
  assert.deepEqual(result.errors, ["Empty tool block; nothing was run"]);
});

test("an unclosed block reports the missing fence and keeps a parsable request", () => {
  const result = parseTaskBlocks('```task\n{"type":"web","action":"fetch_page","arguments":{"url":"https://example.com"}}');
  assert.equal(result.requests.length, 1);
  assert.equal(result.requests[0].action, "fetch_page");
  assert.ok(result.errors.some((error) => /not closed/.test(error)));
  assert.equal(result.visibleText.includes("```task"), false);
});

test("an unclosed block with trailing prose is reported, not executed", () => {
  const result = parseTaskBlocks('```task\n{"type":"web","action":"fetch_page"}\nstill here');
  assert.equal(result.requests.length, 0);
  assert.match(result.errors[0], /not valid JSON/);
  assert.equal(result.visibleText.includes("```task"), false);
});

test("leading prose inside the fence is not silently accepted", () => {
  const result = parseTaskRequest('Here you go: {"action":"run"}}');
  assert.equal(result.request, undefined);
  assert.match(result.error ?? "", /not valid JSON/);
});

test("two blocks in one reply are both parsed in order", () => {
  const response = `${block('{"type":"file","action":"list"}')}\nmiddle\n${block('{"type":"web","action":"search","arguments":{"query":"x"}}')}`;
  const result = parseTaskBlocks(response);
  assert.equal(result.requests.length, 2);
  assert.equal(result.requests[0].action, "list");
  assert.equal(result.requests[1].action, "search");
  assert.equal(result.visibleText, "middle");
});
