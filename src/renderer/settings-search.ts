import { ACCENTS } from "./constants";
import { t, type StringKey } from "./i18n";
import { stemHit } from "./text-match";
import { THEME_TOKENS } from "../utils/theme-tokens";
import type { SettingsPage } from "../utils/types";
import { BONSAI_4B } from "../models/catalog";

/**
 * One entry per setting row the pages render, so the sidebar box finds a setting by
 * name instead of making the user know which page it lives on. The e2e suite walks every
 * page and compares the rendered row titles with this list, so a renamed row shows up
 * as a failing test rather than a setting that silently stops being searchable.
 */
export interface SettingEntry {
  page: SettingsPage;
  /** A row titled with a translated string. */
  key?: StringKey;
  /** A row whose title is written in the page itself. */
  label?: string;
  /** Words people type that no visible copy contains. */
  keywords?: string[];
}

export interface SettingHit {
  page: SettingsPage;
  label: string;
}

const ENTRIES: SettingEntry[] = [
  // Profile
  { page: "profile", label: "Display name", keywords: ["agent name", "rename", "assistant name"] },
  { page: "profile", label: "Personality", keywords: ["tone", "character", "system prompt"] },
  { page: "profile", key: "appearance.avatar", keywords: ["mood", "logo", "face", "monkey"] },
  { page: "profile", label: "Primary model", keywords: ["at a glance", "backend", "answering"] },
  { page: "profile", label: "Tool approvals", keywords: ["at a glance", "runs freely", "per tool"] },
  { page: "profile", label: "Stored history", keywords: ["at a glance", "saved", "memory only"] },

  // Appearance
  { page: "appearance", key: "appearance.theme", keywords: ["dark mode", "light", "system", "surface"] },
  { page: "appearance", key: "appearance.oled", keywords: ["oled", "true black", "pixels off", "dark mode"] },
  { page: "appearance", key: "appearance.textSize", keywords: ["zoom", "scale", "font", "bigger text"] },
  { page: "appearance", key: "appearance.densityLight", keywords: ["compact", "spacing", "roomy", "density"] },
  { page: "appearance", key: "appearance.densityDark", keywords: ["compact", "spacing", "roomy", "density"] },
  { page: "appearance", key: "appearance.coloursTheme", keywords: ["custom colours", "palette", "tokens", "repaint"] },
  ...THEME_TOKENS.map(
    (token): SettingEntry => ({
      page: "appearance",
      key: `appearance.token.${token.token}` as StringKey,
      keywords: ["colour", "color", "custom", "palette"],
    })
  ),
  { page: "appearance", key: "appearance.coloursReset", keywords: ["built-in", "default colours", "undo"] },
  { page: "appearance", key: "appearance.motion", keywords: ["reduce motion", "animation", "springs"] },
  { page: "appearance", key: "appearance.language", keywords: ["russian", "english", "arabic", "locale", "translate"] },
  { page: "appearance", key: "appearance.sendKey", keywords: ["enter", "return", "send", "newline", "keyboard", "cmd"] },
  ...ACCENTS.map((accent): SettingEntry => ({
    page: "appearance",
    label: accent.name,
    keywords: ["accent", "colour", "color", "highlight"],
  })),

  // Desktop
  { page: "desktop", key: "desktop.launchAtLogin", keywords: ["startup", "boot", "login item", "open at login"] },
  { page: "desktop", key: "desktop.keepRunning", keywords: ["tray", "menu bar", "close window", "background"] },
  { page: "desktop", key: "desktop.notifyApprovals", keywords: ["notification", "alert", "banner"] },
  { page: "desktop", key: "desktop.notifyDone", keywords: ["notification", "finished", "complete"] },
  { page: "desktop", key: "desktop.notifyActions", keywords: ["allow", "deny", "banner", "approve from the notification"] },
  { page: "desktop", key: "desktop.quietHours", keywords: ["quiet", "night", "do not disturb", "silent hours"] },
  { page: "desktop", key: "desktop.updateChannel", keywords: ["beta", "prerelease", "auto update", "new version"] },
  { page: "desktop", key: "desktop.updateStatus", keywords: ["check for updates", "new version", "download", "restart"] },
  { page: "desktop", key: "desktop.releaseNotes", keywords: ["changelog", "what's new", "notes", "changes"] },
  { page: "desktop", key: "desktop.rollback", keywords: ["older version", "previous build", "downgrade", "go back"] },
  { page: "desktop", key: "desktop.quickAskToggle", keywords: ["option space", "popover", "global shortcut", "hotkey"] },
  { page: "desktop", key: "nav.newChat", keywords: ["shortcut", "command n", "keyboard"] },
  { page: "desktop", key: "palette.title", keywords: ["shortcut", "command k", "search chats", "keyboard"] },
  { page: "desktop", key: "settings.title", keywords: ["shortcut", "command comma", "keyboard"] },
  { page: "desktop", key: "shortcuts.activity", keywords: ["shortcut", "panel", "task monitor"] },
  { page: "desktop", key: "shortcuts.focus", keywords: ["shortcut", "composer", "input"] },
  { page: "desktop", key: "shortcuts.stop", keywords: ["shortcut", "cancel", "abort"] },
  { page: "desktop", key: "shortcuts.quick", keywords: ["shortcut", "quick ask"] },

  // Approvals
  { page: "approvals", label: "Run tool actions without asking", keywords: ["auto approve", "master switch", "yolo"] },
  { page: "approvals", label: "Current policy", keywords: ["master override", "summary", "what runs on its own"] },
  { page: "approvals", label: "Files", keywords: ["policy", "permission", "read", "write", "trash"] },
  { page: "approvals", label: "Web", keywords: ["policy", "fetch", "browse", "internet"] },
  { page: "approvals", label: "Shell", keywords: ["policy", "command", "terminal", "bash"] },
  { page: "approvals", label: "Calendar", keywords: ["policy", "events", "apple events"] },
  { page: "approvals", label: "Mail", keywords: ["policy", "unread", "draft"] },
  { page: "approvals", label: "MCP tools", keywords: ["policy", "extension", "server"] },
  { page: "approvals", label: "Publishing", keywords: ["policy", "post", "telegram", "reddit", "bluesky", "mastodon"] },

  // Memory
  { page: "memory", label: "Local memory", keywords: ["facts", "recall", "pin", "digest", "summary"] },
  { page: "memory", label: "Workspace search", keywords: ["index", "retrieval", "rag", "files", "embedding"] },
  { page: "memory", label: "Index status", keywords: ["rebuild", "reindex", "clear index"] },

  // Workspace
  { page: "workspace", label: "Documents", keywords: ["folder", "allowed", "sandbox", "path"] },
  { page: "workspace", label: "Downloads", keywords: ["folder", "allowed", "sandbox", "path"] },
  { page: "workspace", label: "Desktop", keywords: ["folder", "allowed", "sandbox", "path"] },

  // Permissions
  { page: "permissions", label: "Calendar", keywords: ["macos", "access", "tcc", "apple events", "granted"] },
  { page: "permissions", label: "Mail", keywords: ["macos", "access", "tcc", "granted"] },
  {
    page: "permissions",
    label: "Approval and completion alerts",
    keywords: ["notification permission", "macos", "banner"],
  },

  // Privacy
  { page: "privacy", key: "privacy.historyKey", keywords: ["keychain", "safe storage", "aes", "vault"] },
  { page: "privacy", key: "privacy.saveHistory", keywords: ["record", "store", "log chats"] },
  { page: "privacy", key: "privacy.encrypt", keywords: ["aes", "at rest", "cipher", "encryption"] },
  { page: "privacy", key: "privacy.autoDelete", keywords: ["retention", "prune", "expire", "auto delete"] },
  { page: "privacy", key: "privacy.passphrase", keywords: ["password", "lock", "unlock"] },
  { page: "privacy", key: "privacy.autoLock", keywords: ["idle", "sleep", "screen lock", "timeout"] },
  { page: "privacy", key: "privacy.erase", keywords: ["delete everything", "wipe", "destroy", "reset history"] },
  { page: "privacy", key: "privacy.backup", keywords: ["export", "import", "restore", "portability"] },
  { page: "privacy", key: "privacy.restoreSettings", keywords: ["import", "backup", "settings"] },
  { page: "privacy", key: "privacy.backupFormatTitle", keywords: ["schema", "version", "format"] },
  { page: "privacy", key: "privacy.database", keywords: ["sqlite", "size", "file", "storage"] },
  { page: "privacy", key: "privacy.logs", keywords: ["file", "folder", "support"] },
  {
    page: "privacy",
    key: "privacy.copies",
    keywords: ["backup", "restore", "integrity", "crash", "corrupt", "recovery", "safe mode"],
  },
  { page: "privacy", key: "diagnostics.logs", keywords: ["redacted", "rotate", "tail", "debug"] },
  {
    page: "privacy",
    key: "diagnostics.a11y",
    keywords: ["wcag", "contrast", "screen reader", "alt text", "keyboard", "vision"],
  },
  { page: "privacy", key: "safeMode.title", keywords: ["safe mode", "restart", "startup", "crash", "broken"] },
  { page: "privacy", key: "diagnostics.network", keywords: ["offline", "requests", "block network", "no internet"] },

  // Publishing
  { page: "publishing", label: "Telegram chat", keywords: ["telegram", "channel id", "chat id", "bot"] },
  { page: "publishing", label: "Telegram bot token", keywords: ["token", "botfather", "secret", "keychain"] },
  { page: "publishing", label: "Reddit subreddit", keywords: ["reddit", "subreddit", "community", "r/"] },
  { page: "publishing", label: "Reddit credentials", keywords: ["reddit", "script app", "client id", "password", "login"] },
  { page: "publishing", label: "Bluesky handle", keywords: ["bluesky", "atproto", "account", "bsky"] },
  { page: "publishing", label: "Bluesky app password", keywords: ["bluesky", "app password", "secret", "keychain", "atproto"] },
  { page: "publishing", label: "Mastodon instance", keywords: ["mastodon", "instance", "server", "fediverse", "https"] },
  { page: "publishing", label: "Mastodon access token", keywords: ["mastodon", "token", "secret", "keychain", "fediverse"] },
  { page: "publishing", label: "Posting policy", keywords: ["approval", "audit", "upvote", "spam", "policy"] },
  { page: "publishing", label: "Room left this hour", keywords: ["rate limit", "cap", "quota", "posts"] },

  // Model
  { page: "model", label: `${BONSAI_4B.name} GGUF`, keywords: ["weights", "download", "sha", "verify", "delete"] },
  { page: "model", label: "MLX server", keywords: ["runtime", "backend", "apple silicon"] },
  { page: "model", label: "Generation speed", keywords: ["benchmark", "tokens per second", "tps", "measure"] },
  { page: "model", label: "Runtime", keywords: ["backend", "provider", "auto", "bonsai", "mlx"] },
  { page: "model", label: "MLX", keywords: ["server", "apple silicon", "8 bit"] },
  { page: "model", label: "Memory this needs", keywords: ["ram", "weights", "context", "kv cache", "estimate"] },
  { page: "model", label: "Temperature", keywords: ["creativity", "randomness", "generation"] },
  { page: "model", label: "Max tokens", keywords: ["length", "limit", "answer size", "generation"] },
];

const haystack = (entry: SettingEntry, label: string): string =>
  [label, ...(entry.keywords ?? [])].join(" ").toLowerCase();

/**
 * Every row the settings pages render, with the words that also reach it. The command
 * palette ranks the same rows, so the two searches never drift apart.
 */
export function settingEntries(): Array<{ page: SettingsPage; label: string; keywords: string[] }> {
  return ENTRIES.map((entry) => ({
    page: entry.page,
    label: entry.key ? t(entry.key) : (entry.label ?? ""),
    keywords: entry.keywords ?? [],
  }));
}

/** Best match first: a row named for the words, then one that merely mentions them. */
export function searchSettings(query: string, limit = 8): SettingHit[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const scored = ENTRIES.map((entry) => {
    const label = entry.key ? t(entry.key) : (entry.label ?? "");
    const lower = label.toLowerCase();
    const text = haystack(entry, label);
    const rank = lower.startsWith(needle)
      ? 0
      : lower.includes(needle) || stemHit(lower, needle)
        ? 1
        : text.includes(needle) || stemHit(text, needle)
          ? 2
          : -1;
    return { entry, label, rank };
  }).filter((hit) => hit.rank >= 0);

  // Two accent swatches or three shortcut rows can share a rank; keep pages apart so the
  // list never shows four results from one page the user is already on.
  scored.sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label));
  const seen = new Set<string>();
  const hits: SettingHit[] = [];
  for (const hit of scored) {
    const id = `${hit.entry.page}:${hit.label}`;
    if (seen.has(id)) continue;
    seen.add(id);
    hits.push({ page: hit.entry.page, label: hit.label });
    if (hits.length >= limit) break;
  }
  return hits;
}

export default searchSettings;
