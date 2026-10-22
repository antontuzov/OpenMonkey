import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Bell,
  CalendarClock,
  Check,
  ChevronDown,
  Cpu,
  ExternalLink,
  Files,
  Fingerprint,
  Globe,
  Info,
  Loader,
  Lock,
  LockOpen,
  Mail,
  MessageSquare,
  Palette,
  RefreshCw,
  Search,
  ShieldCheck,
  SquareTerminal,
  UserRound,
} from "lucide-react";
import { ModelDownloadCard } from "./ModelDownloadCard";
import { ACCENTS } from "../constants";
import {
  MOODS,
  MOOD_LOGOS,
  type AgentStatus,
  type AutomationProbe,
  type Config,
  type ConfigPatch,
  type ModelStatus,
  type Mood,
} from "../../utils/types";

interface SettingsViewProps {
  status: AgentStatus;
  mood: Mood;
  config: Config;
  onPatch: (patch: ConfigPatch) => Promise<void>;
  onClose: () => void;
  onRefreshStatus: () => Promise<void>;
}

type Section = "profile" | "appearance" | "approvals" | "permissions" | "privacy" | "model";


const TOOLS = [
  { icon: Files, name: "Files", copy: "Read, write and move files inside your allowed folders." },
  { icon: Globe, name: "Web", copy: "Fetch a page or open a link you asked about." },
  { icon: SquareTerminal, name: "Shell", copy: "Run a command on this Mac and read its output." },
  { icon: CalendarClock, name: "Calendar & mail", copy: "Draft events or emails for you to review." },
];

const NAV: Array<{
  label: string | null;
  items: Array<{ id: Section; label: string; icon: typeof UserRound }>;
}> = [
  {
    label: "Personal",
    items: [
      { id: "profile", label: "Profile", icon: UserRound },
      { id: "appearance", label: "Appearance", icon: Palette },
    ],
  },
  {
    label: "Control",
    items: [
      { id: "approvals", label: "Approvals", icon: ShieldCheck },
      { id: "permissions", label: "Permissions", icon: Fingerprint },
      { id: "privacy", label: "Privacy", icon: Lock },
    ],
  },
  {
    label: "Model",
    items: [{ id: "model", label: "Model", icon: Cpu }],
  },
];

const TITLES: Record<Section, { title: string; lede: string }> = {
  profile: {
    title: "Profile",
    lede: "Who this assistant is on this Mac. These values shape its system prompt, not the model weights.",
  },
  appearance: {
    title: "Appearance",
    lede: "Surface, accent and character. Everything here is stored locally and applied instantly.",
  },
  approvals: {
    title: "Approvals",
    lede: "Decide what runs on its own. With approvals on, every tool call shows its arguments before it executes.",
  },
  permissions: {
    title: "Permissions",
    lede: "macOS controls access to Calendar, Mail and notifications. Nothing is requested until you ask for it.",
  },
  privacy: {
    title: "Privacy",
    lede: "Chat history and tasks live in a local SQLite file. These controls decide how long it stays readable.",
  },
  model: {
    title: "Model",
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

const Toggle: React.FC<{ on: boolean; label: string; onChange: () => void }> = ({ on, label, onChange }) => (
  <button
    role="switch"
    aria-checked={on}
    aria-label={label}
    onClick={onChange}
    className={`toggle ${on ? "toggle-on" : ""}`}
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

  const { model, agent, privacy } = config;
  const accent = config.ui.accent ?? ACCENTS[0].value;
  const accentName = ACCENTS.find((item) => item.value === accent)?.name ?? "Custom";
  const logo = MOOD_LOGOS[mood] ?? MOOD_LOGOS.neutral;
  const ready = status.state === "ready";
  const providerLabel = status.provider === "mlx" ? "MLX" : "Bonsai 4B";

  useEffect(() => {
    void window.electron?.getModelStatus().then(setModels).catch(() => undefined);
  }, []);

  const refreshModels = async () => {
    const next = await window.electron?.getModelStatus();
    if (next) setModels(next);
    await onRefreshStatus();
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
      items: group.items.filter((item) => !needle || item.label.toLowerCase().includes(needle)),
    })).filter((group) => group.items.length > 0);
  }, [query]);

  const patchUi = (changes: Partial<Config["ui"]>) => void onPatch({ ui: { ...config.ui, ...changes } });

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

  const head = TITLES[section];

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
            Back to app
            <span className="kbd ml-auto">ESC</span>
          </button>

          <h1 className="text-[21px] font-semibold tracking-tight px-2 mt-4">Settings</h1>

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
              placeholder="Search settings…"
              className="field w-full !h-8 !pl-8 !text-[11.5px]"
            />
          </div>
        </div>

        <nav className="px-2 mt-3 overflow-y-auto no-drag">
          <button onClick={onClose} className="nav-item">
            <MessageSquare size={15} />
            Ask OpenMonkey
          </button>

          {groups.map((group) => (
            <div key={group.label ?? "main"} className="mt-4">
              {group.label && <p className="section-label px-2">{group.label}</p>}
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
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {groups.length === 0 && (
            <p className="text-[11px] text-faint px-3 py-5 leading-relaxed">
              No settings match “{query}”.
            </p>
          )}
        </nav>

        <div className="mt-auto px-4 py-3 flex items-center justify-between text-[10px] text-faint">
          <span className="flex items-center gap-1.5">
            <Lock size={10} />
            Local only
          </span>
          <span>OpenMonkey</span>
        </div>
      </aside>

      <main className="relative flex-1 min-w-0 overflow-y-auto">
        <div className="deco-lines" />
        <div className="relative max-w-[780px] px-10 py-10">
          <div className="flex items-start justify-between gap-6 mb-8">
            <div>
              <h1 className="page-title">{head.title}</h1>
              <p className="lede">{head.lede}</p>
            </div>
            {section === "model" && (
              <button onClick={() => void checkAgain()} disabled={busy} className="btn shrink-0 mt-1">
                <RefreshCw size={13} className={busy ? "animate-spin" : ""} />
                Check again
              </button>
            )}
          </div>

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
                          <p className="row-title">Avatar</p>
                          <p className="row-copy">One of 12 expressions. It follows the conversation and the mood picker.</p>
                        </div>
                      </div>
                      <span className="chip chip-accent">
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--color-accent)" }} />
                        {logo.label}
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
                        {agent.autoExecuteTasks ? "Runs freely" : "Asks first"}
                      </span>
                    </SettingRow>
                    <SettingRow title="Stored history" copy="A local SQLite file, sealed with AES-256-GCM by default.">
                      <span className="chip">{privacy.saveHistory ? "saved" : "memory only"}</span>
                    </SettingRow>
                  </div>
                </section>
              </>
            )}

            {section === "appearance" && (
              <>
                <section>
                  <p className="section-label">Color mode</p>
                  <div className="card">
                    <SettingRow title="Interface theme" copy="System follows macOS appearance. The choice is saved for this Mac.">
                      <Segmented
                        value={config.ui.theme}
                        onChange={(value) => patchUi({ theme: value as Config["ui"]["theme"] })}
                        options={[
                          { value: "system", label: "System" },
                          { value: "light", label: "Light" },
                          { value: "dark", label: "Dark" },
                        ]}
                      />
                    </SettingRow>
                  </div>
                </section>

                <section>
                  <p className="section-label">Accent color</p>
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
                    <p className="text-[11px] text-muted mt-4">
                      Using <span className="text-ink font-semibold">{accentName}</span> · saved to this Mac.
                    </p>
                  </div>
                </section>

                <section>
                  <p className="section-label">Typography</p>
                  <div className="card p-5">
                    <p className="text-faint text-[10px] tracking-[0.08em] uppercase">OpenMonkey · A little clarity goes a long way</p>
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
                  <p className="section-label">Mood</p>
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
                            {MOOD_LOGOS[name].label}
                          </span>
                        </button>
                      ))}
                    </div>
                    <p className="text-[11px] text-muted mt-3.5">
                      Current: <span className="text-ink font-semibold">{logo.label}</span>. The same artwork drives the
                      Dock tile and the menu bar icon.
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
                      copy="Off by default. When off, file writes, shell commands, web fetches and mail drafts each wait for Allow once."
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
                        {agent.autoExecuteTasks ? "Runs freely" : "Every action asks first"}
                      </span>
                    </SettingRow>
                  </div>
                </section>

                <section>
                  <p className="section-label">What can run</p>
                  <div className="card">
                    {TOOLS.map((tool) => {
                      const Icon = tool.icon;
                      return (
                        <div key={tool.name} className="row">
                          <div className="flex items-center gap-3">
                            <span className="w-7 h-7 rounded-lg bg-card-2 flex items-center justify-center">
                              <Icon size={14} className="text-muted" />
                            </span>
                            <div>
                              <p className="row-title">{tool.name}</p>
                              <p className="row-copy">{tool.copy}</p>
                            </div>
                          </div>
                          <span className={`chip ${agent.autoExecuteTasks ? "" : "chip-accent"}`}>
                            {agent.autoExecuteTasks ? "Runs freely" : "Asks first"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </section>

                <div className="card p-4 flex items-start gap-2.5">
                  <Info size={14} className="text-faint mt-0.5 shrink-0" />
                  <p className="text-[11px] text-muted leading-relaxed">
                    Approval prompts show the exact tool and arguments before anything runs, and the filesystem tool
                    stays inside Documents, Downloads, Desktop and this app&apos;s data folder either way.
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
                    <SettingRow
                      title="Encrypt stored data"
                      copy="AES-256-GCM with a 0600 key file in this app's support folder."
                    >
                      <Toggle
                        on={privacy.encryptData}
                        label="Encrypt stored data"
                        onChange={() => void onPatch({ privacy: { ...privacy, encryptData: !privacy.encryptData } })}
                      />
                    </SettingRow>
                    <SettingRow title="Auto-delete after" copy="Older messages and tasks are pruned on launch.">
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
                  </div>
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
