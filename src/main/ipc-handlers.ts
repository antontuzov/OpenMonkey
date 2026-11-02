import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import type { OpenMonkey } from "../agent/OpenMonkey";
import config, { ggufPath, resetPatch } from "../utils/config";
import {
  MOODS,
  MOOD_LOGOS,
  RESETTABLE_PAGES,
  type Attachment,
  type Config,
  type MenuCommand,
  type ModelPreference,
  type Mood,
  type PrivacyActionResult,
  type PrivacyStatus,
  type SettingsPage,
} from "../utils/types";
import storage, { SCHEMA_VERSION } from "../utils/storage";
import { keychainAvailable } from "../utils/secret-key";
import { networkActivity } from "../utils/network";
import { EXPORT_FILE_SUFFIX, encryptBundle, readBundleFile } from "../utils/portability";
import type { PortabilityResult } from "../utils/types";
import { ModelDownloader } from "../models/model-downloader";
import { openPermissionSettings, probeAutomation } from "./permissions";
import logger from "../utils/logger";
import type { TrayManager } from "./tray-manager";

export interface IpcDeps {
  getWindow: () => BrowserWindow | null;
  getAgent: () => OpenMonkey | null;
  getTray: () => TrayManager | null;
  showMainWindow: (command?: MenuCommand) => void;
  /** Brings the main window up on a conversation the user opened elsewhere. */
  openConversation: (conversationId: string) => void;
  showQuickAsk: () => void;
  hideQuickAsk: () => void;
  onConfigChanged: () => void;
  /** Closes the history and drops every decrypted copy this process holds. */
  lockHistory: () => void;
  /** Rebuilds the windows after the history opened or disappeared. */
  reloadHistoryViews: () => void;
}

/** The word the privacy page asks the user to type before history is destroyed. */
const ERASE_CONFIRMATION = "ERASE";
const AUTO_LOCK_CHOICES = [0, 1, 5, 15, 60];
/** A backup leaves the machine, so its passphrase is held to a higher bar than the lock's. */
const BACKUP_PASSPHRASE_MIN = 8;

const errorText = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).slice(0, 200);

const MENU_COMMANDS = new Set<MenuCommand>([
  "new-chat",
  "settings",
  "toggle-activity",
  "stop",
  "cycle-mood",
  "search-chats",
  "focus-composer",
]);

const MAX_ATTACHMENT_BYTES = 256 * 1024;
const MAX_ATTACHMENT_TEXT = 400_000;
const TEXT_EXTENSIONS = [
  "txt", "md", "markdown", "json", "csv", "tsv", "log", "yaml", "yml", "toml", "xml",
  "html", "css", "js", "jsx", "ts", "tsx", "py", "rb", "go", "rs", "swift", "sh",
  "sql", "c", "h", "cpp", "java", "env", "ini", "conf",
];

function conversationId(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("A conversation id is required");
  return value;
}

function attachmentFrom(value: unknown): Attachment | undefined {
  if (value == null) return undefined;
  if (typeof value !== "object") throw new Error("Invalid attachment");
  const { name, bytes, text } = value as Record<string, unknown>;
  if (typeof name !== "string" || !name.trim()) throw new Error("Invalid attachment name");
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) throw new Error("Invalid attachment size");
  if (typeof text !== "string" || text.length > MAX_ATTACHMENT_TEXT) throw new Error("Attachment text is too large");
  return { name: name.slice(0, 120), bytes, text };
}

/** Every renderer → main call goes through here; nothing else is exposed by the preload. */
export function registerIpcHandlers(deps: IpcDeps): void {
  const downloader = new ModelDownloader((status) => {
    deps.getWindow()?.webContents.send("model-download-status", status);
  });

  const agent = () => {
    const instance = deps.getAgent();
    if (!instance) throw new Error("OpenMonkey has not finished starting");
    return instance;
  };

  ipcMain.handle("process-message", async (_event, id: unknown, message: unknown, attachment: unknown) => {
    if (typeof message !== "string") throw new Error("Message must be text");
    const file = attachmentFrom(attachment);
    if (!message.trim() && !file) throw new Error("Empty message");
    return await agent().processUserMessage(conversationId(id), message, file);
  });

  ipcMain.handle("regenerate", (_event, id: unknown) => agent().regenerate(conversationId(id)));

  ipcMain.handle("quick-ask", async (_event, message: unknown, threadId: unknown) => {
    if (typeof message !== "string" || !message.trim()) throw new Error("Empty message");
    // The popover has no unlock field, so it stays inert rather than answering from
    // an empty context and a history it cannot write to.
    if (storage.locked) throw new Error("History is locked. Unlock OpenMonkey first.");
    const thread = typeof threadId === "string" && threadId ? threadId : undefined;
    return await agent().askQuick(message, thread);
  });

  ipcMain.handle("get-quick-asks", () => agent().listQuickAsks());

  ipcMain.handle("pin-quick-ask", (_event, id: unknown, pinned: unknown) => {
    agent().setQuickAskPinned(conversationId(id), Boolean(pinned));
  });

  ipcMain.handle("delete-quick-ask", (_event, id: unknown) => {
    agent().deleteQuickAsk(conversationId(id));
  });

  ipcMain.handle("open-quick-ask-in-chat", (_event, id: unknown) => {
    const conversation = agent().openQuickAskInChat(conversationId(id));
    if (!conversation) throw new Error("That quick ask no longer exists");
    deps.openConversation(conversation);
    return conversation;
  });

  ipcMain.handle("get-active-conversation-id", () => deps.getAgent()?.getActiveConversationId() ?? null);

  ipcMain.handle("show-main-window", (_event, command: unknown) => {
    const next = typeof command === "string" && MENU_COMMANDS.has(command as MenuCommand)
      ? (command as MenuCommand)
      : undefined;
    deps.showMainWindow(next);
  });

  ipcMain.handle("open-quick-ask", () => deps.showQuickAsk());
  ipcMain.handle("hide-quick-ask", () => deps.hideQuickAsk());

  ipcMain.handle("get-conversations", () => agent().getConversations());
  ipcMain.handle("create-conversation", () => agent().createConversation());
  ipcMain.handle("switch-conversation", (_event, id: unknown) => agent().switchConversation(conversationId(id)));
  ipcMain.handle("rename-conversation", (_event, id: unknown, title: unknown) => {
    if (typeof title !== "string") throw new Error("Title must be text");
    agent().renameConversation(conversationId(id), title);
  });
  ipcMain.handle("pin-conversation", (_event, id: unknown, pinned: unknown) => {
    agent().setConversationPinned(conversationId(id), Boolean(pinned));
  });
  ipcMain.handle("delete-conversation", (_event, id: unknown) => agent().deleteConversation(conversationId(id)));
  ipcMain.handle("search-conversations", (_event, query: unknown) => {
    if (typeof query !== "string") return [];
    return agent().searchConversations(query);
  });

  ipcMain.handle("attach-file", async () => {
    const window = deps.getWindow();
    const options: Electron.OpenDialogOptions = {
      title: "Attach a text file",
      properties: ["openFile"],
      filters: [{ name: "Text & code", extensions: TEXT_EXTENSIONS }],
    };
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return null;
    const filePath = result.filePaths[0];
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_ATTACHMENT_BYTES) {
      throw new Error(`That file is ${Math.round(stat.size / 1024)} KB. Attachments are capped at 256 KB.`);
    }
    const buffer = fs.readFileSync(filePath);
    if (buffer.subarray(0, 8192).includes(0)) {
      throw new Error("Only plain text and code files can be attached.");
    }
    return {
      name: path.basename(filePath),
      bytes: stat.size,
      text: buffer.toString("utf8"),
    } satisfies Attachment;
  });

  ipcMain.handle("get-current-mood", () => agent().getCurrentMood());

  ipcMain.handle("set-mood", (_event, mood: Mood) => {
    if (!MOOD_LOGOS[mood]) throw new Error(`Unknown mood: ${mood}`);
    agent().setCurrentMood(mood);
  });

  ipcMain.handle("cycle-mood", () => {
    const mood = agent().cycleMood();
    deps.getTray()?.showMoodChange(mood);
    return mood;
  });

  ipcMain.handle("get-moods", () => MOODS);

  ipcMain.handle("stop-generation", () => {
    deps.getAgent()?.stopGeneration();
  });

  ipcMain.handle("switch-provider", async (_event, provider: ModelPreference) => {
    if (provider !== "auto" && provider !== "mlx" && provider !== "bonsai") {
      throw new Error(`Unknown model backend: ${String(provider)}`);
    }
    await agent().switchProvider(provider);
  });

  ipcMain.handle("benchmark-model", () => agent().benchmarkModel());

  ipcMain.handle("download-model", async () => {
    const status = await downloader.download();
    if (status.phase === "done") {
      const instance = deps.getAgent();
      if (instance && instance.getStatus().state !== "ready") {
        await instance.reloadModel().catch(() => undefined);
      }
    }
    return status;
  });
  ipcMain.handle("cancel-model-download", () => downloader.cancel());
  ipcMain.handle("verify-model", () => downloader.verifyInstalled());
  ipcMain.handle("get-model-download-status", () => downloader.current);
  ipcMain.handle("reload-model", () => agent().reloadModel());
  ipcMain.handle("delete-model", async () => {
    const status = downloader.removeInstalled();
    await agent().releaseModel();
    return status;
  });

  ipcMain.handle("probe-automation", (_event, area: "calendar" | "mail") => {
    if (area !== "calendar" && area !== "mail") throw new Error(`Unknown automation target: ${area}`);
    return probeAutomation(area);
  });
  ipcMain.handle("open-permission-settings", (_event, area: "automation" | "notifications") => {
    if (area !== "automation" && area !== "notifications") throw new Error(`Unknown settings pane: ${area}`);
    return openPermissionSettings(area);
  });

  ipcMain.handle("get-agent-status", () => deps.getAgent()?.getStatus() ?? { state: "starting" as const });

  ipcMain.handle("get-model-status", async () => {
    const instance = deps.getAgent();
    if (!instance) {
      return {
        provider: null,
        preference: config.get("model").provider,
        mlxAvailable: false,
        bonsaiAvailable: fs.existsSync(ggufPath()),
        warmedUp: false,
        memory: null,
        lastBenchmark: null,
      };
    }
    return await instance.modelStatus();
  });

  ipcMain.handle("get-messages", (_event, id: unknown) => {
    const instance = deps.getAgent();
    if (!instance) return [];
    return instance.getMessages(typeof id === "string" && id ? id : undefined);
  });

  ipcMain.handle("get-tasks", () => agent().getTaskManager().getActiveTasks());

  ipcMain.handle("approve-task", (_event, requestId: string, approved: boolean, remember: boolean) => {
    agent().resolveApproval(requestId, Boolean(approved), Boolean(remember));
  });

  ipcMain.handle("cancel-task", (_event, taskId: unknown) => {
    if (typeof taskId !== "string") throw new Error("A task id is required");
    agent().cancelTask(taskId);
  });

  ipcMain.handle("get-audit-log", (_event, limit: unknown) => {
    const size = typeof limit === "number" && Number.isFinite(limit) ? limit : 100;
    return agent().getAuditLog(size);
  });

  ipcMain.handle("clear-audit-log", () => {
    agent().clearAuditLog();
  });

  ipcMain.handle("get-log-tail", (_event, lines: unknown) => {
    const count = typeof lines === "number" && Number.isFinite(lines) ? lines : 200;
    return logger.tail(count);
  });

  ipcMain.handle("clear-logs", (): PrivacyActionResult => {
    logger.clear();
    logger.info("logs.cleared");
    return { ok: true };
  });

  ipcMain.handle("export-audit-log", async () => {
    const window = deps.getWindow();
    const options: Electron.SaveDialogOptions = {
      title: "Export tool audit log",
      defaultPath: `openmonkey-audit-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    };
    const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return null;
    const entries = agent().getAuditLog(500);
    fs.writeFileSync(
      result.filePath,
      JSON.stringify({ app: "OpenMonkey", exportedAt: new Date().toISOString(), entries }, null, 2),
      { mode: 0o600 }
    );
    return result.filePath;
  });

  ipcMain.handle("choose-workspace-folder", async () => {
    const window = deps.getWindow();
    const options: Electron.OpenDialogOptions = {
      title: "Add a folder OpenMonkey may use",
      message: "Tool calls still stop for approval unless you change the policy.",
      properties: ["openDirectory", "createDirectory"],
    };
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return null;
    const folder = path.resolve(result.filePaths[0]);
    if (folder === path.parse(folder).root) throw new Error("The filesystem root cannot be a workspace folder");
    return folder;
  });

  ipcMain.handle("get-mcp-status", () => agent().getMcpStatus());
  ipcMain.handle("restart-mcp-server", (_event, id: unknown) => {
    if (typeof id !== "string" || !id.trim()) throw new Error("A server id is required");
    return agent().restartMcpServer(id);
  });

  ipcMain.handle("get-memory-snapshot", () => agent().getMemorySnapshot());
  ipcMain.handle("add-memory-fact", (_event, content: unknown) => {
    if (typeof content !== "string") throw new Error("A fact is required");
    return agent().addMemoryFact(content);
  });
  ipcMain.handle("delete-memory-fact", (_event, id: unknown) => {
    if (typeof id !== "string" || !id.trim()) throw new Error("A fact id is required");
    return agent().deleteMemoryFact(id);
  });
  ipcMain.handle("clear-memory-facts", () => agent().clearMemoryFacts());
  ipcMain.handle("rebuild-workspace-index", () => agent().rebuildWorkspaceIndex());
  ipcMain.handle("clear-workspace-index", () => agent().clearWorkspaceIndex());
  ipcMain.handle("search-workspace-memory", (_event, query: unknown) => {
    if (typeof query !== "string" || !query.trim()) throw new Error("A search query is required");
    return agent().searchWorkspaceMemory(query);
  });

  ipcMain.handle("get-config", () => config.getAll());

  // The privacy page states where the key actually lives, so it asks instead of guessing.
  ipcMain.handle("get-privacy-status", (): PrivacyStatus => {
    const activity = networkActivity();
    return {
      keySource: storage.keySource,
      keychainAvailable: keychainAvailable(),
      locked: storage.locked,
      passphraseConfigured: storage.lockable,
      autoLockMinutes: config.get("privacy").autoLockMinutes,
      schemaVersion: storage.schemaVersion(),
      networkAllowed: config.get("privacy").networkAllowed !== false,
      databaseBytes: storage.databaseBytes(),
      lastPruneAt: config.get("system").lastPruneAt,
      requestsAllowed: activity.allowed,
      requestsBlocked: activity.blocked,
    };
  });

  const passphraseFrom = (value: unknown): string | null => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    // The length floor is checked here as well as in storage: this is untrusted input.
    return trimmed.length >= 6 && trimmed.length <= 256 ? trimmed : null;
  };

  ipcMain.handle("unlock-history", (_event, passphrase: unknown) => {
    const value = typeof passphrase === "string" ? passphrase : "";
    // A wrong passphrase is simply false: nothing here can iterate the key file.
    const unlocked = storage.unlock(value);
    if (unlocked) deps.reloadHistoryViews();
    return unlocked;
  });

  ipcMain.handle("set-history-passphrase", (_event, passphrase: unknown): PrivacyActionResult => {
    const value = passphraseFrom(passphrase);
    if (!value) return { ok: false, error: "Use at least 6 characters" };
    try {
      storage.protect(value);
      logger.info("privacy.passphrase.enabled");
      return { ok: true };
    } catch (error) {
      return { ok: false, error: errorText(error) };
    }
  });

  ipcMain.handle("clear-history-passphrase", (_event, passphrase: unknown): PrivacyActionResult => {
    const value = passphraseFrom(passphrase);
    if (!value) return { ok: false, error: "Wrong passphrase" };
    if (!storage.unprotect(value)) return { ok: false, error: "Wrong passphrase" };
    // Auto-lock has nothing to do without a passphrase, so the setting says so.
    config.set("privacy", { ...config.get("privacy"), autoLockMinutes: 0 });
    logger.info("privacy.passphrase.disabled");
    return { ok: true };
  });

  ipcMain.handle("lock-history-now", () => {
    deps.lockHistory();
  });

  ipcMain.handle("erase-all-history", (_event, confirmation: unknown): PrivacyActionResult => {
    if (confirmation !== ERASE_CONFIRMATION) {
      return { ok: false, error: `Type ${ERASE_CONFIRMATION} to confirm` };
    }
    storage.eraseAll();
    logger.info("privacy.history.erased");
    deps.reloadHistoryViews();
    return { ok: true };
  });

  /**
   * A backup is opened by a passphrase the user types for the occasion, never by the
   * history key, so it stays unreadable to whoever finds the file.
   */
  ipcMain.handle("export-history-backup", async (_event, passphrase: unknown): Promise<PortabilityResult> => {
    if (storage.locked) return { ok: false, error: "History is locked. Unlock OpenMonkey first." };
    const value = typeof passphrase === "string" ? passphrase.trim() : "";
    if (value.length < BACKUP_PASSPHRASE_MIN) {
      return { ok: false, error: `Use at least ${BACKUP_PASSPHRASE_MIN} characters` };
    }
    const window = deps.getWindow();
    const options: Electron.SaveDialogOptions = {
      title: "Save an encrypted backup",
      defaultPath: `${new Date().toISOString().slice(0, 10)}${EXPORT_FILE_SUFFIX}`,
      filters: [{ name: "OpenMonkey backup", extensions: ["openmonkey-export", "txt"] }],
    };
    const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return { ok: false, cancelled: true };
    try {
      const bundle = storage.exportBundle();
      fs.writeFileSync(result.filePath, encryptBundle(bundle, value), { mode: 0o600 });
      logger.info("history.exported", {
        chats: bundle.conversations.length,
        facts: bundle.facts.length,
        schemaVersion: bundle.schemaVersion,
      });
      return {
        ok: true,
        fileName: path.basename(result.filePath),
        conversations: bundle.conversations.length,
        facts: bundle.facts.length,
      };
    } catch (error) {
      logger.error("history.export.failed");
      return { ok: false, error: errorText(error) };
    }
  });

  ipcMain.handle(
    "import-history-backup",
    async (_event, passphrase: unknown, restoreSettings: unknown): Promise<PortabilityResult> => {
      if (storage.locked) return { ok: false, error: "History is locked. Unlock OpenMonkey first." };
      const value = typeof passphrase === "string" ? passphrase.trim() : "";
      if (!value) return { ok: false, error: "Enter the passphrase this backup was written with" };
      const window = deps.getWindow();
      const options: Electron.OpenDialogOptions = {
        title: "Choose an OpenMonkey backup",
        properties: ["openFile"],
        filters: [{ name: "OpenMonkey backup", extensions: ["openmonkey-export", "txt"] }],
      };
      const picked = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
      if (picked.canceled || !picked.filePaths[0]) return { ok: false, cancelled: true };
      try {
        // This build's layout version is the ceiling: a file stamped newer is refused.
        const bundle = readBundleFile(
          fs.readFileSync(picked.filePaths[0]),
          value,
          storage.schemaVersion() || SCHEMA_VERSION
        );
        const counts = storage.importBundle(bundle, restoreSettings === true);
        logger.info("history.imported", { file: path.basename(picked.filePaths[0]), ...counts });
        // Chats and maybe settings just appeared underneath the open windows, so each
        // one re-fetches instead of keeping a list it knows is stale.
        for (const target of BrowserWindow.getAllWindows()) {
          if (!target.isDestroyed()) target.webContents.send("local-data-changed");
        }
        return { ok: true, fileName: path.basename(picked.filePaths[0]), ...counts };
      } catch (error) {
        logger.error("history.import.failed");
        return { ok: false, error: errorText(error) };
      }
    }
  );

  /**
   * A settings change and a section reset both land here, so a reset cannot skip the
   * guards that keep a passphrase-protected history readable.
   */
  const applyConfigPatch = async (patch: Parameters<typeof config.merge>[0]): Promise<Config> => {
    const wasEncrypted = config.get("privacy").encryptData;
    // The idle timer is driven by this number, so only the picker's values count.
    let next = patch;
    if (patch?.privacy) {
      const minutes = Number(patch.privacy.autoLockMinutes);
      next = {
        ...patch,
        privacy: {
          ...patch.privacy,
          autoLockMinutes: AUTO_LOCK_CHOICES.includes(minutes) ? minutes : config.get("privacy").autoLockMinutes,
        },
      };
    }
    // With a passphrase set the only copy of the key is the wrapped one, so switching
    // encryption off would strand every stored row. The toggle snaps back.
    if (next?.privacy && next.privacy.encryptData === false && storage.lockable) {
      logger.warn("privacy.encrypt.off.blocked", { reason: "passphrase set" });
      next = { ...next, privacy: { ...next.privacy, encryptData: true } };
    }
    const updated = config.merge(next);
    // Encryption is normally decided when the file opens; a mid-session flip rewrites
    // the history now so the page never claims a scheme the file is not written in.
    if (updated.privacy.encryptData !== wasEncrypted) {
      try {
        storage.setEncryption(updated.privacy.encryptData);
        logger.info("privacy.encrypt.reencoded", { enabled: updated.privacy.encryptData });
      } catch (error) {
        config.merge({ privacy: { ...updated.privacy, encryptData: wasEncrypted } });
        logger.error("privacy.encrypt.reencode.failed", { error: errorText(error) });
        return config.getAll();
      }
    }
    logger.info("config.updated", { keys: Object.keys(patch) });
    if (patch && "mcp" in patch) await agent().refreshMcp();
    if (patch && "memory" in patch) agent().refreshMemory(true);
    else if (patch && "agent" in patch) agent().refreshMemory(true);
    if (patch && ("ui" in patch || "desktop" in patch)) deps.onConfigChanged();
    return updated;
  };

  ipcMain.handle("set-config", (_event, patch: Parameters<typeof config.merge>[0]) =>
    applyConfigPatch(patch)
  );

  // The renderer names a page, never a config key: only sections this build owns are
  // resettable, and the defaults come from the main process where they are defined.
  ipcMain.handle("reset-settings-section", async (_event, page: unknown) => {
    if (typeof page !== "string" || !RESETTABLE_PAGES.includes(page as SettingsPage)) {
      throw new Error("That settings page has nothing to reset");
    }
    logger.info("settings.section.reset", { page });
    return applyConfigPatch(resetPatch(page as SettingsPage));
  });

  ipcMain.handle("open-external", (_event, url: string) => {
    // Only http(s), so a model-generated string cannot reach file:// or a local socket.
    if (!/^https?:\/\//i.test(url)) throw new Error("Only http(s) links can be opened");
    return shell.openExternal(url);
  });
}

export default registerIpcHandlers;
