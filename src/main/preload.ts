import { contextBridge, ipcRenderer } from "electron";
import type {
  AgentStatus,
  ApprovalRequest,
  ChatEvent,
  ConfigPatch,
  ElectronAPI,
  MenuCommand,
  Mood,
  QuickAskResult,
  SettingsPage,
  Task,
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
  createConversation: () => ipcRenderer.invoke("create-conversation"),
  switchConversation: (id: string) => ipcRenderer.invoke("switch-conversation", id),
  renameConversation: (id: string, title: string) => ipcRenderer.invoke("rename-conversation", id, title),
  setConversationPinned: (id: string, pinned: boolean) =>
    ipcRenderer.invoke("pin-conversation", id, pinned),
  deleteConversation: (id: string) => ipcRenderer.invoke("delete-conversation", id),
  searchConversations: (query: string) => ipcRenderer.invoke("search-conversations", query),
  attachFiles: () => ipcRenderer.invoke("attach-files"),
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
  deleteMemoryFact: (id: string) => ipcRenderer.invoke("delete-memory-fact", id),
  clearMemoryFacts: () => ipcRenderer.invoke("clear-memory-facts"),
  rebuildWorkspaceIndex: () => ipcRenderer.invoke("rebuild-workspace-index"),
  clearWorkspaceIndex: () => ipcRenderer.invoke("clear-workspace-index"),
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

  onAgentReady: (callback: () => void) => on<undefined>("agent-ready", () => callback()),
  onAgentStatus: (callback: (status: AgentStatus) => void) => on<AgentStatus>("agent-status", callback),
  onMoodChange: (callback: (mood: string) => void) => on<string>("mood-change", callback),
  onCycleMood: (callback: () => void) => on<undefined>("cycle-mood", () => callback()),
  onTaskUpdate: (callback: (task: Task) => void) => on<Task>("task-update", callback),
  onApprovalRequest: (callback: (request: ApprovalRequest) => void) =>
    on<ApprovalRequest>("approval-request", callback),
  onOpenSettings: (callback: () => void) => on<undefined>("open-settings", () => callback()),
  onHistoryReset: (callback: () => void) => on<undefined>("history-reset", () => callback()),
  onMenuCommand: (callback: (command: MenuCommand) => void) =>
    on<MenuCommand>("menu-command", callback),
  onOpenConversation: (callback: (conversationId: string) => void) =>
    on<string>("open-conversation", callback),
  onModelDownloadStatus: (callback) => on("model-download-status", callback),
  onChatEvent: (callback) => on<ChatEvent>("chat-event", callback),
  onQuickAskStarted: (callback) => on<QuickAskResult>("quick-ask-started", callback),
  onLocalDataChanged: (callback: () => void) => on<undefined>("local-data-changed", () => callback()),
};

contextBridge.exposeInMainWorld("electron", api);
