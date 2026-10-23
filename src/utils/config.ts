import Store from "electron-store";
import { app } from "electron";
import * as path from "node:path";
import * as fs from "node:fs";
import type { Config, ConfigPatch } from "./types";
import { BONSAI_4B } from "../models/catalog";

const defaultConfig: Config = {
  onboarding: {
    completed: false,
  },
  model: {
    provider: "bonsai",
    temperature: 0.7,
    maxTokens: 2048,
  },
  ui: {
    theme: "system",
    accent: "#3ecf8e",
    currentMood: "neutral",
    textScale: "m",
    density: "comfortable",
    reduceMotion: false,
    language: "en",
  },
  privacy: {
    saveHistory: true,
    encryptData: true,
    autoDeleteAfter: 30,
  },
  memory: {
    enabled: true,
    workspaceSearch: false,
  },
  desktop: {
    launchAtLogin: false,
    // macOS keeps the app alive without its window; other platforms keep the
    // loaded model warm in the tray when the window is closed.
    closeToTray: process.platform !== "darwin",
    notifications: true,
    notifyOnComplete: true,
    quickAsk: true,
  },
  agent: {
    name: "OpenMonkey",
    personality: "helpful",
    // Task output can delete files and run commands, so a human approves each
    // action until they deliberately turn that off.
    autoExecuteTasks: false,
    approvalPolicies: {
      file: "ask",
      web: "ask",
      shell: "ask",
      calendar: "ask",
      email: "ask",
      mcp: "ask",
    },
    workspaceRoots: [],
  },
  mcp: {
    servers: [],
  },
};

const store = new Store<Config>({
  defaults: defaultConfig,
  name: "openmonkey-config",
});

/** electron-store only fills whole missing keys; new sub-fields need this merge. */
const withDefaults = <K extends keyof Config>(key: K): Config[K] => {
  const base = defaultConfig[key];
  const stored = store.get(key);
  if (base && typeof base === "object" && !Array.isArray(base) && stored && typeof stored === "object") {
    return { ...base, ...stored } as Config[K];
  }
  return (stored ?? base) as Config[K];
};

export const config = {
  get: withDefaults,

  set: <K extends keyof Config>(key: K, value: Config[K]): void => {
    store.set(key, value);
  },

  /** Shallow per-section merge so the UI can patch only the fields it changed. */
  merge: (patch: ConfigPatch): Config => {
    for (const [key, value] of Object.entries(patch)) {
      if (!value) continue;
      const section = key as keyof Config;
      store.set(section, { ...withDefaults(section), ...value } as Config[typeof section]);
    }
    return config.getAll();
  },

  getAll: (): Config =>
    Object.fromEntries(
      (Object.keys(defaultConfig) as Array<keyof Config>).map((key) => [key, withDefaults(key)])
    ) as unknown as Config,

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
 * model that can browse the filesystem should not see the whole home directory,
 * and it never gets the app's own data folder where the database and key live.
 * Extra roots come only from the explicit folder picker in Settings → Workspace.
 */
export function allowedRoots(): string[] {
  const home = process.env.HOME ?? app.getPath("home");
  const roots = [
    path.join(home, "Documents"),
    path.join(home, "Downloads"),
    path.join(home, "Desktop"),
    ...(config.get("agent").workspaceRoots ?? []),
  ];
  return [...new Set(roots.filter(Boolean).map((root) => path.resolve(root)))];
}

export function mcpServers() {
  return config.get("mcp")?.servers ?? [];
}

export function ggufPath(): string {
  return path.join(modelsRoot(), BONSAI_4B.dirName, BONSAI_4B.file);
}

export function mlxModelPath(): string {
  return path.join(modelsRoot(), "Virtuoso-Lite-8bit-mlx");
}

export default config;
