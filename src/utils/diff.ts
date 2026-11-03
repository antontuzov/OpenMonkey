import type { DiffLine } from "./types";

/** A file larger than this is replaced wholesale instead of diffed line by line. */
export const MAX_DIFF_LINES = 500;

/** An empty file has no lines at all, and a trailing newline does not add one. */
const splitLines = (text: string): string[] => {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
};

/**
 * The longest common subsequence of two texts, line by line. Zero means "no match";
 * null means the file is too big to diff line by line.
 */
export function lineDiff(before: string, after: string): DiffLine[] | null {
  const oldLines = splitLines(before);
  const newLines = splitLines(after);
  if (oldLines.length > MAX_DIFF_LINES || newLines.length > MAX_DIFF_LINES) return null;

  const rows = oldLines.length + 1;
  const cols = newLines.length + 1;
  const table = new Int32Array(rows * cols);
  for (let i = oldLines.length - 1; i >= 0; i--) {
    for (let j = newLines.length - 1; j >= 0; j--) {
      table[i * cols + j] =
        oldLines[i] === newLines[j]
          ? table[(i + 1) * cols + j + 1] + 1
          : Math.max(table[(i + 1) * cols + j], table[i * cols + j + 1]);
    }
  }

  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < oldLines.length && j < newLines.length) {
    if (oldLines[i] === newLines[j]) {
      result.push({ kind: "same", text: oldLines[i] });
      i++;
      j++;
    } else if (table[(i + 1) * cols + j] >= table[i * cols + j + 1]) {
      result.push({ kind: "del", text: oldLines[i++] });
    } else {
      result.push({ kind: "add", text: newLines[j++] });
    }
  }
  while (i < oldLines.length) result.push({ kind: "del", text: oldLines[i++] });
  while (j < newLines.length) result.push({ kind: "add", text: newLines[j++] });
  return result;
}

/** How many lines the change added and how many it removed. */
export function diffCounts(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.kind === "add") added += 1;
    else if (line.kind === "del") removed += 1;
  }
  return { added, removed };
}

/** The places worth showing: every change, with two lines of context around it. */
function keptIndices(lines: DiffLine[], context: number): Set<number> {
  const keep = new Set<number>();
  lines.forEach((line, index) => {
    if (line.kind === "same") return;
    for (let offset = -context; offset <= context; offset++) {
      const target = index + offset;
      if (target >= 0 && target < lines.length) keep.add(target);
    }
  });
  return keep;
}

/** The lines worth showing: every change, with two lines of context around it. */
export function diffWindow(lines: DiffLine[], context = 2): DiffLine[] {
  const keep = keptIndices(lines, context);
  return lines.filter((_, index) => keep.has(index));
}

/** Keep two lines of context around each change so the preview stays readable. */
export function renderDiff(lines: DiffLine[], label: string): string {
  const keep = keptIndices(lines, 2);

  const output: string[] = [];
  let skipped = false;
  lines.forEach((line, index) => {
    if (!keep.has(index)) {
      if (!skipped && output.length) output.push("  …");
      skipped = true;
      return;
    }
    skipped = false;
    output.push(`${line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "} ${line.text}`);
  });

  const clipped = output.length > 120 ? [...output.slice(0, 120), "  … diff truncated"] : output;
  return `${label}\n${clipped.join("\n")}`;
}
