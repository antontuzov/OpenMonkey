/**
 * The citation labels the model is asked to use: a pinned fact, a file passage or
 * another conversation. The renderer turns them into chips and the main process
 * resolves them to a preview, so both sides read the same shapes.
 */

export type Citation =
  | { kind: "fact"; label: string; id: string }
  | { kind: "file"; label: string; path: string; line: number }
  | { kind: "chat"; label: string; title: string };

const FACT = /\[fact:([A-Za-z0-9_-]+)\]/;
const FILE = /\[file:([^\]\n]*):(\d+)\]/;
const CHAT = /\[chat "([^"\n]+)"\]/;

/** Reads one citation label; null when the text is not one. */
export function parseCitation(label: string): Citation | null {
  const fact = FACT.exec(label);
  if (fact) return { kind: "fact", label, id: fact[1] };
  const file = FILE.exec(label);
  if (file) return { kind: "file", label, path: file[1], line: Number(file[2]) };
  const chat = CHAT.exec(label);
  if (chat) return { kind: "chat", label, title: chat[1] };
  return null;
}

/** The labels as one pattern, so the markdown parser finds what the resolver reads. */
export const CITATION_PATTERN = /\[fact:[A-Za-z0-9_-]+\]|\[file:[^\]\n]*:\d+\]|\[chat "[^"\n]+"\]/g;

const ANY = new RegExp(CITATION_PATTERN.source, "g");

/**
 * Every citation in a block of text, in the order they appear. The match is
 * non-overlapping, so a label inside another label is not counted twice.
 */
export function findCitations(text: string): Citation[] {
  const found: Citation[] = [];
  for (const match of text.matchAll(ANY)) {
    const citation = parseCitation(match[0]);
    if (citation) found.push(citation);
  }
  return found;
}
