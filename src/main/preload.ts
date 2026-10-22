import { contextBridge, ipcRenderer } from "electron";
import type { AgentStatus, ApprovalRequest, ConfigPatch, ElectronAPI, Mood, Task } from "../utils/types";

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
  processMessage: (message: string) => ipcRenderer.invoke("process-message", message),
  getCurrentMood: () => ipcRenderer.invoke("get-current-mood"),
  setMood: (mood: Mood) => ipcRenderer.invoke("set-mood", mood),
  cycleMood: () => ipcRenderer.invoke("cycle-mood"),
  getAgentStatus: () => ipcRenderer.invoke("get-agent-status"),
  getModelStatus: () => ipcRenderer.invoke("get-model-status"),
  getTasks: () => ipcRenderer.invoke("get-tasks"),
  getMessages: (limit?: number) => ipcRenderer.invoke("get-messages", limit),
  getConfig: () => ipcRenderer.invoke("get-config"),
  setConfig: (patch: ConfigPatch) => ipcRenderer.invoke("set-config", patch),
  approveTask: (requestId: string, approved: boolean) => ipcRenderer.invoke("approve-task", requestId, approved),
  stopGeneration: () => ipcRenderer.invoke("stop-generation"),
  newConversation: () => ipcRenderer.invoke("new-conversation"),
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
};

contextBridge.exposeInMainWorld("electron", api);
