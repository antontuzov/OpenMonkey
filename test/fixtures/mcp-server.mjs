#!/usr/bin/env node
// A throwaway stdio MCP server for the manager tests and the docs capture.
// It announces itself on stderr, so the health panel has something to show,
// and it serves one read-only tool and one that writes.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  { name: "openmonkey-fixture", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "search_notes",
      description: "Search the notes folder for a phrase.",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string", description: "What to look for" } },
        required: ["query"],
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: "write_note",
      description: "Write a note into the notes folder.",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string", description: "What to write" } },
        required: ["text"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => ({
  content: [
    { type: "text", text: `echo ${request.params.name} ${JSON.stringify(request.params.arguments ?? {})}` },
  ],
}));

process.stderr.write("fixture server ready on stdio\n");
await server.connect(new StdioServerTransport());
