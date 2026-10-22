import { app, BrowserWindow, session } from "electron";
import * as path from "node:path";
import { TrayManager } from "./tray-manager";
import { registerIpcHandlers } from "./ipc-handlers";
import { OpenMonkey } from "../agent/OpenMonkey";
import { assetPath } from "../utils/config";
import logger from "../utils/logger";
import type { ApprovalRequest, Mood } from "../utils/types";

let mainWindow: BrowserWindow | null = null;
let trayManager: TrayManager | null = null;
let openMonkey: OpenMonkey | null = null;
let shuttingDown = false;

const PRELOAD = path.join(__dirname, "../preload/preload.js");

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

function createWindow(): void {
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

  mainWindow.once("ready-to-show", () => mainWindow?.show());

  const devServerUrl = process.env.ELECTRON_RENDERER_URL;
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
    if (process.env.OPENMONKEY_DEVTOOLS) mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  mainWindow.on("close", (event) => {
    // Quitting is the tray/dock's job; closing the window keeps the loaded model warm.
    if (!shuttingDown && process.platform !== "darwin") {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  trayManager = new TrayManager(mainWindow, {
    cycleMood: () => {
      const mood = openMonkey?.cycleMood();
      if (mood) trayManager?.showMoodChange(mood);
      send("mood-change", openMonkey?.getCurrentMood());
    },
    setMood: (mood: Mood) => openMonkey?.setCurrentMood(mood),
  });
  trayManager.setupTray(assetPath("logos", "monkey-neutral-blue.png"));
}

async function initializeOpenMonkey(): Promise<void> {
  openMonkey = new OpenMonkey();

  openMonkey.on("ready", () => send("agent-ready"));
  openMonkey.on("status", (status) => send("agent-status", status));
  openMonkey.on("mood-change", (mood: Mood) => {
    trayManager?.updateLogo(mood, openMonkey?.getLogoManager().getLogoPath(mood) ?? "");
    trayManager?.showMoodChange(mood);
    send("mood-change", mood);
  });
  openMonkey.on("task-update", (task) => send("task-update", task));
  openMonkey.on("approval-request", (request: ApprovalRequest) => send("approval-request", request));
  openMonkey.on("chat", (event) => send("chat-event", event));

  try {
    await openMonkey.initialize();
  } catch (error) {
    // The window stays usable so the user can read the fix (npm run download-models).
    logger.error("agent.bootstrap.failed", { error });
    send("agent-status", openMonkey.getStatus());
  }
}

registerIpcHandlers({
  getWindow: () => mainWindow,
  getAgent: () => openMonkey,
  getTray: () => trayManager,
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    enforceContentSecurityPolicy();
    createWindow();
    await initializeOpenMonkey();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else mainWindow?.show();
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
      trayManager?.destroy();
      app.exit(0);
    });
});
