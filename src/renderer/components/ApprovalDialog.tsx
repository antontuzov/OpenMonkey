import { useEffect, useRef, useState } from "react";
import { ShieldAlert } from "lucide-react";
import type { ApprovalRequest } from "../../utils/types";
import { t } from "../i18n";

interface ApprovalDialogProps {
  approval: ApprovalRequest;
  agentName: string;
  onResolve: (approved: boolean, remember: boolean) => void;
}

const lineClass = (line: string): string => {
  if (line.startsWith("+")) return "text-accent-ink";
  if (line.startsWith("-")) return "text-danger";
  return "text-muted";
};

export const ApprovalDialog: React.FC<ApprovalDialogProps> = ({ approval, agentName, onResolve }) => {
  const [showRaw, setShowRaw] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const hasDiff = /^[+-] /m.test(approval.preview);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () =>
      Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
        ) ?? []
      );
    focusable()[0]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onResolve(false, false);
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      previous?.focus();
    };
  }, [onResolve]);

  return (
    <div className="fixed inset-0 bg-ink/25 backdrop-blur-[2px] flex items-center justify-center p-6 z-50">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="approval-title"
        aria-describedby="approval-desc"
        className="card max-w-xl w-full max-h-[86vh] flex flex-col p-6"
        style={{ boxShadow: "var(--shadow-pop)" }}
      >
        <div className="flex items-start gap-3 mb-4">
          <span
            className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
            style={{ background: "color-mix(in srgb, var(--color-warn) 16%, transparent)" }}
          >
            <ShieldAlert size={16} className="text-warn" />
          </span>
          <div className="min-w-0">
            <p className="section-label !mb-1">{t("approval.title")}</p>
            <h2 id="approval-title" className="text-[15px] font-semibold leading-snug">
              {approval.request.summary}
            </h2>
          </div>
          <span className="chip !h-5 ml-auto shrink-0 !text-[10px]">
            {approval.policy === "ask" ? t("approval.policyAsk") : t("approval.policyCheck")}
          </span>
        </div>

        <p id="approval-desc" className="text-muted text-[11.5px] leading-relaxed mb-3">
          {t("approval.body", {
            agent: agentName,
            tool: `${approval.request.type}.${approval.request.action}`,
          })}
        </p>

        <div className="rounded-xl border border-line bg-card-2 overflow-auto max-h-64 shrink">
          <pre className="p-3 text-[11px] leading-relaxed whitespace-pre-wrap break-words font-mono">
            {approval.preview.split("\n").map((line, index) => (
              <span key={index} className={`${lineClass(line)} block`}>
                {line || " "}
              </span>
            ))}
          </pre>
        </div>
        {hasDiff && (
          <p className="text-[10px] text-faint mt-1.5">
            {t("approval.previewOnly")}
          </p>
        )}

        <button
          onClick={() => setShowRaw((open) => !open)}
          className="self-start text-[10.5px] text-faint hover:text-muted mt-2"
        >
          {showRaw ? t("approval.hideRaw") : t("approval.showRaw")}
        </button>
        {showRaw && (
          <pre className="mt-1.5 rounded-xl border border-line bg-card-2 p-3 text-[10.5px] text-muted overflow-auto max-h-40">
            {JSON.stringify(approval.request.arguments, null, 2)}
          </pre>
        )}

        <div className="flex flex-wrap justify-end gap-2 mt-5">
          <button onClick={() => onResolve(false, false)} className="btn">
            {t("approval.deny")}
          </button>
          <button
            onClick={() => onResolve(true, true)}
            className="btn"
            title={t("approval.allowSessionTitle")}
          >
            {t("approval.allowSession")}
          </button>
          <button onClick={() => onResolve(true, false)} className="btn btn-primary">
            {t("approval.allowOnce")}
          </button>
        </div>
      </div>
    </div>
  );
};
