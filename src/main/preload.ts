import { contextBridge, ipcRenderer } from "electron";
import type {
  AgentStatus,
  ApprovalRequest,
  ChatEvent,
  ConfigPatch,
  ElectronAPI,
  Mood,
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
  processMessage: (conversationId, message, attachment) =>
    ipcRenderer.invoke("process-message", conversationId, message, attachment),
  regenerate: (conversationId) => ipcRenderer.invoke("regenerate", conversationId),
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
  attachFile: () => ipcRenderer.invoke("attach-file"),
  getConfig: () => ipcRenderer.invoke("get-config"),
  setConfig: (patch: ConfigPatch) => ipcRenderer.invoke("set-config", patch),
  approveTask: (requestId: string, approved: boolean, remember = false) =>
    ipcRenderer.invoke("approve-task", requestId, approved, remember),
  cancelTask: (taskId: string) => ipcRenderer.invoke("cancel-task", taskId),
  getAuditLog: (limit?: number) => ipcRenderer.invoke("get-audit-log", limit),
  exportAuditLog: () => ipcRenderer.invoke("export-audit-log"),
  clearAuditLog: () => ipcRenderer.invoke("clear-audit-log"),
  chooseWorkspaceFolder: () => ipcRenderer.invoke("choose-workspace-folder"),
  getMcpStatus: () => ipcRenderer.invoke("get-mcp-status"),
  restartMcpServer: (id: string) => ipcRenderer.invoke("restart-mcp-server", id),
  stopGeneration: () => ipcRenderer.invoke("stop-generation"),
  switchProvider: (provider: "mlx" | "bonsai") => ipcRenderer.invoke("switch-provider", provider),
  downloadModel: () => ipcRenderer.invoke("download-model"),
  cancelModelDownload: () => ipcRenderer.invoke("cancel-model-download"),
  verifyModel: () => ipcRenderer.invoke("verify-model"),
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
  onModelDownloadStatus: (callback) => on("model-download-status", callback),
  onChatEvent: (callback) => on<ChatEvent>("chat-event", callback),
};

contextBridge.exposeInMainWorld("electron", api);
