import Store from "electron-store";
import { app } from "electron";
import * as path from "node:path";
import * as fs from "node:fs";
import type { Config } from "./types";

const defaultConfig: Config = {
  model: {
    provider: "bonsai",
    temperature: 0.7,
    maxTokens: 2048,
  },
  ui: {
    theme: "system",
    accent: "#3ecf8e",
    currentMood: "neutral",
  },
  privacy: {
    saveHistory: true,
    encryptData: true,
    autoDeleteAfter: 30,
  },
  agent: {
    name: "OpenMonkey",
    personality: "helpful",
    // Task output can delete files and run commands, so a human approves each
    // action until they deliberately turn that off.
    autoExecuteTasks: false,
  },
};

const store = new Store<Config>({
  defaults: defaultConfig,
  name: "openmonkey-config",
});

export const config = {
  get: <K extends keyof Config>(key: K): Config[K] => store.get(key),

  set: <K extends keyof Config>(key: K, value: Config[K]): void => {
    store.set(key, value);
  },

  /** Shallow per-section merge so the UI can patch one group at a time. */
  merge: (patch: Partial<Config>): Config => {
    for (const [key, value] of Object.entries(patch)) {
      const section = key as keyof Config;
      store.set(section, { ...store.get(section), ...value } as Config[typeof section]);
    }
    return store.store;
  },

  getAll: (): Config => store.store,

  reset: (): void => {
    store.clear();
  },
};

const isPackaged = (): boolean => !!app.isPackaged;

/** `assets/` ships via electron-builder extraResources, so it moves in packaged builds. */
export function assetPath(...segments: string[]): string {
  const base = isPackaged() ? process.resourcesPath : path.resolve(app.getAppPath(), "assets");
  return path.join(base, ...segments);
}

/** Downloaded weights are user data: never inside the app bundle. */
export function modelsRoot(): string {
  const dir = isPackaged()
    ? path.join(app.getPath("userData"), "models")
    : path.resolve(app.getAppPath(), "models");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function dataRoot(): string {
  const dir = path.join(app.getPath("userData"), "data");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Folders the agent may touch without a path prompt. Deliberately narrow: a local
 * model that can browse the filesystem should not see the whole home directory.
 */
export function allowedRoots(): string[] {
  const home = process.env.HOME ?? app.getPath("home");
  return [
    path.join(home, "Documents"),
    path.join(home, "Downloads"),
    path.join(home, "Desktop"),
    dataRoot(),
  ];
}

export function ggufPath(): string {
  return path.join(modelsRoot(), "Bonsai-4B-gguf", "Bonsai-4B.gguf");
}

export function mlxModelPath(): string {
  return path.join(modelsRoot(), "Virtuoso-Lite-8bit-mlx");
}

export default config;
