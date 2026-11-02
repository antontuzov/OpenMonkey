/**
 * A small syntax highlighter: enough of a language's shape to make a code block
 * scannable, without pulling a WASM grammar into an app that ships its model
 * weights on disk. Output is one token list per line so the renderer can put a
 * stable class on each span.
 */

export type TokenKind = "plain" | "comment" | "string" | "number" | "keyword" | "type" | "func" | "punct";

export interface Token {
  kind: TokenKind;
  text: string;
}

interface Dialect {
  line: string[];
  block?: [string, string];
  strings: string[];
  triple?: string[];
  keywords: Set<string>;
  types: Set<string>;
}

const words = (list: string): Set<string> => new Set(list.split(" ").filter(Boolean));

const COMMON_TYPES = "string int integer bool boolean number float double char byte void any unknown never";

const TS: Dialect = {
  line: ["//"],
  block: ["/*", "*/"],
  strings: ['"', "'", "`"],
  keywords: words(
    "abstract as async await break case catch class const continue debugger default delete do else enum export extends " +
      "finally for from function get if implements import in instanceof interface let new of return set static super " +
      "switch this throw try typeof var void while with yield"
  ),
  types: words(`${COMMON_TYPES} string[] Record Promise Partial Readonly`),
};

const PYTHON: Dialect = {
  line: ["#"],
  triple: ['"""', "'''"],
  strings: ['"', "'"],
  keywords: words(
    "and as assert async await break class continue def del elif else except finally for from global if import in is " +
      "lambda match nonlocal not or pass raise return try while with yield"
  ),
  types: words(`${COMMON_TYPES} str dict list tuple set bytes`),
};

const SHELL: Dialect = {
  line: ["#"],
  strings: ['"', "'"],
  keywords: words(
    "if then else elif fi for while until do done case esac function in exit return break continue export local source " +
      "set unset shift trap cd echo printf test time select end"
  ),
  types: words("true false"),
};

const SQL: Dialect = {
  line: ["--"],
  block: ["/*", "*/"],
  strings: ["'", '"'],
  keywords: words(
    "select from where insert into values update delete create table drop alter index join left right inner outer full " +
      "on group by order having limit offset distinct as and or not null is in between like case when then else end " +
      "primary key foreign references unique default transaction commit rollback begin with union all except intersect"
  ),
  types: words(`${COMMON_TYPES} text varchar serial timestamp date numeric`),
};

const CSS: Dialect = {
  line: [],
  block: ["/*", "*/"],
  strings: ['"', "'"],
  keywords: words("@media @import @keyframes @supports @font-face !important"),
  types: words("px em rem vh vw % s ms deg"),
};

const YAML: Dialect = {
  line: ["#"],
  strings: ['"', "'"],
  keywords: words("true false null yes no on off"),
  types: words(""),
};

const JSON: Dialect = {
  line: [],
  strings: ['"'],
  keywords: words("true false null"),
  types: words(""),
};

const PLAIN: Dialect = { line: [], strings: [], keywords: words(""), types: words("") };

const BY_LANGUAGE: Record<string, Dialect> = {
  ts: TS,
  tsx: TS,
  typescript: TS,
  js: TS,
  jsx: TS,
  javascript: TS,
  mjs: TS,
  cjs: TS,
  json: JSON,
  jsonc: JSON,
  py: PYTHON,
  python: PYTHON,
  sh: SHELL,
  bash: SHELL,
  zsh: SHELL,
  shell: SHELL,
  sql: SQL,
  postgres: SQL,
  sqlite: SQL,
  css: CSS,
  scss: CSS,
  less: CSS,
  yml: YAML,
  yaml: YAML,
  toml: YAML,
  ini: YAML,
  env: YAML,
};

/** HTML and unknown languages still get strings and comments, which is the useful part. */
const MARKUP: Dialect = {
  line: [],
  block: ["<!--", "-->"],
  strings: ['"', "'"],
  keywords: words(""),
  types: words(""),
};

function dialectFor(language: string): Dialect {
  const key = language.trim().toLowerCase();
  if (!key) return PLAIN;
  if (BY_LANGUAGE[key]) return BY_LANGUAGE[key];
  if (["html", "xml", "svg", "vue", "svelte"].includes(key)) return MARKUP;
  return PLAIN;
}

function startsAt(source: string, index: number, needle: string): boolean {
  return needle.length > 0 && source.startsWith(needle, index);
}

function highlightLine(line: string, dialect: Dialect, state: { inBlock: boolean; quote: string | null }): Token[] {
  const tokens: Token[] = [];
  let buffer = "";
  let index = 0;

  const flush = (kind: TokenKind = "plain") => {
    if (!buffer) return;
    tokens.push({ kind, text: buffer });
    buffer = "";
  };

  while (index < line.length) {
    if (state.inBlock && dialect.block) {
      const close = line.indexOf(dialect.block[1], index);
      if (close < 0) {
        buffer += line.slice(index);
        flush("comment");
        return tokens;
      }
      buffer += line.slice(index, close + dialect.block[1].length);
      index = close + dialect.block[1].length;
      state.inBlock = false;
      flush("comment");
      continue;
    }

    if (state.quote) {
      const close = line.indexOf(state.quote, index);
      const escapedBefore = close > 0 && line[close - 1] === "\\";
      if (close < 0 || escapedBefore) {
        buffer += line.slice(index);
        flush("string");
        return tokens;
      }
      buffer += line.slice(index, close + state.quote.length);
      index = close + state.quote.length;
      state.quote = null;
      flush("string");
      continue;
    }

    const rest = line.slice(index);
    const triple = (dialect.triple ?? []).find((marker) => startsAt(line, index, marker));
    if (triple) {
      const close = line.indexOf(triple, index + triple.length);
      if (close < 0) {
        state.quote = triple;
        buffer += rest;
        flush("string");
        return tokens;
      }
      tokens.push({ kind: "string", text: line.slice(index, close + triple.length) });
      index = close + triple.length;
      continue;
    }

    const comment = dialect.line.find((marker) => rest.startsWith(marker));
    if (comment) {
      flush();
      tokens.push({ kind: "comment", text: rest });
      return tokens;
    }

    if (dialect.block && startsAt(line, index, dialect.block[0])) {
      flush();
      state.inBlock = true;
      continue;
    }

    const quote = dialect.strings.find((marker) => startsAt(line, index, marker));
    if (quote) {
      flush();
      state.quote = quote;
      buffer = quote;
      index += quote.length;
      continue;
    }

    const spaces = /^\s+/.exec(rest)?.[0];
    if (spaces) {
      flush();
      tokens.push({ kind: "plain", text: spaces });
      index += spaces.length;
      continue;
    }

    if (/[[\](){},;:]/.test(line[index])) {
      flush();
      tokens.push({ kind: "punct", text: line[index] });
      index += 1;
      continue;
    }

    const word = /^[A-Za-z_$@#!?.+-][A-Za-z0-9_$@#!?+.-]*/.exec(rest)?.[0];
    if (word) {
      flush();
      const next = rest.slice(word.length).replace(/^[\s.]+/, "")?.[0];
      if (dialect.keywords.has(word.toLowerCase())) tokens.push({ kind: "keyword", text: word });
      else if (dialect.types.has(word)) tokens.push({ kind: "type", text: word });
      else if (next === "(") tokens.push({ kind: "func", text: word });
      else tokens.push({ kind: "plain", text: word });
      index += word.length;
      continue;
    }

    if (/^[0-9]/.test(rest)) {
      const number = /^[0-9][0-9_.xXa-fA-F]*/.exec(rest)![0];
      flush();
      tokens.push({ kind: "number", text: number });
      index += number.length;
      continue;
    }

    flush();
    tokens.push({ kind: "punct", text: line[index] });
    index += 1;
  }

  flush();
  return tokens;
}

export function highlight(code: string, language: string): Token[][] {
  const dialect = dialectFor(language);
  const state = { inBlock: false, quote: null as string | null };
  // A line comment never carries over, but a block comment or an open quote does.
  return code.split("\n").map((line) => {
    if (state.quote && !dialect.triple?.includes(state.quote)) state.quote = null;
    return highlightLine(line, dialect, state);
  });
}
