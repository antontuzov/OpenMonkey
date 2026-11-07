/**
 * The colour arithmetic the app and the palette gate share.
 *
 * A `color-mix(in srgb, A N%, B)` in the stylesheet is a plain lerp of two colours
 * in the sRGB space, so the same arithmetic here produces the colour the browser
 * paints. Nothing in this file touches a window, which is what lets the main
 * process, the renderer and the tests all use it.
 */

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

export function parseHex(value: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const number = Number.parseInt(match[1], 16);
  return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
}

/** `from` at `weight`, `to` at the rest — the mix the stylesheet writes. */
export function mixHex(from: string, to: string, weight: number): string {
  const a = parseHex(from);
  const b = parseHex(to);
  if (!a || !b) return from;
  const channels = a.map((channel, index) => clampChannel(channel * weight + b[index] * (1 - weight)));
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function luminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The accent as text on a card, mirroring the CSS color-mix tokens. */
export function accentInk(accent: string, dark: boolean): string {
  return mixHex(accent, dark ? "#ffffff" : "#06251a", dark ? 0.52 : 0.48);
}

export interface ContrastReport {
  ratio: number;
  level: "aa" | "large" | "low";
  passes: boolean;
}

export function checkAccent(accent: string): ContrastReport {
  const light = contrastRatio(accentInk(accent, false), "#fdfdfb");
  const dark = contrastRatio(accentInk(accent, true), "#191d18");
  const ratio = Math.min(light, dark);
  const rounded = Math.round(ratio * 10) / 10;
  if (ratio >= 4.5) return { ratio: rounded, level: "aa", passes: true };
  if (ratio >= 3) return { ratio: rounded, level: "large", passes: true };
  return { ratio: rounded, level: "low", passes: false };
}
