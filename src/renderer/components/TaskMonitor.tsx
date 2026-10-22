import { useEffect, useState } from "react";
import {
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Files,
  Globe,
  Lock,
  LockOpen,
  SquareTerminal,
} from "lucide-react";
import type { Task } from "../../utils/types";

const STATUS_STYLE: Record<Task["status"], { dot: string; label: string }> = {
  pending: { dot: "bg-faint", label: "queued" },
  "awaiting-approval": { dot: "bg-warn", label: "needs you" },
  running: { dot: "bg-accent", label: "running" },
  completed: { dot: "bg-accent-ink", label: "done" },
  failed: { dot: "bg-danger", label: "failed" },
  denied: { dot: "bg-faint", label: "denied" },
};

const TOOLS = [
  { icon: Files, name: "Files", copy: "Read, write and move files" },
  { icon: Globe, name: "Web", copy: "Fetch pages and open links" },
  { icon: SquareTerminal, name: "Shell", copy: "Run commands on this Mac" },
  { icon: CalendarClock, name: "Calendar & mail", copy: "Draft events and emails" },
];

export const TaskMonitor: React.FC<{ autoExecute: boolean }> = ({ autoExecute }) => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    const api = window.electron;
    if (!api) return;

    void api.getTasks().then(setTasks).catch(() => undefined);
    return api.onTaskUpdate((task) =>
      setTasks((prev) => {
        const index = prev.findIndex((item) => item.id === task.id);
        if (index < 0) return [task, ...prev];
        const next = [...prev];
        next[index] = task;
        return next;
      })
    );
  }, []);

  return (
    <div className="p-3">
      <div className="flex items-center justify-between px-1 mb-2">
        <p className="section-label !mb-0">Tasks</p>
        <span className="text-[10px] text-faint">{tasks.length}</span>
      </div>

      {tasks.length > 0 ? (
        <div className="card overflow-hidden">
          {tasks.map((task) => {
            const style = STATUS_STYLE[task.status];
            const detail = task.error ?? task.result;
            const isOpen = expanded === task.id;
            return (
              <div key={task.id} className="px-3 py-3 border-b border-line last:border-b-0">
                <div className="flex items-start gap-2.5">
                  <span className="w-7 h-7 rounded-lg bg-card-2 flex items-center justify-center text-[14px] shrink-0">
                    {task.emoji}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11.5px] leading-snug break-words">{task.description}</p>
                    <span className="chip mt-1.5 !h-5 !text-[10px]">
                      <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
                      {style.label}
                    </span>
                  </div>
                </div>
                {detail && (
                  <>
                    <button
                      onClick={() => setExpanded(isOpen ? null : task.id)}
                      className="flex items-center gap-1 text-[10.5px] text-faint hover:text-muted mt-1.5 ml-9"
                    >
                      {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      Output
                    </button>
                    {isOpen && (
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
          <p className="text-[11px] text-ink">Nothing running yet</p>
          <p className="text-[10.5px] text-faint leading-relaxed mt-1">
            Ask for a file, a page or a command and it shows up here.
          </p>
        </div>
      )}

      <div className="flex items-center justify-between px-1 mt-5 mb-2">
        <p className="section-label !mb-0">Tools</p>
        <span className={`chip !h-5 !text-[10px] ${autoExecute ? "" : "chip-accent"}`}>
          {autoExecute ? <LockOpen size={10} /> : <Lock size={10} />}
          {autoExecute ? "free" : "asks first"}
        </span>
      </div>

      <div className="card overflow-hidden">
        {TOOLS.map((tool) => {
          const Icon = tool.icon;
          return (
            <div key={tool.name} className="row !py-2.5 !gap-2.5">
              <div className="flex items-center gap-2.5 min-w-0">
                <Icon size={15} className="text-faint shrink-0" />
                <div className="min-w-0">
                  <p className="text-[11.5px] font-semibold leading-tight">{tool.name}</p>
                  <p className="text-[10px] text-faint leading-tight mt-0.5">{tool.copy}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[10px] text-faint leading-relaxed px-1 mt-3">
        Every tool call is logged in the session. Change what asks first in Settings → Approvals.
      </p>
    </div>
  );
};
