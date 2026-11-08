import { useEffect, useRef, useState } from "react";
import { Archive, ArchiveRestore, Pencil, Tag, Trash2 } from "lucide-react";
import type { ChatFolder, Conversation } from "../../utils/types";
import { t } from "../i18n";

interface ChatMenuProps {
  conversation: Conversation;
  folders: ChatFolder[];
  /** Every label in use, so the one this chat carries is offered back to the user. */
  knownTags: string[];
  /** Where the button that opened the menu sits, in screen pixels. */
  anchor: { top: number; left: number };
  onArchive: (archived: boolean) => void;
  onSetFolder: (folderId: string | null) => void;
  onSetTags: (tags: string[]) => void;
  onRename: () => void;
  onDelete: () => void;
  onClose: () => void;
}

/**
 * What can be done to one chat without leaving the list.
 *
 * The menu sits next to the button that opened it rather than inside the row, so
 * it is not cut off by the scrolling list it belongs to.
 */
export const ChatMenu: React.FC<ChatMenuProps> = ({
  conversation,
  folders,
  knownTags,
  anchor,
  onArchive,
  onSetFolder,
  onSetTags,
  onRename,
  onDelete,
  onClose,
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [lift, setLift] = useState(0);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [onClose]);

  // The menu opens downwards, unless there is no room for it down there.
  useEffect(() => {
    const height = ref.current?.offsetHeight ?? 0;
    const overflow = anchor.top + height + 12 - window.innerHeight;
    if (overflow > 0) setLift(-overflow);
  }, [anchor.top]);

  const labels = conversation.tags ?? [];
  const offered = [...new Set([...knownTags, ...labels])];

  const toggleLabel = (label: string) => {
    onSetTags(labels.includes(label) ? labels.filter((item) => item !== label) : [...labels, label]);
  };

  const addLabel = () => {
    const value = draft.trim().toLowerCase();
    if (!value) return;
    if (!labels.includes(value)) onSetTags([...labels, value]);
    setDraft("");
    setAdding(false);
  };

  return (
    <div
      ref={ref}
      className="fixed z-50 w-[236px] card p-2 flex flex-col gap-2"
      style={{ top: Math.max(8, anchor.top + lift), left: Math.max(8, anchor.left), boxShadow: "var(--shadow-pop)" }}
      role="group"
      aria-label={t("org.more")}
    >
      <button
        onClick={() => {
          onArchive(!conversation.archived);
          onClose();
        }}
        className="flex items-center gap-2 w-full px-1.5 py-1 rounded-lg hover:bg-ink/5 text-[11.5px] text-ink"
      >
        {conversation.archived ? (
          <ArchiveRestore size={13} className="text-faint shrink-0" />
        ) : (
          <Archive size={13} className="text-faint shrink-0" />
        )}
        {conversation.archived ? t("org.unarchiveChat") : t("org.archiveChat")}
      </button>

      <div className="flex flex-col gap-1.5 border-t border-line pt-2">
        <p className="text-[9.5px] uppercase tracking-[0.14em] text-faint">{t("org.folder")}</p>
        <div className="flex flex-wrap gap-1">
          <button
            onClick={() => {
              onSetFolder(null);
              onClose();
            }}
            className={`chip !h-6 ${conversation.folderId ? "" : "chip-accent"}`}
          >
            {t("org.noFolder")}
          </button>
          {folders.map((folder) => (
            <button
              key={folder.id}
              onClick={() => {
                onSetFolder(folder.id);
                onClose();
              }}
              className={`chip !h-6 ${conversation.folderId === folder.id ? "chip-accent" : ""}`}
            >
              {folder.name}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5 border-t border-line pt-2">
        <p className="text-[9.5px] uppercase tracking-[0.14em] text-faint">{t("org.tags")}</p>
        <div className="flex flex-wrap gap-1">
          {labels.map((label) => (
            <button
              key={label}
              onClick={() => toggleLabel(label)}
              className="chip chip-accent !h-6"
              title={`${label} ×`}
            >
              {label} ×
            </button>
          ))}
          {offered
            .filter((label) => !labels.includes(label))
            .map((label) => (
              <button key={label} onClick={() => toggleLabel(label)} className="chip !h-6">
                {label}
              </button>
            ))}
          {adding ? (
            <input
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addLabel();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setAdding(false);
                }
              }}
              onBlur={() => {
                addLabel();
              }}
              className="field !h-6 !w-[110px] !text-[10.5px]"
              aria-label={t("org.addLabel")}
              placeholder={t("org.addLabel")}
            />
          ) : (
            <button onClick={() => setAdding(true)} className="chip !h-6">
              <Tag size={10} />
              {t("org.addLabel")}
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 border-t border-line pt-2">
        <button
          onClick={() => {
            onRename();
            onClose();
          }}
          className="btn !h-6 !px-2 !text-[10.5px] flex-1"
        >
          <Pencil size={11} />
          {t("org.renameChat")}
        </button>
        <button
          onClick={() => {
            onDelete();
            onClose();
          }}
          className="btn !h-6 !px-2 !text-[10.5px] !text-danger"
        >
          <Trash2 size={11} />
          {t("org.deleteChat")}
        </button>
      </div>
    </div>
  );
};
