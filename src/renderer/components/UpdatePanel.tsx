import { useEffect, useRef, useState } from "react";
import { Download, ExternalLink, RotateCcw } from "lucide-react";
import { t, type StringKey } from "../i18n";
import type {
  ReleaseNotes,
  ReleaseNotesPayload,
  RollbackTarget,
  UpdateState,
} from "../../utils/types";

/** The sentence each state is read out in. */
const STATUS_KEY: Record<UpdateState["status"], StringKey> = {
  local: "desktop.updateStatusLocal",
  off: "desktop.updateStatusOff",
  idle: "desktop.updateStatusIdle",
  checking: "desktop.updateStatusChecking",
  "up-to-date": "desktop.updateStatusCurrent",
  available: "desktop.updateStatusAvailable",
  ready: "desktop.updateStatusReady",
  blocked: "desktop.updateStatusBlocked",
  held: "desktop.updateStatusHeld",
  failed: "desktop.updateStatusFailed",
};

const NoteList: React.FC<{ notes: ReleaseNotes }> = ({ notes }) => (
  <div className="mt-2 space-y-2">
    {notes.groups.map((group) => (
      <div key={group.name}>
        <p className="text-[9.5px] uppercase tracking-[0.13em] text-faint">{group.name}</p>
        <ul className="mt-1 space-y-1">
          {group.items.map((item, index) => (
            <li key={`${group.name}-${index}`} className="flex gap-2 text-[11px] leading-relaxed text-muted">
              <span aria-hidden="true" className="text-faint">
                •
              </span>
              <span className="min-w-0">{item}</span>
            </li>
          ))}
        </ul>
      </div>
    ))}
  </div>
);

/**
 * What the app knows about its own version: where it stands against the release
 * that is out, what changed in the build it is running, and how to go back to the
 * build before it.
 */
export const UpdatePanel: React.FC = () => {
  const [state, setState] = useState<UpdateState | null>(null);
  const [notes, setNotes] = useState<ReleaseNotesPayload | null>(null);
  const [rollback, setRollback] = useState<RollbackTarget | null>(null);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  /** A push that arrived after the first question must not be undone by its answer. */
  const pushed = useRef(false);

  useEffect(() => {
    const api = window.electron;
    if (!api) return;
    void api.getUpdateState().then((next) => {
      if (!pushed.current) setState(next);
    }).catch(() => undefined);
    void api.getReleaseNotes().then(setNotes).catch(() => undefined);
    void api.findRollback().then(setRollback).catch(() => undefined);
    return api.onUpdateState((next) => {
      pushed.current = true;
      setState(next);
    });
  }, []);

  const status = state?.status ?? "idle";
  const version = state?.version ?? "";
  const detail = state?.detail ?? "";
  const sentence = t(STATUS_KEY[status], { version, detail });

  const check = async () => {
    setBusy("check");
    setNotice("");
    try {
      const next = await window.electron?.checkForUpdates();
      if (next) setState(next);
    } finally {
      setBusy("");
    }
  };

  const rollBack = async () => {
    setBusy("rollback");
    setNotice("");
    try {
      const result = await window.electron?.startRollback();
      if (result?.ok) setNotice(t("desktop.rollbackDone", { version: rollback?.version ?? "" }));
      else if (result) setNotice(t("desktop.rollbackFailed", { error: result.error ?? "" }));
    } catch (error) {
      setNotice(
        t("desktop.rollbackFailed", { error: error instanceof Error ? error.message : String(error) })
      );
    } finally {
      setBusy("");
    }
  };

  const current = notes?.current ?? null;
  const upcoming = notes?.upcoming ?? null;

  return (
    <>
      <div className="row">
        <div className="min-w-0">
          <p className="row-title">{t("desktop.updateStatus")}</p>
          <p className="row-copy !mt-0 max-w-[52ch]">{sentence}</p>
          {state && state.rollout !== null && state.rollout < 100 ? (
            <p className="text-[10.5px] text-faint mt-1">{t("desktop.updateRollout", { share: state.rollout })}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          {status === "ready" ? (
            <button onClick={() => void window.electron?.installUpdate()} className="btn btn-primary shrink-0">
              <Download size={13} />
              {t("desktop.updateInstall")}
            </button>
          ) : null}
          {status === "available" || status === "blocked" || status === "held" ? (
            <button onClick={() => void window.electron?.openReleasePage()} className="btn shrink-0">
              <ExternalLink size={13} />
              {t("desktop.updateOpenReleases")}
            </button>
          ) : null}
          <button onClick={() => void check()} disabled={busy === "check"} className="btn shrink-0">
            {t("desktop.updateCheckNow")}
          </button>
        </div>
      </div>

      <div className="row !items-start">
        <div className="min-w-0 w-full">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="row-title">{t("desktop.releaseNotes")}</p>
              <p className="row-copy !mt-0 max-w-[52ch]">{t("desktop.releaseNotesCopy")}</p>
            </div>
            <span className="chip shrink-0">{notes?.version ?? state?.currentVersion ?? "—"}</span>
          </div>
          {current ? (
            <>
              <p className="text-[10.5px] text-faint mt-2">
                {current.version}
                {current.releasedAt ? ` — ${current.releasedAt}` : ""}
              </p>
              <NoteList notes={current} />
            </>
          ) : null}
          {upcoming ? (
            <>
              <p className="text-[10.5px] text-faint mt-2">{t("desktop.releaseNotesUpcoming")}</p>
              <NoteList notes={upcoming} />
            </>
          ) : null}
          {!current && !upcoming ? (
            <p className="text-[11px] text-muted mt-2">{t("desktop.releaseNotesNone")}</p>
          ) : null}
        </div>
      </div>

      <div className="row">
        <div className="min-w-0">
          <p className="row-title">{t("desktop.rollback")}</p>
          <p className="row-copy !mt-0 max-w-[52ch]">
            {rollback ? t("desktop.rollbackCopy", { version: rollback.version }) : t("desktop.rollbackNone")}
          </p>
          {notice ? <p className="text-[10.5px] text-muted mt-1">{notice}</p> : null}
        </div>
        <button onClick={() => void rollBack()} disabled={!rollback || busy === "rollback"} className="btn shrink-0">
          <RotateCcw size={13} />
          {rollback ? t("desktop.rollbackStart", { version: rollback.version }) : t("desktop.rollbackStartNone")}
        </button>
      </div>
    </>
  );
};
