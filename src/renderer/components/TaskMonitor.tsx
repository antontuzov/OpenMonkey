import { useEffect, useState } from "react";
import type { Task } from "../../utils/types";

const STATUS_STYLE: Record<Task["status"], { dot: string; label: string }> = {
  pending: { dot: "bg-faint", label: "queued" },
  "awaiting-approval": { dot: "bg-warn", label: "waiting for you" },
  running: { dot: "bg-accent", label: "running" },
  completed: { dot: "bg-accent-ink", label: "done" },
  failed: { dot: "bg-danger", label: "failed" },
  denied: { dot: "bg-faint", label: "denied" },
};

export const TaskMonitor: React.FC = () => {
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
    <div>
      <p className="section-label">Active tasks</p>
      <div className="space-y-2">
        {tasks.map((task) => {
          const style = STATUS_STYLE[task.status];
          const detail = task.error ?? task.result;
          return (
            <div key={task.id} className="card px-3 py-3">
              <div className="flex items-start gap-3">
                <span className="text-[17px] leading-6" aria-hidden>
                  {task.emoji}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] break-words">{task.description}</p>
                  <span className="chip mt-2">
                    <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
                    {style.label}
                  </span>
                </div>
              </div>
              {detail && (
                <>
                  <button
                    onClick={() => setExpanded(expanded === task.id ? null : task.id)}
                    className="text-faint hover:text-muted text-[11px] mt-2"
                  >
                    {expanded === task.id ? "Hide output" : "Show output"}
                  </button>
                  {expanded === task.id && (
                    <pre className="mt-2 bg-card-2 border border-line rounded-lg p-2 text-[11px] text-muted max-h-40 overflow-auto whitespace-pre-wrap">
                      {detail}
                    </pre>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
      {tasks.length === 0 && (
        <div className="card px-3 py-6 text-center text-faint text-[11px]">
          Nothing running. Ask for a file, a page or a command and it shows up here.
        </div>
      )}
    </div>
  );
};
