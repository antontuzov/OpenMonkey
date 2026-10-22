import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import type { OpenMonkey } from "../agent/OpenMonkey";
import config from "../utils/config";
import { MOODS, MOOD_LOGOS, type Attachment, type Mood } from "../utils/types";
import { ModelDownloader } from "../models/model-downloader";
import { openPermissionSettings, probeAutomation } from "./permissions";
import logger from "../utils/logger";
import type { TrayManager } from "./tray-manager";

export interface IpcDeps {
  getWindow: () => BrowserWindow | null;
  getAgent: () => OpenMonkey | null;
  getTray: () => TrayManager | null;
}

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

  ipcMain.handle("switch-provider", async (_event, provider: "mlx" | "bonsai") => {
    await agent().switchProvider(provider);
  });

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
    if (!instance) return { provider: null, mlxAvailable: false, bonsaiAvailable: false };
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

  ipcMain.handle("get-config", () => config.getAll());

  ipcMain.handle("set-config", async (_event, patch: Parameters<typeof config.merge>[0]) => {
    const updated = config.merge(patch);
    logger.info("config.updated", { keys: Object.keys(patch) });
    if (patch && "mcp" in patch) await agent().refreshMcp();
    return updated;
  });

  ipcMain.handle("open-external", (_event, url: string) => {
    // Only http(s), so a model-generated string cannot reach file:// or a local socket.
    if (!/^https?:\/\//i.test(url)) throw new Error("Only http(s) links can be opened");
    return shell.openExternal(url);
  });
}

export default registerIpcHandlers;
