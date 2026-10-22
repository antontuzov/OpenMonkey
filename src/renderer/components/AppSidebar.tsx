import { Activity, ChevronDown, House, MessageSquare, Plus, Settings2, ShieldCheck } from "lucide-react";
import { MOOD_LOGOS, type AgentStatus, type Mood } from "../../utils/types";

interface AppSidebarProps {
  mood: Mood;
  status: AgentStatus;
  agentName: string;
  panelOpen: boolean;
  onTogglePanel: () => void;
  onSettings: () => void;
  onNewChat: () => void;
}

export const AppSidebar: React.FC<AppSidebarProps> = ({
  mood,
  status,
  agentName,
  panelOpen,
  onTogglePanel,
  onSettings,
  onNewChat,
}) => {
  const logo = MOOD_LOGOS[mood] ?? MOOD_LOGOS.neutral;
  const ready = status.state === "ready";

  return (
    <aside className="drag-region w-[264px] shrink-0 bg-card-2 border-r border-line flex flex-col">
      <div className="pt-9 px-3">
        <button
          onClick={onSettings}
          className="no-drag flex items-center gap-2.5 w-full rounded-lg px-2 py-1.5 hover:bg-ink/5 transition-colors"
          title="OpenMonkey settings"
        >
          <img
            src={`/logos/${logo.file}`}
            alt=""
            className="w-7 h-7 rounded-full logo-mood-change"
            style={{ boxShadow: `0 0 0 2px var(--color-card), 0 0 0 3px ${logo.color}66` }}
          />
          <span className="text-[13px] font-semibold tracking-tight truncate">{agentName}</span>
          <ChevronDown size={14} className="ml-auto text-faint" />
        </button>
      </div>

      <nav className="px-2 mt-3 space-y-0.5 no-drag">
        <button className="nav-item nav-item-active">
          <House size={15} />
          Home
        </button>
        <button onClick={onTogglePanel} className={`nav-item ${panelOpen ? "" : ""}`}>
          <Activity size={15} />
          Activity
          <span className="ml-auto text-[10px] text-faint">{panelOpen ? "on" : "off"}</span>
        </button>
        <button onClick={onSettings} className="nav-item">
          <Settings2 size={15} />
          Settings
        </button>
      </nav>

      <div className="flex items-center justify-between px-4 mt-5 mb-2">
        <p className="section-label !mb-0">Sessions</p>
        <button onClick={onNewChat} className="icon-btn !w-6 !h-6" title="New conversation">
          <Plus size={14} />
        </button>
      </div>

      <div className="px-2 no-drag">
        <button className="nav-item nav-item-active justify-between">
          <span className="flex items-center gap-2 min-w-0">
            <MessageSquare size={14} className="shrink-0" />
            <span className="truncate">Main Session</span>
          </span>
          <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
        </button>
      </div>

      <div className="mt-auto p-3 no-drag">
        <div className="card px-3.5 py-3">
          <div className="flex items-center gap-2">
            <ShieldCheck size={14} className="text-accent-ink" />
            <span className="text-[11.5px] font-semibold">Local only</span>
          </div>
          <p className="text-[10.5px] text-faint leading-relaxed mt-1.5">
            The model, chat history and tools all run on this Mac.
          </p>
          <div className="flex items-center gap-1.5 mt-2.5 text-[10.5px] text-muted">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                ready ? "bg-accent" : status.state === "error" ? "bg-danger" : "bg-warn pulse-dot"
              }`}
            />
            <span className="capitalize">{status.state.replace("-", " ")}</span>
            <span className="text-faint">·</span>
            <span>{logo.label}</span>
          </div>
        </div>
      </div>
    </aside>
  );
};
