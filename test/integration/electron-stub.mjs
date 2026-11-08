import path from "node:path";

const root = () => {
  const value = process.env.OM_STUB_HOME;
  if (!value) throw new Error("OM_STUB_HOME is not set");
  return value;
};

export const app = {
  getPath(name) {
    if (name === "home") return path.join(root(), "home");
    return root();
  },
  getAppPath: () => root(),
  getVersion: () => "0.9.0-test",
  getName: () => "openmonkey",
  isPackaged: false,
  on: () => undefined,
  once: () => undefined,
  whenReady: async () => undefined,
  quit: () => undefined,
  isReady: () => true,
  addRecentDocument: (filePath) => {
    recentDocuments.push(filePath);
  },
  getRecentDocuments: () => [...recentDocuments],
  dock: { setIcon: () => undefined, bounce: () => 1 },
};

/** The files the Dock was told about, newest last. */
export const recentDocuments = [];

export const safeStorage = {
  isEncryptionAvailable: () => false,
  encryptString: () => {
    throw new Error("safeStorage is unavailable in this harness");
  },
  decryptString: () => {
    throw new Error("safeStorage is unavailable in this harness");
  },
};

/** The IPC handlers the app registered, so a test can call one of them. */
export const ipcHandlers = new Map();

export const ipcMain = {
  handle: (channel, handler) => {
    ipcHandlers.set(channel, handler);
  },
  on: () => undefined,
  removeHandler: (channel) => {
    ipcHandlers.delete(channel);
  },
};
export const BrowserWindow = class {};

export const dialog = {
  /** What the next file picker hands back. */
  openDialogResult: { canceled: true, filePaths: [] },
  showOpenDialog: async () => dialog.openDialogResult,
  /** What the next save dialog hands back. */
  saveDialogResult: { canceled: true, filePath: undefined },
  showSaveDialog: async () => dialog.saveDialogResult,
};

export const shell = {};
export const globalShortcut = {
  isRegistered: () => false,
  register: () => false,
  unregister: () => undefined,
};
export const screen = {
  getPrimaryDisplay: () => ({ workAreaSize: { width: 1440, height: 900 } }),
};

/** Every menu the app built, newest last. */
export const builtMenus = [];

export const Menu = {
  buildFromTemplate: (template) => {
    const menu = { template };
    builtMenus.push(menu);
    return menu;
  },
  setApplicationMenu: () => undefined,
};

export const nativeImage = {
  createFromPath: (filePath) => ({
    path: filePath,
    isEmpty: () => false,
    resize: () => ({ path: filePath, isEmpty: () => false }),
  }),
};

/** Every tray the app created, newest last. */
export const trays = [];

export class Tray {
  constructor(icon) {
    this.icon = icon;
    this.menu = null;
    this.tooltip = "";
    this.popped = 0;
    this.listeners = new Map();
    trays.push(this);
  }

  setToolTip(text) {
    this.tooltip = text;
  }

  setContextMenu(menu) {
    this.menu = menu;
  }

  setImage(image) {
    this.icon = image;
  }

  on(event, listener) {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  /** Fire the event macOS would fire when the user right-clicks the icon. */
  emit(event, ...args) {
    for (const listener of this.listeners.get(event) ?? []) listener({}, ...args);
  }

  popUpContextMenu() {
    this.popped += 1;
  }

  destroy() {
    this.destroyed = true;
  }
}

/** Every notification the app asked for, newest last. */
export const notifications = [];

/**
 * The harness plays the part of macOS: it keeps the notification so a test can read
 * what it carries and press the button a user would press.
 */
export class Notification {
  static isSupported() {
    return true;
  }

  constructor(options) {
    this.options = options;
    this.actions = options.actions ?? [];
    this.shown = false;
    this.listeners = new Map();
    notifications.push(this);
  }

  on(event, listener) {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  show() {
    this.shown = true;
  }

  /** Fire the event macOS would fire when the user clicks the banner or a button. */
  emit(event, ...args) {
    for (const listener of this.listeners.get(event) ?? []) listener({}, ...args);
  }
}
