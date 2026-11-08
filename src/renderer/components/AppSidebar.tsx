import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Archive,
  Check,
  CheckSquare,
  ChevronDown,
  FolderTree,
  House,
  Loader,
  MessageSquare,
  MoreHorizontal,
  Pin,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Square,
  Trash2,
  X,
} from "lucide-react";
import {
  MOOD_LOGOS,
  type AgentStatus,
  type ChatFolder,
  type ChatTag,
  type Conversation,
  type ConversationSearchHit,
  type Mood,
  type PortabilityResult,
  type SavedSearch,
} from "../../utils/types";
import { moodLabel, t } from "../i18n";
import { formatDate, formatNumber } from "../format";
import { logoUrl } from "../assets";
import { ChatMenu } from "./ChatMenu";
import { OrganizerPanel } from "./OrganizerPanel";
import { toast } from "./Toast";

interface AppSidebarProps {
  mood: Mood;
  status: AgentStatus;
  agentName: string;
  panelOpen: boolean;
  conversations: Conversation[];
  archivedConversations: Conversation[];
  folders: ChatFolder[];
  tags: ChatTag[];
  savedSearches: SavedSearch[];
  activeConversationId: string | null;
  busyConversationId: string | null;
  onTogglePanel: () => void;
  onSettings: () => void;
  onNewChat: () => void;
  onSelectConversation: (id: string) => void;
  onRenameConversation: (id: string, title: string) => void;
  onPinConversation: (id: string, pinned: boolean) => void;
  onDeleteConversation: (id: string) => void;
  onArchiveConversation: (id: string, archived: boolean) => void;
  onSetConversationFolder: (id: string, folderId: string | null) => void;
  onSetConversationTags: (id: string, tags: string[]) => void;
  onCreateFolder: (name: string) => void;
  onDeleteFolder: (id: string) => void;
  onCreateSavedSearch: (name: string, query: string) => void;
  onDeleteSavedSearch: (id: string) => void;
  onExportConversations: (ids: string[], passphrase: string) => Promise<PortabilityResult>;
  onSearchConversations: (query: string) => Promise<ConversationSearchHit[]>;
}

const relativeTime = (value: Date) => {
  const date = new Date(value);
  const diff = Date.now() - date.getTime();
  if (!Number.isFinite(diff) || diff < 60_000) return "now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d`;
  return formatDate(date);
};

/** The export file is sealed with a passphrase, and the shortest one allowed is this long. */
const PASSPHRASE_MIN = 8;

interface SessionRowProps {
  conversation: Conversation;
  snippet: string;
  active: boolean;
  busy: boolean;
  editing: boolean;
  confirming: boolean;
  selecting: boolean;
  selected: boolean;
  onSelect: () => void;
  onToggleSelect: () => void;
  onCommitRename: (title: string) => void;
  onCancelRename: () => void;
  onTogglePin: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  onOpenMenu: (anchor: { top: number; left: number }) => void;
}

const SessionRow: React.FC<SessionRowProps> = ({
  conversation,
  snippet,
  active,
  busy,
  editing,
  confirming,
  selecting,
  selected,
  onSelect,
  onToggleSelect,
  onCommitRename,
  onCancelRename,
  onTogglePin,
  onConfirmDelete,
  onCancelDelete,
  onOpenMenu,
}) => {
  const [draft, setDraft] = useState(conversation.title);
  const inputRef = useRef<HTMLInputElement>(null);
  const finishedRef = useRef(false);

  useEffect(() => {
    if (!editing) return;
    finishedRef.current = false;
    setDraft(conversation.title);
    window.requestAnimationFrame(() => {
      inputRef.current?.select();
    });
  }, [editing, conversation.title]);

  const finish = (save: boolean) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    if (save) {
      const next = draft.trim();
      if (next && next !== conversation.title) onCommitRename(next);
      else onCancelRename();
    } else {
      onCancelRename();
    }
  };

  return (
    <div
      className={`group relative flex items-center gap-1 rounded-[9px] transition-colors ${
        active ? "bg-accent-soft" : "hover:bg-ink/5"
      }`}
    >
      {editing ? (
        <div className="flex items-center gap-1 flex-1 min-w-0 px-1.5 py-1.5">
          <input
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") {
                event.preventDefault();
                finish(true);
              }
              if (event.key === "Escape") {
                event.preventDefault();
                finish(false);
              }
            }}
            onBlur={() => finish(true)}
            className="field !h-7 w-full !text-[11.5px]"
            aria-label="Conversation title"
          />
          <button
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => finish(true)}
            className="icon-btn !w-6 !h-6 shrink-0"
            title="Save title"
          >
            <Check size={12} />
          </button>
          <button
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => finish(false)}
            className="icon-btn !w-6 !h-6 shrink-0"
            title="Cancel rename"
          >
            <X size={12} />
          </button>
        </div>
      ) : confirming ? (
        <div className="flex items-center gap-2 flex-1 min-w-0 px-2.5 py-2">
          <Trash2 size={13} className="text-danger shrink-0" />
          <span className="text-[11px] text-muted truncate flex-1">Delete “{conversation.title}”?</span>
          <button
            onClick={onConfirmDelete}
            className="btn !h-6 !px-2 !text-[10px] !border-danger/40 !text-danger"
          >
            Delete
          </button>
          <button onClick={onCancelDelete} className="icon-btn !w-6 !h-6 shrink-0" title="Keep chat">
            <X size={12} />
          </button>
        </div>
      ) : (
        <>
          <button
            type="button"
            data-session-row
            onClick={selecting ? onToggleSelect : onSelect}
            role={selecting ? "checkbox" : undefined}
            aria-checked={selecting ? selected : undefined}
            aria-current={active ? "true" : undefined}
            className="flex-1 min-w-0 text-start px-2 py-1.5 rounded-[9px]"
          >
            <span className="flex items-center gap-2 min-w-0">
              {selecting ? (
                selected ? (
                  <CheckSquare size={13} className="text-accent-ink shrink-0" />
                ) : (
                  <Square size={13} className="text-faint shrink-0" />
                )
              ) : busy ? (
                <Loader size={13} className="animate-spin text-accent-ink shrink-0" />
              ) : (
                <MessageSquare size={13} className={active ? "text-accent-ink shrink-0" : "text-faint shrink-0"} />
              )}
              <span className={`truncate text-[12px] ${active ? "text-accent-ink font-medium" : "text-ink"}`}>
                {conversation.title}
              </span>
              {conversation.pinned && <Pin size={10} className="text-faint shrink-0" />}
            </span>
            <span
              className={`block ps-[21px] text-[10px] truncate ${busy ? "text-accent-ink" : "text-faint"}`}
            >
              {busy
                ? t("chat.placeholderBusy")
                : snippet ||
                  (conversation.messageCount
                    ? t("nav.messages", { count: formatNumber(conversation.messageCount) })
                    : t("nav.emptyChat"))}
            </span>
          </button>

          <div className="relative shrink-0 w-[62px] self-stretch flex items-center justify-end pe-2">
            <span className="text-[9.5px] text-faint tabular-nums group-hover:opacity-0 transition-opacity">
              {relativeTime(conversation.updatedAt)}
            </span>
            <div className="absolute end-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto">
              <button
                onClick={onTogglePin}
                className={`icon-btn !w-[18px] !h-[18px] ${conversation.pinned ? "text-accent-ink" : ""}`}
                title={conversation.pinned ? "Unpin chat" : "Pin chat"}
              >
                <Pin size={11} />
              </button>
              <button
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  onOpenMenu({ top: rect.bottom + 4, left: rect.right - 236 });
                }}
                className="icon-btn !w-[18px] !h-[18px]"
                title={t("org.more")}
              >
                <MoreHorizontal size={12} />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export const AppSidebar: React.FC<AppSidebarProps> = ({
  mood,
  status,
  agentName,
  panelOpen,
  conversations,
  archivedConversations,
  folders,
  tags,
  savedSearches,
  activeConversationId,
  busyConversationId,
  onTogglePanel,
  onSettings,
  onNewChat,
  onSelectConversation,
  onRenameConversation,
  onPinConversation,
  onDeleteConversation,
  onArchiveConversation,
  onSetConversationFolder,
  onSetConversationTags,
  onCreateFolder,
  onDeleteFolder,
  onCreateSavedSearch,
  onDeleteSavedSearch,
  onExportConversations,
  onSearchConversations,
}) => {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ConversationSearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const confirmTimer = useRef<number | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [organizerOpen, setOrganizerOpen] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [folderFilter, setFolderFilter] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [menu, setMenu] = useState<{ id: string; anchor: { top: number; left: number } } | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [exportBusy, setExportBusy] = useState(false);

  const logo = MOOD_LOGOS[mood] ?? MOOD_LOGOS.neutral;
  const ready = status.state === "ready";
  const statusLabel =
    status.state === "ready"
      ? t("status.ready")
      : status.state === "error"
        ? t("status.error")
        : status.state === "loading-model"
          ? t("status.loading-model")
          : t("status.starting");

  useEffect(() => {
    const focus = () => {
      searchRef.current?.focus();
      searchRef.current?.select();
    };
    window.addEventListener("om:focus-search", focus);
    return () => window.removeEventListener("om:focus-search", focus);
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed || showArchive) {
      setHits(null);
      setSearching(false);
      return;
    }

    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(() => {
      void onSearchConversations(trimmed)
        .then((results) => {
          if (cancelled) return;
          setHits(results);
          setSearching(false);
        })
        .catch(() => {
          if (cancelled) return;
          setHits([]);
          setSearching(false);
        });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, onSearchConversations, showArchive]);

  useEffect(
    () => () => {
      if (confirmTimer.current) window.clearTimeout(confirmTimer.current);
    },
    []
  );

  const clearSearch = () => {
    setQuery("");
    setHits(null);
    setSearching(false);
  };

  const askDelete = (id: string) => {
    if (confirmTimer.current) window.clearTimeout(confirmTimer.current);
    setConfirmId(id);
    confirmTimer.current = window.setTimeout(() => setConfirmId(null), 5000);
  };

  const select = (id: string) => {
    onSelectConversation(id);
    clearSearch();
    setEditingId(null);
    setConfirmId(null);
  };

  const commitRename = (id: string, title: string) => {
    onRenameConversation(id, title);
    setEditingId(null);
    clearSearch();
  };

  const confirmDelete = (id: string) => {
    onDeleteConversation(id);
    setConfirmId(null);
    clearSearch();
    if (editingId === id) setEditingId(null);
  };

  /** The chats the list holds right now: the archive while it is open, the rest otherwise. */
  const listed = showArchive ? archivedConversations : conversations;

  const matchesFilters = (conversation: Conversation) => {
    if (folderFilter && conversation.folderId !== folderFilter) return false;
    if (tagFilter && !(conversation.tags ?? []).includes(tagFilter)) return false;
    return true;
  };

  const filtered = listed.filter(matchesFilters);

  const results = useMemo(() => {
    if (showArchive) {
      const needle = query.trim().toLowerCase();
      const matched = needle
        ? filtered.filter(
            (conversation) =>
              conversation.title.toLowerCase().includes(needle) ||
              conversation.preview.toLowerCase().includes(needle)
          )
        : filtered;
      return matched.map((conversation) => ({ conversation, snippet: conversation.preview }));
    }
    if (hits) return hits.filter((hit) => matchesFilters(hit.conversation));
    return filtered.map((conversation) => ({ conversation, snippet: conversation.preview }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, hits, query, showArchive]);

  const toggleSelect = (id: string) => {
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
  };

  const stopSelecting = () => {
    setSelecting(false);
    setSelected([]);
    setExportOpen(false);
    setPassphrase("");
  };

  const runExport = async () => {
    const chosen = [...selected];
    if (!chosen.length || passphrase.trim().length < PASSPHRASE_MIN) return;
    setExportBusy(true);
    try {
      const result = await onExportConversations(chosen, passphrase.trim());
      if (result.ok) {
        toast(
          t("org.exported", {
            count: formatNumber(result.conversations ?? chosen.length),
            file: result.fileName ?? "",
          }),
          "ok"
        );
        stopSelecting();
      } else if (!result.cancelled) {
        toast(result.error ?? t("org.exportFailed"), "error");
      }
    } finally {
      setExportBusy(false);
    }
  };

  const onListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLInputElement) return;
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const rows = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-session-row]")
    );
    if (!rows.length) return;
    const index = rows.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex =
      event.key === "ArrowDown"
        ? Math.min(Math.max(index, -1) + 1, rows.length - 1)
        : Math.max((index < 0 ? rows.length : index) - 1, 0);
    rows[nextIndex]?.focus();
    event.preventDefault();
  };

  const menuConversation = menu ? listed.find((item) => item.id === menu.id) : undefined;
  const folderName = folderFilter ? folders.find((folder) => folder.id === folderFilter)?.name : null;

  return (
    <aside className="drag-region w-[264px] shrink-0 bg-sidebar border-e border-line flex flex-col">
      <div className="pt-9 px-3">
        <button
          onClick={onSettings}
          className="no-drag flex items-center gap-2.5 w-full rounded-lg px-2 py-1.5 hover:bg-ink/5 transition-colors"
          title="OpenMonkey settings"
        >
          <img
            key={mood}
            src={logoUrl(logo.file)}
            alt=""
            className="w-7 h-7 rounded-full logo-mood-change"
            style={{ boxShadow: `0 0 0 2px var(--color-card), 0 0 0 3px ${logo.color}66` }}
          />
          <span className="text-[13px] font-semibold tracking-tight truncate">{agentName}</span>
          <ChevronDown size={14} className="ms-auto text-faint" />
        </button>
      </div>

      <nav className="px-2 mt-3 space-y-0.5 no-drag">
        <button onClick={clearSearch} className="nav-item nav-item-active">
          <House size={15} />
          {t("nav.home")}
        </button>
        <button onClick={onTogglePanel} className="nav-item">
          <Activity size={15} />
          {t("nav.activity")}
          <span className="ms-auto text-[10px] text-faint">
            {panelOpen ? t("nav.panelOn") : t("nav.panelOff")}
          </span>
        </button>
        <button onClick={onSettings} className="nav-item">
          <Settings2 size={15} />
          {t("nav.settings")}
        </button>
      </nav>

      <div className="flex items-center justify-between px-4 mt-5 mb-2">
        <p className="section-label !mb-0">
          {showArchive ? t("org.archive") : t("nav.sessions")}
          {listed.length > 0 && <span className="ms-1.5 text-faint/80">{listed.length}</span>}
        </p>
        <button onClick={onNewChat} className="icon-btn !w-6 !h-6" title={t("nav.newChat")}>
          <Plus size={14} />
        </button>
      </div>

      <div className="px-3 mb-2 no-drag">
        <div className="relative">
          <Search size={13} className="absolute start-2.5 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                clearSearch();
              }
            }}
            placeholder={t("nav.searchChats")}
            aria-label={t("nav.searchChats")}
            className="field w-full !h-8 !ps-8 !pe-8 !text-[11.5px]"
          />
          {searching ? (
            <Loader
              size={12}
              className="absolute end-2.5 top-1/2 -translate-y-1/2 text-faint animate-spin"
            />
          ) : (
            query && (
              <button
                onClick={clearSearch}
                className="icon-btn !w-5 !h-5 absolute end-1.5 top-1/2 -translate-y-1/2"
                title="Clear search"
              >
                <X size={11} />
              </button>
            )
          )}
        </div>
      </div>

      <div className="px-3 mb-2 no-drag flex items-center gap-1">
        <button
          onClick={() => setOrganizerOpen((open) => !open)}
          className={`chip !h-6 ${organizerOpen ? "chip-accent" : ""}`}
          title={t("org.organizeTitle")}
          aria-pressed={organizerOpen}
        >
          <FolderTree size={10} />
          {t("org.organize")}
        </button>
        <button
          onClick={() => {
            setShowArchive((open) => !open);
            clearSearch();
          }}
          className={`chip !h-6 ${showArchive ? "chip-accent" : ""}`}
          title={showArchive ? t("org.hideArchive") : t("org.showArchive")}
          aria-pressed={showArchive}
        >
          <Archive size={10} />
          {t("org.archive")}
        </button>
        <button
          onClick={() => (selecting ? stopSelecting() : setSelecting(true))}
          className={`chip !h-6 ${selecting ? "chip-accent" : ""}`}
          title={selecting ? t("org.stopSelecting") : t("org.select")}
          aria-pressed={selecting}
        >
          <CheckSquare size={10} />
          {t("org.select")}
        </button>
      </div>

      {(folderFilter || tagFilter) && (
        <div className="px-3 mb-2 no-drag flex flex-wrap items-center gap-1">
          {folderFilter && (
            <button
              onClick={() => setFolderFilter(null)}
              className="chip chip-accent !h-6"
              title={t("org.filterFolder", { name: folderName ?? "" })}
            >
              {t("org.filterFolder", { name: folderName ?? "" })}
              <X size={9} />
            </button>
          )}
          {tagFilter && (
            <button
              onClick={() => setTagFilter(null)}
              className="chip chip-accent !h-6"
              title={t("org.filterTag", { name: tagFilter })}
            >
              {t("org.filterTag", { name: tagFilter })}
              <X size={9} />
            </button>
          )}
        </div>
      )}

      {organizerOpen && (
        <div className="max-h-[45vh] overflow-y-auto no-drag">
          <OrganizerPanel
            folders={folders}
            tags={tags}
            savedSearches={savedSearches}
            folderFilter={folderFilter}
            tagFilter={tagFilter}
            query={query}
            onToggleFolder={(id) => setFolderFilter((current) => (current === id ? null : id))}
            onToggleTag={(tag) => setTagFilter((current) => (current === tag ? null : tag))}
            onCreateFolder={(name) => onCreateFolder(name)}
            onDeleteFolder={(id) => onDeleteFolder(id)}
            onRunSavedSearch={(search) => {
              setQuery(search.query);
              setShowArchive(false);
            }}
            onDeleteSavedSearch={(id) => onDeleteSavedSearch(id)}
            onSaveSearch={(name) => onCreateSavedSearch(name, query.trim())}
          />
        </div>
      )}

      {selecting && (
        <div className="px-3 mb-2 no-drag">
          {exportOpen ? (
            <div className="card px-2.5 py-2.5 flex flex-col gap-2">
              <p className="text-[10.5px] text-muted leading-relaxed">{t("org.exportCopy")}</p>
              <input
                type="password"
                value={passphrase}
                onChange={(event) => setPassphrase(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void runExport();
                  }
                }}
                className="field w-full !h-7 !text-[11.5px]"
                aria-label={t("org.exportPassphrase")}
                placeholder={t("org.exportPassphrase")}
              />
              <p className="text-[9.5px] text-faint">{t("org.exportShort")}</p>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => void runExport()}
                  disabled={exportBusy || passphrase.trim().length < PASSPHRASE_MIN}
                  className="btn btn-primary !h-6 !px-2 !text-[10.5px] flex-1"
                >
                  {exportBusy ? <Loader size={10} className="animate-spin" /> : null}
                  {t("org.export")}
                </button>
                <button
                  onClick={() => {
                    setExportOpen(false);
                    setPassphrase("");
                  }}
                  className="icon-btn !w-6 !h-6"
                  title={t("org.clearSelection")}
                >
                  <X size={12} />
                </button>
              </div>
            </div>
          ) : (
            <div className="card px-2.5 py-2 flex items-center gap-1.5">
              <span className="text-[10.5px] text-muted flex-1">
                {t("org.selected", { count: formatNumber(selected.length) })}
              </span>
              <button
                onClick={() => setExportOpen(true)}
                disabled={!selected.length}
                className="btn !h-6 !px-2 !text-[10.5px]"
              >
                {t("org.export")}
              </button>
              <button
                onClick={stopSelecting}
                className="icon-btn !w-5 !h-5"
                title={t("org.clearSelection")}
              >
                <X size={10} />
              </button>
            </div>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2 no-drag" onKeyDown={onListKeyDown}>
        {results.map(({ conversation, snippet }) => (
          <SessionRow
            key={conversation.id}
            conversation={conversation}
            snippet={snippet}
            active={conversation.id === activeConversationId}
            busy={conversation.id === busyConversationId}
            editing={editingId === conversation.id}
            confirming={confirmId === conversation.id}
            selecting={selecting}
            selected={selected.includes(conversation.id)}
            onSelect={() => select(conversation.id)}
            onToggleSelect={() => toggleSelect(conversation.id)}
            onCommitRename={(title) => commitRename(conversation.id, title)}
            onCancelRename={() => setEditingId(null)}
            onTogglePin={() => onPinConversation(conversation.id, !conversation.pinned)}
            onConfirmDelete={() => confirmDelete(conversation.id)}
            onCancelDelete={() => setConfirmId(null)}
            onOpenMenu={(anchor) => setMenu({ id: conversation.id, anchor })}
          />
        ))}

        {!results.length && !hits && showArchive && (
          <p className="px-2 py-3 text-[10.5px] text-faint leading-relaxed">
            {t("org.emptyArchive")}
          </p>
        )}

        {!results.length && !hits && !showArchive && !folderFilter && !tagFilter && (
          <p className="px-2 py-3 text-[10.5px] text-faint leading-relaxed">
            {t("nav.noChats")}
          </p>
        )}

        {!results.length && !hits && !showArchive && (folderFilter || tagFilter) && (
          <p className="px-2 py-3 text-[10.5px] text-faint leading-relaxed">
            {folderFilter ? t("org.emptyFolder") : t("org.emptyTag")}
          </p>
        )}

        {hits && !searching && hits.length === 0 && (
          <p className="px-2 py-3 text-[10.5px] text-faint leading-relaxed">
            {t("nav.noMatch", { query: query.trim() })}
          </p>
        )}
      </div>

      <div className="p-3 no-drag">
        <div className="card px-3.5 py-3">
          <div className="flex items-center gap-2">
            <ShieldCheck size={14} className="text-accent-ink" />
            <span className="text-[11.5px] font-semibold">{t("nav.localOnly")}</span>
          </div>
          <p className="text-[10.5px] text-faint leading-relaxed mt-1.5">
            {t("nav.localOnlyCopy")}
          </p>
          <div className="flex items-center gap-1.5 mt-2.5 text-[10.5px] text-muted">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                ready ? "bg-accent" : status.state === "error" ? "bg-danger" : "bg-warn pulse-dot"
              }`}
            />
            <span className="capitalize">{statusLabel}</span>
            <span className="text-faint">·</span>
            <span>{moodLabel(mood)}</span>
          </div>
        </div>
      </div>

      {menu && menuConversation && (
        <ChatMenu
          conversation={menuConversation}
          folders={folders}
          knownTags={tags.map((entry) => entry.tag)}
          anchor={menu.anchor}
          onArchive={(archived) => onArchiveConversation(menuConversation.id, archived)}
          onSetFolder={(folderId) => onSetConversationFolder(menuConversation.id, folderId)}
          onSetTags={(next) => onSetConversationTags(menuConversation.id, next)}
          onRename={() => {
            setConfirmId(null);
            setEditingId(menuConversation.id);
          }}
          onDelete={() => askDelete(menuConversation.id)}
          onClose={() => setMenu(null)}
        />
      )}
    </aside>
  );
};
