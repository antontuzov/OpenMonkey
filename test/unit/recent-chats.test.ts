import { test } from "node:test";
import assert from "node:assert/strict";
import { chatLabel, recentChats, RECENT_CHATS_LIMIT } from "../../src/utils/recent-chats";
import type { Conversation } from "../../src/utils/types";

const conversation = (overrides: Partial<Conversation> = {}): Conversation => ({
  id: "conv_1",
  title: "Trip to Lisbon",
  createdAt: new Date("2026-11-01T09:00:00Z"),
  updatedAt: new Date("2026-11-01T09:00:00Z"),
  pinned: false,
  archived: false,
  kind: "chat",
  messageCount: 2,
  preview: "",
  recall: true,
  ...overrides,
});

test("the tray lists the chat that was touched last", () => {
  const chats = recentChats([
    conversation({ id: "old", title: "Old", updatedAt: new Date("2026-11-01T09:00:00Z") }),
    conversation({ id: "new", title: "New", updatedAt: new Date("2026-11-05T09:00:00Z") }),
  ]);

  assert.deepEqual(chats.map((chat) => chat.id), ["new", "old"]);
});

test("a pinned chat comes before a newer one", () => {
  const chats = recentChats([
    conversation({ id: "pinned", title: "Pinned", pinned: true }),
    conversation({ id: "new", title: "New", updatedAt: new Date("2026-11-05T09:00:00Z") }),
  ]);

  assert.deepEqual(chats.map((chat) => chat.id), ["pinned", "new"]);
});

test("a quick ask and an archived chat stay out of the tray", () => {
  const chats = recentChats([
    conversation({ id: "ask", kind: "quick" }),
    conversation({ id: "archived", archived: true }),
    conversation({ id: "chat" }),
  ]);

  assert.deepEqual(chats.map((chat) => chat.id), ["chat"]);
});

test("the tray lists a handful of chats, not the whole history", () => {
  const chats = recentChats(
    Array.from({ length: 12 }, (_, index) =>
      conversation({ id: `conv_${index}`, updatedAt: new Date(2026, 10, 12 - index) })
    )
  );

  assert.equal(chats.length, RECENT_CHATS_LIMIT);
  assert.equal(chats[0].id, "conv_0");
});

test("a long title is cut so the menu stays one line", () => {
  const label = chatLabel("a".repeat(80));

  assert.equal(label.length, 48);
  assert.match(label, /…$/);
});

test("a short title is left as it is", () => {
  assert.equal(chatLabel("  Trip to Lisbon  "), "Trip to Lisbon");
});
