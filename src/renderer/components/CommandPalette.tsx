import { useEffect, useMemo, useRef, useState } from "react";
import {
  CornerDownLeft,
  Eraser,
  MessageSquare,
  Moon,
  Search,
  Settings2,
  Sparkles,
  SquareTerminal,
  Type,
  X,
} from "lucide-react";
import { rankPalette, type PaletteCandidate, type PaletteCommand } from "../command-palette";
import { settingEntries } from "../settings-search";
import { SETTINGS_PAGE_ORDER, SETTINGS_PAGE_TITLES } from "../settings-pages";
import { t, type StringKey } from "../i18n";
import type {
  AppLanguage,
  Conversation,
  ConversationSearchHit,
  SettingsPage,
} from "../../utils/types";

interface CommandPaletteProps {
  language: AppLanguage;
  conversations: Conversation[];
  onClose: () => void;
  onSelectConversation: (id: string) => void;
  onOpenSettings: (page: SettingsPage, label?: string) => void;
  onCommand: (command: PaletteCommand) => void;
  onSearchConversations: (query: string) => Promise<ConversationSearchHit[]>;
}

const ACTIONS: Array<{ command: PaletteCommand; key: StringKey; keywords: string[] }> = [
  { command: "new-chat", key: "palette.action.newChat", keywords: ["chat", "conversation", "start"] },
  { command: "focus-composer", key: "palette.action.focusComposer", keywords: ["input", "write", "type", "answer"] },
  { command: "toggle-panel", key: "palette.action.togglePanel", keywords: ["activity", "tasks", "monitor", "side"] },
  { command: "cycle-mood", key: "palette.action.cycleMood", keywords: ["mood", "face", "avatar", "logo"] },
  { command: "clear-chat", key: "palette.action.clearChat", keywords: ["empty", "reset", "wipe", "erase"] },
  { command: "summarize-chat", key: "palette.action.summarizeChat", keywords: ["digest", "summary", "recap"] },
  { command: "stop", key: "palette.action.stop", keywords: ["cancel", "abort", "halt"] },
];

const ACTION_ICON: Record<PaletteCommand, typeof Sparkles> = {
  "new-chat": Sparkles,
  "focus-composer": Type,
  "toggle-panel": SquareTerminal,
  "cycle-mood": Moon,
  "clear-chat": Eraser,
  "summarize-chat": MessageSquare,
  stop: SquareTerminal,
};

const GROUP_LABEL: Record<PaletteCandidate["group"], StringKey> = {
  chats: "palette.group.chats",
  settings: "palette.group.settings",
  actions: "palette.group.actions",
};

/**
 * One box for everything the app can do: the chats, the settings and the commands.
 * It opens with Cmd+K, is driven from the keyboard alone, and never hides a result
 * behind a menu that has to be opened first.
 */
export const CommandPalette: React.FC<CommandPaletteProps> = ({
  language,
  conversations,
  onClose,
  onSelectConversation,
  onOpenSettings,
  onCommand,
  onSearchConversations,
}) => {
  const [query, setQuery] = useState("");
  const [bodyHits, setBodyHits] = useState<ConversationSearchHit[]>([]);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // The chat bodies live in the main process, so they are searched there.
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setBodyHits([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void onSearchConversations(trimmed)
        .then((hits) => {
          if (!cancelled) setBodyHits(hits);
        })
        .catch(() => {
          if (!cancelled) setBodyHits([]);
        });
    }, 160);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, onSearchConversations]);

  const chats = useMemo<PaletteCandidate[]>(() => {
    const list: PaletteCandidate[] = [];
    const known = new Map<string, PaletteCandidate>();
    for (const conversation of conversations) {
      const candidate: PaletteCandidate = {
        id: `chat:${conversation.id}`,
        label: conversation.title,
        group: "chats",
        detail: conversation.preview,
        keywords: ["chat", "conversation", t("palette.group.chats")],
        action: { kind: "chat", conversationId: conversation.id },
      };
      known.set(conversation.id, candidate);
      list.push(candidate);
    }
    for (const hit of bodyHits) {
      const existing = known.get(hit.conversation.id);
      if (existing) {
        if (hit.snippet) existing.detail = hit.snippet;
        continue;
      }
      list.push({
        id: `chat:${hit.conversation.id}`,
        label: hit.conversation.title,
        group: "chats",
        detail: hit.snippet,
        keywords: ["chat", "conversation", t("palette.group.chats")],
        action: { kind: "chat", conversationId: hit.conversation.id },
      });
    }
    return list;
  }, [conversations, bodyHits, language]);

  const actions = useMemo<PaletteCandidate[]>(
    () =>
      ACTIONS.map((action) => ({
        id: `action:${action.command}`,
        label: t(action.key),
        group: "actions" as const,
        keywords: action.keywords,
        action: { kind: "command" as const, command: action.command },
      })),
    [language]
  );

  const settings = useMemo<PaletteCandidate[]>(() => {
    const pages: PaletteCandidate[] = SETTINGS_PAGE_ORDER.map((page) => ({
      id: `page:${page}`,
      label: t(SETTINGS_PAGE_TITLES[page]),
      group: "settings",
      detail: t("palette.group.settings"),
      keywords: ["settings", "page", t("palette.group.settings")],
      action: { kind: "setting", page },
    }));
    const rows: PaletteCandidate[] = settingEntries().map((entry) => ({
      id: `setting:${entry.page}:${entry.label}`,
      label: entry.label,
      group: "settings",
      detail: t(SETTINGS_PAGE_TITLES[entry.page]),
      keywords: [...entry.keywords, "setting", t("palette.group.settings")],
      action: { kind: "setting", page: entry.page, label: entry.label },
    }));
    return [...pages, ...rows];
  }, [language]);

  const results = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      const recent = [...chats]
        .sort((left, right) => {
          const leftAt = conversations.find((item) => `chat:${item.id}` === left.id)?.updatedAt.getTime() ?? 0;
          const rightAt = conversations.find((item) => `chat:${item.id}` === right.id)?.updatedAt.getTime() ?? 0;
          return rightAt - leftAt;
        })
        .slice(0, 5);
      return [...recent, ...actions];
    }
    return rankPalette(trimmed, [...chats, ...actions, ...settings], 14);
  }, [query, chats, actions, settings, conversations]);

  useEffect(() => {
    if (selected >= results.length) setSelected(Math.max(0, results.length - 1));
  }, [results.length, selected]);

  useEffect(() => {
    listRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [selected, results]);

  const run = (candidate: PaletteCandidate) => {
    onClose();
    const action = candidate.action;
    if (action.kind === "chat") onSelectConversation(action.conversationId);
    else if (action.kind === "setting") onOpenSettings(action.page, action.label);
    else onCommand(action.command);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelected((index) => Math.min(index + 1, results.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelected((index) => Math.max(index - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const chosen = results[selected];
      if (chosen) run(chosen);
    }
  };

  const groups: Array<{ group: PaletteCandidate["group"]; items: PaletteCandidate[] }> = [];
  for (const candidate of results) {
    const last = groups[groups.length - 1];
    if (last && last.group === candidate.group) last.items.push(candidate);
    else groups.push({ group: candidate.group, items: [candidate] });
  }
  let position = 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-6 pt-[11vh]"
      role="dialog"
      aria-modal="true"
      aria-label={t("palette.title")}
    >
      <button
        className="absolute inset-0 bg-ink/25 cursor-default"
        aria-label={t("palette.close")}
        onClick={onClose}
        tabIndex={-1}
      />
      <div
        className="relative w-full max-w-[560px] bg-card border border-line rounded-2xl overflow-hidden flex flex-col"
        style={{ boxShadow: "var(--shadow-pop)" }}
      >
        <div className="flex items-center gap-2.5 px-4 h-12 border-b border-line shrink-0">
          <Search size={15} className="text-faint shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected(0);
            }}
            onKeyDown={onKeyDown}
            placeholder={t("palette.placeholder")}
            aria-label={t("palette.placeholder")}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={results[selected] ? `palette-option-${selected}` : undefined}
            className="flex-1 min-w-0 bg-transparent outline-none text-[13px] text-ink placeholder:text-faint"
          />
          <button
            onClick={onClose}
            className="icon-btn !w-6 !h-6 shrink-0"
            title={t("palette.close")}
            aria-label={t("palette.close")}
          >
            <X size={13} />
          </button>
        </div>

        <div
          id="palette-list"
          ref={listRef}
          role="listbox"
          aria-label={t("palette.title")}
          className="max-h-[46vh] overflow-y-auto py-1.5"
        >
          {groups.map((group) => (
            <div key={group.group}>
              <p className="px-4 pt-2.5 pb-1 text-[9.5px] uppercase tracking-[0.14em] text-faint">
                {t(GROUP_LABEL[group.group])}
              </p>
              {group.items.map((candidate) => {
                const index = position;
                position += 1;
                const Icon =
                  candidate.action.kind === "chat"
                    ? MessageSquare
                    : candidate.action.kind === "setting"
                      ? Settings2
                      : ACTION_ICON[candidate.action.command];
                return (
                  <button
                    key={candidate.id}
                    id={`palette-option-${index}`}
                    role="option"
                    aria-selected={index === selected}
                    onMouseEnter={() => setSelected(index)}
                    onClick={() => run(candidate)}
                    className={`w-full flex items-center gap-2.5 px-4 py-1.5 text-left ${
                      index === selected ? "bg-accent-soft" : ""
                    }`}
                  >
                    <Icon
                      size={13}
                      className={`shrink-0 ${index === selected ? "text-accent-ink" : "text-faint"}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] text-ink">{candidate.label}</span>
                      {candidate.detail && (
                        <span className="block truncate text-[10.5px] text-faint">{candidate.detail}</span>
                      )}
                    </span>
                    {index === selected && <CornerDownLeft size={12} className="text-faint shrink-0" />}
                  </button>
                );
              })}
            </div>
          ))}

          {!results.length && (
            <p className="px-4 py-8 text-center text-[11.5px] text-faint">
              {t("palette.empty", { query: query.trim() })}
            </p>
          )}
        </div>

        <div className="px-4 py-2 border-t border-line shrink-0 text-[10px] text-faint">
          {t("palette.hint")}
        </div>
      </div>
    </div>
  );
};
