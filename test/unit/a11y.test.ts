import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ACCENTS } from "../../src/renderer/constants";
import { accentInk } from "../../src/renderer/theme";
import { paletteProblems, resolvePalette } from "../../src/utils/a11y-palette";
import {
  auditElements,
  compositeOver,
  contrastRatio,
  parseCssColor,
  relativeLuminance,
  requiredRatio,
  toHex,
  type AuditableElement,
} from "../../src/utils/a11y";

test("a colour is read the way the browser writes it", () => {
  assert.deepEqual(parseCssColor("#3ecf8e"), { r: 62, g: 207, b: 142, alpha: 1 });
  assert.deepEqual(parseCssColor("rgb(62 207 142)"), { r: 62, g: 207, b: 142, alpha: 1 });
  assert.deepEqual(parseCssColor("rgba(62, 207, 142, 0.5)"), { r: 62, g: 207, b: 142, alpha: 0.5 });
  assert.deepEqual(parseCssColor("#abc"), { r: 170, g: 187, b: 204, alpha: 1 });
  assert.equal(parseCssColor("transparent")?.alpha, 0);
  assert.equal(parseCssColor("color-mix(in srgb, red 50%, blue)"), null);
  assert.equal(parseCssColor(""), null);
  assert.equal(parseCssColor(undefined), null);
});

test("black, white and middle grey have the luminance WCAG defines", () => {
  assert.equal(relativeLuminance(parseCssColor("#000")!), 0);
  assert.equal(relativeLuminance(parseCssColor("#fff")!), 1);
  assert.ok(Math.abs(relativeLuminance(parseCssColor("#808080")!) - 0.2159) < 0.001);
});

test("black on white is 21 to 1 and a colour is not contrasted with itself", () => {
  assert.equal(contrastRatio(parseCssColor("#000")!, parseCssColor("#fff")!), 21);
  assert.equal(contrastRatio(parseCssColor("#3ecf8e")!, parseCssColor("#3ecf8e")!), 1);
});

test("translucent paint is measured after it lands on the surface", () => {
  const ink = parseCssColor("#1f241f")!;
  const card = parseCssColor("#fdfdfb")!;
  // 5% of the ink over the card is almost the card itself, so almost no contrast.
  assert.equal(toHex(compositeOver({ ...ink, alpha: 0.05 }, card)), "#f2f2f0");
  assert.ok(contrastRatio({ ...ink, alpha: 0.05 }, card) < 1.2);
  // The same ink, opaque, is the whole story.
  assert.ok(contrastRatio(ink, card) > 15);
});

test("large text is given away at 24px and at 18.66px when it is bold", () => {
  assert.equal(requiredRatio(13), 4.5);
  assert.equal(requiredRatio(23.9), 4.5);
  assert.equal(requiredRatio(24), 3);
  assert.equal(requiredRatio(18.66, 700), 3);
  assert.equal(requiredRatio(18.66, 600), 4.5);
  assert.equal(requiredRatio(19, 400), 4.5);
});

const element = (over: Partial<AuditableElement>): AuditableElement => ({
  tag: "button",
  kind: "control",
  path: "body > button",
  name: "Save",
  ...over,
});

test("a control with nothing to read out is reported and a named one is not", () => {
  const report = auditElements([
    element({ name: "" }),
    element({ name: "  " }),
    element({ name: "New conversation" }),
    element({ kind: "field", tag: "input", name: "Path", labelled: true }),
    element({ kind: "image", tag: "img", name: "", hasAlt: true }),
    element({ kind: "dialog", tag: "div", name: "Approval", focusable: 3 }),
  ]);
  assert.deepEqual(
    report.findings.map((finding) => finding.rule),
    ["control-name", "control-name"]
  );
  assert.equal(report.checked, 6);
  assert.deepEqual(report.kinds, { control: 3, field: 1, image: 1, dialog: 1, text: 0 });
});

test("the report says what it looked at, so a half-read screen cannot pass for a whole one", () => {
  const report = auditElements([
    element({ kind: "text", tag: "p", name: "", text: "hello", color: parseCssColor("#000")!, background: parseCssColor("#fff")!, fontSize: 13 }),
    element({ name: "Save" }),
  ]);
  assert.deepEqual(report.kinds, { control: 1, field: 0, image: 0, dialog: 0, text: 1 });
  assert.equal(report.checked, 2);
});

test("a placeholder is not a label, and the report says so", () => {
  const report = auditElements([
    element({ kind: "field", tag: "input", name: "", labelled: false }),
    element({ kind: "field", tag: "input", name: "Search", labelled: false, placeholder: "Search chats" }),
    element({ kind: "field", tag: "select", name: "Mint", labelled: true }),
  ]);
  assert.equal(report.findings.length, 2);
  assert.match(report.findings[0].detail, /no label/);
  assert.match(report.findings[1].detail, /described only by its placeholder "Search chats"/);
});

test("an image needs the alt attribute, even an empty one", () => {
  const report = auditElements([
    element({ kind: "image", tag: "img", name: "", hasAlt: true, text: "logo.png" }),
    element({ kind: "image", tag: "img", name: "", hasAlt: false, text: "logo.png" }),
  ]);
  assert.deepEqual(
    report.findings.map((finding) => [finding.rule, finding.detail]),
    [["image-alt", "an image with no alt attribute: logo.png"]]
  );
});

test("a dialog is reported when it cannot be named or cannot be reached", () => {
  const report = auditElements([
    element({ kind: "dialog", tag: "div", name: "", focusable: 2 }),
    element({ kind: "dialog", tag: "div", name: "Approval", focusable: 0 }),
    element({ kind: "dialog", tag: "div", name: "Approval", focusable: 2 }),
  ]);
  assert.deepEqual(
    report.findings.map((finding) => finding.rule),
    ["dialog-name", "dialog-focus"]
  );
});

test("text is judged at the size it is drawn", () => {
  const quiet = parseCssColor("#97a095")!; // 2.65 to 1 on a card
  const mid = parseCssColor("#7d867a")!; // 3.71 to 1: fails small, passes large
  const card = parseCssColor("#fdfdfb")!;
  const report = auditElements([
    element({ kind: "text", tag: "p", name: "", text: "a quiet label", color: quiet, background: card, fontSize: 10 }),
    element({
      kind: "text",
      tag: "h2",
      name: "",
      text: "the same quiet colour, large",
      color: quiet,
      background: card,
      fontSize: 28,
      fontWeight: 700,
    }),
    element({
      kind: "text",
      tag: "h2",
      name: "",
      text: "a mid colour, large",
      color: mid,
      background: card,
      fontSize: 28,
      fontWeight: 700,
    }),
    element({ kind: "text", tag: "p", name: "", text: "the same colour, small", color: mid, background: card, fontSize: 13 }),
    // Nothing to measure is not a finding.
    element({ kind: "text", tag: "p", name: "", text: "no colours", color: null, background: null }),
  ]);
  assert.deepEqual(
    report.findings.map((finding) => [finding.ratio, finding.required]),
    [
      [2.65, 4.5],
      [2.65, 3],
      [3.71, 4.5],
    ]
  );
  assert.match(report.findings[0].detail, /reads 2.65 to 1/);
});

test("the stylesheet's own palette clears AA for every swatch in every scheme", () => {
  // The gate reads the real global.css, resolves the token cascade the way the
  // browser does, and contrasts every text token against every surface it can
  // be drawn on — so a colour regression fails here, without a window.
  const css = readFileSync(new URL("../../src/renderer/styles/global.css", import.meta.url), "utf8");
  for (const variant of ["light", "dark", "oled"] as const) {
    for (const accent of ACCENTS) {
      const palette = resolvePalette(css, accent.value, variant);
      assert.ok(palette.size > 10, `${variant}: the tokens did not resolve`);
      const problems = paletteProblems(palette);
      assert.deepEqual(
        problems.map((p) => `${p.text} on ${p.surface} = ${p.ratio}`),
        [],
        `${variant} scheme with the ${accent.name} (${accent.value}) swatch`
      );
    }
  }
});

test("true black paints the paper black and leaves the dark palette alone", () => {
  const css = readFileSync(new URL("../../src/renderer/styles/global.css", import.meta.url), "utf8");
  const accent = ACCENTS[0].value;
  const oled = resolvePalette(css, accent, "oled");
  const dark = resolvePalette(css, accent, "dark");
  assert.equal(oled.get("--color-paper"), "#000000");
  assert.equal(oled.get("--color-card"), "#000000");
  // The dark scheme keeps its own greys: the true-black block must not leak into it.
  assert.equal(dark.get("--color-paper"), "#121512");
  assert.equal(dark.get("--color-card"), "#191d18");
  // Black is not a colour scheme of its own: the ink is the dark theme's ink.
  assert.equal(oled.get("--color-ink"), dark.get("--color-ink"));
});

test("the accent ink the settings preview promises is the ink the stylesheet paints", () => {
  // theme.ts re-implements the mix for the live contrast readout; if the two
  // disagree the preview lies to the user.
  const css = readFileSync(new URL("../../src/renderer/styles/global.css", import.meta.url), "utf8");
  for (const accent of ACCENTS) {
    for (const [theme, token] of [["light", "--color-accent-ink"], ["dark", "--color-accent-ink"]] as const) {
      const painted = resolvePalette(css, accent.value, theme).get(token)!;
      assert.equal(accentInk(accent.value, theme === "dark"), painted, `${theme} ${accent.name}`);
    }
  }
});
