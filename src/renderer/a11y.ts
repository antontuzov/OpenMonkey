/**
 * Reads what is on the screen and hands it to the rules in `utils/a11y`.
 *
 * Everything the browser has to answer — is this visible, what would a screen
 * reader call it, what colour is actually behind this text — is settled here, in
 * the document. The judgements themselves are not made here, so they can be read
 * and tested without a window.
 */
import {
  auditElements,
  compositeOver,
  parseCssColor,
  type A11yReport,
  type AuditableElement,
  type Rgb,
} from "../utils/a11y";

const INTERACTIVE =
  'a[href], button, input, select, textarea, summary, [role="button"], [role="link"], [role="switch"], [role="checkbox"], [role="radio"], [role="tab"], [role="menuitem"], [role="combobox"], [tabindex]';

const LABELLED_ROLES = new Set(["button", "link", "switch", "checkbox", "radio", "tab", "menuitem", "combobox"]);

/** The text an element draws itself, not the text its children draw. */
function ownText(element: Element): string {
  let text = "";
  for (const child of element.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) text += child.textContent ?? "";
  }
  return text.trim();
}

/**
 * Whether anything can be seen of it.
 *
 * `aria-hidden` is the app's own way of saying a thing is decoration, so the
 * check takes it at its word: an element nobody can see cannot be hard to see.
 */
function isIgnored(element: Element): boolean {
  for (
    let node: Element | null = element;
    node && node !== document.documentElement;
    node = node.parentElement
  ) {
    if (node.getAttribute("aria-hidden") === "true") return true;
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return true;
    if (Number(style.opacity) === 0) return true;
    // Disabled controls are exempt from the contrast rule, and a greyed-out one
    // is the point of it.
    if (node instanceof HTMLButtonElement || node instanceof HTMLInputElement) {
      if (node.disabled) return true;
    }
  }
  return false;
}

function textOfIds(document: Document, ids: string): string {
  return ids
    .split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
    .filter(Boolean)
    .join(" ");
}

/** The words of the `label` elements a control belongs to, explicit or wrapped. */
function labelText(control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): string {
  return [...(control.labels ?? [])]
    .map((label) => label.textContent?.trim() ?? "")
    .filter(Boolean)
    .join(" ");
}

/** The name a screen reader would reach for, in the order the spec tries them. */
function accessibleName(element: Element): string {
  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    const referenced = textOfIds(element.ownerDocument, labelledBy);
    if (referenced) return referenced;
  }
  const label = element.getAttribute("aria-label");
  if (label?.trim()) return label.trim();

  if (element instanceof HTMLImageElement) return element.alt.trim();
  if (element instanceof HTMLInputElement) {
    if (["button", "submit", "reset"].includes(element.type)) return element.value.trim();
    return labelText(element);
  }
  if (element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
    return labelText(element);
  }

  const role = element.getAttribute("role");
  const tag = element.tagName.toLowerCase();
  if (role && LABELLED_ROLES.has(role) || tag === "button" || tag === "a" || tag === "summary") {
    const content = element.textContent?.trim();
    if (content) return content;
  }
  return element.getAttribute("title")?.trim() ?? "";
}

/** Whether something a reader can be told about is attached as a label. */
function hasRealLabel(element: Element): boolean {
  if (element.getAttribute("aria-label")?.trim()) return true;
  if (element.getAttribute("aria-labelledby")?.trim()) return true;
  if (element.getAttribute("title")?.trim()) return true;
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
  ) {
    return Boolean(labelText(element));
  }
  return false;
}

/**
 * The colour behind an element, with every translucent layer put on in order.
 *
 * The app tints most of its surfaces from one accent with `color-mix(… 12%,
 * transparent)`, so a computed background is often see-through and the answer is
 * whatever is behind that. Where nothing opaque is found the page's own paper is
 * used, which is what the window is painted with.
 */
function backgroundOf(element: Element): Rgb {
  const layers: Rgb[] = [];
  for (let node: Element | null = element; node; node = node.parentElement) {
    const color = parseCssColor(getComputedStyle(node).backgroundColor);
    if (color && color.alpha > 0) {
      layers.push(color);
      if (color.alpha >= 1) break;
    }
  }
  const base = layers.length && layers[layers.length - 1].alpha >= 1 ? layers.pop()! : paperColor();
  let painted = base;
  for (let index = layers.length - 1; index >= 0; index -= 1) painted = compositeOver(layers[index], painted);
  return painted;
}

let paper: Rgb | null = null;

/**
 * The colour the window itself is painted with.
 *
 * A vibrant window is backed by the desktop material, which the app cannot see, and
 * a CI runner never composites at all. The page's own `--color-paper` is the closest
 * honest stand-in — and unlike a fixed grey it is the light one in the light theme
 * and the dark one in the dark theme.
 */
function paperColor(): Rgb {
  if (paper) return paper;
  const style = getComputedStyle(document.documentElement);
  const painted = parseCssColor(style.backgroundColor);
  const declared = parseCssColor(style.getPropertyValue("--color-paper"));
  paper =
    painted?.alpha === 1
      ? painted
      : declared?.alpha === 1
        ? declared
        : { r: 246, g: 247, b: 243, alpha: 1 };
  return paper;
}

/** Where the element is, in a form someone can go and look at. */
function pathOf(element: Element): string {
  const parts: string[] = [];
  for (let node: Element | null = element; node && node !== document.body; node = node.parentElement) {
    const tag = node.tagName.toLowerCase();
    const id = node.id ? `#${node.id}` : "";
    const first = [...node.classList][0];
    parts.push(`${tag}${id}${first ? `.${first}` : ""}`);
    if (parts.length >= 3) break;
  }
  return parts.reverse().join(" > ");
}

function isFocusable(element: Element): boolean {
  if (!element.matches(INTERACTIVE)) return false;
  if (element instanceof HTMLButtonElement && element.disabled) return false;
  if (element instanceof HTMLInputElement && element.disabled) return false;
  return !isIgnored(element);
}

/**
 * Describes the document the way the rules want it: one record per thing that can
 * go wrong, with the colours already settled against what is behind them.
 */
export function describeDocument(root: Element = document.body): AuditableElement[] {
  paper = null;
  const elements: AuditableElement[] = [];
  for (const element of root.querySelectorAll<HTMLElement>("*")) {
    if (isIgnored(element)) continue;
    const tag = element.tagName.toLowerCase();
    const role = element.getAttribute("role");
    const style = getComputedStyle(element);
    const name = accessibleName(element);
    const color = parseCssColor(style.color);
    const fontSize = Number.parseFloat(style.fontSize);
    const fontWeight = Number.parseFloat(style.fontWeight) || 400;

    if (element instanceof HTMLImageElement) {
      elements.push({
        tag,
        kind: "image",
        path: pathOf(element),
        name,
        hasAlt: element.hasAttribute("alt"),
        text: element.getAttribute("src") ?? "",
      });
      continue;
    }
    if (role === "dialog" || tag === "dialog") {
      elements.push({
        tag,
        kind: "dialog",
        path: pathOf(element),
        name,
        focusable: [...element.querySelectorAll(INTERACTIVE)].filter(isFocusable).length,
      });
      continue;
    }
    if (tag === "input" || tag === "select" || tag === "textarea") {
      const field = element as HTMLInputElement;
      elements.push({
        tag,
        kind: "field",
        path: pathOf(element),
        name,
        labelled: hasRealLabel(element),
        placeholder: field.placeholder ?? "",
      });
      // A field's own text is its value, which the reader is not measured on.
      continue;
    }
    if (tag === "button" || tag === "a" || (role && LABELLED_ROLES.has(role)) || tag === "summary") {
      elements.push({ tag, kind: "control", path: pathOf(element), name, text: element.textContent ?? "" });
    }

    // Text is measured where it is drawn, which is the element holding the words.
    const text = ownText(element);
    if (text && color) {
      elements.push({
        tag,
        kind: "text",
        path: pathOf(element),
        name: text,
        text,
        color,
        background: backgroundOf(element),
        fontSize,
        fontWeight,
      });
    }
  }
  return elements;
}

/** The check, as the app and the e2e both run it. */
export function runAccessibilityAudit(root?: Element): A11yReport {
  return auditElements(describeDocument(root));
}

/** Lets the e2e ask for the same answer the Settings row shows. */
export function installAuditHook(): void {
  window.openmonkeyAudit = runAccessibilityAudit;
}

declare global {
  interface Window {
    openmonkeyAudit?: () => A11yReport;
  }
}
