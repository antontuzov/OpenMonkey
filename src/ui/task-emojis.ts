import type { TaskType } from "../utils/types";

/**
 * The spec listed 💻 for both shell and code and a blank glyph for email; these are
 * distinct so a glance at the task panel says which tool is busy.
 */
export const TASK_EMOJIS: Record<TaskType, string> = {
  file: "📁",
  web: "🌐",
  shell: "💻",
  email: "📧",
  calendar: "📅",
  mcp: "🔌",
  search: "🔍",
  code: "⌨️",
  writing: "✍️",
  analysis: "📊",
  automation: "⚙️",
};

export function emojiFor(type: TaskType): string {
  return TASK_EMOJIS[type] ?? "🔧";
}

const TYPE_KEYWORDS: Array<[TaskType, RegExp]> = [
  ["calendar", /\b(calendar|schedule|meeting|event|appointment|reminder)\b/i],
  ["email", /\b(email|mail|inbox|smtp|draft)\b/i],
  ["file", /\b(file|folder|directory|save|read|write|move|rename|organize|document)\b/i],
  ["shell", /\b(shell|terminal|command|bash|zsh|run\s+this|script)\b/i],
  ["web", /\b(web|website|url|http|browse|download|fetch\s+page)\b/i],
  ["code", /\b(code|program|function|debug|compile|typescript|python)\b/i],
  ["writing", /\b(write|draft|essay|summary|paragraph|compose)\b/i],
  ["analysis", /\b(analyze|analyse|data|stats|count|report|compare)\b/i],
  ["automation", /\b(automate|automation|batch|cron|watch\s+folder)\b/i],
];

export function detectTaskType(description: string): TaskType {
  for (const [type, pattern] of TYPE_KEYWORDS) {
    if (pattern.test(description)) return type;
  }
  return "search";
}
