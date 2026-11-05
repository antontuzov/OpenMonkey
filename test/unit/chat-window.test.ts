import { test } from "node:test";
import assert from "node:assert/strict";
import { averageHeight, computeWindow, DEFAULT_ESTIMATE_PX } from "../../src/renderer/chat-window";

test("an empty chat mounts nothing", () => {
  const window = computeWindow({
    total: 0,
    heights: [],
    scrollTop: 0,
    viewportHeight: 800,
  });
  assert.equal(window.count, 0);
  assert.equal(window.padTop, 0);
  assert.equal(window.padBottom, 0);
  assert.equal(window.totalHeight, 0);
});

test("a short chat mounts every message", () => {
  const window = computeWindow({
    total: 4,
    heights: [0, 0, 0, 0],
    scrollTop: 0,
    viewportHeight: 800,
  });
  assert.equal(window.start, 0);
  assert.equal(window.end, 4);
  assert.equal(window.count, 4);
});

test("a long chat mounts a screenful, not the whole history", () => {
  const window = computeWindow({
    total: 500,
    heights: new Array(500).fill(0),
    scrollTop: 0,
    viewportHeight: 800,
    atBottom: true,
  });
  assert.equal(window.end, 500, "the newest message is always mounted");
  assert.ok(window.count <= 20, `mounted ${window.count} messages`);
  assert.ok(window.padTop > 0, "the messages that are not mounted still take space");
  assert.equal(window.padBottom, 0);
});

test("the reader at the bottom is given the newest messages", () => {
  const window = computeWindow({
    total: 500,
    heights: new Array(500).fill(0),
    scrollTop: 0,
    viewportHeight: 800,
    atBottom: true,
  });
  assert.ok(window.start > 400, `the window starts at ${window.start}`);
  assert.equal(window.end, 500);
});

test("the reader in the middle is given the messages around them", () => {
  const window = computeWindow({
    total: 500,
    heights: new Array(500).fill(0),
    scrollTop: 100 * 120,
    viewportHeight: 800,
  });
  assert.ok(window.start <= 100, `the window starts at ${window.start}`);
  assert.ok(window.end >= 106, `the window ends at ${window.end}`);
  assert.ok(window.count <= 20, `mounted ${window.count} messages`);
});

test("the space above and below the window stands in for the messages not mounted", () => {
  const window = computeWindow({
    total: 100,
    heights: new Array(100).fill(0),
    scrollTop: 40 * 120,
    viewportHeight: 600,
  });
  assert.equal(window.padTop + window.padBottom + window.count * DEFAULT_ESTIMATE_PX, 12000);
});

test("a message that has been measured is taller than the guess", () => {
  const heights = new Array(10).fill(0);
  heights[0] = 400;
  const window = computeWindow({
    total: 10,
    heights,
    scrollTop: 0,
    viewportHeight: 800,
    atBottom: true,
  });
  assert.equal(window.totalHeight, 400 + 9 * DEFAULT_ESTIMATE_PX);
});

test("the guess follows the messages that have been measured", () => {
  assert.equal(averageHeight([0, 0, 0]), DEFAULT_ESTIMATE_PX);
  assert.equal(averageHeight([100, 200]), 150);
  assert.equal(averageHeight([0, 300, 100]), 200);
});
