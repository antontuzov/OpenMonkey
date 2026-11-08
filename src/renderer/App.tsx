import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { FolderOpen, Loader, PanelRight, Settings2 } from "lucide-react";
import { ChatInterface } from "./components/ChatInterface";
import { TaskMonitor } from "./components/TaskMonitor";
import { AppSidebar } from "./components/AppSidebar";
import { TabStrip } from "./components/TabStrip";
import { Onboarding } from "./components/Onboarding";
import { ApprovalDialog } from "./components/ApprovalDialog";
import { LockScreen } from "./components/LockScreen";
import { SafeModeBanner } from "./components/SafeModeBanner";
import { useAppearance } from "./theme";
import { logoUrl } from "./assets";
import { moodLabel, setLanguage, t } from "./i18n";
import type { PaletteCommand } from "./command-palette";

// Settings carries the model manager, extensions and diagnostics; loading it on
// first open keeps it out of the cold-start bundle.
const SettingsView = lazy(() =>
  import("./components/SettingsView").then((module) => ({ default: module.SettingsView }))
);
// The palette is only wanted once someone reaches for it, so it waits for an idle
// moment instead of riding along on the first paint.
const CommandPalette = lazy(() =>
  import("./components/CommandPalette").then((module) => ({ default: module.CommandPalette }))
);
import {
  MOOD_LOGOS,
  type AgentStatus,
  type ApprovalRequest,
  type ChatFolder,
  type ChatTag,
  type Config,
  type ConfigPatch,
  type Conversation,
  type ConversationSearchHit,
  type Mood,
  type PortabilityResult,
  type PrivacyStatus,
  type SafeModeInfo,
  type SavedSearch,
  type SettingsPage,
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
  /** The chats filed away, which the sidebar shows instead of the list. */
  const [archivedConversations, setArchivedConversations] = useState<Conversation[]>([]);
  /** The folders the chats are filed under, with the labels in use and the kept searches. */
  const [folders, setFolders] = useState<ChatFolder[]>([]);
  const [tags, setTags] = useState<ChatTag[]>([]);
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  /** The chats open in this window, in the order the tabs are shown. */
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  /** True once the stored tabs are read, so the first write does not erase them. */
  const tabsRestored = useRef(false);
  /** The tabs as they were when the window opened. */
  const storedTabs = useRef<{ openTabs: string[]; activeTab: string | null } | null>(null);
  const [busyConversationId, setBusyConversationId] = useState<string | null>(null);
  const [privacyStatus, setPrivacyStatus] = useState<PrivacyStatus | null>(null);
  /** How this launch was started, and whether it came up without its extras. */
  const [safeMode, setSafeMode] = useState<SafeModeInfo | null>(null);
  /** The command palette: one box for the chats, the settings and the commands. */
  const [paletteOpen, setPaletteOpen] = useState(false);
  /** Where the palette sends the user inside the settings. */
  const [settingsJump, setSettingsJump] = useState<{ page: SettingsPage; label?: string } | null>(null);
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
      // The answer may have come from the notification, so the dialog stops waiting.
      api.onApprovalResolved((payload) => {
        setApproval((current) => (current?.requestId === payload.requestId ? null : current));
      }),
      api.onOpenSettings(() => setView("settings")),
      // A quick ask opened from the popover becomes a chat and lands here.
      api.onOpenConversation((id) => {
        setView("chat");
        setOpenTabs((tabs) => (tabs.includes(id) ? tabs : [...tabs, id]));
        setActiveConversationId(id);
        void api.getConversations().then(setConversations).catch(() => undefined);
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
        setOpenTabs([]);
        setActiveConversationId(null);
        setHistoryVersion((value) => value + 1);
        void api.getPrivacyStatus().then(setPrivacyStatus).catch(() => undefined);
      }),
    ];

    void api.getCurrentMood().then(setMood).catch(() => undefined);
    void api.getAgentStatus().then(setStatus).catch(() => undefined);
    void api
      .getConfig()
      .then((next) => {
        setConfig(next);
        storedTabs.current = {
          openTabs: next.ui.openTabs ?? [],
          activeTab: next.ui.activeTab ?? null,
        };
      })
      .catch(() => undefined);
    void api.getPrivacyStatus().then(setPrivacyStatus).catch(() => undefined);
    void api.getSafeMode().then(setSafeMode).catch(() => undefined);

    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, []);

  // The palette is fetched while the app is idle, so the first Cmd+K opens at once.
  useEffect(() => {
    const idle = window.requestIdleCallback(() => {
      void import("./components/CommandPalette");
    });
    return () => window.cancelIdleCallback(idle);
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

  /**
   * The organiser's own state: what is filed away, the folders, the labels and the
   * searches the user kept. It is read separately from the chat list because it
   * changes for reasons the list does not know about.
   */
  const refreshOrganizer = useCallback(async () => {
    const api = window.electron;
    if (!api) return;
    const [archived, nextFolders, nextTags, nextSearches] = await Promise.all([
      api.getArchivedConversations().catch(() => [] as Conversation[]),
      api.listFolders().catch(() => [] as ChatFolder[]),
      api.listTags().catch(() => [] as ChatTag[]),
      api.listSavedSearches().catch(() => [] as SavedSearch[]),
    ]);
    setArchivedConversations(archived);
    setFolders(nextFolders);
    setTags(nextTags);
    setSavedSearches(nextSearches);
  }, []);

  const archiveConversation = useCallback(
    async (id: string, archived: boolean) => {
      const api = window.electron;
      if (!api) return;
      try {
        await api.setConversationArchived(id, archived);
        await refreshConversations();
        await refreshOrganizer();
      } catch {
        /* the chat stays as it was */
      }
    },
    [refreshConversations, refreshOrganizer]
  );

  const setConversationFolder = useCallback(
    async (id: string, folderId: string | null) => {
      const api = window.electron;
      if (!api) return;
      try {
        await api.setConversationFolder(id, folderId);
        await refreshConversations();
        await refreshOrganizer();
      } catch {
        /* the chat stays in the folder it was in */
      }
    },
    [refreshConversations, refreshOrganizer]
  );

  const setConversationTags = useCallback(
    async (id: string, next: string[]) => {
      const api = window.electron;
      if (!api) return;
      try {
        await api.setConversationTags(id, next);
        await refreshConversations();
        await refreshOrganizer();
      } catch {
        /* the labels stay as they were */
      }
    },
    [refreshConversations, refreshOrganizer]
  );

  const createFolder = useCallback(
    async (name: string) => {
      const api = window.electron;
      if (!api) return;
      try {
        await api.createFolder(name);
        await refreshOrganizer();
      } catch {
        /* no folder is made */
      }
    },
    [refreshOrganizer]
  );

  const deleteFolder = useCallback(
    async (id: string) => {
      const api = window.electron;
      if (!api) return;
      try {
        await api.deleteFolder(id);
        await refreshConversations();
        await refreshOrganizer();
      } catch {
        /* the folder stays */
      }
    },
    [refreshConversations, refreshOrganizer]
  );

  const createSavedSearch = useCallback(
    async (name: string, query: string) => {
      const api = window.electron;
      if (!api) return;
      try {
        await api.createSavedSearch(name, query);
        await refreshOrganizer();
      } catch {
        /* the search is not kept */
      }
    },
    [refreshOrganizer]
  );

  const deleteSavedSearch = useCallback(
    async (id: string) => {
      const api = window.electron;
      if (!api) return;
      try {
        await api.deleteSavedSearch(id);
        await refreshOrganizer();
      } catch {
        /* the search stays */
      }
    },
    [refreshOrganizer]
  );

  const exportConversations = useCallback(
    async (ids: string[], passphrase: string): Promise<PortabilityResult> => {
      const api = window.electron;
      if (!api) return { ok: false, error: "The app is not ready yet" };
      try {
        return await api.exportConversations(ids, passphrase);
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
    []
  );

  useEffect(() => {
    // Chats live in storage, which opens before the model does. Waiting for "ready"
    // hid a user's whole history from anyone whose weights are missing or still
    // downloading, which is every first run from the DMG. "starting" is the only
    // state where there is no agent yet to answer get-conversations.
    if (status.state === "starting" || !config?.onboarding.completed || privacyStatus?.locked) return;

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

        // The tabs are restored once. A later reload of the model must not throw
        // away the chats the user has open.
        if (tabsRestored.current) {
          setOpenTabs((current) => current.filter((id) => list.some((item) => item.id === id)));
          return;
        }

        const openable = list
          .filter((conversation) => conversation.kind === "chat")
          .map((conversation) => conversation.id);
        const saved = storedTabs.current;
        const restored = (saved?.openTabs ?? []).filter((id) => openable.includes(id));
        const fallback = openable[0] ?? list[0]?.id ?? null;
        const tabs = restored.length ? restored : fallback ? [fallback] : [];
        setOpenTabs(tabs);
        setActiveConversationId(
          saved?.activeTab && tabs.includes(saved.activeTab) ? saved.activeTab : tabs[0] ?? null
        );
        tabsRestored.current = true;
      } catch {
        /* the agent announces readiness again after a model reload */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [status.state, config?.onboarding.completed, privacyStatus?.locked, historyVersion]);

  // The organiser reads the same storage, so it waits for the history to be open.
  useEffect(() => {
    if (status.state === "starting" || !config?.onboarding.completed || privacyStatus?.locked) return;
    void refreshOrganizer();
  }, [status.state, config?.onboarding.completed, privacyStatus?.locked, historyVersion, refreshOrganizer]);

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

  /** A tab of its own, even when the chat in front is still empty. */
  const newTab = useCallback(async () => {
    const api = window.electron;
    if (!api) return;
    try {
      const created = await api.createConversation();
      const list = await api.getConversations();
      setConversations(list.length ? list : [created]);
      setOpenTabs((tabs) => (tabs.includes(created.id) ? tabs : [...tabs, created.id]));
      setActiveConversationId(created.id);
    } catch {
      /* keep the current chat if a new one cannot be created yet */
    }
  }, []);

  const newChat = useCallback(async () => {
    const api = window.electron;
    if (!api) return;
    const current = conversations.find((conversation) => conversation.id === activeConversationId);
    if (current && current.messageCount === 0) return;
    await newTab();
  }, [activeConversationId, conversations, newTab]);

  /**
   * Switching tabs is a change of view, not of chat: the running answer in the
   * other tab keeps going, and the model follows the question when it is sent.
   */
  const selectConversation = useCallback((id: string) => {
    if (!id) return;
    setOpenTabs((tabs) => (tabs.includes(id) ? tabs : [...tabs, id]));
    setActiveConversationId(id);
  }, []);

  /** Closing a tab leaves the chat in the history; the last one stays open. */
  const closeTab = useCallback(
    (id: string) => {
      if (openTabs.length <= 1) return;
      const next = openTabs.filter((tab) => tab !== id);
      setOpenTabs(next);
      if (id === activeConversationId) setActiveConversationId(next[next.length - 1] ?? null);
    },
    [activeConversationId, openTabs]
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
        const remaining = openTabs.filter((tab) => tab !== id);
        if (id === activeConversationId) {
          const next = fallback?.id ?? list[0]?.id ?? null;
          setOpenTabs(next && !remaining.includes(next) ? [...remaining, next] : remaining);
          setActiveConversationId(next);
          setBusyConversationId(null);
        } else {
          setOpenTabs(remaining);
          if (id === busyConversationId) setBusyConversationId(null);
        }
      } catch {
        /* keep the list unchanged */
      }
    },
    [activeConversationId, busyConversationId, openTabs]
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

  // Cmd+K opens the palette from anywhere in the app.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (config && !config.onboarding.completed) return;
      if (privacyStatus?.locked) return;
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      // Opening, not toggling: the menu accelerator can deliver the same key.
      setPaletteOpen(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [config, privacyStatus?.locked]);

  const openSettingsAt = useCallback((page: SettingsPage, label?: string) => {
    setSettingsJump(label ? { page, label } : { page });
    setPaletteOpen(false);
    setView("settings");
  }, []);

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

  // The open chats are part of the window state: they come back with the window.
  useEffect(() => {
    if (!tabsRestored.current) return;
    void patchConfig({ ui: { openTabs, activeTab: activeConversationId } });
  }, [activeConversationId, openTabs, patchConfig]);

  const resetSection = useCallback(async (page: SettingsPage) => {
    const next = await window.electron?.resetSettingsSection(page);
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

  const runPaletteCommand = useCallback(
    (command: PaletteCommand) => {
      setPaletteOpen(false);
      switch (command) {
        case "new-chat":
          void newChat();
          break;
        case "toggle-panel":
          setPanelOpen((open) => !open);
          break;
        case "cycle-mood":
          cycleMood();
          break;
        case "clear-chat":
          window.dispatchEvent(new Event("om:clear-chat"));
          break;
        case "summarize-chat":
          window.dispatchEvent(new Event("om:summarize-chat"));
          break;
        case "stop":
          void window.electron?.stopGeneration();
          break;
        case "focus-composer":
          window.dispatchEvent(new Event("om:focus-composer"));
          break;
      }
    },
    [cycleMood, newChat]
  );

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
        case "command-palette":
          setView("chat");
          setPaletteOpen(true);
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
  const tabConversations = openTabs
    .map((id) => conversations.find((conversation) => conversation.id === id))
    .filter((conversation): conversation is Conversation => Boolean(conversation));

  const palette = paletteOpen ? (
    <Suspense fallback={null}>
      <CommandPalette
        language={config?.ui.language ?? "en"}
        conversations={conversations}
        onClose={() => setPaletteOpen(false)}
        onSelectConversation={(id) => void selectConversation(id)}
        onOpenSettings={openSettingsAt}
        onCommand={runPaletteCommand}
        onSearchConversations={searchConversations}
      />
    </Suspense>
  ) : null;

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
        safeMode={safeMode}
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
            jump={settingsJump}
            onPatch={patchConfig}
            onResetSection={resetSection}
            onClose={() => setView("chat")}
            onRefreshStatus={refreshStatus}
          />
        </Suspense>
        {approval && <ApprovalDialog approval={approval} agentName={agentName} onResolve={respond} />}
        {palette}
      </>
    );
  }

  return (
    <div className="flex h-screen">
      <AppSidebar
        mood={mood}
        status={status}
        agentName={agentName}
        panelOpen={panelOpen}
        conversations={conversations}
        archivedConversations={archivedConversations}
        folders={folders}
        tags={tags}
        savedSearches={savedSearches}
        activeConversationId={activeConversationId}
        busyConversationId={busyConversationId}
        onTogglePanel={() => setPanelOpen((open) => !open)}
        onSettings={() => setView("settings")}
        onNewChat={() => void newChat()}
        onSelectConversation={(id) => void selectConversation(id)}
        onRenameConversation={(id, title) => void renameConversation(id, title)}
        onPinConversation={(id, pinned) => void pinConversation(id, pinned)}
        onDeleteConversation={(id) => void deleteConversation(id)}
        onArchiveConversation={(id, archived) => void archiveConversation(id, archived)}
        onSetConversationFolder={(id, folderId) => void setConversationFolder(id, folderId)}
        onSetConversationTags={(id, next) => void setConversationTags(id, next)}
        onCreateFolder={(name) => void createFolder(name)}
        onDeleteFolder={(id) => void deleteFolder(id)}
        onCreateSavedSearch={(name, query) => void createSavedSearch(name, query)}
        onDeleteSavedSearch={(id) => void deleteSavedSearch(id)}
        onExportConversations={exportConversations}
        onSearchConversations={searchConversations}
      />

      <main className="flex-1 flex flex-col min-w-0 bg-paper view-crossfade">
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

        {safeMode?.active && <SafeModeBanner safeMode={safeMode} />}

        <TabStrip
          tabs={tabConversations}
          activeId={activeConversationId}
          busyId={busyConversationId}
          onSelect={selectConversation}
          onClose={closeTab}
          onNewTab={() => void newTab()}
        />

        <ChatInterface
          status={status}
          mood={mood}
          agentName={agentName}
          autoExecute={config.agent.autoExecuteTasks}
          sendKey={config.ui.sendKey}
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

      {/* The panel keeps its place in the tree so it can slide on the spring. */}
      <div className={`motion-panel shrink-0 overflow-hidden ${panelOpen ? "w-[300px]" : "w-0"}`}>
        <aside className="w-[300px] h-full border-l border-line bg-card-2 overflow-y-auto">
          <TaskMonitor autoExecute={config.agent.autoExecuteTasks} />
        </aside>
      </div>

      {approval && <ApprovalDialog approval={approval} agentName={agentName} onResolve={respond} />}

      {palette}
    </div>
  );
}
