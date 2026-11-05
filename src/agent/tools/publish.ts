import * as fs from "node:fs";
import * as path from "node:path";
import type {
  PublisherChannel,
  PublisherChannelStatus,
  PublisherSecret,
  TaskType,
} from "../../utils/types";
import { assertNetworkAllowed } from "../../utils/network";
import { config, dataRoot } from "../../utils/config";
import { publisherSecrets, type PublisherSecrets } from "../../utils/publisher-secrets";

/** Telegram's plain message limit, and the much shorter one a photo caption allows. */
const TELEGRAM_TEXT_LIMIT = 4_096;
const TELEGRAM_CAPTION_LIMIT = 1_024;
const REDDIT_TITLE_LIMIT = 300;
const REDDIT_TEXT_LIMIT = 40_000;

const TELEGRAM_API = "https://api.telegram.org";
const REDDIT_TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
const REDDIT_API = "https://oauth.reddit.com";

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
}

export interface PublishDeps {
  secrets?: PublisherSecrets;
  settings?: () => PublisherSettings;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Where the hourly cap remembers its posts. */
  historyFile?: string;
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

  constructor(deps: PublishDeps = {}) {
    this.secrets = deps.secrets ?? publisherSecrets;
    this.settings =
      deps.settings ??
      (() => {
        const stored = config.get("publishing");
        return {
          telegramChat: stored?.telegramChat ?? "",
          redditSubreddit: stored?.redditSubreddit ?? "",
        };
      });
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.now = deps.now ?? (() => Date.now());
    this.history = new PublishHistory(deps.historyFile ?? publishHistoryFile(), this.now);
  }

  async execute(action: string, args: Record<string, unknown>): Promise<string> {
    switch (action) {
      case "list_channels":
        return this.listChannels();
      case "post":
        return await this.post(args);
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
      throw new Error(`No ${channel} token is saved. Add it in Settings → Publishing first.`);
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

    const limit = LIMITS[channel];
    const recent = this.history.recent(channel);
    if (recent.length >= limit.perHour) {
      const waitMinutes = Math.ceil((recent[0] + 60 * 60_000 - this.now()) / 60_000);
      throw new Error(
        `${channel} allows ${limit.perHour} posts an hour through this app, and all ${limit.perHour} are used. Try again in ${waitMinutes} minute${waitMinutes === 1 ? "" : "s"}.`
      );
    }
    const last = recent[recent.length - 1];
    if (last !== undefined && this.now() - last < limit.minGapMs) {
      const waitSeconds = Math.ceil((limit.minGapMs - (this.now() - last)) / 1000);
      throw new Error(
        `The last ${channel} post was too recent. Wait ${waitSeconds} more second${waitSeconds === 1 ? "" : "s"} before posting again.`
      );
    }

    assertNetworkAllowed("publish.post");

    const result =
      channel === "telegram"
        ? await this.postTelegram(secret, request)
        : await this.postReddit(secret, request);

    this.history.record(channel, this.now());
    return result;
  }

  /** Asks the channel who this account is, so the user can see the token works. */
  async check(channel: PublisherChannel): Promise<string> {
    if (!LIMITS[channel]) throw new Error(`Unknown publishing channel: ${channel}`);
    const secret = this.secrets.read(channel);
    if (!secret) throw new Error(`No ${channel} token is saved. Add it in Settings → Publishing first.`);
    assertNetworkAllowed("publish.check");
    return channel === "telegram" ? await this.checkTelegram(secret) : await this.checkReddit(secret);
  }

  private target(channel: PublisherChannel): string {
    const settings = this.settings();
    const value = channel === "telegram" ? settings.telegramChat : settings.redditSubreddit;
    return value.trim();
  }

  private missing(channel: PublisherChannel): string {
    return channel === "telegram" ? "no chat id" : "no subreddit";
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
    const response = await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(30_000) });
    const body = await response.text();
    let payload: Record<string, any>;
    try {
      payload = JSON.parse(body) as Record<string, any>;
    } catch {
      throw new Error(`The channel answered with something that is not JSON (HTTP ${response.status}).`);
    }
    if (!response.ok && payload.ok !== true) {
      throw new Error(`The channel answered with HTTP ${response.status}.`);
    }
    return payload;
  }
}

/**
 * The timestamps of the posts this app made, kept on disk so the hourly cap holds
 * across restarts: an app that quits between two posts must not forget the first.
 */
class PublishHistory {
  private stamps: Record<string, number[]> = { telegram: [], reddit: [] };

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

  throw new Error(`Unknown publishing channel: ${channel}`);
}
