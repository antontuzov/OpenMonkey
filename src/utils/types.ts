export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  metadata?: {
    mood?: string;
    taskType?: string;
    durationMs?: number;
    stopped?: boolean;
    attachment?: { name: string; bytes: number };
  };
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  pinned: boolean;
  archived: boolean;
  messageCount: number;
  preview: string;
}

export interface ConversationSearchHit {
  conversation: Conversation;
  snippet: string;
}

export interface Attachment {
  name: string;
  bytes: number;
  text: string;
}

export type ChatErrorCode = "not-ready" | "context-overflow" | "offline" | "unknown";

/** Streamed over one IPC channel so the chat can render before the model finishes. */
export type ChatEvent =
  | { type: "start"; conversationId: string; message: Message }
  | { type: "token"; conversationId: string; messageId: string; token: string }
  | { type: "replace"; conversationId: string; messageId: string; content: string }
  | { type: "done"; conversationId: string; message: Message; title?: string }
  | { type: "stopped"; conversationId: string; message: Message }
  | {
      type: "error";
      conversationId: string;
      messageId: string;
      error: string;
      code: ChatErrorCode;
      message?: Message;
    };

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
  /** Set for shell calls so the rail can show what is running and offer a kill button. */
  command?: string;
  cwd?: string;
  /** Live stdout/stderr while a shell call runs; the final clipped result lands in `result`. */
  output?: string;
}

export type TaskType =
  | "file"
  | "web"
  | "shell"
  | "email"
  | "calendar"
  | "mcp"
  | "search"
  | "code"
  | "writing"
  | "analysis"
  | "automation";

export type TaskStatus =
  | "pending"
  | "awaiting-approval"
  | "running"
  | "completed"
  | "failed"
  | "denied"
  | "cancelled";

/** A single tool call the model asked OpenMonkey to run. */
export interface TaskRequest {
  type: TaskType;
  /** Tool action name, e.g. "read_file", "run_command". For MCP: "<serverId>.<tool>". */
  action: string;
  arguments: Record<string, unknown>;
  /** Human readable one-line summary shown in the approval dialog. */
  summary: string;
  /** True when the action touches files, runs commands, or sends anything off-device. */
  mutating: boolean;
}

export type ApprovalPolicy = "ask" | "allow" | "block";

export type AuditDecision =
  | "read-only"
  | "auto"
  | "policy"
  | "session"
  | "approved"
  | "denied"
  | "blocked"
  | "cancelled"
  | "invalid";

export interface ApprovalRequest {
  requestId: string;
  taskId: string;
  request: TaskRequest;
  /** Diff, command or argument preview computed before anything runs. */
  preview: string;
  /** Policy that produced this prompt, shown in the dialog. */
  policy: ApprovalPolicy;
}

/** One tool call, its authorization decision and its outcome. Persisted for export. */
export interface AuditEntry {
  id: string;
  taskId: string;
  conversationId: string | null;
  type: TaskType;
  action: string;
  summary: string;
  arguments: Record<string, unknown>;
  decision: AuditDecision;
  status: TaskStatus;
  result?: string;
  error?: string;
  createdAt: Date;
  completedAt?: Date;
}

export interface McpServerConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  enabled: boolean;
  approval: ApprovalPolicy;
}

export interface McpToolInfo {
  name: string;
  description?: string;
  readOnly: boolean;
}

export interface McpServerStatus {
  id: string;
  name: string;
  enabled: boolean;
  state: "stopped" | "connecting" | "ready" | "error";
  toolCount: number;
  tools: McpToolInfo[];
  error?: string;
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
    /** Master switch: true authorizes every mutating tool call without prompting. */
    autoExecuteTasks: boolean;
    /** Per-tool policy used when the master switch is off. */
    approvalPolicies: Record<"file" | "web" | "shell" | "calendar" | "email" | "mcp", ApprovalPolicy>;
    /** Extra folders the user granted in Settings → Workspace. */
    workspaceRoots: string[];
  };
  mcp: {
    servers: McpServerConfig[];
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
export type ConfigPatch = Partial<Pick<Config, "onboarding" | "model" | "ui" | "privacy" | "agent" | "mcp">>;

export interface ElectronAPI {
  processMessage: (conversationId: string, message: string, attachment?: Attachment) => Promise<Message | null>;
  regenerate: (conversationId: string) => Promise<Message | null>;
  getCurrentMood: () => Promise<Mood>;
  setMood: (mood: Mood) => Promise<void>;
  cycleMood: () => Promise<Mood>;
  getAgentStatus: () => Promise<AgentStatus>;
  getModelStatus: () => Promise<ModelStatus>;
  getTasks: () => Promise<Task[]>;
  getMessages: (conversationId: string) => Promise<Message[]>;
  getConversations: () => Promise<Conversation[]>;
  createConversation: () => Promise<Conversation>;
  switchConversation: (id: string) => Promise<Message[]>;
  renameConversation: (id: string, title: string) => Promise<void>;
  setConversationPinned: (id: string, pinned: boolean) => Promise<void>;
  deleteConversation: (id: string) => Promise<Conversation | null>;
  searchConversations: (query: string) => Promise<ConversationSearchHit[]>;
  attachFile: () => Promise<Attachment | null>;
  getConfig: () => Promise<Config>;
  setConfig: (patch: ConfigPatch) => Promise<Config>;
  approveTask: (requestId: string, approved: boolean, remember?: boolean) => Promise<void>;
  cancelTask: (taskId: string) => Promise<void>;
  getAuditLog: (limit?: number) => Promise<AuditEntry[]>;
  exportAuditLog: () => Promise<string | null>;
  clearAuditLog: () => Promise<void>;
  chooseWorkspaceFolder: () => Promise<string | null>;
  getMcpStatus: () => Promise<McpServerStatus[]>;
  restartMcpServer: (id: string) => Promise<McpServerStatus[]>;
  stopGeneration: () => Promise<void>;
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
  onChatEvent: (callback: (event: ChatEvent) => void) => () => void;
}

declare global {
  interface Window {
    electron?: ElectronAPI;
  }
}
