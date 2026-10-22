import type { TaskType } from "../utils/types";

type ArgType = "string" | "number" | "boolean" | "string[]";

interface ArgSpec {
  type: ArgType;
  required?: boolean;
  description?: string;
  enum?: string[];
  min?: number;
  max?: number;
  maxLength?: number;
  default?: string | number | boolean | string[];
}

export interface ToolDefinition {
  type: TaskType;
  action: string;
  description: string;
  args: Record<string, ArgSpec>;
  mutating: boolean;
  timeoutMs: number;
}

const text = (description: string, maxLength = 200_000): ArgSpec => ({ type: "string", required: true, description, maxLength });
const optionalText = (description: string, maxLength = 2_048): ArgSpec => ({ type: "string", description, maxLength });
const path = (description = "Absolute path or ~/…"): ArgSpec => text(description, 1_024);
const optionalPath = (description = "Folder path; defaults to the first workspace folder"): ArgSpec => ({
  ...optionalText(description, 1_024),
  default: "",
});

/**
 * The single source of truth for what the model may call. Arguments are checked
 * against these specs before anything touches the disk or the network, and the
 * system prompt is generated from the same list so the two cannot drift.
 */
export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: "file",
    action: "list_dir",
    description: "List a folder",
    args: { path: optionalPath() },
    mutating: false,
    timeoutMs: 30_000,
  },
  {
    type: "file",
    action: "read_file",
    description: "Read a UTF-8 text file",
    args: { path: path() },
    mutating: false,
    timeoutMs: 30_000,
  },
  {
    type: "file",
    action: "write_file",
    description: "Create or replace a text file",
    args: { path: path(), content: text("Full new file contents") },
    mutating: true,
    timeoutMs: 30_000,
  },
  {
    type: "file",
    action: "append_file",
    description: "Append text to a file",
    args: { path: path(), content: text("Text to append") },
    mutating: true,
    timeoutMs: 30_000,
  },
  {
    type: "file",
    action: "move_file",
    description: "Move or rename a file or folder",
    args: { source: path("Current path"), destination: path("New path") },
    mutating: true,
    timeoutMs: 30_000,
  },
  {
    type: "file",
    action: "copy_file",
    description: "Copy a file or folder",
    args: { source: path("Current path"), destination: path("Destination path") },
    mutating: true,
    timeoutMs: 30_000,
  },
  {
    type: "file",
    action: "delete_file",
    description: "Move a file or folder to the macOS Trash",
    args: { path: path("Path to move to Trash") },
    mutating: true,
    timeoutMs: 30_000,
  },
  {
    type: "file",
    action: "create_folder",
    description: "Create a folder and any missing parents",
    args: { path: path() },
    mutating: true,
    timeoutMs: 30_000,
  },
  {
    type: "file",
    action: "find_files",
    description: "Find files by name under a folder",
    args: {
      path: optionalPath(),
      pattern: { type: "string", required: true, description: "Name pattern; * is the only wildcard", maxLength: 200 },
    },
    mutating: false,
    timeoutMs: 45_000,
  },
  {
    type: "web",
    action: "fetch_page",
    description: "Fetch a page and extract its readable text",
    args: { url: { type: "string", required: true, description: "http(s) URL", maxLength: 2_048 } },
    mutating: false,
    timeoutMs: 35_000,
  },
  {
    type: "web",
    action: "search",
    description: "Search the web and return attributed results",
    args: { query: { type: "string", required: true, description: "Search terms", maxLength: 512 } },
    mutating: false,
    timeoutMs: 35_000,
  },
  {
    type: "web",
    action: "open_in_browser",
    description: "Open a URL in the user's default browser",
    args: { url: { type: "string", required: true, description: "http(s) URL", maxLength: 2_048 } },
    mutating: true,
    timeoutMs: 10_000,
  },
  {
    type: "shell",
    action: "run_command",
    description: "Run a shell command inside the workspace",
    args: {
      command: { type: "string", required: true, description: "Command line", maxLength: 4_000 },
      cwd: optionalText("Working directory; defaults to the first workspace folder", 1_024),
    },
    mutating: true,
    timeoutMs: 75_000,
  },
  {
    type: "memory",
    action: "search_workspace",
    description: "Search indexed workspace files for relevant passages with file and line citations",
    args: { query: { type: "string", required: true, description: "What to look for", maxLength: 512 } },
    mutating: false,
    timeoutMs: 45_000,
  },
  {
    type: "calendar",
    action: "list_events",
    description: "List upcoming Calendar events",
    args: { days: { type: "number", description: "Days ahead", min: 1, max: 365, default: 7 } },
    mutating: false,
    timeoutMs: 35_000,
  },
  {
    type: "calendar",
    action: "list_calendars",
    description: "List local Calendar names",
    args: {},
    mutating: false,
    timeoutMs: 35_000,
  },
  {
    type: "calendar",
    action: "create_event",
    description: "Create a Calendar event",
    args: {
      summary: { type: "string", required: true, description: "Event title", maxLength: 500 },
      start: { type: "string", required: true, description: "Start date/time, e.g. 2026-11-02 09:00", maxLength: 100 },
      end: optionalText("End date/time", 100),
      calendar: optionalText("Calendar name; defaults to Calendar", 100),
    },
    mutating: true,
    timeoutMs: 35_000,
  },
  {
    type: "email",
    action: "list_mail",
    description: "List unread Mail messages",
    args: {
      count: { type: "number", description: "How many", min: 1, max: 50, default: 10 },
      account: optionalText("Mail account name; defaults to the first account", 200),
    },
    mutating: false,
    timeoutMs: 35_000,
  },
  {
    type: "email",
    action: "list_accounts",
    description: "List local Mail accounts",
    args: {},
    mutating: false,
    timeoutMs: 35_000,
  },
  {
    type: "email",
    action: "draft_mail",
    description: "Create a draft in Mail; never sends",
    args: {
      to: { type: "string", required: true, description: "Recipient address", maxLength: 320 },
      subject: optionalText("Subject", 500),
      body: text("Plain-text body", 20_000),
      account: optionalText("Mail account name; defaults to the first account", 200),
    },
    mutating: true,
    timeoutMs: 35_000,
  },
];

export const getToolDefinition = (type: TaskType, action: string): ToolDefinition | undefined =>
  TOOL_DEFINITIONS.find((definition) => definition.type === type && definition.action === action);

export const toolKey = (type: TaskType, action: string): string => `${type}.${action}`;

const typeLabel = (spec: ArgSpec): string => {
  let label: string;
  switch (spec.type) {
    case "string[]":
      label = "string[]";
      break;
    case "string":
      label = spec.enum ? spec.enum.join("|") : "string";
      break;
    default:
      label = spec.type;
  }
  return spec.required ? label : `${label}?`;
};

/** Compact protocol text generated from the definitions above. */
export function describeBuiltInTools(includeMemory = true): string {
  const lines = TOOL_DEFINITIONS.filter((definition) => includeMemory || definition.type !== "memory").map((definition) => {
    const args = Object.entries(definition.args)
      .map(([name, spec]) => `${name}:${typeLabel(spec)}`)
      .join(", ");
    const flag = definition.mutating ? " · needs approval" : "";
    return `- ${toolKey(definition.type, definition.action)} {${args}} — ${definition.description}${flag}`;
  });
  return lines.join("\n");
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/**
 * Returns normalized arguments or a model-readable error. Unknown keys are
 * rejected rather than silently dropped so the model can correct itself.
 */
export function validateToolArguments(
  definition: ToolDefinition,
  raw: unknown
): { arguments: Record<string, unknown> } | { error: string } {
  if (!isPlainObject(raw)) return { error: "arguments must be a JSON object" };

  const allowed = new Set(Object.keys(definition.args));
  const unknown = Object.keys(raw).filter((key) => !allowed.has(key));
  if (unknown.length) {
    return { error: `unknown argument${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}` };
  }

  const normalized: Record<string, unknown> = {};

  for (const [name, spec] of Object.entries(definition.args)) {
    let value = raw[name];

    if (value === undefined || value === null || value === "") {
      if (spec.required) return { error: `missing required argument "${name}" (${spec.type})` };
      if (spec.default !== undefined) normalized[name] = spec.default;
      continue;
    }

    if (spec.type === "number") {
      if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) value = Number(value);
      if (typeof value !== "number" || !Number.isFinite(value)) return { error: `"${name}" must be a number` };
      if (spec.min !== undefined && value < spec.min) return { error: `"${name}" must be at least ${spec.min}` };
      if (spec.max !== undefined && value > spec.max) return { error: `"${name}" must be at most ${spec.max}` };
      normalized[name] = value;
      continue;
    }

    if (spec.type === "boolean") {
      if (value === "true" || value === "false") value = value === "true";
      if (typeof value !== "boolean") return { error: `"${name}" must be a boolean` };
      normalized[name] = value;
      continue;
    }

    if (spec.type === "string[]") {
      if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
        return { error: `"${name}" must be an array of strings` };
      }
      normalized[name] = value;
      continue;
    }

    if (typeof value !== "string") return { error: `"${name}" must be a string` };
    if (!value.trim() && spec.required) return { error: `"${name}" cannot be empty` };
    if (spec.maxLength !== undefined && value.length > spec.maxLength) {
      return { error: `"${name}" is too long (${value.length} > ${spec.maxLength} characters)` };
    }
    if (spec.enum && !spec.enum.includes(value)) {
      return { error: `"${name}" must be one of: ${spec.enum.join(", ")}` };
    }
    normalized[name] = value;
  }

  return { arguments: normalized };
}

/**
 * Minimal JSON Schema support for MCP tool inputs: properties, required,
 * additionalProperties:false, items, enum, string/number bounds and local $refs.
 */
export function validateJsonSchema(schema: unknown, value: unknown, root = schema, depth = 0): string | null {
  if (depth > 8 || !isPlainObject(schema)) return null;

  if (typeof schema.$ref === "string" && schema.$ref.startsWith("#/")) {
    const resolved = schema.$ref
      .slice(2)
      .split("/")
      .reduce<unknown>((current, segment) => (isPlainObject(current) ? current[segment.replace(/~1/g, "/").replace(/~0/g, "~")] : undefined), root);
    return validateJsonSchema(resolved, value, root, depth + 1);
  }

  const alternatives = Array.isArray(schema.anyOf) ? schema.anyOf : Array.isArray(schema.oneOf) ? schema.oneOf : null;
  if (alternatives) {
    const errors = alternatives.map((option) => validateJsonSchema(option, value, root, depth + 1));
    if (errors.some((error) => error === null)) return null;
    return errors[0] ?? "does not match any allowed shape";
  }

  if (Array.isArray(schema.enum) && !schema.enum.some((item) => item === value)) {
    return `must be one of: ${schema.enum.join(", ")}`;
  }

  const type = schema.type;
  switch (type) {
    case "object": {
      if (!isPlainObject(value)) return "must be an object";
      const properties = isPlainObject(schema.properties) ? schema.properties : {};
      const required = Array.isArray(schema.required) ? schema.required.filter((key): key is string => typeof key === "string") : [];
      for (const key of required) {
        if (value[key] === undefined || value[key] === null) return `missing required field "${key}"`;
      }
      if (schema.additionalProperties === false) {
        const unknown = Object.keys(value).filter((key) => !(key in properties));
        if (unknown.length) return `unknown field${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}`;
      }
      for (const [key, property] of Object.entries(properties)) {
        if (value[key] === undefined || value[key] === null) continue;
        const error = validateJsonSchema(property, value[key], root, depth + 1);
        if (error) return `${key}: ${error}`;
      }
      return null;
    }
    case "array": {
      if (!Array.isArray(value)) return "must be an array";
      for (const item of value) {
        const error = validateJsonSchema(schema.items, item, root, depth + 1);
        if (error) return error;
      }
      return null;
    }
    case "string":
      if (typeof value !== "string") return "must be a string";
      if (typeof schema.minLength === "number" && value.length < schema.minLength) return `must be at least ${schema.minLength} characters`;
      if (typeof schema.maxLength === "number" && value.length > schema.maxLength) return `must be at most ${schema.maxLength} characters`;
      return null;
    case "integer":
      if (typeof value === "string" && Number.isInteger(Number(value))) value = Number(value);
      if (typeof value !== "number" || !Number.isInteger(value)) return "must be an integer";
      return null;
    case "number":
      if (typeof value === "string" && Number.isFinite(Number(value))) value = Number(value);
      if (typeof value !== "number" || !Number.isFinite(value)) return "must be a number";
      return null;
    case "boolean":
      if (value === "true" || value === "false") return null;
      if (typeof value !== "boolean") return "must be a boolean";
      return null;
    case "null":
      return value === null ? null : "must be null";
    default:
      return null;
  }
}
