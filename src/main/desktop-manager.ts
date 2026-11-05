import { app, BrowserWindow, globalShortcut, Notification, screen } from "electron";
import * as path from "node:path";
import config from "../utils/config";
import logger from "../utils/logger";
import { withinQuietHours } from "../utils/quiet-hours";
import type { ApprovalRequest, Task } from "../utils/types";

const PRELOAD = path.join(__dirname, "../preload/preload.js");

export interface DesktopDeps {
  getMainWindow: () => BrowserWindow | null;
  showMainWindow: () => void;
  /** Answer an approval that was raised in a window the user is not looking at. */
  resolveApproval: (requestId: string, approved: boolean) => void;
  /** The clock, so the quiet hours can be tested without waiting for the night. */
  now?: () => Date;
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
    const settings = config.get("desktop");
    if (!settings.notifications || !Notification.isSupported()) return;
    // Quiet hours are the user's own hours: the badge still counts what waits.
    if (withinQuietHours(this.now(), settings.quietHours)) return;

    const main = this.deps.getMainWindow();
    const quickVisible = Boolean(this.quickWindow?.isVisible());
    if (request.origin === "quick" ? quickVisible : main?.isFocused()) return;

    const decisions = settings.notifyActions
      ? [
          { decision: "allow" as const, text: "Allow" },
          { decision: "deny" as const, text: "Deny" },
        ]
      : undefined;

    const notification = new Notification({
      title: `${config.get("agent").name}: approval needed`,
      body: request.request.summary,
      silent: true,
      ...(decisions
        ? { actions: decisions.map((entry) => ({ type: "button" as const, text: entry.text })) }
        : {}),
    });
    notification.on("click", () => {
      if (request.origin === "quick") this.showQuickAsk();
      else this.deps.showMainWindow();
    });
    if (decisions) {
      notification.on("action", (_event, index) => {
        const decision = decisions[index]?.decision;
        if (decision === "allow") this.deps.resolveApproval(request.requestId, true);
        else if (decision === "deny") this.deps.resolveApproval(request.requestId, false);
      });
    }
    notification.show();
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  handleTask(task: Task): void {
    if (task.status === "awaiting-approval") this.pendingApprovals.add(task.id);
    else this.pendingApprovals.delete(task.id);
    this.updateBadge();

    if (!this.approvedTasks.has(task.id)) return;
    if (task.status !== "completed" && task.status !== "failed") return;

    this.approvedTasks.delete(task.id);
    const main = this.deps.getMainWindow();
    const settings = config.get("desktop");
    if (
      !settings.notifyOnComplete ||
      !settings.notifications ||
      main?.isFocused() ||
      withinQuietHours(this.now(), settings.quietHours) ||
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
      width: 780,
      height: 520,
      minWidth: 620,
      minHeight: 320,
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
