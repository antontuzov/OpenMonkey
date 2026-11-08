import { AlertTriangle, Globe, Terminal } from "lucide-react";
import type { ToolPreview } from "../../utils/types";

interface ToolPreviewCardProps {
  preview: ToolPreview;
  /** The Quick Ask popover has room for a shorter card. */
  compact?: boolean;
}

const lineClass = (line: string): string => {
  if (line.startsWith("+")) return "text-accent-ink";
  if (line.startsWith("-")) return "text-danger";
  return "text-muted";
};

/**
 * What the agent is about to do, drawn as a card: the diff of a write, the
 * fields of an event, a command with what it means, or the page it will read.
 */
export const ToolPreviewCard: React.FC<ToolPreviewCardProps> = ({ preview, compact = false }) => {
  if (preview.kind === "diff") {
    return (
      <div className="rounded-xl border border-line bg-card-2 overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-line">
          <span className="text-[11px] font-semibold text-ink truncate">{preview.title}</span>
          <span className="chip !h-5 ms-auto shrink-0 !text-[10px]">
            +{preview.added} / −{preview.removed}
          </span>
        </div>
        <pre
          className={`p-3 text-[11px] leading-relaxed whitespace-pre-wrap break-words font-mono overflow-auto ${
            compact ? "max-h-24" : "max-h-64"
          }`}
        >
          {preview.body.split("\n").map((line, index) => (
            <span key={index} className={`${lineClass(line)} block`}>
              {line || " "}
            </span>
          ))}
        </pre>
        {preview.note && <p className="px-3 py-2 text-[10.5px] text-faint border-t border-line">{preview.note}</p>}
      </div>
    );
  }

  if (preview.kind === "command") {
    return (
      <div className="rounded-xl border border-line bg-card-2 overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-line">
          <Terminal size={12} className="text-muted shrink-0" />
          <span className="text-[11px] font-semibold text-ink">{preview.title}</span>
        </div>
        <pre className="px-3 pt-2 text-[11px] font-mono text-ink whitespace-pre-wrap break-words">
          $ {preview.command}
        </pre>
        <p className="px-3 pt-1 text-[10px] font-mono text-faint truncate" title={preview.cwd}>
          in {preview.cwd}
        </p>
        <p className="px-3 pt-2 text-[11px] text-muted leading-relaxed">{preview.explanation}</p>
        {preview.risks.length > 0 && (
          <ul className="px-3 pt-2 space-y-1">
            {preview.risks.map((risk) => (
              <li key={risk} className="flex items-start gap-1.5 text-[10.5px] text-warn leading-relaxed">
                <AlertTriangle size={11} className="shrink-0 mt-0.5" />
                <span>{risk}</span>
              </li>
            ))}
          </ul>
        )}
        {preview.note && <p className="px-3 py-2 text-[10.5px] text-faint">{preview.note}</p>}
      </div>
    );
  }

  if (preview.kind === "page") {
    return (
      <div className="rounded-xl border border-line bg-card-2 overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-line">
          <Globe size={12} className="text-muted shrink-0" />
          <span className="text-[11px] font-semibold text-ink truncate">{preview.title}</span>
        </div>
        <p className="px-3 pt-2 text-[10px] font-mono text-faint truncate" title={preview.url}>
          {preview.url}
        </p>
        <p className="px-3 pt-1.5 text-[11.5px] font-semibold text-ink leading-snug">{preview.heading}</p>
        <pre
          className={`px-3 pb-3 pt-1.5 text-[10.5px] leading-relaxed text-muted whitespace-pre-wrap break-words font-sans overflow-auto ${
            compact ? "max-h-20" : "max-h-48"
          }`}
        >
          {preview.snippet}
        </pre>
      </div>
    );
  }

  if (preview.kind === "fields") {
    return (
      <div className="rounded-xl border border-line bg-card-2 overflow-hidden">
        <div className="px-3 py-2 border-b border-line">
          <span className="text-[11px] font-semibold text-ink">{preview.title}</span>
        </div>
        <dl className="px-3 py-2 space-y-1.5">
          {preview.fields.map((entry) => (
            <div key={entry.label} className="flex gap-2 items-baseline">
              <dt className="text-[10px] text-faint shrink-0 w-[64px]">{entry.label}</dt>
              <dd className="text-[11px] text-ink break-words min-w-0">{entry.value}</dd>
            </div>
          ))}
        </dl>
        {preview.body && (
          <pre
            className={`mx-3 mb-2 rounded-lg bg-card p-2.5 text-[10.5px] leading-relaxed text-muted whitespace-pre-wrap break-words font-sans overflow-auto ${
              compact ? "max-h-20" : "max-h-40"
            }`}
          >
            {preview.body}
          </pre>
        )}
        {preview.note && <p className="px-3 pb-2 text-[10.5px] text-faint leading-relaxed">{preview.note}</p>}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-line bg-card-2 overflow-hidden">
      <div className="px-3 py-2 border-b border-line">
        <span className="text-[11px] font-semibold text-ink">{preview.title}</span>
      </div>
      <pre className="p-3 text-[10.5px] leading-relaxed text-muted whitespace-pre-wrap break-words font-mono overflow-auto max-h-64">
        {preview.body}
      </pre>
    </div>
  );
};
