import Store from "electron-store";
import { app } from "electron";
import * as path from "node:path";
import * as fs from "node:fs";
import type { Config, ConfigPatch, SettingsPage } from "./types";
import { BONSAI_4B } from "../models/catalog";

const defaultConfig: Config = {
  onboarding: {
    completed: false,
  },
  model: {
    provider: "auto",
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
    starterPromptsHidden: false,
    language: "en",
    sendKey: "enter",
  },
  privacy: {
    saveHistory: true,
    encryptData: true,
    autoDeleteAfter: 30,
    autoLockMinutes: 0,
    // One switch for every request the app makes itself: model downloads and page
    // fetches. Loopback to the local MLX server stays open either way.
    networkAllowed: true,
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
    updateChannel: "stable",
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
  system: {
    lastPruneAt: null,
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

/**
 * What "reset this page" puts back: only the fields that page owns, so resetting
 * Appearance cannot quietly undo a privacy choice made somewhere else.
 */
const PAGE_DEFAULTS: Partial<Record<SettingsPage, ConfigPatch>> = {
  profile: {
    agent: { name: defaultConfig.agent.name, personality: defaultConfig.agent.personality },
  },
  appearance: {
    ui: {
      theme: defaultConfig.ui.theme,
      accent: defaultConfig.ui.accent,
      textScale: defaultConfig.ui.textScale,
      density: defaultConfig.ui.density,
      reduceMotion: defaultConfig.ui.reduceMotion,
      language: defaultConfig.ui.language,
      sendKey: defaultConfig.ui.sendKey,
    },
  },
  desktop: {
    desktop: {
      launchAtLogin: defaultConfig.desktop.launchAtLogin,
      closeToTray: defaultConfig.desktop.closeToTray,
      notifications: defaultConfig.desktop.notifications,
      notifyOnComplete: defaultConfig.desktop.notifyOnComplete,
      quickAsk: defaultConfig.desktop.quickAsk,
      updateChannel: defaultConfig.desktop.updateChannel,
    },
  },
  approvals: {
    agent: {
      autoExecuteTasks: defaultConfig.agent.autoExecuteTasks,
      approvalPolicies: { ...defaultConfig.agent.approvalPolicies },
    },
  },
  memory: {
    memory: { enabled: defaultConfig.memory.enabled, workspaceSearch: defaultConfig.memory.workspaceSearch },
  },
  workspace: { agent: { workspaceRoots: [] } },
  privacy: {
    privacy: {
      saveHistory: defaultConfig.privacy.saveHistory,
      encryptData: defaultConfig.privacy.encryptData,
      autoDeleteAfter: defaultConfig.privacy.autoDeleteAfter,
      autoLockMinutes: defaultConfig.privacy.autoLockMinutes,
      networkAllowed: defaultConfig.privacy.networkAllowed,
    },
  },
  extensions: { mcp: { servers: [] } },
  model: {
    model: {
      provider: defaultConfig.model.provider,
      temperature: defaultConfig.model.temperature,
      maxTokens: defaultConfig.model.maxTokens,
    },
  },
};

/** Pages whose settings are stored, so the reset action only appears where it does something. */
export const resettablePages = (): SettingsPage[] =>
  Object.keys(PAGE_DEFAULTS) as SettingsPage[];

/**
 * The defaults for one page, as a patch. Returning the patch instead of writing it lets
 * the IPC layer apply it through the same guarded path as a normal settings change, so a
 * reset cannot skip the history-encryption checks.
 */
export function resetPatch(page: SettingsPage): ConfigPatch {
  return PAGE_DEFAULTS[page] ?? {};
}

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
