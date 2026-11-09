import "./bootstrap";
import { crashRecordFile, safeMode } from "./bootstrap";
import { app, BrowserWindow, nativeTheme, session } from "electron";
import * as path from "node:path";
import { TrayManager } from "./tray-manager";
import { registerIpcHandlers } from "./ipc-handlers";
import { attachmentFromFile } from "./file-attachments";
import { DesktopManager } from "./desktop-manager";
import { startLockWatcher } from "./lock-watcher";
import { PublishScheduler } from "./publish-scheduler";
import { installAppMenu } from "./menu";
import { checkForUpdates, startUpdates } from "./updater";
import { applyWindowState } from "./window-state";
import { OpenMonkey } from "../agent/OpenMonkey";
import config, { assetPath } from "../utils/config";
import logger from "../utils/logger";
import storage from "../utils/storage";
import { SAFE_MODE_ENV, clearCrashes, markRunning, noteCleanExit, restartArgs } from "../utils/safe-mode";
import { recentChats } from "../utils/recent-chats";
import type { ApprovalRequest, Attachment, MenuCommand, Mood } from "../utils/types";

let mainWindow: BrowserWindow | null = null;
let trayManager: TrayManager | null = null;
let desktopManager: DesktopManager | null = null;
let openMonkey: OpenMonkey | null = null;
let shuttingDown = false;
let pendingCommand: MenuCommand | null = null;
let pendingConversation: string | null = null;
/** A file the user opened from the Dock, waiting for the renderer to take it. */
let pendingDocument: Attachment | null = null;

const PRELOAD = path.join(__dirname, "../preload/preload.js");

/**
 * Model teardown waits for the worker it aborted; this caps how long quit can take.
 * It has to outlast the load wait in the GGUF teardown, because a forced exit while a
 * load worker runs is exactly the abort that crash report describes.
 */
const SHUTDOWN_WARN_MS = 30_000;
const SHUTDOWN_WATCHDOG_MS = 150_000;

/**
 * macOS can back the window with a system material. The sidebar is left
 * translucent so the material shows through it; the rest of the app paints its
 * own paper over it.
 */
const vibrant = process.platform === "darwin";

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
  const factor = scale === "s" ? 0.9 : scale === "l" ? 1.12 : 1;
  // Setting the same factor still forces a full relayout of the page.
  if (window.webContents.getZoomFactor() !== factor) window.webContents.setZoomFactor(factor);
}

function paperColor(): string {
  return nativeTheme.shouldUseDarkColors ? "#121512" : "#f6f7f3";
}

/**
 * The native theme source decides the window backdrop. It has to be set before
 * the first window exists: a window born with the OS colour and corrected a
 * moment later flips the whole backdrop, which reads as a flash at launch.
 */
function applyNativeTheme(): void {
  const theme = config.get("ui").theme;
  if (nativeTheme.themeSource !== theme) nativeTheme.themeSource = theme;
}

function syncWindowBackground(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  // A vibrant window has to stay transparent, or painting it hides the material.
  mainWindow.setBackgroundColor(vibrant ? "#00000000" : paperColor());
}

function applyAppearance(): void {
  applyNativeTheme();
  syncWindowBackground();
  for (const window of BrowserWindow.getAllWindows()) applyZoom(window);
}

/**
 * A locked or erased history must not survive in a renderer that already painted it.
 * The renderer clears what it holds on this event; reloading the window would also
 * work but flashes the whole app every time the history changes.
 */
function refreshHistoryViews(): void {
  openMonkey?.forgetConversation();
  openMonkey?.refreshMemory(true);
  broadcast("history-reset");
}

function lockHistory(): void {
  if (!storage.lockable) return;
  storage.lock();
  refreshHistoryViews();
}

/**
 * The queue of posts waiting to go out. It runs in the main process, so a post
 * goes out at its time whether or not a window is open, and it runs the post as a
 * task so the rail and the audit log show what the app did on its own.
 */
function startPublishScheduler(): void {
  if (!openMonkey) return;
  const scheduler = new PublishScheduler({
    runPost: async (post) => await openMonkey!.getTaskManager().executeScheduledPost(post),
  });
  scheduler.start();
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
    // A vibrant window keeps a transparent backdrop; the renderer paints the paper
    // itself, so only the sidebar lets the material through.
    backgroundColor: vibrant ? "#00000000" : paperColor(),
    vibrancy: vibrant ? "sidebar" : undefined,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: PRELOAD,
    },
    icon: assetPath("app-icon.png"),
    // No native title bar: the app's own strip is the title bar, and the traffic
    // lights float in the sidebar above the avatar.
    titleBarStyle: "hidden",
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
    if (pendingConversation) {
      const conversation = pendingConversation;
      pendingConversation = null;
      mainWindow.webContents.send("open-conversation", conversation);
    }
    // A file dropped on the Dock icon waits for a window that is ready to take it.
    if (pendingDocument) mainWindow.webContents.send("open-document");
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

/** Show the main window on a conversation picked somewhere else, such as Quick Ask. */
function openConversation(conversationId: string): void {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  if (!mainWindow) return;

  mainWindow.show();
  mainWindow.focus();
  if (mainWindow.webContents.isLoading()) {
    pendingConversation = conversationId;
  } else {
    mainWindow.webContents.send("open-conversation", conversationId);
  }
}

/**
 * A file the user opened from the Dock lands in the composer of the open chat.
 *
 * The file is read here, in the main process: the renderer may only read files
 * under the allowed roots, and a file the user picked in the OS is not one of
 * them. The renderer takes the attachment when it is ready for it.
 */
function openDocument(filePath: string): void {
  try {
    pendingDocument = attachmentFromFile(filePath);
  } catch (error) {
    logger.warn("document.open.failed", { error });
    return;
  }
  // Before the app is ready there is no window to show the file in yet.
  if (!app.isReady()) return;
  showMainWindow();
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isLoading()) {
    mainWindow.webContents.send("open-document");
  }
}

/** Hands the waiting document over, once. */
function takePendingDocument(): Attachment | null {
  const document = pendingDocument;
  pendingDocument = null;
  return document;
}

function installMenu(): void {
  installAppMenu(
    config.get("ui").language,
    (command) => showMainWindow(command),
    () => desktopManager?.showQuickAsk(),
    () => void checkForUpdates()
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
  openMonkey.on("approval-resolved", (payload: { requestId: string }) => {
    broadcast("approval-resolved", payload);
  });
  openMonkey.on("chat", (event) => broadcast("chat-event", event));
  openMonkey.on("quick-ask-started", (payload) => broadcast("quick-ask-started", payload));

  try {
    // Safe mode opens the app without the model and without the MCP servers, so a
    // broken one of them cannot keep the window from opening at all.
    await openMonkey.initialize({ skipModel: safeMode.active, skipMcp: safeMode.active });
    if (safeMode.active) logger.info("app.safe.mode", { reason: safeMode.reason });
  } catch (error) {
    // The window stays usable so the user can read the fix (npm run download-models).
    logger.error("agent.bootstrap.failed", { error });
    broadcast("agent-status", openMonkey.getStatus());
  }
}

/**
 * Relaunches the app, with or without the safe-mode switch.
 *
 * The child inherits this process's environment, so the switch has to be taken out
 * of it before the relaunch, not after: a launch asked for safe mode through the
 * environment would otherwise come back in safe mode after the user asked to leave.
 */
function relaunch(safe: boolean): void {
  if (!safe) {
    delete process.env[SAFE_MODE_ENV];
    // Leaving safe mode is the user saying the app is fine now: the count of
    // launches that died starts again from nothing.
    clearCrashes(crashRecordFile);
  }
  app.relaunch({ args: restartArgs(process.argv, safe) });
  app.quit();
}

registerIpcHandlers({
  getWindow: () => mainWindow,
  getAgent: () => openMonkey,
  getTray: () => trayManager,
  showMainWindow,
  openConversation,
  showQuickAsk: () => desktopManager?.showQuickAsk(),
  hideQuickAsk: () => desktopManager?.hideQuickAsk(),
  onConfigChanged: applyDesktopSettings,
  lockHistory,
  reloadHistoryViews: refreshHistoryViews,
  getSafeMode: () => safeMode,
  restartInSafeMode: () => relaunch(true),
  restartNormally: () => relaunch(false),
  takePendingDocument,
});

/**
 * A file the user drops on the Dock icon or opens from the Dock menu.
 * The listener has to be in place before the app is ready: the OS asks for the
 * file at launch, long before a window exists.
 */
app.on("open-file", (event, filePath) => {
  event.preventDefault();
  openDocument(filePath);
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    showMainWindow();
  });

  app.whenReady().then(async () => {
    enforceContentSecurityPolicy();
    applyNativeTheme();
    createWindow();

    desktopManager = new DesktopManager({
      getMainWindow: () => mainWindow,
      showMainWindow: () => showMainWindow(),
      resolveApproval: (requestId, approved) => openMonkey?.resolveApproval(requestId, approved),
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
      newChat: () => showMainWindow("new-chat"),
      recentChats: () => recentChats(openMonkey?.getConversations() ?? []),
      openConversation,
    },
    () => config.get("ui").language);
    trayManager.setupTray(assetPath("logos", "monkey-neutral-blue.png"));

    installMenu();
    applyDesktopSettings();
    // The renderer follows the OS in system mode; the native window backdrop must too.
    nativeTheme.on("updated", syncWindowBackground);
    // Safe mode asks the network for nothing, not even the update check.
    if (!safeMode.active) startUpdates();

    app.on("browser-window-created", (_event, window) => {
      window.webContents.on("did-finish-load", () => applyZoom(window));
    });

    await initializeOpenMonkey();
    // The app came up, one way or the other: a model that failed to load is not a
    // crash, and a crash before this line is the one safe mode is there for.
    markRunning(crashRecordFile);
    startLockWatcher(lockHistory);
    // A post the user scheduled goes out when its time comes, so the app has to
    // keep an eye on the queue even when no window is open. Safe mode is for
    // recovering from a crash, and posting is not part of that.
    if (!safeMode.active) startPublishScheduler();

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
  // Unloading the GGUF weights and killing the MLX child process must finish first:
  // freeing the Node environment while an addon worker is still running aborts it.
  event.preventDefault();
  shuttingDown = true;
  const warning = setTimeout(
    () => logger.warn("agent.shutdown.slow", { ms: SHUTDOWN_WARN_MS }),
    SHUTDOWN_WARN_MS
  );
  const watchdog = setTimeout(() => {
    logger.warn("agent.shutdown.forced", { ms: SHUTDOWN_WATCHDOG_MS });
    app.exit(0);
  }, SHUTDOWN_WATCHDOG_MS);
  openMonkey
    .shutdown()
    .catch((error: unknown) => logger.error("agent.shutdown.failed", { error }))
    .finally(() => {
      clearTimeout(warning);
      clearTimeout(watchdog);
      // The app was closed on purpose: the next launch starts from nothing.
      noteCleanExit(crashRecordFile);
      desktopManager?.destroy();
      trayManager?.destroy();
      app.quit();
    });
});

/**
 * A termination signal has to run the same drain: dying on SIGTERM frees the Node
 * environment under the model worker, which aborts the process, and skips the WAL
 * checkpoint that closes the encrypted history.
 */
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    logger.info("app.signal.quit", { signal });
    app.quit();
  });
}
