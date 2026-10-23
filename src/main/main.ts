import { app, BrowserWindow, nativeTheme, session } from "electron";
import * as path from "node:path";
import { TrayManager } from "./tray-manager";
import { registerIpcHandlers } from "./ipc-handlers";
import { DesktopManager } from "./desktop-manager";
import { installAppMenu } from "./menu";
import { applyWindowState } from "./window-state";
import { OpenMonkey } from "../agent/OpenMonkey";
import config, { assetPath } from "../utils/config";
import logger from "../utils/logger";
import type { ApprovalRequest, MenuCommand, Mood } from "../utils/types";

let mainWindow: BrowserWindow | null = null;
let trayManager: TrayManager | null = null;
let desktopManager: DesktopManager | null = null;
let openMonkey: OpenMonkey | null = null;
let shuttingDown = false;
let pendingCommand: MenuCommand | null = null;

const PRELOAD = path.join(__dirname, "../preload/preload.js");

// Opt-in automation hook for local UI verification; packaged builds never open a port.
if (!app.isPackaged && process.env.OPENMONKEY_DEBUG_PORT) {
  app.commandLine.appendSwitch("remote-debugging-port", process.env.OPENMONKEY_DEBUG_PORT);
}

/**
 * Shipped builds only: in dev the Vite client needs a ws: connection and Fast Refresh
 * injects inline styles, so a strict CSP there would break hot reload rather than help.
 */
function enforceContentSecurityPolicy(): void {
  if (!app.isPackaged) return;
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'",
        ],
      },
    });
  });
}

function send(channel: string, payload?: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function broadcast(channel: string, payload?: unknown): void {
  send(channel, payload);
  desktopManager?.sendToQuick(channel, payload);
}

function applyZoom(window: BrowserWindow): void {
  if (window.isDestroyed()) return;
  const scale = config.get("ui").textScale;
  window.webContents.setZoomFactor(scale === "s" ? 0.9 : scale === "l" ? 1.12 : 1);
}

function applyAppearance(): void {
  nativeTheme.themeSource = config.get("ui").theme;
  for (const window of BrowserWindow.getAllWindows()) applyZoom(window);
}

function createWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 980,
    minHeight: 660,
    center: true,
    // Native frame everywhere; on macOS hiddenInset slides the traffic lights into the
    // sidebar's top strip, which the renderer makes draggable.
    backgroundColor: "#f6f7f3",
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: PRELOAD,
    },
    icon: assetPath("app-icon.png"),
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 12, y: 12 },
  });

  applyWindowState(mainWindow);
  applyZoom(mainWindow);

  mainWindow.once("ready-to-show", () => mainWindow?.show());

  const devServerUrl = process.env.ELECTRON_RENDERER_URL;
  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
    if (process.env.OPENMONKEY_DEVTOOLS) mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  mainWindow.webContents.on("did-finish-load", () => {
    if (!mainWindow) return;
    applyZoom(mainWindow);
    if (pendingCommand) {
      const command = pendingCommand;
      pendingCommand = null;
      mainWindow.webContents.send("menu-command", command);
    }
  });

  mainWindow.on("close", (event) => {
    if (shuttingDown) return;
    // Quitting is the tray/dock's job; hiding keeps the loaded model warm.
    if (config.get("desktop").closeToTray) {
      logger.info("window.close.hidden");
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on("closed", () => {
    logger.info("window.closed");
    mainWindow = null;
  });
}

function showMainWindow(command?: MenuCommand): void {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  if (!mainWindow) return;

  mainWindow.show();
  mainWindow.focus();
  if (!command) return;
  if (mainWindow.webContents.isLoading()) {
    pendingCommand = command;
  } else {
    mainWindow.webContents.send("menu-command", command);
  }
}

function installMenu(): void {
  installAppMenu(
    config.get("ui").language,
    (command) => showMainWindow(command),
    () => desktopManager?.showQuickAsk()
  );
  trayManager?.refreshMenu();
}

function applyDesktopSettings(): void {
  desktopManager?.applySettings();
  installMenu();
  applyAppearance();
}

async function initializeOpenMonkey(): Promise<void> {
  openMonkey = new OpenMonkey();

  openMonkey.on("ready", () => broadcast("agent-ready"));
  openMonkey.on("status", (status) => broadcast("agent-status", status));
  openMonkey.on("mood-change", (mood: Mood) => {
    trayManager?.updateLogo(mood, openMonkey?.getLogoManager().getLogoPath(mood) ?? "");
    trayManager?.showMoodChange(mood);
    broadcast("mood-change", mood);
  });
  openMonkey.on("task-update", (task) => {
    broadcast("task-update", task);
    desktopManager?.handleTask(task);
  });
  openMonkey.on("approval-request", (request: ApprovalRequest) => {
    broadcast("approval-request", request);
    desktopManager?.notifyApproval(request);
  });
  openMonkey.on("chat", (event) => broadcast("chat-event", event));

  try {
    await openMonkey.initialize();
  } catch (error) {
    // The window stays usable so the user can read the fix (npm run download-models).
    logger.error("agent.bootstrap.failed", { error });
    broadcast("agent-status", openMonkey.getStatus());
  }
}

registerIpcHandlers({
  getWindow: () => mainWindow,
  getAgent: () => openMonkey,
  getTray: () => trayManager,
  showMainWindow,
  showQuickAsk: () => desktopManager?.showQuickAsk(),
  hideQuickAsk: () => desktopManager?.hideQuickAsk(),
  onConfigChanged: applyDesktopSettings,
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    showMainWindow();
  });

  app.whenReady().then(async () => {
    enforceContentSecurityPolicy();
    createWindow();

    desktopManager = new DesktopManager({
      getMainWindow: () => mainWindow,
      showMainWindow: () => showMainWindow(),
    });

    trayManager = new TrayManager(() => mainWindow, {
      cycleMood: () => {
        const mood = openMonkey?.cycleMood();
        if (mood) trayManager?.showMoodChange(mood);
        broadcast("mood-change", openMonkey?.getCurrentMood());
      },
      setMood: (mood: Mood) => openMonkey?.setCurrentMood(mood),
      quickAsk: () => desktopManager?.showQuickAsk(),
      showMain: (command) => showMainWindow(command),
    },
    () => config.get("ui").language);
    trayManager.setupTray(assetPath("logos", "monkey-neutral-blue.png"));

    installMenu();
    applyDesktopSettings();

    app.on("browser-window-created", (_event, window) => {
      window.webContents.on("did-finish-load", () => applyZoom(window));
    });

    await initializeOpenMonkey();

    app.on("activate", () => {
      showMainWindow();
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event) => {
  if (shuttingDown || !openMonkey) return;
  // Unloading the GGUF weights and killing the MLX child process must finish first.
  event.preventDefault();
  shuttingDown = true;
  openMonkey
    .shutdown()
    .catch((error: unknown) => logger.error("agent.shutdown.failed", { error }))
    .finally(() => {
      desktopManager?.destroy();
      trayManager?.destroy();
      app.exit(0);
    });
});
