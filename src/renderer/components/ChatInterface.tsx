import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Files,
  Loader,
  Plus,
  ShieldCheck,
  Sparkles,
  Square,
  TriangleAlert,
} from "lucide-react";
import { MOOD_LOGOS, type AgentStatus, type Mood } from "../../utils/types";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface ChatInterfaceProps {
  status: AgentStatus;
  mood: Mood;
  agentName: string;
  autoExecute: boolean;
  resetKey: number;
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

const timeOf = (date: Date) =>
  new Date(date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export const ChatInterface: React.FC<ChatInterfaceProps> = ({
  status,
  mood,
  agentName,
  autoExecute,
  resetKey,
}) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const ready = status.state === "ready";
  const logo = MOOD_LOGOS[mood] ?? MOOD_LOGOS.neutral;
  const providerLabel = status.provider === "mlx" ? "MLX" : status.provider === "bonsai" ? "Bonsai 4B" : "No model";

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  useEffect(() => {
    void window.electron
      ?.getMessages()
      .then((stored) =>
        setMessages(
          stored
            .filter((message) => message.role === "user" || message.role === "assistant")
            .map((message) => ({
              id: message.id,
              role: message.role as "user" | "assistant",
              content: message.content,
              timestamp: new Date(message.timestamp),
            }))
        )
      )
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (resetKey === 0) return;
    setMessages([]);
    setError(null);
    void window.electron?.newConversation();
  }, [resetKey]);

  const send = async () => {
    const text = input.trim();
    if (!text || !ready || isLoading) return;

    setMessages((prev) => [
      ...prev,
      { id: `msg_${Date.now()}_u`, role: "user", content: text, timestamp: new Date() },
    ]);
    setInput("");
    setIsLoading(true);
    setError(null);

    try {
      const response = await window.electron?.processMessage(text);
      if (response) {
        setMessages((prev) => [
          ...prev,
          { id: `msg_${Date.now()}_a`, role: "assistant", content: response, timestamp: new Date() },
        ]);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "OpenMonkey could not answer");
    } finally {
      setIsLoading(false);
    }
  };

  const clear = async () => {
    setMessages([]);
    setError(null);
    await window.electron?.newConversation();
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex-1 overflow-y-auto px-8">
        <div className="max-w-[760px] mx-auto py-7">
          {status.state !== "ready" && status.state !== "error" && (
            <div className="min-h-[46vh] flex items-center justify-center">
              <div className="card px-7 py-6 text-center max-w-sm">
                <Loader size={18} className="animate-spin text-accent-ink mx-auto mb-3" />
                <p className="text-[13px] font-semibold mb-1">Loading the local model</p>
                <p className="text-muted text-[11px] leading-relaxed">
                  Bonsai-4B is being read into memory. It never leaves this Mac.
                </p>
              </div>
            </div>
          )}

          {status.state === "error" && (
            <div className="card max-w-lg mx-auto mt-8 p-6">
              <div className="flex items-center gap-2.5 mb-2">
                <TriangleAlert size={16} className="text-danger" />
                <p className="text-danger text-[13px] font-semibold">No model loaded</p>
              </div>
              <p className="text-muted text-[11.5px] mb-4 leading-relaxed">{status.message}</p>
              <pre className="bg-card-2 border border-line rounded-xl p-3 text-[11.5px] overflow-x-auto">
                npm run download-models
              </pre>
            </div>
          )}

          {ready && messages.length === 0 && (
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
            {messages.map((message) => (
              <div
                key={message.id}
                className={`message-enter flex items-end gap-2.5 ${
                  message.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                {message.role === "assistant" && (
                  <img
                    src={`/logos/${logo.file}`}
                    alt=""
                    className="w-[26px] h-[26px] rounded-full mb-5 shrink-0"
                  />
                )}
                <div className={`flex flex-col ${message.role === "user" ? "items-end" : "items-start"} max-w-[78%]`}>
                  <div
                    className={
                      message.role === "user"
                        ? "message-user px-4 py-2.5"
                        : "message-assistant px-4 py-2.5"
                    }
                  >
                    <p className="whitespace-pre-wrap break-words text-[12.5px] leading-relaxed">
                      {message.content}
                    </p>
                  </div>
                  <p className="text-[10px] text-faint mt-1.5 px-0.5">
                    {timeOf(message.timestamp)} · via App
                  </p>
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="flex items-end gap-2.5">
                <img src={`/logos/${logo.file}`} alt="" className="w-[26px] h-[26px] rounded-full" />
                <div className="message-assistant px-4 py-3 flex gap-1.5 mb-5">
                  {[0, 0.15, 0.3].map((delay) => (
                    <span
                      key={delay}
                      className="w-1.5 h-1.5 rounded-full bg-faint pulse-dot"
                      style={{ animationDelay: `${delay}s` }}
                    />
                  ))}
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>
        </div>
      </div>

      <div className="px-8 pb-6">
        <div className="max-w-[760px] mx-auto">
          {error && (
            <div className="card flex items-center gap-3 px-4 py-2.5 mb-2.5">
              <TriangleAlert size={15} className="text-danger shrink-0" />
              <p className="text-danger text-[11.5px] flex-1 leading-snug">{error}</p>
              <button onClick={() => setError(null)} className="text-[11px] text-muted hover:text-ink">
                Dismiss
              </button>
            </div>
          )}

          <div className="card p-2">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
              rows={2}
              placeholder={ready ? `Message ${agentName}` : "Waiting for the model"}
              disabled={!ready || isLoading}
              className="w-full resize-none bg-transparent px-2.5 pt-2.5 pb-1 text-[12.5px] outline-none placeholder:text-faint disabled:opacity-50"
            />
            <div className="flex items-center gap-1.5 px-1 pb-0.5">
              <button
                onClick={() => void clear()}
                disabled={!ready}
                title="New conversation"
                className="icon-btn"
              >
                <Plus size={16} />
              </button>
              <span className={`chip ml-1 ${autoExecute ? "" : "chip-accent"}`}>
                <ShieldCheck size={12} />
                {autoExecute ? "Runs freely" : "Approvals on"}
              </span>
              <div className="ml-auto flex items-center gap-2.5">
                <span className="flex items-center gap-1.5 text-[10.5px] text-faint">
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      ready ? "bg-accent" : status.state === "error" ? "bg-danger" : "bg-warn pulse-dot"
                    }`}
                  />
                  {providerLabel}
                </span>
                {isLoading ? (
                  <button
                    onClick={() => void window.electron?.stopGeneration()}
                    className="btn !w-8 !px-0 rounded-full"
                    title="Stop generating"
                  >
                    <Square size={11} />
                  </button>
                ) : (
                  <button
                    onClick={() => void send()}
                    disabled={!ready || !input.trim()}
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
