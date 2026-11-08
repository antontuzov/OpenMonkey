import { useEffect, useState } from "react";
import { Check, Download, FolderOpen, Loader, Pause, Play, RefreshCw, Trash2, TriangleAlert } from "lucide-react";
import { BONSAI_4B } from "../../models/catalog";
import { formatNumber } from "../format";
import type { ModelDownloadStatus } from "../../utils/types";

interface ModelDownloadCardProps {
  installed: boolean;
  ready: boolean;
  onChanged: () => void | Promise<void>;
  compact?: boolean;
}

const mb = (bytes: number) => `${formatNumber(bytes / 1_000_000, { maximumFractionDigits: 0 })} MB`;
const rate = (bytesPerSecond: number) =>
  `${formatNumber(bytesPerSecond / 1_000_000, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB/s`;

/** Human ETA from the measured download speed; "—" until the speed is known. */
const eta = (bytesRemaining: number, bytesPerSecond: number) => {
  if (bytesPerSecond <= 0 || bytesRemaining <= 0) return null;
  const minutes = bytesRemaining / bytesPerSecond / 60;
  if (minutes < 1) return "less than a minute left";
  if (minutes < 60) return `${Math.ceil(minutes)} min left`;
  return `${Math.floor(minutes / 60)} h ${Math.round(minutes % 60)} min left`;
};

export const ModelDownloadCard: React.FC<ModelDownloadCardProps> = ({
  installed,
  ready,
  onChanged,
  compact = false,
}) => {
  const [download, setDownload] = useState<ModelDownloadStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    let alive = true;
    void window.electron?.getModelDownloadStatus().then((status) => {
      if (alive) setDownload(status);
    }).catch(() => undefined);
    const unsubscribe = window.electron?.onModelDownloadStatus((status) => setDownload(status));
    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, []);

  const phase = download?.phase ?? "idle";
  const downloading = phase === "downloading";
  const verifying = phase === "verifying";
  const paused = phase === "cancelled";
  const failed = phase === "error";
  const total = download?.totalBytes || BONSAI_4B.bytes;
  const received = download?.bytesReceived ?? (installed ? BONSAI_4B.bytes : 0);
  const percent = total > 0 ? Math.min(100, (received / total) * 100) : 0;

  const start = () => {
    void window.electron
      ?.downloadModel()
      .then(async (status) => {
        if (status) setDownload(status);
        await onChanged();
      })
      .catch(() => undefined);
  };

  const pause = () => {
    void window.electron?.cancelModelDownload();
  };

  const importFile = () => {
    setBusy(true);
    void window.electron
      ?.importModel()
      .then(async (status) => {
        if (status) setDownload(status);
        await onChanged();
      })
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };

  const verify = async () => {
    setBusy(true);
    try {
      const status = await window.electron?.verifyModel();
      if (status) setDownload(status);
    } finally {
      setBusy(false);
    }
  };

  const useModel = async () => {
    setBusy(true);
    try {
      await window.electron?.reloadModel();
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  const removeModel = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      window.setTimeout(() => setConfirmDelete(false), 4_000);
      return;
    }
    setConfirmDelete(false);
    setBusy(true);
    try {
      const status = await window.electron?.deleteModel();
      if (status) setDownload(status);
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  const statusChip = (() => {
    if (downloading) return `${Math.round(percent)}%`;
    if (verifying) return "verifying";
    if (paused) return "paused";
    if (failed) return "needs attention";
    if (installed) return download?.verified === true ? "verified" : "installed";
    return "not downloaded";
  })();

  const statusCopy = (() => {
    if (failed) return download?.error ?? "The download did not finish.";
    if (paused) return `${mb(received)} kept on disk. Resume picks up where it stopped.`;
    if (verifying) return "Checking the file against the pinned SHA-256…";
    if (downloading) {
      const speed = download?.speedBytesPerSecond ?? 0;
      const remaining = Math.max(0, total - received);
      const parts = [`${mb(received)} of ${mb(total)}`];
      if (speed > 0) parts.push(rate(speed));
      const left = eta(remaining, speed);
      if (left) parts.push(left);
      return parts.join(" · ");
    }
    if (download?.verified === true) return "SHA-256 matches the pinned release. Ready to run.";
    if (installed) return `${mb(BONSAI_4B.bytes)} on this Mac. Verify it any time.`;
    return `${mb(BONSAI_4B.bytes)} · one download, then every answer stays on this Mac.`;
  })();

  /** What the volume holds against what the download still needs, before anything is pressed. */
  const spaceLine = (() => {
    const required = download?.requiredBytes;
    const available = download?.availableBytes;
    if (installed || downloading || verifying || required == null || available == null) return null;
    return available < required
      ? { short: true, text: `Needs ${mb(required)} free; ${mb(available)} available on this volume.` }
      : { short: false, text: `${mb(available)} free on this volume; ${mb(required)} needed.` };
  })();

  /** An installed file that is a model but not the pinned release says so here. */
  const mismatch = installed && download?.verified === false ? (download?.error ?? null) : null;

  return (
    <div className={compact ? "" : "card p-4"}>
      <div className="flex items-start gap-3">
        <span className="w-8 h-8 rounded-lg bg-card-2 border border-line flex items-center justify-center shrink-0">
          {verifying ? (
            <Loader size={15} className="text-accent-ink animate-spin" />
          ) : installed ? (
            <Check size={15} className="text-accent-ink" />
          ) : (
            <Download size={15} className="text-muted" />
          )}
        </span>
        <div className="min-w-0">
          <p className="row-title">{BONSAI_4B.name} GGUF</p>
          <p className="row-copy">{statusCopy}</p>
        </div>
        <span className={`chip ms-auto shrink-0 ${installed && download?.verified === true ? "chip-accent" : ""}`}>
          {statusChip}
        </span>
      </div>

      {(downloading || verifying) && (
        <div className="mt-3 h-1.5 rounded-full bg-line overflow-hidden" role="progressbar" aria-valuenow={Math.round(percent)}>
          <div
            className="h-full bg-accent rounded-full transition-[width] duration-300"
            style={{ width: verifying ? "100%" : `${percent}%` }}
          />
        </div>
      )}

      {failed && (
        <div className="flex items-start gap-2 mt-3 text-danger">
          <TriangleAlert size={13} className="mt-0.5 shrink-0" />
          <p className="text-[10.5px] leading-relaxed">{download?.error}</p>
        </div>
      )}

      {mismatch && !failed && (
        <div className="flex items-start gap-2 mt-3 text-warn">
          <TriangleAlert size={13} className="mt-0.5 shrink-0" />
          <p className="text-[10.5px] leading-relaxed">{mismatch}</p>
        </div>
      )}

      <div className="flex items-center gap-2 mt-3.5">
        {downloading ? (
          <button onClick={pause} className="btn">
            <Pause size={12} />
            Pause
          </button>
        ) : verifying ? (
          <button disabled className="btn">
            <Loader size={12} className="animate-spin" />
            Verifying
          </button>
        ) : installed ? (
          <>
            {!compact && (
              <button onClick={() => void verify()} disabled={busy} className="btn">
                <RefreshCw size={12} className={busy ? "animate-spin" : ""} />
                Verify
              </button>
            )}
            {!ready && (
              <button onClick={() => void useModel()} disabled={busy} className="btn btn-primary">
                <Play size={12} />
                Use model
              </button>
            )}
            {!compact && (
              <button
                onClick={() => void removeModel()}
                disabled={busy}
                aria-label="Delete model from this Mac"
                className={`btn !ms-auto shrink-0 ${confirmDelete ? "!text-danger" : ""}`}
              >
                <Trash2 size={12} />
                {confirmDelete ? "Confirm delete" : "Delete"}
              </button>
            )}
          </>
        ) : (
          <>
            <button onClick={start} disabled={verifying || busy} className="btn btn-primary">
              {paused || failed ? <Play size={12} /> : <Download size={12} />}
              {paused ? "Resume" : failed ? "Retry" : "Download"}
            </button>
            {!compact && (
              <button onClick={importFile} disabled={busy} className="btn">
                <FolderOpen size={12} />
                Use a file I have
              </button>
            )}
          </>
        )}
        {!compact && !installed && !downloading && (
          <span className="text-[10px] text-faint">Checked against the pinned SHA-256 before it loads.</span>
        )}
      </div>

      {spaceLine && !compact && (
        <p className={`text-[10px] mt-2.5 ${spaceLine.short ? "text-warn" : "text-faint"}`}>{spaceLine.text}</p>
      )}
    </div>
  );
};

export default ModelDownloadCard;
