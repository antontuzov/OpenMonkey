/**
 * The help a user can search from inside the app. Every entry names a heading in a
 * document that lives in this repository, so the link that opens is the same text a
 * reader would find on GitHub.
 */
export interface DocEntry {
  /** The file, relative to the repository root. */
  doc: string;
  /** The heading inside that file, as GitHub writes its anchor. */
  anchor: string;
  /** The heading itself, which is what a reader searches for. */
  title: string;
  /** Words that should find this entry even when the heading does not carry them. */
  keywords: string[];
}

const REPO = "https://github.com/antontuzov/OpenMonkey";

export const DOCS_INDEX: DocEntry[] = [
  {
    doc: "docs/SUPPORT.md",
    anchor: "common-answers",
    title: "Common answers",
    keywords: [
      "gatekeeper",
      "quarantine",
      "xattr",
      "blocked",
      "wont open",
      "update",
      "updater",
      "passphrase",
      "forgot",
      "approval",
      "network",
      "download",
      "tray",
      "single instance",
      "uninstall",
      "brew",
      "homebrew",
      "two copies",
      "reinstall",
    ],
  },
  {
    doc: "docs/SUPPORT.md",
    anchor: "before-you-report",
    title: "Before you report",
    keywords: ["report", "bug", "issue", "version", "os", "logs", "reproduce", "screenshot"],
  },
  {
    doc: "docs/SUPPORT.md",
    anchor: "reporting-from-inside-the-app",
    title: "Reporting from inside the app",
    keywords: ["diagnostics", "bundle", "ticket", "issue", "support page", "search the docs"],
  },
  {
    doc: "docs/SUPPORT.md",
    anchor: "support-policy-for-09",
    title: "Support policy for 0.9",
    keywords: ["support", "policy", "response time", "paid", "tier", "refund", "guarantee"],
  },
  {
    doc: "docs/SUPPORT.md",
    anchor: "security-reports",
    title: "Security reports",
    keywords: ["vulnerability", "security", "private", "advisory", "cve", "disclosure"],
  },
  {
    doc: "docs/MODELS.md",
    anchor: "requirements-per-backend",
    title: "Requirements per backend",
    keywords: ["model", "weights", "download", "memory", "ram", "mlx", "llama.cpp", "size", "disk"],
  },
  {
    doc: "docs/MODELS.md",
    anchor: "compatibility",
    title: "Compatibility",
    keywords: ["model", "apple silicon", "intel", "architecture", "compatible", "gpu"],
  },
  {
    doc: "docs/MODELS.md",
    anchor: "memory-and-startup-budget",
    title: "Memory and startup budget",
    keywords: ["memory", "ram", "startup", "slow", "budget", "tokens per second"],
  },
  {
    doc: "README.md",
    anchor: "download",
    title: "Download",
    keywords: ["download", "dmg", "install", "release", "latest", "casks", "cask"],
  },
  {
    doc: "README.md",
    anchor: "requirements",
    title: "Requirements",
    keywords: ["requirements", "macos", "system", "apple silicon", "supported"],
  },
  {
    doc: "README.md",
    anchor: "get-started",
    title: "Get started",
    keywords: ["get started", "first run", "onboarding", "setup", "install", "brew", "source"],
  },
  {
    doc: "README.md",
    anchor: "troubleshooting",
    title: "Troubleshooting",
    keywords: ["trouble", "broken", "problem", "fix", "not working", "stuck", "crash"],
  },
  {
    doc: "README.md",
    anchor: "support",
    title: "Support",
    keywords: ["help", "diagnostics", "ticket", "report", "issue", "docs search"],
  },
  {
    doc: "README.md",
    anchor: "privacy-and-approvals",
    title: "Privacy and approvals",
    keywords: ["privacy", "approvals", "permissions", "tools", "agent", "local"],
  },
  {
    doc: "README.md",
    anchor: "configuration",
    title: "Configuration",
    keywords: ["config", "configuration", "settings", "json", "edit", "file"],
  },
  {
    doc: "docs/PRIVACY.md",
    anchor: "what-stays-on-this-mac",
    title: "What stays on this Mac",
    keywords: ["privacy", "data", "stored", "local", "cloud", "telemetry"],
  },
  {
    doc: "docs/PRIVACY.md",
    anchor: "encryption-at-rest",
    title: "Encryption at rest",
    keywords: ["encryption", "keychain", "passphrase", "safe storage", "key"],
  },
  {
    doc: "docs/PRIVACY.md",
    anchor: "retention",
    title: "Retention",
    keywords: ["retention", "prune", "delete", "keep", "history"],
  },
  {
    doc: "docs/PRIVACY.md",
    anchor: "logs",
    title: "Logs",
    keywords: ["logs", "logging", "redacted", "tail", "diagnostics"],
  },
  {
    doc: "docs/PRIVACY.md",
    anchor: "erase-everything",
    title: "Erase everything",
    keywords: ["erase", "delete everything", "wipe", "forget", "reset"],
  },
  {
    doc: "docs/LEGAL.md",
    anchor: "end-user-license-agreement",
    title: "End-user license agreement",
    keywords: ["license", "eula", "terms", "warranty", "pro", "trial"],
  },
  {
    doc: "docs/LEGAL.md",
    anchor: "refund-policy",
    title: "Refund policy",
    keywords: ["refund", "money back", "cancel", "charge", "purchase"],
  },
  {
    doc: "docs/LEGAL.md",
    anchor: "export-control",
    title: "Export control",
    keywords: ["export", "sanctions", "encryption", "law", "country"],
  },
  {
    doc: "SECURITY.md",
    anchor: "reporting-a-vulnerability",
    title: "Reporting a vulnerability",
    keywords: ["security", "vulnerability", "advisory", "cve", "disclosure", "private"],
  },
  {
    doc: "SECURITY.md",
    anchor: "scope",
    title: "Scope",
    keywords: ["scope", "in scope", "limits", "not a bug"],
  },
  {
    doc: "SECURITY.md",
    anchor: "supported-versions",
    title: "Supported versions",
    keywords: ["supported", "version", "fixed", "old build"],
  },
];

/** The document on GitHub, at the heading the entry names. */
export function docsUrl(entry: DocEntry): string {
  return `${REPO}/blob/main/${entry.doc}#${entry.anchor}`;
}

/** The two pages a support question lands on, named the way GitHub renders them. */
export const SUPPORT_LINKS = {
  policy: `${REPO}/blob/main/docs/SUPPORT.md#support-policy-for-09`,
  security: `${REPO}/blob/main/SECURITY.md#reporting-a-vulnerability`,
} as const;

const score = (entry: DocEntry, words: string[]): number => {
  const title = entry.title.toLowerCase();
  const keywords = entry.keywords.map((keyword) => keyword.toLowerCase());
  let total = 0;
  for (const word of words) {
    if (title.includes(word)) total += 3;
    if (keywords.some((keyword) => keyword === word)) total += 3;
    else if (keywords.some((keyword) => keyword.includes(word))) total += 1;
  }
  return total;
};

/**
 * The entries that answer a question, best first. A word that is part of another word
 * still counts, so "updat" finds the updater.
 */
export function searchDocs(query: string, limit = 6): DocEntry[] {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);
  if (words.length === 0) return [];
  return DOCS_INDEX.map((entry) => ({ entry, weight: score(entry, words) }))
    .filter((hit) => hit.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.entry.title.localeCompare(b.entry.title))
    .slice(0, limit)
    .map((hit) => hit.entry);
}
