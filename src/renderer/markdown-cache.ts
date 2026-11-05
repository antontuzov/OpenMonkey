import { parseMarkdown, type Block } from "./markdown";

/**
 * The parsed answers a chat keeps, so a message that is mounted again — after the
 * reader scrolls past it and back — is not parsed a second time. The cache is
 * bounded by the text it holds rather than by the number of answers, so one long
 * answer cannot push everything else out.
 */
const MAX_CACHED_CHARS = 2_000_000;

const cache = new Map<string, Block[]>();
let cachedChars = 0;

/** Parse an answer, or hand back the one that was parsed before. */
export function parseMarkdownCached(content: string): Block[] {
  const hit = cache.get(content);
  if (hit) {
    // Keep the answers that are read again at the front.
    cache.delete(content);
    cache.set(content, hit);
    return hit;
  }

  const blocks = parseMarkdown(content);
  cache.set(content, blocks);
  cachedChars += content.length;
  while (cachedChars > MAX_CACHED_CHARS && cache.size > 1) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
    cachedChars -= oldest.value.length;
  }
  return blocks;
}

/** Forget every parsed answer, so an idle app holds nothing it does not need. */
export function clearMarkdownCache(): void {
  cache.clear();
  cachedChars = 0;
}

/** How many characters of parsed answers are held. */
export function cachedCharacterCount(): number {
  return cachedChars;
}
