/**
 * The rules that keep files out of the workspace index.
 *
 * A rule is a path pattern:
 *   `*`  matches any characters except a slash
 *   `**` matches any characters, slashes included
 *   `?`  matches one character except a slash
 *
 * A rule without a slash matches a file or folder name at any depth
 * (`secrets`, `*.log`). A rule with a slash matches the path relative to the
 * workspace root (`docs/private`, `packages/app/fixtures`).
 */

const escapeChar = (text: string): string => text.replace(/[.+^$(){}|[\]\\]/g, "\\$&");

/** Turns a rule into a regular expression source, glob tokens and all. */
function toPattern(rule: string): string {
  let out = "";
  let index = 0;
  while (index < rule.length) {
    const character = rule[index];
    if (character === "*") {
      if (rule[index + 1] === "*") {
        // `**` crosses folders, and may cross none at all.
        if (rule[index + 2] === "/") {
          out += "(?:.*/)?";
          index += 3;
          continue;
        }
        out += ".*";
        index += 2;
        continue;
      }
      out += "[^/]*";
      index += 1;
      continue;
    }
    if (character === "?") {
      out += "[^/]";
      index += 1;
      continue;
    }
    out += escapeChar(character);
    index += 1;
  }
  return out;
}

/**
 * Compiles one rule; an empty rule compiles to nothing. A rule that names a
 * folder keeps out everything inside it.
 */
export function compileIgnoreRule(rule: string): RegExp | null {
  const trimmed = rule.trim();
  if (!trimmed) return null;
  const scoped = trimmed.includes("/");
  const pattern = toPattern(trimmed);
  return new RegExp(scoped ? `^${pattern}$` : `(^|/)${pattern}$`, "i");
}

/** Compiles a list of rules and drops the ones that say nothing. */
export function compileIgnoreRules(rules: string[]): RegExp[] {
  const compiled: RegExp[] = [];
  for (const rule of rules ?? []) {
    const matcher = compileIgnoreRule(rule);
    if (matcher) compiled.push(matcher);
  }
  return compiled;
}

/**
 * True when the path is covered by a rule. Every ancestor is tested too, so a
 * rule for a folder keeps out everything inside it.
 */
export function isIgnored(rules: RegExp[], relativePath: string): boolean {
  if (!rules.length) return false;
  const parts = relativePath.split("/").filter(Boolean);
  for (let index = 0; index < parts.length; index++) {
    const candidate = parts.slice(0, index + 1).join("/");
    if (rules.some((rule) => rule.test(candidate))) return true;
  }
  return false;
}

/** The rules as the user typed them, cleaned and capped. */
export function normalizeIgnoreRules(rules: string[]): string[] {
  const seen = new Set<string>();
  for (const rule of rules ?? []) {
    const trimmed = rule.trim();
    if (!trimmed) continue;
    seen.add(trimmed);
    if (seen.size >= 50) break;
  }
  return [...seen];
}
