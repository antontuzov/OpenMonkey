import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Check,
  ExternalLink,
  History,
  Loader,
  Pin,
  Plus,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";
import { useAppearance } from "./theme";
import { logoUrl } from "./assets";
import { locale, setLanguage, t } from "./i18n";
import { ToolPreviewCard } from "./components/ToolPreviewCard";
import {
  MOOD_LOGOS,
  type AgentStatus,
  type ApprovalRequest,
  type Config,
  type Message,
  type Mood,
  type QuickAskThread,
} from "../utils/types";

const relative = new Intl.RelativeTimeFormat(locale(), { numeric: "auto" });

const ago = (date: Date): string => {
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return relative.format(-seconds, "second");
  if (seconds < 3600) return relative.format(-Math.round(seconds / 60), "minute");
  if (seconds < 86_400) return relative.format(-Math.round(seconds / 3600), "hour");
  if (seconds < 604_800) return relative.format(-Math.round(seconds / 86_400), "day");
  return relative.format(-Math.round(seconds / 604_800), "week");
};

export const QuickAsk: React.FC = () => {
  const [config, setConfig] = useState<Config | null>(null);
  const [status, setStatus] = useState<AgentStatus>({ state: "starting" });
  const [mood, setMood] = useState<Mood>("neutral");
  const [input, setInput] = useState("");
  const [threads, setThreads] = useState<QuickAskThread[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [answer, setAnswer] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  const [selected, setSelected] = useState(0);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const conversationRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowsRef = useRef<Array<HTMLButtonElement | null>>([]);

  useAppearance(config);
  if (config) setLanguage(config.ui.language);

  const ready = status.state === "ready";
  const logo = MOOD_LOGOS[mood] ?? MOOD_LOGOS.neutral;
  const statusLabel =
    status.state === "ready"
      ? t("status.ready")
      : status.state === "error"
        ? t("status.error")
        : status.state === "loading-model"
          ? t("status.loading-model")
          : t("status.starting");

  const refreshThreads = useCallback(async () => {
    try {
      const list = (await window.electron?.getQuickAskThreads()) ?? [];
      setThreads(list);
      return list;
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    const api = window.electron;
    if (!api) return;

    void api.getConfig().then(setConfig).catch(() => undefined);
    void api.getAgentStatus().then(setStatus).catch(() => undefined);
    void api.getCurrentMood().then(setMood).catch(() => undefined);
    void refreshThreads();

    const offStatus = api.onAgentStatus(setStatus);
    const offMood = api.onMoodChange((next) => setMood(next as Mood));
    const offApproval = api.onApprovalRequest((request) => {
      if (request.origin === "quick") setApproval(request);
    });
    const offCommand = api.onMenuCommand((command) => {
      if (command !== "focus-composer") return;
      inputRef.current?.focus();
    });
    // The thread is created in the main process, so the popover learns which
    // conversation to listen to before the first token arrives.
    const offStarted = api.onQuickAskStarted((payload) => {
      conversationRef.current = payload.conversationId;
      setThreadId(payload.threadId);
    });
    const offChat = api.onChatEvent((event) => {
      if (!conversationRef.current || event.conversationId !== conversationRef.current) return;
      switch (event.type) {
        case "start":
          setStreaming(true);
          setAnswer("");
          break;
        case "token":
          setAnswer((current) => current + event.token);
          break;
        case "replace":
          setAnswer(event.content);
          break;
        case "done":
        case "stopped":
          setStreaming(false);
          setBusy(false);
          setAnswer("");
          setMessages((current) => [...current, event.message]);
          break;
        case "error":
          setStreaming(false);
          setBusy(false);
          setFailure(event.error);
          break;
      }
    });

    return () => {
      offStatus();
      offMood();
      offApproval();
      offCommand();
      offStarted();
      offChat();
    };
  }, [refreshThreads]);

  useEffect(() => {
    document.documentElement.dataset.quick = "true";
    return () => {
      delete document.documentElement.dataset.quick;
    };
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [answer, messages, approval, failure]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        void window.electron?.hideQuickAsk();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy || !ready) return;
    setInput("");
    setFailure("");
    setBusy(true);
    setStreaming(true);
    setMessages((current) => [
      ...current,
      { id: `local_${Date.now()}`, role: "user", content: text, timestamp: new Date() },
    ]);
    try {
      const result = await window.electron?.quickAsk(text, threadId ?? undefined);
      if (result) {
        conversationRef.current = result.conversationId;
        setThreadId(result.threadId);
      }
      await refreshThreads();
    } catch (caught) {
      setFailure(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
      setStreaming(false);
      inputRef.current?.focus();
    }
  }, [busy, input, ready, refreshThreads, threadId]);

  const openThread = useCallback(async (thread: QuickAskThread) => {
    conversationRef.current = thread.conversationId;
    setThreadId(thread.id);
    setAnswer("");
    setFailure("");
    setStreaming(false);
    try {
      const list = (await window.electron?.getMessages(thread.conversationId)) ?? [];
      setMessages(list);
    } catch {
      setMessages([]);
    }
    inputRef.current?.focus();
  }, []);

  const startNew = useCallback(() => {
    conversationRef.current = null;
    setThreadId(null);
    setMessages([]);
    setAnswer("");
    setFailure("");
    setStreaming(false);
    inputRef.current?.focus();
  }, []);

  const resolve = async (approved: boolean, remember = false) => {
    if (!approval) return;
    await window.electron?.approveTask(approval.requestId, approved, remember);
    setApproval(null);
    inputRef.current?.focus();
  };

  const togglePin = useCallback(
    async (thread: QuickAskThread) => {
      await window.electron?.setQuickAskPinned(thread.id, !thread.pinned);
      await refreshThreads();
    },
    [refreshThreads]
  );

  const removeThread = useCallback(
    async (thread: QuickAskThread) => {
      if (confirmRemove !== thread.id) {
        setConfirmRemove(thread.id);
        return;
      }
      setConfirmRemove(null);
      await window.electron?.deleteQuickAsk(thread.id);
      if (threadId === thread.id) startNew();
      await refreshThreads();
    },
    [confirmRemove, refreshThreads, startNew, threadId]
  );

  const openInChat = async () => {
    if (threadId) {
      await window.electron?.openQuickAskInChat(threadId);
      await refreshThreads();
    } else {
      await window.electron?.showMainWindow();
    }
    void window.electron?.hideQuickAsk();
  };

  const move = (delta: number) => {
    if (!threads.length) return;
    const next = Math.min(Math.max(selected + delta, 0), threads.length - 1);
    setSelected(next);
    rowsRef.current[next]?.focus();
  };

  const onRowKeyDown = (event: React.KeyboardEvent, thread: QuickAskThread, index: number) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      move(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setSelected(0);
      rowsRef.current[0]?.focus();
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      const last = threads.length - 1;
      setSelected(last);
      rowsRef.current[last]?.focus();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      void openThread(thread);
      return;
    }
    if (event.key.toLowerCase() === "p") {
      event.preventDefault();
      void togglePin(thread);
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      void removeThread(thread);
      return;
    }
    if (event.key === "Tab" && event.shiftKey) {
      event.preventDefault();
      inputRef.current?.focus();
      return;
    }
    void index;
  };

  const onComposerKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
      return;
    }
    // An empty composer with the caret at the top walks into the history, the way
    // a shell history does.
    if (event.key === "ArrowUp" && !input && event.currentTarget.selectionStart === 0 && threads.length) {
      event.preventDefault();
      const last = threads.length - 1;
      setSelected(last);
      rowsRef.current[last]?.focus();
    }
  };

  const idle = !threadId && !messages.length && !failure && !approval;

  return (
    <div className="h-screen w-screen p-2.5">
      <div className="quick-shell h-full flex overflow-hidden">
        <aside className="w-[228px] shrink-0 border-r border-line flex flex-col min-h-0">
          <div className="px-4 pt-4 pb-2 flex items-center justify-between gap-2">
            <span className="section-label !mb-0 flex items-center gap-1.5">
              <History size={12} />
              {t("quick.history")}
            </span>
            <button
              onClick={startNew}
              className="icon-btn !w-6 !h-6"
              title={t("quick.newThread")}
              aria-label={t("quick.newThread")}
            >
              <Plus size={12} />
            </button>
          </div>

          {threads.length === 0 ? (
            <p className="px-4 pb-3 text-[10.5px] text-faint leading-relaxed">{t("quick.historyEmpty")}</p>
          ) : (
            <ul className="flex-1 min-h-0 overflow-y-auto px-2 pb-2 space-y-0.5">
              {threads.map((thread, index) => (
                <li key={thread.id}>
                  <div
                    className={`group/row flex items-center gap-1 rounded-lg pr-1 transition-colors ${
                      index === selected ? "bg-card-2" : "hover:bg-card-2"
                    }`}
                  >
                    <button
                      ref={(element) => {
                        rowsRef.current[index] = element;
                      }}
                      tabIndex={index === selected ? 0 : -1}
                      onFocus={() => setSelected(index)}
                      onClick={() => void openThread(thread)}
                      onKeyDown={(event) => onRowKeyDown(event, thread, index)}
                      aria-current={threadId === thread.id ? "true" : undefined}
                      className="flex-1 min-w-0 text-left px-2 py-1.5 rounded-lg"
                    >
                      <span className="block truncate text-[11.5px] leading-snug">
                        {thread.question || t("quick.newThread")}
                      </span>
                      <span className="block text-[9.5px] text-faint mt-0.5">{ago(thread.updatedAt)}</span>
                    </button>
                    <button
                      onClick={() => void togglePin(thread)}
                      tabIndex={index === selected ? 0 : -1}
                      className="icon-btn !w-5 !h-5 shrink-0"
                      title={thread.pinned ? t("quick.unpin") : t("quick.pin")}
                      aria-label={thread.pinned ? t("quick.unpin") : t("quick.pin")}
                    >
                      {thread.pinned ? (
                        <Pin size={11} className="text-accent-ink" fill="currentColor" />
                      ) : (
                        <Pin size={11} className="opacity-0 group-hover/row:opacity-100" />
                      )}
                    </button>
                    <button
                      onClick={() => void removeThread(thread)}
                      tabIndex={-1}
                      className="icon-btn !w-5 !h-5 shrink-0"
                      title={confirmRemove === thread.id ? t("quick.removeConfirm") : t("quick.remove")}
                      aria-label={t("quick.remove")}
                    >
                      <Trash2
                        size={11}
                        className={confirmRemove === thread.id ? "text-danger" : "opacity-0 group-hover/row:opacity-100"}
                      />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <div className="flex-1 min-w-0 flex flex-col">
          <header className="drag-region flex items-center gap-2.5 px-5 pt-4 pb-3 border-b border-line shrink-0">
            <img src={logoUrl(logo.file)} alt="" className="w-6 h-6 rounded-full" />
            <span className="text-[12px] font-semibold tracking-tight">{t("quick.title")}</span>
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                ready ? "bg-accent" : status.state === "error" ? "bg-danger" : "bg-warn pulse-dot"
              }`}
            />
            <span className="text-[10px] text-faint">{statusLabel}</span>
            <div className="ml-auto flex items-center gap-0.5 no-drag">
              <button
                onClick={() => void openInChat()}
                disabled={Boolean(approval)}
                className="icon-btn !w-7 !h-7"
                title={t("quick.openInChat")}
                aria-label={t("quick.openInChat")}
              >
                <ExternalLink size={13} />
              </button>
              <button
                onClick={() => void window.electron?.hideQuickAsk()}
                className="icon-btn !w-7 !h-7"
                title={t("quick.hide")}
                aria-label={t("quick.hide")}
              >
                <X size={13} />
              </button>
            </div>
          </header>

          <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
            {idle && (
              <div className="h-full flex flex-col items-center justify-center text-center px-6">
                <img src={logoUrl(logo.file)} alt="" className="w-10 h-10 rounded-full opacity-90" />
                <p className="text-[11.5px] text-muted leading-relaxed mt-3 max-w-[34ch]">
                  {ready ? t("quick.empty") : t("quick.offline")}
                </p>
              </div>
            )}

            {messages.map((message, index) =>
              message.role === "user" ? (
                <div key={message.id ?? index} className="flex justify-end">
                  <p className="message-user px-3 py-2 text-[12px] leading-relaxed max-w-[85%] whitespace-pre-wrap break-words">
                    {message.content}
                  </p>
                </div>
              ) : (
                <div
                  key={message.id ?? index}
                  className="mt-3 text-[12px] leading-relaxed whitespace-pre-wrap break-words"
                >
                  {message.content}
                </div>
              )
            )}

            {streaming && (
              <div className="mt-3 text-[12px] leading-relaxed whitespace-pre-wrap break-words">
                {answer}
                <span className="inline-block w-[7px] h-[13px] bg-accent-ink align-[-2px] ml-0.5 animate-pulse" />
                {streaming && !answer && <span className="text-faint text-[11px]">{t("quick.thinking")}</span>}
              </div>
            )}

            {failure && (
              <div className="card border-danger/30 bg-danger/5 px-3 py-2.5 mt-3 text-[11px] text-danger leading-relaxed">
                {failure}
              </div>
            )}

            {approval && (
              <div className="card mt-3 p-3.5 border-warn/40" role="dialog" aria-modal="true" aria-label={t("quick.approval")}>
                <div className="flex items-start gap-2">
                  <ShieldAlert size={14} className="text-warn mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="section-label !mb-0.5">{t("quick.approval")}</p>
                    <p className="text-[11.5px] font-semibold leading-snug">{approval.request.summary}</p>
                    <p className="text-[10.5px] text-muted mt-1">
                      {t("approval.body", {
                        agent: config?.agent.name ?? "OpenMonkey",
                        tool: `${approval.request.type}.${approval.request.action}`,
                      })}
                    </p>
                  </div>
                </div>
                <div className="mt-2">
                  <ToolPreviewCard preview={approval.preview} compact />
                </div>
                <div className="flex justify-end gap-1.5 mt-2.5">
                  <button onClick={() => void resolve(false)} className="btn !h-7 !text-[10.5px]">
                    {t("approval.deny")}
                  </button>
                  <button onClick={() => void resolve(true, true)} className="btn !h-7 !text-[10.5px]">
                    {t("approval.allowSession")}
                  </button>
                  <button onClick={() => void resolve(true)} className="btn btn-primary !h-7 !text-[10.5px]">
                    <Check size={11} />
                    {t("approval.allowOnce")}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="px-4 pb-3 pt-1 shrink-0">
            <div className="card px-3 py-2 flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={onComposerKeyDown}
                rows={1}
                placeholder={t("quick.placeholder")}
                disabled={!ready}
                aria-label={t("quick.placeholder")}
                className="flex-1 resize-none bg-transparent text-[12px] leading-relaxed outline-none placeholder:text-faint disabled:opacity-50 min-h-[24px] max-h-[120px]"
              />
              <button
                onClick={() => void send()}
                disabled={!ready || busy || !input.trim()}
                className="btn btn-primary !w-7 !h-7 !px-0 rounded-full shrink-0"
                title={t("chat.send")}
                aria-label={t("chat.send")}
              >
                {busy ? <Loader size={12} className="animate-spin" /> : <ArrowUp size={13} />}
              </button>
            </div>
            <p className="text-center text-[9.5px] text-faint mt-2">{t("quick.hint")}</p>
          </div>
        </div>
      </div>
    </div>
  );
};
