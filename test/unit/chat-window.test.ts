import { test } from "node:test";
import assert from "node:assert/strict";
import {
  averageHeight,
  computeWindow,
  DEFAULT_ESTIMATE_PX,
  shouldFollow,
} from "../../src/renderer/chat-window";

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

test("a chat taller than the window keeps its newest message in view", () => {
  // The reader is at the top of a chat that is far longer than the window:
  // the chat grew at the bottom, so the newest message is still the one asked
  // for.
  assert.equal(
    shouldFollow({ top: 0, max: 40_000, previousTop: 0, following: true }),
    true
  );
});

test("the reader scrolling up stops the chat from following", () => {
  assert.equal(
    shouldFollow({ top: 12_000, max: 40_000, previousTop: 39_000, following: true }),
    false
  );
});

test("a layout that shrinks under the reader does not stop the chat", () => {
  // The content got shorter and the browser pulled the scroll position back:
  // that is the layout moving, not the reader.
  assert.equal(
    shouldFollow({ top: 20_000, max: 20_000, previousTop: 39_000, following: true }),
    true
  );
});

test("the reader scrolling back to the end starts the chat following again", () => {
  assert.equal(
    shouldFollow({ top: 39_950, max: 40_000, previousTop: 12_000, following: false }),
    true
  );
});

test("a reader who scrolled up keeps reading the past", () => {
  assert.equal(
    shouldFollow({ top: 11_000, max: 40_000, previousTop: 12_000, following: false }),
    false
  );
});
