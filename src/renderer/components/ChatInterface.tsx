import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Copy,
  FileText,
  FolderSearch,
  GitBranch,
  Image as ImageIcon,
  Lightbulb,
  Loader,
  Paperclip,
  Pencil,
  Plus,
  Quote,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Square,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  MOOD_LOGOS,
  type AgentStatus,
  type Attachment,
  type ChatErrorCode,
  type FileCandidate,
  type Message,
  type Mood,
} from "../../utils/types";
import { MessageContent } from "./MessageContent";
import { moodLabel, t } from "../i18n";
import { logoUrl } from "../assets";
import { toast } from "./Toast";
import { useVirtualMessages } from "../use-virtual-messages";

interface ChatInterfaceProps {
  status: AgentStatus;
  mood: Mood;
  agentName: string;
  autoExecute: boolean;
  sendKey: "enter" | "cmd-enter";
  conversationId: string | null;
  busyConversationId: string | null;
  starterPromptsHidden: boolean;
  onConversationsChanged: () => void;
  onOpenSettings: () => void;
  onNewConversation: () => void;
  onHideStarterPrompts: () => void;
  onShowStarterPrompts: () => void;
}

const STARTERS = [
  { icon: FolderSearch, key: "folder" },
  { icon: ClipboardList, key: "clipboard" },
  { icon: Lightbulb, key: "code" },
  { icon: CalendarDays, key: "day" },
] as const;

const MAX_ATTACHMENT_LABEL = "256 KB";
const MAX_ATTACHMENT_BYTES = 256 * 1024;
const MAX_ATTACHMENTS = 8;
const ATTACHABLE_FILE = /\.(txt|md|markdown|json|csv|tsv|log|yaml|yml|toml|xml|html|css|js|jsx|ts|tsx|py|rb|go|rs|swift|sh|sql|c|h|cpp|java|env|ini|conf|png|jpg|jpeg|gif|webp|bmp|svg)$/i;
const IMAGE_FILE = /\.(png|jpg|jpeg|gif|webp|bmp|svg)$/i;
/** The commands the composer answers itself, without troubling the model. */
const SLASH_COMMANDS = [
  { command: "/clear", label: "chat.command.clear" },
  { command: "/summarize", label: "chat.command.summarize" },
  { command: "/help", label: "chat.command.help" },
] as const;
const SLASH_NAMES = SLASH_COMMANDS.map((entry) => entry.command);

const FAILURE_COPY: Record<ChatErrorCode, { title: string; body: string }> = {
  "not-ready": {
    title: "The local model isn't ready",
    body: "OpenMonkey couldn't start a reply. Check the model in Settings, then send again.",
  },
  "context-overflow": {
    title: "This chat is too long",
    body: "The model ran out of context for this session. Start a new chat to keep the older history available.",
  },
  offline: {
    title: "The model stopped responding",
    body: "The local model server dropped the connection. Retry the question, or check the model settings.",
  },
  unknown: {
    title: "That reply didn't finish",
    body: "OpenMonkey hit an error while answering. The question is saved, so you can retry it.",
  },
};

type FailureOrigin = "send" | "stream";

interface ChatFailure {
  code: ChatErrorCode;
  text: string;
  origin: FailureOrigin;
}

const timeOf = (date: Date) =>
  new Date(date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const sizeOf = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} KB`;

const draftKey = (conversationId: string) => `openmonkey.draft.${conversationId}`;

const classifyError = (message: string): ChatErrorCode => {
  if (/context|too many tokens|sequence length|n_ctx/i.test(message)) return "context-overflow";
  if (/fetch|ECONNREFUSED|server|unreachable|HTTP \d/i.test(message)) return "offline";
  if (/not loaded|loading its model|no local model|not ready|still loading|has not finished/i.test(message)) {
    return "not-ready";
  }
  return "unknown";
};

function replaceMessage(messages: Message[], next: Message): Message[] {
  const index = messages.findIndex((message) => message.id === next.id);
  if (index < 0) return [...messages, next];
  const copy = [...messages];
  copy[index] = next;
  return copy;
}

const ChatMessage: React.FC<{
  message: Message;
  logoFile: string;
  canEdit: boolean;
  canRegenerate: boolean;
  busy: boolean;
  /** Only the newest message fades in; history that is mounted again must not. */
  animate?: boolean;
  onRegenerate: () => void;
  onEdit: (text: string) => void;
  onQuote: () => void;
  onBranch: () => void;
  onVariant: (from: Message, next: Message) => void;
  regenerating: boolean;
}> = ({
  message,
  logoFile,
  canEdit,
  canRegenerate,
  busy,
  animate = false,
  onRegenerate,
  onEdit,
  onQuote,
  onBranch,
  onVariant,
  regenerating,
}) => {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const [variants, setVariants] = useState<Message[] | null>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const isUser = message.role === "user";
  const duration = message.metadata?.durationMs;
  const tokens = message.metadata?.tokens;
  const variantCount = message.metadata?.variantCount ?? 1;

  useEffect(() => {
    // Only an answer that was regenerated has siblings worth fetching.
    if (isUser || variantCount < 2) return;
    let cancelled = false;
    void window.electron
      ?.listVariants(message.id)
      .then((group) => {
        if (!cancelled) setVariants(group);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [isUser, message.id, variantCount]);

  const group = variants && variants.length > 1 ? variants : null;
  const position = group ? group.findIndex((item) => item.id === message.id) : -1;

  useEffect(() => {
    if (!editing) return;
    const element = editRef.current;
    if (!element) return;
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
  }, [editing]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      toast(t("chat.copied"));
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  };

  const save = () => {
    const text = draft.trim();
    setEditing(false);
    if (!text || text === message.content) {
      setDraft(message.content);
      return;
    }
    onEdit(text);
  };

  const step = (delta: number) => {
    if (!group || position < 0) return;
    const next = group[position + delta];
    if (next) onVariant(message, next);
  };

  return (
    <div
      className={`${animate ? "message-enter" : ""} flex items-end gap-2.5 ${isUser ? "justify-end" : "justify-start"}`}
    >
      {!isUser && (
        <img src={logoUrl(logoFile)} alt="" className="w-[26px] h-[26px] rounded-full mb-5 shrink-0" />
      )}
      <div className={`group/message flex flex-col ${isUser ? "items-end" : "items-start"} max-w-[78%]`}>
        {editing ? (
          <div className="message-user px-4 py-2.5 w-full">
            <textarea
              ref={editRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setDraft(message.content);
                  setEditing(false);
                }
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  save();
                }
              }}
              className="w-full min-h-[72px] bg-transparent text-[13px] leading-relaxed outline-none resize-y"
              aria-label={t("chat.edit")}
            />
            <p className="text-faint text-[10px] leading-snug mt-1">{t("chat.editHint")}</p>
            <div className="flex items-center justify-end gap-1.5 mt-2">
              <button
                onClick={() => {
                  setDraft(message.content);
                  setEditing(false);
                }}
                className="btn"
                disabled={busy}
              >
                {t("chat.editCancel")}
              </button>
              <button onClick={save} className="btn btn-primary" disabled={busy || !draft.trim()}>
                <Check size={11} />
                {t("chat.editSave")}
              </button>
            </div>
          </div>
        ) : (
          <div className={`${isUser ? "message-user" : "message-assistant"} px-4 py-2.5 w-full`}>
            <MessageContent message={message} />
          </div>
        )}
        <div className="flex items-center gap-1.5 mt-1.5 px-0.5 text-[10px] text-faint">
          <span>{timeOf(message.timestamp)}</span>
          {!isUser && duration != null && (
            <>
              <span>·</span>
              <span>{Math.max(0.1, duration / 1000).toFixed(1)}s</span>
            </>
          )}
          {!isUser && tokens != null && (
            <>
              <span>·</span>
              <span>{t("chat.tokens", { count: tokens })}</span>
            </>
          )}
          {message.metadata?.stopped && (
            <>
              <span>·</span>
              <span className="inline-flex items-center gap-1 text-warn">
                <Square size={8} />
                {t("chat.stopped")}
              </span>
            </>
          )}
          {group && position >= 0 && (
            <span className="inline-flex items-center gap-0.5 ml-0.5">
              <button
                onClick={() => step(-1)}
                disabled={position === 0 || busy}
                className="icon-btn !w-5 !h-5 disabled:opacity-30"
                title={t("chat.variantPrevious")}
                aria-label={t("chat.variantPrevious")}
              >
                <ChevronLeft size={11} />
              </button>
              <span className="tabular-nums" title={t("chat.variant", { index: position + 1, count: group.length })}>
                {position + 1}/{group.length}
              </span>
              <button
                onClick={() => step(1)}
                disabled={position >= group.length - 1 || busy}
                className="icon-btn !w-5 !h-5 disabled:opacity-30"
                title={t("chat.variantNext")}
                aria-label={t("chat.variantNext")}
              >
                <ChevronRight size={11} />
              </button>
            </span>
          )}
          <span
            className={`flex items-center gap-0.5 transition-opacity ${
              copied ? "opacity-100" : "opacity-0 group-hover/message:opacity-100 group-focus-within/message:opacity-100"
            }`}
          >
            <button onClick={() => void copy()} className="icon-btn !w-5 !h-5" title={t("chat.copy")} aria-label={t("chat.copy")}>
              {copied ? <Check size={11} className="text-accent-ink" /> : <Copy size={11} />}
            </button>
            {isUser && canEdit && (
              <button
                onClick={() => setEditing(true)}
                className="icon-btn !w-5 !h-5"
                title={t("chat.edit")}
                aria-label={t("chat.edit")}
              >
                <Pencil size={11} />
              </button>
            )}
            {!isUser && (
              <button
                onClick={onQuote}
                className="icon-btn !w-5 !h-5"
                title={t("chat.quote")}
                aria-label={t("chat.quote")}
              >
                <Quote size={11} />
              </button>
            )}
            <button
              onClick={onBranch}
              disabled={busy}
              className="icon-btn !w-5 !h-5"
              title={t("chat.branch")}
              aria-label={t("chat.branch")}
            >
              <GitBranch size={11} />
            </button>
            {!isUser && canRegenerate && (
              <button
                onClick={onRegenerate}
                disabled={regenerating}
                className="icon-btn !w-5 !h-5"
                title={t("chat.regenerate")}
                aria-label={t("chat.regenerate")}
              >
                {regenerating ? <Loader size={11} className="animate-spin" /> : <RotateCcw size={11} />}
              </button>
            )}
          </span>
        </div>
      </div>
    </div>
  );
};

const StreamingMessage: React.FC<{ content: string; logoFile: string }> = ({ content, logoFile }) => (
  <div className="message-enter flex items-end gap-2.5 justify-start">
    <img src={logoUrl(logoFile)} alt="" className="w-[26px] h-[26px] rounded-full mb-5 shrink-0" />
    <div className="flex flex-col items-start max-w-[78%]">
      <div className="message-assistant px-4 py-2.5">
        <MessageContent
          incremental
          message={{ id: "stream", role: "assistant", content, timestamp: new Date() }}
        />
        {content.length > 0 && (
          <span className="inline-block w-[6px] h-[13px] ml-0.5 align-[-2px] rounded-[1px] bg-accent animate-pulse" />
        )}
      </div>
      <p className="text-[10px] text-faint mt-1.5 px-0.5">{t("chat.writing")}</p>
    </div>
  </div>
);

const FailureCard: React.FC<{
  failure: ChatFailure;
  canRetry: boolean;
  onRetry: () => void;
  onNewChat: () => void;
  onSettings: () => void;
  onDismiss: () => void;
}> = ({ failure, canRetry, onRetry, onNewChat, onSettings, onDismiss }) => {
  const copy =
    failure.origin === "send" && failure.code === "unknown"
      ? {
          title: "That message wasn't sent",
          body: "OpenMonkey couldn't hand it to this chat, which may have been removed. Your draft is still in the composer.",
        }
      : FAILURE_COPY[failure.code];
  return (
    <div className="card border-danger/30 p-4 message-enter">
      <div className="flex items-start gap-3">
        <span
          className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
          style={{ background: "color-mix(in srgb, var(--color-danger) 12%, transparent)" }}
        >
          <TriangleAlert size={14} className="text-danger" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[12.5px] font-semibold">{copy.title}</p>
          <p className="text-muted text-[11px] leading-relaxed mt-0.5">{copy.body}</p>
          <p className="text-faint text-[10px] leading-relaxed mt-1.5 break-words">{failure.text}</p>
          <div className="flex flex-wrap items-center gap-2 mt-3">
            {failure.code === "context-overflow" ? (
              <button onClick={onNewChat} className="btn btn-primary btn-lg">
                Start a new chat
              </button>
            ) : canRetry ? (
              <button onClick={onRetry} className="btn btn-primary btn-lg">
                <RefreshCw size={12} />
                Retry
              </button>
            ) : null}
            {failure.code === "not-ready" || failure.code === "offline" ? (
              <button onClick={onSettings} className="btn btn-lg">
                Model settings
              </button>
            ) : null}
          </div>
        </div>
        <button onClick={onDismiss} className="icon-btn shrink-0" title="Dismiss">
          <X size={13} />
        </button>
      </div>
    </div>
  );
};

const ModelErrorCard: React.FC<{
  message?: string;
  onSettings: () => void;
  onRetry: () => void;
}> = ({ message, onSettings, onRetry }) => (
  <div className="card max-w-lg mx-auto mt-4 p-6">
    <div className="flex items-center gap-2.5 mb-2">
      <TriangleAlert size={16} className="text-danger" />
      <p className="text-danger text-[13px] font-semibold">No local model loaded</p>
    </div>
    <p className="text-muted text-[11.5px] mb-4 leading-relaxed">
      {message || "The model weights could not be found or loaded."}
    </p>
    <div className="flex flex-wrap gap-2">
      <button onClick={onSettings} className="btn btn-primary">
        Open model settings
      </button>
      <button onClick={onRetry} className="btn">
        <RefreshCw size={12} />
        Try again
      </button>
    </div>
  </div>
);

const MessageSkeleton: React.FC = () => (
  <div className="pt-4 space-y-6" aria-hidden="true">
    <div className="flex justify-end">
      <div className="h-11 w-[42%] rounded-2xl bg-card-2 animate-pulse" />
    </div>
    <div className="flex gap-2.5">
      <div className="w-[26px] h-[26px] rounded-full bg-card-2 animate-pulse shrink-0" />
      <div className="card flex-1 max-w-[78%] p-4 space-y-2.5">
        <div className="h-3 w-[88%] rounded bg-card-2 animate-pulse" />
        <div className="h-3 w-[72%] rounded bg-card-2 animate-pulse" />
        <div className="h-3 w-[48%] rounded bg-card-2 animate-pulse" />
      </div>
    </div>
    <div className="flex justify-end">
      <div className="h-9 w-[30%] rounded-2xl bg-card-2 animate-pulse" />
    </div>
  </div>
);

const LoadingCard: React.FC<{ title: string; copy: string }> = ({ title, copy }) => {
  // A model load has no percentage to report; a visible clock proves the process
  // is alive instead of leaving the spinner as the only signal.
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="min-h-[46vh] flex items-center justify-center">
      <div className="card px-7 py-6 text-center max-w-sm">
        <Loader size={18} className="animate-spin text-accent-ink mx-auto mb-3" />
        <p className="text-[13px] font-semibold mb-1">{title}</p>
        <p className="text-muted text-[11px] leading-relaxed">{copy}</p>
        {seconds > 0 && (
          <p className="text-faint text-[10px] mt-2 tabular-nums">
            {seconds}
            {"s"}
          </p>
        )}
      </div>
    </div>
  );
};

export const ChatInterface: React.FC<ChatInterfaceProps> = ({
  status,
  mood,
  agentName,
  autoExecute,
  sendKey,
  conversationId,
  busyConversationId,
  starterPromptsHidden,
  onConversationsChanged,
  onOpenSettings,
  onNewConversation,
  onHideStarterPrompts,
  onShowStarterPrompts,
}) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [stream, setStream] = useState<{ id: string; content: string } | null>(null);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attaching, setAttaching] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [failure, setFailure] = useState<ChatFailure | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadingMessages, setLoadingMessages] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [dropOnComposer, setDropOnComposer] = useState(false);
  const [mentions, setMentions] = useState<FileCandidate[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dragDepth = useRef(0);
  const pendingTokens = useRef("");
  const tokenFrame = useRef(0);
  const mentionRequest = useRef(0);

  // A long chat mounts only the messages near the reader; the rest are the space
  // they would take.
  const virtual = useVirtualMessages(messages, scrollRef, conversationId);

  // Tokens arrive faster than the display refreshes; batching them per frame
  // renders a long reply at screen rate instead of once per token.
  const cancelTokenFlush = () => {
    if (tokenFrame.current) cancelAnimationFrame(tokenFrame.current);
    tokenFrame.current = 0;
    pendingTokens.current = "";
  };

  useEffect(() => {
    const focus = () => textareaRef.current?.focus();
    window.addEventListener("om:focus-composer", focus);
    return () => window.removeEventListener("om:focus-composer", focus);
  }, []);

  const ready = status.state === "ready";
  const logo = MOOD_LOGOS[mood] ?? MOOD_LOGOS.neutral;
  const providerLabel =
    status.provider === "mlx" ? "MLX" : status.provider === "bonsai" ? "Bonsai 4B" : "No model";
  const busy = isSending || Boolean(stream) || (busyConversationId != null && busyConversationId === conversationId);
  /** The model answers one chat at a time, so another tab can hold the slot. */
  const busyElsewhere = busyConversationId != null && busyConversationId !== conversationId;

  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      setLoadingMessages(false);
      return;
    }

    let cancelled = false;
    setMessages([]);
    setStream(null);
    setFailure(null);
    setNotice(null);
    setAttachments([]);
    setMentions([]);
    setIsSending(false);
    setLoadingMessages(true);
    // A chat that is opened shows its newest message, wherever the reader left off.
    virtual.followEnd();
    setInput(sessionStorage.getItem(draftKey(conversationId)) ?? "");

    void window.electron
      ?.getMessages(conversationId)
      .then((stored) => {
        if (cancelled) return;
        setMessages(stored.filter((message) => message.role === "user" || message.role === "assistant"));
        setLoadingMessages(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadingMessages(false);
      });

    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  useEffect(() => {
    const api = window.electron;
    if (!api) return;

    const scheduleFlush = (messageId: string) => {
      if (tokenFrame.current) return;
      tokenFrame.current = requestAnimationFrame(() => {
        tokenFrame.current = 0;
        const chunk = pendingTokens.current;
        pendingTokens.current = "";
        if (!chunk) return;
        setStream((current) =>
          current && current.id === messageId
            ? { ...current, content: current.content + chunk }
            : current
        );
      });
    };

    const unsubscribe = api.onChatEvent((event) => {
      if (!conversationId || event.conversationId !== conversationId) return;

      switch (event.type) {
        case "start":
          cancelTokenFlush();
          setFailure(null);
          setStream({ id: event.message.id, content: "" });
          break;
        case "token":
          pendingTokens.current += event.token;
          scheduleFlush(event.messageId);
          break;
        case "replace":
          cancelTokenFlush();
          setStream((current) =>
            current && current.id === event.messageId ? { ...current, content: event.content } : current
          );
          break;
        case "done":
          cancelTokenFlush();
          setStream(null);
          setMessages((current) => replaceMessage(current, event.message));
          break;
        case "stopped":
          cancelTokenFlush();
          setStream(null);
          if (event.message.content.trim()) {
            setMessages((current) => replaceMessage(current, event.message));
          }
          break;
        case "error": {
          cancelTokenFlush();
          setStream(null);
          const partial = event.message;
          if (partial) setMessages((current) => replaceMessage(current, partial));
          setFailure({ code: event.code, text: event.error, origin: "stream" });
          break;
        }
      }
    });

    return () => {
      cancelTokenFlush();
      unsubscribe();
    };
  }, [conversationId]);

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 180)}px`;
  }, [input]);

  useEffect(() => {
    // preventScroll keeps the empty state's greeting in view: focusing the
    // composer would otherwise scroll the panel down past it.
    if (!loadingMessages && ready) textareaRef.current?.focus({ preventScroll: true });
  }, [conversationId, loadingMessages, ready]);

  const updateInput = (value: string) => {
    setInput(value);
    if (conversationId) sessionStorage.setItem(draftKey(conversationId), value);
  };

  const applyStarter = (key: (typeof STARTERS)[number]["key"]) => {
    updateInput(t(`chat.starter.${key}.prompt`));
    textareaRef.current?.focus({ preventScroll: true });
  };

  /**
   * The commands the composer answers itself: /clear empties the chat, /summarize
   * asks the local model for a digest, /help lists them.
   */
  const runCommand = useCallback(
    async (command: string) => {
      if (!conversationId) return;
      updateInput("");
      sessionStorage.removeItem(draftKey(conversationId));
      setNotice(null);
      if (command === "/help") {
        setNotice(t("chat.commandHelp"));
        return;
      }
      if (command === "/clear") {
        // Clearing empties the model session, so it must not cut another chat's
        // answer short.
        if (busyElsewhere) {
          setNotice(t("chat.busyElsewhere"));
          return;
        }
        try {
          await window.electron?.clearConversation(conversationId);
          setMessages([]);
          toast(t("chat.cleared"));
          onConversationsChanged();
        } catch (caught) {
          setNotice(caught instanceof Error ? caught.message : String(caught));
        }
        return;
      }
      if (command === "/summarize") {
        if (busyElsewhere) {
          setNotice(t("chat.busyElsewhere"));
          return;
        }
        setIsSending(true);
        try {
          const summary = await window.electron?.summarizeConversation(conversationId);
          if (summary) {
            setMessages((current) => [...current, summary]);
            virtual.followEnd();
          }
        } catch (caught) {
          setNotice(caught instanceof Error ? caught.message : String(caught));
        } finally {
          setIsSending(false);
          onConversationsChanged();
        }
      }
    },
    [busyElsewhere, conversationId, onConversationsChanged]
  );

  // The command palette runs the same commands the composer does.
  useEffect(() => {
    const clear = () => void runCommand("/clear");
    const summarize = () => void runCommand("/summarize");
    window.addEventListener("om:clear-chat", clear);
    window.addEventListener("om:summarize-chat", summarize);
    return () => {
      window.removeEventListener("om:clear-chat", clear);
      window.removeEventListener("om:summarize-chat", summarize);
    };
  }, [runCommand]);

  /** Adds files to the composer, refusing the ones it cannot carry. */
  const addAttachments = useCallback((incoming: Attachment[]) => {
    if (!incoming.length) return;
    setAttachments((current) => {
      const merged = [...current];
      for (const file of incoming) {
        if (merged.length >= MAX_ATTACHMENTS) break;
        if (merged.some((item) => item.name === file.name)) continue;
        merged.push(file);
      }
      return merged;
    });
  }, []);

  /** Reads the files the user dropped or pasted, the same way the picker does. */
  const readDroppedFiles = useCallback(
    async (files: File[]) => {
      const accepted: Attachment[] = [];
      let refused = 0;
      for (const file of files) {
        if (accepted.length >= MAX_ATTACHMENTS) break;
        if (!ATTACHABLE_FILE.test(file.name)) {
          refused += 1;
          continue;
        }
        if (file.size > MAX_ATTACHMENT_BYTES) {
          refused += 1;
          continue;
        }
        if (IMAGE_FILE.test(file.name) || file.type.startsWith("image/")) {
          accepted.push({ name: file.name || "pasted-image.png", bytes: file.size, text: "", kind: "image" });
          continue;
        }
        try {
          const text = await file.text();
          if (text.includes("\u0000")) {
            refused += 1;
            continue;
          }
          accepted.push({ name: file.name, bytes: file.size, text, kind: "text" });
        } catch {
          refused += 1;
        }
      }
      if (refused) {
        setNotice(
          t("chat.filesRefused", {
            count: refused,
            size: MAX_ATTACHMENT_LABEL,
          })
        );
      }
      addAttachments(accepted);
    },
    [addAttachments]
  );

  const pickAttachments = async () => {
    if (!ready) return;
    setAttaching(true);
    setNotice(null);
    try {
      const files = await window.electron?.attachFiles();
      if (files?.length) addAttachments(files);
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "That file could not be attached");
    } finally {
      setAttaching(false);
    }
  };

  const send = useCallback(async () => {
    if (!conversationId || !ready || busy) return;
    const text = input.trim();
    const files = attachments;
    if (!text && !files.length) return;

    // A slash command is answered here, so the model is never asked to clear a chat.
    if (!files.length && (SLASH_NAMES as readonly string[]).includes(text)) {
      await runCommand(text);
      return;
    }

    // The model answers one chat at a time: the other tab holds the slot.
    if (busyElsewhere) {
      setNotice(t("chat.busyElsewhere"));
      return;
    }

    const localId = `local_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const userMessage: Message = {
      id: localId,
      role: "user",
      content: text || `Attached ${files.map((file) => file.name).join(", ")}`,
      timestamp: new Date(),
      metadata: files.length
        ? { attachments: files.map((file) => ({ name: file.name, bytes: file.bytes, kind: file.kind ?? "text" })) }
        : undefined,
    };

    virtual.followEnd();
    setMessages((current) => [...current, userMessage]);
    setInput("");
    sessionStorage.removeItem(draftKey(conversationId));
    setAttachments([]);
    setMentions([]);
    setFailure(null);
    setNotice(null);
    setIsSending(true);

    try {
      await window.electron?.processMessage(conversationId, text, files);
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : String(caught);
      setMessages((current) => current.filter((message) => message.id !== localId));
      setInput(text);
      sessionStorage.setItem(draftKey(conversationId), text);
      setAttachments(files);
      setFailure({ code: classifyError(detail), text: detail, origin: "send" });
    } finally {
      setIsSending(false);
      onConversationsChanged();
      textareaRef.current?.focus();
    }
  }, [attachments, busy, busyElsewhere, conversationId, input, onConversationsChanged, ready, runCommand]);

  const regenerate = useCallback(async () => {
    if (!conversationId || !ready || busy) return;
    setFailure(null);
    setNotice(null);
    setMessages((current) =>
      current[current.length - 1]?.role === "assistant" ? current.slice(0, -1) : current
    );
    virtual.followEnd();
    setIsSending(true);

    try {
      await window.electron?.regenerate(conversationId);
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : String(caught);
      setFailure({ code: classifyError(detail), text: detail, origin: "stream" });
    } finally {
      setIsSending(false);
      onConversationsChanged();
    }
  }, [busy, conversationId, onConversationsChanged, ready]);

  /**
   * Rewrite a sent question. The chat drops that turn and everything after it at once,
   * so the answer arriving below replaces the whole tail rather than stacking on it.
   */
  const editAndResend = useCallback(
    async (messageId: string, text: string) => {
      if (!conversationId || !ready || busy) return;
      const index = messages.findIndex((message) => message.id === messageId);
      if (index < 0) return;

      const userMessage: Message = {
        id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        role: "user",
        content: text,
        timestamp: new Date(),
      };
      virtual.followEnd();
      setMessages([...messages.slice(0, index), userMessage]);
      setFailure(null);
      setNotice(null);
      setIsSending(true);

      try {
        await window.electron?.editMessage(conversationId, messageId, text);
      } catch (caught) {
        // The main process refuses before it deletes anything, so its copy of the
        // conversation is the truthful one to fall back to.
        const detail = caught instanceof Error ? caught.message : String(caught);
        const stored = await window.electron?.getMessages(conversationId).catch(() => null);
        if (stored) setMessages(stored.filter((m) => m.role === "user" || m.role === "assistant"));
        setFailure({ code: classifyError(detail), text: detail, origin: "send" });
      } finally {
        setIsSending(false);
        onConversationsChanged();
      }
    },
    [busy, conversationId, messages, onConversationsChanged, ready]
  );

  const showVariant = useCallback(
    async (from: Message, next: Message) => {
      if (!conversationId) return;
      try {
        await window.electron?.selectVariant(conversationId, next.id);
      } catch {
        return;
      }
      setMessages((current) => current.map((message) => (message.id === from.id ? next : message)));
    },
    [conversationId]
  );

  const quote = useCallback(
    (text: string) => {
      const block = text
        .split("\n")
        .map((line) => (line.trim() ? `> ${line}` : line))
        .join("\n");
      updateInput(input.trim() ? `${input.trim()}\n\n${block}\n\n` : `${block}\n\n`);
      textareaRef.current?.focus();
    },
    [input]
  );

  const branch = useCallback(
    async (messageId: string) => {
      if (!conversationId) return;
      const chat = await window.electron
        ?.getConversations()
        .then((list) => list.find((item) => item.id === conversationId)?.title ?? "");
      try {
        await window.electron?.branchConversation(
          conversationId,
          messageId,
          t("chat.branchOf", { title: chat ?? "" })
        );
        toast(t("chat.branched"));
      } catch (caught) {
        const detail = caught instanceof Error ? caught.message : String(caught);
        setNotice(detail);
      }
      onConversationsChanged();
    },
    [conversationId, onConversationsChanged]
  );

  const stop = async () => {
    await window.electron?.stopGeneration();
  };

  const retryModel = () => {
    void window.electron?.reloadModel().catch(() => undefined);
  };

  /** The @word the caret sits in, if any: the file the user is about to mention. */
  const mentionAt = (value: string, caret: number): string | null => {
    const match = /(^|\s)@([^\s@]*)$/.exec(value.slice(0, caret));
    return match ? match[2] : null;
  };

  /** Puts the chosen file into the message and attaches its text. */
  const acceptMention = useCallback(
    async (file: FileCandidate) => {
      const element = textareaRef.current;
      const caret = element?.selectionStart ?? input.length;
      const before = input.slice(0, caret);
      const match = /(^|\s)@([^\s@]*)$/.exec(before);
      if (!match) return;
      const start = caret - match[2].length - 1;
      const next = `${input.slice(0, start)}@${file.name} ${input.slice(caret)}`;
      updateInput(next);
      setMentions([]);
      try {
        const attachment = await window.electron?.readFile(file.path);
        if (attachment) addAttachments([attachment]);
      } catch (caught) {
        setNotice(caught instanceof Error ? caught.message : String(caught));
      }
      textareaRef.current?.focus();
    },
    [addAttachments, input]
  );

  useEffect(() => {
    const query = mentionAt(input, textareaRef.current?.selectionStart ?? input.length);
    if (query == null) {
      setMentions([]);
      return;
    }
    const ticket = ++mentionRequest.current;
    const timer = setTimeout(async () => {
      try {
        const found = await window.electron?.searchFiles(query);
        if (mentionRequest.current !== ticket) return;
        setMentions(found ?? []);
        setMentionIndex(0);
      } catch {
        setMentions([]);
      }
    }, 120);
    return () => clearTimeout(timer);
  }, [input]);

  const onScroll = () => {
    virtual.onScroll();
  };

  const beginNewChat = () => {
    onNewConversation();
    textareaRef.current?.focus();
  };

  const lastAssistantIndex = (() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].role === "assistant") return index;
    }
    return -1;
  })();

  const empty = messages.length === 0 && !stream && !failure;

  return (
    <div
      data-chat-root
      className="relative flex flex-col flex-1 min-h-0"
      onDragEnter={(event) => {
        if (!event.dataTransfer?.types.includes("Files")) return;
        event.preventDefault();
        dragDepth.current += 1;
        setDragging(true);
        setDropOnComposer(Boolean((event.target as HTMLElement).closest?.("[data-composer]")));
      }}
      onDragOver={(event) => {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
        setDropOnComposer(Boolean((event.target as HTMLElement).closest?.("[data-composer]")));
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) {
          setDragging(false);
          setDropOnComposer(false);
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        setDropOnComposer(false);
        if (!ready) return;
        void readDroppedFiles(Array.from(event.dataTransfer?.files ?? []));
      }}
    >
      {dragging && !dropOnComposer && (
        <div className="pointer-events-none absolute inset-3 z-20 rounded-2xl border-2 border-dashed border-accent bg-accent-soft/95 flex flex-col items-center justify-center gap-2">
          <Paperclip size={26} className="text-accent-ink" />
          <p className="text-[13px] font-semibold text-accent-ink">{t("chat.dropTitle")}</p>
          <p className="text-[11px] text-muted">{t("chat.dropCopy", { size: MAX_ATTACHMENT_LABEL })}</p>
        </div>
      )}

      <div
        ref={scrollRef}
        onScroll={onScroll}
        aria-busy={loadingMessages}
        data-chat-scroll="true"
        data-message-count={messages.length}
        data-virtual-start={virtual.window.start}
        data-virtual-end={virtual.window.end}
        data-following={virtual.atBottom ? "true" : "false"}
        data-follow-log={virtual.trace()}
        className="flex-1 overflow-y-auto px-8"
      >
        <span className="sr-only" role="status">
          {loadingMessages ? t("chat.loadingHistory") : ""}
        </span>
        <div className="max-w-[760px] mx-auto py-7">
          {loadingMessages && <MessageSkeleton />}

          {!loadingMessages && !ready && status.state !== "error" && messages.length === 0 && (
            <LoadingCard
              title={status.state === "loading-model" ? "Loading the local model" : "Waking up"}
              copy={
                status.state === "loading-model"
                  ? "Bonsai-4B is being read into memory. It never leaves this Mac."
                  : "OpenMonkey is starting its local model and storage."
              }
            />
          )}

          {!loadingMessages && status.state === "error" && messages.length === 0 && (
            <ModelErrorCard message={status.message} onSettings={onOpenSettings} onRetry={retryModel} />
          )}

          {!loadingMessages && ready && empty && (
            <div className="max-w-[560px] mx-auto pt-8 text-center">
              <img
                key={mood}
                src={logoUrl(logo.file)}
                alt=""
                className="w-[72px] h-[72px] rounded-full mx-auto logo-mood-change"
                style={{ boxShadow: `0 0 0 3px var(--color-paper), 0 0 0 4px ${logo.color}55` }}
              />
              <h1 className="text-[25px] font-semibold tracking-tight mt-5">
                {t("chat.welcome", { name: agentName })}
              </h1>
              <p className="text-muted text-[12px] mt-2 max-w-[46ch] mx-auto leading-relaxed">
                {t("chat.intro")}
              </p>
              <p className="text-faint text-[10.5px] mt-2">{t("chat.moodCaption", { mood: moodLabel(mood) })}</p>

              {!starterPromptsHidden && (
                <div className="mt-8">
                  <div className="flex items-center justify-center gap-2 mb-3">
                    <p className="text-faint text-[10.5px] uppercase tracking-[0.09em]">
                      {t("chat.starterTitle")}
                    </p>
                    <button
                      onClick={onHideStarterPrompts}
                      className="text-[10.5px] text-faint hover:text-muted underline underline-offset-2"
                    >
                      {t("chat.starterHide")}
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5 text-left">
                    {STARTERS.map((starter) => {
                      const Icon = starter.icon;
                      return (
                        <button
                          key={starter.key}
                          onClick={() => applyStarter(starter.key)}
                          className="card px-4 py-3 flex items-start gap-2.5 hover:border-accent-ink/40 transition-colors text-left"
                        >
                          <Icon size={15} className="text-accent-ink mt-0.5 shrink-0" />
                          <span className="text-[12px] font-semibold leading-snug">
                            {t(`chat.starter.${starter.key}.title`)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {starterPromptsHidden && (
                <button
                  onClick={onShowStarterPrompts}
                  className="text-[10.5px] text-faint hover:text-muted underline underline-offset-2 mt-6"
                >
                  {t("chat.starterShow")}
                </button>
              )}

              <p className="text-faint text-[10.5px] mt-7 leading-relaxed">
                {t("chat.warning", { name: agentName })}
              </p>
            </div>
          )}

          <div>
            {virtual.window.padTop > 0 && (
              <div style={{ height: virtual.window.padTop }} aria-hidden="true" data-virtual-pad="top" />
            )}

            <div>
              {messages.slice(virtual.window.start, virtual.window.end).map((message, offset) => {
                const index = virtual.window.start + offset;
                return (
                  <div
                    key={message.id}
                    data-message-id={message.id}
                    ref={virtual.measure(message.id)}
                    className="pb-5"
                  >
                    <ChatMessage
                      message={message}
                      logoFile={logo.file}
                      canEdit={message.role === "user" && ready && !busy}
                      canRegenerate={
                        index === lastAssistantIndex && index === messages.length - 1 && ready && !busy
                      }
                      animate={index === messages.length - 1}
                      busy={busy}
                      onRegenerate={() => void regenerate()}
                      onEdit={(text) => void editAndResend(message.id, text)}
                      onQuote={() => quote(message.content)}
                      onBranch={() => void branch(message.id)}
                      onVariant={(from, next) => void showVariant(from, next)}
                      regenerating={busy && index === lastAssistantIndex}
                    />
                  </div>
                );
              })}

              {stream && (
                <div className="pb-5">
                  <StreamingMessage content={stream.content} logoFile={logo.file} />
                </div>
              )}

              {failure && (
                <div className="pb-5">
                  <FailureCard
                    failure={failure}
                    canRetry={failure.origin === "stream"}
                    onRetry={() => void regenerate()}
                    onNewChat={beginNewChat}
                    onSettings={onOpenSettings}
                    onDismiss={() => setFailure(null)}
                  />
                </div>
              )}

              {!loadingMessages && status.state === "error" && messages.length > 0 && (
                <div className="pb-5">
                  <ModelErrorCard message={status.message} onSettings={onOpenSettings} onRetry={retryModel} />
                </div>
              )}
            </div>

            {virtual.window.padBottom > 0 && (
              <div style={{ height: virtual.window.padBottom }} aria-hidden="true" data-virtual-pad="bottom" />
            )}
          </div>
        </div>
      </div>

      <div className="px-8 pb-6">
        <div className="max-w-[760px] mx-auto">
          {notice && (
            <div className="card flex items-center gap-3 px-4 py-2.5 mb-2.5">
              <TriangleAlert size={15} className="text-warn shrink-0" />
              <p className="text-[11.5px] flex-1 leading-snug text-muted">{notice}</p>
              <button onClick={() => setNotice(null)} className="text-[11px] text-muted hover:text-ink">
                {t("chat.dismiss")}
              </button>
            </div>
          )}

          <div
            data-composer
            className={`card p-2 transition-colors ${
              dragging && dropOnComposer ? "border-accent ring-2 ring-accent/30" : ""
            }`}
          >
            {mentions.length > 0 && (
              <div className="mb-1 rounded-lg border border-line bg-card-2 overflow-hidden">
                {mentions.map((file, index) => (
                  <button
                    key={file.path}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => void acceptMention(file)}
                    className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11.5px] ${
                      index === mentionIndex ? "bg-accent-soft text-accent-ink" : "text-muted hover:bg-card"
                    }`}
                  >
                    <FileText size={12} className="shrink-0" />
                    <span className="truncate text-ink">{file.name}</span>
                    <span className="truncate text-faint">{file.dir}</span>
                    <span className="ml-auto text-faint">{sizeOf(file.bytes)}</span>
                  </button>
                ))}
              </div>
            )}

            {attachments.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 mx-1 mt-1 mb-0.5">
                {attachments.map((file) => (
                  <span
                    key={file.name}
                    className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-card-2 border border-line text-[10.5px] text-muted"
                  >
                    {file.kind === "image" ? <ImageIcon size={12} className="shrink-0" /> : <FileText size={12} className="shrink-0" />}
                    <span className="truncate max-w-[180px] text-ink">{file.name}</span>
                    <span className="text-faint">{sizeOf(file.bytes)}</span>
                    <button
                      onClick={() => setAttachments((current) => current.filter((item) => item.name !== file.name))}
                      className="icon-btn !w-4 !h-4"
                      title={t("chat.removeAttachment")}
                      aria-label={t("chat.removeAttachment")}
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {input.startsWith("/") && (
              <div className="flex flex-wrap items-center gap-1.5 mx-1 mt-1 mb-0.5">
                {SLASH_COMMANDS.map((entry) => (
                  <button
                    key={entry.command}
                    onClick={() => void runCommand(entry.command)}
                    className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-card-2 border border-line text-[10.5px] text-muted hover:text-ink"
                  >
                    <span className="text-ink">{entry.command}</span>
                    <span>{t(entry.label)}</span>
                  </button>
                ))}
              </div>
            )}

            <textarea
              ref={textareaRef}
              value={input}
              onChange={(event) => updateInput(event.target.value)}
              onPaste={(event) => {
                const files = Array.from(event.clipboardData?.files ?? []);
                if (!files.length) return;
                event.preventDefault();
                void readDroppedFiles(files);
              }}
              onKeyDown={(event) => {
                if (mentions.length > 0) {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setMentionIndex((index) => (index + 1) % mentions.length);
                    return;
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setMentionIndex((index) => (index - 1 + mentions.length) % mentions.length);
                    return;
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setMentions([]);
                    return;
                  }
                  if (event.key === "Enter" && !event.shiftKey && !event.metaKey) {
                    event.preventDefault();
                    void acceptMention(mentions[mentionIndex]);
                    return;
                  }
                }
                if (event.key !== "Enter") return;
                const sends = sendKey === "cmd-enter" ? event.metaKey || event.ctrlKey : !event.shiftKey;
                if (!sends) return;
                event.preventDefault();
                void send();
              }}
              rows={1}
              placeholder={
                ready
                  ? busy
                    ? t("chat.placeholderBusy")
                    : busyElsewhere
                      ? t("chat.busyElsewhere")
                      : t("chat.placeholder", { name: agentName })
                  : status.state === "error"
                    ? t("chat.placeholderUnavailable")
                    : t("chat.placeholderWaiting")
              }
              aria-label={t("chat.placeholder", { name: agentName })}
              disabled={!ready || loadingMessages}
              className="w-full resize-none bg-transparent px-2.5 pt-2.5 pb-1 text-[12.5px] outline-none placeholder:text-faint disabled:opacity-50 min-h-[44px] max-h-[180px]"
            />

            <div className="flex items-center gap-1.5 px-1 pb-0.5">
              <button
                onClick={beginNewChat}
                disabled={!conversationId}
                title={t("nav.newChat")}
                aria-label={t("nav.newChat")}
                className="icon-btn"
              >
                <Plus size={16} />
              </button>
              <button
                onClick={() => void pickAttachments()}
                disabled={!ready || attaching || loadingMessages}
                title={t("chat.attach", { size: MAX_ATTACHMENT_LABEL })}
                aria-label={t("chat.attach", { size: MAX_ATTACHMENT_LABEL })}
                className="icon-btn"
              >
                {attaching ? <Loader size={16} className="animate-spin" /> : <Paperclip size={16} />}
              </button>
              <span className={`chip ml-1 ${autoExecute ? "" : "chip-accent"}`}>
                <ShieldCheck size={12} />
                {autoExecute ? t("chat.runsFreely") : t("chat.approvalsOn")}
              </span>

              <div className="ml-auto flex items-center gap-2.5">
                <span className="hidden lg:flex items-center gap-1 text-[10px] text-faint">
                  <span className="kbd">⇧</span>
                  <span className="kbd">↵</span>
                  {t("chat.newline")}
                </span>
                <span className="flex items-center gap-1.5 text-[10.5px] text-faint">
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      ready ? "bg-accent" : status.state === "error" ? "bg-danger" : "bg-warn pulse-dot"
                    }`}
                  />
                  {providerLabel}
                </span>
                {busy ? (
                  <button
                    onClick={() => void stop()}
                    className="btn !w-8 !px-0 rounded-full"
                    title={t("chat.stop")}
                    aria-label={t("chat.stop")}
                  >
                    <Square size={11} />
                  </button>
                ) : (
                  <button
                    onClick={() => void send()}
                    disabled={!ready || (!input.trim() && !attachments.length) || loadingMessages}
                    className="btn btn-primary !w-8 !px-0 rounded-full"
                    title={t("chat.send")}
                    aria-label={t("chat.send")}
                  >
                    <ArrowUp size={15} />
                  </button>
                )}
              </div>
            </div>
          </div>

          <p className="text-center text-[10px] text-faint mt-2.5">
            {t("chat.footer", { name: agentName })} ·{" "}
            <span className="text-muted">{moodLabel(mood).toLowerCase()}</span>
          </p>
        </div>
      </div>
    </div>
  );
};
