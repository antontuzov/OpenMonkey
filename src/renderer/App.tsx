import { useCallback, useEffect, useState } from "react";
import { FolderOpen, PanelRight, Settings2, ShieldAlert } from "lucide-react";
import { ChatInterface } from "./components/ChatInterface";
import { TaskMonitor } from "./components/TaskMonitor";
import { AppSidebar } from "./components/AppSidebar";
import { SettingsView } from "./components/SettingsView";
import {
  MOOD_LOGOS,
  type AgentStatus,
  type ApprovalRequest,
  type Config,
  type ConfigPatch,
  type Mood,
} from "../utils/types";

type View = "chat" | "settings";

export default function App() {
  const [status, setStatus] = useState<AgentStatus>({ state: "starting" });
  const [mood, setMood] = useState<Mood>("neutral");
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  const [view, setView] = useState<View>("chat");
  const [config, setConfig] = useState<Config | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [chatReset, setChatReset] = useState(0);

  useEffect(() => {
    const api = window.electron;
    if (!api) return;

    const unsubscribes = [
      api.onAgentStatus(setStatus),
      api.onAgentReady(() => void api.getAgentStatus().then(setStatus)),
      api.onMoodChange((next) => setMood(next as Mood)),
      api.onApprovalRequest(setApproval),
      api.onOpenSettings(() => setView("settings")),
    ];

    void api.getCurrentMood().then(setMood).catch(() => undefined);
    void api.getAgentStatus().then(setStatus).catch(() => undefined);
    void api.getConfig().then(setConfig).catch(() => undefined);

    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, []);

  const theme = config?.ui.theme ?? "system";
  const accent = config?.ui.accent ?? "#3ecf8e";

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--color-accent", accent);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      root.dataset.theme = theme === "system" ? (media.matches ? "dark" : "light") : theme;
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [accent, theme]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setView("chat");
      if (event.key === "," && event.metaKey) {
        event.preventDefault();
        setView("settings");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const respond = useCallback(
    async (approved: boolean) => {
      if (!approval) return;
      await window.electron?.approveTask(approval.requestId, approved);
      setApproval(null);
    },
    [approval]
  );

  const patchConfig = useCallback(async (patch: ConfigPatch) => {
    const next = await window.electron?.setConfig(patch);
    if (next) setConfig(next);
  }, []);

  const refreshStatus = useCallback(async () => {
    const next = await window.electron?.getAgentStatus();
    if (next) setStatus(next);
  }, []);

  const cycleMood = useCallback(() => {
    void window.electron
      ?.cycleMood()
      .then((next) => {
        if (next) setMood(next);
      })
      .catch(() => undefined);
  }, []);

  const agentName = config?.agent.name ?? "OpenMonkey";
  const logo = MOOD_LOGOS[mood] ?? MOOD_LOGOS.neutral;

  if (view === "settings") {
    return config ? (
      <SettingsView
        status={status}
        mood={mood}
        config={config}
        onPatch={patchConfig}
        onClose={() => setView("chat")}
        onRefreshStatus={refreshStatus}
      />
    ) : (
      <div className="h-screen bg-paper flex items-center justify-center">
        <p className="text-faint text-xs">Loading settings…</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-paper">
      <AppSidebar
        mood={mood}
        status={status}
        agentName={agentName}
        panelOpen={panelOpen}
        onTogglePanel={() => setPanelOpen((open) => !open)}
        onSettings={() => setView("settings")}
        onNewChat={() => setChatReset((count) => count + 1)}
      />

      <main className="flex-1 flex flex-col min-w-0">
        <header className="drag-region h-12 shrink-0 flex items-center justify-between gap-4 px-5 border-b border-line">
          <div className="flex items-center gap-2 text-[11.5px] min-w-0">
            <FolderOpen size={14} className="text-faint shrink-0" />
            <span className="text-faint">workspace</span>
            <span className="text-faint">/</span>
            <span className="flex items-center gap-1.5 text-ink truncate">
              <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
              Main Session
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={cycleMood} className="chip no-drag hover:border-ink/25" title="Cycle mood">
              <img src={`/logos/${logo.file}`} alt="" className="w-4 h-4 rounded-full" />
              {logo.label}
            </button>
            <button
              onClick={() => setPanelOpen((open) => !open)}
              className={`icon-btn ${panelOpen ? "bg-card-2 text-ink" : ""}`}
              title={panelOpen ? "Hide activity" : "Show activity"}
            >
              <PanelRight size={16} />
            </button>
            <button onClick={() => setView("settings")} className="icon-btn" title="Settings">
              <Settings2 size={16} />
            </button>
          </div>
        </header>

        <ChatInterface
          status={status}
          mood={mood}
          agentName={agentName}
          autoExecute={config?.agent.autoExecuteTasks ?? false}
          resetKey={chatReset}
        />
      </main>

      {panelOpen && (
        <aside className="w-[300px] shrink-0 border-l border-line bg-card-2 overflow-y-auto">
          <TaskMonitor autoExecute={config?.agent.autoExecuteTasks ?? false} />
        </aside>
      )}

      {approval && (
        <div className="fixed inset-0 bg-ink/25 backdrop-blur-[2px] flex items-center justify-center p-6 z-50">
          <div className="card max-w-lg w-full p-6" style={{ boxShadow: "var(--shadow-pop)" }}>
            <div className="flex items-start gap-3 mb-4">
              <span
                className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                style={{ background: "color-mix(in srgb, var(--color-warn) 16%, transparent)" }}
              >
                <ShieldAlert size={16} className="text-warn" />
              </span>
              <div>
                <p className="section-label !mb-1">Action needs approval</p>
                <h2 className="text-[15px] font-semibold leading-snug">{approval.request.summary}</h2>
              </div>
            </div>
            <p className="text-muted text-[11.5px] leading-relaxed mb-3">
              {agentName} wants to run{" "}
              <span className="text-ink">
                {approval.request.type}.{approval.request.action}
              </span>
              . Nothing on this Mac changes until you allow it.
            </p>
            <pre className="bg-card-2 border border-line rounded-xl p-3 text-[11px] text-muted overflow-x-auto max-h-48">
              {JSON.stringify(approval.request.arguments, null, 2)}
            </pre>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => void respond(false)} className="btn">
                Deny
              </button>
              <button onClick={() => void respond(true)} className="btn btn-primary">
                Allow once
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
