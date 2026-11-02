import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Check, Copy, FileText } from "lucide-react";
import type { Message } from "../../utils/types";
import { t } from "../i18n";
import { isDiff, parseInline, parseMarkdown } from "../markdown";
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

export const MessageContent: React.FC<{ message: Message }> = ({ message }) => {
  const blocks = useMemo(() => parseMarkdown(message.content), [message.content]);
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
