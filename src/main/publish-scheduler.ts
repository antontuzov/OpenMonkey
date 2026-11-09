import type { ScheduledPost } from "../utils/types";
import { publishQueue, type PublishQueue } from "../utils/publish-queue";
import { PublishTools } from "../agent/tools/publish";
import { networkAllowed } from "../utils/network";
import config from "../utils/config";
import logger from "../utils/logger";

/** How often the app looks at the queue. */
const TICK_MS = 30_000;
/** How many times a post is tried before the app gives up on it. */
const MAX_ATTEMPTS = 3;

export interface PublishSchedulerDeps {
  queue?: PublishQueue;
  publisher?: PublishTools;
  /** Sends the post. The app runs it as a task, so the rail and the audit log show it. */
  runPost?: (post: ScheduledPost) => Promise<{ ok: boolean; error?: string }>;
  now?: () => number;
  /** True while the user asked for quiet hours to be respected. */
  quiet?: () => boolean;
  /** False when the user turned network access off. */
  networkAllowed?: () => boolean;
  /** True when the publishing policy says no. */
  blocked?: () => boolean;
}

/** "22:00" as the minutes since midnight, or null when it cannot be read. */
function parseClock(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * True while the quiet hours the user set are running. The window can run past
 * midnight, so "22:00 to 08:00" is read as the night it is.
 */
export function inQuietHours(now: number): boolean {
  const quiet = config.get("desktop").quietHours;
  if (!quiet?.enabled) return false;
  const from = parseClock(quiet.from);
  const to = parseClock(quiet.to);
  if (from === null || to === null) return false;
  const date = new Date(now);
  const minutes = date.getHours() * 60 + date.getMinutes();
  return from <= to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
}

/**
 * Sends the posts whose time has come.
 *
 * The queue is checked on a timer rather than on a request, because a post that
 * was scheduled for 09:00 has to go out at 09:00 whether or not anyone is looking
 * at the app. Everything that could make a post rude — the hourly cap, the gap
 * between posts, the quiet hours and the network switch — is the same rule an
 * immediate post obeys, so a queued post waits instead of pushing through.
 */
export class PublishScheduler {
  private readonly queue: PublishQueue;
  private readonly publisher: PublishTools;
  private readonly runPost: (post: ScheduledPost) => Promise<{ ok: boolean; error?: string }>;
  private readonly now: () => number;
  private readonly quiet: () => boolean;
  private readonly networkAllowed: () => boolean;
  private readonly blocked: () => boolean;
  private timer: NodeJS.Timeout | null = null;
  private busy = false;

  constructor(deps: PublishSchedulerDeps = {}) {
    this.queue = deps.queue ?? publishQueue;
    this.publisher = deps.publisher ?? new PublishTools();
    this.now = deps.now ?? (() => Date.now());
    this.quiet = deps.quiet ?? (() => inQuietHours(this.now()));
    this.networkAllowed = deps.networkAllowed ?? networkAllowed;
    this.blocked =
      deps.blocked ??
      (() => {
        // The same rule the task manager uses: the master switch overrides the
        // per-tool policy, so a queue does not refuse what an immediate post allows.
        if (config.get("agent").autoExecuteTasks) return false;
        return (config.get("agent").approvalPolicies?.publish ?? "ask") === "block";
      });
    this.runPost =
      deps.runPost ??
      (async (post) => {
        try {
          await this.publisher.execute("post", {
            channel: post.channel,
            text: post.text,
            title: post.title,
            imageUrl: post.imageUrl,
          });
          return { ok: true };
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
      });
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    void this.tick();
    logger.info("publisher.scheduler.started", { intervalMs: TICK_MS });
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /** Sends everything that is due. Safe to call at any time. */
  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      for (const post of this.queue.list(["pending"])) {
        if (post.dueAt > this.now()) continue;
        await this.send(post);
      }
    } finally {
      this.busy = false;
    }
  }

  private async send(post: ScheduledPost): Promise<void> {
    if (this.blocked()) {
      this.giveUp(post, "Blocked by your approval policy in Settings → Approvals");
      return;
    }
    if (!this.networkAllowed()) {
      logger.info("publisher.scheduled.deferred", { channel: post.channel, reason: "network-off" });
      return;
    }
    if (this.quiet()) {
      logger.info("publisher.scheduled.deferred", { channel: post.channel, reason: "quiet-hours" });
      return;
    }
    const room = this.publisher.room(post.channel);
    if (!room.ok) {
      logger.info("publisher.scheduled.deferred", {
        channel: post.channel,
        reason: "room",
        waitMs: room.waitMs,
      });
      return;
    }

    const result = await this.runPost(post);
    const attempts = post.attempts + 1;
    if (result.ok) {
      this.queue.save({
        ...post,
        status: "posted",
        attempts,
        postedAt: this.now(),
        error: undefined,
      });
      logger.info("publisher.scheduled.posted", { channel: post.channel, id: post.id });
      return;
    }

    const error = result.error ?? "The post did not go out.";
    if (attempts >= MAX_ATTEMPTS) {
      this.giveUp(post, error);
      return;
    }
    this.queue.save({ ...post, attempts, error });
    logger.info("publisher.scheduled.retry", { channel: post.channel, id: post.id, attempts });
  }

  /** The app stops trying: the post stays on the list with the reason. */
  private giveUp(post: ScheduledPost, error: string): void {
    this.queue.save({
      ...post,
      status: "failed",
      attempts: post.attempts + 1,
      error,
    });
    logger.info("publisher.scheduled.failed", { channel: post.channel, id: post.id, error });
  }
}
