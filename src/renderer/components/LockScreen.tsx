import { useEffect, useRef, useState } from "react";
import { Lock, Loader } from "lucide-react";
import { MOOD_LOGOS, type Mood } from "../../utils/types";
import { t } from "../i18n";

interface LockScreenProps {
  mood: Mood;
  onUnlocked: () => void;
}

/**
 * The only surface reachable while the history database is closed, so the sealed
 * conversations never render behind it.
 */
export const LockScreen: React.FC<LockScreenProps> = ({ mood, onUnlocked }) => {
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const logo = MOOD_LOGOS[mood] ?? MOOD_LOGOS.neutral;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async () => {
    const value = passphrase;
    if (!value || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      if (await window.electron?.unlockHistory(value)) {
        // The main process rebuilds these windows, which drops the typed passphrase
        // along with any half-rendered history.
        onUnlocked();
        return;
      }
      setFailed(true);
      setPassphrase("");
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-screen bg-paper flex items-center justify-center p-6">
      <div className="card w-full max-w-sm p-6" style={{ boxShadow: "var(--shadow-pop)" }}>
        <div className="flex items-center gap-3 mb-4">
          <img
            src={`/logos/${logo.file}`}
            alt=""
            className="w-11 h-11 rounded-full"
            style={{ boxShadow: "0 0 0 2px var(--color-accent-soft)" }}
          />
          <div className="min-w-0">
            <p className="section-label !mb-1 flex items-center gap-1.5">
              <Lock size={12} className="text-accent-ink" />
              {t("lock.title")}
            </p>
          </div>
        </div>

        <p className="text-muted text-[11.5px] leading-relaxed mb-4">{t("lock.copy")}</p>

        <label className="block text-[10px] uppercase tracking-[0.14em] text-faint mb-1.5" htmlFor="lock-passphrase">
          {t("lock.passphrase")}
        </label>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <input
            id="lock-passphrase"
            ref={inputRef}
            type="password"
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={failed}
            aria-describedby={failed ? "lock-error" : undefined}
            className="w-full rounded-xl border border-line bg-card-2 px-3 py-2 text-[13px] outline-none focus:border-accent"
          />
          <div className="flex items-center gap-2 mt-3">
            <button type="submit" className="btn btn-primary" disabled={busy || passphrase.length === 0}>
              {busy ? <Loader size={13} className="animate-spin" /> : <Lock size={13} />}
              {busy ? t("lock.unlocking") : t("lock.unlock")}
            </button>
          </div>
        </form>

        <p id="lock-error" role="status" aria-live="polite" className="text-[10.5px] mt-3 min-h-[14px]">
          {failed ? <span className="text-danger">{t("lock.wrong")}</span> : null}
        </p>
        <p className="text-[10px] text-faint leading-relaxed">{t("lock.forgot")}</p>
      </div>
    </div>
  );
};
