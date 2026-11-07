import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import config, { dataRoot, resetPatch, resettablePages } from "../../src/utils/config";
import storage from "../../src/utils/storage";
import {
  NETWORK_OFF_MESSAGE,
  allowOutboundRequest,
  assertNetworkAllowed,
  networkActivity,
} from "../../src/utils/network";
import { RESETTABLE_PAGES, type Config, type SettingsPage } from "../../src/utils/types";

const privacy = () => config.get("privacy");
const writePrivacy = (patch: Partial<Config["privacy"]>) =>
  config.set("privacy", { ...privacy(), ...patch });

const original = { privacy: config.get("privacy"), ui: config.get("ui"), system: config.get("system") };

after(() => {
  config.set("privacy", original.privacy);
  config.set("ui", original.ui);
  config.set("system", original.system);
});

beforeEach(() => {
  config.set("privacy", original.privacy);
});

test("every page the settings UI can reset has a defaults patch, and no more", () => {
  assert.deepEqual([...resettablePages()].sort(), [...RESETTABLE_PAGES].sort());
  // `permissions` reports what macOS grants; there is nothing stored to put back.
  assert.equal(RESETTABLE_PAGES.includes("permissions"), false);
  for (const page of RESETTABLE_PAGES) {
    assert.notDeepEqual(resetPatch(page), {}, `${page} resets something`);
  }
  assert.deepEqual(resetPatch("permissions" as SettingsPage), {});
});

test("resetting one page leaves every other choice alone", () => {
  config.set("ui", { ...config.get("ui"), accent: "#ff0000", theme: "dark" });
  writePrivacy({ autoDeleteAfter: 7 });

  config.merge(resetPatch("appearance"));

  assert.equal(config.get("ui").accent, "#3ecf8e");
  assert.equal(config.get("ui").theme, "system");
  assert.equal(privacy().autoDeleteAfter, 7);
});

test("a density written before the themes had their own keeps the density it had", () => {
  // Before the split, one density was written for both themes. A config from then
  // must not come back as two halves of nothing.
  config.set("ui", { ...config.get("ui"), density: "compact" as never });

  assert.deepEqual(config.get("ui").density, { light: "compact", dark: "compact" });

  config.set("ui", { ...config.get("ui"), density: { light: "compact", dark: "comfortable" } });
  assert.deepEqual(config.get("ui").density, { light: "compact", dark: "comfortable" });
});

test("the model page owns only the generation settings", () => {
  config.set("ui", { ...config.get("ui"), language: "ru" });
  config.set("model", { provider: "mlx", temperature: 1.9, maxTokens: 4096 });

  config.merge(resetPatch("model"));

  assert.deepEqual(config.get("model"), { provider: "auto", temperature: 0.7, maxTokens: 2048 });
  assert.equal(config.get("ui").language, "ru");
});

test("a reset patch never reaches the bookkeeping the app keeps for itself", () => {
  assert.equal("system" in resetPatch("privacy"), false);
  for (const page of RESETTABLE_PAGES) {
    assert.equal("system" in resetPatch(page), false, `${page} leaves system alone`);
  }
});

test("the database size is the file on disk, write-ahead log included", () => {
  storage.init();
  const chat = storage.createConversation("Size");
  storage.saveMessage(chat.id, {
    id: "msg_size",
    role: "user",
    content: "a body long enough to move the file by more than a handful of bytes ".repeat(20),
    timestamp: new Date(),
  });

  const expected = ["", "-wal", "-shm"].reduce((total, suffix) => {
    const file = path.join(dataRoot(), `openmonkey.db${suffix}`);
    return total + (fs.existsSync(file) ? fs.statSync(file).size : 0);
  }, 0);
  const bytes = storage.databaseBytes();

  assert.ok(bytes > 0);
  assert.equal(bytes, expected);
});

test("retention stamps the last prune, and keeping history forever stamps nothing", () => {
  storage.init();
  writePrivacy({ autoDeleteAfter: 30 });
  config.set("system", { ...config.get("system"), lastPruneAt: null });

  storage.runRetention();
  assert.equal(typeof config.get("system").lastPruneAt, "number");

  writePrivacy({ autoDeleteAfter: 0 });
  config.set("system", { ...config.get("system"), lastPruneAt: null });
  storage.runRetention();
  assert.equal(config.get("system").lastPruneAt, null);
});

test("the network gate counts the requests the app would have made", () => {
  const before = networkActivity();
  assert.equal(allowOutboundRequest("test-allowed"), true);
  assert.equal(networkActivity().allowed, before.allowed + 1);
  assert.equal(networkActivity().blocked, before.blocked);

  writePrivacy({ networkAllowed: false });
  const mid = networkActivity();
  assert.equal(allowOutboundRequest("test-blocked"), false);
  assert.equal(networkActivity().blocked, mid.blocked + 1);
  assert.equal(networkActivity().allowed, mid.allowed);

  assert.throws(() => assertNetworkAllowed("test-throws"), new Error(NETWORK_OFF_MESSAGE));
  assert.equal(networkActivity().blocked, mid.blocked + 2);
});
