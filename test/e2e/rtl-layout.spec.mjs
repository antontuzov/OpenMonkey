/**
 * The layout has to be able to turn the other way round.
 *
 * The unit tests read the source and prove that nothing is pinned to one side.
 * Only the running app can prove what matters to the reader: that the panel
 * really moves to the other side of the window, that the rule that separates it
 * follows, that the arrows point back and that the switch slides the other way.
 *
 * The first two specs turn the document by hand, because the mirror is a property
 * of the layout and not of any one language. The last one is the real thing: an
 * app that starts in Arabic and comes up the other way round on its own.
 */
import { test, expect } from "@playwright/test";
import { quitApp } from "./helpers.mjs";
import { _electron as electron } from "playwright-core";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function launch(language = "en") {
  const profile = mkdtempSync(path.join(os.tmpdir(), "openmonkey-rtl-"));
  writeFileSync(
    path.join(profile, "openmonkey-config.json"),
    JSON.stringify({
      onboarding: { completed: true },
      model: { provider: "bonsai" },
      memory: { enabled: false, workspaceSearch: false },
      desktop: { closeToTray: true },
      ui: { theme: "light", language },
    })
  );
  const app = await electron.launch({
    args: [root],
    timeout: 120_000,
    env: { ...process.env, OPENMONKEY_USER_DATA: profile, OPENMONKEY_DEBUG_PORT: "" },
  });
  const page = await app.firstWindow({ timeout: 120_000 });
  await page.waitForLoadState("domcontentloaded");
  await page.setViewportSize({ width: 1440, height: 1000 });
  return { app, page, profile };
}

const flip = (page) => page.evaluate(() => {
  document.documentElement.dir = "rtl";
});

/** Where the side panel sits, and which of its edges carries the rule. */
const panel = (page) =>
  page.evaluate(() => {
    const aside = document.querySelector("aside.bg-sidebar");
    if (!aside) return null;
    const box = aside.getBoundingClientRect();
    const style = getComputedStyle(aside);
    return {
      left: Math.round(box.left),
      borderLeft: style.borderLeftWidth,
      borderRight: style.borderRightWidth,
      windowWidth: window.innerWidth,
    };
  });

/** How the arrow that points somewhere is drawn. */
const arrow = (page) =>
  page.evaluate(() => {
    const icon = document.querySelector('svg[class*="rtl:rotate-180"]');
    if (!icon) return null;
    const style = getComputedStyle(icon);
    // The turn is the `rotate` property, not a transform.
    return { transform: style.transform, rotate: style.rotate };
  });

/** The way the document says it runs. */
const docDir = (page) =>
  page.evaluate(() => document.documentElement.dir);

/** The knob of the first switch that is on. */
const knob = (page) =>
  page.evaluate(() => {
    const toggle = document.querySelector(".toggle-on");
    if (!toggle) return null;
    return getComputedStyle(toggle, "::after").transform;
  });

test("the interface turns the other way round", async () => {
  test.setTimeout(120_000);
  const { app, page, profile } = await launch();
  try {
    await expect(page.locator("aside.bg-sidebar")).toBeVisible();

    const leftToRight = await panel(page);
    expect(leftToRight).not.toBeNull();
    // The panel sits at the left of the window and the rule is on its right edge.
    expect(leftToRight.left).toBeLessThan(4);
    expect(leftToRight.borderRight).toBe("1px");
    expect(leftToRight.borderLeft).toBe("0px");
    const arrowLeftToRight = await arrow(page);
    expect(arrowLeftToRight).not.toBeNull();
    // Written from the left, the arrow keeps the way it was drawn.
    expect(arrowLeftToRight.rotate).toBe("none");

    await flip(page);

    // And now it sits at the right, with the rule on the other edge.
    await expect.poll(async () => (await panel(page))?.left ?? 0).toBeGreaterThan(
      leftToRight.windowWidth / 2
    );
    const rightToLeft = await panel(page);
    expect(rightToLeft.borderLeft).toBe("1px");
    expect(rightToLeft.borderRight).toBe("0px");

    // The arrow points back.
    const arrowRightToLeft = await arrow(page);
    expect(arrowRightToLeft.rotate).toBe("180deg");
  } finally {
    await quitApp(app, profile);
    rmSync(profile, { recursive: true, force: true });
  }
});

test("the switch slides the other way round too", async () => {
  test.setTimeout(120_000);
  const { app, page, profile } = await launch();
  try {
    await page.getByRole("button", { name: "Settings", exact: true }).first().click();
    await expect(page.getByRole("heading").first()).toBeVisible();
    await page.getByRole("navigation").first().getByRole("button", { name: "Desktop", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Desktop" })).toBeVisible();

    await expect.poll(() => knob(page)).not.toBeNull();
    const leftToRight = await knob(page);
    expect(leftToRight).toContain("16");
    expect(leftToRight).not.toContain("-16");

    await flip(page);

    // The knob travels the other way, so the number it is moved by turns negative.
    await expect.poll(() => knob(page)).toContain("-16");
  } finally {
    await quitApp(app, profile);
    rmSync(profile, { recursive: true, force: true });
  }
});

test("an app that starts in Arabic comes up the other way round", async () => {
  test.setTimeout(120_000);
  const { app, page, profile } = await launch("ar");
  try {
    await expect(page.locator("aside.bg-sidebar")).toBeVisible();

    // The document says which way it runs, without anyone turning it by hand.
    await expect.poll(() => docDir(page)).toBe("rtl");

    const rightToLeft = await panel(page);
    expect(rightToLeft).not.toBeNull();
    // The panel stands at the right of the window and the rule is on its left edge.
    expect(rightToLeft.left).toBeGreaterThan(rightToLeft.windowWidth / 2);
    expect(rightToLeft.borderLeft).toBe("1px");
    expect(rightToLeft.borderRight).toBe("0px");

    // The arrow points back.
    const arrowRightToLeft = await arrow(page);
    expect(arrowRightToLeft).not.toBeNull();
    expect(arrowRightToLeft.rotate).toBe("180deg");
  } finally {
    await quitApp(app, profile);
    rmSync(profile, { recursive: true, force: true });
  }
});
