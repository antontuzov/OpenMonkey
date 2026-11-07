import { test } from "node:test";
import assert from "node:assert/strict";
import { TrayManager } from "../../src/main/tray-manager";
import { trays } from "./electron-stub.mjs";

interface MenuItem {
  label?: string;
  type?: string;
  enabled?: boolean;
  click?: () => void;
  submenu?: MenuItem[];
}

interface Harness {
  manager: TrayManager;
  opened: string[];
  started: number;
  chats: { id: string; title: string }[];
}

const makeTray = (): Harness => {
  const state: Harness = {
    manager: null as unknown as TrayManager,
    opened: [],
    started: 0,
    chats: [],
  };
  state.manager = new TrayManager(
    () => null,
    {
      cycleMood: () => undefined,
      setMood: () => undefined,
      quickAsk: () => undefined,
      showMain: () => undefined,
      newChat: () => {
        state.started += 1;
      },
      recentChats: () => state.chats,
      openConversation: (id) => state.opened.push(id),
    },
    () => "en"
  );
  return state;
};

/** The menu the tray is showing right now. */
const menuOf = (): MenuItem[] => {
  const tray = trays[trays.length - 1];
  return (tray.menu as { template: MenuItem[] }).template;
};

const item = (template: MenuItem[], label: string): MenuItem | undefined =>
  template.find((entry) => entry.label === label);

test("the tray starts a new chat without opening the window first", () => {
  const harness = makeTray();
  harness.manager.setupTray("/tmp/monkey.png");

  item(menuOf(), "New Chat")?.click?.();

  assert.equal(harness.started, 1);
});

test("the tray lists the recent chats and opens the one that is picked", () => {
  const harness = makeTray();
  harness.chats = [
    { id: "conv_1", title: "Trip to Lisbon" },
    { id: "conv_2", title: "Reading list" },
  ];
  harness.manager.setupTray("/tmp/monkey.png");

  const recent = item(menuOf(), "Recent Chats");
  assert.deepEqual(recent?.submenu?.map((entry) => entry.label), ["Trip to Lisbon", "Reading list"]);

  recent?.submenu?.[1].click?.();
  assert.deepEqual(harness.opened, ["conv_2"]);
});

test("an empty history says so instead of showing an empty menu", () => {
  const harness = makeTray();
  harness.manager.setupTray("/tmp/monkey.png");

  const recent = item(menuOf(), "Recent Chats");
  assert.equal(recent?.submenu?.length, 1);
  assert.equal(recent?.submenu?.[0].label, "No chats yet");
  assert.equal(recent?.submenu?.[0].enabled, false);
});

test("the list of chats is fresh every time the menu opens", () => {
  const harness = makeTray();
  harness.chats = [{ id: "conv_1", title: "Trip to Lisbon" }];
  harness.manager.setupTray("/tmp/monkey.png");

  const tray = trays[trays.length - 1];
  harness.chats = [{ id: "conv_2", title: "Reading list" }];
  tray.emit("right-click");

  assert.deepEqual(
    item(menuOf(), "Recent Chats")?.submenu?.map((entry) => entry.label),
    ["Reading list"]
  );
  assert.equal(tray.popped, 1);
});

test("the tray speaks Russian when the app does", () => {
  const manager = new TrayManager(
    () => null,
    {
      cycleMood: () => undefined,
      setMood: () => undefined,
      quickAsk: () => undefined,
      showMain: () => undefined,
      newChat: () => undefined,
      recentChats: () => [],
      openConversation: () => undefined,
    },
    () => "ru"
  );
  manager.setupTray("/tmp/monkey.png");

  const template = menuOf();
  assert.ok(item(template, "Новый чат"));
  assert.ok(item(template, "Недавние чаты"));
});
