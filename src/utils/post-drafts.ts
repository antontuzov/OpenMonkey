import storage from "./storage";
import type { PostDraft, PublisherChannel } from "./types";

/**
 * The drafts the agent wrote but has not sent. The publisher and the settings page
 * both talk to it through this, so a draft the agent prepared and one the user
 * edited are the same row.
 */
export interface PostDraftStore {
  /** True when the store can take a draft right now. */
  available(): boolean;
  add(draft: {
    channel: PublisherChannel;
    text: string;
    title?: string;
    imageUrl?: string;
    note?: string;
  }): PostDraft;
  list(): PostDraft[];
  get(id: string): PostDraft | null;
  save(draft: PostDraft): void;
  remove(id: string): void;
}

const newId = (): string => `draft_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

/**
 * The store the app uses. The text of a draft is sealed with the history key like
 * any other conversation text, so a post waiting for the user's word is not left on
 * disk in the clear.
 */
class StoragePostDraftStore implements PostDraftStore {
  available(): boolean {
    return storage.isReady();
  }

  add(draft: {
    channel: PublisherChannel;
    text: string;
    title?: string;
    imageUrl?: string;
    note?: string;
  }): PostDraft {
    const now = Date.now();
    const created: PostDraft = {
      id: newId(),
      channel: draft.channel,
      text: draft.text,
      title: draft.title,
      imageUrl: draft.imageUrl,
      note: draft.note,
      createdAt: now,
      updatedAt: now,
    };
    this.save(created);
    return created;
  }

  list(): PostDraft[] {
    return storage.getPostDrafts();
  }

  get(id: string): PostDraft | null {
    return this.list().find((draft) => draft.id === id) ?? null;
  }

  save(draft: PostDraft): void {
    storage.savePostDraft(draft);
  }

  remove(id: string): void {
    storage.deletePostDraft(id);
  }
}

export const postDrafts: PostDraftStore = new StoragePostDraftStore();
