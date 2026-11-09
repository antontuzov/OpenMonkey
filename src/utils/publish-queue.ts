import storage from "./storage";
import type { PublisherChannel, ScheduledPost, ScheduledPostStatus } from "./types";

/**
 * A queue of posts waiting to go out. The publisher and the scheduler both talk to
 * it through this, so a post scheduled by the agent and one listed on the settings
 * page are the same row.
 */
export interface PublishQueue {
  /** True when the queue can take a post right now. */
  available(): boolean;
  add(post: {
    channel: PublisherChannel;
    text: string;
    title?: string;
    imageUrl?: string;
    dueAt: number;
  }): ScheduledPost;
  list(statuses?: ScheduledPostStatus[]): ScheduledPost[];
  get(id: string): ScheduledPost | null;
  save(post: ScheduledPost): void;
  remove(id: string): void;
}

const newId = (): string => `post_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

/**
 * The queue the app uses. The text of a queued post is sealed with the history key
 * like any other conversation text, so a scheduled post is not left on disk in the
 * clear.
 */
class StoragePublishQueue implements PublishQueue {
  available(): boolean {
    return storage.isReady();
  }

  add(post: {
    channel: PublisherChannel;
    text: string;
    title?: string;
    imageUrl?: string;
    dueAt: number;
  }): ScheduledPost {
    const scheduled: ScheduledPost = {
      id: newId(),
      channel: post.channel,
      text: post.text,
      title: post.title,
      imageUrl: post.imageUrl,
      dueAt: post.dueAt,
      createdAt: Date.now(),
      status: "pending",
      attempts: 0,
    };
    this.save(scheduled);
    return scheduled;
  }

  list(statuses?: ScheduledPostStatus[]): ScheduledPost[] {
    return storage.getScheduledPosts(statuses);
  }

  get(id: string): ScheduledPost | null {
    return this.list().find((post) => post.id === id) ?? null;
  }

  save(post: ScheduledPost): void {
    storage.saveScheduledPost(post);
  }

  remove(id: string): void {
    storage.deleteScheduledPost(id);
  }
}

export const publishQueue: PublishQueue = new StoragePublishQueue();
