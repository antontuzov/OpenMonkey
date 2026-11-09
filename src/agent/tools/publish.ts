import * as fs from "node:fs";
import * as path from "node:path";
import type {
  PublisherChannel,
  PublisherChannelStatus,
  PublisherSecret,
  ScheduledPost,
  TaskType,
} from "../../utils/types";
import { assertNetworkAllowed } from "../../utils/network";
import { config, dataRoot } from "../../utils/config";
import { publisherSecrets, type PublisherSecrets } from "../../utils/publisher-secrets";
import { publishQueue, type PublishQueue } from "../../utils/publish-queue";

/** Telegram's plain message limit, and the much shorter one a photo caption allows. */
const TELEGRAM_TEXT_LIMIT = 4_096;
const TELEGRAM_CAPTION_LIMIT = 1_024;
const REDDIT_TITLE_LIMIT = 300;
const REDDIT_TEXT_LIMIT = 40_000;
/** Bluesky counts the characters a reader sees, so an emoji is one of them. */
const BLUESKY_TEXT_LIMIT = 300;
/** Mastodon counts the characters, and every instance allows at least this many. */
const MASTODON_TEXT_LIMIT = 500;
/** What each channel takes for a picture. */
const BLUESKY_IMAGE_LIMIT = 1_000_000;
const MASTODON_IMAGE_LIMIT = 10_000_000;

const TELEGRAM_API = "https://api.telegram.org";
const REDDIT_TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
const REDDIT_API = "https://oauth.reddit.com";
const BLUESKY_API = "https://bsky.social";

interface ChannelLimit {
  /** Posts this app may make in an hour on one channel. */
  perHour: number;
  /** The shortest gap between two posts, so a loop cannot turn into a flood. */
  minGapMs: number;
}

/**
 * Deliberately slow. A marketing post that arrives every few minutes reads as a bot
 * to the platform and to the people who subscribed, and Reddit removes accounts
 * that post like one.
 */
const LIMITS: Record<PublisherChannel, ChannelLimit> = {
  telegram: { perHour: 10, minGapMs: 20_000 },
  reddit: { perHour: 2, minGapMs: 15 * 60_000 },
  bluesky: { perHour: 10, minGapMs: 20_000 },
  mastodon: { perHour: 5, minGapMs: 60_000 },
};

/**
 * Reddit's rules forbid asking for votes, and a post that does gets the account
 * removed. These are the phrasings the tool refuses rather than sends.
 */
const REDDIT_GUARDS: RegExp[] = [
  /\bplease\s+upvote/i,
  /\bupvote\s+this\b/i,
  /\bupvotes?\s+(?:please|needed|appreciated)/i,
  /\bcomment\s+and\s+i(?:'|’)?ll\b/i,
  /\bfollow\s+back\b/i,
];

export interface PublisherSettings {
  telegramChat: string;
  redditSubreddit: string;
  blueskyHandle?: string;
  mastodonInstance?: string;
}

export interface PublishDeps {
  secrets?: PublisherSecrets;
  settings?: () => PublisherSettings;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Where the hourly cap remembers its posts. */
  historyFile?: string;
  /** Where a post waits until its time comes. */
  queue?: PublishQueue;
}

export interface PostRequest {
  text: string;
  title?: string;
  imageUrl?: string;
}

/**
 * The timestamps of the posts this app made, kept on disk so the hourly cap holds
 * across restarts: an app that quits between two posts must not forget the first.
 */
export class PublishTools {
  readonly type: TaskType = "publish";

  private readonly secrets: PublisherSecrets;
  private readonly settings: () => PublisherSettings;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly history: PublishHistory;
  private readonly queue: PublishQueue;

  constructor(deps: PublishDeps = {}) {
    this.secrets = deps.secrets ?? publisherSecrets;
    this.settings =
      deps.settings ??
      (() => {
        const stored = config.get("publishing");
        return {
          telegramChat: stored?.telegramChat ?? "",
          redditSubreddit: stored?.redditSubreddit ?? "",
          blueskyHandle: stored?.blueskyHandle ?? "",
          mastodonInstance: stored?.mastodonInstance ?? "",
        };
      });
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.now = deps.now ?? (() => Date.now());
    this.history = new PublishHistory(deps.historyFile ?? publishHistoryFile(), this.now);
    this.queue = deps.queue ?? publishQueue;
  }

  async execute(action: string, args: Record<string, unknown>): Promise<string> {
    switch (action) {
      case "list_channels":
        return this.listChannels();
      case "list_scheduled":
        return this.listScheduled();
      case "post":
        return await this.post(args);
      case "schedule":
        return await this.schedule(args);
      default:
        throw new Error(`Unknown publish action: ${action}`);
    }
  }

  /** What the settings page shows about each channel. Never holds a secret. */
  status(): PublisherChannelStatus[] {
    return Object.keys(LIMITS).map((name) => {
      const channel = name as PublisherChannel;
      const limit = LIMITS[channel];
      const used = this.history.recent(channel).length;
      const target = this.target(channel);
      const hasSecret = Boolean(this.secrets.read(channel));
      return {
        channel,
        configured: Boolean(target) && hasSecret,
        target,
        hasSecret,
        postedLastHour: used,
        remaining: Math.max(0, limit.perHour - used),
      };
    });
  }

  /** What can be posted to, and how much room is left. Never shows a secret. */
  listChannels(): string {
    const lines = Object.keys(LIMITS).map((channel) => {
      const name = channel as PublisherChannel;
      const target = this.target(name);
      const hasSecret = Boolean(this.secrets.read(name));
      const limit = LIMITS[name];
      const used = this.history.recent(name).length;
      const state = !target ? `not configured — ${this.missing(name)}` : !hasSecret ? "not configured — no token saved" : "ready";
      return `- ${name}: ${state} — ${target || "no target set"} (${used} of ${limit.perHour} posts used this hour)`;
    });
    return [
      "Publishing channels:",
      ...lines,
      "",
      "A post always goes to the target set in Settings → Publishing, never anywhere else.",
    ].join("\n");
  }

  /** Posts a message to the user's own channel or account. */
  async post(args: Record<string, unknown>): Promise<string> {
    const channel = String(args.channel ?? "") as PublisherChannel;
    if (!LIMITS[channel]) throw new Error(`Unknown publishing channel: ${channel}`);

    const text = String(args.text ?? "").trim();
    if (!text) throw new Error("The post has no text");

    const secret = this.secrets.read(channel);
    if (!secret) {
      throw new Error(`No ${channel} ${this.secretNoun(channel)} is saved. Add it in Settings → Publishing first.`);
    }
    const target = this.target(channel);
    if (!target) {
      throw new Error(`No ${channel} target is set. Add it in Settings → Publishing first.`);
    }

    const request: PostRequest = {
      text,
      title: args.title ? String(args.title) : undefined,
      imageUrl: args.imageUrl ? String(args.imageUrl) : undefined,
    };
    this.checkContent(channel, request);

    const room = this.room(channel);
    if (!room.ok) throw new Error(room.message);

    assertNetworkAllowed("publish.post");

    const result = await this.postTo(channel, secret, request);

    this.history.record(channel, this.now());
    return result;
  }

  /**
   * How much room a channel has right now. The scheduler asks the same question as
   * an immediate post, so a queued post waits for the same reason an immediate one
   * is refused.
   */
  room(channel: PublisherChannel): { ok: boolean; waitMs: number; message?: string } {
    const limit = LIMITS[channel];
    const recent = this.history.recent(channel);
    if (recent.length >= limit.perHour) {
      const waitMs = Math.max(0, recent[0] + 60 * 60_000 - this.now());
      const waitMinutes = Math.ceil(waitMs / 60_000);
      return {
        ok: false,
        waitMs,
        message: `${channel} allows ${limit.perHour} posts an hour through this app, and all ${limit.perHour} are used. Try again in ${waitMinutes} minute${waitMinutes === 1 ? "" : "s"}.`,
      };
    }
    const last = recent[recent.length - 1];
    if (last !== undefined && this.now() - last < limit.minGapMs) {
      const waitMs = limit.minGapMs - (this.now() - last);
      const waitSeconds = Math.ceil(waitMs / 1000);
      return {
        ok: false,
        waitMs,
        message: `The last ${channel} post was too recent. Wait ${waitSeconds} more second${waitSeconds === 1 ? "" : "s"} before posting again.`,
      };
    }
    return { ok: true, waitMs: 0 };
  }

  /**
   * Puts a post in the queue instead of sending it now. The same rules apply as
   * for an immediate post, so a post that could never go out is refused here
   * rather than failing silently later.
   */
  async schedule(args: Record<string, unknown>): Promise<string> {
    const channel = String(args.channel ?? "") as PublisherChannel;
    if (!LIMITS[channel]) throw new Error(`Unknown publishing channel: ${channel}`);

    const text = String(args.text ?? "").trim();
    if (!text) throw new Error("The post has no text");

    const secret = this.secrets.read(channel);
    if (!secret) {
      throw new Error(`No ${channel} ${this.secretNoun(channel)} is saved. Add it in Settings → Publishing first.`);
    }
    const target = this.target(channel);
    if (!target) {
      throw new Error(`No ${channel} target is set. Add it in Settings → Publishing first.`);
    }
    if (!this.queue.available()) {
      throw new Error(
        "The app cannot hold a scheduled post right now: the history is locked, so the post would have nowhere to wait."
      );
    }

    const request: PostRequest = {
      text,
      title: args.title ? String(args.title) : undefined,
      imageUrl: args.imageUrl ? String(args.imageUrl) : undefined,
    };
    this.checkContent(channel, request);

    const dueAt = parseWhen(String(args.when ?? ""), this.now());
    if (dueAt <= this.now()) {
      throw new Error("That time is not in the future. Say when the post should go out.");
    }
    if (dueAt - this.now() > MAX_SCHEDULE_MS) {
      throw new Error("A post can be scheduled up to 30 days ahead.");
    }
    this.queue.add({
      channel,
      text,
      title: request.title,
      imageUrl: request.imageUrl,
      dueAt,
    });

    return [
      `Scheduled: the post goes to ${channel === "reddit" ? `r/${target}` : target} on ${formatWhen(dueAt)}.`,
      "The user approves the post now, and the app sends exactly that text when the time comes.",
      "It can be cancelled in Settings → Publishing.",
    ].join(" ");
  }

  /** The posts that are waiting, and the ones that went out. */
  listScheduled(): string {
    const posts = this.queue.list();
    if (!posts.length) return "No posts are scheduled.";
    const lines = posts.map((post) => {
      const state =
        post.status === "pending"
          ? `scheduled for ${formatWhen(post.dueAt)}`
          : post.status === "posted"
            ? `posted ${post.postedAt ? formatWhen(post.postedAt) : ""}`.trim()
            : `failed: ${post.error ?? "unknown reason"}`;
      return `- ${post.id}: ${post.channel} — ${state} — ${post.text.slice(0, 80)}`;
    });
    return ["Scheduled posts:", ...lines].join("\n");
  }

  /** The posts the scheduler still has to send. */
  pendingPosts(): ScheduledPost[] {
    return this.queue.list(["pending"]);
  }

  /** Asks the channel who this account is, so the user can see the token works. */
  async check(channel: PublisherChannel): Promise<string> {
    if (!LIMITS[channel]) throw new Error(`Unknown publishing channel: ${channel}`);
    const secret = this.secrets.read(channel);
    if (!secret) {
      throw new Error(`No ${channel} ${this.secretNoun(channel)} is saved. Add it in Settings → Publishing first.`);
    }
    assertNetworkAllowed("publish.check");
    if (channel === "telegram") return await this.checkTelegram(secret);
    if (channel === "reddit") return await this.checkReddit(secret);
    if (channel === "bluesky") return await this.checkBluesky(secret);
    return await this.checkMastodon(secret);
  }

  private async postTo(
    channel: PublisherChannel,
    secret: PublisherSecret,
    request: PostRequest
  ): Promise<string> {
    if (channel === "telegram") return await this.postTelegram(secret, request);
    if (channel === "reddit") return await this.postReddit(secret, request);
    if (channel === "bluesky") return await this.postBluesky(secret, request);
    return await this.postMastodon(secret, request);
  }

  /** The name of the one thing a channel has to be given. */
  private secretNoun(channel: PublisherChannel): string {
    if (channel === "bluesky") return "app password";
    if (channel === "mastodon") return "access token";
    return "token";
  }

  private target(channel: PublisherChannel): string {
    const settings = this.settings();
    if (channel === "telegram") return settings.telegramChat.trim();
    if (channel === "reddit") return settings.redditSubreddit.trim();
    if (channel === "bluesky") return (settings.blueskyHandle ?? "").trim();
    return (settings.mastodonInstance ?? "").trim();
  }

  private missing(channel: PublisherChannel): string {
    if (channel === "telegram") return "no chat id";
    if (channel === "reddit") return "no subreddit";
    if (channel === "bluesky") return "no handle";
    return "no instance";
  }

  /** The Mastodon instance as an address, or null when it is not one. */
  private instance(): string | null {
    const raw = this.target("mastodon");
    if (!raw) return null;
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    let parsed: URL;
    try {
      parsed = new URL(withScheme);
    } catch {
      return null;
    }
    // A token sent over plain http would travel in the clear, so only https is allowed.
    if (parsed.protocol !== "https:") return null;
    return parsed.toString().replace(/\/+$/, "");
  }

  /** Refuses what the platform forbids and what its own limits forbid. */
  private checkContent(channel: PublisherChannel, request: PostRequest): void {
    if (channel === "telegram") {
      const limit = request.imageUrl ? TELEGRAM_CAPTION_LIMIT : TELEGRAM_TEXT_LIMIT;
      if (request.text.length > limit) {
        throw new Error(
          `A Telegram ${request.imageUrl ? "photo caption" : "message"} holds ${limit} characters; this one has ${request.text.length}.`
        );
      }
      return;
    }

    if (channel === "reddit") {
      if (request.imageUrl) {
        throw new Error("Reddit posts cannot carry an image from a URL. Post the text and add the picture in Reddit itself.");
      }
      if (!request.title?.trim()) throw new Error("A Reddit post needs a title.");
      if (request.title.length > REDDIT_TITLE_LIMIT) {
        throw new Error(`A Reddit title holds ${REDDIT_TITLE_LIMIT} characters; this one has ${request.title.length}.`);
      }
      if (request.text.length > REDDIT_TEXT_LIMIT) {
        throw new Error(`A Reddit post holds ${REDDIT_TEXT_LIMIT} characters; this one has ${request.text.length}.`);
      }
      for (const guard of REDDIT_GUARDS) {
        if (guard.test(request.text) || guard.test(request.title ?? "")) {
          throw new Error(
            "Reddit's rules forbid asking for votes or for comments. This post was not sent; take the request out and try again."
          );
        }
      }
      return;
    }

    if (channel === "bluesky") {
      const length = graphemeLength(request.text);
      if (length > BLUESKY_TEXT_LIMIT) {
        throw new Error(`A Bluesky post holds ${BLUESKY_TEXT_LIMIT} characters; this one has ${length}.`);
      }
      return;
    }

    const length = [...request.text].length;
    if (length > MASTODON_TEXT_LIMIT) {
      throw new Error(`A Mastodon post holds ${MASTODON_TEXT_LIMIT} characters; this one has ${length}.`);
    }
  }

  private async postTelegram(secret: PublisherSecret, request: PostRequest): Promise<string> {
    const token = secret.token?.trim();
    if (!token) throw new Error("The Telegram bot token is missing. Save it in Settings → Publishing.");
    const chat = this.target("telegram");
    const method = request.imageUrl ? "sendPhoto" : "sendMessage";
    const body = request.imageUrl
      ? { chat_id: chat, photo: request.imageUrl, caption: request.text }
      : { chat_id: chat, text: request.text, disable_web_page_preview: true };

    const payload = await this.json(`${TELEGRAM_API}/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!payload.ok) {
      throw new Error(`Telegram refused the message: ${payload.description ?? "unknown reason"}`);
    }
    const result = payload.result as { message_id?: number; chat?: { title?: string; username?: string } } | undefined;
    const where = result?.chat?.title ?? result?.chat?.username ?? chat;
    const id = result?.message_id;
    return `Posted to Telegram ${where}${id ? ` (message ${id})` : ""}`;
  }

  private async checkTelegram(secret: PublisherSecret): Promise<string> {
    const token = secret.token?.trim();
    if (!token) throw new Error("The Telegram bot token is missing. Save it in Settings → Publishing.");
    const payload = await this.json(`${TELEGRAM_API}/bot${token}/getMe`, { method: "GET" });
    if (!payload.ok) throw new Error(`Telegram refused the token: ${payload.description ?? "unknown reason"}`);
    const bot = payload.result as { username?: string; first_name?: string } | undefined;
    const name = bot?.username ? `@${bot.username}` : (bot?.first_name ?? "the bot");
    return `Telegram accepted the token. The bot is ${name}.`;
  }

  private async postReddit(secret: PublisherSecret, request: PostRequest): Promise<string> {
    const token = await this.redditToken(secret);
    const subreddit = this.target("reddit").replace(/^\/?r\//i, "");
    const body = new URLSearchParams({
      api_type: "json",
      kind: "self",
      sr: subreddit,
      title: (request.title ?? "").trim(),
      text: request.text,
    });

    const payload = await this.json(`${REDDIT_API}/api/submit`, {
      method: "POST",
      headers: {
        authorization: `bearer ${token}`,
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": this.userAgent(secret),
      },
      body: body.toString(),
    });

    const errors = (payload.json as { errors?: unknown[] } | undefined)?.errors;
    if (Array.isArray(errors) && errors.length) {
      const detail = errors
        .map((entry) => (Array.isArray(entry) ? String(entry[1] ?? entry[0]) : String(entry)))
        .join("; ");
      throw new Error(`Reddit refused the post: ${detail}`);
    }
    const data = (payload.json as { data?: { id?: string; name?: string; url?: string } } | undefined)?.data;
    const name = data?.name ?? data?.id;
    const link = data?.url ?? (data?.id ? `https://www.reddit.com/comments/${data.id}` : "");
    return `Posted to Reddit r/${subreddit}${name ? ` (${name})` : ""}${link ? ` — ${link}` : ""}`;
  }

  private async checkReddit(secret: PublisherSecret): Promise<string> {
    const token = await this.redditToken(secret);
    const payload = await this.json(`${REDDIT_API}/api/v1/me`, {
      method: "GET",
      headers: { authorization: `bearer ${token}`, "user-agent": this.userAgent(secret) },
    });
    const name = (payload as { name?: string }).name;
    if (!name) throw new Error("Reddit accepted the token but did not name the account.");
    return `Reddit accepted the credentials. The account is u/${name}.`;
  }

  /** Reddit requires a descriptive user agent and rejects the generic ones. */
  private userAgent(secret: PublisherSecret): string {
    return `OpenMonkey/1.0 (by /u/${secret.username ?? "user"})`;
  }

  private async redditToken(secret: PublisherSecret): Promise<string> {
    const clientId = secret.clientId?.trim();
    const clientSecret = secret.clientSecret?.trim();
    const username = secret.username?.trim();
    const password = secret.password ?? "";
    if (!clientId || !clientSecret || !username || !password) {
      throw new Error(
        "Reddit needs the script app id, the app secret, the account name and the account password. Save them in Settings → Publishing."
      );
    }

    const body = new URLSearchParams({
      grant_type: "password",
      username,
      password,
    });
    const payload = await this.json(REDDIT_TOKEN_URL, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": this.userAgent(secret),
      },
      body: body.toString(),
    });

    const token = (payload as { access_token?: string }).access_token;
    if (!token) throw new Error("Reddit did not return an access token. Check the app id, the secret and the account.");
    return token;
  }

  /** Every answer is JSON here, and a body that is not JSON is a real failure. */
  private async json(url: string, init: RequestInit): Promise<Record<string, any>> {
    const { ok, status, payload } = await this.callJson(url, init);
    if (!ok && payload.ok !== true) {
      throw new Error(`The channel answered with HTTP ${status}.`);
    }
    return payload;
  }

  /**
   * The call, with the answer as it came. A channel that says no in its own words —
   * Bluesky and Mastodon both do — has to be able to say it, so the body is kept.
   */
  private async callJson(
    url: string,
    init: RequestInit
  ): Promise<{ ok: boolean; status: number; payload: Record<string, any> }> {
    const response = await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(30_000) });
    const body = await response.text();
    let payload: Record<string, any>;
    try {
      payload = JSON.parse(body) as Record<string, any>;
    } catch {
      throw new Error(`The channel answered with something that is not JSON (HTTP ${response.status}).`);
    }
    return { ok: response.ok, status: response.status, payload };
  }

  /** Bluesky signs the app in and keeps the session for the post. */
  private async blueskySession(
    secret: PublisherSecret
  ): Promise<{ accessJwt: string; did: string; handle: string }> {
    const identifier = secret.identifier?.trim();
    const password = secret.password;
    if (!identifier || !password) {
      throw new Error("Bluesky needs the handle the app password belongs to and the app password itself.");
    }

    const { ok, status, payload } = await this.callJson(
      `${BLUESKY_API}/xrpc/com.atproto.server.createSession`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identifier, password }),
      }
    );
    if (!ok) {
      throw new Error(`Bluesky refused the sign-in: ${payload?.message ?? payload?.error ?? `HTTP ${status}`}`);
    }
    const accessJwt = String(payload?.accessJwt ?? "");
    const did = String(payload?.did ?? "");
    const handle = String(payload?.handle ?? "");
    if (!accessJwt || !did) throw new Error("Bluesky accepted the sign-in but returned no session.");

    const target = this.target("bluesky");
    const isHandle = target.includes(".") && !target.includes("@") && !target.startsWith("did:");
    if (isHandle && handle.toLowerCase() !== target.toLowerCase()) {
      throw new Error(
        `The Bluesky sign-in belongs to @${handle}, not to @${target}. Check the handle in Settings → Publishing.`
      );
    }
    return { accessJwt, did, handle };
  }

  private async postBluesky(secret: PublisherSecret, request: PostRequest): Promise<string> {
    const session = await this.blueskySession(secret);
    const record: Record<string, unknown> = {
      $type: "app.bsky.feed.post",
      text: request.text,
      createdAt: new Date(this.now()).toISOString(),
      langs: [config.get("ui").language],
    };

    if (request.imageUrl) {
      const image = await this.fetchImage(request.imageUrl, BLUESKY_IMAGE_LIMIT);
      const blob = await this.blueskyBlob(session, image);
      record.embed = { $type: "app.bsky.embed.images", images: [{ image: blob, alt: "" }] };
    }

    const { ok, status, payload } = await this.callJson(
      `${BLUESKY_API}/xrpc/com.atproto.repo.createRecord`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${session.accessJwt}`, "content-type": "application/json" },
        body: JSON.stringify({
          repo: session.did,
          collection: "app.bsky.feed.post",
          record,
        }),
      }
    );
    if (!ok) {
      throw new Error(`Bluesky refused the post: ${payload?.message ?? payload?.error ?? `HTTP ${status}`}`);
    }
    const uri = String(payload?.uri ?? "");
    const handle = session.handle || this.target("bluesky");
    return `Posted to Bluesky @${handle}${uri ? ` (${uri})` : ""}`;
  }

  /** The picture is uploaded on its own, and the post points at the blob it returned. */
  private async blueskyBlob(
    session: { accessJwt: string },
    image: { bytes: Buffer; type: string }
  ): Promise<Record<string, unknown>> {
    const { ok, status, payload } = await this.callJson(
      `${BLUESKY_API}/xrpc/com.atproto.repo.uploadBlob`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${session.accessJwt}`, "content-type": image.type },
        body: Uint8Array.from(image.bytes),
      }
    );
    if (!ok) {
      throw new Error(`Bluesky refused the picture: ${payload?.message ?? payload?.error ?? `HTTP ${status}`}`);
    }
    const blob = payload?.blob;
    if (!blob) throw new Error("Bluesky took the picture but returned no blob.");
    return blob as Record<string, unknown>;
  }

  private async checkBluesky(secret: PublisherSecret): Promise<string> {
    const session = await this.blueskySession(secret);
    return `Bluesky accepted the app password. The account is @${session.handle}.`;
  }

  private async postMastodon(secret: PublisherSecret, request: PostRequest): Promise<string> {
    const token = secret.accessToken?.trim();
    if (!token) throw new Error("The Mastodon access token is missing. Save it in Settings → Publishing.");
    const instance = this.instance();
    if (!instance) {
      throw new Error("The Mastodon instance address is not an https address. Set it in Settings → Publishing.");
    }

    const mediaIds: string[] = [];
    if (request.imageUrl) {
      const image = await this.fetchImage(request.imageUrl, MASTODON_IMAGE_LIMIT);
      const form = new FormData();
      form.append("file", new Blob([Uint8Array.from(image.bytes)], { type: image.type }), "picture");
      const { ok, status, payload } = await this.callJson(`${instance}/api/v2/media`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: form,
      });
      if (!ok) {
        throw new Error(`Mastodon refused the picture: ${payload?.error ?? `HTTP ${status}`}`);
      }
      const id = String(payload?.id ?? "");
      if (!id) throw new Error("Mastodon took the picture but returned no media id.");
      mediaIds.push(id);
    }

    const { ok, status, payload } = await this.callJson(`${instance}/api/v1/statuses`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ status: request.text, media_ids: mediaIds }),
    });
    if (!ok) {
      throw new Error(`Mastodon refused the post: ${payload?.error ?? `HTTP ${status}`}`);
    }
    const account = String(payload?.account?.acct ?? "");
    const url = String(payload?.url ?? "");
    return `Posted to Mastodon ${account || this.target("mastodon")}${url ? ` — ${url}` : ""}`;
  }

  private async checkMastodon(secret: PublisherSecret): Promise<string> {
    const token = secret.accessToken?.trim();
    if (!token) throw new Error("The Mastodon access token is missing. Save it in Settings → Publishing.");
    const instance = this.instance();
    if (!instance) {
      throw new Error("The Mastodon instance address is not an https address. Set it in Settings → Publishing.");
    }
    const { ok, status, payload } = await this.callJson(`${instance}/api/v1/accounts/verify_credentials`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
    });
    if (!ok) {
      throw new Error(`Mastodon refused the token: ${payload?.error ?? `HTTP ${status}`}`);
    }
    const account = String(payload?.acct ?? "");
    if (!account) throw new Error("Mastodon accepted the token but did not name the account.");
    return `Mastodon accepted the token. The account is @${account} on ${instance}.`;
  }

  /**
   * The picture is fetched here rather than by the platform, so the address is
   * checked first: the app must not be talked into reading the local network.
   */
  private async fetchImage(
    imageUrl: string,
    maxBytes: number
  ): Promise<{ bytes: Buffer; type: string }> {
    let parsed: URL;
    try {
      parsed = new URL(imageUrl);
    } catch {
      throw new Error("That image address is not a web address.");
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error(`Refusing ${parsed.protocol} image; only http(s) is allowed`);
    }
    if (isPrivateAddress(parsed.hostname)) {
      throw new Error("Refusing to fetch a picture from a private address.");
    }

    const response = await this.fetchImpl(parsed.toString(), { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) {
      throw new Error(`The picture could not be fetched (HTTP ${response.status}).`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maxBytes) {
      throw new Error(
        `The picture is ${Math.round(bytes.length / 1024)} KB; this channel takes ${Math.round(maxBytes / 1024)} KB.`
      );
    }
    const type = (response.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim();
    return { bytes, type };
  }
}

/**
 * The timestamps of the posts this app made, kept on disk so the hourly cap holds
 * across restarts: an app that quits between two posts must not forget the first.
 */
class PublishHistory {
  private stamps: Record<string, number[]> = Object.fromEntries(
    Object.keys(LIMITS).map((channel) => [channel, [] as number[]])
  );

  constructor(
    private readonly file = publishHistoryFile(),
    private readonly now: () => number = () => Date.now()
  ) {
    this.load();
  }

  private load(): void {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, "utf8")) as Record<string, unknown>;
      for (const channel of Object.keys(this.stamps)) {
        const list = raw?.[channel];
        if (Array.isArray(list)) this.stamps[channel] = list.filter((value) => typeof value === "number");
      }
    } catch {
      // No history yet, or a damaged file: the cap starts from empty.
    }
  }

  /** The posts of one channel inside the last hour, oldest first. */
  recent(channel: PublisherChannel): number[] {
    const cutoff = this.now() - 60 * 60_000;
    return (this.stamps[channel] ?? []).filter((stamp) => stamp > cutoff);
  }

  record(channel: PublisherChannel, at: number): void {
    this.stamps[channel] = [...(this.stamps[channel] ?? []), at].filter((stamp) => stamp > at - 60 * 60_000);
    this.save();
  }

  private save(): void {
    try {
      fs.writeFileSync(this.file, JSON.stringify(this.stamps), { mode: 0o600 });
    } catch {
      // A history that cannot be written only costs the cap, not the post.
    }
  }
}

function publishHistoryFile(): string {
  return path.join(dataRoot(), "publish-history.json");
}

/**
 * The fields one channel needs, checked before they are stored. Only those fields
 * are kept, so a stray value in the form never reaches the keychain.
 */
export function buildSecret(channel: PublisherChannel, input: unknown): PublisherSecret {
  const source = (input ?? {}) as Record<string, unknown>;
  const text = (name: string): string =>
    typeof source[name] === "string" ? String(source[name]).trim() : "";

  if (channel === "telegram") {
    const token = text("token");
    if (!token) throw new Error("The Telegram bot token is required.");
    if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) {
      throw new Error("That does not look like a Telegram bot token. It is the one BotFather gave you.");
    }
    return { token };
  }

  if (channel === "reddit") {
    const clientId = text("clientId");
    const clientSecret = text("clientSecret");
    const username = text("username");
    const password = typeof source.password === "string" ? source.password : "";
    if (!clientId || !clientSecret || !username || !password) {
      throw new Error(
        "Reddit needs the script app id, the app secret, the account name and the account password."
      );
    }
    return { clientId, clientSecret, username, password };
  }

  if (channel === "bluesky") {
    const identifier = text("identifier");
    const password = typeof source.password === "string" ? source.password : "";
    if (!identifier || !password) {
      throw new Error("Bluesky needs the handle the app password belongs to and the app password itself.");
    }
    const looksRight =
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier) ||
      /^did:[a-z]+:[a-z0-9]+$/.test(identifier) ||
      /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(identifier);
    if (!looksRight) {
      throw new Error("That does not look like a Bluesky handle, email or DID.");
    }
    return { identifier, password };
  }

  if (channel === "mastodon") {
    const accessToken = text("accessToken");
    if (!accessToken) {
      throw new Error("The Mastodon access token is required.");
    }
    return { accessToken };
  }

  throw new Error(`Unknown publishing channel: ${channel}`);
}

/** How many characters a reader sees, so an emoji counts as one. */
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function graphemeLength(text: string): number {
  return [...segmenter.segment(text)].length;
}

/** How far ahead a post may be scheduled. */
const MAX_SCHEDULE_MS = 30 * 24 * 60 * 60_000;

/**
 * Reads the time a post should go out: "in 45 minutes", "in 2 hours", or a date
 * like 2026-11-10T09:00. The relative form is the one the tool asks for, because
 * a small model writes it far more reliably than a timestamp.
 */
export function parseWhen(value: string, now: number): number {
  const text = value.trim();
  if (!text) throw new Error("The scheduled post has no time. Say when it should go out.");

  const relative = /^in\s+(\d+(?:\.\d+)?)\s*(minute|minutes|hour|hours|day|days)\b/i.exec(text);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2].toLowerCase();
    const step = unit.startsWith("day")
      ? 24 * 60 * 60_000
      : unit.startsWith("hour")
        ? 60 * 60_000
        : 60_000;
    return now + Math.round(amount * step);
  }

  const parsed = Date.parse(text);
  if (!Number.isNaN(parsed)) return parsed;

  throw new Error(
    'That time could not be read. Say "in 45 minutes", "in 2 hours", or give a date like 2026-11-10T09:00.'
  );
}

/** A time a person can read: the day and the clock, in the local zone. */
export function formatWhen(at: number): string {
  return new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * The addresses on the local network and the loopback. A picture address comes
 * from the model, and the app fetches it itself, so it must not be talked into
 * reading the router or the machine it runs on.
 */
function isPrivateAddress(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host === "::1" || host === "0.0.0.0" || host === "::") return true;
  const parts = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!parts) return false;
  const first = Number(parts[1]);
  const second = Number(parts[2]);
  if (first === 0 || first === 10 || first === 127) return true;
  if (first === 192 && second === 168) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 169 && second === 254) return true;
  return false;
}
