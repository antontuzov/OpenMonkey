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
};

export const safeStorage = {
  isEncryptionAvailable: () => false,
  encryptString: () => {
    throw new Error("safeStorage is unavailable in this harness");
  },
  decryptString: () => {
    throw new Error("safeStorage is unavailable in this harness");
  },
};

export const ipcMain = { handle: () => undefined, on: () => undefined, removeHandler: () => undefined };
export const BrowserWindow = class {};
export const dialog = {};
export const shell = {};
export const globalShortcut = {
  isRegistered: () => false,
  register: () => false,
  unregister: () => undefined,
};
export const screen = {
  getPrimaryDisplay: () => ({ workAreaSize: { width: 1440, height: 900 } }),
};

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
