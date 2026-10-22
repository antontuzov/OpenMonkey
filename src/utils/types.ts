export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  metadata?: {
    mood?: string;
    taskType?: string;
  };
}

export interface Task {
  id: string;
  type: TaskType;
  description: string;
  status: TaskStatus;
  createdAt: Date;
  completedAt?: Date;
  result?: string;
  error?: string;
  emoji: string;
}

export type TaskType =
  | "file"
  | "web"
  | "shell"
  | "email"
  | "calendar"
  | "search"
  | "code"
  | "writing"
  | "analysis"
  | "automation";

export type TaskStatus = "pending" | "awaiting-approval" | "running" | "completed" | "failed" | "denied";

/** A single tool call the model asked OpenMonkey to run. */
export interface TaskRequest {
  type: TaskType;
  /** Tool action name, e.g. "read_file", "run_command". */
  action: string;
  arguments: Record<string, unknown>;
  /** Human readable one-line summary shown in the approval dialog. */
  summary: string;
  /** True when the action touches files, runs commands, or sends anything off-device. */
  mutating: boolean;
}

export interface ApprovalRequest {
  requestId: string;
  taskId: string;
  request: TaskRequest;
}

export type Mood =
  | "happy"
  | "neutral"
  | "angry"
  | "shocked"
  | "silly"
  | "cool"
  | "love"
  | "tired"
  | "thinking"
  | "excited"
  | "calm"
  | "smile";

export const MOODS: Mood[] = [
  "happy",
  "neutral",
  "angry",
  "shocked",
  "silly",
  "cool",
  "love",
  "tired",
  "thinking",
  "excited",
  "calm",
  "smile",
];

/**
 * Shared by the main process (tray + dock icon files) and the renderer (avatar +
 * accent colour). Lives here because neither side may import the other's runtime.
 */
export const MOOD_LOGOS: Record<Mood, { file: string; color: string; label: string }> = {
  happy: { file: "monkey-happy-yellow.png", color: "#facc15", label: "Happy" },
  neutral: { file: "monkey-neutral-blue.png", color: "#3b82f6", label: "Neutral" },
  angry: { file: "monkey-angry-red.png", color: "#dc2626", label: "Angry" },
  shocked: { file: "monkey-shocked-orange.png", color: "#f97316", label: "Shocked" },
  silly: { file: "monkey-silly-green.png", color: "#22c55e", label: "Silly" },
  cool: { file: "monkey-cool-purple.png", color: "#9333ea", label: "Cool" },
  love: { file: "monkey-love-pink.png", color: "#ec4899", label: "Loving" },
  tired: { file: "monkey-tired-lavender.png", color: "#a5b4fc", label: "Tired" },
  thinking: { file: "monkey-thinking-cyan.png", color: "#06b6d4", label: "Thinking" },
  excited: { file: "monkey-excited-gold.png", color: "#eab308", label: "Excited" },
  calm: { file: "monkey-calm-mint.png", color: "#34d399", label: "Calm" },
  smile: { file: "monkey-smile-coral.png", color: "#fb7185", label: "Smiling" },
};

export interface ModelConfig {
  provider: "mlx" | "bonsai";
  path: string;
  contextSize: number;
  temperature: number;
  maxTokens: number;
}

export interface LogoConfig {
  mood: Mood;
  path: string;
  backgroundColor: string;
  description: string;
}

export type AgentState = "starting" | "loading-model" | "ready" | "error";

export interface AgentStatus {
  state: AgentState;
  /** Provider that actually loaded, if any. */
  provider?: "mlx" | "bonsai";
  message?: string;
}

/**
 * Persisted app settings. Defined here (not in utils/config.ts) because the renderer
 * type-checks against this file and must not pull in Electron or Node types.
 */
export interface Config {
  onboarding: {
    completed: boolean;
  };
  model: {
    provider: "mlx" | "bonsai";
    temperature: number;
    maxTokens: number;
  };
  ui: {
    theme: "system" | "light" | "dark";
    accent: string;
    currentMood: string;
  };
  privacy: {
    saveHistory: boolean;
    encryptData: boolean;
    autoDeleteAfter: number;
  };
  agent: {
    name: string;
    personality: string;
    autoExecuteTasks: boolean;
  };
}

export interface ModelStatus {
  provider: ModelProvider | null;
  mlxAvailable: boolean;
  bonsaiAvailable: boolean;
}

export type ModelDownloadPhase = "idle" | "downloading" | "verifying" | "done" | "error" | "cancelled";

export interface AutomationProbe {
  state: "granted" | "denied" | "unknown";
  message?: string;
}

export interface ModelDownloadStatus {
  phase: ModelDownloadPhase;
  bytesReceived: number;
  totalBytes: number;
  speedBytesPerSecond: number;
  /** null while unknown/untested, true after the pinned SHA-256 matches. */
  verified: boolean | null;
  error?: string;
}

export type ModelProvider = "mlx" | "bonsai";

/** Sections of Config the renderer may change, one at a time. */
export type ConfigPatch = Partial<Pick<Config, "onboarding" | "model" | "ui" | "privacy" | "agent">>;

export interface ElectronAPI {
  processMessage: (message: string) => Promise<string>;
  getCurrentMood: () => Promise<Mood>;
  setMood: (mood: Mood) => Promise<void>;
  cycleMood: () => Promise<Mood>;
  getAgentStatus: () => Promise<AgentStatus>;
  getModelStatus: () => Promise<ModelStatus>;
  getTasks: () => Promise<Task[]>;
  getMessages: () => Promise<Message[]>;
  getConfig: () => Promise<Config>;
  setConfig: (patch: ConfigPatch) => Promise<Config>;
  approveTask: (requestId: string, approved: boolean) => Promise<void>;
  stopGeneration: () => Promise<void>;
  newConversation: () => Promise<void>;
  switchProvider: (provider: "mlx" | "bonsai") => Promise<void>;
  downloadModel: () => Promise<ModelDownloadStatus>;
  cancelModelDownload: () => Promise<void>;
  verifyModel: () => Promise<ModelDownloadStatus>;
  getModelDownloadStatus: () => Promise<ModelDownloadStatus>;
  reloadModel: () => Promise<void>;
  probeAutomation: (area: "calendar" | "mail") => Promise<AutomationProbe>;
  openPermissionSettings: (area: "automation" | "notifications") => Promise<void>;
  openExternal: (url: string) => Promise<void>;

  /** Each subscription returns an unsubscribe function for the effect cleanup. */
  onAgentReady: (callback: () => void) => () => void;
  onAgentStatus: (callback: (status: AgentStatus) => void) => () => void;
  onMoodChange: (callback: (mood: string) => void) => () => void;
  onCycleMood: (callback: () => void) => () => void;
  onTaskUpdate: (callback: (task: Task) => void) => () => void;
  onApprovalRequest: (callback: (request: ApprovalRequest) => void) => () => void;
  onOpenSettings: (callback: () => void) => () => void;
  onModelDownloadStatus: (callback: (status: ModelDownloadStatus) => void) => () => void;
}

declare global {
  interface Window {
    electron?: ElectronAPI;
  }
}
