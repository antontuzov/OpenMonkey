import { useCallback, useEffect, useMemo, useState } from "react";
import { FileText, RefreshCw, Search } from "lucide-react";
import type { WorkspaceChunk, WorkspaceIndexStatus, WorkspaceSource } from "../../utils/types";

export interface SourceManagerProps {
  status?: WorkspaceIndexStatus;
  enabled: boolean;
  busy: boolean;
  onLoadSources: () => Promise<WorkspaceSource[]>;
  onLoadPreview: (path: string) => Promise<WorkspaceChunk[]>;
  onReindex: (path: string) => Promise<void>;
  onSaveRules: (rules: string[]) => Promise<void>;
}

const shortPath = (file: string): { name: string; folder: string } => {
  const parts = file.split("/").filter(Boolean);
  return { name: parts[parts.length - 1] ?? file, folder: parts.slice(0, -1).join("/") };
};

/**
 * What the index holds: every file it can reach, the passages it cut from each
 * one, and the rules that keep other files out.
 */
export const SourceManager: React.FC<SourceManagerProps> = ({
  status,
  enabled,
  busy,
  onLoadSources,
  onLoadPreview,
  onReindex,
  onSaveRules,
}) => {
  const [sources, setSources] = useState<WorkspaceSource[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [chunks, setChunks] = useState<WorkspaceChunk[]>([]);
  const [filter, setFilter] = useState("");
  const [rules, setRules] = useState("");
  const [notice, setNotice] = useState("");

  const storedRules = status?.ignoreRules ?? [];
  useEffect(() => {
    setRules(storedRules.join("\n"));
  }, [storedRules.join("\n")]);

  const refresh = useCallback(async () => {
    const list = await onLoadSources();
    setSources(list);
    return list;
  }, [onLoadSources]);

  useEffect(() => {
    if (!enabled) {
      setSources([]);
      setChunks([]);
      return;
    }
    void refresh().catch((error) => {
      setNotice(error instanceof Error ? error.message : String(error));
    });
  }, [enabled, refresh, status?.builtAt?.toString()]);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return sources;
    return sources.filter((source) => source.path.toLowerCase().includes(needle));
  }, [sources, filter]);

  useEffect(() => {
    if (!visible.length) {
      setSelected(null);
      setChunks([]);
      return;
    }
    if (!selected || !visible.some((source) => source.path === selected)) {
      setSelected(visible[0].path);
    }
  }, [visible, selected]);

  useEffect(() => {
    if (!selected) {
      setChunks([]);
      return;
    }
    let live = true;
    void onLoadPreview(selected)
      .then((list) => {
        if (live) setChunks(list);
      })
      .catch((error) => {
        if (live) setNotice(error instanceof Error ? error.message : String(error));
      });
    return () => {
      live = false;
    };
  }, [selected, onLoadPreview]);

  const choose = async (file: string) => {
    setSelected(file);
    setNotice("");
  };

  const reindex = async (file: string) => {
    setNotice("");
    try {
      await onReindex(file);
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const saveRules = async () => {
    setNotice("");
    try {
      await onSaveRules(rules.split("\n"));
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const selectedSource = sources.find((source) => source.path === selected);

  return (
    <section>
      <div className="flex items-center justify-between gap-4 mb-2">
        <p className="section-label !mb-0">Indexed sources</p>
        <span className="chip">
          {sources.length} files · {status?.chunks ?? 0} passages
          {status?.skipped ? ` · ${status.skipped} ignored` : ""}
        </span>
      </div>

      <div className="card overflow-hidden">
        <div className="p-3 border-b border-line">
          <div className="flex items-center justify-between gap-3 mb-2">
            <p className="text-[12.5px] font-semibold text-ink">Ignore rules</p>
            <button
              onClick={() => void saveRules()}
              disabled={busy || !enabled}
              className="btn !h-7 !px-2.5"
            >
              Save rules
            </button>
          </div>
          <textarea
            value={rules}
            onChange={(event) => setRules(event.target.value)}
            aria-label="Ignore rules"
            placeholder={"secrets\n*.log\ndocs/private"}
            disabled={!enabled}
            className="field font-mono !text-[11px] min-h-[64px] w-full resize-y"
          />
          <p className="text-[10.5px] text-muted mt-1.5 leading-relaxed">
            One pattern per line. A name like <code className="font-mono">secrets</code> matches that name at any
            depth; a path like <code className="font-mono">docs/private</code> matches that folder and everything in
            it. The index is rebuilt when the rules are saved.
          </p>
        </div>

        <div className="p-3 border-b border-line relative">
          <Search size={11} className="absolute start-[22px] top-1/2 -translate-y-1/2 text-faint" />
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter sources"
            aria-label="Filter sources"
            className="field w-full !ps-7"
            disabled={!enabled}
          />
        </div>

        <div className="grid grid-cols-[minmax(230px,290px)_1fr]">
          <div className="border-e border-line flex flex-col min-w-0 max-h-[320px] overflow-y-auto">
            {visible.length === 0 ? (
              <p className="p-3 text-[11px] text-muted">
                {enabled
                  ? "No file is indexed yet. Rebuild the index to scan your folders."
                  : "Turn workspace search on to see what the index holds."}
              </p>
            ) : (
              visible.map((source) => {
                const { name, folder } = shortPath(source.path);
                const active = source.path === selected;
                return (
                  <div
                    key={source.path}
                    className={`flex items-center gap-2 px-3 py-2 border-b border-line last:border-0 ${
                      active ? "bg-accent-soft" : ""
                    }`}
                  >
                    <button onClick={() => void choose(source.path)} className="flex-1 min-w-0 text-start">
                      <p className="text-[12px] font-semibold text-ink truncate">{name}</p>
                      <p className="text-[10.5px] text-muted truncate">{folder || "—"}</p>
                    </button>
                    <span className="chip shrink-0">{source.chunks}</span>
                    <button
                      onClick={() => void reindex(source.path)}
                      aria-label={`Reindex ${name}`}
                      title="Reindex this file"
                      disabled={busy}
                      className="btn !h-6 !px-1.5 !py-0 shrink-0"
                    >
                      <RefreshCw size={11} />
                    </button>
                  </div>
                );
              })
            )}
          </div>

          <div className="min-w-0 max-h-[320px] overflow-y-auto">
            {!selectedSource ? (
              <p className="p-3 text-[11px] text-muted">Pick a file to see the passages the index holds.</p>
            ) : chunks.length === 0 ? (
              <p className="p-3 text-[11px] text-muted">This file has no passages yet.</p>
            ) : (
              chunks.map((chunk) => (
                <div key={`${chunk.path}-${chunk.startLine}`} className="p-3 border-b border-line last:border-0">
                  <p className="text-[10px] font-mono text-muted">
                    lines {chunk.startLine}–{chunk.endLine}
                  </p>
                  <pre className="mt-1.5 text-[10.5px] text-muted whitespace-pre-wrap break-words">
                    {chunk.text}
                  </pre>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {notice && <p className="text-[11px] text-danger mt-2 px-1">{notice}</p>}

      <p className="text-[10.5px] text-muted mt-2 px-1 leading-relaxed">
        <FileText size={10} className="inline me-1 -mt-0.5" />
        The index lives in RAM only, so the list is empty again after a restart until the next build. Files the rules
        keep out are counted, not listed, and nothing outside the folders you allowed is ever read.
      </p>
    </section>
  );
};
