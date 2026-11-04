import { test, after } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { McpManager } from "../../src/agent/mcp-manager";
import config from "../../src/utils/config";
import type { McpServerConfig } from "../../src/utils/types";

const fixture = path.resolve(__dirname, "../fixtures/mcp-server.mjs");

const server = (changes: Partial<McpServerConfig> = {}): McpServerConfig => ({
  id: "fixture",
  name: "Fixture server",
  command: process.execPath,
  args: [fixture],
  enabled: true,
  approval: "ask",
  ...changes,
});

const write = (servers: McpServerConfig[]): void => config.set("mcp", { servers });

let manager: McpManager | null = null;

after(async () => {
  await manager?.shutdown();
  write([]);
});

test("a local server starts, lists its tools and keeps what it printed", async () => {
  write([server()]);
  manager = new McpManager();
  await manager.initialize();

  const status = manager.status();
  assert.equal(status.length, 1);
  const live = status[0];
  assert.equal(live.state, "ready");
  assert.equal(live.toolCount, 2);
  assert.equal(live.policy, "ask");
  assert.match(live.stderr ?? "", /fixture server ready/);
  assert.deepEqual(
    live.tools.map((tool) => tool.name).sort(),
    ["search_notes", "write_note"]
  );
  assert.equal(live.tools.find((tool) => tool.name === "search_notes")?.readOnly, true);
  assert.equal(live.tools.find((tool) => tool.name === "write_note")?.readOnly, false);
});

test("a tool can hold a rule of its own without restarting the server", async () => {
  write([server({ toolPolicies: { write_note: "allow" } })]);
  await manager!.sync();

  assert.equal(manager!.policyFor("fixture.write_note"), "allow");
  assert.equal(manager!.policyFor("fixture.search_notes"), "ask");

  const live = manager!.status()[0];
  assert.equal(live.state, "ready");
  assert.equal(live.tools.find((tool) => tool.name === "write_note")?.policy, "allow");
  assert.equal(live.tools.find((tool) => tool.name === "search_notes")?.policy, "ask");
  // The server printed its banner once; a restart would print it twice.
  assert.equal((live.stderr ?? "").match(/fixture server ready/g)?.length, 1);
});

test("a rule for a server that is not there answers nothing", () => {
  assert.equal(manager!.policyFor("nowhere.tool"), null);
  assert.equal(manager!.policyFor("no-dot"), null);
});

test("a server that cannot start says why", async () => {
  write([server({ command: path.join(__dirname, "no-such-server") })]);
  await manager!.sync();

  const live = manager!.status()[0];
  assert.equal(live.state, "error");
  assert.ok(live.error && live.error.length > 0);
});

test("a tool call reaches the server", async () => {
  write([server()]);
  await manager!.sync();

  const result = await manager!.call("fixture.search_notes", { query: "release" });
  assert.match(result.text, /echo search_notes/);
  assert.match(result.text, /release/);
});

test("a disabled server is not called and holds no tools", async () => {
  write([server({ enabled: false })]);
  await manager!.sync();

  const live = manager!.status()[0];
  assert.equal(live.state, "stopped");
  assert.equal(live.toolCount, 0);
  await assert.rejects(() => manager!.call("fixture.search_notes", { query: "release" }));
});
