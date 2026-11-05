import { shell } from "electron";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { TaskType } from "../../utils/types";
import { assertNetworkAllowed } from "../../utils/network";
import { resolveInWorkspace } from "./paths";

const MAX_TEXT = 12_000;
const MAX_IMAGE_BYTES = 25_000_000;
const USER_AGENT = "OpenMonkey/1.0 (local agent)";
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_ENTRIES = 30;
const HOST_INTERVAL_MS = 750;

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/avif": ".avif",
  "image/svg+xml": ".svg",
};

interface CacheEntry {
  body: string;
  expires: number;
}

interface RobotsRule {
  allow: boolean;
  path: string;
}

interface ImageHit {
  title: string;
  image: string;
  page: string;
  credit: string;
  license: string;
  width: number;
  height: number;
}

/**
 * HTTP + text extraction only. The prompt asked for a "web browser" tool; pulling in
 * a headless browser would ship another ~300 MB of Chromium into a privacy app, so
 * pages are fetched over HTTPS and links open in the user's real browser.
 */
export class WebBrowserTools {
  readonly type: TaskType = "web";
  private cache = new Map<string, CacheEntry>();
  private robots = new Map<string, { rules: RobotsRule[]; expires: number }>();
  private lastRequest = new Map<string, number>();

  async execute(action: string, args: Record<string, unknown>): Promise<string> {
    // open_in_browser hands the URL to the user's own browser, so it is their request,
    // not the app's; only the fetches this class performs are behind the switch.
    if (action === "fetch_page" || action === "search" || action === "image_search" || action === "save_image") {
      assertNetworkAllowed(`web.${action}`);
    }
    switch (action) {
      case "fetch_page":
        return this.fetchPage(String(args.url ?? ""));
      case "search":
        return this.search(String(args.query ?? ""));
      case "image_search":
        return this.searchImages(String(args.query ?? ""), Number(args.count ?? 8));
      case "save_image":
        return this.saveImage(String(args.url ?? ""), String(args.path ?? ""));
      case "open_in_browser": {
        const url = this.assertHttpUrl(String(args.url ?? ""));
        await shell.openExternal(url);
        return `Opened ${url} in the default browser`;
      }
      default:
        throw new Error(`Unknown web action: ${action}`);
    }
  }

  private assertHttpUrl(url: string): string {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`Refusing ${parsed.protocol} URL; only http(s) is allowed`);
    }
    return parsed.toString();
  }

  private async get(url: string, cacheKey: string, extraHeaders: Record<string, string> = {}): Promise<string> {
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expires > Date.now()) return cached.body;

    const parsed = new URL(url);
    await this.waitTurn(parsed.host);

    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,text/plain;q=0.9,*/*;q=0.5",
        ...extraHeaders,
      },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
    if (response.url && !/^https?:/i.test(response.url)) throw new Error(`Refusing redirect to ${response.url}`);
    const body = await response.text();

    if (this.cache.size >= CACHE_ENTRIES) {
      const oldest = [...this.cache.entries()].sort((a, b) => a[1].expires - b[1].expires)[0];
      if (oldest) this.cache.delete(oldest[0]);
    }
    this.cache.set(cacheKey, { body, expires: Date.now() + CACHE_TTL_MS });
    return body;
  }

  private async waitTurn(host: string): Promise<void> {
    const last = this.lastRequest.get(host) ?? 0;
    const wait = last + HOST_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    this.lastRequest.set(host, Date.now());
  }

  private async fetchPage(url: string): Promise<string> {
    const page = await this.readPage(url);
    return `${page.title}\n${page.url}\n\n${truncate(page.text)}`;
  }

  /** Reads a page the way the tool does, so a preview and the tool agree on the content. */
  async readPage(url: string): Promise<{ title: string; url: string; text: string }> {
    assertNetworkAllowed("web.fetch_page");
    const parsed = new URL(this.assertHttpUrl(url));
    if (!(await this.allowedByRobots(parsed))) {
      throw new Error(`robots.txt on ${parsed.host} disallows fetching ${parsed.pathname}`);
    }
    const html = await this.get(parsed.toString(), `page:${parsed.toString()}`);
    const title = decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? parsed.toString());
    return { title, url: parsed.toString(), text: readableText(html) };
  }

  /**
   * Two free indexes, tried in order, because a search tied to one service is only as
   * reliable as that service: Openverse answered HTTP 500 for hours while this was
   * being written. Both sources return JSON with a licence and an author attached,
   * which is the point — DuckDuckGo's and Bing's image endpoints hand back thumbnails
   * with no rights information and bot-challenge most shared networks, so a scraped
   * result there is a picture the user cannot safely publish anywhere.
   */
  private async searchImages(query: string, count: number): Promise<string> {
    const trimmed = query.trim();
    if (!trimmed) throw new Error("Empty search query");
    const wanted = Math.max(1, Math.min(20, Math.round(count)));

    const sources: { label: string; find: (limit: number) => Promise<{ total: number; hits: ImageHit[] }> }[] = [
      { label: "Openverse", find: (limit) => this.openverseImages(trimmed, limit) },
      { label: "Wikimedia Commons", find: (limit) => this.commonsImages(trimmed, limit) },
    ];

    const failures: string[] = [];
    for (const source of sources) {
      try {
        const { total, hits } = await source.find(wanted);
        if (hits.length) return formatImages(trimmed, source.label, total, hits);
        failures.push(`${source.label}: nothing licensed`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${source.label}: ${/HTTP \d{3}/.exec(message)?.[0] ?? message}`);
      }
    }

    if (failures.some((entry) => /429/.test(entry))) {
      return "Image search is capped for this network today (429). Try again later; repeating the search only spends the cap faster.";
    }
    return `Image search found nothing for "${trimmed}" (${failures.join("; ")})`;
  }

  private async openverseImages(query: string, limit: number): Promise<{ total: number; hits: ImageHit[] }> {
    const url = `https://api.openverse.org/v1/images/?query=${encodeURIComponent(query)}&page_size=${limit}&mature=false`;
    const body = await this.get(url, `images:${query.toLowerCase()}`, { Accept: "application/json" });
    const payload = parseJson(body);
    const results = Array.isArray(payload.results) ? payload.results : [];
    const hits = results
      .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object")
      .map((entry) => ({
        title: decodeEntities(String(entry.title ?? "")),
        image: typeof entry.url === "string" ? entry.url : "",
        page: typeof entry.foreign_landing_url === "string" ? entry.foreign_landing_url : "",
        credit: typeof entry.creator === "string" && entry.creator ? entry.creator : "author unknown",
        license: [entry.license, entry.license_version].filter(Boolean).join(" "),
        width: Number(entry.width ?? 0),
        height: Number(entry.height ?? 0),
      }))
      .filter((hit) => /^https?:/i.test(hit.image))
      .slice(0, limit);
    return { total: Number(payload.result_count ?? hits.length), hits };
  }

  private async commonsImages(query: string, limit: number): Promise<{ total: number; hits: ImageHit[] }> {
    const params = [
      "action=query",
      "format=json",
      "generator=search",
      `gsrsearch=${encodeURIComponent(`filetype:bitmap ${query}`)}`,
      `gsrlimit=${limit}`,
      "gsrnamespace=6",
      "prop=imageinfo",
      "iiprop=url|size|extmetadata",
    ];
    const body = await this.get(
      `https://commons.wikimedia.org/w/api.php?${params.join("&")}`,
      `commons:${query.toLowerCase()}`,
      { Accept: "application/json" }
    );
    const payload = parseJson(body);
    const pages = Object.values((payload.query as { pages?: Record<string, unknown> })?.pages ?? {})
      .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object")
      .sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0));

    const hits: ImageHit[] = [];
    for (const page of pages) {
      const info = (Array.isArray(page.imageinfo) ? page.imageinfo : [])[0] as Record<string, unknown> | undefined;
      const image = typeof info?.url === "string" ? stripCommonsTracking(info.url) : "";
      if (!/^https?:/i.test(image)) continue;
      const meta = (info?.extmetadata ?? {}) as Record<string, { value?: string }>;
      hits.push({
        title: decodeEntities(String(page.title ?? image)).replace(/^File:/, ""),
        image,
        page: typeof page.descriptionurl === "string" ? page.descriptionurl : "",
        credit: meta.Artist?.value ? stripHtml(meta.Artist.value) || "author unknown" : "author unknown",
        license: meta.LicenseShortName?.value ? stripHtml(meta.LicenseShortName.value) : "",
        width: Number(info?.width ?? 0),
        height: Number(info?.height ?? 0),
      });
      if (hits.length >= limit) break;
    }
    return { total: hits.length, hits };
  }

  /** DuckDuckGo's HTML-lite endpoint keeps search result parsing dependency-free. */
  private async search(query: string): Promise<string> {
    if (!query.trim()) throw new Error("Empty search query");
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const html = await this.get(url, `search:${query.trim().toLowerCase()}`);

    const results: string[] = [];
    const linkPattern = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    let match: RegExpExecArray | null;
    while ((match = linkPattern.exec(html)) && results.length < 8) {
      const href = decodeDuckDuckGoRedirect(match[1]);
      const title = stripHtml(match[2]);
      let host = "";
      try {
        host = new URL(href).host;
      } catch {
        host = "unknown source";
      }
      results.push(`${results.length + 1}. ${title} — ${host}\n   ${href}`);
    }

    if (!results.length) return `No results parsed for "${query}"`;
    return `Results for ${query}:\n${results.join("\n")}`;
  }

  /** Saves a found image into the workspace so a later task can attach or edit it. */
  private async saveImage(url: string, target: string): Promise<string> {
    const parsed = new URL(this.assertHttpUrl(url));
    const file = await resolveInWorkspace(target);
    if ((await fs.stat(file).catch(() => null))?.isDirectory()) throw new Error(`${file} is a folder`);
    if (!(await this.allowedByRobots(parsed))) {
      throw new Error(`robots.txt on ${parsed.host} disallows fetching ${parsed.pathname}`);
    }

    await this.waitTurn(parsed.host);
    const response = await fetch(parsed.toString(), {
      headers: { "User-Agent": USER_AGENT, Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8" },
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
    if (response.url && !/^https?:/i.test(response.url)) throw new Error(`Refusing redirect to ${response.url}`);

    const kind = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const extension = IMAGE_EXTENSIONS[kind];
    if (!extension) throw new Error(`${url} is ${kind || "an unknown type"}, not an image this app can save`);

    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) throw new Error(`${url} returned no bytes`);
    if (buffer.length > MAX_IMAGE_BYTES) {
      throw new Error(`${url} is ${buffer.length} bytes; the cap is ${MAX_IMAGE_BYTES}`);
    }

    const parsedFile = path.parse(file);
    const destination =
      parsedFile.ext.toLowerCase() === extension ? file : path.join(parsedFile.dir, `${parsedFile.name}${extension}`);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, buffer);
    return `Saved ${buffer.length} bytes (${kind}) to ${destination}\nSource: ${parsed.toString()}`;
  }

  /** Cached robots.txt lookup with longest-match rules and allow-on-tie. */
  private async allowedByRobots(url: URL): Promise<boolean> {
    const origin = url.origin;
    const cached = this.robots.get(origin);
    let rules: RobotsRule[];
    if (cached && cached.expires > Date.now()) {
      rules = cached.rules;
    } else {
      let text = "";
      try {
        const response = await fetch(`${origin}/robots.txt`, {
          headers: { "User-Agent": USER_AGENT },
          signal: AbortSignal.timeout(5_000),
        });
        if (response.ok) text = await response.text();
      } catch {
        // Unreachable robots.txt means no declared rules.
      }
      rules = parseRobots(text);
      this.robots.set(origin, { rules, expires: Date.now() + 30 * 60_000 });
    }

    const path = url.pathname || "/";
    const matched = rules
      .filter((rule) => robotsMatch(rule.path, path))
      .sort((a, b) => b.path.length - a.path.length || Number(b.allow) - Number(a.allow))[0];
    return matched ? matched.allow : true;
  }
}

function parseRobots(text: string): RobotsRule[] {
  const rules: RobotsRule[] = [];
  let agents: string[] = [];
  let inRules = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const index = line.indexOf(":");
    if (index < 0) continue;
    const key = line.slice(0, index).trim().toLowerCase();
    const value = line.slice(index + 1).trim();

    if (key === "user-agent") {
      if (inRules) {
        agents = [];
        inRules = false;
      }
      agents.push(value.toLowerCase());
      continue;
    }

    if (key !== "allow" && key !== "disallow") continue;
    inRules = true;
    if (!agents.some((agent) => agent === "*" || agent.includes("openmonkey"))) continue;
    if (!value) continue;
    rules.push({ allow: key === "allow", path: value });
  }

  return rules;
}

function robotsMatch(pattern: string, path: string): boolean {
  const end = pattern.endsWith("$");
  const body = end ? pattern.slice(0, -1) : pattern;
  const escaped = body.replace(/[.+^${}()|[\]\\?]/g, "\\$&").replace(/\*/g, ".*");
  try {
    return new RegExp(`^${escaped}${end ? "$" : ""}`).test(path);
  } catch {
    return false;
  }
}

function decodeDuckDuckGoRedirect(href: string): string {
  try {
    const url = new URL(href, "https://duckduckgo.com");
    const redirect = url.searchParams.get("uddg");
    return redirect ? decodeURIComponent(redirect) : href;
  } catch {
    return href;
  }
}

/** Prefer article/main content, then fall back to the whole body. */
function readableText(html: string): string {
  const candidates = [
    /<article\b[\s\S]*?<\/article>/i.exec(html)?.[0],
    /<main\b[\s\S]*?<\/main>/i.exec(html)?.[0],
  ].filter((value): value is string => !!value);
  const chosen = candidates.find((candidate) => stripHtml(candidate).length > 200) ?? candidates[0] ?? html;
  return stripHtml(chosen, true);
}

function stripHtml(html: string, keepBreaks = false): string {
  const withBreaks = keepBreaks
    ? html
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(p|div|li|h[1-6]|tr|blockquote|pre|section|article)>/gi, "\n")
        .replace(/<li[^>]*>/gi, "• ")
    : html;

  const decoded = decodeEntities(
    withBreaks
      .replace(/<(script|style|noscript|svg|nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  );

  if (!keepBreaks) return decoded.replace(/\s+/g, " ").trim();
  return decoded
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;|&rsquo;|&lsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&hellip;/g, "…")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(parseInt(code, 16)));
}

function truncate(text: string): string {
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\n… truncated` : text;
}

function parseJson(body: string): Record<string, unknown> {
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    throw new Error("the answer is not JSON");
  }
}

/** Commons appends its own tracking query to every URL it hands out; the file needs none of it. */
function stripCommonsTracking(url: string): string {
  return url.split("?utm_")[0];
}

function formatImages(query: string, source: string, total: number, hits: ImageHit[]): string {
  const lines = hits.map((hit, index) => {
    const size = hit.width && hit.height ? `${hit.width}x${hit.height}` : "size unknown";
    return [
      `${index + 1}. ${hit.title || hit.image} — ${size}, ${hit.license || "licence unlisted"}`,
      `   image: ${hit.image}`,
      hit.page ? `   source: ${hit.page}` : "",
      `   credit: ${hit.credit}`,
    ]
      .filter(Boolean)
      .join("\n");
  });

  return [
    `Openly licensed images for ${query} (${source}, ${total} found, ${hits.length} shown):`,
    ...lines,
    "",
    "Check each licence before republishing; the credit line is part of what makes the image usable.",
  ].join("\n");
}
