import { BrowserWindow, app, dialog, ipcMain, shell } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import type { OpenMonkey } from "../agent/OpenMonkey";
import config, { allowedRoots, ggufPath, resetPatch } from "../utils/config";
import {
  MOODS,
  MOOD_LOGOS,
  RESETTABLE_PAGES,
  type Attachment,
  type BackupStatus,
  type Config,
  type IntegrityReport,
  type MenuCommand,
  type ModelPreference,
  type Mood,
  type PrivacyActionResult,
  type PrivacyStatus,
  type PublisherChannel,
  type SafeModeInfo,
  type SettingsPage,
} from "../utils/types";
import storage, { SCHEMA_VERSION } from "../utils/storage";
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_TEXT, MAX_ATTACHMENTS_PER_MESSAGE } from "../utils/attachments";
import { attachmentFromFile, IMAGE_EXTENSIONS } from "./file-attachments";
import { readFileAsAttachment, searchFiles } from "../utils/file-search";
import { keychainAvailable } from "../utils/secret-key";
import { publisherSecrets } from "../utils/publisher-secrets";
import { publishQueue } from "../utils/publish-queue";
import { postDrafts } from "../utils/post-drafts";
import { PublishTools, buildSecret } from "../agent/tools/publish";
import { networkActivity } from "../utils/network";
import { EXPORT_FILE_SUFFIX, encryptBundle, readBundleFile } from "../utils/portability";
import type { PortabilityResult } from "../utils/types";
import { ModelDownloader } from "../models/model-downloader";
import { openPermissionSettings, probeAutomation } from "./permissions";
import { checkForUpdates, currentUpdateState, installUpdate, openReleasePage } from "./updater";
import { releaseNotesPayload } from "./release-notes";
import { findRollbackTarget, startRollback } from "./rollback";
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
  /** How this launch was started, and whether it came up without its extras. */
  getSafeMode: () => SafeModeInfo;
  /** Relaunches the app with the model, the MCP servers and the update check off. */
  restartInSafeMode: () => void;
  /** Relaunches the app the ordinary way. */
  restartNormally: () => void;
  /** Hands over a file the user opened from the Dock, once the renderer is ready. */
  takePendingDocument: () => Attachment | null;
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
  "command-palette",
  "focus-composer",
]);

const TEXT_EXTENSIONS = [
  "txt", "md", "markdown", "json", "csv", "tsv", "log", "yaml", "yml", "toml", "xml",
  "html", "css", "js", "jsx", "ts", "tsx", "py", "rb", "go", "rs", "swift", "sh",
  "sql", "c", "h", "cpp", "java", "env", "ini", "conf",
];

function conversationId(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("A conversation id is required");
  return value;
}

function messageId(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("A message id is required");
  return value;
}

function attachmentFrom(value: unknown): Attachment {
  if (typeof value !== "object" || value === null) throw new Error("Invalid attachment");
  const { name, bytes, text, kind } = value as Record<string, unknown>;
  if (typeof name !== "string" || !name.trim()) throw new Error("Invalid attachment name");
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) throw new Error("Invalid attachment size");
  if (typeof text !== "string" || text.length > MAX_ATTACHMENT_TEXT) throw new Error("Attachment text is too large");
  if (bytes > MAX_ATTACHMENT_BYTES) throw new Error("That file is too large to attach");
  return {
    name: name.slice(0, 120),
    bytes,
    text: kind === "image" ? "" : text,
    kind: kind === "image" ? "image" : "text",
  };
}

/** A message may carry several files, but only as many as the composer offers. */
function attachmentsFrom(value: unknown): Attachment[] {
  if (value == null) return [];
  const items = Array.isArray(value) ? value : [value];
  if (items.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    throw new Error(`A message can carry at most ${MAX_ATTACHMENTS_PER_MESSAGE} files`);
  }
  return items.map(attachmentFrom);
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

  ipcMain.handle("process-message", async (_event, id: unknown, message: unknown, attachments: unknown) => {
    if (typeof message !== "string") throw new Error("Message must be text");
    const files = attachmentsFrom(attachments);
    if (!message.trim() && !files.length) throw new Error("Empty message");
    return await agent().processUserMessage(conversationId(id), message, files);
  });

  ipcMain.handle("regenerate", (_event, id: unknown) => agent().regenerate(conversationId(id)));

  ipcMain.handle("resume-answer", async (_event, id: unknown, target: unknown) => {
    return await agent().resumeAnswer(conversationId(id), messageId(target));
  });

  ipcMain.handle("edit-message", async (_event, id: unknown, target: unknown, message: unknown) => {
    if (typeof message !== "string") throw new Error("Message must be text");
    return await agent().editAndResend(conversationId(id), messageId(target), message);
  });

  ipcMain.handle("branch-conversation", (_event, id: unknown, target: unknown, title: unknown) => {
    if (typeof title !== "string") throw new Error("Title must be text");
    const branch = agent().branchConversation(conversationId(id), messageId(target), title);
    if (!branch) throw new Error("That message is no longer in this chat");
    deps.openConversation(branch.id);
    return branch;
  });

  ipcMain.handle("list-variants", (_event, target: unknown) => agent().listVariants(messageId(target)));

  ipcMain.handle("select-variant", (_event, id: unknown, target: unknown) => {
    agent().selectVariant(conversationId(id), messageId(target));
  });

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
  ipcMain.handle("get-archived-conversations", () => agent().getArchivedConversations());
  ipcMain.handle("create-conversation", () => agent().createConversation());
  ipcMain.handle("rename-conversation", (_event, id: unknown, title: unknown) => {
    if (typeof title !== "string") throw new Error("Title must be text");
    agent().renameConversation(conversationId(id), title);
  });
  ipcMain.handle("pin-conversation", (_event, id: unknown, pinned: unknown) => {
    agent().setConversationPinned(conversationId(id), Boolean(pinned));
  });
  ipcMain.handle("archive-conversation", (_event, id: unknown, archived: unknown) => {
    agent().setConversationArchived(conversationId(id), Boolean(archived));
  });
  ipcMain.handle("delete-conversation", (_event, id: unknown) => agent().deleteConversation(conversationId(id)));
  ipcMain.handle("search-conversations", (_event, query: unknown) => {
    if (typeof query !== "string") return [];
    return agent().searchConversations(query);
  });

  ipcMain.handle("list-folders", () => agent().listFolders());
  ipcMain.handle("create-folder", (_event, name: unknown) => {
    if (typeof name !== "string") throw new Error("A folder needs a name");
    return agent().createFolder(name);
  });
  ipcMain.handle("rename-folder", (_event, id: unknown, name: unknown) => {
    if (typeof name !== "string") throw new Error("A folder needs a name");
    agent().renameFolder(conversationId(id), name);
  });
  ipcMain.handle("delete-folder", (_event, id: unknown) => agent().deleteFolder(conversationId(id)));
  ipcMain.handle("set-conversation-folder", (_event, id: unknown, folderId: unknown) => {
    const folder = folderId === null || folderId === undefined ? null : conversationId(folderId);
    agent().setConversationFolder(conversationId(id), folder);
  });
  ipcMain.handle("list-tags", () => agent().listTags());
  ipcMain.handle("set-conversation-tags", (_event, id: unknown, tags: unknown) => {
    if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== "string")) {
      throw new Error("Tags must be a list of words");
    }
    agent().setConversationTags(conversationId(id), tags as string[]);
  });
  ipcMain.handle("list-saved-searches", () => agent().listSavedSearches());
  ipcMain.handle("create-saved-search", (_event, name: unknown, query: unknown) => {
    if (typeof name !== "string") throw new Error("A saved search needs a name");
    if (typeof query !== "string") throw new Error("A saved search needs something to look for");
    return agent().createSavedSearch(name, query);
  });
  ipcMain.handle("delete-saved-search", (_event, id: unknown) => agent().deleteSavedSearch(conversationId(id)));

  ipcMain.handle("attach-files", async () => {
    const window = deps.getWindow();
    const options: Electron.OpenDialogOptions = {
      title: "Attach files",
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "Text, code & images", extensions: [...TEXT_EXTENSIONS, ...IMAGE_EXTENSIONS] },
        { name: "All files", extensions: ["*"] },
      ],
    };
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths.length) return [];
    const files: Attachment[] = [];
    for (const filePath of result.filePaths.slice(0, MAX_ATTACHMENTS_PER_MESSAGE)) {
      files.push(attachmentFromFile(filePath));
      // The Dock keeps what the user brought into a chat, so it can be opened again.
      app.addRecentDocument(filePath);
    }
    return files;
  });

  ipcMain.handle("take-pending-document", () => deps.takePendingDocument());

  ipcMain.handle("search-files", async (_event, query: unknown) => {
    if (typeof query !== "string") return [];
    return await searchFiles(query, allowedRoots());
  });

  ipcMain.handle("read-file", (_event, filePath: unknown) => {
    if (typeof filePath !== "string" || !filePath.trim()) throw new Error("A file path is required");
    return readFileAsAttachment(filePath, allowedRoots());
  });

  ipcMain.handle("clear-conversation", (_event, id: unknown) => {
    return agent().clearConversation(conversationId(id));
  });

  ipcMain.handle("summarize-conversation", async (_event, id: unknown) => {
    return await agent().summarizeConversation(conversationId(id));
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
  ipcMain.handle("import-model", async () => {
    const options: Electron.OpenDialogOptions = {
      title: "Choose a GGUF model",
      properties: ["openFile"],
      filters: [{ name: "GGUF model", extensions: ["gguf"] }],
    };
    const window = deps.getWindow();
    const picked = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    if (picked.canceled || !picked.filePaths.length) return downloader.current;
    const status = await downloader.importFrom(picked.filePaths[0]);
    if (status.phase === "done") {
      const instance = deps.getAgent();
      if (instance && instance.getStatus().state !== "ready") {
        await instance.reloadModel().catch(() => undefined);
      }
    }
    return status;
  });
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

  ipcMain.handle("get-safe-mode", () => deps.getSafeMode());

  ipcMain.handle("restart-in-safe-mode", () => {
    deps.restartInSafeMode();
  });

  ipcMain.handle("restart-normally", () => {
    deps.restartNormally();
  });

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

  ipcMain.handle("retry-task", async (_event, taskId: unknown) => {
    if (typeof taskId !== "string") throw new Error("A task id is required");
    return await agent().retryTask(taskId);
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
  ipcMain.handle("edit-memory-fact", (_event, id: unknown, content: unknown) => {
    if (typeof id !== "string" || !id.trim()) throw new Error("A fact id is required");
    if (typeof content !== "string") throw new Error("A fact is required");
    return agent().editMemoryFact(id, content);
  });
  ipcMain.handle("delete-memory-fact", (_event, id: unknown) => {
    if (typeof id !== "string" || !id.trim()) throw new Error("A fact id is required");
    return agent().deleteMemoryFact(id);
  });
  ipcMain.handle("clear-memory-facts", () => agent().clearMemoryFacts());
  ipcMain.handle("edit-memory-summary", (_event, conversationId: unknown, content: unknown) => {
    if (typeof conversationId !== "string" || !conversationId.trim()) {
      throw new Error("A conversation id is required");
    }
    if (typeof content !== "string") throw new Error("A summary is required");
    return agent().editMemorySummary(conversationId, content);
  });
  ipcMain.handle("forget-memory-summary", (_event, conversationId: unknown) => {
    if (typeof conversationId !== "string" || !conversationId.trim()) {
      throw new Error("A conversation id is required");
    }
    return agent().forgetMemorySummary(conversationId);
  });
  ipcMain.handle("set-conversation-recall", (_event, conversationId: unknown, recall: unknown) => {
    if (typeof conversationId !== "string" || !conversationId.trim()) {
      throw new Error("A conversation id is required");
    }
    if (typeof recall !== "boolean") throw new Error("Recall must be on or off");
    return agent().setConversationRecall(conversationId, recall);
  });
  ipcMain.handle("resolve-citation", async (_event, label: unknown) => {
    if (typeof label !== "string" || !label.trim()) throw new Error("A citation is required");
    return await agent().resolveCitation(label);
  });
  ipcMain.handle("rebuild-workspace-index", () => agent().rebuildWorkspaceIndex());
  ipcMain.handle("clear-workspace-index", () => agent().clearWorkspaceIndex());
  ipcMain.handle("get-workspace-sources", () => agent().getWorkspaceSources());
  ipcMain.handle("get-workspace-preview", (_event, path: unknown) => {
    if (typeof path !== "string" || !path.trim()) throw new Error("A file path is required");
    return agent().getWorkspacePreview(path);
  });
  ipcMain.handle("reindex-workspace-source", (_event, path: unknown) => {
    if (typeof path !== "string" || !path.trim()) throw new Error("A file path is required");
    return agent().reindexWorkspaceSource(path);
  });
  ipcMain.handle("set-workspace-ignore-rules", (_event, rules: unknown) => {
    if (!Array.isArray(rules)) throw new Error("Ignore rules must be a list");
    if (rules.some((rule) => typeof rule !== "string")) throw new Error("Ignore rules must be text");
    return agent().setWorkspaceIgnoreRules(rules as string[]);
  });
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
   * The chats the user picked, written to one file they choose the place of.
   *
   * A selection of private chats is still private, so the file is sealed with a
   * passphrase the user types for the occasion, exactly like a full backup.
   */
  ipcMain.handle(
    "export-conversations",
    async (_event, ids: unknown, passphrase: unknown): Promise<PortabilityResult> => {
      if (storage.locked) return { ok: false, error: "History is locked. Unlock OpenMonkey first." };
      const chosen = Array.isArray(ids)
        ? ids.filter((id): id is string => typeof id === "string" && id.length > 0)
        : [];
      if (!chosen.length) return { ok: false, error: "Choose at least one chat to export." };
      const value = typeof passphrase === "string" ? passphrase.trim() : "";
      if (value.length < BACKUP_PASSPHRASE_MIN) {
        return { ok: false, error: `Use at least ${BACKUP_PASSPHRASE_MIN} characters` };
      }
      const window = deps.getWindow();
      const options: Electron.SaveDialogOptions = {
        title: "Save the selected chats",
        defaultPath: `openmonkey-chats-${new Date().toISOString().slice(0, 10)}${EXPORT_FILE_SUFFIX}`,
        filters: [{ name: "OpenMonkey export", extensions: ["openmonkey-export", "txt"] }],
      };
      const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options);
      if (result.canceled || !result.filePath) return { ok: false, cancelled: true };
      try {
        const bundle = storage.exportSelection(chosen);
        fs.writeFileSync(result.filePath, encryptBundle(bundle, value), { mode: 0o600 });
        logger.info("chats.exported", { chats: bundle.conversations.length });
        return {
          ok: true,
          fileName: path.basename(result.filePath),
          conversations: bundle.conversations.length,
        };
      } catch (error) {
        logger.error("chats.export.failed");
        return { ok: false, error: errorText(error) };
      }
    }
  );

  /**
   * The app's own copies of its database. Unlike an encrypted export these never
   * leave the machine, so they carry the same sealed rows the live file does and
   * need no passphrase of their own to be read back.
   */
  ipcMain.handle("get-backup-status", (): BackupStatus => storage.backupStatus());

  ipcMain.handle("check-database-integrity", (): IntegrityReport => storage.checkIntegrity());

  ipcMain.handle("back-up-now", async (): Promise<PrivacyActionResult> => {
    const file = await storage.backupNow();
    if (!file) return { ok: false, error: "The copy could not be written." };
    logger.info("backup.taken.by.hand", { file: file.name });
    return { ok: true };
  });

  ipcMain.handle("restore-backup", async (_event, name: unknown): Promise<PrivacyActionResult> => {
    if (typeof name !== "string") return { ok: false, error: "Choose one of the app's own copies." };
    // Putting a copy back destroys what is in place now, so that goes into the
    // rotation first: a restore is always undoable with the button on this page.
    await storage.backupNow();
    const result = storage.restoreBackup(name);
    if (!result.ok) return { ok: false, error: result.detail };
    // The chats underneath the open windows are the ones the backup carried.
    deps.reloadHistoryViews();
    return { ok: true };
  });

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

  // Updates: where the app stands with the version that is out, and what it can do
  // about it. Every answer here is the state the updater already holds.
  ipcMain.handle("get-update-state", () => currentUpdateState());

  ipcMain.handle("check-for-updates", () => checkForUpdates());

  ipcMain.handle("install-update", () => installUpdate());

  ipcMain.handle("open-release-page", () => openReleasePage());

  ipcMain.handle("get-release-notes", () => releaseNotesPayload(app.getVersion()));

  ipcMain.handle("find-rollback", () => findRollbackTarget());

  ipcMain.handle("start-rollback", () => startRollback());

  // Publishing: the target lives in the settings file, the secret in the keychain.
  const publisher = new PublishTools();

  const publisherChannel = (value: unknown): PublisherChannel => {
    if (value !== "telegram" && value !== "reddit" && value !== "bluesky" && value !== "mastodon") {
      throw new Error("That publishing channel does not exist");
    }
    return value;
  };

  ipcMain.handle("get-publisher-channels", () => publisher.status());

  ipcMain.handle("save-publisher-secret", (_event, channel: unknown, secret: unknown) => {
    const name = publisherChannel(channel);
    try {
      publisherSecrets.write(name, buildSecret(name, secret));
      logger.info("publisher.secret.saved", { channel: name });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: errorText(error) };
    }
  });

  ipcMain.handle("clear-publisher-secret", (_event, channel: unknown) => {
    const name = publisherChannel(channel);
    publisherSecrets.clear(name);
    logger.info("publisher.secret.cleared", { channel: name });
    return { ok: true };
  });

  ipcMain.handle("check-publisher-channel", async (_event, channel: unknown) => {
    const name = publisherChannel(channel);
    try {
      const detail = await publisher.check(name);
      logger.info("publisher.checked", { channel: name });
      return { ok: true, detail };
    } catch (error) {
      return { ok: false, error: errorText(error) };
    }
  });

  // The posts waiting for their time, and the ones that already went out.
  ipcMain.handle("get-scheduled-posts", () => publishQueue.list());

  ipcMain.handle("cancel-scheduled-post", (_event, id: unknown) => {
    const postId = String(id ?? "");
    const post = publishQueue.get(postId);
    if (!post) return { ok: false, error: "That scheduled post is not on the list any more." };
    if (post.status !== "pending") return { ok: false, error: "That post has already gone out." };
    publishQueue.remove(postId);
    logger.info("publisher.scheduled.cancelled", { id: postId });
    return { ok: true };
  });

  // The posts the agent wrote but has not sent: the user reads them, changes the
  // wording if they want, and only then sends or queues one.
  ipcMain.handle("get-post-drafts", () => postDrafts.list());

  ipcMain.handle("update-post-draft", (_event, id: unknown, patch: unknown) => {
    const draftId = String(id ?? "");
    const draft = postDrafts.get(draftId);
    if (!draft) return { ok: false, error: "That draft is not on the list any more." };

    const changes = (patch ?? {}) as { text?: unknown; title?: unknown; note?: unknown };
    const text = typeof changes.text === "string" ? changes.text.trim() : draft.text;
    if (!text) return { ok: false, error: "A draft needs some text." };
    const title = typeof changes.title === "string" ? changes.title.trim() : draft.title;
    const note = typeof changes.note === "string" ? changes.note.trim() : draft.note;

    postDrafts.save({
      ...draft,
      text,
      title: title || undefined,
      note: note || undefined,
      updatedAt: Date.now(),
    });
    logger.info("publisher.draft.updated", { id: draftId });
    return { ok: true };
  });

  ipcMain.handle("delete-post-draft", (_event, id: unknown) => {
    const draftId = String(id ?? "");
    if (!postDrafts.get(draftId)) return { ok: false, error: "That draft is not on the list any more." };
    postDrafts.remove(draftId);
    logger.info("publisher.draft.deleted", { id: draftId });
    return { ok: true };
  });

  ipcMain.handle("send-post-draft", async (_event, id: unknown) => {
    const draftId = String(id ?? "");
    const draft = postDrafts.get(draftId);
    if (!draft) return { ok: false, error: "That draft is not on the list any more." };
    const instance = deps.getAgent();
    if (!instance) return { ok: false, error: "The app is not ready yet." };

    // The click was the approval, so the app does not ask again, but a Block
    // policy still refuses it and the post lands in the rail and the audit log.
    const result = await instance.getTaskManager().executeApprovedPost(
      { channel: draft.channel, text: draft.text, title: draft.title, imageUrl: draft.imageUrl },
      `Post to ${draft.channel}`
    );
    if (!result.ok) return { ok: false, error: result.error };
    postDrafts.remove(draftId);
    logger.info("publisher.draft.sent", { id: draftId, channel: draft.channel });
    return { ok: true, detail: `The post went out to ${draft.channel}.` };
  });

  ipcMain.handle("schedule-post-draft", (_event, id: unknown, when: unknown) => {
    const draftId = String(id ?? "");
    const draft = postDrafts.get(draftId);
    if (!draft) return { ok: false, error: "That draft is not on the list any more." };

    const result = publisher.scheduleApproved(
      { channel: draft.channel, text: draft.text, title: draft.title, imageUrl: draft.imageUrl },
      String(when ?? "")
    );
    if (!result.ok) return { ok: false, error: result.error };
    postDrafts.remove(draftId);
    logger.info("publisher.draft.scheduled", { id: draftId, channel: draft.channel });
    return { ok: true, detail: result.detail };
  });
}

export default registerIpcHandlers;
