import { contextBridge, ipcRenderer } from "electron";
import type {
  AgentStatus,
  ApprovalRequest,
  ChatEvent,
  ConfigPatch,
  ElectronAPI,
  MenuCommand,
  Mood,
  PublisherChannel,
  PublisherSecret,
  QuickAskResult,
  SettingsPage,
  Task,
  UpdateState,
} from "../utils/types";

/**
 * contextIsolation is on, so the renderer only gets these named channels; the raw
 * ipcRenderer object never crosses the bridge.
 */
const on = <T>(channel: string, callback: (payload: T) => void): (() => void) => {
  const listener = (_event: Electron.IpcRendererEvent, payload: T) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

const api: ElectronAPI = {
  processMessage: (conversationId, message, attachments) =>
    ipcRenderer.invoke("process-message", conversationId, message, attachments),
  quickAsk: (message: string, threadId?: string) =>
    ipcRenderer.invoke("quick-ask", message, threadId),
  getQuickAskThreads: () => ipcRenderer.invoke("get-quick-asks"),
  setQuickAskPinned: (id: string, pinned: boolean) =>
    ipcRenderer.invoke("pin-quick-ask", id, pinned),
  deleteQuickAsk: (id: string) => ipcRenderer.invoke("delete-quick-ask", id),
  openQuickAskInChat: (id: string) => ipcRenderer.invoke("open-quick-ask-in-chat", id),
  getActiveConversationId: () => ipcRenderer.invoke("get-active-conversation-id"),
  showMainWindow: (command?: MenuCommand) => ipcRenderer.invoke("show-main-window", command),
  openQuickAsk: () => ipcRenderer.invoke("open-quick-ask"),
  hideQuickAsk: () => ipcRenderer.invoke("hide-quick-ask"),
  platform: process.platform,
  regenerate: (conversationId) => ipcRenderer.invoke("regenerate", conversationId),
  resumeAnswer: (conversationId, messageId) => ipcRenderer.invoke("resume-answer", conversationId, messageId),
  editMessage: (conversationId, messageId, message) =>
    ipcRenderer.invoke("edit-message", conversationId, messageId, message),
  branchConversation: (conversationId, messageId, title) =>
    ipcRenderer.invoke("branch-conversation", conversationId, messageId, title),
  listVariants: (messageId: string) => ipcRenderer.invoke("list-variants", messageId),
  selectVariant: (conversationId: string, messageId: string) =>
    ipcRenderer.invoke("select-variant", conversationId, messageId),
  getCurrentMood: () => ipcRenderer.invoke("get-current-mood"),
  setMood: (mood: Mood) => ipcRenderer.invoke("set-mood", mood),
  cycleMood: () => ipcRenderer.invoke("cycle-mood"),
  getAgentStatus: () => ipcRenderer.invoke("get-agent-status"),
  getModelStatus: () => ipcRenderer.invoke("get-model-status"),
  getTasks: () => ipcRenderer.invoke("get-tasks"),
  getMessages: (conversationId: string) => ipcRenderer.invoke("get-messages", conversationId),
  getConversations: () => ipcRenderer.invoke("get-conversations"),
  getArchivedConversations: () => ipcRenderer.invoke("get-archived-conversations"),
  createConversation: () => ipcRenderer.invoke("create-conversation"),
  renameConversation: (id: string, title: string) => ipcRenderer.invoke("rename-conversation", id, title),
  setConversationPinned: (id: string, pinned: boolean) =>
    ipcRenderer.invoke("pin-conversation", id, pinned),
  setConversationArchived: (id: string, archived: boolean) =>
    ipcRenderer.invoke("archive-conversation", id, archived),
  deleteConversation: (id: string) => ipcRenderer.invoke("delete-conversation", id),
  searchConversations: (query: string) => ipcRenderer.invoke("search-conversations", query),
  listFolders: () => ipcRenderer.invoke("list-folders"),
  createFolder: (name: string) => ipcRenderer.invoke("create-folder", name),
  renameFolder: (id: string, name: string) => ipcRenderer.invoke("rename-folder", id, name),
  deleteFolder: (id: string) => ipcRenderer.invoke("delete-folder", id),
  setConversationFolder: (id: string, folderId: string | null) =>
    ipcRenderer.invoke("set-conversation-folder", id, folderId),
  listTags: () => ipcRenderer.invoke("list-tags"),
  setConversationTags: (id: string, tags: string[]) =>
    ipcRenderer.invoke("set-conversation-tags", id, tags),
  listSavedSearches: () => ipcRenderer.invoke("list-saved-searches"),
  createSavedSearch: (name: string, query: string) =>
    ipcRenderer.invoke("create-saved-search", name, query),
  deleteSavedSearch: (id: string) => ipcRenderer.invoke("delete-saved-search", id),
  exportConversations: (ids: string[], passphrase: string) =>
    ipcRenderer.invoke("export-conversations", ids, passphrase),
  attachFiles: () => ipcRenderer.invoke("attach-files"),
  /** Takes the file the user opened from the Dock, once. */
  takePendingDocument: () => ipcRenderer.invoke("take-pending-document"),
  searchFiles: (query: string) => ipcRenderer.invoke("search-files", query),
  readFile: (filePath: string) => ipcRenderer.invoke("read-file", filePath),
  clearConversation: (conversationId: string) => ipcRenderer.invoke("clear-conversation", conversationId),
  summarizeConversation: (conversationId: string) =>
    ipcRenderer.invoke("summarize-conversation", conversationId),
  getConfig: () => ipcRenderer.invoke("get-config"),
  getPrivacyStatus: () => ipcRenderer.invoke("get-privacy-status"),
  unlockHistory: (passphrase: string) => ipcRenderer.invoke("unlock-history", passphrase),
  setHistoryPassphrase: (passphrase: string) => ipcRenderer.invoke("set-history-passphrase", passphrase),
  clearHistoryPassphrase: (passphrase: string) => ipcRenderer.invoke("clear-history-passphrase", passphrase),
  lockHistoryNow: () => ipcRenderer.invoke("lock-history-now"),
  eraseAllHistory: (confirmation: string) => ipcRenderer.invoke("erase-all-history", confirmation),
  exportHistoryBackup: (passphrase: string) => ipcRenderer.invoke("export-history-backup", passphrase),
  importHistoryBackup: (passphrase: string, restoreSettings: boolean) =>
    ipcRenderer.invoke("import-history-backup", passphrase, restoreSettings),
  getBackupStatus: () => ipcRenderer.invoke("get-backup-status"),
  checkDatabaseIntegrity: () => ipcRenderer.invoke("check-database-integrity"),
  backUpNow: () => ipcRenderer.invoke("back-up-now"),
  restoreBackup: (name: string) => ipcRenderer.invoke("restore-backup", name),
  getSafeMode: () => ipcRenderer.invoke("get-safe-mode"),
  restartInSafeMode: () => ipcRenderer.invoke("restart-in-safe-mode"),
  restartNormally: () => ipcRenderer.invoke("restart-normally"),
  setConfig: (patch: ConfigPatch) => ipcRenderer.invoke("set-config", patch),
  resetSettingsSection: (page: SettingsPage) => ipcRenderer.invoke("reset-settings-section", page),
  approveTask: (requestId: string, approved: boolean, remember = false) =>
    ipcRenderer.invoke("approve-task", requestId, approved, remember),
  cancelTask: (taskId: string) => ipcRenderer.invoke("cancel-task", taskId),
  retryTask: (taskId: string) => ipcRenderer.invoke("retry-task", taskId),
  getAuditLog: (limit?: number) => ipcRenderer.invoke("get-audit-log", limit),
  exportAuditLog: () => ipcRenderer.invoke("export-audit-log"),
  clearAuditLog: () => ipcRenderer.invoke("clear-audit-log"),
  getLogTail: (lines?: number) => ipcRenderer.invoke("get-log-tail", lines),
  clearLogs: () => ipcRenderer.invoke("clear-logs"),
  chooseWorkspaceFolder: () => ipcRenderer.invoke("choose-workspace-folder"),
  getMcpStatus: () => ipcRenderer.invoke("get-mcp-status"),
  restartMcpServer: (id: string) => ipcRenderer.invoke("restart-mcp-server", id),
  getMemorySnapshot: () => ipcRenderer.invoke("get-memory-snapshot"),
  addMemoryFact: (content: string) => ipcRenderer.invoke("add-memory-fact", content),
  editMemoryFact: (id: string, content: string) => ipcRenderer.invoke("edit-memory-fact", id, content),
  deleteMemoryFact: (id: string) => ipcRenderer.invoke("delete-memory-fact", id),
  clearMemoryFacts: () => ipcRenderer.invoke("clear-memory-facts"),
  editMemorySummary: (conversationId: string, content: string) =>
    ipcRenderer.invoke("edit-memory-summary", conversationId, content),
  forgetMemorySummary: (conversationId: string) =>
    ipcRenderer.invoke("forget-memory-summary", conversationId),
  setConversationRecall: (conversationId: string, recall: boolean) =>
    ipcRenderer.invoke("set-conversation-recall", conversationId, recall),
  resolveCitation: (label: string) => ipcRenderer.invoke("resolve-citation", label),
  rebuildWorkspaceIndex: () => ipcRenderer.invoke("rebuild-workspace-index"),
  clearWorkspaceIndex: () => ipcRenderer.invoke("clear-workspace-index"),
  getWorkspaceSources: () => ipcRenderer.invoke("get-workspace-sources"),
  getWorkspacePreview: (path: string) => ipcRenderer.invoke("get-workspace-preview", path),
  reindexWorkspaceSource: (path: string) => ipcRenderer.invoke("reindex-workspace-source", path),
  setWorkspaceIgnoreRules: (rules: string[]) =>
    ipcRenderer.invoke("set-workspace-ignore-rules", rules),
  searchWorkspaceMemory: (query: string) => ipcRenderer.invoke("search-workspace-memory", query),
  stopGeneration: () => ipcRenderer.invoke("stop-generation"),
  switchProvider: (provider: "auto" | "mlx" | "bonsai") =>
    ipcRenderer.invoke("switch-provider", provider),
  benchmarkModel: () => ipcRenderer.invoke("benchmark-model"),
  downloadModel: () => ipcRenderer.invoke("download-model"),
  importModel: () => ipcRenderer.invoke("import-model"),
  cancelModelDownload: () => ipcRenderer.invoke("cancel-model-download"),
  verifyModel: () => ipcRenderer.invoke("verify-model"),
  deleteModel: () => ipcRenderer.invoke("delete-model"),
  getModelDownloadStatus: () => ipcRenderer.invoke("get-model-download-status"),
  reloadModel: () => ipcRenderer.invoke("reload-model"),
  probeAutomation: (area: "calendar" | "mail") => ipcRenderer.invoke("probe-automation", area),
  openPermissionSettings: (area: "automation" | "notifications") =>
    ipcRenderer.invoke("open-permission-settings", area),
  openExternal: (url: string) => ipcRenderer.invoke("open-external", url),
  getUpdateState: () => ipcRenderer.invoke("get-update-state"),
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
  installUpdate: () => ipcRenderer.invoke("install-update"),
  openReleasePage: () => ipcRenderer.invoke("open-release-page"),
  getReleaseNotes: () => ipcRenderer.invoke("get-release-notes"),
  findRollback: () => ipcRenderer.invoke("find-rollback"),
  startRollback: () => ipcRenderer.invoke("start-rollback"),
  getPublisherChannels: () => ipcRenderer.invoke("get-publisher-channels"),
  savePublisherSecret: (channel: PublisherChannel, secret: PublisherSecret) =>
    ipcRenderer.invoke("save-publisher-secret", channel, secret),
  clearPublisherSecret: (channel: PublisherChannel) => ipcRenderer.invoke("clear-publisher-secret", channel),
  checkPublisherChannel: (channel: PublisherChannel) => ipcRenderer.invoke("check-publisher-channel", channel),

  onAgentReady: (callback: () => void) => on<undefined>("agent-ready", () => callback()),
  onAgentStatus: (callback: (status: AgentStatus) => void) => on<AgentStatus>("agent-status", callback),
  onMoodChange: (callback: (mood: string) => void) => on<string>("mood-change", callback),
  onCycleMood: (callback: () => void) => on<undefined>("cycle-mood", () => callback()),
  onTaskUpdate: (callback: (task: Task) => void) => on<Task>("task-update", callback),
  onApprovalRequest: (callback: (request: ApprovalRequest) => void) =>
    on<ApprovalRequest>("approval-request", callback),
  onApprovalResolved: (callback: (payload: { requestId: string }) => void) =>
    on<{ requestId: string }>("approval-resolved", callback),
  onOpenSettings: (callback: () => void) => on<undefined>("open-settings", () => callback()),
  onHistoryReset: (callback: () => void) => on<undefined>("history-reset", () => callback()),
  onMenuCommand: (callback: (command: MenuCommand) => void) =>
    on<MenuCommand>("menu-command", callback),
  onOpenConversation: (callback: (conversationId: string) => void) =>
    on<string>("open-conversation", callback),
  /** A file the user opened from the Dock is waiting for the composer. */
  onOpenDocument: (callback: () => void) => on<undefined>("open-document", () => callback()),
  onModelDownloadStatus: (callback) => on("model-download-status", callback),
  onChatEvent: (callback) => on<ChatEvent>("chat-event", callback),
  onQuickAskStarted: (callback) => on<QuickAskResult>("quick-ask-started", callback),
  onLocalDataChanged: (callback: () => void) => on<undefined>("local-data-changed", () => callback()),
  onUpdateState: (callback: (state: UpdateState) => void) => on<UpdateState>("update-state", callback),
};

contextBridge.exposeInMainWorld("electron", api);
