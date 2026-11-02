import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fuzzyScore, rankPalette, type PaletteCandidate } from "../../src/renderer/command-palette";
import { setLanguage } from "../../src/renderer/i18n";

before(() => {
  Reflect.set(globalThis, "document", { documentElement: {} });
});
after(() => {
  setLanguage("en");
  Reflect.deleteProperty(globalThis, "document");
});

const candidate = (over: Partial<PaletteCandidate> & { id: string }): PaletteCandidate => ({
  label: over.id,
  group: "chats",
  action: { kind: "command", command: "new-chat" },
  ...over,
});

const CANDIDATES: PaletteCandidate[] = [
  candidate({
    id: "chat:1",
    label: "Trip to Lisbon",
    detail: "flights, hotels and a week of food",
    action: { kind: "chat", conversationId: "1" },
  }),
  candidate({
    id: "chat:2",
    label: "New conversation",
    action: { kind: "chat", conversationId: "2" },
  }),
  candidate({
    id: "page:privacy",
    label: "Privacy",
    group: "settings",
    keywords: ["settings", "page"],
    action: { kind: "setting", page: "privacy" },
  }),
  candidate({
    id: "setting:key",
    label: "History key",
    group: "settings",
    keywords: ["keychain", "safe storage", "aes"],
    action: { kind: "setting", page: "privacy", label: "History key" },
  }),
  candidate({
    id: "action:new",
    label: "New chat",
    group: "actions",
    keywords: ["conversation", "start"],
    action: { kind: "command", command: "new-chat" },
  }),
];

test("a word that is really there scores higher than one that is not", () => {
  assert.ok(fuzzyScore("lisbon", "Trip to Lisbon") > 0);
  assert.equal(fuzzyScore("lisbon", "Trip to Kyoto"), 0);
  assert.equal(fuzzyScore("", "Trip to Lisbon"), 0);
});

test("a word that starts a line beats the same word in the middle of it", () => {
  assert.ok(fuzzyScore("key", "Keychain") > fuzzyScore("key", "Monkey key"));
});

test("letters in order reach a word they only skip through", () => {
  assert.ok(fuzzyScore("ncon", "New conversation") > 0);
  assert.equal(fuzzyScore("nvc", "Nothing here"), 0);
});

test("a single letter reaches nothing but itself", () => {
  assert.equal(fuzzyScore("z", "New conversation"), 0);
  assert.ok(fuzzyScore("n", "New conversation") > 0);
});

test("the palette ranks the best match first", () => {
  const hits = rankPalette("lisbon", CANDIDATES);
  assert.equal(hits[0]?.id, "chat:1");
});

test("the palette reaches a row by a word nobody sees on screen", () => {
  const hits = rankPalette("keychain", CANDIDATES);
  assert.equal(hits[0]?.id, "setting:key");
});

test("the words on screen beat the ones that only reach an entry sideways", () => {
  const hits = rankPalette("panel", [
    candidate({
      id: "setting:activity",
      label: "Toggle activity",
      group: "settings",
      keywords: ["shortcut", "panel"],
      action: { kind: "setting", page: "desktop", label: "Toggle activity" },
    }),
    candidate({
      id: "action:panel",
      label: "Toggle activity panel",
      group: "actions",
      action: { kind: "command", command: "toggle-panel" },
    }),
  ]);
  assert.equal(hits[0]?.id, "action:panel");
});

test("a chat comes before an action of the same score", () => {
  const hits = rankPalette("new", [
    candidate({
      id: "action:new",
      label: "New chat",
      group: "actions",
      action: { kind: "command", command: "new-chat" },
    }),
    candidate({
      id: "chat:new",
      label: "New chat",
      group: "chats",
      action: { kind: "chat", conversationId: "9" },
    }),
  ]);
  assert.equal(hits[0]?.id, "chat:new");
});

test("an empty query asks for nothing", () => {
  assert.deepEqual(rankPalette("", CANDIDATES), []);
  assert.deepEqual(rankPalette("   ", CANDIDATES), []);
});

test("the palette stops at the requested number of results", () => {
  assert.equal(rankPalette("a", CANDIDATES, 2).length <= 2, true);
  assert.equal(rankPalette("e", CANDIDATES, 3).length <= 3, true);
});

test("the palette speaks Russian too", () => {
  setLanguage("ru");
  try {
    const hits = rankPalette("история", [
      candidate({
        id: "setting:history",
        label: "История",
        group: "settings",
        action: { kind: "setting", page: "privacy", label: "История" },
      }),
    ]);
    assert.equal(hits[0]?.id, "setting:history");
  } finally {
    setLanguage("en");
  }
});
