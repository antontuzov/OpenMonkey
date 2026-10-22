import { useEffect, useState } from "react";
import { Check, Download, Loader, Pause, Play, RefreshCw, TriangleAlert } from "lucide-react";
import { BONSAI_4B } from "../../models/catalog";
import type { ModelDownloadStatus } from "../../utils/types";

interface ModelDownloadCardProps {
  installed: boolean;
  ready: boolean;
  onChanged: () => void | Promise<void>;
  compact?: boolean;
}

const mb = (bytes: number) => `${Math.round(bytes / 1_000_000)} MB`;
const rate = (bytesPerSecond: number) => `${(bytesPerSecond / 1_000_000).toFixed(1)} MB/s`;

export const ModelDownloadCard: React.FC<ModelDownloadCardProps> = ({
  installed,
  ready,
  onChanged,
  compact = false,
}) => {
  const [download, setDownload] = useState<ModelDownloadStatus | null>(null);
  const [busy, setBusy] = useState(false);

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
      return `${mb(received)} of ${mb(total)}${speed > 0 ? ` · ${rate(speed)}` : ""}`;
    }
    if (download?.verified === true) return "SHA-256 matches the pinned release. Ready to run.";
    if (installed) return `${mb(BONSAI_4B.bytes)} on this Mac. Verify it any time.`;
    return `${mb(BONSAI_4B.bytes)} · one download, then every answer stays on this Mac.`;
  })();

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
        <span className={`chip ml-auto shrink-0 ${installed && download?.verified === true ? "chip-accent" : ""}`}>
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
          </>
        ) : (
          <button onClick={start} disabled={verifying} className="btn btn-primary">
            {paused || failed ? <Play size={12} /> : <Download size={12} />}
            {paused ? "Resume" : failed ? "Retry" : "Download"}
          </button>
        )}
        {!compact && !installed && !downloading && (
          <span className="text-[10px] text-faint">Signed download from Hugging Face, verified locally.</span>
        )}
      </div>
    </div>
  );
};

export default ModelDownloadCard;
