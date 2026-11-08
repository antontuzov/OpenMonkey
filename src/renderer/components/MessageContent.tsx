import { useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Check, Copy, FileText, Image as ImageIcon, Quote } from "lucide-react";
import type { CitationPreview, Message } from "../../utils/types";
import { t } from "../i18n";
import { formatSize } from "../format";
import { isDiff, parseInline, createIncrementalParser, type IncrementalParser } from "../markdown";
import { parseMarkdownCached } from "../markdown-cache";
import type { Block, InlineSpan, ListItem } from "../markdown";
import { highlight } from "../highlight";
import type { Token } from "../highlight";

const HEADING: Record<number, { tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6"; className: string }> = {
  1: { tag: "h1", className: "text-[15px]" },
  2: { tag: "h2", className: "text-[13.5px]" },
  3: { tag: "h3", className: "text-[12.5px]" },
  4: { tag: "h4", className: "text-[12px]" },
  5: { tag: "h5", className: "text-[11.5px] text-muted" },
  6: { tag: "h6", className: "text-[11px] text-muted uppercase tracking-wide" },
};

const linkButton = (href: string, children: ReactNode): ReactNode => (
  <button
    onClick={() => void window.electron?.openExternal(href)}
    className="text-accent-ink underline underline-offset-2 hover:opacity-80 break-all text-left"
    title={href}
  >
    {children}
  </button>
);

/**
 * A citation the model used. Clicking it asks the main process what it points at
 * and shows the source, so the answer can be checked without leaving the chat.
 */
const CitationChip: React.FC<{ label: string }> = ({ label }) => {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<CitationPreview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const toggle = async () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    setError("");
    setLoading(true);
    try {
      const result = await window.electron?.resolveCitation(label);
      if (result) setPreview(result);
      else setError("This citation could not be resolved.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button onClick={() => void toggle()} className="citation-chip" title={label} type="button">
        <Quote size={9} className="shrink-0" />
        {label}
      </button>
      {open && (
        <span className="citation-panel">
          {loading && <span className="text-faint">Looking up the source…</span>}
          {!loading && error && <span className="text-danger">{error}</span>}
          {!loading && preview && (
            <>
              <span className="block text-ink font-semibold">{preview.title}</span>
              {preview.path && (
                <span className="block text-[10px] font-mono text-faint mt-0.5 break-all">
                  {preview.path}
                  {preview.startLine ? `:${preview.startLine}-${preview.endLine}` : ""}
                </span>
              )}
              {preview.citedLine && preview.startLine ? (
                <span className="block mt-1.5 whitespace-pre-wrap break-words">
                  {preview.text.split("\n").map((line, index) => {
                    const number = preview.startLine! + index;
                    return number === preview.citedLine ? (
                      <span key={index} className="citation-line">
                        {line}
                      </span>
                    ) : (
                      <span key={index}>{line}</span>
                    );
                  })}
                </span>
              ) : (
                <span className="block mt-1.5 whitespace-pre-wrap break-words">{preview.text}</span>
              )}
              {!preview.found && (
                <span className="block mt-1.5 text-warn">This source is gone or was never there.</span>
              )}
            </>
          )}
        </span>
      )}
    </>
  );
};

function spanNode(span: InlineSpan, key: string): ReactNode {
  switch (span.kind) {
    case "strong":
      return (
        <strong key={key} className="font-semibold">
          {renderSpans(parseInline(span.text), "s")}
        </strong>
      );
    case "em":
      return (
        <em key={key} className="italic">
          {renderSpans(parseInline(span.text), "e")}
        </em>
      );
    case "strike":
      return (
        <span key={key} className="line-through text-muted">
          {span.text}
        </span>
      );
    case "code":
      return (
        <code key={key} className="px-1 py-0.5 rounded bg-card-2 border border-line font-mono text-[11px]">
          {span.text}
        </code>
      );
    case "link":
      return linkButton(span.href, span.text || span.href);
    case "citation":
      return <CitationChip key={key} label={span.text} />;
    default:
      return span.text;
  }
}

function renderSpans(spans: InlineSpan[], prefix: string): ReactNode[] {
  return spans.map((span, index) => spanNode(span, `${prefix}${index}`));
}

const TokenLine: React.FC<{ tokens: Token[] }> = ({ tokens }) => (
  <>
    {tokens.map((token, index) =>
      token.kind === "plain" ? (
        <span key={index}>{token.text}</span>
      ) : (
        <span key={index} className={`tok-${token.kind}`}>
          {token.text}
        </span>
      )
    )}
  </>
);

/** Diff lines read as a patch, not as code: the sign carries the colour. */
const DiffBlock: React.FC<{ code: string }> = ({ code }) => (
  <pre className="p-3 overflow-x-auto text-[11.5px] leading-[1.65] font-mono">
    {code.split("\n").map((line, index) => {
      const kind = line.startsWith("@@")
        ? "diff-hunk"
        : line.startsWith("+")
          ? "diff-add"
          : line.startsWith("-")
            ? "diff-del"
            : "";
      return (
        <div key={index} className={kind || undefined}>
          {line || " "}
        </div>
      );
    })}
  </pre>
);

const CodeBlock: React.FC<{ language: string; code: string }> = ({ language, code }) => {
  const [copied, setCopied] = useState(false);
  const patch = useMemo(() => isDiff(language, code), [language, code]);
  const lines = useMemo(() => (patch ? [] : highlight(code, language)), [code, language, patch]);

  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="my-2.5 rounded-xl border border-line overflow-hidden bg-card-2">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-line">
        <span className="text-[9.5px] uppercase tracking-[0.14em] text-faint">
          {patch ? "diff" : language || "code"}
        </span>
        <button
          onClick={() => void copy()}
          className="flex items-center gap-1 text-[10px] text-muted hover:text-ink"
          aria-label={t("chat.copyCodeAria")}
        >
          {copied ? <Check size={11} className="text-accent-ink" /> : <Copy size={11} />}
          <span aria-live="polite">{copied ? t("chat.copyCodeDone") : t("chat.copyCode")}</span>
        </button>
      </div>
      {patch ? (
        <DiffBlock code={code} />
      ) : (
        <pre className="p-3 overflow-x-auto text-[11.5px] leading-[1.65]">
          <code className="font-mono">
            {lines.map((tokens, index) => (
              <span key={index} className="block">
                <TokenLine tokens={tokens} />
              </span>
            ))}
          </code>
        </pre>
      )}
    </div>
  );
};

const Checkbox: React.FC<{ checked: boolean }> = ({ checked }) => (
  <span
    role="img"
    aria-label={t(checked ? "chat.taskDone" : "chat.taskOpen")}
    className={`shrink-0 mt-[3px] w-[11px] h-[11px] rounded-[3px] border flex items-center justify-center ${
      checked ? "bg-accent-soft border-accent-ink text-accent-ink" : "border-line bg-card"
    }`}
  >
    {checked && <Check size={8} strokeWidth={3} />}
  </span>
);

const Item: React.FC<{ item: ListItem; number: number; depth: number }> = ({ item, number, depth }) => (
  <li className="flex flex-col gap-1">
    <div className="flex gap-1.5">
      {item.checked === null ? (
        <span className="shrink-0 mt-[2px] min-w-[15px] text-faint font-mono text-[11px] leading-[1.75]">
          {item.ordered ? `${number}.` : depth % 2 ? "◦" : "•"}
        </span>
      ) : (
        <Checkbox checked={item.checked} />
      )}
      <span className="min-w-0 flex-1 break-words">{renderSpans(item.spans, `i${depth}${number}`)}</span>
    </div>
    {item.children.length > 0 && (
      <ul role="list" className="pl-4 m-0 list-none flex flex-col gap-1">
        {item.children.map((child, index) => (
          <Item key={index} item={child} number={index + 1} depth={depth + 1} />
        ))}
      </ul>
    )}
  </li>
);

const BlockView: React.FC<{ block: Block }> = ({ block }) => {
  switch (block.kind) {
    case "heading": {
      const heading = HEADING[block.level] ?? HEADING[3];
      const Tag = heading.tag;
      return (
        <Tag className={`${heading.className} font-semibold mt-3 mb-1 first:mt-0`}>
          {renderSpans(block.spans, "h")}
        </Tag>
      );
    }
    case "paragraph":
      return (
        <p className="whitespace-pre-wrap break-words text-[12.5px] leading-relaxed my-1.5 first:mt-0 last:mb-0">
          {renderSpans(block.spans, "p")}
        </p>
      );
    case "list":
      return (
        <ul role="list" className="my-1.5 text-[12.5px] leading-relaxed flex flex-col gap-1 list-none">
          {block.items.map((item, index) => (
            <Item key={index} item={item} number={index + 1} depth={0} />
          ))}
        </ul>
      );
    case "quote":
      return (
        <blockquote className="my-2 pl-2.5 border-l-2 border-accent/40 text-muted italic">
          {block.blocks.map((inner, index) => (
            <BlockView key={index} block={inner} />
          ))}
        </blockquote>
      );
    case "table":
      return (
        <div className="my-2.5 overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-[11.5px] border-collapse">
            <thead>
              <tr className="bg-card-2">
                {block.header.map((cell, index) => (
                  <th
                    key={index}
                    className="px-2.5 py-1.5 text-left font-semibold border-b border-line"
                    style={{ textAlign: block.aligns[index] ?? "left" }}
                  >
                    {renderSpans(cell, `th${index}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-b border-line/60 last:border-b-0">
                  {row.map((cell, cellIndex) => (
                    <td
                      key={cellIndex}
                      className="px-2.5 py-1.5 align-top"
                      style={{ textAlign: block.aligns[cellIndex] ?? "left" }}
                    >
                      {renderSpans(cell, `td${rowIndex}-${cellIndex}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "code":
      return <CodeBlock language={block.language} code={block.code} />;
    case "rule":
      return <hr className="my-3 border-t border-line" />;
  }
};

export const MessageContent: React.FC<{ message: Message; incremental?: boolean }> = ({
  message,
  incremental = false,
}) => {
  const parser = useRef<IncrementalParser | null>(null);
  const blocks = useMemo(() => {
    if (!incremental) return parseMarkdownCached(message.content);
    // An answer that is still arriving is parsed once, not once per token.
    parser.current ??= createIncrementalParser();
    return parser.current.update(message.content);
  }, [message.content, incremental]);
  const attachments = message.metadata?.attachments ?? [];

  return (
    <div>
      {attachments.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-1.5 text-[10px] text-muted">
          {attachments.map((attachment) => (
            <span key={attachment.name} className="inline-flex items-center gap-1.5">
              {attachment.kind === "image" ? (
                <ImageIcon size={11} className="shrink-0" />
              ) : (
                <FileText size={11} className="shrink-0" />
              )}
              <span className="truncate max-w-[220px]">{attachment.name}</span>
              <span className="text-faint">{formatSize(attachment.bytes)}</span>
            </span>
          ))}
        </div>
      )}
      {blocks.map((block) => (
        <BlockView key={`${block.kind}:${block.offset}`} block={block} />
      ))}
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
