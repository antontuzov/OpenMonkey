import React from "react";
import { Loader, Plus, X } from "lucide-react";
import { t } from "../i18n";
import type { Conversation } from "../../utils/types";

interface TabStripProps {
  tabs: Conversation[];
  activeId: string | null;
  busyId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNewTab: () => void;
}

/**
 * The chats that are open, in the order they are shown.
 *
 * The list on the left is the whole history; this strip is the working set — the
 * chats you have in front of you, so a second one is a click away and stays open
 * when you go back to the first.
 */
export const TabStrip: React.FC<TabStripProps> = ({ tabs, activeId, busyId, onSelect, onClose, onNewTab }) => {
  if (!tabs.length) return null;

  return (
    <div
      role="tablist"
      aria-label={t("chat.tabs")}
      className="flex items-center gap-1 px-2 h-9 shrink-0 border-b border-line bg-card-2/40 no-drag overflow-x-auto"
    >
      {tabs.map((conversation) => {
        const active = conversation.id === activeId;
        const busy = conversation.id === busyId;
        return (
          <div
            key={conversation.id}
            className={`group flex items-center gap-1 pl-2.5 pr-1 h-7 rounded-[8px] shrink-0 transition-colors ${
              active ? "bg-card border border-line" : "border border-transparent hover:bg-ink/5"
            }`}
          >
            <button
              role="tab"
              aria-selected={active}
              onClick={() => onSelect(conversation.id)}
              className={`flex items-center gap-1.5 min-w-0 max-w-[180px] text-[11.5px] ${
                active ? "text-ink" : "text-muted hover:text-ink"
              }`}
            >
              {busy ? <Loader size={11} className="animate-spin text-accent-ink shrink-0" /> : null}
              <span className="truncate">{conversation.title}</span>
            </button>
            {tabs.length > 1 ? (
              <button
                onClick={() => onClose(conversation.id)}
                aria-label={t("chat.tab.close", { title: conversation.title })}
                title={t("chat.tab.close", { title: conversation.title })}
                className="icon-btn !w-5 !h-5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              >
                <X size={11} />
              </button>
            ) : null}
          </div>
        );
      })}
      <button
        onClick={onNewTab}
        aria-label={t("chat.tab.new")}
        title={t("chat.tab.new")}
        className="icon-btn !w-6 !h-6 shrink-0"
      >
        <Plus size={12} />
      </button>
    </div>
  );
};
