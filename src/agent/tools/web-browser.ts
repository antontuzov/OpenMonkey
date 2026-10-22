import { shell } from "electron";
import type { TaskType } from "../../utils/types";

const MAX_TEXT = 12_000;
const USER_AGENT = "OpenMonkey/1.0 (local agent)";

/**
 * HTTP + text extraction only. The prompt asked for a "web browser" tool; pulling in
 * a headless browser would ship another ~300 MB of Chromium into a privacy app, so
 * pages are fetched over HTTPS and links open in the user's real browser.
 */
export class WebBrowserTools {
  readonly type: TaskType = "web";
  readonly mutatingActions: ReadonlySet<string> = new Set(["open_in_browser"]);

  async execute(action: string, args: Record<string, unknown>): Promise<string> {
    switch (action) {
      case "fetch_page":
        return this.fetchPage(String(args.url ?? ""));
      case "search":
        return this.search(String(args.query ?? ""));
      case "open_in_browser":
        await shell.openExternal(String(args.url ?? ""));
        return `Opened ${args.url} in the default browser`;
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

  private async get(url: string): Promise<string> {
    const response = await fetch(this.assertHttpUrl(url), {
      headers: { "User-Agent": USER_AGENT },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
    return await response.text();
  }

  private async fetchPage(url: string): Promise<string> {
    const html = await this.get(url);
    const title = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() ?? url;
    return `${title}\n${truncate(stripHtml(html))}`;
  }

  /** DuckDuckGo's HTML-lite endpoint keeps search result parsing dependency-free. */
  private async search(query: string): Promise<string> {
    if (!query.trim()) throw new Error("Empty search query");
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const html = await this.get(url);

    const results: string[] = [];
    const linkPattern = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    let match: RegExpExecArray | null;
    while ((match = linkPattern.exec(html)) && results.length < 8) {
      const href = decodeDuckDuckGoRedirect(match[1]);
      results.push(`- ${stripHtml(match[2]).trim()}\n  ${href}`);
    }

    if (!results.length) return `No results parsed for "${query}"`;
    return `Results for ${query}:\n${results.join("\n")}`;
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

function stripHtml(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(text: string): string {
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\n… truncated` : text;
}
