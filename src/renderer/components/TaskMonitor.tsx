import { useEffect, useState } from "react";
import {
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Files,
  Globe,
  Lock,
  LockOpen,
  Plug,
  Square,
  SquareTerminal,
} from "lucide-react";
import type { McpServerStatus, Task } from "../../utils/types";
import { t } from "../i18n";

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

const TOOLS = [
  { icon: Files, nameKey: "tools.files", copyKey: "tools.filesCopy" },
  { icon: Globe, nameKey: "tools.web", copyKey: "tools.webCopy" },
  { icon: SquareTerminal, nameKey: "tools.shell", copyKey: "tools.shellCopy" },
  { icon: CalendarClock, nameKey: "tools.calendar", copyKey: "tools.calendarCopy" },
] as const;

export const TaskMonitor: React.FC<{ autoExecute: boolean }> = ({ autoExecute }) => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
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
            const canKill = task.status === "running" || task.status === "awaiting-approval";
            return (
              <div key={task.id} className="px-3 py-3 border-b border-line last:border-b-0">
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
                    </div>
                    {(task.command || task.cwd) && (
                      <p className="text-[10px] text-faint font-mono mt-1.5 truncate">
                        {task.cwd && <span className="text-faint/70">{task.cwd} $ </span>}
                        {task.command}
                      </p>
                    )}
                  </div>
                </div>
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
                  MCP · {t("tasks.mcpToolCount", { count: server.toolCount })}
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
