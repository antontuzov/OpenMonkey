import { BrowserWindow, ipcMain, shell } from "electron";
import type { OpenMonkey } from "../agent/OpenMonkey";
import config from "../utils/config";
import { MOODS, MOOD_LOGOS, type Mood } from "../utils/types";
import logger from "../utils/logger";
import type { TrayManager } from "./tray-manager";

export interface IpcDeps {
  getWindow: () => BrowserWindow | null;
  getAgent: () => OpenMonkey | null;
  getTray: () => TrayManager | null;
}

/** Every renderer → main call goes through here; nothing else is exposed by the preload. */
export function registerIpcHandlers(deps: IpcDeps): void {
  const agent = () => {
    const instance = deps.getAgent();
    if (!instance) throw new Error("OpenMonkey has not finished starting");
    return instance;
  };

  ipcMain.handle("process-message", async (_event, message: string) => {
    if (typeof message !== "string" || !message.trim()) throw new Error("Empty message");
    return await agent().processUserMessage(message);
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

  ipcMain.handle("new-conversation", () => {
    agent().newConversation();
  });

  ipcMain.handle("switch-provider", async (_event, provider: "mlx" | "bonsai") => {
    await agent().switchProvider(provider);
  });

  ipcMain.handle("get-agent-status", () => deps.getAgent()?.getStatus() ?? { state: "starting" as const });

  ipcMain.handle("get-model-status", async () => {
    const instance = deps.getAgent();
    if (!instance) return { provider: null, mlxAvailable: false, bonsaiAvailable: false };
    return await instance.modelStatus();
  });

  ipcMain.handle("get-messages", (_event, limit?: number) => {
    const instance = deps.getAgent();
    if (!instance) return [];
    return instance.getMessages(typeof limit === "number" ? limit : 80);
  });

  ipcMain.handle("get-tasks", () => agent().getTaskManager().getActiveTasks());

  ipcMain.handle("approve-task", (_event, requestId: string, approved: boolean) => {
    agent().resolveApproval(requestId, Boolean(approved));
  });

  ipcMain.handle("get-config", () => config.getAll());

  ipcMain.handle("set-config", (_event, patch: Parameters<typeof config.merge>[0]) => {
    const updated = config.merge(patch);
    logger.info("config.updated", { keys: Object.keys(patch) });
    return updated;
  });

  ipcMain.handle("open-external", (_event, url: string) => {
    // Only http(s), so a model-generated string cannot reach file:// or a local socket.
    if (!/^https?:\/\//i.test(url)) throw new Error("Only http(s) links can be opened");
    return shell.openExternal(url);
  });
}

export default registerIpcHandlers;
