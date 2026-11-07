/**
 * The colours a user may pick, and the palette they are picked against.
 *
 * The built-in palette lives in the stylesheet, and this module holds a copy of
 * it: the renderer has to work out what the app will look like before it paints
 * it — to grade a colour the user is typing — and a stylesheet is not something a
 * window can be asked about in advance. The copy is pinned to the stylesheet by a
 * unit test, so the two cannot drift apart without CI noticing.
 */
import { mixHex } from "./colour";

/**
 * The tokens a user may set, and the CSS property each one paints.
 *
 * Only surfaces and text colours are here. The accent has a picker of its own,
 * and the colours mixed from it follow whatever the card is, so they are not
 * things a user should have to name twice.
 */
export const THEME_TOKENS = [
  { token: "paper", property: "--color-paper" },
  { token: "card", property: "--color-card" },
  { token: "card-2", property: "--color-card-2" },
  { token: "line", property: "--color-line" },
  { token: "ink", property: "--color-ink" },
  { token: "muted", property: "--color-muted" },
  { token: "faint", property: "--color-faint" },
  { token: "sidebar", property: "--color-sidebar" },
] as const;

export type ThemeToken = (typeof THEME_TOKENS)[number]["token"];
export type ThemeTokenValues = Partial<Record<ThemeToken, string>>;

/** The three colour schemes the app can paint. */
export type TokenScheme = "light" | "dark" | "oled";

/** Every token the palette gate reads, as the stylesheet writes them. */
const BUILT_IN: Record<TokenScheme, Record<string, string>> = {
  light: {
    "--color-paper": "#f6f7f3",
    "--color-card": "#fdfdfb",
    "--color-card-2": "#f0f2ec",
    "--color-line": "#e3e6de",
    "--color-ink": "#1f241f",
    "--color-muted": "#5c6459",
    "--color-faint": "#646c62",
    "--color-sidebar": "#f0f2ec",
    "--color-danger": "#b74139",
    "--color-warn": "#8a6018",
    "--color-on-accent": "#0b1e14",
  },
  dark: {
    "--color-paper": "#121512",
    "--color-card": "#191d18",
    "--color-card-2": "#1e231d",
    "--color-line": "#2b322b",
    "--color-ink": "#e8ece4",
    "--color-muted": "#a6aea5",
    "--color-faint": "#96a096",
    "--color-sidebar": "#1e231d",
    "--color-danger": "#f18d84",
    "--color-warn": "#d8a24a",
    "--color-on-accent": "#0b1e14",
  },
  oled: {
    "--color-paper": "#000000",
    "--color-card": "#000000",
    "--color-card-2": "#0c0f0c",
    "--color-line": "#232823",
    "--color-ink": "#e8ece4",
    "--color-muted": "#a6aea5",
    "--color-faint": "#96a096",
    "--color-sidebar": "#000000",
    "--color-danger": "#f18d84",
    "--color-warn": "#d8a24a",
    "--color-on-accent": "#0b1e14",
  },
};

/**
 * The palette as it will be painted, for one accent and one scheme.
 *
 * The colours mixed from the accent are mixed here rather than copied, because
 * they are mixed from the card: a user who repaints the card changes what the
 * accent's soft colour and the message bubble become, exactly as the stylesheet
 * would.
 */
export function effectivePalette(
  scheme: TokenScheme,
  accent: string,
  custom: ThemeTokenValues = {}
): Map<string, string> {
  const palette = new Map(Object.entries(BUILT_IN[scheme]));
  palette.set("--color-accent", accent);
  for (const { token, property } of THEME_TOKENS) {
    const value = custom[token];
    if (value) palette.set(property, value);
  }
  const card = palette.get("--color-card") ?? "#fdfdfb";
  const dark = scheme !== "light";
  palette.set("--color-accent-ink", mixHex(accent, dark ? "#ffffff" : "#06251a", dark ? 0.52 : 0.48));
  palette.set("--color-accent-soft", mixHex(accent, card, dark ? 0.12 : 0.1));
  palette.set("--color-bubble", mixHex(accent, card, dark ? 0.13 : 0.1));
  return palette;
}

/**
 * The custom colours of one theme, with anything unusable dropped.
 *
 * A config file is user data, and a user data file can hold anything: a token
 * that is not one of ours, a colour that is not a colour. Neither is allowed
 * anywhere near a stylesheet.
 */
export function sanitiseTokens(value: unknown): ThemeTokenValues {
  const tokens: ThemeTokenValues = {};
  if (!value || typeof value !== "object") return tokens;
  for (const { token } of THEME_TOKENS) {
    const raw = (value as Record<string, unknown>)[token];
    if (typeof raw !== "string") continue;
    const match = /^#?([0-9a-f]{6})$/i.exec(raw.trim());
    if (!match) continue;
    tokens[token] = `#${match[1].toLowerCase()}`;
  }
  return tokens;
}

/** The CSS properties a set of custom colours writes, and nothing else. */
export function tokenProperties(tokens: ThemeTokenValues): Array<[string, string]> {
  const properties: Array<[string, string]> = [];
  for (const { token, property } of THEME_TOKENS) {
    const value = tokens[token];
    if (value) properties.push([property, value]);
  }
  return properties;
}
