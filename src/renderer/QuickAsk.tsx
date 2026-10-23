import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Check, ExternalLink, Loader, ShieldAlert, X } from "lucide-react";
import { useAppearance } from "./theme";
import { setLanguage, t } from "./i18n";
import {
  MOOD_LOGOS,
  type AgentStatus,
  type ApprovalRequest,
  type Config,
  type Mood,
} from "../utils/types";

export const QuickAsk: React.FC = () => {
  const [config, setConfig] = useState<Config | null>(null);
  const [status, setStatus] = useState<AgentStatus>({ state: "starting" });
  const [mood, setMood] = useState<Mood>("neutral");
  const [input, setInput] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);

  const conversationRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    const api = window.electron;
    if (!api) return;

    void api.getConfig().then(setConfig).catch(() => undefined);
    void api.getAgentStatus().then(setStatus).catch(() => undefined);
    void api.getCurrentMood().then(setMood).catch(() => undefined);
    void api.getActiveConversationId().then((id) => {
      conversationRef.current = id;
    }).catch(() => undefined);

    const offStatus = api.onAgentStatus(setStatus);
    const offMood = api.onMoodChange((next) => setMood(next as Mood));
    const offApproval = api.onApprovalRequest((request) => {
      if (request.origin === "quick") setApproval(request);
    });
    const offCommand = api.onMenuCommand((command) => {
      if (command !== "focus-composer") return;
      inputRef.current?.focus();
      void api.getActiveConversationId().then((id) => {
        conversationRef.current = id;
      }).catch(() => undefined);
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
          setAnswer(event.message.content);
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
      offChat();
    };
  }, []);

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
  }, [answer, approval, failure]);

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
    setQuestion(text);
    setAnswer("");
    setInput("");
    setFailure("");
    setBusy(true);
    setStreaming(true);
    try {
      const message = await window.electron?.quickAsk(text);
      if (message?.content) setAnswer(message.content);
    } catch (caught) {
      setFailure(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
      setStreaming(false);
      inputRef.current?.focus();
    }
  }, [busy, input, ready]);

  const resolve = async (approved: boolean, remember = false) => {
    if (!approval) return;
    await window.electron?.approveTask(approval.requestId, approved, remember);
    setApproval(null);
    inputRef.current?.focus();
  };

  const openChat = () => {
    if (approval) return;
    void window.electron?.showMainWindow("focus-composer");
    void window.electron?.hideQuickAsk();
  };

  const idle = !question && !answer && !failure && !approval;

  return (
    <div className="h-screen w-screen p-2.5">
      <div className="quick-shell h-full flex flex-col overflow-hidden">
        <header className="drag-region flex items-center gap-2.5 px-5 pt-4 pb-3 border-b border-line shrink-0">
          <img src={`/logos/${logo.file}`} alt="" className="w-6 h-6 rounded-full" />
          <span className="text-[12px] font-semibold tracking-tight">{t("quick.title")}</span>
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              ready ? "bg-accent" : status.state === "error" ? "bg-danger" : "bg-warn pulse-dot"
            }`}
          />
          <span className="text-[10px] text-faint">{statusLabel}</span>
          <div className="ml-auto flex items-center gap-0.5 no-drag">
            <button onClick={openChat} disabled={Boolean(approval)} className="icon-btn !w-7 !h-7" title={t("quick.open")} aria-label={t("quick.open")}>
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
              <img src={`/logos/${logo.file}`} alt="" className="w-10 h-10 rounded-full opacity-90" />
              <p className="text-[11.5px] text-muted leading-relaxed mt-3 max-w-[34ch]">
                {ready ? t("quick.empty") : t("quick.offline")}
              </p>
            </div>
          )}

          {question && (
            <div className="flex justify-end">
              <p className="message-user px-3 py-2 text-[12px] leading-relaxed max-w-[85%] whitespace-pre-wrap break-words">
                {question}
              </p>
            </div>
          )}

          {(answer || streaming) && (
            <div className="mt-3 text-[12px] leading-relaxed whitespace-pre-wrap break-words">
              {answer}
              {streaming && <span className="inline-block w-[7px] h-[13px] bg-accent-ink align-[-2px] ml-0.5 animate-pulse" />}
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
              <pre className="mt-2 max-h-24 overflow-auto rounded-lg border border-line bg-card-2 p-2 text-[10px] text-muted whitespace-pre-wrap break-words">
                {approval.preview}
              </pre>
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
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.shiftKey) return;
                event.preventDefault();
                void send();
              }}
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
  );
};
