import { app, BrowserWindow, globalShortcut, Notification, screen } from "electron";
import * as path from "node:path";
import config from "../utils/config";
import logger from "../utils/logger";
import type { ApprovalRequest, Task } from "../utils/types";

const PRELOAD = path.join(__dirname, "../preload/preload.js");

export interface DesktopDeps {
  getMainWindow: () => BrowserWindow | null;
  showMainWindow: () => void;
}

/**
 * Owns the surfaces that exist outside the main window: the Quick Ask popover,
 * the macOS login item, the global shortcut, Dock badge and notifications.
 */
export class DesktopManager {
  private quickWindow: BrowserWindow | null = null;
  private pendingApprovals = new Set<string>();
  private approvedTasks = new Set<string>();

  constructor(private deps: DesktopDeps) {}

  applySettings(): void {
    const settings = config.get("desktop");

    if (settings.quickAsk) {
      if (!globalShortcut.isRegistered("Alt+Space")) {
        const registered = globalShortcut.register("Alt+Space", () => this.toggleQuickAsk());
        if (!registered) logger.warn("desktop.shortcut.unavailable", { accelerator: "Alt+Space" });
      }
    } else {
      globalShortcut.unregister("Alt+Space");
      this.hideQuickAsk();
    }

    // Registering the dev Electron binary as a login item would be misleading.
    if (app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin });
    }
  }

  toggleQuickAsk(): void {
    if (this.quickWindow?.isVisible()) this.hideQuickAsk();
    else this.showQuickAsk();
  }

  showQuickAsk(): void {
    if (!this.quickWindow || this.quickWindow.isDestroyed()) this.createQuickWindow();
    const window = this.quickWindow;
    if (!window) return;

    this.positionQuickWindow(window);
    window.show();
    window.focus();
    window.webContents.send("menu-command", "focus-composer");
  }

  hideQuickAsk(): void {
    if (this.quickWindow?.isVisible()) this.quickWindow.hide();
  }

  sendToQuick(channel: string, payload?: unknown): void {
    if (this.quickWindow && !this.quickWindow.isDestroyed()) {
      this.quickWindow.webContents.send(channel, payload);
    }
  }

  notifyApproval(request: ApprovalRequest): void {
    this.approvedTasks.add(request.taskId);
    if (!config.get("desktop").notifications || !Notification.isSupported()) return;

    const main = this.deps.getMainWindow();
    const quickVisible = Boolean(this.quickWindow?.isVisible());
    if (request.origin === "quick" ? quickVisible : main?.isFocused()) return;

    const notification = new Notification({
      title: `${config.get("agent").name}: approval needed`,
      body: request.request.summary,
      silent: true,
    });
    notification.on("click", () => {
      if (request.origin === "quick") this.showQuickAsk();
      else this.deps.showMainWindow();
    });
    notification.show();
  }

  handleTask(task: Task): void {
    if (task.status === "awaiting-approval") this.pendingApprovals.add(task.id);
    else this.pendingApprovals.delete(task.id);
    this.updateBadge();

    if (!this.approvedTasks.has(task.id)) return;
    if (task.status !== "completed" && task.status !== "failed") return;

    this.approvedTasks.delete(task.id);
    const main = this.deps.getMainWindow();
    if (
      !config.get("desktop").notifyOnComplete ||
      !config.get("desktop").notifications ||
      main?.isFocused() ||
      !Notification.isSupported()
    ) {
      return;
    }

    const notification = new Notification({
      title: task.status === "completed" ? "Task finished" : "Task failed",
      body: task.description,
      silent: true,
    });
    notification.on("click", () => this.deps.showMainWindow());
    notification.show();
  }

  private updateBadge(): void {
    app.dock?.setBadge(this.pendingApprovals.size ? String(this.pendingApprovals.size) : "");
  }

  private createQuickWindow(): void {
    const window = new BrowserWindow({
      width: 560,
      height: 440,
      minWidth: 420,
      minHeight: 220,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      show: false,
      resizable: true,
      movable: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: true,
      roundedCorners: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        preload: PRELOAD,
      },
    });

    window.setAlwaysOnTop(true, "floating");
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    const devServerUrl = process.env.ELECTRON_RENDERER_URL;
    if (devServerUrl) {
      void window.loadURL(`${devServerUrl}?quick=1`);
    } else {
      void window.loadFile(path.join(__dirname, "../renderer/index.html"), { query: { quick: "1" } });
    }

    window.on("blur", () => {
      if (!window.webContents.isDevToolsOpened()) this.hideQuickAsk();
    });
    window.on("closed", () => {
      this.quickWindow = null;
    });
    this.quickWindow = window;
  }

  private positionQuickWindow(window: BrowserWindow): void {
    const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const [width] = window.getSize();
    window.setPosition(
      Math.round(workArea.x + (workArea.width - width) / 2),
      Math.round(workArea.y + Math.min(120, Math.max(24, workArea.height * 0.12)))
    );
  }

  destroy(): void {
    globalShortcut.unregisterAll();
    if (this.quickWindow && !this.quickWindow.isDestroyed()) this.quickWindow.destroy();
    this.quickWindow = null;
  }
}
