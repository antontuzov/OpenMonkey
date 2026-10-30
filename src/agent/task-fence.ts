import { detectTaskType } from "../ui/task-emojis";
import type { TaskRequest, TaskType } from "../utils/types";

const TASK_BLOCK = /```task\s*([\s\S]*?)```/g;
const UNCLOSED_BLOCK = /```task\s*([\s\S]*)$/;

export interface TaskFenceResult {
  visibleText: string;
  requests: TaskRequest[];
  errors: string[];
  /** Blocks whose JSON only parsed after dropping surplus closing braces. */
  repaired: number;
}

interface ParsedOne {
  request?: TaskRequest;
  error?: string;
  repaired?: boolean;
}

/** Pull the ```task blocks out of a model reply; the rest is what the user sees. */
export function parseTaskBlocks(response: string): TaskFenceResult {
  const requests: TaskRequest[] = [];
  const errors: string[] = [];
  let repaired = 0;

  const absorb = (parsed: ParsedOne) => {
    if (parsed.request) requests.push(parsed.request);
    if (parsed.error) errors.push(parsed.error);
    if (parsed.repaired) repaired += 1;
  };

  let visibleText = response.replace(TASK_BLOCK, (_match, body: string) => {
    absorb(parseTaskRequest(String(body).trim()));
    return "";
  });

  const unclosed = UNCLOSED_BLOCK.exec(visibleText);
  if (unclosed) {
    const parsed = parseTaskRequest(String(unclosed[1]).trim());
    absorb(parsed);
    errors.push(parsed.error ?? "Tool block was not closed with ```; nothing was run");
    visibleText = visibleText.replace(UNCLOSED_BLOCK, "");
  }

  return { visibleText: visibleText.trim(), requests, errors, repaired };
}

export function parseTaskRequest(body: string): ParsedOne {
  if (!body) return { error: "Empty tool block; nothing was run" };
  try {
    const { value, repaired } = parseLenientJson(body);
    const parsed = value as Partial<TaskRequest>;
    if (!parsed || typeof parsed.action !== "string" || !parsed.action.trim()) {
      return { error: `Tool request needs an "action" string: ${body.slice(0, 200)}` };
    }
    const type = (parsed.type ?? detectTaskType(parsed.summary ?? "")) as TaskType;
    return {
      request: {
        type,
        action: parsed.action,
        arguments: (parsed.arguments ?? {}) as Record<string, unknown>,
        summary: parsed.summary ?? `${type}.${parsed.action}`,
        mutating: false,
      },
      repaired,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: `Tool request is not valid JSON (${message}): ${body.slice(0, 200)}` };
  }
}

function parseLenientJson(body: string): { value: unknown; repaired: boolean } {
  try {
    return { value: JSON.parse(body), repaired: false };
  } catch (error) {
    // Bonsai sometimes echoes the block with a doubled closing brace. Drop only the
    // surplus braces after the object's true end; anything else still fails loudly.
    const repaired = stripSurplusBraces(body);
    if (!repaired) throw error;
    return { value: JSON.parse(repaired), repaired: true };
  }
}

function stripSurplusBraces(body: string): string | null {
  const start = body.indexOf("{");
  if (start !== 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        const rest = body.slice(i + 1);
        return /^[}\s]*$/.test(rest) && rest.includes("}") ? body.slice(0, i + 1) : null;
      }
    }
  }
  return null;
}
