import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Bell,
  Brain,
  CalendarClock,
  Check,
  ChevronDown,
  Cpu,
  Download,
  ExternalLink,
  Files,
  Fingerprint,
  FolderOpen,
  FolderPlus,
  FolderSearch,
  Globe,
  Info,
  Keyboard,
  Loader,
  Lock,
  LockOpen,
  Mail,
  MessageSquare,
  Monitor,
  Palette,
  Pin,
  Plug,
  Plus,
  RefreshCw,
  RotateCw,
  Search,
  ShieldCheck,
  SquareTerminal,
  Trash2,
  Upload,
  UserRound,
  X,
} from "lucide-react";
import { ModelDownloadCard } from "./ModelDownloadCard";
import { ACCENTS } from "../constants";
import { checkAccent } from "../theme";
import { moodLabel, t } from "../i18n";
import { toast } from "./Toast";
import {
  MOODS,
  MOOD_LOGOS,
  type AgentStatus,
  type ApprovalPolicy,
  type AuditEntry,
  type AutomationProbe,
  type Config,
  type ConfigPatch,
  type McpServerConfig,
  type McpServerStatus,
  type MemorySnapshot,
  type ModelStatus,
  type Mood,
  type PrivacyStatus,
  type WorkspaceHit,
} from "../../utils/types";

interface SettingsViewProps {
  status: AgentStatus;
  mood: Mood;
  config: Config;
  onPatch: (patch: ConfigPatch) => Promise<void>;
  onClose: () => void;
  onRefreshStatus: () => Promise<void>;
}

type Section =
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

const DEFAULT_POLICIES: Record<"file" | "web" | "shell" | "calendar" | "email" | "mcp", ApprovalPolicy> = {
  file: "ask",
  web: "ask",
  shell: "ask",
  calendar: "ask",
  email: "ask",
  mcp: "ask",
};

const POLICY_ROWS: Array<{
  type: keyof typeof DEFAULT_POLICIES;
  icon: typeof Files;
  name: string;
  copy: string;
}> = [
  { type: "file", icon: Files, name: "Files", copy: "Read, write, move and Trash files." },
  { type: "web", icon: Globe, name: "Web", copy: "Fetch a page or open a link you asked about." },
  { type: "shell", icon: SquareTerminal, name: "Shell", copy: "Run a command and stream its output." },
  { type: "calendar", icon: CalendarClock, name: "Calendar", copy: "Read events and create new ones." },
  { type: "email", icon: Mail, name: "Mail", copy: "Read unread mail and create drafts. Never sends." },
  { type: "mcp", icon: Plug, name: "MCP tools", copy: "Calls on local extension servers." },
];

const POLICY_OPTIONS: Array<{ value: ApprovalPolicy; label: string }> = [
  { value: "ask", label: "Ask" },
  { value: "allow", label: "Allow" },
  { value: "block", label: "Block" },
];

const DECISION_LABEL: Record<AuditEntry["decision"], string> = {
  "read-only": "read-only",
  auto: "master switch",
  policy: "policy allowed",
  session: "session allow",
  approved: "you allowed",
  denied: "you denied",
  blocked: "blocked",
  cancelled: "cancelled",
  invalid: "invalid request",
};

const AUDIT_STATUS: Record<AuditEntry["status"], { label: string; tone: string }> = {
  pending: { label: "queued", tone: "" },
  "awaiting-approval": { label: "needs you", tone: "!text-warn" },
  running: { label: "running", tone: "chip-accent" },
  completed: { label: "done", tone: "chip-accent" },
  failed: { label: "failed", tone: "!text-danger" },
  denied: { label: "denied", tone: "" },
  cancelled: { label: "cancelled", tone: "" },
};

const MCP_STATE: Record<McpServerStatus["state"], { label: string; tone: string }> = {
  stopped: { label: "stopped", tone: "" },
  connecting: { label: "starting…", tone: "!text-warn" },
  ready: { label: "ready", tone: "chip-accent" },
  error: { label: "error", tone: "!text-danger" },
};

function splitArgs(value: string): string[] {
  const result: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value))) result.push(match[1] ?? match[2] ?? match[3]);
  return result;
}

const NAV = [
  {
    labelKey: "settings.personal",
    items: [
      { id: "profile", labelKey: "settings.profile", icon: UserRound },
      { id: "appearance", labelKey: "settings.appearance", icon: Palette },
      { id: "desktop", labelKey: "settings.desktop", icon: Monitor },
    ],
  },
  {
    labelKey: "settings.control",
    items: [
      { id: "approvals", labelKey: "settings.approvals", icon: ShieldCheck },
      { id: "memory", labelKey: "settings.memory", icon: Brain },
      { id: "workspace", labelKey: "settings.workspace", icon: FolderOpen },
      { id: "permissions", labelKey: "settings.permissions", icon: Fingerprint },
      { id: "privacy", labelKey: "settings.privacy", icon: Lock },
    ],
  },
  {
    labelKey: "settings.extensionsGroup",
    items: [{ id: "extensions", labelKey: "settings.extensions", icon: Plug }],
  },
  {
    labelKey: "settings.modelGroup",
    items: [{ id: "model", labelKey: "settings.model", icon: Cpu }],
  },
] as const;

const TITLES: Record<Section, { titleKey: Parameters<typeof t>[0]; lede: string }> = {
  profile: {
    titleKey: "settings.profile",
    lede: "Who this assistant is on this Mac. These values shape its system prompt, not the model weights.",
  },
  appearance: {
    titleKey: "settings.appearance",
    lede: "Surface, accent and character. Everything here is stored locally and applied instantly.",
  },
  desktop: {
    titleKey: "settings.desktop",
    lede: "How OpenMonkey fits into macOS: startup, the menu bar, Quick Ask and notifications.",
  },
  approvals: {
    titleKey: "settings.approvals",
    lede: "Decide what runs on its own. Every call is previewed before it executes and recorded in the audit log.",
  },
  memory: {
    titleKey: "settings.memory",
    lede: "What OpenMonkey recalls across chats. Facts and digests stay local, and workspace search is opt-in.",
  },
  workspace: {
    titleKey: "settings.workspace",
    lede: "The folders tools may touch. Mutating calls still stop for approval unless you change the policy.",
  },
  extensions: {
    titleKey: "settings.extensions",
    lede: "Local MCP servers add tools over stdio. They run as child processes with the same approval and audit rules.",
  },
  permissions: {
    titleKey: "settings.permissions",
    lede: "macOS controls access to Calendar, Mail and notifications. Nothing is requested until you ask for it.",
  },
  privacy: {
    titleKey: "settings.privacy",
    lede: "Chat history and tasks live in a local SQLite file. These controls decide how long it stays readable.",
  },
  model: {
    titleKey: "settings.model",
    lede: "OpenMonkey answers with weights that live on this machine. Pick the backend and how it generates.",
  },
};

const SettingRow: React.FC<{ title: string; copy?: string; children: React.ReactNode }> = ({
  title,
  copy,
  children,
}) => (
  <div className="row">
    <div>
      <p className="row-title">{title}</p>
      {copy && <p className="row-copy">{copy}</p>}
    </div>
    <div className="flex items-center gap-2.5 shrink-0">{children}</div>
  </div>
);

const Toggle: React.FC<{ on: boolean; label: string; onChange: () => void; disabled?: boolean }> = ({
  on,
  label,
  onChange,
  disabled,
}) => (
  <button
    role="switch"
    aria-checked={on}
    aria-label={label}
    disabled={disabled}
    onClick={onChange}
    className={`toggle ${on ? "toggle-on" : ""} ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
  />
);

const Segmented: React.FC<{
  options: Array<{ value: string; label: string; disabled?: boolean }>;
  value: string;
  onChange: (value: string) => void;
}> = ({ options, value, onChange }) => (
  <div className="segmented">
    {options.map((option) => (
      <button
        key={option.value}
        disabled={option.disabled}
        onClick={() => onChange(option.value)}
        className={value === option.value ? "segmented-active" : ""}
      >
        {option.label}
      </button>
    ))}
  </div>
);

export const SettingsView: React.FC<SettingsViewProps> = ({
  status,
  mood,
  config,
  onPatch,
  onClose,
  onRefreshStatus,
}) => {
  const [section, setSection] = useState<Section>("profile");
  const [query, setQuery] = useState("");
  const [models, setModels] = useState<ModelStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [probes, setProbes] = useState<Partial<Record<"calendar" | "mail", AutomationProbe | "checking">>>({});
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [auditOpen, setAuditOpen] = useState<string | null>(null);
  const [auditNotice, setAuditNotice] = useState("");
  const [clearing, setClearing] = useState(false);
  const [mcp, setMcp] = useState<McpServerStatus[]>([]);
  const [mcpBusy, setMcpBusy] = useState<string | null>(null);
  const [mcpError, setMcpError] = useState("");
  const [adding, setAdding] = useState(false);
  const [serverName, setServerName] = useState("");
  const [serverCommand, setServerCommand] = useState("");
  const [serverArgs, setServerArgs] = useState("");
  const [serverEnv, setServerEnv] = useState("");
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [expandedServer, setExpandedServer] = useState<string | null>(null);
  const [memory, setMemory] = useState<MemorySnapshot | null>(null);
  const [factDraft, setFactDraft] = useState("");
  const [memoryNotice, setMemoryNotice] = useState("");
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [confirmClearFacts, setConfirmClearFacts] = useState(false);
  const [workspaceQuery, setWorkspaceQuery] = useState("");
  const [workspaceHits, setWorkspaceHits] = useState<WorkspaceHit[] | null>(null);
  const [privacyStatus, setPrivacyStatus] = useState<PrivacyStatus | null>(null);
  const [passDraft, setPassDraft] = useState("");
  const [passNotice, setPassNotice] = useState("");
  const [eraseDraft, setEraseDraft] = useState("");
  const [eraseNotice, setEraseNotice] = useState("");
  const [backupDraft, setBackupDraft] = useState("");
  const [backupNotice, setBackupNotice] = useState("");
  const [restoreSettings, setRestoreSettings] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [logText, setLogText] = useState<string | null>(null);
  const [logNotice, setLogNotice] = useState("");
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  const { model, agent, privacy } = config;
  const memoryConfig = config.memory ?? { enabled: true, workspaceSearch: false };
  const policies = { ...DEFAULT_POLICIES, ...(agent.approvalPolicies ?? {}) };
  const workspaceRoots = agent.workspaceRoots ?? [];
  const servers = config.mcp?.servers ?? [];
  const facts = memory?.facts ?? [];
  const digests = memory?.digests ?? [];
  const workspace = memory?.workspace;
  const accent = config.ui.accent ?? ACCENTS[0].value;
  const accentName = ACCENTS.find((item) => item.value === accent)?.name ?? "Custom";
  const logo = MOOD_LOGOS[mood] ?? MOOD_LOGOS.neutral;
  const ready = status.state === "ready";
  const keySource = privacyStatus?.keySource ?? "off";
  const passphraseOn = privacyStatus?.passphraseConfigured ?? false;
  const networkAllowed = privacy.networkAllowed !== false;
  const autoLockMinutes = privacyStatus?.autoLockMinutes ?? 0;
  const schemaVersion = privacyStatus?.schemaVersion ?? 0;
  const keyCopy = !privacy.encryptData
    ? "Off: messages, tasks and facts are written to the database in plain text."
    : passphraseOn
      ? "AES-256-GCM. The key only exists wrapped by your passphrase, so nothing opens the history until you type it. Remove the passphrase before turning encryption off."
      : keySource === "keychain"
        ? "AES-256-GCM. The key sits in this Mac's system keychain, not in a file."
        : keySource === "file"
          ? "AES-256-GCM. No system vault was available, so the key is a 0600 file in this app's support folder."
          : "AES-256-GCM with a key this app generates on first run.";
  const providerLabel = status.provider === "mlx" ? "MLX" : "Bonsai 4B";

  useEffect(() => {
    void window.electron?.getModelStatus().then(setModels).catch(() => undefined);
    void window.electron?.getPrivacyStatus().then(setPrivacyStatus).catch(() => undefined);
  }, []);

  const refreshModels = async () => {
    const next = await window.electron?.getModelStatus();
    if (next) setModels(next);
    await onRefreshStatus();
  };

  const refreshPrivacy = async () => {
    const next = await window.electron?.getPrivacyStatus();
    if (next) setPrivacyStatus(next);
  };

  const failureText = (value: unknown): string =>
    value instanceof Error ? value.message : "The app did not answer.";

  const applyPassphrase = async () => {
    if (passDraft.length < 6) return;
    setPassNotice("");
    try {
      const result = await window.electron?.setHistoryPassphrase(passDraft);
      if (!result?.ok) {
        setPassNotice(result?.error ?? "Could not set the passphrase.");
        return;
      }
      setPassDraft("");
      toast(t("toast.passphraseSet"));
      await refreshPrivacy();
    } catch (error) {
      setPassNotice(failureText(error));
    }
  };

  const removePassphrase = async () => {
    if (passDraft.length < 6) return;
    setPassNotice("");
    try {
      const result = await window.electron?.clearHistoryPassphrase(passDraft);
      if (!result?.ok) {
        setPassNotice(result?.error ?? t("lock.wrong"));
        return;
      }
      setPassDraft("");
      toast(t("toast.passphraseRemoved"));
      await refreshPrivacy();
    } catch (error) {
      setPassNotice(failureText(error));
    }
  };

  const eraseEverything = async () => {
    if (eraseDraft !== "ERASE") {
      setEraseNotice(t("privacy.eraseConfirm"));
      return;
    }
    setEraseNotice("");
    try {
      const result = await window.electron?.eraseAllHistory(eraseDraft);
      // On success the main process rebuilds this window over an empty database.
      if (!result?.ok) setEraseNotice(result?.error ?? "Could not erase the history.");
    } catch (error) {
      setEraseNotice(failureText(error));
    }
  };

  /**
   * The passphrase here belongs to the file, not to this machine's history key, so a
   * backup found by someone else cannot be opened with what they already have.
   */
  const runBackup = async (direction: "export" | "import") => {
    if (backupDraft.length < 8) {
      setBackupNotice(t("privacy.backupShort"));
      return;
    }
    setBackupBusy(true);
    setBackupNotice("");
    try {
      const api = window.electron;
      const result =
        direction === "export"
          ? await api?.exportHistoryBackup(backupDraft)
          : await api?.importHistoryBackup(backupDraft, restoreSettings);
      if (!result) return;
      // Closing the file panel is not a failure, so it says nothing at all.
      if (result.cancelled) return;
      if (!result.ok) {
        setBackupNotice(result.error ?? "The backup did not go through.");
        return;
      }
      setBackupDraft("");
      setBackupNotice(
        direction === "export"
          ? t("privacy.exported", {
              file: result.fileName ?? "",
              chats: result.conversations ?? 0,
              facts: result.facts ?? 0,
            })
          : t("privacy.imported", {
              file: result.fileName ?? "",
              chats: result.conversations ?? 0,
              messages: result.messages ?? 0,
              facts: result.facts ?? 0,
            })
      );
      toast(direction === "export" ? t("toast.backupExported") : t("toast.backupImported"));
      if (direction === "import") {
        // Settings may have come from the file, so the page shows the live values.
        await onRefreshStatus();
        await refreshPrivacy();
      }
    } catch (error) {
      setBackupNotice(failureText(error));
    } finally {
      setBackupBusy(false);
    }
  };

  const showLog = async () => {
    setLogNotice("");
    try {
      setLogText((await window.electron?.getLogTail(200)) ?? "");
    } catch (error) {
      setLogNotice(failureText(error));
    }
  };

  const wipeLog = async () => {
    setLogNotice("");
    try {
      const result = await window.electron?.clearLogs();
      if (!result?.ok) {
        setLogNotice(result?.error ?? "Could not clear the log.");
        return;
      }
      setLogText((await window.electron?.getLogTail(200)) ?? "");
      setLogNotice(t("diagnostics.cleared"));
    } catch (error) {
      setLogNotice(failureText(error));
    }
  };

  const refreshAudit = async () => {
    const entries = await window.electron?.getAuditLog(100).catch(() => []);
    if (entries) setAudit(entries);
  };

  const exportAudit = async () => {
    setAuditNotice("");
    try {
      const file = await window.electron?.exportAuditLog();
      if (file) {
        setAuditNotice(`Exported to ${file}`);
        toast(t("toast.auditExported"));
      }
    } catch (error) {
      setAuditNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const requestClearAudit = () => {
    if (!clearing) {
      setClearing(true);
      setAuditNotice("Click again to clear the local audit log.");
      window.setTimeout(() => setClearing(false), 4_000);
      return;
    }
    void window.electron?.clearAuditLog().then(() => {
      setClearing(false);
      setAuditNotice("Audit log cleared.");
      void refreshAudit();
    });
  };

  const refreshMcp = async () => {
    const status = await window.electron?.getMcpStatus().catch(() => []);
    if (status) setMcp(status);
  };

  const refreshMemory = async () => {
    const snapshot = await window.electron?.getMemorySnapshot().catch(() => null);
    if (snapshot) setMemory(snapshot);
  };

  const addFact = async () => {
    if (!factDraft.trim() || memoryBusy) return;
    setMemoryBusy(true);
    setMemoryNotice("");
    try {
      const snapshot = await window.electron?.addMemoryFact(factDraft);
      if (snapshot) setMemory(snapshot);
      setFactDraft("");
      setMemoryNotice("Fact saved and injected into the next prompt.");
      toast(t("toast.factSaved"));
    } catch (error) {
      setMemoryNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setMemoryBusy(false);
    }
  };

  const removeFact = async (id: string) => {
    setMemoryNotice("");
    try {
      const snapshot = await window.electron?.deleteMemoryFact(id);
      if (snapshot) setMemory(snapshot);
      setMemoryNotice("Fact removed.");
      toast(t("toast.factRemoved"));
    } catch (error) {
      setMemoryNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const clearAllFacts = async () => {
    if (!confirmClearFacts) {
      setConfirmClearFacts(true);
      setMemoryNotice("Click again to delete every pinned fact.");
      window.setTimeout(() => setConfirmClearFacts(false), 4_000);
      return;
    }
    setConfirmClearFacts(false);
    try {
      const snapshot = await window.electron?.clearMemoryFacts();
      if (snapshot) setMemory(snapshot);
      setMemoryNotice("All pinned facts deleted.");
    } catch (error) {
      setMemoryNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const toggleMemory = async (changes: Partial<Config["memory"]>) => {
    setMemoryNotice("");
    setWorkspaceHits(null);
    await onPatch({ memory: { ...memoryConfig, ...changes } });
    await refreshMemory();
  };

  const rebuildWorkspace = async () => {
    setMemoryBusy(true);
    setMemoryNotice("");
    setWorkspaceHits(null);
    try {
      await window.electron?.rebuildWorkspaceIndex();
      await refreshMemory();
      toast(t("toast.reindexed"));
    } finally {
      setMemoryBusy(false);
    }
  };

  const clearWorkspaceIndex = async () => {
    setWorkspaceHits(null);
    await window.electron?.clearWorkspaceIndex();
    await refreshMemory();
    toast(t("toast.workspaceCleared"));
  };

  const searchWorkspace = async () => {
    if (!workspaceQuery.trim()) return;
    setMemoryBusy(true);
    setMemoryNotice("");
    try {
      const hits = await window.electron?.searchWorkspaceMemory(workspaceQuery);
      setWorkspaceHits(hits ?? []);
    } catch (error) {
      setWorkspaceHits([]);
      setMemoryNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setMemoryBusy(false);
      await refreshMemory();
    }
  };

  const patchServer = async (id: string, changes: Partial<McpServerConfig>) => {
    await onPatch({
      mcp: { servers: servers.map((server) => (server.id === id ? { ...server, ...changes } : server)) },
    });
    await refreshMcp();
  };

  const addServer = async () => {
    const name = serverName.trim();
    const command = serverCommand.trim();
    if (!name || !command) {
      setMcpError("A display name and a command are required.");
      return;
    }
    const env: Record<string, string> = {};
    for (const line of serverEnv.split("\n").map((value) => value.trim()).filter(Boolean)) {
      const index = line.indexOf("=");
      if (index <= 0) {
        setMcpError(`Environment line "${line}" needs the form KEY=value.`);
        return;
      }
      env[line.slice(0, index).trim()] = line.slice(index + 1);
    }
    const server: McpServerConfig = {
      id: `mcp_${Date.now().toString(36)}`,
      name,
      command,
      args: splitArgs(serverArgs),
      env: Object.keys(env).length ? env : undefined,
      enabled: true,
      approval: "ask",
    };
    setMcpError("");
    try {
      await onPatch({ mcp: { servers: [...servers, server] } });
      await refreshMcp();
      toast(t("toast.serverAdded"));
      setAdding(false);
      setServerName("");
      setServerCommand("");
      setServerArgs("");
      setServerEnv("");
    } catch (error) {
      setMcpError(error instanceof Error ? error.message : String(error));
    }
  };

  const removeServer = async (id: string) => {
    await onPatch({ mcp: { servers: servers.filter((server) => server.id !== id) } });
    setRemovingId(null);
    await refreshMcp();
  };

  const restartServer = async (id: string) => {
    setMcpBusy(id);
    try {
      const status = await window.electron?.restartMcpServer(id);
      if (status) setMcp(status);
    } finally {
      setMcpBusy(null);
    }
  };

  const addWorkspace = async () => {
    const folder = await window.electron?.chooseWorkspaceFolder().catch(() => null);
    if (!folder || workspaceRoots.includes(folder)) return;
    await onPatch({ agent: { ...agent, workspaceRoots: [...workspaceRoots, folder] } });
    toast(t("toast.folderAdded"));
  };

  const removeWorkspace = (folder: string) => {
    void onPatch({
      agent: { ...agent, workspaceRoots: workspaceRoots.filter((root) => root !== folder) },
    });
  };

  const patchPolicy = (type: keyof typeof DEFAULT_POLICIES, value: ApprovalPolicy) => {
    void onPatch({ agent: { ...agent, approvalPolicies: { ...policies, [type]: value } } });
  };

  const checkAutomation = async (area: "calendar" | "mail") => {
    setProbes((current) => ({ ...current, [area]: "checking" }));
    try {
      const result = await window.electron?.probeAutomation(area);
      setProbes((current) => ({ ...current, [area]: result ?? { state: "unknown" } }));
    } catch (error) {
      setProbes((current) => ({
        ...current,
        [area]: { state: "unknown", message: error instanceof Error ? error.message : String(error) },
      }));
    }
  };

  useEffect(() => {
    if (section !== "approvals") return;
    void refreshAudit();
    const timer = window.setInterval(() => void refreshAudit(), 4_000);
    return () => window.clearInterval(timer);
  }, [section]);

  useEffect(() => {
    if (section !== "extensions") return;
    void refreshMcp();
  }, [section]);

  useEffect(() => {
    if (section !== "memory") return;
    void refreshMemory();
    const timer = window.setInterval(() => void refreshMemory(), 2_500);
    return () => window.clearInterval(timer);
  }, [section]);

  const probeChip = (area: "calendar" | "mail") => {
    const probe = probes[area];
    if (probe === "checking") return { label: "checking…", tone: "" };
    if (probe?.state === "granted") return { label: "allowed", tone: "chip-accent" };
    if (probe?.state === "denied") return { label: "blocked", tone: "!text-danger" };
    if (probe?.state === "unknown") return { label: "not checked", tone: "" };
    return { label: "not checked", tone: "" };
  };

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return NAV.map((group) => ({
      ...group,
      items: group.items.filter((item) => !needle || t(item.labelKey).toLowerCase().includes(needle)),
    })).filter((group) => group.items.length > 0);
  }, [query, config.ui.language]);

  const patchUi = (changes: Partial<Config["ui"]>) => void onPatch({ ui: changes });
  const patchDesktop = (changes: Partial<Config["desktop"]>) => void onPatch({ desktop: changes });

  const switchProvider = async (provider: "mlx" | "bonsai") => {
    setBusy(true);
    try {
      await window.electron?.switchProvider(provider);
      const next = await window.electron?.getModelStatus();
      if (next) setModels(next);
      await onRefreshStatus();
    } finally {
      setBusy(false);
    }
  };

  const checkAgain = async () => {
    setBusy(true);
    try {
      await refreshModels();
    } finally {
      setBusy(false);
    }
  };

  const workspaceChip = !memoryConfig.enabled
    ? { label: "memory off", tone: "" }
    : !memoryConfig.workspaceSearch
      ? { label: "off", tone: "" }
      : workspace?.state === "building"
        ? { label: "indexing…", tone: "!text-warn" }
        : workspace?.state === "error"
          ? { label: "failed", tone: "!text-danger" }
          : workspace?.state === "ready"
            ? { label: `${workspace.files} files · ${workspace.chunks} passages`, tone: "chip-accent" }
            : { label: "not indexed", tone: "" };

  const head = TITLES[section];
  const accentCheck = checkAccent(accent);

  const statusCopy =
    status.state === "ready"
      ? `Answering with ${providerLabel}. All inference stays on this Mac.`
      : status.state === "error"
        ? (status.message ?? "The model could not be loaded.")
        : status.state === "loading-model"
          ? "Reading the weights into memory…"
          : "Starting the local runtime…";

  return (
    <div className="flex h-screen bg-paper">
      <aside className="drag-region w-[300px] shrink-0 bg-card-2 border-r border-line flex flex-col">
        <div className="pt-9 px-3">
          <button
            onClick={onClose}
            className="no-drag flex items-center gap-1.5 w-full px-2 py-1 rounded-lg text-[11.5px] text-muted hover:text-ink hover:bg-ink/5"
          >
            <ArrowLeft size={13} />
            {t("settings.back")}
            <span className="kbd ml-auto">ESC</span>
          </button>

          <h1 className="text-[21px] font-semibold tracking-tight px-2 mt-4">{t("settings.title")}</h1>

          <button
            onClick={() => setSection("profile")}
            className="no-drag flex items-center gap-2 w-full px-2 py-1.5 mt-3 rounded-lg hover:bg-ink/5"
          >
            <img
              src={`/logos/${logo.file}`}
              alt=""
              className="w-[22px] h-[22px] rounded-full"
              style={{ boxShadow: `0 0 0 1.5px var(--color-card), 0 0 0 2.5px ${logo.color}55` }}
            />
            <span className="text-[12px] truncate">{agent.name}</span>
            <ChevronDown size={13} className="ml-auto text-faint" />
          </button>

          <div className="relative mt-3 no-drag">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("settings.search")}
              aria-label={t("settings.search")}
              className="field w-full !h-8 !pl-8 !text-[11.5px]"
            />
          </div>
        </div>

        <nav className="px-2 mt-3 overflow-y-auto no-drag">
          <button onClick={onClose} className="nav-item">
            <MessageSquare size={15} />
            {t("settings.ask")}
          </button>

          {groups.map((group) => (
            <div key={group.labelKey} className="mt-4">
              <p className="section-label px-2">{t(group.labelKey)}</p>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setSection(item.id)}
                      className={`nav-item ${section === item.id ? "nav-item-active" : ""}`}
                    >
                      <Icon size={15} />
                      {t(item.labelKey)}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {groups.length === 0 && (
            <p className="text-[11px] text-faint px-3 py-5 leading-relaxed">
              {t("settings.noMatch", { query })}
            </p>
          )}
        </nav>

        <div className="mt-auto px-4 py-3 flex items-center justify-between text-[10px] text-faint">
          <span className="flex items-center gap-1.5">
            <Lock size={10} />
            {t("nav.localOnly")}
          </span>
          <span>OpenMonkey</span>
        </div>
      </aside>

      <main className="relative flex-1 min-w-0 overflow-y-auto">
        <div className="deco-lines" />
        <div className="relative max-w-[780px] px-10 py-10">
          <div className="flex items-start justify-between gap-6 mb-8">
            <div>
              <h1 className="page-title">{t(head.titleKey)}</h1>
              <p className="lede">{head.lede}</p>
            </div>
            {section === "model" && (
              <button onClick={() => void checkAgain()} disabled={busy} className="btn shrink-0 mt-1">
                <RefreshCw size={13} className={busy ? "animate-spin" : ""} />
                Check again
              </button>
            )}
          </div>

          {section === "memory" && memoryNotice && (
            <div className="card px-3.5 py-2.5 mb-6 flex items-center gap-2">
              <Info size={13} className="text-faint shrink-0" />
              <span className="text-[11.5px] text-muted flex-1">{memoryNotice}</span>
              <button onClick={() => setMemoryNotice("")} aria-label="Dismiss notice" className="icon-btn">
                <X size={11} />
              </button>
            </div>
          )}

          <div className="space-y-8">
            {section === "profile" && (
              <>
                <section>
                  <p className="section-label">Identity</p>
                  <div className="card">
                    <div className="row">
                      <div className="flex items-center gap-3.5">
                        <img
                          src={`/logos/${logo.file}`}
                          alt=""
                          className="w-10 h-10 rounded-full logo-mood-change"
                          style={{ boxShadow: `0 0 0 2px var(--color-card), 0 0 0 3px ${logo.color}55` }}
                        />
                        <div>
                          <p className="row-title">{t("appearance.avatar")}</p>
                          <p className="row-copy">{t("appearance.avatarCopy")}</p>
                        </div>
                      </div>
                      <span className="chip chip-accent">
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--color-accent)" }} />
                        {moodLabel(mood)}
                      </span>
                    </div>

                    <div className="row">
                      <div>
                        <p className="row-title">Display name</p>
                        <p className="row-copy">How the assistant introduces itself in replies and in the sidebar.</p>
                      </div>
                      <input
                        key={agent.name}
                        defaultValue={agent.name}
                        onBlur={(event) => {
                          const name = event.target.value.trim();
                          if (name && name !== agent.name) void onPatch({ agent: { ...agent, name } });
                        }}
                        className="field w-[220px]"
                      />
                    </div>

                    <div className="row">
                      <div>
                        <p className="row-title">Personality</p>
                        <p className="row-copy">Steers tone in the system prompt. The weights never change.</p>
                      </div>
                      <div className="select-wrap">
                        <select
                          value={agent.personality}
                          onChange={(event) => void onPatch({ agent: { ...agent, personality: event.target.value } })}
                          className="field w-[180px]"
                        >
                          <option value="helpful">Helpful</option>
                          <option value="concise">Concise</option>
                          <option value="playful">Playful</option>
                        </select>
                        <ChevronDown size={14} />
                      </div>
                    </div>
                  </div>
                </section>

                <section>
                  <p className="section-label">At a glance</p>
                  <div className="card">
                    <SettingRow title="Primary model" copy="The backend currently answering questions.">
                      <span className="chip">{ready ? providerLabel : status.state}</span>
                    </SettingRow>
                    <SettingRow title="Tool approvals" copy="Whether actions stop for your confirmation first.">
                      <span className={`chip ${agent.autoExecuteTasks ? "" : "chip-accent"}`}>
                        {agent.autoExecuteTasks ? <LockOpen size={11} /> : <Lock size={11} />}
                        {agent.autoExecuteTasks ? "Runs freely" : "Per tool"}
                      </span>
                    </SettingRow>
                    <SettingRow title="Stored history" copy="A local SQLite file, sealed with AES-256-GCM by default.">
                      <span className="chip">{privacy.saveHistory ? "saved" : "memory only"}</span>
                    </SettingRow>
                  </div>
                </section>
              </>
            )}

            {section === "desktop" && (
              <>
                <section>
                  <p className="section-label">{t("desktop.startup")}</p>
                  <div className="card">
                    <SettingRow title={t("desktop.launchAtLogin")} copy={t("desktop.launchAtLoginCopy")}>
                      <Toggle
                        on={config.desktop.launchAtLogin}
                        label={t("desktop.launchAtLogin")}
                        onChange={() => patchDesktop({ launchAtLogin: !config.desktop.launchAtLogin })}
                      />
                    </SettingRow>
                    <SettingRow title={t("desktop.keepRunning")} copy={t("desktop.keepRunningCopy")}>
                      <Toggle
                        on={config.desktop.closeToTray}
                        label={t("desktop.keepRunning")}
                        onChange={() => patchDesktop({ closeToTray: !config.desktop.closeToTray })}
                      />
                    </SettingRow>
                  </div>
                </section>

                <section>
                  <p className="section-label">{t("desktop.notifications")}</p>
                  <div className="card">
                    <SettingRow title={t("desktop.notifyApprovals")} copy={t("desktop.notifyApprovalsCopy")}>
                      <Toggle
                        on={config.desktop.notifications}
                        label={t("desktop.notifyApprovals")}
                        onChange={() => patchDesktop({ notifications: !config.desktop.notifications })}
                      />
                    </SettingRow>
                    <SettingRow title={t("desktop.notifyDone")} copy={t("desktop.notifyDoneCopy")}>
                      <Toggle
                        on={config.desktop.notifyOnComplete}
                        label={t("desktop.notifyDone")}
                        disabled={!config.desktop.notifications}
                        onChange={() => patchDesktop({ notifyOnComplete: !config.desktop.notifyOnComplete })}
                      />
                    </SettingRow>
                  </div>
                  <p className="text-[10.5px] text-faint mt-2 px-1">{t("desktop.badge")}</p>
                </section>

                <section>
                  <p className="section-label">{t("desktop.quickAsk")}</p>
                  <div className="card">
                    <SettingRow title={t("desktop.quickAskToggle")} copy={t("desktop.quickAskToggleCopy")}>
                      <Toggle
                        on={config.desktop.quickAsk}
                        label={t("desktop.quickAskToggle")}
                        onChange={() => patchDesktop({ quickAsk: !config.desktop.quickAsk })}
                      />
                    </SettingRow>
                    <div className="row">
                      <div>
                        <p className="row-copy !mt-0 max-w-[52ch]">
                          {t("desktop.quickAskHint", { keys: "⌥ Space" })}
                        </p>
                      </div>
                      <button onClick={() => void window.electron?.openQuickAsk()} className="btn shrink-0">
                        <Keyboard size={13} />
                        {t("desktop.test")}
                      </button>
                    </div>
                  </div>
                </section>

                <section>
                  <p className="section-label">{t("shortcuts.title")}</p>
                  <div className="card">
                    {[
                      ["⌘ N", t("nav.newChat")],
                      ["⌘ K", t("nav.searchChats")],
                      ["⌘ ,", t("settings.title")],
                      ["⌘ \\", t("shortcuts.activity")],
                      ["⌘ L", t("shortcuts.focus")],
                      ["⌘ .", t("shortcuts.stop")],
                      ["⌥ Space", t("shortcuts.quick")],
                    ].map(([combo, label]) => (
                      <div className="row" key={combo}>
                        <span className="row-title">{label}</span>
                        <span className="kbd">{combo}</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10.5px] text-faint mt-2 px-1">{t("shortcuts.copy")}</p>
                </section>
              </>
            )}

            {section === "appearance" && (
              <>
                <section>
                  <p className="section-label">{t("appearance.colorMode")}</p>
                  <div className="card p-5">
                    <p className="row-title">{t("appearance.theme")}</p>
                    <p className="row-copy mb-4">{t("appearance.themeCopy")}</p>
                    <div className="grid grid-cols-3 gap-3">
                      {(["system", "light", "dark"] as const).map((theme) => {
                        const selected = config.ui.theme === theme;
                        const label =
                          theme === "system"
                            ? t("appearance.system")
                            : theme === "light"
                              ? t("appearance.light")
                              : t("appearance.dark");
                        return (
                          <button
                            key={theme}
                            onClick={() => patchUi({ theme })}
                            aria-pressed={selected}
                            className={`theme-option ${selected ? "theme-option-active" : ""}`}
                          >
                            <span className={`theme-preview theme-preview-${theme}`} aria-hidden="true">
                              <span className="theme-preview-side" />
                              <span className="theme-preview-main">
                                <span className="theme-preview-line w-3/4" />
                                <span className="theme-preview-line w-full" />
                                <span className="theme-preview-line w-1/2" />
                              </span>
                            </span>
                            <span className="flex items-center justify-center gap-1 text-[11px]">
                              {selected && <Check size={11} className="text-accent-ink" />}
                              {label}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </section>

                <section>
                  <p className="section-label">{t("appearance.accent")}</p>
                  <div className="card p-5">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      {ACCENTS.map((item) => {
                        const selected = item.value.toLowerCase() === accent.toLowerCase();
                        return (
                          <button
                            key={item.name}
                            onClick={() => patchUi({ accent: item.value })}
                            title={item.name}
                            aria-label={item.name}
                            aria-pressed={selected}
                            className={`swatch ${selected ? "swatch-selected" : ""}`}
                            style={{ background: item.value }}
                          >
                            {selected && <Check size={14} strokeWidth={3} />}
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex items-center justify-between gap-3 flex-wrap mt-4">
                      <p className="text-[11px] text-muted">
                        {t("appearance.using", { name: accentName })}
                      </p>
                      <label className="flex items-center gap-2 text-[11px] text-muted cursor-pointer">
                        <input
                          type="color"
                          value={accent}
                          onChange={(event) => patchUi({ accent: event.target.value })}
                          aria-label={t("appearance.customAccent")}
                          className="w-7 h-7 rounded-lg border border-line bg-transparent cursor-pointer"
                        />
                        {t("appearance.customAccent")}
                      </label>
                    </div>
                    <p className={`text-[10.5px] mt-2 ${accentCheck.passes ? "text-muted" : "text-warn"}`}>
                      {accentCheck.passes
                        ? t("appearance.contrast", {
                            ratio: accentCheck.ratio.toFixed(1),
                            label:
                              accentCheck.level === "aa"
                                ? t("appearance.contrastAA")
                                : t("appearance.contrastLarge"),
                          })
                        : t("appearance.contrastLow")}
                    </p>
                  </div>
                </section>

                <section>
                  <p className="section-label">{t("appearance.typography")}</p>
                  <div className="card">
                    <SettingRow title={t("appearance.textSize")} copy={t("appearance.textSizeCopy")}>
                      <Segmented
                        value={config.ui.textScale}
                        onChange={(value) => patchUi({ textScale: value as Config["ui"]["textScale"] })}
                        options={[
                          { value: "s", label: t("appearance.small") },
                          { value: "m", label: t("appearance.medium") },
                          { value: "l", label: t("appearance.large") },
                        ]}
                      />
                    </SettingRow>
                    <SettingRow title={t("appearance.density")} copy={t("appearance.densityCopy")}>
                      <Segmented
                        value={config.ui.density}
                        onChange={(value) => patchUi({ density: value as Config["ui"]["density"] })}
                        options={[
                          { value: "comfortable", label: t("appearance.comfortable") },
                          { value: "compact", label: t("appearance.compact") },
                        ]}
                      />
                    </SettingRow>
                    <SettingRow title={t("appearance.motion")} copy={t("appearance.reduceMotionCopy")}>
                      <Toggle
                        on={config.ui.reduceMotion}
                        label={t("appearance.reduceMotion")}
                        onChange={() => patchUi({ reduceMotion: !config.ui.reduceMotion })}
                      />
                    </SettingRow>
                    <SettingRow title={t("appearance.language")} copy={t("appearance.languageCopy")}>
                      <Segmented
                        value={config.ui.language}
                        onChange={(value) => patchUi({ language: value as Config["ui"]["language"] })}
                        options={[
                          { value: "en", label: "English" },
                          { value: "ru", label: "Русский" },
                        ]}
                      />
                    </SettingRow>
                  </div>
                  <div className="card p-5 mt-3">
                    <p className="text-faint text-[10px] tracking-[0.08em] uppercase">
                      OpenMonkey · A little clarity goes a long way
                    </p>
                    <p className="text-[13.5px] mt-2.5 leading-relaxed">
                      Good typography makes room for the conversation. One monospace face keeps the interface and the
                      chat in the same voice.
                    </p>
                    <pre className="mt-3.5 text-[11.5px] text-ink bg-card-2 border border-line rounded-lg px-3 py-2 overflow-x-auto">
                      const greeting = "Hello, world!";
                    </pre>
                  </div>
                </section>

                <section>
                  <p className="section-label">{t("appearance.mood")}</p>
                  <div className="card p-4">
                    <div className="grid grid-cols-6 gap-1.5">
                      {MOODS.map((name) => (
                        <button
                          key={name}
                          onClick={() => void window.electron?.setMood(name)}
                          className={`flex flex-col items-center gap-1.5 rounded-xl py-2 border transition-colors ${
                            name === mood
                              ? "border-accent bg-accent-soft"
                              : "border-transparent hover:bg-card-2"
                          }`}
                        >
                          <img src={`/logos/${MOOD_LOGOS[name].file}`} alt="" className="w-11 h-11 rounded-full" />
                          <span className={`text-[9.5px] ${name === mood ? "text-accent-ink" : "text-muted"}`}>
                            {moodLabel(name)}
                          </span>
                        </button>
                      ))}
                    </div>
                    <p className="text-[11px] text-muted mt-3.5">
                      {t("appearance.currentMood", { mood: moodLabel(mood) })}
                    </p>
                  </div>
                </section>
              </>
            )}

            {section === "approvals" && (
              <>
                <section>
                  <p className="section-label">Tool actions</p>
                  <div className="card">
                    <SettingRow
                      title="Run tool actions without asking"
                      copy="Off by default. When off, file writes, shell commands, calendar changes, mail drafts and MCP actions each follow their tool policy."
                    >
                      <Toggle
                        on={agent.autoExecuteTasks}
                        label="Run tool actions without asking"
                        onChange={() =>
                          void onPatch({ agent: { ...agent, autoExecuteTasks: !agent.autoExecuteTasks } })
                        }
                      />
                    </SettingRow>
                    <SettingRow title="Current policy" copy="Applies immediately to the next tool call.">
                      <span className={`chip ${agent.autoExecuteTasks ? "" : "chip-accent"}`}>
                        {agent.autoExecuteTasks ? <LockOpen size={11} /> : <Lock size={11} />}
                        {agent.autoExecuteTasks ? "Runs freely" : "Per-tool policy, reads stay free"}
                      </span>
                    </SettingRow>
                  </div>
                </section>

                <section>
                  <p className="section-label">Per-tool policy</p>
                  <div className="card">
                    {POLICY_ROWS.map((row) => {
                      const Icon = row.icon;
                      const value = policies[row.type];
                      return (
                        <div key={row.type} className="row">
                          <div className="flex items-center gap-3">
                            <span className="w-7 h-7 rounded-lg bg-card-2 flex items-center justify-center">
                              <Icon size={14} className="text-muted" />
                            </span>
                            <div>
                              <p className="row-title">{row.name}</p>
                              <p className="row-copy">{row.copy}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {agent.autoExecuteTasks && <span className="chip">master override</span>}
                            <div className="segmented">
                              {POLICY_OPTIONS.map((option) => (
                                <button
                                  key={option.value}
                                  disabled={agent.autoExecuteTasks}
                                  onClick={() => patchPolicy(row.type, option.value)}
                                  className={`${value === option.value ? "segmented-active" : ""} ${
                                    value === "block" && option.value === "block" ? "!text-danger" : ""
                                  }`}
                                >
                                  {option.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[10.5px] text-muted mt-2 px-1 leading-relaxed">
                    Read-only calls such as listing a folder or reading a file never prompt. Allow runs that tool
                    without asking; Block refuses every call of that type, including reads. The master switch above
                    overrides every row.
                  </p>
                </section>

                <section>
                  <div className="flex items-center justify-between gap-4 mb-2">
                    <p className="section-label !mb-0">Audit log</p>
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => void refreshAudit()} className="btn !h-7 !px-2.5">
                        <RefreshCw size={11} />
                        Refresh
                      </button>
                      <button onClick={() => void exportAudit()} className="btn !h-7 !px-2.5">
                        <Download size={11} />
                        Export
                      </button>
                      <button
                        onClick={requestClearAudit}
                        className={`btn !h-7 !px-2.5 ${clearing ? "!text-danger !border-danger/40" : ""}`}
                      >
                        <Trash2 size={11} />
                        {clearing ? "Confirm" : "Clear"}
                      </button>
                    </div>
                  </div>

                  <div className="card">
                    {audit.length === 0 ? (
                      <div className="p-6 text-center">
                        <ShieldCheck size={18} className="mx-auto text-faint" />
                        <p className="text-[11.5px] text-muted mt-2">
                          Every tool call lands here with its decision, arguments and outcome. Nothing has run yet.
                        </p>
                      </div>
                    ) : (
                      audit.map((entry) => {
                        const Icon =
                          entry.type === "file"
                            ? Files
                            : entry.type === "web"
                              ? Globe
                              : entry.type === "shell"
                                ? SquareTerminal
                                : entry.type === "calendar"
                                  ? CalendarClock
                                  : entry.type === "email"
                                    ? Mail
                                    : entry.type === "mcp"
                                      ? Plug
                                      : ShieldCheck;
                        const status = AUDIT_STATUS[entry.status];
                        const open = auditOpen === entry.id;
                        const created = new Date(entry.createdAt);
                        const stamp = `${created.toLocaleDateString([], { month: "short", day: "numeric" })} · ${created.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
                        return (
                          <div key={entry.id}>
                            <button
                              onClick={() => setAuditOpen(open ? null : entry.id)}
                              className="row w-full text-left"
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <span className="w-7 h-7 rounded-lg bg-card-2 flex items-center justify-center shrink-0">
                                  <Icon size={14} className="text-muted" />
                                </span>
                                <div className="min-w-0">
                                  <p className="row-title truncate">{entry.action}</p>
                                  <p className="row-copy truncate">{entry.summary}</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="text-[10px] text-faint tabular-nums">{stamp}</span>
                                <span className="chip">{DECISION_LABEL[entry.decision]}</span>
                                <span className={`chip ${status.tone}`}>{status.label}</span>
                                <ChevronDown
                                  size={13}
                                  className={`text-faint transition-transform ${open ? "rotate-180" : ""}`}
                                />
                              </div>
                            </button>
                            {open && (
                              <div className="px-4 pb-4 -mt-1 space-y-2">
                                <div>
                                  <p className="text-[9.5px] tracking-[0.08em] uppercase text-faint mb-1">Arguments</p>
                                  <pre className="text-[10.5px] leading-relaxed bg-card-2 border border-line rounded-lg px-3 py-2 overflow-x-auto max-h-[220px] overflow-y-auto">
                                    {JSON.stringify(entry.arguments, null, 2)}
                                  </pre>
                                </div>
                                {entry.result && (
                                  <div>
                                    <p className="text-[9.5px] tracking-[0.08em] uppercase text-faint mb-1">Result</p>
                                    <pre className="text-[10.5px] leading-relaxed bg-card-2 border border-line rounded-lg px-3 py-2 overflow-x-auto max-h-[180px] overflow-y-auto whitespace-pre-wrap">
                                      {entry.result}
                                    </pre>
                                  </div>
                                )}
                                {entry.error && (
                                  <p className="text-[10.5px] text-danger leading-relaxed">Error: {entry.error}</p>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                  {auditNotice && <p className="text-[10.5px] text-muted mt-2 px-1 leading-relaxed">{auditNotice}</p>}
                  <p className="text-[10.5px] text-muted mt-2 px-1 leading-relaxed">
                    Entries are sealed with the same AES-256-GCM key as chat history and pruned with the auto-delete
                    window. Export writes a plain JSON file you choose, mode 0600.
                  </p>
                </section>

                <div className="card p-4 flex items-start gap-2.5">
                  <Info size={14} className="text-faint mt-0.5 shrink-0" />
                  <p className="text-[11px] text-muted leading-relaxed">
                    Approval prompts show a diff, command or draft preview before anything runs. Paths stay inside an
                    allowed workspace root even when a policy is set to Allow.
                  </p>
                </div>
              </>
            )}

            {section === "memory" && (
              <>
                <section>
                  <p className="section-label">Recall</p>
                  <div className="card">
                    <SettingRow
                      title="Local memory"
                      copy="Pinned facts and recent conversation digests are added to the system prompt with citation labels. Nothing leaves this Mac."
                    >
                      <Toggle
                        on={memoryConfig.enabled}
                        label="Local memory"
                        onChange={() => void toggleMemory({ enabled: !memoryConfig.enabled })}
                      />
                    </SettingRow>
                    <SettingRow
                      title="Workspace search"
                      copy="Let the agent search text files in your workspace folders and cite file and line. The index lives in memory only."
                    >
                      <Toggle
                        on={memoryConfig.workspaceSearch}
                        label="Workspace search"
                        disabled={!memoryConfig.enabled}
                        onChange={() => void toggleMemory({ workspaceSearch: !memoryConfig.workspaceSearch })}
                      />
                    </SettingRow>
                  </div>
                  <p className="text-[10.5px] text-muted mt-2 px-1 leading-relaxed">
                    Facts are sealed with AES-256-GCM. Digests are computed from stored messages when the prompt is
                    built. Turning workspace search off clears its index immediately; pinned facts stay until you
                    delete them.
                  </p>
                </section>

                <section>
                  <div className="flex items-center justify-between gap-4 mb-2">
                    <p className="section-label !mb-0">Pinned facts</p>
                    <span className="chip">{facts.length} / 50</span>
                  </div>
                  <div className="card">
                    {facts.length === 0 ? (
                      <div className="p-6 text-center">
                        <Pin size={18} className="mx-auto text-faint" />
                        <p className="text-[11.5px] text-muted mt-2">
                          No pinned facts yet. Add something the agent should remember across chats.
                        </p>
                      </div>
                    ) : (
                      facts.map((fact) => {
                        const created = new Date(fact.createdAt);
                        return (
                          <div key={fact.id} className="row">
                            <div className="min-w-0">
                              <p className="row-title leading-relaxed">{fact.content}</p>
                              <p className="row-copy font-mono">
                                [fact:{fact.id.slice(-6)}] ·{" "}
                                {created.toLocaleDateString([], { month: "short", day: "numeric" })}
                              </p>
                            </div>
                            <button
                              onClick={() => void removeFact(fact.id)}
                              aria-label="Delete fact"
                              className="icon-btn"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        );
                      })
                    )}
                    <div className="p-3 border-t border-line flex flex-wrap gap-2">
                      <input
                        value={factDraft}
                        onChange={(event) => setFactDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void addFact();
                          }
                        }}
                        maxLength={500}
                        disabled={!memoryConfig.enabled}
                        placeholder={memoryConfig.enabled ? "e.g. I write TypeScript and prefer pnpm" : "Turn memory on to save facts"}
                        className="field flex-1 min-w-[220px]"
                      />
                      <button
                        onClick={() => void addFact()}
                        disabled={!memoryConfig.enabled || memoryBusy || !factDraft.trim()}
                        className="btn btn-primary"
                      >
                        <Plus size={11} />
                        Add fact
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3 mt-2 px-1">
                    <p className="text-[10.5px] text-muted leading-relaxed">
                      {memoryConfig.enabled
                        ? "Only what you pin here is guaranteed to be recalled; the 12 most recent facts are injected. Digests are short extracts, not model-written summaries."
                        : "Memory is off, so these facts are not injected. They stay here until you delete them."}
                    </p>
                    {facts.length > 0 && (
                      <button
                        onClick={() => void clearAllFacts()}
                        className={`btn !h-7 !px-2.5 shrink-0 ${confirmClearFacts ? "!text-danger" : ""}`}
                      >
                        <Trash2 size={11} />
                        {confirmClearFacts ? "Confirm" : "Clear all"}
                      </button>
                    )}
                  </div>
                </section>

                <section>
                  <p className="section-label">Recent conversations</p>
                  <div className="card">
                    {digests.length === 0 ? (
                      <div className="p-6 text-center">
                        <MessageSquare size={18} className="mx-auto text-faint" />
                        <p className="text-[11.5px] text-muted mt-2">
                          Chats with at least two messages appear here as short digests. The active chat is excluded.
                        </p>
                      </div>
                    ) : (
                      digests.map((digest) => {
                        const updated = new Date(digest.updatedAt);
                        return (
                          <div key={digest.conversationId} className="row !items-start">
                            <div className="min-w-0">
                              <p className="row-title">{digest.title}</p>
                              <p className="row-copy leading-relaxed">{digest.digest}</p>
                              <p className="text-[10px] text-faint mt-1 font-mono">
                                {`[chat "${digest.title}"] · ${digest.messageCount} messages · ${updated.toLocaleDateString([], { month: "short", day: "numeric" })}`}
                              </p>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                  <p className="text-[10.5px] text-muted mt-2 px-1 leading-relaxed">
                    Digests give the model continuity without sending another request. They combine the first and
                    latest asks with the last answer, and cite the conversation title.
                  </p>
                </section>

                <section>
                  <div className="flex items-center justify-between gap-4 mb-2">
                    <p className="section-label !mb-0">Workspace index</p>
                    <span className={`chip ${workspaceChip.tone}`}>
                      <FolderSearch size={11} />
                      {workspaceChip.label}
                    </span>
                  </div>
                  <div className="card">
                    <SettingRow
                      title="Index status"
                      copy={
                        workspace?.error
                          ? workspace.error
                          : workspace?.builtAt
                            ? `Built ${new Date(workspace.builtAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} from ${workspace.files} files (${(workspace.bytes / 1024 / 1024).toFixed(1)} MB).`
                            : "The index is built on demand and lives in RAM only."
                      }
                    >
                      <button
                        onClick={() => void rebuildWorkspace()}
                        disabled={!memoryConfig.enabled || !memoryConfig.workspaceSearch || memoryBusy}
                        className="btn !h-7 !px-2.5"
                      >
                        <RefreshCw size={11} />
                        Rebuild
                      </button>
                      <button
                        onClick={() => void clearWorkspaceIndex()}
                        disabled={!workspace?.files && !workspace?.chunks}
                        className="btn !h-7 !px-2.5"
                      >
                        <Trash2 size={11} />
                        Clear
                      </button>
                    </SettingRow>
                    <div className="p-3 border-t border-line flex flex-wrap gap-2">
                      <input
                        value={workspaceQuery}
                        onChange={(event) => setWorkspaceQuery(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void searchWorkspace();
                          }
                        }}
                        placeholder="Try a keyword search across workspace files"
                        className="field flex-1 min-w-[220px]"
                        disabled={!memoryConfig.enabled || !memoryConfig.workspaceSearch}
                      />
                      <button
                        onClick={() => void searchWorkspace()}
                        disabled={!memoryConfig.enabled || !memoryConfig.workspaceSearch || memoryBusy || !workspaceQuery.trim()}
                        className="btn"
                      >
                        <Search size={11} />
                        Search
                      </button>
                    </div>
                    {workspaceHits && (
                      <div className="border-t border-line">
                        {workspaceHits.length === 0 ? (
                          <p className="p-4 text-[11px] text-muted">
                            No passages matched. Rebuild the index after adding files.
                          </p>
                        ) : (
                          workspaceHits.map((hit, index) => (
                            <div key={`${hit.path}-${hit.startLine}`} className="p-3 border-b border-line last:border-0">
                              <p className="text-[10px] font-mono text-muted truncate">
                                [{index + 1}] {hit.path}:{hit.startLine}-{hit.endLine}
                              </p>
                              <pre className="mt-1.5 text-[10.5px] text-muted whitespace-pre-wrap break-words max-h-32 overflow-hidden">
                                {hit.excerpt}
                              </pre>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                  <p className="text-[10.5px] text-muted mt-2 px-1 leading-relaxed">
                    Keyword (lexical) search over text files: up to 1,200 files, 3,000 passages and 8 MB. Hidden
                    folders, node_modules, keys and dotfiles are skipped. Semantic embeddings are not part of this
                    build.
                  </p>
                </section>

                <div className="card p-4 flex items-start gap-2.5">
                  <Info size={14} className="text-faint mt-0.5 shrink-0" />
                  <p className="text-[11px] text-muted leading-relaxed">
                    Memory is context, not truth: the model is told to cite what it uses and never to invent a memory.
                    Turn Local memory off to stop all injection; the index clears immediately and pinned facts remain
                    until you delete them.
                  </p>
                </div>
              </>
            )}

            {section === "workspace" && (
              <>
                <section>
                  <p className="section-label">Standard folders</p>
                  <div className="card">
                    {[
                      { label: "Documents", copy: "Read and write inside your Documents folder." },
                      { label: "Downloads", copy: "Read and write inside your Downloads folder." },
                      { label: "Desktop", copy: "Read and write inside your Desktop folder." },
                    ].map((folder) => (
                      <div key={folder.label} className="row">
                        <div>
                          <p className="row-title">{folder.label}</p>
                          <p className="row-copy">{folder.copy}</p>
                        </div>
                        <span className="chip chip-accent">always allowed</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10.5px] text-muted mt-2 px-1 leading-relaxed">
                    These are resolved on every call, including through symlinks. If macOS blocks one of them, the
                    tool reports the error instead of guessing a new path.
                  </p>
                </section>

                <section>
                  <div className="flex items-center justify-between gap-4 mb-2">
                    <p className="section-label !mb-0">Additional folders</p>
                    <button onClick={() => void addWorkspace()} className="btn !h-7 !px-2.5">
                      <FolderPlus size={11} />
                      Add folder…
                    </button>
                  </div>
                  <div className="card">
                    {workspaceRoots.length === 0 ? (
                      <div className="p-6 text-center">
                        <FolderOpen size={18} className="mx-auto text-faint" />
                        <p className="text-[11.5px] text-muted mt-2">
                          No extra folders yet. Add a project folder when you want the file and shell tools to work
                          there.
                        </p>
                      </div>
                    ) : (
                      workspaceRoots.map((root) => (
                        <div key={root} className="row">
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="w-7 h-7 rounded-lg bg-card-2 flex items-center justify-center shrink-0">
                              <FolderOpen size={14} className="text-muted" />
                            </span>
                            <div className="min-w-0">
                              <p className="row-title font-mono text-[11px] truncate">{root}</p>
                              <p className="row-copy">Read, write, shell working directory and Trash.</p>
                            </div>
                          </div>
                          <button
                            onClick={() => removeWorkspace(root)}
                            aria-label={`Remove ${root}`}
                            className="icon-btn"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                  <p className="text-[10.5px] text-muted mt-2 px-1 leading-relaxed">
                    Removing a folder takes effect on the next call. Files already created stay where they are.
                  </p>
                </section>

                <div className="card p-4 flex items-start gap-2.5">
                  <Info size={14} className="text-faint mt-0.5 shrink-0" />
                  <p className="text-[11px] text-muted leading-relaxed">
                    A workspace root expands what the agent can reach; it does not grant approval. Mutating calls still
                    follow the per-tool policy, and the app never adds your entire home folder or filesystem root.
                  </p>
                </div>
              </>
            )}

            {section === "extensions" && (
              <>
                <section>
                  <div className="flex items-center justify-between gap-4 mb-2">
                    <p className="section-label !mb-0">Local servers</p>
                    <button onClick={() => setAdding((value) => !value)} className="btn !h-7 !px-2.5">
                      {adding ? <X size={11} /> : <Plus size={11} />}
                      {adding ? "Cancel" : "Add server"}
                    </button>
                  </div>

                  {adding && (
                    <div className="card p-4 mb-3">
                      <div className="grid grid-cols-2 gap-3">
                        <label className="block">
                          <span className="text-[10px] text-muted">Display name</span>
                          <input
                            value={serverName}
                            onChange={(event) => setServerName(event.target.value)}
                            placeholder="Filesystem tools"
                            className="field w-full mt-1"
                          />
                        </label>
                        <label className="block">
                          <span className="text-[10px] text-muted">Command</span>
                          <input
                            value={serverCommand}
                            onChange={(event) => setServerCommand(event.target.value)}
                            placeholder="npx"
                            className="field w-full mt-1 font-mono !text-[11px]"
                          />
                        </label>
                      </div>
                      <label className="block mt-3">
                        <span className="text-[10px] text-muted">Arguments</span>
                        <input
                          value={serverArgs}
                          onChange={(event) => setServerArgs(event.target.value)}
                          placeholder="-y @modelcontextprotocol/server-filesystem ~/Documents/notes"
                          className="field w-full mt-1 font-mono !text-[11px]"
                        />
                      </label>
                      <label className="block mt-3">
                        <span className="text-[10px] text-muted">Environment, one KEY=value per line</span>
                        <textarea
                          value={serverEnv}
                          onChange={(event) => setServerEnv(event.target.value)}
                          rows={2}
                          placeholder="API_KEY=…"
                          className="field w-full mt-1 font-mono !text-[11px] resize-y"
                        />
                      </label>
                      <div className="flex items-start gap-2 mt-3">
                        <ShieldCheck size={13} className="text-warn mt-0.5 shrink-0" />
                        <p className="text-[10.5px] text-muted leading-relaxed">
                          The command starts as your macOS user. Only add servers you trust; their tools can do
                          anything that command can. Approval policies and the audit log still apply. Environment
                          values are stored in the local config file in plain text, so prefer a wrapper script for
                          secrets.
                        </p>
                      </div>
                      {mcpError && <p className="text-[10.5px] text-danger mt-2">{mcpError}</p>}
                      <div className="flex justify-end mt-3">
                        <button onClick={() => void addServer()} className="btn btn-primary">
                          <Plus size={12} />
                          Add and start
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="card">
                    {servers.length === 0 ? (
                      <div className="p-6 text-center">
                        <Plug size={18} className="mx-auto text-faint" />
                        <p className="text-[11.5px] text-muted mt-2">
                          No MCP servers yet. Add a local stdio server to give the agent extra tools.
                        </p>
                      </div>
                    ) : (
                      servers.map((server) => {
                        const live = mcp.find((item) => item.id === server.id);
                        const state = live ? MCP_STATE[live.state] : MCP_STATE.stopped;
                        const toggleExpanded = () => setExpandedServer(expandedServer === server.id ? null : server.id);
                        const busy = mcpBusy === server.id;
                        return (
                          <div key={server.id}>
                            <div className="row">
                              <div className="flex items-center gap-3 min-w-0">
                                <span className="w-7 h-7 rounded-lg bg-card-2 flex items-center justify-center shrink-0">
                                  <Plug size={14} className="text-muted" />
                                </span>
                                <div className="min-w-0">
                                  <p className="row-title truncate">{server.name}</p>
                                  <p className="row-copy font-mono text-[10.5px] truncate">
                                    {server.command} {server.args.join(" ")}
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className={`chip ${state.tone}`}>{state.label}</span>
                                {live && live.toolCount > 0 && <span className="chip">{live.toolCount} tools</span>}
                                <div className="segmented">
                                  {POLICY_OPTIONS.map((option) => (
                                    <button
                                      key={option.value}
                                      onClick={() => void patchServer(server.id, { approval: option.value })}
                                      className={`${server.approval === option.value ? "segmented-active" : ""} ${
                                        option.value === "block" && server.approval === "block" ? "!text-danger" : ""
                                      }`}
                                    >
                                      {option.label}
                                    </button>
                                  ))}
                                </div>
                                <Toggle
                                  on={server.enabled}
                                  label={`Enable ${server.name}`}
                                  onChange={() => void patchServer(server.id, { enabled: !server.enabled })}
                                />
                                <button
                                  onClick={() => void restartServer(server.id)}
                                  disabled={busy || !server.enabled}
                                  aria-label={`Restart ${server.name}`}
                                  className="icon-btn"
                                >
                                  <RotateCw size={12} className={busy ? "animate-spin" : ""} />
                                </button>
                                <button
                                  onClick={() => (removingId === server.id ? void removeServer(server.id) : setRemovingId(server.id))}
                                  aria-label={`Remove ${server.name}`}
                                  className={`icon-btn ${removingId === server.id ? "!text-danger" : ""}`}
                                >
                                  <Trash2 size={12} />
                                </button>
                                <button onClick={toggleExpanded} aria-label={`Show tools for ${server.name}`} className="icon-btn">
                                  <ChevronDown
                                    size={13}
                                    className={`transition-transform ${expandedServer === server.id ? "rotate-180" : ""}`}
                                  />
                                </button>
                              </div>
                            </div>
                            {removingId === server.id && (
                              <p className="text-[10.5px] text-danger px-4 pb-3 -mt-1">
                                Click the trash icon again to remove this server. Its tools disappear immediately.
                              </p>
                            )}
                            {live?.error && (
                              <p className="text-[10.5px] text-danger px-4 pb-3 -mt-1 leading-relaxed">{live.error}</p>
                            )}
                            {expandedServer === server.id && (
                              <div className="px-4 pb-4 -mt-1">
                                {live && live.tools.length > 0 ? (
                                  <div className="space-y-1">
                                    {live.tools.map((tool) => (
                                      <div
                                        key={tool.name}
                                        className="flex items-start justify-between gap-3 bg-card-2 border border-line rounded-lg px-3 py-2"
                                      >
                                        <div className="min-w-0">
                                          <p className="text-[11px] font-mono truncate">{tool.name}</p>
                                          {tool.description && (
                                            <p className="text-[10px] text-muted leading-relaxed mt-0.5 line-clamp-2">
                                              {tool.description}
                                            </p>
                                          )}
                                        </div>
                                        <span className={`chip shrink-0 ${tool.readOnly ? "chip-accent" : ""}`}>
                                          {tool.readOnly ? "read-only" : "mutating"}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-[10.5px] text-muted">
                                    No tools discovered. Restart the server or check its command and arguments.
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                  <p className="text-[10.5px] text-muted mt-2 px-1 leading-relaxed">
                    Servers start with the app and reconnect when the config changes. Tools listed as read-only skip
                    prompts; everything else follows the Ask / Allow / Block choice beside it.
                  </p>
                </section>

                <div className="card p-4 flex items-start gap-2.5">
                  <Info size={14} className="text-faint mt-0.5 shrink-0" />
                  <p className="text-[11px] text-muted leading-relaxed">
                    OpenMonkey speaks MCP over local stdio only. There is no HTTP transport and no server is downloaded
                    automatically; the command you enter is the command that runs.
                  </p>
                </div>
              </>
            )}

            {section === "permissions" && (
              <>
                <section>
                  <p className="section-label">Automation</p>
                  <div className="card">
                    <div className="row">
                      <div className="flex items-center gap-3">
                        <span className="w-7 h-7 rounded-lg bg-card-2 flex items-center justify-center">
                          <CalendarClock size={14} className="text-muted" />
                        </span>
                        <div>
                          <p className="row-title">Calendar</p>
                          <p className="row-copy">Only when you ask it to read events or create one. Checking may open Calendar once.</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`chip ${probeChip("calendar").tone}`}>{probeChip("calendar").label}</span>
                        <button
                          onClick={() => void checkAutomation("calendar")}
                          disabled={probes.calendar === "checking"}
                          className="btn"
                        >
                          Check
                        </button>
                      </div>
                    </div>

                    <div className="row">
                      <div className="flex items-center gap-3">
                        <span className="w-7 h-7 rounded-lg bg-card-2 flex items-center justify-center">
                          <Mail size={14} className="text-muted" />
                        </span>
                        <div>
                          <p className="row-title">Mail</p>
                          <p className="row-copy">Only when you ask it to draft a message. It never sends without approval.</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`chip ${probeChip("mail").tone}`}>{probeChip("mail").label}</span>
                        <button
                          onClick={() => void checkAutomation("mail")}
                          disabled={probes.mail === "checking"}
                          className="btn"
                        >
                          Check
                        </button>
                      </div>
                    </div>
                  </div>

                  {(["calendar", "mail"] as const).map((area) => {
                    const probe = probes[area];
                    if (!probe || probe === "checking" || !probe.message) return null;
                    return (
                      <p
                        key={area}
                        className={`text-[10.5px] mt-2 px-1 leading-relaxed ${
                          probe.state === "denied" ? "text-danger" : "text-muted"
                        }`}
                      >
                        {probe.message}
                      </p>
                    );
                  })}
                </section>

                <section>
                  <p className="section-label">Notifications</p>
                  <div className="card">
                    <SettingRow
                      title="Approval and completion alerts"
                      copy="macOS owns this permission, so there is no in-app switch. Open the system pane to change it."
                    >
                      <span className="chip">
                        <Bell size={11} />
                        managed by macOS
                      </span>
                      <button
                        onClick={() => void window.electron?.openPermissionSettings("notifications")}
                        className="btn"
                      >
                        <ExternalLink size={12} />
                        Open settings
                      </button>
                    </SettingRow>
                  </div>
                </section>

                <div className="card p-4 flex items-start gap-2.5">
                  <Info size={14} className="text-faint mt-0.5 shrink-0" />
                  <div>
                    <p className="text-[11px] text-muted leading-relaxed">
                      Automation requests appear the first time OpenMonkey touches Calendar or Mail, never at launch.
                      If you denied one, re-enable it under Privacy &amp; Security → Automation.
                    </p>
                    <button
                      onClick={() => void window.electron?.openPermissionSettings("automation")}
                      className="link text-[10.5px] mt-2 inline-flex items-center gap-1"
                    >
                      Open Automation settings
                      <ExternalLink size={10} />
                    </button>
                  </div>
                </div>
              </>
            )}

            {section === "privacy" && (
              <>
                <section>
                  <p className="section-label">History</p>
                  <div className="card">
                    <SettingRow
                      title="Save conversation history"
                      copy="When off, messages stay in memory for the current run only."
                    >
                      <Toggle
                        on={privacy.saveHistory}
                        label="Save conversation history"
                        onChange={() => void onPatch({ privacy: { ...privacy, saveHistory: !privacy.saveHistory } })}
                      />
                    </SettingRow>
                    <SettingRow title="Encrypt stored data" copy={keyCopy}>
                      <Toggle
                        on={privacy.encryptData}
                        label="Encrypt stored data"
                        disabled={passphraseOn}
                        onChange={() => void onPatch({ privacy: { ...privacy, encryptData: !privacy.encryptData } })}
                      />
                    </SettingRow>
                    <SettingRow
                      title="Auto-delete after"
                      copy="Older messages, tasks and audit rows are pruned on launch and every six hours while the app runs."
                    >
                      <Segmented
                        value={String(privacy.autoDeleteAfter)}
                        onChange={(value) =>
                          void onPatch({ privacy: { ...privacy, autoDeleteAfter: Number(value) } })
                        }
                        options={[7, 30, 90, 365].map((days) => ({ value: String(days), label: `${days}d` }))}
                      />
                    </SettingRow>
                  </div>
                </section>

                <section>
                  <p className="section-label">Locking</p>
                  <div className="card">
                    <SettingRow
                      title={t("privacy.passphrase")}
                      copy={
                        passphraseOn
                          ? t("privacy.passphraseOn")
                          : t("privacy.passphraseOff", {
                              where: keySource === "file" ? t("privacy.keyFile") : t("privacy.vault"),
                            })
                      }
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="password"
                          value={passDraft}
                          onChange={(event) => setPassDraft(event.target.value)}
                          placeholder={passphraseOn ? t("privacy.currentPassphrase") : t("privacy.newPassphrase")}
                          aria-label={passphraseOn ? t("privacy.currentPassphrase") : t("privacy.newPassphrase")}
                          autoComplete="off"
                          spellCheck={false}
                          maxLength={256}
                          className="field w-[168px]"
                        />
                        {passphraseOn ? (
                          <>
                            <button
                              onClick={() => void removePassphrase()}
                              disabled={passDraft.length < 6}
                              className="btn"
                            >
                              {t("privacy.removePassphrase")}
                            </button>
                            <button
                              onClick={() => void window.electron?.lockHistoryNow()}
                              className="btn btn-primary"
                            >
                              <Lock size={11} />
                              {t("privacy.lockNow")}
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => void applyPassphrase()}
                            disabled={!privacy.encryptData || passDraft.length < 6}
                            className="btn btn-primary"
                          >
                            {t("privacy.applyPassphrase")}
                          </button>
                        )}
                      </div>
                    </SettingRow>
                    <SettingRow title={t("privacy.autoLock")} copy={t("privacy.autoLockCopy")}>
                      <Segmented
                        value={String(autoLockMinutes)}
                        onChange={(value) =>
                          void onPatch({ privacy: { ...privacy, autoLockMinutes: Number(value) } })
                        }
                        options={[0, 1, 5, 15, 60].map((minutes) => ({
                          value: String(minutes),
                          label: minutes ? t("privacy.autoLockMinutes", { count: minutes }) : t("privacy.autoLockOff"),
                          // The watcher is inert without a passphrase, so the choices say so.
                          disabled: minutes > 0 && !passphraseOn,
                        }))}
                      />
                    </SettingRow>
                    <SettingRow title={t("privacy.erase")} copy={t("privacy.eraseCopy")}>
                      <div className="flex items-center gap-2">
                        <input
                          value={eraseDraft}
                          onChange={(event) => setEraseDraft(event.target.value)}
                          placeholder={t("privacy.eraseConfirm")}
                          aria-label={t("privacy.eraseConfirm")}
                          className="field w-[110px] font-mono"
                          maxLength={8}
                        />
                        <button
                          onClick={() => void eraseEverything()}
                          disabled={eraseDraft !== "ERASE"}
                          className="btn text-danger"
                        >
                          <Trash2 size={11} />
                          {t("privacy.eraseButton")}
                        </button>
                      </div>
                    </SettingRow>
                  </div>
                  {passNotice && (
                    <p role="status" className="text-[10.5px] text-muted mt-2 px-1 leading-relaxed">
                      {passNotice}
                    </p>
                  )}
                  {eraseNotice && (
                    <p role="status" className="text-[10.5px] text-danger mt-2 px-1 leading-relaxed">
                      {eraseNotice}
                    </p>
                  )}
                </section>

                <section>
                  <p className="section-label">Portability</p>
                  <div className="card">
                    <SettingRow
                      title={t("privacy.backup")}
                      copy={t("privacy.backupCopy")}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="password"
                          value={backupDraft}
                          onChange={(event) => setBackupDraft(event.target.value)}
                          placeholder={t("privacy.backupPassphrase")}
                          aria-label={t("privacy.backupPassphrase")}
                          autoComplete="new-password"
                          spellCheck={false}
                          maxLength={256}
                          className="field w-[168px]"
                        />
                        <button
                          onClick={() => void runBackup("export")}
                          disabled={backupBusy || backupDraft.length < 8}
                          className="btn btn-primary"
                        >
                          <Download size={11} />
                          {t("privacy.exportButton")}
                        </button>
                        <button
                          onClick={() => void runBackup("import")}
                          disabled={backupBusy || backupDraft.length < 8}
                          className="btn"
                        >
                          <Upload size={11} />
                          {t("privacy.importButton")}
                        </button>
                      </div>
                    </SettingRow>
                    <SettingRow
                      title={t("privacy.restoreSettings")}
                      copy={t("privacy.restoreSettingsCopy")}
                    >
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={restoreSettings}
                          onChange={(event) => setRestoreSettings(event.target.checked)}
                          aria-label={t("privacy.restoreSettings")}
                          className="accent-accent"
                        />
                        <span className="chip">{restoreSettings ? "on" : "off"}</span>
                      </label>
                    </SettingRow>
                    <SettingRow
                      title="Backup format"
                      copy={
                        schemaVersion
                          ? t("privacy.backupFormat", { version: schemaVersion })
                          : t("privacy.backupLayoutUnknown")
                      }
                    >
                      <span className="chip">v1</span>
                    </SettingRow>
                  </div>
                  {backupDraft.length > 0 && backupDraft.length < 8 && (
                    <p role="status" className="text-[10.5px] text-muted mt-2 px-1 leading-relaxed">
                      {t("privacy.backupShort")}
                    </p>
                  )}
                  {backupNotice && (
                    <p role="status" className="text-[10.5px] text-muted mt-2 px-1 leading-relaxed">
                      {backupNotice}
                    </p>
                  )}
                </section>

                <section>
                  <p className="section-label">Storage</p>
                  <div className="card">
                    <SettingRow
                      title="Database"
                      copy="data/openmonkey.db inside this app's support folder. Tasks share the same file."
                    >
                      <span className="chip">{privacy.encryptData ? "sealed" : "plain text"}</span>
                    </SettingRow>
                    <SettingRow title="Logs" copy="logs/openmonkey.log in the same folder, rotated by the app.">
                      <span className="chip">local</span>
                    </SettingRow>
                    <SettingRow
                      title="History key"
                      copy={
                        keySource === "locked"
                          ? "The database is closed and the key is not in memory. Unlock it to read anything."
                          : keySource === "passphrase"
                            ? "Held in memory for this session only, unwrapped from the passphrase file."
                            : keySource === "keychain"
                              ? "Unwrapped by macOS when the app starts. Deleting it makes stored history unreadable on purpose."
                              : keySource === "file"
                                ? "secret.key in this app's support folder, readable only by your user."
                                : "Not loaded while encryption is off."
                      }
                    >
                      <span className={`chip ${keySource === "keychain" || keySource === "passphrase" ? "chip-accent" : ""}`}>
                        {keySource === "keychain"
                          ? "keychain"
                          : keySource === "file"
                            ? "0600 file"
                            : keySource === "passphrase"
                              ? t("privacy.keyPassphrase")
                              : keySource === "locked"
                                ? t("privacy.keyLocked")
                                : "off"}
                      </span>
                    </SettingRow>
                  </div>
                </section>

                <section>
                  <p className="section-label">Diagnostics</p>
                  <div className="card">
                    <SettingRow title={t("diagnostics.logs")} copy={t("diagnostics.logsCopy")}>
                      <div className="flex items-center gap-2">
                        <button onClick={() => void showLog()} className="btn">
                          {t("diagnostics.view")}
                        </button>
                        <button onClick={() => void wipeLog()} className="btn">
                          {t("diagnostics.clear")}
                        </button>
                      </div>
                    </SettingRow>
                    {logText !== null && (
                      <div className="px-4 pb-3">
                        <pre
                          aria-label={t("diagnostics.logs")}
                          className="max-h-[220px] overflow-auto rounded-lg border border-line bg-card-2 p-3 text-[10px] text-muted whitespace-pre-wrap break-words font-mono"
                        >
                          {logText || t("diagnostics.empty")}
                        </pre>
                      </div>
                    )}
                    <SettingRow
                      title={t("diagnostics.network")}
                      copy={networkAllowed ? t("diagnostics.networkCopy") : t("diagnostics.networkOffCopy")}
                    >
                      <div className="flex items-center gap-2">
                        <span className={`chip ${online ? "" : "chip-accent"}`}>
                          {online ? t("diagnostics.online") : t("diagnostics.offline")}
                        </span>
                        <Toggle
                          on={networkAllowed}
                          label={t("diagnostics.network")}
                          onChange={() =>
                            void onPatch({ privacy: { ...privacy, networkAllowed: !networkAllowed } })
                          }
                        />
                      </div>
                    </SettingRow>
                  </div>
                  {logNotice && (
                    <p role="status" className="text-[10.5px] text-muted mt-2 px-1 leading-relaxed">
                      {logNotice}
                    </p>
                  )}
                </section>
              </>
            )}

            {section === "model" && (
              <>
                <section>
                  <p className="section-label">Model library</p>
                  <ModelDownloadCard
                    installed={models?.bonsaiAvailable ?? false}
                    ready={ready}
                    onChanged={refreshModels}
                  />
                </section>

                <section>
                  <p className="section-label">Status</p>
                  <div className="card p-4 flex items-center gap-3.5">
                    <span className="w-9 h-9 rounded-full bg-accent-soft flex items-center justify-center shrink-0">
                      {ready ? (
                        <Cpu size={16} className="text-accent-ink" />
                      ) : (
                        <Loader size={16} className="text-accent-ink animate-spin" />
                      )}
                    </span>
                    <div className="min-w-0">
                      <p className="row-title">
                        {status.provider === "mlx" ? "MLX server" : "Bonsai-4B GGUF"}
                      </p>
                      <p className="row-copy">{statusCopy}</p>
                    </div>
                    <span className="chip ml-auto shrink-0">
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          ready ? "bg-accent" : status.state === "error" ? "bg-danger" : "bg-warn pulse-dot"
                        }`}
                      />
                      {ready ? "connected" : status.state.replace("-", " ")}
                    </span>
                  </div>
                </section>

                <section>
                  <p className="section-label">Backend</p>
                  <div className="card">
                    <SettingRow
                      title="Runtime"
                      copy="Switching unloads the current weights and loads the other backend."
                    >
                      <Segmented
                        value={status.provider ?? model.provider}
                        onChange={(value) => void switchProvider(value as "mlx" | "bonsai")}
                        options={[
                          {
                            value: "bonsai",
                            label: "Bonsai 4B",
                            disabled: !models?.bonsaiAvailable || busy,
                          },
                          { value: "mlx", label: "MLX", disabled: !models?.mlxAvailable || busy },
                        ]}
                      />
                    </SettingRow>
                    <SettingRow
                      title="MLX"
                      copy="Optional Apple Silicon backend. Needs the MLX snapshot and mlx-lm."
                    >
                      <span className={`chip ${models?.mlxAvailable ? "chip-accent" : ""}`}>
                        {models?.mlxAvailable ? "ready" : "not installed"}
                      </span>
                    </SettingRow>
                  </div>
                </section>

                <section>
                  <p className="section-label">Generation</p>
                  <div className="card">
                    <SettingRow
                      title="Temperature"
                      copy="Lower answers more predictably. Applied to the next reply."
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="range"
                          min={0}
                          max={1.5}
                          step={0.05}
                          value={model.temperature}
                          onChange={(event) =>
                            void onPatch({
                              model: { ...model, temperature: Number(event.target.value) },
                            })
                          }
                          className="w-[170px]"
                        />
                        <span className="chip !w-12 !justify-center">{model.temperature.toFixed(2)}</span>
                      </div>
                    </SettingRow>
                    <SettingRow title="Max tokens" copy="Hard cap for a single reply.">
                      <input
                        type="number"
                        min={128}
                        max={8192}
                        step={128}
                        value={model.maxTokens}
                        onChange={(event) =>
                          void onPatch({
                            model: {
                              ...model,
                              maxTokens: Math.max(128, Number(event.target.value) || 128),
                            },
                          })
                        }
                        className="field w-[110px]"
                      />
                    </SettingRow>
                  </div>
                </section>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};
