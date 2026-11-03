import { useEffect, useMemo, useState } from "react";
import { MessageSquare, Pin, Plus, Save, Search, Trash2 } from "lucide-react";
import type { MemoryFact, MemorySnapshot, MemorySummary } from "../../utils/types";
import { Toggle } from "./controls";

type Filter = "all" | "fact" | "chat";

interface Row {
  id: string;
  kind: "fact" | "chat";
  title: string;
  subtitle: string;
  preview: string;
}

export interface MemoryBrowserProps {
  snapshot: MemorySnapshot | null;
  enabled: boolean;
  onAddFact: (content: string) => Promise<void>;
  onEditFact: (id: string, content: string) => Promise<void>;
  onDeleteFact: (id: string) => Promise<void>;
  onClearFacts: () => Promise<void>;
  onSaveSummary: (conversationId: string, content: string) => Promise<void>;
  onForgetSummary: (conversationId: string) => Promise<void>;
  onSetRecall: (conversationId: string, recall: boolean) => Promise<void>;
}

const dateOf = (value: Date | string): string =>
  new Date(value).toLocaleDateString([], { month: "short", day: "numeric" });

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "all", label: "All" },
  { value: "fact", label: "Facts" },
  { value: "chat", label: "Chats" },
];

/**
 * The browser over everything the model may recall: pinned facts on one side,
 * conversation summaries on the other. A fact can be rewritten in place — its
 * citation label stays valid. A chat carries both the derived digest (shown so
 * nothing is hidden) and the user's own summary, which is what the model reads.
 */
export const MemoryBrowser: React.FC<MemoryBrowserProps> = ({
  snapshot,
  enabled,
  onAddFact,
  onEditFact,
  onDeleteFact,
  onClearFacts,
  onSaveSummary,
  onForgetSummary,
  onSetRecall,
}) => {
  const facts = snapshot?.facts ?? [];
  const summaries = snapshot?.summaries ?? [];

  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [factDraft, setFactDraft] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmForget, setConfirmForget] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const rows = useMemo<Row[]>(() => {
    const list: Row[] = [
      ...facts.map((fact: MemoryFact) => ({
        id: `fact:${fact.id}`,
        kind: "fact" as const,
        title: fact.content,
        subtitle: `[fact:${fact.id.slice(-6)}] · ${dateOf(fact.createdAt)}`,
        preview: fact.content,
      })),
      ...summaries.map((summary: MemorySummary) => ({
        id: `chat:${summary.conversationId}`,
        kind: "chat" as const,
        title: summary.title,
        subtitle: `${summary.messageCount} messages · ${dateOf(summary.updatedAt)}${
          summary.edited ? " · yours" : ""
        }`,
        preview: summary.content,
      })),
    ];
    const needle = query.trim().toLowerCase();
    return list.filter((row) => {
      if (filter !== "all" && row.kind !== filter) return false;
      if (!needle) return true;
      return `${row.title} ${row.subtitle} ${row.preview}`.toLowerCase().includes(needle);
    });
  }, [facts, summaries, filter, query]);

  // A selection that no longer exists — a deleted fact, a filtered-out chat —
  // falls back to the first visible row instead of an empty pane.
  useEffect(() => {
    if (!rows.length) {
      setSelected(null);
      return;
    }
    if (!selected || !rows.some((row) => row.id === selected)) setSelected(rows[0].id);
  }, [rows, selected]);

  const fact = selected?.startsWith("fact:")
    ? facts.find((entry) => `fact:${entry.id}` === selected)
    : undefined;
  const summary = selected?.startsWith("chat:")
    ? summaries.find((entry) => `chat:${entry.conversationId}` === selected)
    : undefined;

  // The editor always opens on what the model would receive right now.
  const current = fact ? fact.content : summary ? (summary.edited ? summary.content : "") : "";
  useEffect(() => {
    setDraft(current);
    setConfirmForget(false);
  }, [current, selected]);

  const dirty = draft.trim() !== current.trim() && draft.trim().length > 0;

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setNotice("");
    try {
      await task();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const saveFact = () => {
    if (!fact || !dirty) return;
    void run(async () => {
      await onEditFact(fact.id, draft);
      setNotice("Fact saved. Its citation label still points here.");
    });
  };

  const saveSummary = () => {
    if (!summary || !dirty) return;
    void run(async () => {
      await onSaveSummary(summary.conversationId, draft);
      setNotice("Your summary replaces the digest the model reads.");
    });
  };

  return (
    <section>
      <div className="flex items-center justify-between gap-4 mb-2">
        <p className="section-label !mb-0">Memory</p>
        <span className="chip">
          {facts.length} facts · {summaries.length} chats
        </span>
      </div>

      <div className="card overflow-hidden">
        <div className="grid grid-cols-[minmax(230px,290px)_1fr]">
          <div className="border-r border-line flex flex-col min-w-0">
            <div className="p-3 border-b border-line flex items-center gap-2">
              <div className="segmented flex-1">
                {FILTERS.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => setFilter(option.value)}
                    className={filter === option.value ? "segmented-active" : ""}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="p-3 border-b border-line relative">
              <Search size={11} className="absolute left-[22px] top-1/2 -translate-y-1/2 text-faint" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search memory"
                aria-label="Search memory"
                className="field w-full !pl-7"
              />
            </div>

            <div className="flex-1 overflow-y-auto max-h-[320px] min-h-[120px]">
              {rows.length === 0 ? (
                <p className="p-5 text-[11px] text-muted text-center leading-relaxed">
                  {query.trim()
                    ? "Nothing matches that search."
                    : "Nothing here yet. Pin a fact or answer a question to start."}
                </p>
              ) : (
                rows.map((row) => (
                  <button
                    key={row.id}
                    onClick={() => setSelected(row.id)}
                    className={`w-full text-left px-3 py-2.5 flex items-start gap-2.5 border-b border-line last:border-b-0 transition-colors ${
                      row.id === selected ? "bg-accent-soft" : "hover:bg-card-2"
                    }`}
                  >
                    {row.kind === "fact" ? (
                      <Pin size={11} className="text-faint shrink-0 mt-0.5" />
                    ) : (
                      <MessageSquare size={11} className="text-faint shrink-0 mt-0.5" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block text-[11.5px] text-ink leading-snug break-words line-clamp-2">
                        {row.title}
                      </span>
                      <span className="block text-[10px] text-faint font-mono mt-0.5 truncate">
                        {row.subtitle}
                      </span>
                    </span>
                  </button>
                ))
              )}
            </div>

            <div className="p-3 border-t border-line flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <input
                  value={factDraft}
                  onChange={(event) => setFactDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      if (!factDraft.trim() || busy) return;
                      void run(async () => {
                        await onAddFact(factDraft);
                        setFactDraft("");
                        setNotice("Fact saved and injected into the next prompt.");
                      });
                    }
                  }}
                  maxLength={500}
                  disabled={!enabled}
                  placeholder={enabled ? "Pin a fact…" : "Turn memory on to pin facts"}
                  aria-label="Pin a fact"
                  className="field flex-1 min-w-0"
                />
                <button
                  onClick={() => {
                    if (!factDraft.trim() || busy) return;
                    void run(async () => {
                      await onAddFact(factDraft);
                      setFactDraft("");
                      setNotice("Fact saved and injected into the next prompt.");
                    });
                  }}
                  disabled={!enabled || busy || !factDraft.trim()}
                  aria-label="Add fact"
                  className="icon-btn shrink-0"
                >
                  <Plus size={13} />
                </button>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-faint">{facts.length} / 50 pinned facts</span>
                {facts.length > 0 && (
                  <button
                    onClick={() => {
                      if (!confirmClear) {
                        setConfirmClear(true);
                        window.setTimeout(() => setConfirmClear(false), 4_000);
                        return;
                      }
                      setConfirmClear(false);
                      void run(async () => {
                        await onClearFacts();
                        setNotice("All pinned facts deleted.");
                      });
                    }}
                    className={`btn !h-7 !px-2.5 ${confirmClear ? "!text-danger" : ""}`}
                  >
                    <Trash2 size={11} />
                    {confirmClear ? "Confirm" : "Clear all"}
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="p-4 min-w-0">
            {notice && <p className="text-[10.5px] text-muted mb-3 leading-relaxed">{notice}</p>}

            {fact && (
              <div className="flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[9.5px] uppercase tracking-[0.14em] text-faint">Pinned fact</p>
                    <p className="mt-1 font-mono text-[11px] text-ink">[fact:{fact.id.slice(-6)}]</p>
                  </div>
                  <span className="chip shrink-0">{dateOf(fact.createdAt)}</span>
                </div>
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  maxLength={500}
                  aria-label="Fact text"
                  className="field w-full min-h-[92px] resize-y"
                />
                <div className="flex items-center gap-2">
                  <button onClick={saveFact} disabled={!dirty || busy} className="btn btn-primary">
                    <Save size={11} />
                    Save
                  </button>
                  <button
                    onClick={() => void run(async () => onDeleteFact(fact.id))}
                    disabled={busy}
                    className="btn !text-danger"
                  >
                    <Trash2 size={11} />
                    Delete fact
                  </button>
                </div>
                <p className="text-[10.5px] text-muted leading-relaxed">
                  Rewriting a fact keeps its citation label, so answers that cite it still point here.
                </p>
              </div>
            )}

            {summary && (
              <div className="flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[9.5px] uppercase tracking-[0.14em] text-faint">Conversation</p>
                    <p className="mt-1 text-[12.5px] font-semibold text-ink break-words">{summary.title}</p>
                    <p className="mt-1 text-[11.5px] text-muted font-mono">
                      {summary.messageCount} messages · {dateOf(summary.updatedAt)}
                    </p>
                  </div>
                  <span className={`chip shrink-0 ${summary.recall ? "chip-accent" : ""}`}>
                    {summary.recall ? "recalled" : "not recalled"}
                  </span>
                </div>

                <div>
                  <p className="section-label !mb-1">Derived digest</p>
                  <pre className="text-[11px] text-muted whitespace-pre-wrap break-words leading-relaxed font-sans">
                    {summary.derived}
                  </pre>
                </div>

                <div>
                  <p className="section-label !mb-1">Your summary</p>
                  <textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    maxLength={600}
                    aria-label="Your summary"
                    placeholder="Write your own summary — it replaces the digest the model reads."
                    className="field w-full min-h-[92px] resize-y"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={saveSummary} disabled={!dirty || busy} className="btn btn-primary">
                    <Save size={11} />
                    Save summary
                  </button>
                  {summary.edited && (
                    <button
                      onClick={() => {
                        if (!confirmForget) {
                          setConfirmForget(true);
                          return;
                        }
                        void run(async () => {
                          await onForgetSummary(summary.conversationId);
                          setNotice("Chat forgotten. It is no longer recalled.");
                        });
                      }}
                      disabled={busy}
                      className={`btn ${confirmForget ? "!text-danger" : ""}`}
                    >
                      <Trash2 size={11} />
                      {confirmForget ? "Confirm" : "Forget this chat"}
                    </button>
                  )}
                </div>

                <div className="flex items-center justify-between gap-4 border-t border-line pt-3">
                  <div className="min-w-0">
                    <p className="text-[12.5px] font-semibold text-ink">Recall this chat</p>
                    <p className="text-[11.5px] text-muted leading-[1.5] mt-0.5">
                      When on, the summary joins the next prompt under a [chat &quot;title&quot;] citation.
                    </p>
                  </div>
                  <Toggle
                    on={summary.recall}
                    label="Recall this chat"
                    onChange={() =>
                      void run(async () => onSetRecall(summary.conversationId, !summary.recall))
                    }
                  />
                </div>
              </div>
            )}

            {!fact && !summary && (
              <p className="text-[11px] text-muted leading-relaxed">
                Pick a fact or a chat to see what the model would be told about it.
              </p>
            )}
          </div>
        </div>
      </div>

      <p className="text-[10.5px] text-muted mt-2 px-1 leading-relaxed">
        Everything here stays on this Mac and is sealed with AES-256-GCM. Only the 12 most recent facts and 4
        summaries reach the prompt; turning a chat off removes it from the next one.
      </p>
    </section>
  );
};

export default MemoryBrowser;
