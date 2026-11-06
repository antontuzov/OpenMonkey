/**
 * The stylesheet's own colours, worked out the way a browser works them out.
 *
 * The palette is not a list of hexes: most of it is mixed from one accent at
 * run time, so `--color-accent-ink` is a `color-mix` of a `var`. The contrast
 * gate has to follow the same arithmetic or it would be checking colours the app
 * never paints — and it has to be able to do it without a window, because a
 * check that only runs in the app cannot be the thing a CI job fails on.
 */
import { contrastRatio, parseCssColor, type Rgb } from "./a11y";

/** The colours text is drawn in. */
export const TEXT_TOKENS = [
  "--color-ink",
  "--color-muted",
  "--color-faint",
  "--color-accent-ink",
  "--color-danger",
  "--color-warn",
] as const;

/** The colours text is drawn on. */
export const SURFACE_TOKENS = [
  "--color-paper",
  "--color-card",
  "--color-card-2",
  "--color-accent-soft",
  "--color-bubble",
  "--color-sidebar",
] as const;

/**
 * Paint that is not mixed from the accent but is drawn on top of it. Both sides
 * may be a token name or a literal, because the stylesheet uses each form.
 */
export const FIXED_PAIRS: ReadonlyArray<readonly [string, string, string]> = [
  ["button label", "--color-on-accent", "--color-accent"],
  ["selected swatch tick", "--color-on-accent", "--color-accent"],
];

interface Declaration {
  name: string;
  value: string;
}

/** Every `--x: value` inside the braces of a block whose selector matches. */
function declarations(css: string, wanted: RegExp): Declaration[] {
  const found: Declaration[] = [];
  for (const match of css.matchAll(/([^\r\n{}]+)\{([^{}]*)\}/g)) {
    // The capture starts at the previous block's closing brace.
    const selector = match[1].slice(match[1].lastIndexOf("}") + 1).trim();
    if (!wanted.test(selector)) continue;
    for (const rule of match[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      found.push({ name: rule[1], value: rule[2].trim() });
    }
  }
  return found;
}

/**
 * One value, settled to a colour string.
 *
 * Handles the two forms the palette actually uses: `var(--x)` and
 * `color-mix(in srgb, A N%, B)`. Anything else comes back as it was written, and
 * the caller decides whether that is a colour.
 */
function resolve(value: string, declared: Map<string, string>, seen: Set<string>): string | null {
  const variable = /^var\((--[\w-]+)\)$/.exec(value);
  if (variable) {
    const name = variable[1];
    if (seen.has(name)) return null;
    const next = declared.get(name);
    if (next === undefined) return null;
    seen.add(name);
    const resolved = resolve(next, declared, seen);
    seen.delete(name);
    return resolved;
  }

  const mix = /^color-mix\(\s*in\s+\w+(?:\s+\w+)*\s*,\s*(.+?)\s+([\d.]+)%\s*,\s*(.+)\s*\)$/.exec(value);
  if (mix) {
    const first = resolve(mix[1].trim(), declared, seen);
    const second = resolve(mix[3].trim(), declared, seen);
    const weight = Number.parseFloat(mix[2]) / 100;
    if (!first || !second || !Number.isFinite(weight)) return null;
    return blend(first, second, weight);
  }
  return value;
}

const toHex = (channels: number[]) =>
  `#${channels.map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0")).join("")}`;

/** `color-mix(in srgb, A N%, B)` in the sRGB space the browser mixes in. */
export function blend(from: string, to: string, weight: number): string | null {
  const a = parseCssColor(from);
  const b = parseCssColor(to);
  if (!a || !b) return null;
  return toHex([a.r, a.g, a.b].map((channel, index) => channel * weight + [b.r, b.g, b.b][index] * (1 - weight)));
}

/**
 * The palette as it will be painted, for one accent in one theme.
 *
 * `:root` and `[data-theme="dark"]` come after `@theme`, the same order the
 * cascade uses, so a token the dark block re-declares resolves to the dark value.
 * The vibrant sidebar is left out: it is mixed with `transparent` so the desktop
 * shows through it, and what is behind it is not the app's to judge.
 */
export function resolvePalette(css: string, accent: string, theme: "light" | "dark"): Map<string, string> {
  const declared = new Map<string, string>();
  const blocks: RegExp[] =
    theme === "dark"
      ? [/@theme/, /:root/, /\[data-theme="dark"\]/]
      : [/@theme/, /:root/];
  for (const block of blocks) for (const rule of declarations(css, block)) declared.set(rule.name, rule.value);
  declared.set("--color-accent", accent);

  const settled = new Map<string, string>();
  for (const [name, value] of declared) {
    const resolved = resolve(value, declared, new Set([name]));
    if (resolved && parseCssColor(resolved)?.alpha === 1) settled.set(name, resolved);
  }
  return settled;
}

export interface PaletteProblem {
  text: string;
  surface: string;
  foreground: string;
  background: string;
  ratio: number;
}

/**
 * Every pairing the app can draw, judged at the size it is drawn at: none of
 * these are large text, so all of them are asked for 4.5 to 1.
 */
export function paletteProblems(palette: Map<string, string>, required = 4.5): PaletteProblem[] {
  const problems: PaletteProblem[] = [];
  const surfaceOf = (token: string) => palette.get(token);
  for (const text of TEXT_TOKENS) {
    const foreground = palette.get(text);
    if (!foreground) continue;
    for (const surface of SURFACE_TOKENS) {
      const background = surfaceOf(surface);
      if (!background) continue;
      const ratio = contrastRatioRgb(foreground, background);
      if (ratio < required) {
        problems.push({ text, surface, foreground, background, ratio: Math.round(ratio * 100) / 100 });
      }
    }
  }
  for (const [label, foregroundToken, surface] of FIXED_PAIRS) {
    const foreground = foregroundToken.startsWith("--") ? palette.get(foregroundToken) : foregroundToken;
    const background = surfaceOf(surface);
    if (!foreground || !background) continue;
    const ratio = contrastRatioRgb(foreground, background);
    if (ratio < required) {
      problems.push({ text: label, surface, foreground, background, ratio: Math.round(ratio * 100) / 100 });
    }
  }
  return problems;
}

function contrastRatioRgb(from: string, to: string): number {
  const foreground: Rgb | null = parseCssColor(from);
  const background: Rgb | null = parseCssColor(to);
  if (!foreground || !background) return 1;
  return contrastRatio(foreground, background);
}
