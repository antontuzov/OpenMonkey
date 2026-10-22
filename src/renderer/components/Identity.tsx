import { MOODS, MOOD_LOGOS, type Mood } from "../../utils/types";

type View = "chat" | "settings";

interface IdentityProps {
  mood: Mood;
  view: View;
  onView: (view: View) => void;
}

const NAV: Array<{ id: View; label: string; glyph: string }> = [
  { id: "chat", label: "Chat", glyph: "💬" },
  { id: "settings", label: "Settings", glyph: "⚙️" },
];

export const Identity: React.FC<IdentityProps> = ({ mood, view, onView }) => {
  const logo = MOOD_LOGOS[mood] ?? MOOD_LOGOS.neutral;

  return (
    <>
      <div className="p-4 pb-3 flex items-center gap-3">
        <img
          src={`/logos/${logo.file}`}
          alt={`OpenMonkey - ${logo.label}`}
          className="w-11 h-11 rounded-full"
          style={{ boxShadow: `0 0 0 2px #fff, 0 0 0 3px ${logo.color}88` }}
        />
        <div className="min-w-0">
          <p className="truncate">OpenMonkey</p>
          <p className="text-[11px] text-muted capitalize truncate">{logo.label}</p>
        </div>
      </div>

      <nav className="px-3 space-y-1">
        {NAV.map((item) => (
          <button
            key={item.id}
            onClick={() => onView(item.id)}
            className={`nav-item ${view === item.id ? "nav-item-active" : ""}`}
          >
            <span aria-hidden>{item.glyph}</span>
            {item.label}
          </button>
        ))}
      </nav>

      <div className="px-4 mt-6">
        <p className="section-label">Mood</p>
        <div className="grid grid-cols-6 gap-1.5" role="group" aria-label="Moods">
          {MOODS.map((name) => (
            <button
              key={name}
              title={MOOD_LOGOS[name].label}
              onClick={() => void window.electron?.setMood(name)}
              className={`aspect-square rounded-full overflow-hidden border-2 ${
                name === mood ? "border-accent" : "border-transparent opacity-65 hover:opacity-100"
              }`}
            >
              <img src={`/logos/${MOOD_LOGOS[name].file}`} alt="" className="w-full h-full" />
            </button>
          ))}
        </div>
        <button onClick={() => void window.electron?.cycleMood()} className="btn w-full mt-3 text-xs">
          Cycle mood
        </button>
      </div>

      <div className="mt-auto p-4">
        <div className="card p-3">
          <p className="section-label">Local only</p>
          <p className="text-[11px] text-muted">
            Bonsai-4B runs on this Mac. Nothing is uploaded, and tool actions wait for your approval.
          </p>
        </div>
      </div>
    </>
  );
};
