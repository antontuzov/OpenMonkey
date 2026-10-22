import { useEffect, useRef, useState } from "react";
import {
  Activity,
  Check,
  ChevronDown,
  House,
  Loader,
  MessageSquare,
  Pencil,
  Pin,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import {
  MOOD_LOGOS,
  type AgentStatus,
  type Conversation,
  type ConversationSearchHit,
  type Mood,
} from "../../utils/types";

interface AppSidebarProps {
  mood: Mood;
  status: AgentStatus;
  agentName: string;
  panelOpen: boolean;
  conversations: Conversation[];
  activeConversationId: string | null;
  busyConversationId: string | null;
  onTogglePanel: () => void;
  onSettings: () => void;
  onNewChat: () => void;
  onSelectConversation: (id: string) => void;
  onRenameConversation: (id: string, title: string) => void;
  onPinConversation: (id: string, pinned: boolean) => void;
  onDeleteConversation: (id: string) => void;
  onSearchConversations: (query: string) => Promise<ConversationSearchHit[]>;
}

const relativeTime = (value: Date) => {
  const date = new Date(value);
  const diff = Date.now() - date.getTime();
  if (!Number.isFinite(diff) || diff < 60_000) return "now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d`;
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
};

interface SessionRowProps {
  conversation: Conversation;
  snippet: string;
  active: boolean;
  busy: boolean;
  editing: boolean;
  confirming: boolean;
  onSelect: () => void;
  onStartRename: () => void;
  onCommitRename: (title: string) => void;
  onCancelRename: () => void;
  onTogglePin: () => void;
  onAskDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}

const SessionRow: React.FC<SessionRowProps> = ({
  conversation,
  snippet,
  active,
  busy,
  editing,
  confirming,
  onSelect,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onTogglePin,
  onAskDelete,
  onConfirmDelete,
  onCancelDelete,
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
            onClick={onSelect}
            aria-current={active ? "true" : undefined}
            className="flex-1 min-w-0 text-left px-2 py-1.5 rounded-[9px]"
          >
            <span className="flex items-center gap-2 min-w-0">
              {busy ? (
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
              className={`block pl-[21px] text-[10px] truncate ${busy ? "text-accent-ink" : "text-faint"}`}
            >
              {busy ? "Answering…" : snippet || (conversation.messageCount ? `${conversation.messageCount} messages` : "Empty chat")}
            </span>
          </button>

          <div className="relative shrink-0 w-[62px] self-stretch flex items-center justify-end pr-2">
            <span className="text-[9.5px] text-faint tabular-nums group-hover:opacity-0 transition-opacity">
              {relativeTime(conversation.updatedAt)}
            </span>
            <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto">
              <button
                onClick={onTogglePin}
                className={`icon-btn !w-[18px] !h-[18px] ${conversation.pinned ? "text-accent-ink" : ""}`}
                title={conversation.pinned ? "Unpin chat" : "Pin chat"}
              >
                <Pin size={11} />
              </button>
              <button onClick={onStartRename} className="icon-btn !w-[18px] !h-[18px]" title="Rename chat">
                <Pencil size={11} />
              </button>
              <button onClick={onAskDelete} className="icon-btn !w-[18px] !h-[18px]" title="Delete chat">
                <Trash2 size={11} />
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
  activeConversationId,
  busyConversationId,
  onTogglePanel,
  onSettings,
  onNewChat,
  onSelectConversation,
  onRenameConversation,
  onPinConversation,
  onDeleteConversation,
  onSearchConversations,
}) => {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ConversationSearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const confirmTimer = useRef<number | null>(null);

  const logo = MOOD_LOGOS[mood] ?? MOOD_LOGOS.neutral;
  const ready = status.state === "ready";

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
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
  }, [query, onSearchConversations]);

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

  const results = hits ?? conversations.map((conversation) => ({ conversation, snippet: conversation.preview }));

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

  return (
    <aside className="drag-region w-[264px] shrink-0 bg-card-2 border-r border-line flex flex-col">
      <div className="pt-9 px-3">
        <button
          onClick={onSettings}
          className="no-drag flex items-center gap-2.5 w-full rounded-lg px-2 py-1.5 hover:bg-ink/5 transition-colors"
          title="OpenMonkey settings"
        >
          <img
            src={`/logos/${logo.file}`}
            alt=""
            className="w-7 h-7 rounded-full logo-mood-change"
            style={{ boxShadow: `0 0 0 2px var(--color-card), 0 0 0 3px ${logo.color}66` }}
          />
          <span className="text-[13px] font-semibold tracking-tight truncate">{agentName}</span>
          <ChevronDown size={14} className="ml-auto text-faint" />
        </button>
      </div>

      <nav className="px-2 mt-3 space-y-0.5 no-drag">
        <button onClick={clearSearch} className="nav-item nav-item-active">
          <House size={15} />
          Home
        </button>
        <button onClick={onTogglePanel} className="nav-item">
          <Activity size={15} />
          Activity
          <span className="ml-auto text-[10px] text-faint">{panelOpen ? "on" : "off"}</span>
        </button>
        <button onClick={onSettings} className="nav-item">
          <Settings2 size={15} />
          Settings
        </button>
      </nav>

      <div className="flex items-center justify-between px-4 mt-5 mb-2">
        <p className="section-label !mb-0">
          Sessions
          {conversations.length > 0 && <span className="ml-1.5 text-faint/80">{conversations.length}</span>}
        </p>
        <button onClick={onNewChat} className="icon-btn !w-6 !h-6" title="New conversation">
          <Plus size={14} />
        </button>
      </div>

      <div className="px-3 mb-2 no-drag">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                clearSearch();
              }
            }}
            placeholder="Search chats"
            aria-label="Search conversations"
            className="field w-full !h-8 !pl-8 !pr-8 !text-[11.5px]"
          />
          {searching ? (
            <Loader
              size={12}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-faint animate-spin"
            />
          ) : (
            query && (
              <button
                onClick={clearSearch}
                className="icon-btn !w-5 !h-5 absolute right-1.5 top-1/2 -translate-y-1/2"
                title="Clear search"
              >
                <X size={11} />
              </button>
            )
          )}
        </div>
      </div>

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
            onSelect={() => select(conversation.id)}
            onStartRename={() => {
              setConfirmId(null);
              setEditingId(conversation.id);
            }}
            onCommitRename={(title) => commitRename(conversation.id, title)}
            onCancelRename={() => setEditingId(null)}
            onTogglePin={() => onPinConversation(conversation.id, !conversation.pinned)}
            onAskDelete={() => askDelete(conversation.id)}
            onConfirmDelete={() => confirmDelete(conversation.id)}
            onCancelDelete={() => setConfirmId(null)}
          />
        ))}

        {!conversations.length && !hits && (
          <p className="px-2 py-3 text-[10.5px] text-faint leading-relaxed">
            No chats yet. Start a new one and it will stay on this Mac.
          </p>
        )}

        {hits && !searching && hits.length === 0 && (
          <p className="px-2 py-3 text-[10.5px] text-faint leading-relaxed">
            No chats match “{query.trim()}”. Titles and message text are both searched.
          </p>
        )}
      </div>

      <div className="p-3 no-drag">
        <div className="card px-3.5 py-3">
          <div className="flex items-center gap-2">
            <ShieldCheck size={14} className="text-accent-ink" />
            <span className="text-[11.5px] font-semibold">Local only</span>
          </div>
          <p className="text-[10.5px] text-faint leading-relaxed mt-1.5">
            The model, chat history and tools all run on this Mac.
          </p>
          <div className="flex items-center gap-1.5 mt-2.5 text-[10.5px] text-muted">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                ready ? "bg-accent" : status.state === "error" ? "bg-danger" : "bg-warn pulse-dot"
              }`}
            />
            <span className="capitalize">{status.state.replace("-", " ")}</span>
            <span className="text-faint">·</span>
            <span>{logo.label}</span>
          </div>
        </div>
      </div>
    </aside>
  );
};
