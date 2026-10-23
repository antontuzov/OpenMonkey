import { useEffect, useRef, useState } from "react";
import { CheckCircle2, TriangleAlert, X } from "lucide-react";

type Tone = "ok" | "error";
interface Entry {
  id: number;
  text: string;
  tone: Tone;
}

let push: ((text: string, tone: Tone) => void) | null = null;
let nextId = 1;

/** Fire-and-forget confirmation used for small successes. */
export function toast(text: string, tone: Tone = "ok"): void {
  push?.(text, tone);
}

export const ToastHost: React.FC = () => {
  const [entries, setEntries] = useState<Entry[]>([]);
  const timers = useRef(new Map<number, number>());

  useEffect(() => {
    push = (text, tone) => {
      const id = nextId++;
      setEntries((current) => [...current.slice(-2), { id, text, tone }]);
      const timer = window.setTimeout(() => {
        setEntries((current) => current.filter((entry) => entry.id !== id));
        timers.current.delete(id);
      }, 3400);
      timers.current.set(id, timer);
    };
    return () => {
      push = null;
      for (const timer of timers.current.values()) window.clearTimeout(timer);
      timers.current.clear();
    };
  }, []);

  const dismiss = (id: number) => {
    const timer = timers.current.get(id);
    if (timer) window.clearTimeout(timer);
    timers.current.delete(id);
    setEntries((current) => current.filter((entry) => entry.id !== id));
  };

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="fixed bottom-5 right-5 z-[60] flex flex-col gap-2 pointer-events-none"
    >
      {entries.map((entry) => (
        <div
          key={entry.id}
          role="status"
          className="pointer-events-auto card flex items-center gap-2.5 pl-3 pr-2 py-2.5 max-w-[340px]"
          style={{ boxShadow: "var(--shadow-pop)" }}
        >
          {entry.tone === "ok" ? (
            <CheckCircle2 size={14} className="text-accent-ink shrink-0" />
          ) : (
            <TriangleAlert size={14} className="text-danger shrink-0" />
          )}
          <p className="text-[11.5px] leading-snug flex-1">{entry.text}</p>
          <button onClick={() => dismiss(entry.id)} className="icon-btn !w-6 !h-6 shrink-0" aria-label="Dismiss">
            <X size={11} />
          </button>
        </div>
      ))}
    </div>
  );
};
