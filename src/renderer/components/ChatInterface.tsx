import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Check,
  Copy,
  FileText,
  Files,
  Loader,
  Paperclip,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Square,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  MOOD_LOGOS,
  type AgentStatus,
  type Attachment,
  type ChatErrorCode,
  type Message,
  type Mood,
} from "../../utils/types";
import { MessageContent } from "./MessageContent";

interface ChatInterfaceProps {
  status: AgentStatus;
  mood: Mood;
  agentName: string;
  autoExecute: boolean;
  conversationId: string | null;
  busyConversationId: string | null;
  onConversationsChanged: () => void;
  onOpenSettings: () => void;
  onNewConversation: () => void;
}

const WELCOME = [
  {
    icon: Sparkles,
    title: "Ask, create, and automate",
    copy: "Give your assistant a task and let it work across this Mac.",
  },
  {
    icon: Files,
    title: "Files, web, and shell",
    copy: "Read a folder, fetch a page, run a command — one approval each time.",
  },
  {
    icon: ShieldCheck,
    title: "Stay in control",
    copy: "Everything runs where you decide, with permissions you grant.",
  },
];

const MAX_ATTACHMENT_LABEL = "256 KB";
const MAX_ATTACHMENT_BYTES = 256 * 1024;
const ATTACHABLE_FILE = /\.(txt|md|markdown|json|csv|tsv|log|yaml|yml|toml|xml|html|css|js|jsx|ts|tsx|py|rb|go|rs|swift|sh|sql|c|h|cpp|java|env|ini|conf)$/i;

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
  canRegenerate: boolean;
  onRegenerate: () => void;
  regenerating: boolean;
}> = ({ message, logoFile, canRegenerate, onRegenerate, regenerating }) => {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === "user";
  const duration = message.metadata?.durationMs;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className={`message-enter flex items-end gap-2.5 ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && (
        <img src={`/logos/${logoFile}`} alt="" className="w-[26px] h-[26px] rounded-full mb-5 shrink-0" />
      )}
      <div className={`group/message flex flex-col ${isUser ? "items-end" : "items-start"} max-w-[78%]`}>
        <div className={`${isUser ? "message-user" : "message-assistant"} px-4 py-2.5 w-full`}>
          <MessageContent message={message} />
        </div>
        <div className="flex items-center gap-1.5 mt-1.5 px-0.5 text-[10px] text-faint">
          <span>{timeOf(message.timestamp)}</span>
          {!isUser && duration != null && (
            <>
              <span>·</span>
              <span>{Math.max(0.1, duration / 1000).toFixed(1)}s</span>
            </>
          )}
          {message.metadata?.stopped && (
            <>
              <span>·</span>
              <span className="inline-flex items-center gap-1 text-warn">
                <Square size={8} />
                Stopped
              </span>
            </>
          )}
          <span
            className={`flex items-center gap-0.5 transition-opacity ${
              copied ? "opacity-100" : "opacity-0 group-hover/message:opacity-100 group-focus-within/message:opacity-100"
            }`}
          >
            <button onClick={() => void copy()} className="icon-btn !w-5 !h-5" title="Copy message">
              {copied ? <Check size={11} className="text-accent-ink" /> : <Copy size={11} />}
            </button>
            {!isUser && canRegenerate && (
              <button
                onClick={onRegenerate}
                disabled={regenerating}
                className="icon-btn !w-5 !h-5"
                title="Regenerate this reply"
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
    <img src={`/logos/${logoFile}`} alt="" className="w-[26px] h-[26px] rounded-full mb-5 shrink-0" />
    <div className="flex flex-col items-start max-w-[78%]">
      <div className="message-assistant px-4 py-2.5">
        <MessageContent
          message={{ id: "stream", role: "assistant", content, timestamp: new Date() }}
        />
        {content.length > 0 && (
          <span className="inline-block w-[6px] h-[13px] ml-0.5 align-[-2px] rounded-[1px] bg-accent animate-pulse" />
        )}
      </div>
      <p className="text-[10px] text-faint mt-1.5 px-0.5">writing…</p>
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

const LoadingCard: React.FC<{ title: string; copy: string }> = ({ title, copy }) => (
  <div className="min-h-[46vh] flex items-center justify-center">
    <div className="card px-7 py-6 text-center max-w-sm">
      <Loader size={18} className="animate-spin text-accent-ink mx-auto mb-3" />
      <p className="text-[13px] font-semibold mb-1">{title}</p>
      <p className="text-muted text-[11px] leading-relaxed">{copy}</p>
    </div>
  </div>
);

export const ChatInterface: React.FC<ChatInterfaceProps> = ({
  status,
  mood,
  agentName,
  autoExecute,
  conversationId,
  busyConversationId,
  onConversationsChanged,
  onOpenSettings,
  onNewConversation,
}) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [stream, setStream] = useState<{ id: string; content: string } | null>(null);
  const [input, setInput] = useState("");
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [failure, setFailure] = useState<ChatFailure | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadingMessages, setLoadingMessages] = useState(true);
  const [dragging, setDragging] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dragDepth = useRef(0);

  const ready = status.state === "ready";
  const logo = MOOD_LOGOS[mood] ?? MOOD_LOGOS.neutral;
  const providerLabel =
    status.provider === "mlx" ? "MLX" : status.provider === "bonsai" ? "Bonsai 4B" : "No model";
  const busy = isSending || Boolean(stream) || (busyConversationId != null && busyConversationId === conversationId);

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
    setAttachment(null);
    setIsSending(false);
    setLoadingMessages(true);
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

    return api.onChatEvent((event) => {
      if (!conversationId || event.conversationId !== conversationId) return;

      switch (event.type) {
        case "start":
          setFailure(null);
          setStream({ id: event.message.id, content: "" });
          break;
        case "token":
          setStream((current) =>
            current && current.id === event.messageId
              ? { ...current, content: current.content + event.token }
              : current
          );
          break;
        case "replace":
          setStream((current) =>
            current && current.id === event.messageId ? { ...current, content: event.content } : current
          );
          break;
        case "done":
          setStream(null);
          setMessages((current) => replaceMessage(current, event.message));
          break;
        case "stopped":
          setStream(null);
          if (event.message.content.trim()) {
            setMessages((current) => replaceMessage(current, event.message));
          }
          break;
        case "error": {
          setStream(null);
          const partial = event.message;
          if (partial) setMessages((current) => replaceMessage(current, partial));
          setFailure({ code: event.code, text: event.error, origin: "stream" });
          break;
        }
      }
    });
  }, [conversationId]);

  useEffect(() => {
    if (!stickRef.current) return;
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages, stream?.content, failure, loadingMessages]);

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 180)}px`;
  }, [input]);

  useEffect(() => {
    if (!loadingMessages && ready) textareaRef.current?.focus();
  }, [conversationId, loadingMessages, ready]);

  const updateInput = (value: string) => {
    setInput(value);
    if (conversationId) sessionStorage.setItem(draftKey(conversationId), value);
  };

  const send = useCallback(async () => {
    if (!conversationId || !ready || busy) return;
    const text = input.trim();
    const file = attachment;
    if (!text && !file) return;

    const localId = `local_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const userMessage: Message = {
      id: localId,
      role: "user",
      content: text || `Attached ${file!.name}`,
      timestamp: new Date(),
      metadata: file ? { attachment: { name: file.name, bytes: file.bytes } } : undefined,
    };

    stickRef.current = true;
    setMessages((current) => [...current, userMessage]);
    setInput("");
    sessionStorage.removeItem(draftKey(conversationId));
    setAttachment(null);
    setFailure(null);
    setNotice(null);
    setIsSending(true);

    try {
      await window.electron?.processMessage(conversationId, text, file ?? undefined);
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : String(caught);
      setMessages((current) => current.filter((message) => message.id !== localId));
      setInput(text);
      sessionStorage.setItem(draftKey(conversationId), text);
      setAttachment(file);
      setFailure({ code: classifyError(detail), text: detail, origin: "send" });
    } finally {
      setIsSending(false);
      onConversationsChanged();
      textareaRef.current?.focus();
    }
  }, [attachment, busy, conversationId, input, onConversationsChanged, ready]);

  const regenerate = useCallback(async () => {
    if (!conversationId || !ready || busy) return;
    setFailure(null);
    setNotice(null);
    setMessages((current) =>
      current[current.length - 1]?.role === "assistant" ? current.slice(0, -1) : current
    );
    stickRef.current = true;
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

  const stop = async () => {
    await window.electron?.stopGeneration();
  };

  const pickAttachment = async () => {
    if (!ready) return;
    setAttaching(true);
    setNotice(null);
    try {
      const file = await window.electron?.attachFile();
      if (file) setAttachment(file);
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "That file could not be attached");
    } finally {
      setAttaching(false);
    }
  };

  const acceptDroppedFile = async (file: File | undefined) => {
    if (!file) return;
    if (!ATTACHABLE_FILE.test(file.name)) {
      setNotice("Drop a plain text or code file. Binaries and images are not sent to the model.");
      return;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setNotice(`That file is ${Math.round(file.size / 1024)} KB. Attachments are capped at ${MAX_ATTACHMENT_LABEL}.`);
      return;
    }
    try {
      const text = await file.text();
      if (text.includes("\u0000")) {
        setNotice("That file looks binary, so it was not attached.");
        return;
      }
      setAttachment({ name: file.name, bytes: file.size, text });
      setNotice(null);
      textareaRef.current?.focus();
    } catch {
      setNotice("That file could not be read.");
    }
  };

  const retryModel = () => {
    void window.electron?.reloadModel().catch(() => undefined);
  };

  const onScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    stickRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 96;
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
      }}
      onDragOver={(event) => {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        if (!ready) return;
        void acceptDroppedFile(event.dataTransfer?.files?.[0]);
      }}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-3 z-20 rounded-2xl border-2 border-dashed border-accent bg-accent-soft/95 flex flex-col items-center justify-center gap-2">
          <Paperclip size={26} className="text-accent-ink" />
          <p className="text-[13px] font-semibold text-accent-ink">Drop a text file to attach</p>
          <p className="text-[11px] text-muted">Plain text or code, up to {MAX_ATTACHMENT_LABEL}</p>
        </div>
      )}

      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-8">
        <div className="max-w-[760px] mx-auto py-7">
          {loadingMessages && (
            <LoadingCard title="Opening this chat" copy="Reading the local, encrypted history for this session." />
          )}

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
                src={`/logos/${logo.file}`}
                alt=""
                className="w-[72px] h-[72px] rounded-full mx-auto logo-mood-change"
                style={{ boxShadow: `0 0 0 3px var(--color-paper), 0 0 0 4px ${logo.color}55` }}
              />
              <h1 className="text-[25px] font-semibold tracking-tight mt-5">Welcome to {agentName}</h1>
              <p className="text-muted text-[12px] mt-2 max-w-[46ch] mx-auto leading-relaxed">
                Your personal AI assistant, running on this Mac. It answers questions and works with your files and
                apps — asking before it touches anything.
              </p>

              <div className="card text-left mt-8">
                {WELCOME.map((item, index) => {
                  const Icon = item.icon;
                  return (
                    <div
                      key={item.title}
                      className={`flex items-start gap-3.5 px-5 py-4 ${index ? "border-t border-line" : ""}`}
                    >
                      <Icon size={17} className="text-accent-ink mt-0.5 shrink-0" />
                      <div>
                        <p className="text-[12.5px] font-semibold">{item.title}</p>
                        <p className="text-muted text-[11.5px] leading-relaxed mt-0.5">{item.copy}</p>
                      </div>
                    </div>
                  );
                })}
              </div>

              <p className="text-faint text-[10.5px] mt-6 leading-relaxed">
                {agentName} can take actions using the permissions you enable. Review every prompt and only allow
                tools you trust.
              </p>
            </div>
          )}

          <div className="space-y-5">
            {messages.map((message, index) => (
              <ChatMessage
                key={message.id}
                message={message}
                logoFile={logo.file}
                canRegenerate={index === lastAssistantIndex && index === messages.length - 1 && ready && !busy}
                onRegenerate={() => void regenerate()}
                regenerating={busy && index === lastAssistantIndex}
              />
            ))}

            {stream && <StreamingMessage content={stream.content} logoFile={logo.file} />}

            {failure && (
              <FailureCard
                failure={failure}
                canRetry={failure.origin === "stream"}
                onRetry={() => void regenerate()}
                onNewChat={beginNewChat}
                onSettings={onOpenSettings}
                onDismiss={() => setFailure(null)}
              />
            )}

            {!loadingMessages && status.state === "error" && messages.length > 0 && (
              <ModelErrorCard message={status.message} onSettings={onOpenSettings} onRetry={retryModel} />
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
                Dismiss
              </button>
            </div>
          )}

          <div className="card p-2">
            {attachment && (
              <div className="flex items-center gap-2 mx-1 mt-1 mb-0.5 px-2 py-1.5 rounded-lg bg-card-2 border border-line text-[10.5px] text-muted">
                <FileText size={12} className="shrink-0" />
                <span className="truncate max-w-[260px] text-ink">{attachment.name}</span>
                <span className="text-faint">{sizeOf(attachment.bytes)}</span>
                <button
                  onClick={() => setAttachment(null)}
                  className="ml-auto icon-btn !w-5 !h-5"
                  title="Remove attachment"
                >
                  <X size={11} />
                </button>
              </div>
            )}

            <textarea
              ref={textareaRef}
              value={input}
              onChange={(event) => updateInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                if (event.shiftKey) return;
                event.preventDefault();
                void send();
              }}
              rows={1}
              placeholder={
                ready
                  ? busy
                    ? "Answering…"
                    : `Message ${agentName}`
                  : status.state === "error"
                    ? "The model is unavailable"
                    : "Waiting for the model"
              }
              disabled={!ready || loadingMessages}
              className="w-full resize-none bg-transparent px-2.5 pt-2.5 pb-1 text-[12.5px] outline-none placeholder:text-faint disabled:opacity-50 min-h-[44px] max-h-[180px]"
            />

            <div className="flex items-center gap-1.5 px-1 pb-0.5">
              <button
                onClick={beginNewChat}
                disabled={!conversationId}
                title="New conversation"
                className="icon-btn"
              >
                <Plus size={16} />
              </button>
              <button
                onClick={() => void pickAttachment()}
                disabled={!ready || attaching || loadingMessages}
                title={`Attach or drop a text file (up to ${MAX_ATTACHMENT_LABEL})`}
                className="icon-btn"
              >
                {attaching ? <Loader size={16} className="animate-spin" /> : <Paperclip size={16} />}
              </button>
              <span className={`chip ml-1 ${autoExecute ? "" : "chip-accent"}`}>
                <ShieldCheck size={12} />
                {autoExecute ? "Runs freely" : "Approvals on"}
              </span>

              <div className="ml-auto flex items-center gap-2.5">
                <span className="hidden lg:flex items-center gap-1 text-[10px] text-faint">
                  <span className="kbd">⇧</span>
                  <span className="kbd">↵</span>
                  newline
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
                    title="Stop generating"
                  >
                    <Square size={11} />
                  </button>
                ) : (
                  <button
                    onClick={() => void send()}
                    disabled={!ready || (!input.trim() && !attachment) || loadingMessages}
                    className="btn btn-primary !w-8 !px-0 rounded-full"
                    title="Send"
                  >
                    <ArrowUp size={15} />
                  </button>
                )}
              </div>
            </div>
          </div>

          <p className="text-center text-[10px] text-faint mt-2.5">
            {agentName} runs entirely on this Mac · <span className="text-muted">{logo.label.toLowerCase()}</span>
          </p>
        </div>
      </div>
    </div>
  );
};
