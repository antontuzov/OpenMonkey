import { useEffect } from "react";
import type { Config, UiTextScale } from "../utils/types";
import { parseHex } from "../utils/colour";
import { THEME_TOKENS, tokenProperties, type ThemeTokenValues } from "../utils/theme-tokens";

export const zoomForScale = (scale: UiTextScale): number =>
  scale === "s" ? 0.9 : scale === "l" ? 1.12 : 1;

/**
 * Paints the colours the user picked for the theme on screen.
 *
 * The custom colours are written as inline properties on the document, which beat
 * any rule in the stylesheet — so a colour the user chose is the colour that is
 * painted, even over true black. The properties of the theme that is no longer on
 * screen are taken away again, or the light theme would keep the dark theme's
 * paper.
 */
function paintTokens(root: HTMLElement, tokens: ThemeTokenValues): void {
  for (const { property } of THEME_TOKENS) {
    root.style.removeProperty(property);
  }
  for (const [property, value] of tokenProperties(tokens)) {
    root.style.setProperty(property, value);
  }
}

/** Applies the preference-driven attributes that CSS and the color tokens read. */
export function useAppearance(config: Config | null): void {
  const theme = config?.ui.theme ?? "system";
  const accent = config?.ui.accent ?? "#3ecf8e";
  const density = config?.ui.density ?? { light: "comfortable", dark: "comfortable" };
  const reduceMotion = config?.ui.reduceMotion ?? false;
  const oled = config?.ui.oled ?? false;
  const language = config?.ui.language ?? "en";
  const lightDensity = density.light;
  const darkDensity = density.dark;
  const tokens = config?.ui.tokens ?? { light: {}, dark: {} };
  const lightTokens = tokens.light;
  const darkTokens = tokens.dark;
  // The config is rebuilt whenever it is fetched, so the tokens are compared by
  // what they say rather than by which object says it.
  const lightKey = JSON.stringify(lightTokens);
  const darkKey = JSON.stringify(darkTokens);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--color-accent", parseHex(accent) ? accent : "#3ecf8e");
    root.dataset.reduceMotion = reduceMotion ? "true" : "false";
    root.dataset.oled = oled ? "true" : "false";
    root.lang = language;
    // macOS backs the window with a material; only there is the sidebar thin
    // enough to let it through.
    root.dataset.vibrant = window.electron?.platform === "darwin" ? "true" : "false";

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved = theme === "system" ? (media.matches ? "dark" : "light") : theme;
      root.dataset.theme = resolved;
      // Each theme is packed as tightly as its own setting says.
      root.dataset.density = resolved === "dark" ? darkDensity : lightDensity;
      paintTokens(root, resolved === "dark" ? darkTokens : lightTokens);
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [accent, darkDensity, darkKey, language, lightDensity, lightKey, oled, reduceMotion, theme]);
}
