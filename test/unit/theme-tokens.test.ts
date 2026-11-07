import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ACCENTS } from "../../src/renderer/constants";
import { resolvePalette, paletteProblems } from "../../src/utils/a11y-palette";
import { mixHex } from "../../src/utils/colour";
import {
  THEME_TOKENS,
  effectivePalette,
  sanitiseTokens,
  tokenProperties,
} from "../../src/utils/theme-tokens";

const css = readFileSync(new URL("../../src/renderer/styles/global.css", import.meta.url), "utf8");

test("the palette the app works out is the palette the stylesheet paints", () => {
  // The renderer has to know the colours before it paints them, so it keeps a copy
  // of the stylesheet's palette. This is what stops the copy from drifting.
  for (const variant of ["light", "dark", "oled"] as const) {
    for (const accent of ACCENTS) {
      const stylesheet = resolvePalette(css, accent.value, variant);
      const ours = effectivePalette(variant, accent.value);
      for (const [name, value] of ours) {
        assert.equal(stylesheet.get(name), value, `${variant}: ${name} under ${accent.name}`);
      }
      for (const [name, value] of stylesheet) {
        assert.equal(ours.get(name), value, `${variant}: the stylesheet has a colour we do not know: ${name}`);
      }
    }
  }
});

test("a colour the user picked is the colour that is painted", () => {
  const palette = effectivePalette("light", "#3ecf8e", { paper: "#101010", card: "#202020" });
  assert.equal(palette.get("--color-paper"), "#101010");
  assert.equal(palette.get("--color-card"), "#202020");
  // The bubble is mixed from the card, so it follows the card the user picked.
  assert.equal(palette.get("--color-bubble"), mixHex("#3ecf8e", "#202020", 0.1));
  assert.equal(palette.get("--color-accent-soft"), mixHex("#3ecf8e", "#202020", 0.1));
});

test("the true-black scheme is the dark one painted on black", () => {
  const oled = effectivePalette("oled", "#3ecf8e");
  const dark = effectivePalette("dark", "#3ecf8e");
  assert.equal(oled.get("--color-paper"), "#000000");
  assert.equal(oled.get("--color-card"), "#000000");
  assert.equal(dark.get("--color-paper"), "#121512");
  assert.equal(oled.get("--color-ink"), dark.get("--color-ink"));
});

test("a colour that cannot be read is reported, and the built-in palette is not", () => {
  assert.deepEqual(paletteProblems(effectivePalette("light", "#3ecf8e")), []);
  assert.deepEqual(paletteProblems(effectivePalette("dark", "#3ecf8e")), []);

  const painted = effectivePalette("light", "#3ecf8e", { faint: "#f6f7f3" });
  const problems = paletteProblems(painted);
  assert.ok(
    problems.some((problem) => problem.text === "--color-faint" && problem.surface === "--color-paper"),
    "the faint text on the paper is reported"
  );
});

test("a config file can only bring colours the app knows", () => {
  const tokens = sanitiseTokens({
    paper: "#101010",
    ink: "AABBCC",
    card: "not a colour",
    line: 12,
    "--color-paper": "#ff0000",
    sidebar: "#0a0a0a",
  });
  assert.deepEqual(tokens, { paper: "#101010", ink: "#aabbcc", sidebar: "#0a0a0a" });
  assert.deepEqual(sanitiseTokens(undefined), {});
  assert.deepEqual(sanitiseTokens("nonsense"), {});
});

test("only the tokens we know are ever written to a stylesheet", () => {
  const properties = tokenProperties({ paper: "#101010", ink: "#202020" });
  assert.deepEqual(properties, [
    ["--color-paper", "#101010"],
    ["--color-ink", "#202020"],
  ]);
  const names = new Set<string>(THEME_TOKENS.map((token) => token.property));
  for (const [property] of properties) assert.ok(names.has(property), `${property} is a token we know`);
});
