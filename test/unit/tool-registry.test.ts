import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TOOL_DEFINITIONS,
  describeBuiltInTools,
  getToolDefinition,
  toolKey,
  validateJsonSchema,
  validateToolArguments,
  type ToolDefinition,
} from "../../src/agent/tool-registry";

const sample: ToolDefinition = {
  type: "file",
  action: "sample",
  description: "A sample tool.",
  mutating: false,
  timeoutMs: 1_000,
  args: {
    path: { type: "string", required: true, maxLength: 10 },
    mode: { type: "string", enum: ["read", "write"] },
    count: { type: "number", min: 1, max: 10 },
    force: { type: "boolean" },
    tags: { type: "string[]" },
    folder: { type: "string", default: "" },
  },
};

test("tool definitions are unique and complete", () => {
  const keys = TOOL_DEFINITIONS.map((definition) => toolKey(definition.type, definition.action));
  assert.equal(new Set(keys).size, keys.length);
  for (const definition of TOOL_DEFINITIONS) {
    assert.ok(definition.action.trim(), `${definition.type} has an action`);
    assert.ok(definition.description.trim(), `${toolKey(definition.type, definition.action)} has a description`);
  }
  assert.equal(getToolDefinition("file", "read_file")?.action, "read_file");
  assert.equal(getToolDefinition("file", "missing"), undefined);
});

test("the protocol text names every tool and hides memory on request", () => {
  const all = describeBuiltInTools();
  for (const definition of TOOL_DEFINITIONS) {
    assert.ok(all.includes(toolKey(definition.type, definition.action)));
  }
  const withoutMemory = describeBuiltInTools(false);
  assert.equal(withoutMemory.includes("memory."), false);
});

test("valid arguments are normalized", () => {
  const result = validateToolArguments(sample, {
    path: "/tmp/a",
    mode: "read",
    count: "3",
    force: "true",
    tags: ["one", "two"],
  });
  assert.deepEqual(result, {
    arguments: { path: "/tmp/a", mode: "read", count: 3, force: true, tags: ["one", "two"], folder: "" },
  });
});

test("a default fills an omitted optional argument", () => {
  const result = validateToolArguments(sample, { path: "/tmp/a" });
  assert.ok(!("error" in result));
  assert.equal(result.arguments.folder, "");
});

test("unknown arguments are rejected by name", () => {
  const result = validateToolArguments(sample, { path: "/tmp/a", surprise: 1 });
  assert.deepEqual(result, { error: "unknown argument: surprise" });
});

test("a missing required argument is named", () => {
  const result = validateToolArguments(sample, {});
  assert.deepEqual(result, { error: 'missing required argument "path" (string)' });
});

test("an empty required string is refused", () => {
  const result = validateToolArguments(sample, { path: "   " });
  assert.deepEqual(result, { error: '"path" cannot be empty' });
});

test("string length, enums, number bounds and array shapes are enforced", () => {
  assert.match((validateToolArguments(sample, { path: "x".repeat(11) }) as { error: string }).error, /too long/);
  assert.match((validateToolArguments(sample, { path: "a", mode: "append" }) as { error: string }).error, /must be one of/);
  assert.match((validateToolArguments(sample, { path: "a", count: 0 }) as { error: string }).error, /at least 1/);
  assert.match((validateToolArguments(sample, { path: "a", count: 11 }) as { error: string }).error, /at most 10/);
  assert.match((validateToolArguments(sample, { path: "a", count: "many" }) as { error: string }).error, /must be a number/);
  assert.match((validateToolArguments(sample, { path: "a", force: "yes" }) as { error: string }).error, /must be a boolean/);
  assert.match((validateToolArguments(sample, { path: "a", tags: ["ok", 2] }) as { error: string }).error, /array of strings/);
});

test("a non-object argument payload is refused", () => {
  assert.deepEqual(validateToolArguments(sample, ["path"]), { error: "arguments must be a JSON object" });
  assert.deepEqual(validateToolArguments(sample, null), { error: "arguments must be a JSON object" });
});

test("the image tools are declared the way the web tool reads them", () => {
  const search = getToolDefinition("web", "image_search");
  assert.ok(search);
  assert.equal(search.mutating, false);
  assert.deepEqual(validateToolArguments(search, { query: "snow leopard" }), {
    arguments: { query: "snow leopard", count: 8 },
  });
  assert.match(
    (validateToolArguments(search, { query: "cats", count: 500 }) as { error: string }).error,
    /at most 20/
  );

  const save = getToolDefinition("web", "save_image");
  assert.ok(save);
  // A download writes a file, so it is the one image action the user approves.
  assert.equal(save.mutating, true);
  assert.match((validateToolArguments(save, { url: "https://x/y.png" }) as { error: string }).error, /"path"/);
});

test("the inspect action is declared the way the file tool reads it", () => {
  const inspect = getToolDefinition("file", "inspect");
  assert.ok(inspect);
  // Measuring never writes, so it must not raise the approval dialog on every report.
  assert.equal(inspect.mutating, false);
  assert.deepEqual(validateToolArguments(inspect, {}), {
    arguments: { path: "", pattern: "*" },
  });
  assert.deepEqual(validateToolArguments(inspect, { path: "~/Documents/sales", pattern: "*.csv" }), {
    arguments: { path: "~/Documents/sales", pattern: "*.csv" },
  });
  assert.ok(describeBuiltInTools().includes("file.inspect"), "the prompt lists it, or the model cannot use it");
});

test("the publish action is declared the way the publisher reads it", () => {
  const list = getToolDefinition("publish", "list_channels");
  assert.ok(list);
  // Listing the channels only reads the settings, so it must not stop for approval.
  assert.equal(list.mutating, false);

  const post = getToolDefinition("publish", "post");
  assert.ok(post);
  // A post goes out under the user's own account and cannot be taken back.
  assert.equal(post.mutating, true);
  const channel = post.args.channel;
  assert.equal(channel?.required, true);
  assert.deepEqual(channel?.enum, ["telegram", "reddit", "bluesky", "mastodon"]);
  assert.equal(post.args.title?.required, undefined);
  assert.equal(post.args.imageUrl?.required, undefined);
  assert.ok(describeBuiltInTools().includes("publish.post"), "the prompt lists it, or the model cannot use it");
});

test("JSON Schema validation covers the MCP subset", () => {
  const schema = {
    type: "object",
    properties: {
      url: { type: "string", minLength: 5 },
      depth: { type: "integer" },
      link: { $ref: "#/$defs/link" },
    },
    required: ["url"],
    additionalProperties: false,
    $defs: { link: { type: "object", properties: { href: { type: "string" } }, required: ["href"] } },
  };
  assert.equal(validateJsonSchema(schema, { url: "https://example.com", depth: 2, link: { href: "x" } }), null);
  assert.equal(validateJsonSchema(schema, {}), 'missing required field "url"');
  assert.equal(validateJsonSchema(schema, { url: "https://example.com", extra: 1 }), "unknown field: extra");
  assert.equal(validateJsonSchema(schema, { url: "https://example.com", link: {} }), "link: missing required field \"href\"");
  assert.equal(validateJsonSchema(schema, { url: "https://example.com", depth: 1.5 }), "depth: must be an integer");
  assert.equal(validateJsonSchema({ anyOf: [{ type: "string" }, { type: "number" }] }, "x"), null);
});
