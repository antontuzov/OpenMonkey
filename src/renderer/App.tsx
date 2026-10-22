import { useCallback, useEffect, useState } from "react";
import { FolderOpen, Loader, PanelRight, Settings2, ShieldAlert } from "lucide-react";
import { ChatInterface } from "./components/ChatInterface";
import { TaskMonitor } from "./components/TaskMonitor";
import { AppSidebar } from "./components/AppSidebar";
import { SettingsView } from "./components/SettingsView";
import { Onboarding } from "./components/Onboarding";
import {
  MOOD_LOGOS,
  type AgentStatus,
  type ApprovalRequest,
  type Config,
  type ConfigPatch,
  type Conversation,
  type ConversationSearchHit,
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
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [busyConversationId, setBusyConversationId] = useState<string | null>(null);

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

  const refreshConversations = useCallback(async () => {
    const api = window.electron;
    if (!api) return [];
    try {
      const list = await api.getConversations();
      setConversations(list);
      return list;
    } catch {
      return [];
    }
  }, []);

  const conversationsChanged = useCallback(() => {
    void refreshConversations();
  }, [refreshConversations]);

  useEffect(() => {
    if (status.state !== "ready" || !config?.onboarding.completed) return;

    let cancelled = false;
    void (async () => {
      const api = window.electron;
      if (!api) return;
      try {
        let list = await api.getConversations();
        if (!list.length) {
          await api.createConversation();
          list = await api.getConversations();
        }
        if (cancelled) return;
        setConversations(list);
        setActiveConversationId((current) =>
          current && list.some((conversation) => conversation.id === current)
            ? current
            : list[0]?.id ?? null
        );
      } catch {
        /* the agent announces readiness again after a model reload */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [status.state, config?.onboarding.completed]);

  useEffect(() => {
    const api = window.electron;
    if (!api) return;

    return api.onChatEvent((event) => {
      if (event.type === "start") {
        setBusyConversationId(event.conversationId);
        return;
      }
      if (event.type === "done" || event.type === "stopped" || event.type === "error") {
        setBusyConversationId((current) => (current === event.conversationId ? null : current));
        void api.getConversations().then(setConversations).catch(() => undefined);
      }
    });
  }, []);

  const newChat = useCallback(async () => {
    const api = window.electron;
    if (!api) return;
    const current = conversations.find((conversation) => conversation.id === activeConversationId);
    if (current && current.messageCount === 0) return;

    try {
      setBusyConversationId(null);
      const created = await api.createConversation();
      const list = await api.getConversations();
      setConversations(list.length ? list : [created]);
      setActiveConversationId(created.id);
    } catch {
      /* keep the current chat if a new one cannot be created yet */
    }
  }, [activeConversationId, conversations]);

  const selectConversation = useCallback(
    async (id: string) => {
      if (!id || id === activeConversationId) return;
      const api = window.electron;
      if (!api) return;
      try {
        await api.switchConversation(id);
        setBusyConversationId(null);
        setActiveConversationId(id);
      } catch {
        void refreshConversations();
      }
    },
    [activeConversationId, refreshConversations]
  );

  const renameConversation = useCallback(async (id: string, title: string) => {
    const api = window.electron;
    if (!api) return;
    try {
      await api.renameConversation(id, title.trim());
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === id ? { ...conversation, title: title.trim() } : conversation
        )
      );
    } catch {
      /* the title stays as it was */
    }
  }, []);

  const pinConversation = useCallback(async (id: string, pinned: boolean) => {
    const api = window.electron;
    if (!api) return;
    try {
      await api.setConversationPinned(id, pinned);
      const list = await api.getConversations();
      setConversations(list);
    } catch {
      /* ignore a failed pin */
    }
  }, []);

  const deleteConversation = useCallback(
    async (id: string) => {
      const api = window.electron;
      if (!api) return;
      try {
        const fallback = await api.deleteConversation(id);
        const list = await api.getConversations();
        setConversations(list);
        if (id === activeConversationId) {
          setActiveConversationId(fallback?.id ?? list[0]?.id ?? null);
          setBusyConversationId(null);
        } else if (id === busyConversationId) {
          setBusyConversationId(null);
        }
      } catch {
        /* keep the list unchanged */
      }
    },
    [activeConversationId, busyConversationId]
  );

  const searchConversations = useCallback(async (query: string): Promise<ConversationSearchHit[]> => {
    try {
      return (await window.electron?.searchConversations(query)) ?? [];
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (config && !config.onboarding.completed) return;
      if (event.key === "Escape") setView("chat");
      if (event.key === "," && event.metaKey) {
        event.preventDefault();
        setView("settings");
      }
      if (event.key.toLowerCase() === "n" && event.metaKey && view === "chat") {
        event.preventDefault();
        void newChat();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [config, newChat, view]);

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
  const activeConversation = conversations.find((conversation) => conversation.id === activeConversationId);
  const activeTitle = activeConversation?.title ?? "New chat";
  const activeBusy = busyConversationId != null && busyConversationId === activeConversationId;

  if (!config) {
    return (
      <div className="h-screen bg-paper flex flex-col items-center justify-center gap-4">
        <img
          src={`/logos/${logo.file}`}
          alt=""
          className="w-16 h-16 rounded-full logo-mood-change"
          style={{ boxShadow: "0 0 0 2px var(--color-accent-soft), 0 18px 40px -22px var(--color-accent)" }}
        />
        <p className="text-[10px] uppercase tracking-[0.18em] text-faint">Waking up</p>
      </div>
    );
  }

  if (!config.onboarding.completed) {
    return (
      <Onboarding
        status={status}
        mood={mood}
        config={config}
        onPatch={patchConfig}
        onRefreshStatus={refreshStatus}
      />
    );
  }

  if (view === "settings") {
    return (
      <SettingsView
        status={status}
        mood={mood}
        config={config}
        onPatch={patchConfig}
        onClose={() => setView("chat")}
        onRefreshStatus={refreshStatus}
      />
    );
  }

  return (
    <div className="flex h-screen bg-paper">
      <AppSidebar
        mood={mood}
        status={status}
        agentName={agentName}
        panelOpen={panelOpen}
        conversations={conversations}
        activeConversationId={activeConversationId}
        busyConversationId={busyConversationId}
        onTogglePanel={() => setPanelOpen((open) => !open)}
        onSettings={() => setView("settings")}
        onNewChat={() => void newChat()}
        onSelectConversation={(id) => void selectConversation(id)}
        onRenameConversation={(id, title) => void renameConversation(id, title)}
        onPinConversation={(id, pinned) => void pinConversation(id, pinned)}
        onDeleteConversation={(id) => void deleteConversation(id)}
        onSearchConversations={searchConversations}
      />

      <main className="flex-1 flex flex-col min-w-0">
        <header className="drag-region h-12 shrink-0 flex items-center justify-between gap-4 px-5 border-b border-line">
          <div className="flex items-center gap-2 text-[11.5px] min-w-0">
            <FolderOpen size={14} className="text-faint shrink-0" />
            <span className="text-faint">workspace</span>
            <span className="text-faint">/</span>
            <span className="flex items-center gap-1.5 text-ink min-w-0">
              {activeBusy ? (
                <Loader size={11} className="animate-spin text-accent-ink shrink-0" />
              ) : (
                <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
              )}
              <span className="truncate">{activeTitle}</span>
              {activeBusy && <span className="chip chip-accent !h-5 shrink-0">Answering</span>}
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
          autoExecute={config.agent.autoExecuteTasks}
          conversationId={activeConversationId}
          busyConversationId={busyConversationId}
          onConversationsChanged={conversationsChanged}
          onOpenSettings={() => setView("settings")}
          onNewConversation={() => void newChat()}
        />
      </main>

      {panelOpen && (
        <aside className="w-[300px] shrink-0 border-l border-line bg-card-2 overflow-y-auto">
          <TaskMonitor autoExecute={config.agent.autoExecuteTasks} />
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
