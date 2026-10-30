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
