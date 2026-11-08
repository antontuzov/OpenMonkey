import { useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Copy,
  Files,
  Globe,
  Lock,
  LockOpen,
  Plug,
  RotateCw,
  Square,
  SquareTerminal,
} from "lucide-react";
import type { McpServerStatus, Task, TaskDiff, TaskStepLabel } from "../../utils/types";
import { diffWindow } from "../../utils/diff";
import { formatDuration, stepDuration, taskDuration } from "../../utils/task-steps";
import { t } from "../i18n";
import { formatNumber } from "../format";

const STATUS_STYLE: Record<Task["status"], { dot: string }> = {
  pending: { dot: "bg-faint" },
  "awaiting-approval": { dot: "bg-warn" },
  running: { dot: "bg-accent" },
  completed: { dot: "bg-accent-ink" },
  failed: { dot: "bg-danger" },
  denied: { dot: "bg-faint" },
  cancelled: { dot: "bg-faint" },
};

const statusLabel = (status: Task["status"]): string => {
  switch (status) {
    case "pending":
      return t("tasks.queued");
    case "awaiting-approval":
      return t("tasks.needsYou");
    case "running":
      return t("tasks.running");
    case "completed":
      return t("tasks.done");
    case "failed":
      return t("tasks.failed");
    case "denied":
      return t("tasks.denied");
    case "cancelled":
      return t("tasks.cancelled");
  }
};

const stepLabel = (label: TaskStepLabel): string => {
  switch (label) {
    case "queued":
      return t("tasks.stepQueued");
    case "approval":
      return t("tasks.stepApproval");
    case "running":
      return t("tasks.stepRunning");
  }
};

const TOOLS = [
  { icon: Files, nameKey: "tools.files", copyKey: "tools.filesCopy" },
  { icon: Globe, nameKey: "tools.web", copyKey: "tools.webCopy" },
  { icon: SquareTerminal, nameKey: "tools.shell", copyKey: "tools.shellCopy" },
  { icon: CalendarClock, nameKey: "tools.calendar", copyKey: "tools.calendarCopy" },
] as const;

/** The stages a task walked through, each with the time it took. */
const Timeline: React.FC<{ steps: NonNullable<Task["steps"]> }> = ({ steps }) => (
  <div data-task-steps className="flex items-center gap-1 flex-wrap mt-1.5 ml-9">
    {steps.map((step, index) => (
      <span key={index} className="flex items-center gap-1">
        {index > 0 && <span className="text-faint/60 text-[10px]">→</span>}
        <span className="chip !h-5 !text-[10px]">
          {stepLabel(step.label)}
          <span className="text-faint font-mono">{formatDuration(stepDuration(step))}</span>
        </span>
      </span>
    ))}
  </div>
);

/** The lines a file write changed, with the sign carrying the colour. */
const DiffView: React.FC<{ diff: TaskDiff }> = ({ diff }) => {
  const lines = useMemo(() => diffWindow(diff.lines), [diff.lines]);
  return (
    <div data-task-diff className="mt-1.5 ml-9 rounded-lg border border-line bg-card-2 overflow-hidden">
      <div className="px-2 py-1.5 border-b border-line flex items-center gap-2 min-w-0">
        <span className="text-[10px] text-muted truncate font-mono">{diff.path}</span>
        <span className="chip !h-4 !text-[9.5px] ml-auto shrink-0">
          <span className="text-accent-ink">+{diff.added}</span>
          <span className="text-danger">−{diff.removed}</span>
        </span>
      </div>
      <div className="max-h-48 overflow-auto">
        {lines.map((line, index) => (
          <div
            key={index}
            className={
              line.kind === "add" ? "diff-add" : line.kind === "del" ? "diff-del" : undefined
            }
          >
            <span className="inline-block w-4 text-center text-faint select-none">
              {line.kind === "add" ? "+" : line.kind === "del" ? "−" : " "}
            </span>
            <span className="text-[10.5px] font-mono whitespace-pre-wrap break-all">
              {line.text || " "}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export const TaskMonitor: React.FC<{ autoExecute: boolean }> = ({ autoExecute }) => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [servers, setServers] = useState<McpServerStatus[]>([]);

  useEffect(() => {
    const api = window.electron;
    if (!api) return;

    void api.getTasks().then(setTasks).catch(() => undefined);
    const unsubscribe = api.onTaskUpdate((task) =>
      setTasks((prev) => {
        const index = prev.findIndex((item) => item.id === task.id);
        if (index < 0) return [task, ...prev];
        const next = [...prev];
        next[index] = task;
        return next;
      })
    );

    void api.getMcpStatus().then(setServers).catch(() => undefined);
    const timer = window.setInterval(() => {
      void api.getMcpStatus().then(setServers).catch(() => undefined);
    }, 15_000);

    return () => {
      unsubscribe();
      window.clearInterval(timer);
    };
  }, []);

  const cancel = (id: string) => {
    void window.electron?.cancelTask(id).catch(() => undefined);
  };

  const retry = (id: string) => {
    void window.electron?.retryTask(id).catch(() => undefined);
  };

  const copy = async (task: Task) => {
    const text = task.command ?? task.diff?.path ?? task.result ?? task.error ?? task.description;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(task.id);
      window.setTimeout(() => setCopied((current) => (current === task.id ? null : current)), 1_500);
    } catch {
      setCopied(null);
    }
  };

  return (
    <div className="p-3">
      <div className="flex items-center justify-between px-1 mb-2">
        <p className="section-label !mb-0">{t("tasks.title")}</p>
        <span className="text-[10px] text-faint">{tasks.length}</span>
      </div>

      {tasks.length > 0 ? (
        <div className="card overflow-hidden">
          {tasks.map((task) => {
            const style = STATUS_STYLE[task.status];
            const detail = task.error ?? task.result ?? task.output;
            const isOpen = expanded === task.id;
            const diffOpen = showDiff === task.id;
            const canKill = task.status === "running" || task.status === "awaiting-approval";
            const canRetry =
              task.status === "failed" || task.status === "cancelled" || task.status === "denied";
            return (
              <div key={task.id} data-task-row className="px-3 py-3 border-b border-line last:border-b-0">
                <div className="flex items-start gap-2.5">
                  <span className="w-7 h-7 rounded-lg bg-card-2 flex items-center justify-center text-[14px] shrink-0">
                    {task.emoji}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11.5px] leading-snug break-words">{task.description}</p>
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <span className="chip !h-5 !text-[10px]">
                        <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
                        {statusLabel(task.status)}
                      </span>
                      {task.steps?.length ? (
                        <span data-task-total className="chip !h-5 !text-[10px] font-mono text-faint">
                          {formatDuration(taskDuration(task.steps))}
                        </span>
                      ) : null}
                      {canKill && (
                        <button
                          onClick={() => cancel(task.id)}
                          className="chip !h-5 !text-[10px] hover:!text-danger hover:!border-danger/40"
                          aria-label={t("tasks.cancelAria", { task: task.description })}
                        >
                          <Square size={8} fill="currentColor" />
                          {t("tasks.kill")}
                        </button>
                      )}
                      {canRetry && (
                        <button
                          onClick={() => retry(task.id)}
                          className="chip !h-5 !text-[10px] hover:!text-ink"
                          aria-label={t("tasks.retryAria", { task: task.description })}
                        >
                          <RotateCw size={9} />
                          {t("tasks.retry")}
                        </button>
                      )}
                      <button
                        onClick={() => void copy(task)}
                        className="chip !h-5 !text-[10px] hover:!text-ink"
                        aria-label={t("tasks.copyAria", { task: task.description })}
                      >
                        <Copy size={9} />
                        {copied === task.id ? t("tasks.copied") : t("tasks.copy")}
                      </button>
                    </div>
                    {task.steps?.length ? <Timeline steps={task.steps} /> : null}
                    {(task.command || task.cwd) && (
                      <p className="text-[10px] text-faint font-mono mt-1.5 truncate">
                        {task.cwd && <span className="text-faint/70">{task.cwd} $ </span>}
                        {task.command}
                      </p>
                    )}
                  </div>
                </div>
                {task.diff && (
                  <>
                    <button
                      onClick={() => setShowDiff(diffOpen ? null : task.id)}
                      className="flex items-center gap-1 text-[10.5px] text-faint hover:text-muted mt-1.5 ml-9"
                    >
                      {diffOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      {t("tasks.change", { added: task.diff.added, removed: task.diff.removed })}
                    </button>
                    {diffOpen && <DiffView diff={task.diff} />}
                  </>
                )}
                {detail && (
                  <>
                    <button
                      onClick={() => setExpanded(isOpen ? null : task.id)}
                      className="flex items-center gap-1 text-[10.5px] text-faint hover:text-muted mt-1.5 ml-9"
                    >
                      {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      {t("tasks.output")}
                    </button>
                    {(isOpen || task.status === "running") && (
                      <pre className="mt-1.5 ml-9 bg-card-2 border border-line rounded-lg p-2 text-[10.5px] text-muted max-h-40 overflow-auto whitespace-pre-wrap">
                        {detail}
                      </pre>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card px-3.5 py-4 text-center">
          <p className="text-[11px] text-ink">{t("tasks.empty")}</p>
          <p className="text-[10.5px] text-faint leading-relaxed mt-1">{t("tasks.emptyCopy")}</p>
        </div>
      )}

      <div className="flex items-center justify-between px-1 mt-5 mb-2">
        <p className="section-label !mb-0">{t("tasks.tools")}</p>
        <span className={`chip !h-5 !text-[10px] ${autoExecute ? "" : "chip-accent"}`}>
          {autoExecute ? <LockOpen size={10} /> : <Lock size={10} />}
          {autoExecute ? t("tasks.policyFree") : t("tasks.policyPerTool")}
        </span>
      </div>

      <div className="card overflow-hidden">
        {TOOLS.map((tool) => {
          const Icon = tool.icon;
          return (
            <div key={tool.nameKey} className="row !py-2.5 !gap-2.5">
              <div className="flex items-center gap-2.5 min-w-0">
                <Icon size={15} className="text-faint shrink-0" />
                <div className="min-w-0">
                  <p className="text-[11.5px] font-semibold leading-tight">{t(tool.nameKey)}</p>
                  <p className="text-[10px] text-faint leading-tight mt-0.5">{t(tool.copyKey)}</p>
                </div>
              </div>
            </div>
          );
        })}
        {servers.map((server) => (
          <div key={server.id} className="row !py-2.5 !gap-2.5">
            <div className="flex items-center gap-2.5 min-w-0">
              <Plug size={15} className="text-faint shrink-0" />
              <div className="min-w-0">
                <p className="text-[11.5px] font-semibold leading-tight truncate">{server.name}</p>
                <p className="text-[10px] text-faint leading-tight mt-0.5">
                  MCP · {t("tasks.mcpToolCount", { count: formatNumber(server.toolCount) })}
                </p>
              </div>
            </div>
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                server.state === "ready" ? "bg-accent" : server.state === "error" ? "bg-danger" : "bg-faint"
              }`}
            />
          </div>
        ))}
      </div>

      <p className="text-[10px] text-faint leading-relaxed px-1 mt-3">{t("tasks.auditNote")}</p>
    </div>
  );
};
