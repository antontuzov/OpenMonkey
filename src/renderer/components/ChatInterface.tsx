import { useEffect, useRef, useState } from "react";
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
}

const WELCOME = [
  {
    glyph: "✨",
    title: "Ask, create, and automate",
    copy: "Give your assistant tasks and let it help across your Mac.",
  },
  {
    glyph: "🗂",
    title: "Files, web, and shell",
    copy: "Read a folder, fetch a page, run a command - your choice each time.",
  },
  {
    glyph: "🛡",
    title: "Stay in control",
    copy: "Everything runs where you decide, with approvals you grant.",
  },
];

export const ChatInterface: React.FC<ChatInterfaceProps> = ({ status, mood }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const ready = status.state === "ready";
  const logo = MOOD_LOGOS[mood] ?? MOOD_LOGOS.neutral;

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
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {status.state !== "ready" && status.state !== "error" && (
          <div className="h-full flex items-center justify-center">
            <div className="card px-6 py-5 text-center max-w-sm">
              <p className="text-accent-ink text-[15px] mb-1">Loading the local model</p>
              <p className="text-muted text-xs">Bonsai-4B stays on this machine. Nothing is uploaded.</p>
            </div>
          </div>
        )}

        {status.state === "error" && (
          <div className="card max-w-lg mx-auto mt-10 p-6">
            <p className="text-danger mb-2">No model loaded</p>
            <p className="text-muted text-xs mb-4">{status.message}</p>
            <pre className="bg-card-2 border border-line rounded-lg p-3 text-xs overflow-x-auto">
              npm run download-models
            </pre>
          </div>
        )}

        {ready && messages.length === 0 && (
          <div className="max-w-xl mx-auto pt-10 text-center">
            <img src={`/logos/${logo.file}`} alt="" className="w-20 h-20 rounded-full mx-auto mb-6" />
            <h1 className="font-sans text-[28px] text-ink mb-2">Welcome to OpenMonkey</h1>
            <p className="font-sans text-muted mb-1">Your personal AI assistant, running on this Mac.</p>
            <p className="font-sans text-muted text-sm mb-8 max-w-md mx-auto">
              It answers questions and works with your files, apps and shell - all locally.
            </p>
            <div className="card text-left divide-line">
              {WELCOME.map((item, index) => (
                <div
                  key={item.title}
                  className={`flex items-start gap-4 px-5 py-4 ${index ? "border-t border-line" : ""}`}
                >
                  <span className="text-[15px] leading-6" aria-hidden>
                    {item.glyph}
                  </span>
                  <div>
                    <p className="font-sans text-ink">{item.title}</p>
                    <p className="font-sans text-muted text-[13px]">{item.copy}</p>
                  </div>
                </div>
              ))}
            </div>
            <p className="font-sans text-faint text-xs mt-6">
              OpenMonkey can take actions using the permissions you grant. Review prompts and only connect tools you
              trust.
            </p>
          </div>
        )}

        <div className="max-w-3xl mx-auto space-y-4">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`message-enter flex items-start gap-3 ${
                message.role === "user" ? "justify-end" : "justify-start"
              }`}
            >
              {message.role === "assistant" && (
                <img src={`/logos/${logo.file}`} alt="" className="w-7 h-7 rounded-full mt-1 shrink-0" />
              )}
              <div
                className={`max-w-[75%] rounded-2xl px-4 py-3 ${
                  message.role === "user"
                    ? "bg-bubble border border-bubble"
                    : "card"
                }`}
              >
                <p className="whitespace-pre-wrap break-words">{message.content}</p>
                <p className="text-[10px] text-faint mt-2">
                  {new Date(message.timestamp).toLocaleTimeString()}
                </p>
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="flex items-center gap-3">
              <img src={`/logos/${logo.file}`} alt="" className="w-7 h-7 rounded-full" />
              <div className="card px-4 py-3 flex gap-1.5">
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

          {error && (
            <div className="card px-4 py-3 flex items-start gap-3">
              <span className="text-danger" aria-hidden>
                ⚠
              </span>
              <p className="text-danger text-xs">{error}</p>
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>

      <div className="px-6 pb-5 pt-1">
        <div className="max-w-3xl mx-auto card">
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
            placeholder={ready ? "Message OpenMonkey" : "Waiting for the model"}
            disabled={!ready || isLoading}
            className="w-full resize-none bg-transparent px-4 pt-4 pb-2 outline-none disabled:opacity-50"
          />
          <div className="flex items-center justify-between px-3 pb-3">
            <div className="flex items-center gap-2">
              <button
                onClick={() => void clear()}
                disabled={!ready}
                title="Start a new conversation"
                className="btn !px-2.5 !py-1"
              >
                ＋
              </button>
              <span className="chip">
                <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                approvals on
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-faint">
                {status.provider ?? "no model"} · {logo.label.toLowerCase()}
              </span>
              {isLoading ? (
                <button
                  onClick={() => void window.electron?.stopGeneration()}
                  className="btn"
                  title="Stop generating"
                >
                  Stop
                </button>
              ) : (
                <button
                  onClick={() => void send()}
                  disabled={!ready || !input.trim()}
                  className="w-8 h-8 rounded-full btn btn-primary flex items-center justify-center !px-0"
                  title="Send"
                >
                  ↑
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
