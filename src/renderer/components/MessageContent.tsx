import { useState } from "react";
import { Check, Copy, FileText } from "lucide-react";
import type { Message } from "../../utils/types";

interface Segment {
  type: "text" | "code";
  content: string;
  language?: string;
}

/** Keeps an unclosed fence readable while the answer is still streaming. */
function parseSegments(content: string): Segment[] {
  const segments: Segment[] = [];
  let rest = content;

  while (rest) {
    const open = rest.indexOf("```");
    if (open < 0) {
      segments.push({ type: "text", content: rest });
      break;
    }
    if (open > 0) segments.push({ type: "text", content: rest.slice(0, open) });

    const after = rest.slice(open + 3);
    const close = after.indexOf("```");
    const raw = close < 0 ? after : after.slice(0, close);
    const newline = raw.indexOf("\n");
    const language = newline >= 0 ? raw.slice(0, newline).trim() : "";
    const code = newline >= 0 ? raw.slice(newline + 1) : raw;
    segments.push({ type: "code", language, content: code.replace(/\n$/, "") });

    if (close < 0) break;
    rest = after.slice(close + 3);
  }

  return segments.filter((segment) => segment.content.trim().length > 0);
}

function inline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\))/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text))) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    if (token.startsWith("**")) {
      nodes.push(
        <strong key={`b${match.index}`} className="font-semibold">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith("`")) {
      nodes.push(
        <code
          key={`c${match.index}`}
          className="px-1 py-0.5 rounded bg-card-2 border border-line font-mono text-[11px]"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else {
      const link = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(token);
      if (link) {
        nodes.push(
          <button
            key={`l${match.index}`}
            onClick={() => void window.electron?.openExternal(link[2])}
            className="text-accent-ink underline underline-offset-2 hover:opacity-80"
            title={link[2]}
          >
            {link[1]}
          </button>
        );
      } else {
        nodes.push(token);
      }
    }
    last = pattern.lastIndex;
  }

  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

const CodeBlock: React.FC<{ language?: string; code: string }> = ({ language, code }) => {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="my-2.5 rounded-xl border border-line overflow-hidden bg-card-2">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-line">
        <span className="text-[9.5px] uppercase tracking-[0.14em] text-faint">{language || "code"}</span>
        <button onClick={() => void copy()} className="flex items-center gap-1 text-[10px] text-muted hover:text-ink">
          {copied ? <Check size={11} className="text-accent-ink" /> : <Copy size={11} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="p-3 overflow-x-auto text-[11.5px] leading-[1.65]">
        <code className="font-mono">{code}</code>
      </pre>
    </div>
  );
};

export const MessageContent: React.FC<{ message: Message }> = ({ message }) => {
  const segments = parseSegments(message.content);
  const attachment = message.metadata?.attachment;

  return (
    <div>
      {attachment && (
        <div className="flex items-center gap-1.5 mb-1.5 text-[10px] text-muted">
          <FileText size={11} className="shrink-0" />
          <span className="truncate max-w-[220px]">{attachment.name}</span>
          <span className="text-faint">{Math.max(1, Math.round(attachment.bytes / 1024))} KB</span>
        </div>
      )}
      {segments.map((segment, index) =>
        segment.type === "code" ? (
          <CodeBlock key={`code-${index}`} language={segment.language} code={segment.content} />
        ) : (
          <p
            key={`text-${index}`}
            className="whitespace-pre-wrap break-words text-[12.5px] leading-relaxed"
          >
            {inline(segment.content.replace(/^\n+|\n+$/g, ""))}
          </p>
        )
      )}
      {message.content.length === 0 && (
        <span className="inline-flex gap-1.5 py-1">
          {[0, 0.15, 0.3].map((delay) => (
            <span
              key={delay}
              className="w-1.5 h-1.5 rounded-full bg-faint pulse-dot"
              style={{ animationDelay: `${delay}s` }}
            />
          ))}
        </span>
      )}
    </div>
  );
};

export default MessageContent;
