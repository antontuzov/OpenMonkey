import { useCallback, useEffect, useState } from "react";
import { ChatInterface } from "./components/ChatInterface";
import { TaskMonitor } from "./components/TaskMonitor";
import { Identity } from "./components/Identity";
import { SettingsView } from "./components/SettingsView";
import type { AgentStatus, ApprovalRequest, Mood } from "../utils/types";

type View = "chat" | "settings";

export default function App() {
  const [status, setStatus] = useState<AgentStatus>({ state: "starting" });
  const [mood, setMood] = useState<Mood>("neutral");
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  const [view, setView] = useState<View>("chat");

  useEffect(() => {
    const api = window.electron;
    if (!api) return;

    const unsubscribes = [
      api.onAgentStatus(setStatus),
      api.onAgentReady(() => void api.getAgentStatus().then(setStatus)),
      api.onMoodChange((next) => setMood(next as Mood)),
      api.onApprovalRequest(setApproval),
      api.onOpenSettings(() => setView("settings")),
    ];

    void api.getCurrentMood().then(setMood).catch(() => undefined);
    void api.getAgentStatus().then(setStatus).catch(() => undefined);

    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, []);

  const respond = useCallback(
    async (approved: boolean) => {
      if (!approval) return;
      await window.electron?.approveTask(approval.requestId, approved);
      setApproval(null);
    },
    [approval]
  );

  return (
    <div className="flex h-screen">
      <aside className="drag-region w-[240px] shrink-0 border-r border-line bg-card-2 flex flex-col pt-8">
        <Identity mood={mood} view={view} onView={setView} />
      </aside>

      <main className="flex-1 flex flex-col min-w-0">
        <header className="drag-region h-11 shrink-0 flex items-center justify-between px-4 border-b border-line">
          <div className="flex items-center gap-2 text-faint text-xs">
            <span>{view === "chat" ? "Main Session" : "Settings"}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="chip">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  status.state === "ready" ? "bg-accent" : status.state === "error" ? "bg-danger" : "bg-warn pulse-dot"
                }`}
              />
              {status.state === "ready" ? "Connected" : status.state.replace("-", " ")}
            </span>
          </div>
        </header>

        {view === "chat" ? <ChatInterface status={status} mood={mood} /> : <SettingsView status={status} mood={mood} />}
      </main>

      {view === "chat" && (
        <aside className="w-[300px] shrink-0 border-l border-line bg-card-2 overflow-y-auto p-4">
          <TaskMonitor />
        </aside>
      )}

      {approval && (
        <div className="fixed inset-0 bg-ink/25 flex items-center justify-center p-6 z-50">
          <div className="card max-w-lg w-full p-6">
            <p className="section-label">Action needs approval</p>
            <h2 className="text-[17px] mb-2">{approval.request.summary}</h2>
            <p className="text-muted text-xs mb-4">
              OpenMonkey is about to run{" "}
              <span className="text-ink">
                {approval.request.type}.{approval.request.action}
              </span>
              . Nothing on your machine changes until you allow it.
            </p>
            <pre className="card-plain bg-card-2 border border-line rounded-lg p-3 text-xs text-muted overflow-x-auto max-h-48">
              {JSON.stringify(approval.request.arguments, null, 2)}
            </pre>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => void respond(false)} className="btn">
                Deny
              </button>
              <button onClick={() => void respond(true)} className="btn btn-primary">
                Allow once
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
