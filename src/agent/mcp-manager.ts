import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { mcpServers } from "../utils/config";
import logger from "../utils/logger";
import type { McpServerConfig, McpServerStatus } from "../utils/types";
import { validateJsonSchema } from "./tool-registry";

const CONNECT_TIMEOUT_MS = 20_000;
const CALL_TIMEOUT_MS = 60_000;

interface Connection {
  config: McpServerConfig;
  client: Client | null;
  state: McpServerStatus["state"];
  tools: Tool[];
  error?: string;
  stderr: string;
}

export interface McpCallResult {
  text: string;
}

/**
 * Local stdio MCP servers only: they are spawned as child processes, inherit no
 * network credentials beyond their configured env, and every call goes through the
 * same approval + audit path as built-in tools.
 */
export class McpManager {
  private connections = new Map<string, Connection>();
  private queue: Promise<void> = Promise.resolve();
  private stopped = false;

  async initialize(): Promise<void> {
    this.stopped = false;
    await this.refresh();
  }

  /** Re-reads config and reconnects every server. Serialized so toggles cannot race. */
  refresh(): Promise<void> {
    const run = async () => {
      await this.closeAll();
      if (this.stopped) return;
      const configs = mcpServers();
      this.connections = new Map(
        configs.map((config) => [
          config.id,
          { config, client: null, state: config.enabled ? "connecting" : "stopped", tools: [], stderr: "" } satisfies Connection,
        ])
      );
      await Promise.all(
        configs.filter((config) => config.enabled).map((config) => this.connect(config.id))
      );
    };
    this.queue = this.queue.then(run, run);
    return this.queue;
  }

  private async connect(id: string): Promise<void> {
    const connection = this.connections.get(id);
    if (!connection) return;
    const { config } = connection;
    connection.state = "connecting";
    connection.error = undefined;
    connection.tools = [];
    connection.stderr = "";

    const client = new Client({ name: "openmonkey", version: "0.9.0" }, { capabilities: {} });
    connection.client = client;

    try {
      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: { ...getDefaultEnvironment(), ...(config.env ?? {}) },
        stderr: "pipe",
      });
      transport.stderr?.on("data", (chunk: Buffer) => {
        connection.stderr = `${connection.stderr}${chunk.toString()}`.slice(-2_000);
      });

      await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, `${config.name} did not start in time`);
      const listed = await withTimeout(client.listTools(), CONNECT_TIMEOUT_MS, `${config.name} did not list tools in time`);
      connection.tools = listed.tools ?? [];
      connection.state = "ready";
      logger.info("mcp.connected", { id, tools: connection.tools.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      connection.state = "error";
      connection.error = connection.stderr.trim() || message;
      connection.tools = [];
      logger.warn("mcp.connect.failed", { id, error: message });
      await client.close().catch(() => undefined);
      connection.client = null;
    }
  }

  async restart(id: string): Promise<McpServerStatus[]> {
    const run = async () => {
      const connection = this.connections.get(id);
      if (!connection) return;
      await this.closeOne(connection);
      const configured = mcpServers().find((server) => server.id === id);
      if (!configured) {
        this.connections.delete(id);
        return;
      }
      connection.config = configured;
      connection.state = configured.enabled ? "connecting" : "stopped";
      if (configured.enabled) await this.connect(id);
    };
    this.queue = this.queue.then(run, run);
    await this.queue;
    return this.status();
  }

  private async closeOne(connection: Connection): Promise<void> {
    const client = connection.client;
    connection.client = null;
    connection.tools = [];
    connection.state = "stopped";
    if (client) await client.close().catch(() => undefined);
  }

  private async closeAll(): Promise<void> {
    await Promise.all([...this.connections.values()].map((connection) => this.closeOne(connection)));
    this.connections.clear();
  }

  status(): McpServerStatus[] {
    return [...this.connections.values()].map((connection) => ({
      id: connection.config.id,
      name: connection.config.name,
      enabled: connection.config.enabled,
      state: connection.state,
      toolCount: connection.tools.length,
      tools: connection.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        readOnly: tool.annotations?.readOnlyHint === true,
      })),
      error: connection.error,
    }));
  }

  /** Protocol text appended to the model's system prompt. */
  protocolText(): string {
    const ready = [...this.connections.values()].filter((connection) => connection.state === "ready");
    if (!ready.length) return "";

    const lines: string[] = [];
    for (const connection of ready) {
      for (const tool of connection.tools.slice(0, 40)) {
        const summary = (tool.description ?? "MCP tool").replace(/\s+/g, " ").slice(0, 180);
        lines.push(`- mcp.${connection.config.id}.${tool.name} — ${summary} (arguments follow the server's JSON schema)`);
      }
    }
    if (!lines.length) return "";
    return `\nMCP tools available from enabled local servers:\n${lines.slice(0, 80).join("\n")}`;
  }

  private resolve(action: string): { connection: Connection; tool: Tool } | { error: string } {
    const separator = action.indexOf(".");
    if (separator <= 0) return { error: `MCP action must look like "<server>.<tool>", got "${action}"` };
    const serverId = action.slice(0, separator);
    const toolName = action.slice(separator + 1);
    const connection = this.connections.get(serverId);
    if (!connection) return { error: `Unknown MCP server "${serverId}"` };
    if (!connection.config.enabled) return { error: `MCP server "${serverId}" is disabled` };
    if (connection.state !== "ready") {
      return { error: `MCP server "${serverId}" is ${connection.state}: ${connection.error ?? "not connected"}` };
    }
    const tool = connection.tools.find((candidate) => candidate.name === toolName);
    if (!tool) return { error: `MCP server "${serverId}" has no tool "${toolName}"` };
    return { connection, tool };
  }

  isReadOnly(action: string): boolean {
    const resolved = this.resolve(action);
    return "tool" in resolved && resolved.tool.annotations?.readOnlyHint === true;
  }

  serverPolicy(action: string): McpServerConfig["approval"] | null {
    const resolved = this.resolve(action);
    return "connection" in resolved ? resolved.connection.config.approval : null;
  }

  validate(action: string, args: Record<string, unknown>): string | null {
    const resolved = this.resolve(action);
    if ("error" in resolved) return resolved.error;
    return validateJsonSchema(resolved.tool.inputSchema, args);
  }

  async call(action: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpCallResult> {
    const resolved = this.resolve(action);
    if ("error" in resolved) throw new Error(resolved.error);
    if (!resolved.connection.client) throw new Error(`MCP server "${resolved.connection.config.id}" is not connected`);

    const result = await resolved.connection.client.callTool(
      { name: resolved.tool.name, arguments: args },
      undefined,
      { timeout: CALL_TIMEOUT_MS, signal }
    );

    const content = Array.isArray(result.content) ? result.content : [];
    const text = content
      .map((item) => {
        const entry = item as { type?: string; text?: string };
        return entry.type === "text" && typeof entry.text === "string" ? entry.text : `[${entry.type ?? "content"}]`;
      })
      .join("\n")
      .trim();
    const fallback = result.structuredContent ? JSON.stringify(result.structuredContent, null, 2) : "";
    const output = text || fallback || "(tool returned no text)";
    if (result.isError) throw new Error(output.slice(0, 4_000));
    return { text: output };
  }

  async shutdown(): Promise<void> {
    this.stopped = true;
    await this.closeAll();
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}
