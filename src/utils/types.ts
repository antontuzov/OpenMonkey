export interface MessageMetadata {
  mood?: string;
  taskType?: string;
  durationMs?: number;
  /** Tokens the model actually generated for this reply. */
  tokens?: number;
  stopped?: boolean;
  /** Every file that came with the message; the body itself is not kept here. */
  attachments?: MessageAttachment[];
  /** Set on every answer of a regenerated group; the first answer's own id. */
  variantOf?: string;
  /** Answers in this group, and which one the chat is showing (1-based). */
  variantCount?: number;
  variantIndex?: number;
}

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  metadata?: MessageMetadata;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  pinned: boolean;
  archived: boolean;
  /** A quick ask keeps its own conversation, kept out of the chat list until opened. */
  kind: ConversationKind;
  messageCount: number;
  preview: string;
  /** false when the user turned memory recall off for this conversation. */
  recall: boolean;
}

export type ConversationKind = "chat" | "quick";

/** One thread of the Quick Ask popover: a question, its answer and where it lives. */
export interface QuickAskThread {
  id: string;
  conversationId: string;
  question: string;
  answer: string;
  pinned: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface QuickAskResult {
  threadId: string;
  conversationId: string;
  message: Message | null;
}

export interface ConversationSearchHit {
  conversation: Conversation;
  snippet: string;
}

export interface Attachment {
  name: string;
  bytes: number;
  /** The file's text; empty for an image, whose pixels the model cannot read. */
  text: string;
  /** An image is attached by name only: the local models here read text. */
  kind?: "text" | "image";
}

/** What the history keeps about an attachment: the name and the size, not the body. */
export interface MessageAttachment {
  name: string;
  bytes: number;
  kind?: "text" | "image";
}

/** A file the composer offers when the user types @. */
export interface FileCandidate {
  path: string;
  name: string;
  dir: string;
  bytes: number;
}

export interface MemoryFact {
  id: string;
  content: string;
  createdAt: Date;
}

/**
 * What the model remembers about one conversation. The derived digest is computed
 * from the stored messages; the content is what actually gets injected, which is
 * the edited summary when the user wrote one.
 */
export interface MemorySummary {
  conversationId: string;
  title: string;
  messageCount: number;
  /** The extractive digest, always shown so the user can see what was derived. */
  derived: string;
  /** The text the model receives: the edited summary, or the derived digest. */
  content: string;
  /** true when the user wrote the summary themselves. */
  edited: boolean;
  /** false when the user turned recall off for this conversation. */
  recall: boolean;
  updatedAt: Date;
}

/** One row of the memory browser: a pinned fact or a conversation summary. */
export interface MemoryEntry {
  /** "fact:<id>" or "chat:<conversationId>" — stable, so the list can keep its selection. */
  id: string;
  kind: "fact" | "chat";
  title: string;
  content: string;
  subtitle: string;
  updatedAt: Date;
  recall?: boolean;
  edited?: boolean;
}

/** What a citation points at, resolved so the user can check the model. */
export interface CitationPreview {
  kind: "fact" | "file" | "chat";
  /** The citation as it appears in the answer. */
  label: string;
  title: string;
  text: string;
  path?: string;
  startLine?: number;
  endLine?: number;
  /** false when the source is gone or was never there. */
  found: boolean;
}

export interface WorkspaceHit {
  path: string;
  startLine: number;
  endLine: number;
  excerpt: string;
  score: number;
}

export interface WorkspaceIndexStatus {
  state: "idle" | "building" | "ready" | "error";
  enabled: boolean;
  files: number;
  chunks: number;
  bytes: number;
  builtAt?: Date;
  error?: string;
}

export interface MemorySnapshot {
  facts: MemoryFact[];
  summaries: MemorySummary[];
  workspace: WorkspaceIndexStatus;
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

/** One line of a file change. */
export interface DiffLine {
  kind: "same" | "add" | "del";
  text: string;
}

/** What a file write changed, line by line. */
export interface TaskDiff {
  path: string;
  added: number;
  removed: number;
  lines: DiffLine[];
}

/** The steps a task walked through, with the time each one took. */
export type TaskStepLabel = "queued" | "approval" | "running";

export interface TaskStep {
  label: TaskStepLabel;
  startedAt: number;
  endedAt?: number;
}

/** What a tool wrote, so the monitor can show the change instead of a sentence. */
export interface FileWrite {
  path: string;
  before: string;
  after: string;
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
  /** Set for shell calls so the rail can show what is running and offer a kill button. */
  command?: string;
  cwd?: string;
  /** Live stdout/stderr while a shell call runs; the final clipped result lands in `result`. */
  output?: string;
  /** The steps the task went through, each with its own duration. */
  steps?: TaskStep[];
  /** What a file write changed, line by line. */
  diff?: TaskDiff;
}

export type TaskType =
  | "file"
  | "web"
  | "shell"
  | "email"
  | "calendar"
  | "mcp"
  | "memory"
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
  /** Which window asked, so only that surface shows the approval dialog. */
  origin?: "main" | "quick";
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
 * `labelRu` lets both native menus and the UI translate the same mood name.
 */
export const MOOD_LOGOS: Record<
  Mood,
  { file: string; color: string; label: string; labelRu: string }
> = {
  happy: { file: "monkey-happy-yellow.png", color: "#facc15", label: "Happy", labelRu: "Радость" },
  neutral: { file: "monkey-neutral-blue.png", color: "#3b82f6", label: "Neutral", labelRu: "Спокойный" },
  angry: { file: "monkey-angry-red.png", color: "#dc2626", label: "Angry", labelRu: "Злой" },
  shocked: { file: "monkey-shocked-orange.png", color: "#f97316", label: "Shocked", labelRu: "Шок" },
  silly: { file: "monkey-silly-green.png", color: "#22c55e", label: "Silly", labelRu: "Шутник" },
  cool: { file: "monkey-cool-purple.png", color: "#9333ea", label: "Cool", labelRu: "Крутой" },
  love: { file: "monkey-love-pink.png", color: "#ec4899", label: "Loving", labelRu: "Любовь" },
  tired: { file: "monkey-tired-lavender.png", color: "#a5b4fc", label: "Tired", labelRu: "Усталый" },
  thinking: { file: "monkey-thinking-cyan.png", color: "#06b6d4", label: "Thinking", labelRu: "Думает" },
  excited: { file: "monkey-excited-gold.png", color: "#eab308", label: "Excited", labelRu: "Восторг" },
  calm: { file: "monkey-calm-mint.png", color: "#34d399", label: "Calm", labelRu: "Спокойствие" },
  smile: { file: "monkey-smile-coral.png", color: "#fb7185", label: "Smiling", labelRu: "Улыбается" },
};

export interface ModelConfig {
  provider: ModelPreference;
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

/** Where the history key is kept right now. `locked` means the database is closed. */
export type HistoryKeySource = "keychain" | "file" | "passphrase" | "locked" | "off";

/** The settings pages, in the order the sidebar lists them. */
export type SettingsPage =
  | "profile"
  | "appearance"
  | "desktop"
  | "approvals"
  | "memory"
  | "workspace"
  | "permissions"
  | "privacy"
  | "extensions"
  | "model";

/** Every settings page, in the order the sidebar lists them. */
export const SETTINGS_PAGES: SettingsPage[] = [
  "profile",
  "appearance",
  "desktop",
  "approvals",
  "memory",
  "workspace",
  "permissions",
  "privacy",
  "extensions",
  "model",
];

/**
 * Pages that own at least one stored setting, so "reset this page" has something to
 * put back. `permissions` only reports what macOS grants, so it has nothing to reset.
 */
export const RESETTABLE_PAGES: SettingsPage[] = [
  "profile",
  "appearance",
  "desktop",
  "approvals",
  "memory",
  "workspace",
  "privacy",
  "extensions",
  "model",
];

/** What the privacy page is allowed to claim about stored data. */
export interface PrivacyStatus {
  keySource: HistoryKeySource;
  keychainAvailable: boolean;
  locked: boolean;
  passphraseConfigured: boolean;
  autoLockMinutes: number;
  /** The database layout on disk; 0 while the history is locked. */
  schemaVersion: number;
  /** False when the deny-all-network switch is on. */
  networkAllowed: boolean;
  /** Bytes the history file plus its write-ahead log take on disk. */
  databaseBytes: number;
  /** When retention last ran over the stored history, or null if it never has. */
  lastPruneAt: number | null;
  /** Requests the app itself made since this launch, split by the network switch. */
  requestsAllowed: number;
  requestsBlocked: number;
}

/** Outcome of a passphrase or erase request, shaped for the settings page. */
export interface PrivacyActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Outcome of an encrypted backup round trip. `cancelled` is not an error: the user
 * closed the file dialog, and nothing was written or read.
 */
export interface PortabilityResult {
  ok: boolean;
  cancelled?: boolean;
  error?: string;
  fileName?: string;
  conversations?: number;
  messages?: number;
  facts?: number;
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
    provider: ModelPreference;
    temperature: number;
    maxTokens: number;
  };
  ui: {
    theme: "system" | "light" | "dark";
    accent: string;
    currentMood: string;
    /** Display scale; implemented as a native webContents zoom factor. */
    textScale: UiTextScale;
    density: UiDensity;
    /** Extra override on top of the OS Reduce Motion setting. */
    reduceMotion: boolean;
    /** The empty chat keeps its starter prompts until the user hides them. */
    starterPromptsHidden: boolean;
    language: AppLanguage;
    /** Which key sends a message; the other one starts a new line. */
    sendKey: "enter" | "cmd-enter";
  };
  privacy: {
    saveHistory: boolean;
    encryptData: boolean;
    autoDeleteAfter: number;
    /** 0 keeps the history open; otherwise idle minutes before a passphrase lock. */
    autoLockMinutes: number;
    /** When false the app makes no requests of its own: no downloads, no page fetches. */
    networkAllowed: boolean;
  };
  /** Bookkeeping the app keeps for itself; never a setting the user edits. */
  system: {
    /** Wall-clock time of the last retention pass, so the privacy page can date it. */
    lastPruneAt: number | null;
  };
  memory: {
    enabled: boolean;
    /** Opt-in: scan workspaces into a memory-only lexical index. */
    workspaceSearch: boolean;
  };
  desktop: {
    launchAtLogin: boolean;
    closeToTray: boolean;
    notifications: boolean;
    notifyOnComplete: boolean;
    quickAsk: boolean;
    /** Stable follows published releases; beta opts in to GitHub prereleases. */
    updateChannel: "stable" | "beta";
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

export type UiTextScale = "s" | "m" | "l";
export type UiDensity = "comfortable" | "compact";
export type AppLanguage = "en" | "ru";

export interface ModelStatus {
  provider: ModelProvider | null;
  /** What the user asked for: a concrete backend, or "auto" to let the app pick. */
  preference: ModelPreference;
  mlxAvailable: boolean;
  bonsaiAvailable: boolean;
  /** True once a short warm-up prompt has run against the loaded weights. */
  warmedUp: boolean;
  memory: ModelMemoryEstimate | null;
  /** The most recent measured run, kept until the model is unloaded. */
  lastBenchmark: ModelBenchmark | null;
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
  /** Space the download still needs, and what the volume has; null when unknown. */
  requiredBytes?: number;
  availableBytes?: number | null;
  error?: string;
}

export type ModelProvider = "mlx" | "bonsai";

/** What the user picked: a backend, or "auto" so the app picks the fastest one. */
export type ModelPreference = ModelProvider | "auto";

/** What the weights and the KV cache will cost before anything is loaded. */
export interface ModelMemoryEstimate {
  modelBytes: number;
  contextBytes: number;
  cpuRamBytes: number;
  gpuVramBytes: number;
  contextSize: number;
  trainContextSize: number | null;
}

/** One measured run of the local model. */
export interface ModelBenchmark {
  provider: ModelProvider;
  tokens: number;
  tokensPerSecond: number;
  timeToFirstTokenMs: number | null;
  generationMs: number;
  prompt: string;
  modelBytes: number;
  ranAt: number;
}

/** Sections of Config the renderer may change, one at a time. */
export type ConfigPatch = Partial<{
  onboarding: Partial<Config["onboarding"]>;
  model: Partial<Config["model"]>;
  ui: Partial<Config["ui"]>;
  privacy: Partial<Config["privacy"]>;
  memory: Partial<Config["memory"]>;
  desktop: Partial<Config["desktop"]>;
  agent: Partial<Config["agent"]>;
  mcp: Partial<Config["mcp"]>;
}>;

export type MenuCommand =
  | "new-chat"
  | "settings"
  | "toggle-activity"
  | "stop"
  | "cycle-mood"
  | "command-palette"
  | "focus-composer";

export interface ElectronAPI {
  processMessage: (conversationId: string, message: string, attachments?: Attachment[]) => Promise<Message | null>;
  /** Compact-window turn: a thread of its own, tagged so approvals show in the popover. */
  quickAsk: (message: string, threadId?: string) => Promise<QuickAskResult>;
  getQuickAskThreads: () => Promise<QuickAskThread[]>;
  setQuickAskPinned: (id: string, pinned: boolean) => Promise<void>;
  deleteQuickAsk: (id: string) => Promise<void>;
  /** Turn a quick ask into a normal chat and point the main window at it. */
  openQuickAskInChat: (id: string) => Promise<string | null>;
  getActiveConversationId: () => Promise<string | null>;
  showMainWindow: (command?: MenuCommand) => Promise<void>;
  openQuickAsk: () => Promise<void>;
  hideQuickAsk: () => Promise<void>;
  platform: string;
  regenerate: (conversationId: string) => Promise<Message | null>;
  /** Rewrite a sent question: everything after it goes, and the answer runs again. */
  editMessage: (conversationId: string, messageId: string, message: string) => Promise<Message | null>;
  /** A copy of the chat up to one message, as a conversation of its own. */
  branchConversation: (conversationId: string, messageId: string, title: string) => Promise<Conversation>;
  /** Every answer a regenerated reply kept, oldest first. */
  listVariants: (messageId: string) => Promise<Message[]>;
  /** Show one of those answers, and let the model continue the chat from it. */
  selectVariant: (conversationId: string, messageId: string) => Promise<void>;
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
  /** Open a file picker; several files may be chosen at once. */
  attachFiles: () => Promise<Attachment[]>;
  /** The files whose name matches an @mention, from the folders the app may read. */
  searchFiles: (query: string) => Promise<FileCandidate[]>;
  /** Read one of those files so it can ride along with a message. */
  readFile: (filePath: string) => Promise<Attachment>;
  /** Drop every turn of a chat but keep the chat itself. */
  clearConversation: (conversationId: string) => Promise<number>;
  /** Ask the local model to summarize the chat so far. */
  summarizeConversation: (conversationId: string) => Promise<Message | null>;
  getConfig: () => Promise<Config>;
  getPrivacyStatus: () => Promise<PrivacyStatus>;
  unlockHistory: (passphrase: string) => Promise<boolean>;
  setHistoryPassphrase: (passphrase: string) => Promise<PrivacyActionResult>;
  clearHistoryPassphrase: (passphrase: string) => Promise<PrivacyActionResult>;
  lockHistoryNow: () => Promise<void>;
  eraseAllHistory: (confirmation: string) => Promise<PrivacyActionResult>;
  exportHistoryBackup: (passphrase: string) => Promise<PortabilityResult>;
  importHistoryBackup: (passphrase: string, restoreSettings: boolean) => Promise<PortabilityResult>;
  setConfig: (patch: ConfigPatch) => Promise<Config>;
  /** Restore one page's own settings to their defaults. */
  resetSettingsSection: (page: SettingsPage) => Promise<Config>;
  approveTask: (requestId: string, approved: boolean, remember?: boolean) => Promise<void>;
  cancelTask: (taskId: string) => Promise<void>;
  /** Run a task again from what it asked the first time. */
  retryTask: (taskId: string) => Promise<Task | null>;
  getAuditLog: (limit?: number) => Promise<AuditEntry[]>;
  exportAuditLog: () => Promise<string | null>;
  clearAuditLog: () => Promise<void>;
  /** The tail of the live log file, already redacted at write time. */
  getLogTail: (lines?: number) => Promise<string>;
  clearLogs: () => Promise<PrivacyActionResult>;
  chooseWorkspaceFolder: () => Promise<string | null>;
  getMcpStatus: () => Promise<McpServerStatus[]>;
  restartMcpServer: (id: string) => Promise<McpServerStatus[]>;
  getMemorySnapshot: () => Promise<MemorySnapshot>;
  addMemoryFact: (content: string) => Promise<MemorySnapshot>;
  editMemoryFact: (id: string, content: string) => Promise<MemorySnapshot>;
  deleteMemoryFact: (id: string) => Promise<MemorySnapshot>;
  clearMemoryFacts: () => Promise<MemorySnapshot>;
  editMemorySummary: (conversationId: string, content: string) => Promise<MemorySnapshot>;
  forgetMemorySummary: (conversationId: string) => Promise<MemorySnapshot>;
  setConversationRecall: (conversationId: string, recall: boolean) => Promise<MemorySnapshot>;
  resolveCitation: (label: string) => Promise<CitationPreview>;
  rebuildWorkspaceIndex: () => Promise<WorkspaceIndexStatus>;
  clearWorkspaceIndex: () => Promise<WorkspaceIndexStatus>;
  searchWorkspaceMemory: (query: string) => Promise<WorkspaceHit[]>;
  stopGeneration: () => Promise<void>;
  switchProvider: (provider: ModelPreference) => Promise<void>;
  benchmarkModel: () => Promise<ModelBenchmark>;
  downloadModel: () => Promise<ModelDownloadStatus>;
  /** Picks a GGUF already on this Mac and puts it where the app looks for its weights. */
  importModel: () => Promise<ModelDownloadStatus>;
  cancelModelDownload: () => Promise<void>;
  verifyModel: () => Promise<ModelDownloadStatus>;
  deleteModel: () => Promise<ModelDownloadStatus>;
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
  /** The history was locked or erased and the renderer must drop what it holds. */
  onHistoryReset: (callback: () => void) => () => void;
  onMenuCommand: (callback: (command: MenuCommand) => void) => () => void;
  /** A quick ask was opened as a chat; the window should show that conversation. */
  onOpenConversation: (callback: (conversationId: string) => void) => () => void;
  onModelDownloadStatus: (callback: (status: ModelDownloadStatus) => void) => () => void;
  onChatEvent: (callback: (event: ChatEvent) => void) => () => void;
  /** A quick ask started; the popover needs its conversation before the first token. */
  onQuickAskStarted: (callback: (payload: QuickAskResult) => void) => () => void;
  /** A backup import merged chats or settings underneath the open windows. */
  onLocalDataChanged: (callback: () => void) => () => void;
}

declare global {
  interface Window {
    electron?: ElectronAPI;
  }
}
