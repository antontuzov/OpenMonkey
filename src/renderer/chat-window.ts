/**
 * The window of a long chat that is actually on screen. A chat with five hundred
 * messages should not build five hundred message bodies: only the ones near the
 * reader are mounted, and the rest are represented by the space they would take.
 *
 * The maths here is deliberately separate from the component, so it can be proved
 * without a screen.
 */

/** The height assumed for a message that has never been on screen. */
export const DEFAULT_ESTIMATE_PX = 120;

/** The height assumed for the window before the reader has scrolled at all. */
export const DEFAULT_VIEWPORT_PX = 800;

/** How many extra messages to keep mounted above and below the reader. */
export const DEFAULT_OVERSCAN = 6;

/** The measured height of each message, 0 when it has never been on screen. */
export type MessageHeights = number[];

export interface ChatWindowInput {
  /** How many messages the chat holds. */
  total: number;
  /** The measured height of each message, in the order of the chat. */
  heights: MessageHeights;
  /** The height assumed for a message that has not been measured. */
  estimate?: number;
  /** How far down the list the reader is. */
  scrollTop: number;
  /** How tall the window is. */
  viewportHeight: number;
  /** True when the reader is at the newest message and the tail is what matters. */
  atBottom?: boolean;
  /** How many extra messages to keep mounted above and below the reader. */
  overscan?: number;
}

export interface ChatWindowResult {
  /** The first mounted message. */
  start: number;
  /** One past the last mounted message. */
  end: number;
  /** How many messages are mounted. */
  count: number;
  /** The height of the messages above the window. */
  padTop: number;
  /** The height of the messages below the window. */
  padBottom: number;
  /** The height of the whole list, measured or estimated. */
  totalHeight: number;
}

const heightOf = (heights: MessageHeights, index: number, estimate: number): number =>
  heights[index] > 0 ? heights[index] : estimate;

/** The offsets of every message, so a scroll can find what it is looking at. */
function offsetsOf(heights: MessageHeights, total: number, estimate: number): number[] {
  const offsets: number[] = new Array(total + 1);
  offsets[0] = 0;
  for (let index = 0; index < total; index++) {
    offsets[index + 1] = offsets[index] + heightOf(heights, index, estimate);
  }
  return offsets;
}

/**
 * Which messages are mounted, and how much space the ones that are not take up.
 */
export function computeWindow(input: ChatWindowInput): ChatWindowResult {
  const total = Math.max(0, input.total);
  const estimate = input.estimate && input.estimate > 0 ? input.estimate : DEFAULT_ESTIMATE_PX;
  const viewport = input.viewportHeight > 0 ? input.viewportHeight : DEFAULT_VIEWPORT_PX;
  const overscan = Math.max(0, input.overscan ?? DEFAULT_OVERSCAN);
  const heights = input.heights;
  const offsets = offsetsOf(heights, total, estimate);
  const totalHeight = offsets[total];

  if (total === 0) {
    return { start: 0, end: 0, count: 0, padTop: 0, padBottom: 0, totalHeight: 0 };
  }

  let start: number;
  let end: number;

  if (input.atBottom) {
    // The reader wants the newest messages: fill the window from the end.
    let used = 0;
    let index = total - 1;
    while (index >= 0) {
      const height = heightOf(heights, index, estimate);
      if (used > 0 && used + height > viewport) break;
      used += height;
      index -= 1;
    }
    start = Math.max(0, index + 1 - overscan);
    end = total;
  } else {
    const top = Math.max(0, input.scrollTop);
    const bottom = top + viewport;
    // The first message whose bottom is past the top of the reader's view.
    start = 0;
    while (start < total && offsets[start + 1] <= top) start += 1;
    // The first message that begins below the bottom of the view.
    end = start;
    while (end < total && offsets[end] < bottom) end += 1;
    start = Math.max(0, start - overscan);
    end = Math.min(total, end + overscan);
  }

  return {
    start,
    end,
    count: end - start,
    padTop: offsets[start],
    padBottom: Math.max(0, totalHeight - offsets[end]),
    totalHeight,
  };
}

/** How close to the newest message counts as being at the end of the chat. */
export const BOTTOM_SLACK_PX = 96;

/** How far the reader has to move before it counts as a scroll of their own. */
export const READER_SLOP_PX = 12;

export interface FollowState {
  /** True while the chat keeps its newest message in view. */
  following: boolean;
  /** Where the reader was the last time the chat looked. */
  top: number;
  /** How tall the content was the last time the chat looked. */
  height: number;
}

export interface FollowObservation {
  /** Where the reader is now. */
  top: number;
  /** How tall the content is now. */
  height: number;
  /** How tall the window is. */
  viewport: number;
}

/** A chat that has just been opened follows its newest message. */
export const INITIAL_FOLLOW: FollowState = { following: true, top: 0, height: 0 };

/**
 * Whether the chat should keep its newest message in view.
 *
 * A chat grows at the bottom, so the reader is at the end even when the
 * content is taller than the window and the scrollbar is nowhere near the
 * bottom. What stops the chat from following is the reader scrolling up to
 * read the past.
 *
 * The hard part is telling that apart from the layout moving under the
 * reader: when the guess for a message that was never on screen is replaced
 * by its real height, the content gets shorter and the browser pulls the
 * scroll position back. That is not the reader moving, and the chat keeps
 * following. So a move only counts as the reader's when the content did not
 * shrink at the same time.
 */
export function followState(state: FollowState, observation: FollowObservation): FollowState {
  const max = Math.max(0, observation.height - observation.viewport);
  const distance = max - observation.top;
  const movedUp = observation.top < state.top - READER_SLOP_PX;
  const movedDown = observation.top > state.top + READER_SLOP_PX;
  const contentShrank = observation.height < state.height - 1;

  let following = state.following;
  if (movedUp && !contentShrank) following = false;
  else if (movedDown && distance <= BOTTOM_SLACK_PX) following = true;

  return { following, top: observation.top, height: observation.height };
}

/**
 * The average height of the messages that have been measured, which is a better
 * guess for the ones that have not than a fixed number.
 */
export function averageHeight(heights: MessageHeights): number {
  let sum = 0;
  let count = 0;
  for (const height of heights) {
    if (height > 0) {
      sum += height;
      count += 1;
    }
  }
  if (count === 0) return DEFAULT_ESTIMATE_PX;
  const average = sum / count;
  return average > 0 ? average : DEFAULT_ESTIMATE_PX;
}
