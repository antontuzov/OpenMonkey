/**
 * The block parser behind a chat answer. It is deliberately small and pure: no HTML
 * is ever built, so a model's output can only ever become React children, never
 * markup. Every block carries the offset it started at, which is what keeps a
 * streaming answer from re-rendering text that has already finished.
 */

import { CITATION_PATTERN } from "../utils/citations";

export type InlineSpan =
  | { kind: "text"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "em"; text: string }
  | { kind: "strike"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string }
  | { kind: "citation"; text: string };

export interface ListItem {
  spans: InlineSpan[];
  /** null when the item is a plain bullet, otherwise its checked state. */
  checked: boolean | null;
  /** true when this item was written with a number, so nested runs render like it. */
  ordered: boolean;
  children: ListItem[];
}

export type Block =
  | { kind: "heading"; level: number; spans: InlineSpan[]; offset: number }
  | { kind: "paragraph"; spans: InlineSpan[]; offset: number }
  | { kind: "list"; ordered: boolean; items: ListItem[]; offset: number }
  | { kind: "quote"; blocks: Block[]; offset: number }
  | { kind: "table"; header: InlineSpan[][]; rows: InlineSpan[][][]; aligns: Array<"left" | "center" | "right">; offset: number }
  | { kind: "code"; language: string; code: string; offset: number }
  | { kind: "rule"; offset: number };

const FENCE = /^(\s*)(`{3,}|~{3,})[ \t]*([A-Za-z0-9+#._-]*)[^\n]*\n/;
const HEADING = /^(#{1,6})[ \t]+(.*)$/;
const RULE = /^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const BULLET = /^[ \t]*([-*+])[ \t]+(.*)$/;
const ORDERED = /^[ \t]*(\d{1,9}[.)])[ \t]+(.*)$/;
const QUOTE = /^[ \t]*>[ ]?(.*)$/;
const TABLE_DELIMITER = /^[ \t]*\|?[ \t]*:?-{1,}:?[ \t]*(?:\|[ \t]*:?-{1,}:?[ \t]*)*\|?[ \t]*$/;

/** Inline code, then emphasis, then links; anything else stays literal text. */
export function parseInline(text: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  const pattern = new RegExp(
    `(${CITATION_PATTERN.source})|(\`[^\`\n]+\`)|(\\*\\*[^*\\n]+\\*\\*|__[^_\\n]+__)|(\\*[^*\\n]+\\*|_[^_\\n]+_)|(~~[^~\\n]+~~)|(\\[[^[\\]\\n]*\\]\\((https?:\\/\\/[^)\\s]+|mailto:[^)\\s]+)\\))|(<(https?:\\/\\/[^>\\s]+)>)`,
    "g"
  );
  let last = 0;
  let match: RegExpExecArray | null;

  const push = (literal: string) => {
    if (literal) spans.push({ kind: "text", text: literal });
  };

  while ((match = pattern.exec(text))) {
    push(text.slice(last, match.index));
    const token = match[0];
    if (match[1]) spans.push({ kind: "citation", text: token });
    else if (match[2]) spans.push({ kind: "code", text: token.slice(1, -1) });
    else if (match[3]) spans.push({ kind: "strong", text: token.slice(2, -2) });
    else if (match[4]) spans.push({ kind: "em", text: token.slice(1, -1) });
    else if (match[5]) spans.push({ kind: "strike", text: token.slice(2, -2) });
    else if (match[6]) {
      const link = /^\[([^\]]*)\]\(([^)\s]+)\)$/.exec(token);
      if (link) spans.push({ kind: "link", text: link[1], href: link[2] });
    } else if (match[8]) spans.push({ kind: "link", text: token.slice(1, -1), href: token.slice(1, -1) });
    last = pattern.lastIndex;
  }
  push(text.slice(last));
  return spans;
}

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let current = "";
  let escaped = false;
  for (const char of trimmed) {
    if (escaped) {
      current += char;
      escaped = false;
    } else if (char === "\\") {
      current += char;
      escaped = true;
    } else if (char === "|") {
      cells.push(current.trim());
      current = "";
    } else current += char;
  }
  cells.push(current.trim());
  return cells;
}

function alignsOf(delimiter: string): Array<"left" | "center" | "right"> {
  return splitRow(delimiter).map((cell) => {
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    return "left";
  });
}

const TASK = /^\[([ xX])\][ \t]+(.*)$/;

/**
 * Parses one indentation level of a list. Nested bullets belong to the item above
 * them, which is how a model's plan survives into the UI. A run of bullets ends
 * where numbering begins, the same way CommonMark splits the two lists.
 */
function parseList(lines: string[], start: number): { items: ListItem[]; next: number } {
  const items: ListItem[] = [];
  const ordered = ORDERED.test(lines[start] ?? "");
  let index = start;

  while (index < lines.length) {
    const line = lines[index];
    if (ORDERED.test(line) !== ordered) break;
    const bullet = BULLET.exec(line) ?? ORDERED.exec(line);
    if (!bullet) break;

    const indent = /^[ \t]*/.exec(line)?.[0].length ?? 0;
    let body = bullet[2];
    index += 1;

    // A list item may wrap over following unindented prose lines.
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index])) {
      body += ` ${lines[index].trim()}`;
      index += 1;
    }

    const task = TASK.exec(body);
    const item: ListItem = {
      spans: parseInline(task ? task[2] : body),
      checked: task ? task[1].toLowerCase() === "x" : null,
      ordered: /\d/.test(bullet[1]),
      children: [],
    };

    const nested: string[] = [];
    while (index < lines.length && lines[index].trim()) {
      const deeper = /^[ \t]*/.exec(lines[index])?.[0].length ?? 0;
      if (deeper <= indent) break;
      nested.push(lines[index]);
      index += 1;
    }
    if (nested.length) item.children = parseList(nested, 0).items;
    items.push(item);
  }

  return { items, next: index };
}

function isBlockStart(line: string): boolean {
  return Boolean(
    BULLET.test(line) || ORDERED.test(line) || HEADING.test(line) || QUOTE.test(line) || RULE.test(line)
  );
}

function parseBlocks(lines: string[], offsetAt: (index: number) => number): Block[] {
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const offset = offsetAt(index);

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = FENCE.exec(`${line}\n`);
    if (fence) {
      const marker = fence[2][0];
      const language = fence[3];
      const body: string[] = [];
      index += 1;
      let closed = false;
      while (index < lines.length) {
        if (new RegExp(`^\\s*${marker}{3,}\\s*$`).test(lines[index])) {
          closed = true;
          index += 1;
          break;
        }
        body.push(lines[index]);
        index += 1;
      }
      // An unclosed fence is a stream still arriving, not a parse error.
      blocks.push({ kind: "code", language, code: body.join("\n"), offset });
      if (!closed) break;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, spans: parseInline(heading[2].trim()), offset });
      index += 1;
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ kind: "rule", offset });
      index += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      const quoted: string[] = [];
      const quoteBase = offset;
      while (index < lines.length && QUOTE.test(lines[index])) {
        quoted.push(QUOTE.exec(lines[index])![1]);
        index += 1;
      }
      blocks.push({ kind: "quote", blocks: parseBlocks(quoted, () => quoteBase), offset });
      continue;
    }

    if (line.includes("|") && index + 1 < lines.length && TABLE_DELIMITER.test(lines[index + 1])) {
      const aligns = alignsOf(lines[index + 1]);
      const header = splitRow(line).map((cell) => parseInline(cell));
      index += 2;
      const rows: InlineSpan[][][] = [];
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        rows.push(splitRow(lines[index]).map((cell) => parseInline(cell)));
        index += 1;
      }
      blocks.push({ kind: "table", header, rows, aligns, offset });
      continue;
    }

    if (BULLET.test(line) || ORDERED.test(line)) {
      const ordered = ORDERED.test(line);
      const { items, next } = parseList(lines, index);
      if (items.length) {
        blocks.push({ kind: "list", ordered, items, offset });
        index = next;
        continue;
      }
    }

    const paragraph: string[] = [];
    const paragraphOffset = offset;
    while (index < lines.length && lines[index].trim() && !FENCE.test(`${lines[index]}\n`)) {
      if (paragraph.length && isBlockStart(lines[index])) break;
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push({ kind: "paragraph", spans: parseInline(paragraph.join("\n")), offset: paragraphOffset });
    if (paragraph.length === 0) index += 1;
  }

  return blocks;
}

export function parseMarkdown(content: string): Block[] {
  const lines = content.split("\n");
  const starts: number[] = [];
  let cursor = 0;
  for (const line of lines) {
    starts.push(cursor);
    cursor += line.length + 1;
  }
  return parseBlocks(lines, (index) => starts[index] ?? 0);
}

/** Move every offset of a block and the blocks inside it. */
function shiftBlocks(blocks: Block[], delta: number): Block[] {
  return blocks.map((block) => {
    if (block.kind === "quote") {
      return { ...block, offset: block.offset + delta, blocks: shiftBlocks(block.blocks, delta) };
    }
    return { ...block, offset: block.offset + delta };
  });
}

/**
 * Whether a block cannot change when more text arrives after it. A block that
 * ends on a blank line is finished, and so is a fence that has been closed.
 */
function isFinishedBlock(raw: string, block: Block): boolean {
  if (/\n[ \t]*\n$/.test(raw)) return true;
  if (block.kind !== "code") return false;
  const fence = FENCE.exec(raw);
  if (!fence) return false;
  const marker = fence[2][0];
  return new RegExp(`^\\s*${marker}{3,}\\s*$`, "m").test(raw);
}

/**
 * A parser that keeps the blocks it has already finished, so an answer that grows
 * token by token is parsed once instead of once per token.
 */
export interface IncrementalParser {
  /** The blocks for the text so far. */
  blocks: Block[];
  /** Parse a longer text, reusing the blocks that are already finished. */
  update(text: string): Block[];
}

export function createIncrementalParser(): IncrementalParser {
  let text = "";
  let blocks: Block[] = [];

  const update = (next: string): Block[] => {
    if (next === text) return blocks;
    // Anything but a longer text means the answer was replaced: start over.
    if (!next.startsWith(text)) {
      text = next;
      blocks = parseMarkdown(next);
      return blocks;
    }

    const last = blocks[blocks.length - 1];
    const raw = last ? text.slice(last.offset) : "";
    // Everything before the last unfinished block stays as it was.
    const safeEnd = last && isFinishedBlock(raw, last) ? text.length : last ? last.offset : 0;
    const kept = blocks.filter((block) => block.offset < safeEnd);
    const rest = shiftBlocks(parseMarkdown(next.slice(safeEnd)), safeEnd);

    text = next;
    blocks = [...kept, ...rest];
    return blocks;
  };

  return {
    get blocks() {
      return blocks;
    },
    update,
  };
}

/** A fence is a diff when it says so, or when enough of its lines look like one. */
export function isDiff(language: string, code: string): boolean {
  if (/^(diff|patch|u?diff)$/i.test(language.trim())) return true;
  const lines = code.split("\n").filter((line) => line.trim());
  if (lines.length < 2) return false;
  const marked = lines.filter((line) => /^(\+\+\+|---|@@|[+-][ \t]|[+-]$)/.test(line)).length;
  return marked / lines.length >= 0.5;
}
