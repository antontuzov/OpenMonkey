import { stemHit } from "./text-match";
import type { SettingsPage } from "../utils/types";

/** What the app itself can be asked to do from the palette. */
export type PaletteCommand =
  | "new-chat"
  | "focus-composer"
  | "toggle-panel"
  | "cycle-mood"
  | "clear-chat"
  | "summarize-chat"
  | "stop";

/** What choosing an entry does. */
export type PaletteAction =
  | { kind: "chat"; conversationId: string }
  | { kind: "setting"; page: SettingsPage; label?: string }
  | { kind: "command"; command: PaletteCommand };

export type PaletteGroup = "chats" | "settings" | "actions";

export interface PaletteCandidate {
  id: string;
  label: string;
  group: PaletteGroup;
  /** The line under the label: a chat preview, or the page a setting lives on. */
  detail?: string;
  /** Words that reach this entry without appearing in its label. */
  keywords?: string[];
  action: PaletteAction;
}

/** Chats come first, then settings, then actions: a chat is what a person usually wants. */
const GROUP_ORDER: Record<PaletteGroup, number> = { chats: 0, settings: 1, actions: 2 };

const isBoundary = (text: string, index: number) =>
  index === 0 || /[\s\-_/.:]/.test(text[index - 1] ?? "");

/**
 * How well a query matches a line of text. Zero means no match at all.
 *
 * A word that is really there wins outright. Otherwise the characters of the query
 * have to appear in order, which is what lets "nvc" find "New conversation".
 */
export function fuzzyScore(query: string, haystack: string): number {
  const needle = query.trim().toLowerCase();
  if (!needle) return 0;
  const text = haystack.toLowerCase();
  if (!text) return 0;

  const exact = text.indexOf(needle);
  if (exact >= 0) {
    const extra = Math.max(0, text.length - needle.length);
    return 1000 - exact * 2 - extra * 0.2 + (isBoundary(text, exact) ? 60 : 0);
  }

  // A single character would reach almost every line, so it only counts when it is there.
  if (needle.length < 2) return 0;

  let cursor = 0;
  let first = -1;
  let last = -1;
  for (const character of needle) {
    const found = text.indexOf(character, cursor);
    if (found < 0) return 0;
    if (first < 0) first = found;
    last = found;
    cursor = found + 1;
  }
  const span = last - first;
  return 500 - span * 2 - first + (isBoundary(text, first) ? 40 : 0);
}

/**
 * The words on screen are the strongest evidence. A word that only reaches an entry
 * sideways (a page title under the label, a keyword in the index) is worth less, so a
 * row named "Toggle activity panel" beats a row that merely lists "panel" as a keyword.
 */
const DETAIL_DISCOUNT = 40;
const KEYWORD_DISCOUNT = 100;

/** The best an entry can score, over its label, its detail line and its keywords. */
export function scoreCandidate(query: string, candidate: PaletteCandidate): number {
  let best = fuzzyScore(query, candidate.label);
  const detail = fuzzyScore(query, candidate.detail ?? "");
  if (detail > 0) best = Math.max(best, detail - DETAIL_DISCOUNT);
  for (const keyword of candidate.keywords ?? []) {
    const hit = fuzzyScore(query, keyword);
    if (hit > 0) best = Math.max(best, hit - KEYWORD_DISCOUNT);
  }
  // A word that differs only by its ending still reaches the entry: "encryption" finds "encrypt".
  if (stemHit(candidate.label, query.trim().toLowerCase())) best = Math.max(best, 320);
  return best;
}

/** The entries that match a query, best first. */
export function rankPalette(
  query: string,
  candidates: PaletteCandidate[],
  limit = 14
): PaletteCandidate[] {
  if (!query.trim()) return [];
  const scored = candidates
    .map((candidate) => ({ candidate, score: scoreCandidate(query, candidate) }))
    .filter((hit) => hit.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        GROUP_ORDER[left.candidate.group] - GROUP_ORDER[right.candidate.group] ||
        left.candidate.label.localeCompare(right.candidate.label)
    );
  return scored.slice(0, limit).map((hit) => hit.candidate);
}
