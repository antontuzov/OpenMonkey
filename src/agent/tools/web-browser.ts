import { shell } from "electron";
import type { TaskType } from "../../utils/types";

const MAX_TEXT = 12_000;
const USER_AGENT = "OpenMonkey/1.0 (local agent)";
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_ENTRIES = 30;
const HOST_INTERVAL_MS = 750;

interface CacheEntry {
  body: string;
  expires: number;
}

interface RobotsRule {
  allow: boolean;
  path: string;
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
    switch (action) {
      case "fetch_page":
        return this.fetchPage(String(args.url ?? ""));
      case "search":
        return this.search(String(args.query ?? ""));
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

  private async get(url: string, cacheKey: string): Promise<string> {
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expires > Date.now()) return cached.body;

    const parsed = new URL(url);
    await this.waitTurn(parsed.host);

    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,text/plain;q=0.9,*/*;q=0.5" },
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
    const parsed = new URL(this.assertHttpUrl(url));
    if (!(await this.allowedByRobots(parsed))) {
      throw new Error(`robots.txt on ${parsed.host} disallows fetching ${parsed.pathname}`);
    }
    const html = await this.get(parsed.toString(), `page:${parsed.toString()}`);
    const title = decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? parsed.toString());
    const article = readableText(html);
    return `${title}\n${parsed.toString()}\n\n${truncate(article)}`;
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
