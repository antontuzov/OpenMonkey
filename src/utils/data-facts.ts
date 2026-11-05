/**
 * The arithmetic a local 4B model cannot do in its head and should not be asked to
 * fake. An analysis turn that reads a spreadsheet gets these facts instead of a
 * truncated page of numbers, so the report it writes can quote a real mean rather than
 * a remembered one.
 *
 * Deliberately small: it parses what a table, a JSON document and a markdown heading
 * look like in practice, and it says when it stopped counting.
 */

const numberFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

export const countable = (value: number): string => numberFormatter.format(value);

export interface NumericColumn {
  name: string;
  values: number;
  min: number;
  max: number;
  mean: number;
  sum: number;
}

/** One RFC-4180-flavoured row: quoted fields, doubled quotes, newlines inside quotes. */
function nextRow(text: string, from: number, delimiter: string): { cells: string[]; end: number } {
  const cells: string[] = [];
  let value = "";
  let quoted = false;
  let index = from;

  for (; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          value += '"';
          index += 1;
        } else quoted = false;
        continue;
      }
      value += char;
      continue;
    }
    if (char === '"' && value === "") {
      quoted = true;
      continue;
    }
    if (char === delimiter) {
      cells.push(value.trim());
      value = "";
      continue;
    }
    if (char === "\n") {
      cells.push(value.trim());
      return { cells, end: index + 1 };
    }
    if (char === "\r") continue;
    value += char;
  }

  cells.push(value.trim());
  return { cells, end: index };
}

export function splitTable(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const row = nextRow(text, cursor, delimiter);
    cursor = row.end;
    if (row.cells.length === 1 && row.cells[0] === "") continue;
    rows.push(row.cells);
  }
  return rows;
}

/** Tabs beat commas only when there are genuinely more of them. */
export function detectDelimiter(sample: string): string {
  const tabs = (sample.match(/\t/g) ?? []).length;
  const commas = (sample.match(/,/g) ?? []).length;
  if (tabs && tabs >= commas) return "\t";
  if (sample.includes(";") && commas === 0) return ";";
  return ",";
}

const asNumber = (value: string): number | null => {
  const cleaned = value.replace(/[\s\u00a0]|%|[,$₹€£]/g, "");
  if (!cleaned || /[^0-9eE+\-.]/.test(cleaned)) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
};

/** One column of numbers, or null when the cells are mostly not numbers. */
function numericAt(name: string, rows: string[][], index: number): NumericColumn | null {
  const values: number[] = [];
  let filled = 0;
  for (const row of rows) {
    const cell = row[index];
    if (!cell) continue;
    filled += 1;
    const parsed = asNumber(cell);
    if (parsed !== null) values.push(parsed);
  }
  if (!values.length || values.length / filled < 0.6) return null;

  let sum = 0;
  let min = values[0];
  let max = values[0];
  for (const value of values) {
    sum += value;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return { name, values: values.length, min, max, mean: sum / values.length, sum };
}

/**
 * A column counts as numeric when most of its filled cells do, because one "n/a" in a
 * price column should not turn a real number into text.
 */
export function numericColumns(header: string[], rows: string[][]): NumericColumn[] {
  const columns: NumericColumn[] = [];
  header.forEach((rawName, index) => {
    const column = numericAt(rawName || `column ${index + 1}`, rows, index);
    if (column) columns.push(column);
  });
  return columns;
}

const numericLine = (column: NumericColumn): string =>
  `${column.name}: n=${column.values} min=${countable(column.min)} max=${countable(column.max)} mean=${countable(
    column.mean
  )} sum=${countable(column.sum)}`;

/** The values that carry a text column: a category is a finding, not noise to skip. */
function textLine(name: string, rows: string[][], index: number): string | null {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const cell = row[index];
    if (cell) counts.set(cell, (counts.get(cell) ?? 0) + 1);
  }
  if (!counts.size) return null;
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([value, count]) => `${value} ${count}`)
    .join(", ");
  return `${name}: text, ${counts.size} distinct (${top})`;
}

/**
 * Every column, numbers where they exist and the values themselves where they do not,
 * in one pass. A report over a 30-column export can carry sixteen of them; the rest are
 * named in the header line and said to be missing rather than quietly dropped.
 */
export function columnStats(header: string[], rows: string[][]): string[] {
  const lines: string[] = [];
  let numeric = 0;
  let hidden = 0;

  header.forEach((rawName, index) => {
    const name = rawName || `column ${index + 1}`;
    const numbers = numericAt(name, rows, index);
    if (numbers) numeric += 1;
    const line = numbers ? numericLine(numbers) : textLine(name, rows, index);
    if (!line) return;
    if (lines.length < 16) lines.push(line);
    else hidden += 1;
  });

  if (hidden) lines.push(`… ${hidden} more columns not shown`);
  if (!numeric) lines.push("no numeric columns: every column is mostly text");
  return lines;
}

export function tableFacts(text: string, truncated = false): string[] {
  const delimiter = detectDelimiter(text.slice(0, 4_000));
  const rows = splitTable(text, delimiter);
  if (rows.length < 2) return [`table: ${rows.length} row${rows.length === 1 ? "" : "s"}, nothing to measure`];

  const [header, ...data] = rows;
  const lines = [
    `columns (${header.length}): ${header.slice(0, 24).join(", ")}${header.length > 24 ? `, …${header.length - 24} more` : ""}`,
    `data rows: ${data.length}${truncated ? " (of the part read)" : ""}`,
  ];

  const ragged = data.filter((row) => row.length !== header.length).length;
  if (ragged) {
    const widest = Math.max(...rows.map((row) => row.length));
    lines.push(`rows that do not match the header: ${ragged} of ${data.length} (widest row has ${widest} fields)`);
  }

  lines.push(...columnStats(header, data));
  return lines;
}

/**
 * A delimiter-separated table whatever the file is called: rows with the same field
 * count, at least two fields, and enough rows that there is a header plus data. Reports
 * exported as `.txt` are common enough that trusting the extension would throw the
 * numbers away.
 */
export function looksTabular(text: string): boolean {
  const sample = text.slice(0, 4_000);
  const delimiter = detectDelimiter(sample);
  if (!sample.includes(delimiter)) return false;
  const rows = splitTable(sample, delimiter).slice(0, 10);
  if (rows.length < 3) return false;
  const fields = rows[0].length;
  if (fields < 2) return false;
  return rows.filter((row) => row.length === fields).length >= Math.ceil(rows.length * 0.8);
}

const shape = (value: unknown, depth = 0): string => {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    if (depth >= 2 || !value.length) return `array of ${value.length}`;
    return `array of ${value.length}, e.g. ${shape(value[0], depth + 1)}`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (depth >= 2 || !entries.length) return `object of ${entries.length} keys`;
    const [name, child] = entries[0];
    return `object of ${entries.length} keys, e.g. ${name}: ${shape(child, depth + 1)}`;
  }
  return typeof value;
};

export function jsonFacts(text: string): string[] {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return ["JSON that does not parse - read the file to see why"];
  }

  if (Array.isArray(value)) {
    const lines = [`JSON array of ${value.length} items`];
    const first = value[0];
    if (first && typeof first === "object" && !Array.isArray(first)) {
      const keys = Object.keys(first as Record<string, unknown>);
      lines.push(`item keys: ${keys.slice(0, 30).join(", ")}`);
      lines.push(
        ...columnStats(
          keys,
          value.slice(0, 10_000).map((item) =>
            Object.entries((item ?? {}) as Record<string, unknown>).map(([, cell]) =>
              cell === null || cell === undefined ? "" : String(cell)
            )
          )
        )
      );
    }
    return lines;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return [
      `JSON object of ${entries.length} keys`,
      ...entries.slice(0, 20).map(([name, child]) => `${name}: ${shape(child)}`),
      ...(entries.length > 20 ? [`… ${entries.length - 20} more keys`] : []),
    ];
  }
  return [`JSON ${typeof value}`];
}

export function headingFacts(text: string): string[] {
  const headings: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^(#{1,6})\s+(.*)$/.exec(line.trim());
    if (match) headings.push(match[2]);
    if (headings.length >= 24) break;
  }
  return headings.length ? [`headings: ${headings.join(" | ")}`] : ["no markdown headings"];
}

/** Prose, notes and logs: how much of it is there, and how does it open. */
function proseFacts(text: string): string[] {
  const rows = text.split(/\r?\n/);
  const nonEmpty = rows.filter((line) => line.trim());
  const words = nonEmpty.reduce((total, line) => total + (line.match(/\S+/g) ?? []).length, 0);
  const lines = [`text: ${rows.length} lines, ${words} words`];
  const first = nonEmpty[0]?.trim();
  if (first) lines.push(`opens with: "${first.slice(0, 90)}"`);
  return lines;
}

/**
 * One file's worth of facts, chosen by what the bytes look like rather than only by the
 * name. Lines come back unindented: the caller owns the layout.
 */
export function measureText(text: string, extension = "", truncated = false): string[] {
  const name = extension.toLowerCase();
  let lines: string[];

  if (name === ".json" || (name === "" && text.trimStart().startsWith("{"))) lines = jsonFacts(text);
  else if (name === ".csv" || name === ".tsv" || looksTabular(text)) lines = tableFacts(text, truncated);
  else if (name === ".md" || name === ".markdown") lines = [...proseFacts(text), ...headingFacts(text)];
  else lines = proseFacts(text);

  if (truncated) lines.push("measured only the beginning: the file is larger than the read cap");
  return lines;
}

