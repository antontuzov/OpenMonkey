import type {
  McpServerStatus,
  ModelStatus,
  PrivacyStatus,
  SupportBundle,
  SupportFacts,
} from "./types";

const REPO = "https://github.com/antontuzov/OpenMonkey";

/**
 * The bundle is assembled from what Settings already shows. The MCP list is mapped down
 * to four fields here — this is the one place that decides a server's command, its
 * environment and its stderr can never ride along into a public issue.
 */
export function buildSupportBundle(input: {
  facts: SupportFacts;
  privacy: PrivacyStatus;
  model: ModelStatus | null;
  mcp: McpServerStatus[];
  logTail: string;
  now?: Date;
}): SupportBundle {
  return {
    app: "OpenMonkey",
    generatedAt: (input.now ?? new Date()).toISOString(),
    facts: input.facts,
    privacy: input.privacy,
    model: input.model,
    mcp: input.mcp.map(({ name, enabled, state, toolCount }) => ({
      name,
      enabled,
      state,
      toolCount,
    })),
    logTail: input.logTail,
  };
}

/**
 * A ticket the app prepares but never sends: GitHub's own page carries the facts and the
 * three questions, and the user drags the saved bundle in and presses the button there.
 */
export function supportTicketUrl(facts: SupportFacts): string {
  const build = facts.packaged ? "" : " (from source)";
  const body = [
    `OpenMonkey ${facts.version} · macOS ${facts.macos} · ${facts.arch}${build}`,
    "",
    "**What I did**",
    "1. ",
    "",
    "**What I expected**",
    "",
    "**What happened**",
    "",
    "_Diagnostics: drag the saved `openmonkey-diagnostics-*.json` file into this issue. It holds no conversations, keys or credentials._",
  ].join("\n");
  return `${REPO}/issues/new?body=${encodeURIComponent(body)}`;
}
