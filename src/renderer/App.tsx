import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { FolderOpen, Loader, PanelRight, Settings2 } from "lucide-react";
import { ChatInterface } from "./components/ChatInterface";
import { TaskMonitor } from "./components/TaskMonitor";
import { AppSidebar } from "./components/AppSidebar";
import { Onboarding } from "./components/Onboarding";
import { ApprovalDialog } from "./components/ApprovalDialog";
import { LockScreen } from "./components/LockScreen";
import { useAppearance } from "./theme";
import { logoUrl } from "./assets";
import { moodLabel, setLanguage, t } from "./i18n";

// Settings carries the model manager, extensions and diagnostics; loading it on
// first open keeps it out of the cold-start bundle.
const SettingsView = lazy(() =>
  import("./components/SettingsView").then((module) => ({ default: module.SettingsView }))
);
import {
  MOOD_LOGOS,
  type AgentStatus,
  type ApprovalRequest,
  type Config,
  type ConfigPatch,
  type Conversation,
  type ConversationSearchHit,
  type Mood,
  type PrivacyStatus,
} from "../utils/types";

type View = "chat" | "settings";

// Mirrors the settings shell so a first open paints the layout instead of a blank frame.
function SettingsFallback() {
  return (
    <div className="h-screen bg-paper flex" aria-busy="true">
      <div className="w-[275px] shrink-0 border-r border-line px-4 pt-6 space-y-3">
        <div className="h-7 w-32 rounded bg-card-2 animate-pulse" />
        <div className="h-8 w-full rounded-lg bg-card-2 animate-pulse" />
        {Array.from({ length: 9 }, (_, index) => (
          <div key={index} className="h-6 w-full rounded bg-card-2 animate-pulse" />
        ))}
      </div>
      <div className="flex-1 px-12 py-10 space-y-5">
        <div className="h-7 w-48 rounded bg-card-2 animate-pulse" />
        <div className="h-3 w-96 max-w-full rounded bg-card-2 animate-pulse" />
        <div className="h-44 w-full max-w-[720px] rounded-xl bg-card-2 animate-pulse" />
        <div className="h-44 w-full max-w-[720px] rounded-xl bg-card-2 animate-pulse" />
      </div>
    </div>
  );
}

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
  const [privacyStatus, setPrivacyStatus] = useState<PrivacyStatus | null>(null);
  /** Bumped when the history is locked or erased, so the chat list reloads. */
  const [historyVersion, setHistoryVersion] = useState(0);

  useEffect(() => {
    // Pull the settings chunk after the first paint: the split keeps it out of cold
    // start without making the first visit wait on a module load.
    const timer = setTimeout(() => void import("./components/SettingsView"), 2000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const api = window.electron;
    if (!api) return;

    const unsubscribes = [
      api.onAgentStatus(setStatus),
      api.onAgentReady(() => void api.getAgentStatus().then(setStatus)),
      api.onMoodChange((next) => setMood(next as Mood)),
      api.onApprovalRequest((request) => {
        if ((request.origin ?? "main") === "main") setApproval(request);
      }),
      api.onOpenSettings(() => setView("settings")),
      // A quick ask opened from the popover becomes a chat and lands here.
      api.onOpenConversation((id) => {
        setView("chat");
        void api.switchConversation(id).then(() => {
          setActiveConversationId(id);
          setBusyConversationId(null);
          return api.getConversations().then(setConversations);
        }).catch(() => undefined);
      }),
      // An imported backup can add chats and change settings while this window is open.
      api.onLocalDataChanged(() => {
        void api.getConfig().then(setConfig).catch(() => undefined);
        void api.getPrivacyStatus().then(setPrivacyStatus).catch(() => undefined);
        void api.getConversations().then(setConversations).catch(() => undefined);
      }),
      // Locking or erasing drops the history: let go of it here instead of
      // reloading the window, which would flash the whole app.
      api.onHistoryReset(() => {
        setConversations([]);
        setActiveConversationId(null);
        setHistoryVersion((value) => value + 1);
        void api.getPrivacyStatus().then(setPrivacyStatus).catch(() => undefined);
      }),
    ];

    void api.getCurrentMood().then(setMood).catch(() => undefined);
    void api.getAgentStatus().then(setStatus).catch(() => undefined);
    void api.getConfig().then(setConfig).catch(() => undefined);
    void api.getPrivacyStatus().then(setPrivacyStatus).catch(() => undefined);

    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, []);

  useAppearance(config);
  if (config) setLanguage(config.ui.language);

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
    if (status.state !== "ready" || !config?.onboarding.completed || privacyStatus?.locked) return;

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
  }, [status.state, config?.onboarding.completed, privacyStatus?.locked, historyVersion]);

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
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [config]);

  const respond = useCallback(
    async (approved: boolean, remember = false) => {
      if (!approval) return;
      await window.electron?.approveTask(approval.requestId, approved, remember);
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

  useEffect(() => {
    const api = window.electron;
    if (!api) return;

    return api.onMenuCommand((command) => {
      if (config && !config.onboarding.completed) return;
      switch (command) {
        case "new-chat":
          void newChat();
          break;
        case "settings":
          setView("settings");
          break;
        case "toggle-activity":
          setPanelOpen((open) => !open);
          break;
        case "stop":
          void api.stopGeneration();
          break;
        case "cycle-mood":
          cycleMood();
          break;
        case "search-chats":
          setView("chat");
          window.requestAnimationFrame(() => window.dispatchEvent(new Event("om:focus-search")));
          break;
        case "focus-composer":
          setView("chat");
          window.requestAnimationFrame(() => window.dispatchEvent(new Event("om:focus-composer")));
          break;
      }
    });
  }, [config, cycleMood, newChat]);

  const agentName = config?.agent.name ?? "OpenMonkey";
  const logo = MOOD_LOGOS[mood] ?? MOOD_LOGOS.neutral;
  const activeConversation = conversations.find((conversation) => conversation.id === activeConversationId);
  const activeTitle = activeConversation?.title ?? "New chat";
  const activeBusy = busyConversationId != null && busyConversationId === activeConversationId;

  if (!config) {
    return (
      <div className="h-screen bg-paper flex flex-col items-center justify-center gap-4">
        <img
          src={logoUrl(logo.file)}
          alt=""
          className="w-16 h-16 rounded-full logo-mood-change"
          style={{ boxShadow: "0 0 0 2px var(--color-accent-soft), 0 18px 40px -22px var(--color-accent)" }}
        />
        <p className="text-[10px] uppercase tracking-[0.18em] text-faint">Waking up</p>
      </div>
    );
  }

  if (privacyStatus?.locked) {
    return (
      <LockScreen
        mood={mood}
        onUnlocked={() => setPrivacyStatus((current) => (current ? { ...current, locked: false } : current))}
      />
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
      <>
        <Suspense fallback={<SettingsFallback />}>
          <SettingsView
            status={status}
            mood={mood}
            config={config}
            onPatch={patchConfig}
            onClose={() => setView("chat")}
            onRefreshStatus={refreshStatus}
          />
        </Suspense>
        {approval && <ApprovalDialog approval={approval} agentName={agentName} onResolve={respond} />}
      </>
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
            <span className="text-faint">{t("nav.workspace")}</span>
            <span className="text-faint">/</span>
            <span className="flex items-center gap-1.5 text-ink min-w-0">
              {activeBusy ? (
                <Loader size={11} className="animate-spin text-accent-ink shrink-0" />
              ) : (
                <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
              )}
              <span className="truncate">{activeTitle}</span>
              {activeBusy && <span className="chip chip-accent !h-5 shrink-0">{t("chat.answering")}</span>}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={cycleMood} className="chip no-drag hover:border-ink/25" title={t("nav.cycleMood")}>
              <img src={logoUrl(logo.file)} alt="" className="w-4 h-4 rounded-full" />
              {moodLabel(mood)}
            </button>
            <button
              onClick={() => setPanelOpen((open) => !open)}
              className={`icon-btn ${panelOpen ? "bg-card-2 text-ink" : ""}`}
              title={panelOpen ? t("nav.hideActivity") : t("nav.showActivity")}
            >
              <PanelRight size={16} />
            </button>
            <button onClick={() => setView("settings")} className="icon-btn" title={t("nav.settings")}>
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
          starterPromptsHidden={config.ui.starterPromptsHidden}
          onConversationsChanged={conversationsChanged}
          onOpenSettings={() => setView("settings")}
          onNewConversation={() => void newChat()}
          onHideStarterPrompts={() => void patchConfig({ ui: { starterPromptsHidden: true } })}
          onShowStarterPrompts={() => void patchConfig({ ui: { starterPromptsHidden: false } })}
        />
      </main>

      {panelOpen && (
        <aside className="w-[300px] shrink-0 border-l border-line bg-card-2 overflow-y-auto">
          <TaskMonitor autoExecute={config.agent.autoExecuteTasks} />
        </aside>
      )}

      {approval && <ApprovalDialog approval={approval} agentName={agentName} onResolve={respond} />}
    </div>
  );
}
