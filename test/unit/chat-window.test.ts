import { test } from "node:test";
import assert from "node:assert/strict";
import {
  averageHeight,
  computeWindow,
  DEFAULT_ESTIMATE_PX,
  followState,
  INITIAL_FOLLOW,
  type FollowState,
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

/** The chat is 40,000 px of content in an 800 px window. */
const TALL = { height: 40_800, viewport: 800 };

/** The state of a chat that is following its newest message at the bottom. */
const AT_END: FollowState = { following: true, top: 39_000, height: 40_800 };

test("a chat taller than the window keeps its newest message in view", () => {
  // The reader is at the top of a chat that is far longer than the window:
  // the chat grew at the bottom, so the newest message is still the one asked
  // for.
  const next = followState(INITIAL_FOLLOW, { top: 0, ...TALL });
  assert.equal(next.following, true);
});

test("the reader scrolling up stops the chat from following", () => {
  const next = followState(AT_END, { top: 12_000, ...TALL });
  assert.equal(next.following, false);
});

test("a layout that shrinks under the reader does not stop the chat", () => {
  // The content got shorter and the browser pulled the scroll position back:
  // that is the layout moving, not the reader.
  const next = followState(AT_END, { top: 20_000, height: 20_800, viewport: 800 });
  assert.equal(next.following, true);
});

test("a layout that grows under the reader does not stop the chat", () => {
  const next = followState(AT_END, { top: 39_000, height: 60_800, viewport: 800 });
  assert.equal(next.following, true);
});

test("a scroll of a few pixels is not the reader leaving", () => {
  const next = followState(AT_END, { top: 38_995, ...TALL });
  assert.equal(next.following, true);
});

test("the reader scrolling back to the end starts the chat following again", () => {
  const state: FollowState = { following: false, top: 12_000, height: 40_800 };
  const next = followState(state, { top: 39_950, ...TALL });
  assert.equal(next.following, true);
});

test("a reader who scrolled up keeps reading the past", () => {
  const state: FollowState = { following: false, top: 12_000, height: 40_800 };
  const next = followState(state, { top: 11_000, ...TALL });
  assert.equal(next.following, false);
});

test("a reader who scrolls down into the history keeps reading the past", () => {
  const state: FollowState = { following: false, top: 12_000, height: 40_800 };
  const next = followState(state, { top: 15_000, ...TALL });
  assert.equal(next.following, false);
});

test("the chat remembers where the reader was", () => {
  const next = followState(AT_END, { top: 30_000, ...TALL });
  assert.equal(next.top, 30_000);
  assert.equal(next.height, 40_800);
});
