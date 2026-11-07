/**
 * The rules behind the accessibility check, kept apart from the DOM so they can
 * be tested like any other function.
 *
 * `src/renderer/a11y.ts` reads what is on the screen and hands it over as plain
 * descriptions; this decides whether each one is usable — whether a control can
 * be named by a screen reader, and whether text can be read at all by someone
 * with ordinary contrast sensitivity. The thresholds are WCAG 2.1 AA.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
  /** 0 to 1. */
  alpha: number;
}

/** A colour as the browser reports it: `#rrggbb`, `rgb()` or `rgba()`. */
export function parseCssColor(value: string | null | undefined): Rgb | null {
  const text = (value ?? "").trim().toLowerCase();
  if (!text) return null;
  if (text === "transparent") return { r: 0, g: 0, b: 0, alpha: 0 };

  const hex = /^#([0-9a-f]{3,8})$/.exec(text);
  if (hex) {
    const digits = hex[1];
    if (digits.length !== 3 && digits.length !== 4 && digits.length !== 6 && digits.length !== 8) return null;
    const short = digits.length === 3 || digits.length === 4;
    const at = (index: number) =>
      Number.parseInt(short ? digits[index] + digits[index] : digits.slice(index * 2, index * 2 + 2), 16);
    return {
      r: at(0),
      g: at(1),
      b: at(2),
      alpha: short ? (digits.length === 4 ? at(3) / 255 : 1) : digits.length === 8 ? at(3) / 255 : 1,
    };
  }

  const functional = /^rgba?\(([^)]*)\)$/.exec(text);
  if (functional) {
    const parts = functional[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const channel = (part: string) =>
      part.endsWith("%") ? Number.parseFloat(part) / 100 * 255 : Number.parseFloat(part);
    const [r, g, b] = [channel(parts[0]), channel(parts[1]), channel(parts[2])];
    if (![r, g, b].every(Number.isFinite)) return null;
    let alpha = 1;
    if (parts[3]) {
      alpha = parts[3].endsWith("%") ? Number.parseFloat(parts[3]) / 100 : Number.parseFloat(parts[3]);
      if (!Number.isFinite(alpha)) return null;
    }
    return { r, g, b, alpha: Math.max(0, Math.min(1, alpha)) };
  }
  return null;
}

export function toHex(color: Rgb): string {
  const part = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
  return `#${part(color.r)}${part(color.g)}${part(color.b)}`;
}

/** Puts a translucent colour on an opaque one, the way the screen does. */
export function compositeOver(foreground: Rgb, background: Rgb): Rgb {
  const mix = (a: number, b: number) => a * foreground.alpha + b * (1 - foreground.alpha);
  return {
    r: mix(foreground.r, background.r),
    g: mix(foreground.g, background.g),
    b: mix(foreground.b, background.b),
    alpha: 1,
  };
}

/** WCAG relative luminance; translucency is settled against a surface first. */
export function relativeLuminance(color: Rgb): number {
  const channel = (value: number) => {
    const srgb = value / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

export function contrastRatio(foreground: Rgb, background: Rgb): number {
  const first = relativeLuminance(compositeOver(foreground, background));
  const second = relativeLuminance(background);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * AA asks 4.5 to 1 of ordinary text and 3 to 1 of large text, which is 24px or
 * heavier at 18.66px.
 */
export function requiredRatio(fontSizePx: number, fontWeight = 400): number {
  const large = fontSizePx >= 24 || (fontWeight >= 700 && fontSizePx >= 18.66);
  return large ? 3 : 4.5;
}

/** A plain description of one element on the screen; the DOM adapter builds these. */
export interface AuditableElement {
  /** `button`, `input`, `img` … used by the messages. */
  tag: string;
  /** The control the check is about, or `text` for a run of text. */
  kind: "control" | "field" | "image" | "dialog" | "text";
  /** Where the element is, in a form a person can follow. */
  path: string;
  /** The name a screen reader would read, or "" when there is none. */
  name: string;
  /** A field counts as labelled only by a real label, not a placeholder. */
  labelled?: boolean;
  placeholder?: string;
  /** Whether the alt attribute is present, for an image. */
  hasAlt?: boolean;
  /** How many focusable elements a dialog holds. */
  focusable?: number;
  /** The text, its colour and the colour behind it. */
  text?: string;
  color?: Rgb | null;
  background?: Rgb | null;
  fontSize?: number;
  fontWeight?: number;
}

export type A11yRule =
  | "control-name"
  | "field-label"
  | "image-alt"
  | "dialog-name"
  | "dialog-focus"
  | "contrast";

export interface A11yFinding {
  rule: A11yRule;
  path: string;
  detail: string;
  /** For contrast only. */
  ratio?: number;
  required?: number;
}

export interface A11yReport {
  findings: A11yFinding[];
  /** How many elements the rules were applied to. */
  checked: number;
  /**
   * How many of each kind were looked at.
   *
   * A total says how much was read but not what, and a report that read only
   * buttons proves nothing about the text. The tally says which of the rules
   * were given something to judge.
   */
  kinds: Record<AuditableElement["kind"], number>;
}

const clip = (value: string, length = 48) => {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > length ? `${flat.slice(0, length - 1)}…` : flat;
};

/**
 * The whole check: a list of elements in, a list of what is wrong with them out.
 *
 * A colour that cannot be read is not reported as a failure — an audit that
 * guesses produces findings nobody acts on, so an unparsable colour is skipped.
 */
export function auditElements(elements: AuditableElement[]): A11yReport {
  const findings: A11yFinding[] = [];
  const kinds: Record<AuditableElement["kind"], number> = { control: 0, field: 0, image: 0, dialog: 0, text: 0 };
  for (const element of elements) {
    kinds[element.kind] += 1;
    switch (element.kind) {
      case "control": {
        if (!element.name.trim()) {
          findings.push({
            rule: "control-name",
            path: element.path,
            detail: `a ${element.tag} with nothing to read out: ${clip(element.text ?? "") || "no text at all"}`,
          });
        }
        break;
      }
      case "field": {
        if (element.labelled) break;
        findings.push({
          rule: "field-label",
          path: element.path,
          // A placeholder disappears as soon as anything is typed and is read out
          // inconsistently, so it does not count as a label here.
          detail: element.placeholder?.trim()
            ? `a ${element.tag} described only by its placeholder "${clip(element.placeholder)}"`
            : `a ${element.tag} with no label`,
        });
        break;
      }
      case "image": {
        if (!element.hasAlt) {
          findings.push({
            rule: "image-alt",
            path: element.path,
            detail: `an image with no alt attribute: ${clip(element.text ?? "") || "no source either"}`,
          });
        }
        break;
      }
      case "dialog": {
        if (!element.name.trim()) {
          findings.push({ rule: "dialog-name", path: element.path, detail: "a dialog with no accessible title" });
        }
        if (!element.focusable) {
          findings.push({
            rule: "dialog-focus",
            path: element.path,
            detail: `a dialog nothing can be focused in (${element.focusable ?? 0} focusable)`,
          });
        }
        break;
      }
      case "text": {
        if (!element.color || !element.background || !element.text?.trim()) break;
        const ratio = contrastRatio(element.color, element.background);
        const required = requiredRatio(element.fontSize ?? 13, element.fontWeight ?? 400);
        if (ratio < required) {
          const size = Math.round(element.fontSize ?? 13);
          findings.push({
            rule: "contrast",
            path: element.path,
            detail:
              `${clip(element.text)} reads ${ratio.toFixed(2)} to 1 on its background, ` +
              `and ${required.toFixed(1)} to 1 is asked at ${size}px`,
            ratio: Math.round(ratio * 100) / 100,
            required,
          });
        }
      }
    }
  }
  return { findings, checked: elements.length, kinds };
}
