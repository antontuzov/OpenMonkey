import { useState } from "react";
import { Folder, Plus, Search, Tag, X } from "lucide-react";
import type { ChatFolder, ChatTag, SavedSearch } from "../../utils/types";
import { t } from "../i18n";

interface OrganizerPanelProps {
  folders: ChatFolder[];
  tags: ChatTag[];
  savedSearches: SavedSearch[];
  /** The folder the list is filtered by, when one is. */
  folderFilter: string | null;
  /** The label the list is filtered by, when one is. */
  tagFilter: string | null;
  /** What is in the search box; a saved search needs something to save. */
  query: string;
  onToggleFolder: (id: string) => void;
  onToggleTag: (tag: string) => void;
  onCreateFolder: (name: string) => void;
  onDeleteFolder: (id: string) => void;
  onRunSavedSearch: (search: SavedSearch) => void;
  onDeleteSavedSearch: (id: string) => void;
  onSaveSearch: (name: string) => void;
}

/**
 * The places a chat can be filed: folders, labels and the searches worth keeping.
 *
 * Everything here filters the list below it, so the panel is the answer to
 * "where did I put that chat?".
 */
export const OrganizerPanel: React.FC<OrganizerPanelProps> = ({
  folders,
  tags,
  savedSearches,
  folderFilter,
  tagFilter,
  query,
  onToggleFolder,
  onToggleTag,
  onCreateFolder,
  onDeleteFolder,
  onRunSavedSearch,
  onDeleteSavedSearch,
  onSaveSearch,
}) => {
  const [folderName, setFolderName] = useState("");
  const [searchName, setSearchName] = useState("");

  const addFolder = () => {
    const value = folderName.trim();
    if (!value) return;
    onCreateFolder(value);
    setFolderName("");
  };

  const saveSearch = () => {
    const value = searchName.trim();
    if (!value || !query.trim()) return;
    onSaveSearch(value);
    setSearchName("");
  };

  return (
    <div className="px-3 pb-2 no-drag flex flex-col gap-2.5">
      <section className="flex flex-col gap-1">
        <p className="section-label !mb-0">{t("org.folders")}</p>
        {folders.map((folder) => (
          <div key={folder.id} className="flex items-center gap-1">
            <button
              onClick={() => onToggleFolder(folder.id)}
              className={`flex items-center gap-1.5 flex-1 min-w-0 px-1.5 py-1 rounded-lg text-start text-[11.5px] ${
                folderFilter === folder.id ? "bg-accent-soft text-accent-ink" : "text-ink hover:bg-ink/5"
              }`}
            >
              <Folder size={12} className="shrink-0 text-faint" />
              <span className="truncate">{folder.name}</span>
              <span className="ms-auto text-[10px] text-faint tabular-nums">{folder.count}</span>
            </button>
            <button
              onClick={() => onDeleteFolder(folder.id)}
              className="icon-btn !w-5 !h-5"
              title={`${t("org.deleteFolder")} ${folder.name}`}
            >
              <X size={10} />
            </button>
          </div>
        ))}
        {!folders.length && <p className="text-[10.5px] text-faint">{t("org.noFolders")}</p>}
        <div className="flex items-center gap-1 mt-0.5">
          <input
            value={folderName}
            onChange={(event) => setFolderName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addFolder();
              }
            }}
            className="field !h-6 flex-1 !min-w-0 !text-[10.5px]"
            placeholder={t("org.folderName")}
            aria-label={t("org.folderName")}
          />
          <button
            onClick={addFolder}
            disabled={!folderName.trim()}
            className="icon-btn !w-6 !h-6"
            title={t("org.newFolder")}
          >
            <Plus size={12} />
          </button>
        </div>
      </section>

      <section className="flex flex-col gap-1">
        <p className="section-label !mb-0">{t("org.tags")}</p>
        {tags.length ? (
          <div className="flex flex-wrap gap-1">
            {tags.map((entry) => (
              <button
                key={entry.tag}
                onClick={() => onToggleTag(entry.tag)}
                className={`chip !h-6 ${tagFilter === entry.tag ? "chip-accent" : ""}`}
              >
                <Tag size={10} />
                {entry.tag}
                <span className="text-faint tabular-nums">{entry.count}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-[10.5px] text-faint">{t("org.noTags")}</p>
        )}
      </section>

      <section className="flex flex-col gap-1">
        <p className="section-label !mb-0">{t("org.savedSearches")}</p>
        {savedSearches.map((search) => (
          <div key={search.id} className="flex items-center gap-1">
            <button
              onClick={() => onRunSavedSearch(search)}
              className="flex items-center gap-1.5 flex-1 min-w-0 px-1.5 py-1 rounded-lg text-start text-[11.5px] text-ink hover:bg-ink/5"
              title={t("org.runSearch")}
            >
              <Search size={12} className="shrink-0 text-faint" />
              <span className="truncate">{search.name}</span>
            </button>
            <button
              onClick={() => onDeleteSavedSearch(search.id)}
              className="icon-btn !w-5 !h-5"
              title={`${t("org.deleteSavedSearch")} ${search.name}`}
            >
              <X size={10} />
            </button>
          </div>
        ))}
        {!savedSearches.length && <p className="text-[10.5px] text-faint">{t("org.noSavedSearches")}</p>}
        <div className="flex items-center gap-1 mt-0.5">
          <input
            value={searchName}
            onChange={(event) => setSearchName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                saveSearch();
              }
            }}
            className="field !h-6 flex-1 !min-w-0 !text-[10.5px]"
            placeholder={t("org.searchName")}
            aria-label={t("org.searchName")}
          />
          <button
            onClick={saveSearch}
            disabled={!searchName.trim() || !query.trim()}
            className="icon-btn !w-6 !h-6"
            title={t("org.saveSearch")}
          >
            <Plus size={12} />
          </button>
        </div>
      </section>
    </div>
  );
};
