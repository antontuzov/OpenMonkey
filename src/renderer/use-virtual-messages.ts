import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import {
  averageHeight,
  computeWindow,
  DEFAULT_ESTIMATE_PX,
  DEFAULT_OVERSCAN,
  followState,
  INITIAL_FOLLOW,
  type ChatWindowResult,
  type FollowState,
} from "./chat-window";

/**
 * One tall answer must not decide the height of a thousand short ones: the
 * guess is only trusted once a few messages have been measured.
 */
const MIN_MEASURED = 3;

/**
 * The message the reader is looking at, and how far below the top of the window
 * it sits. When the rows around it change height, this is what keeps it there.
 */
interface Anchor {
  id: string;
  delta: number;
}

function captureAnchor(
  container: HTMLElement | null,
  elements: Map<string, HTMLElement>
): Anchor | null {
  if (!container) return null;
  const top = container.getBoundingClientRect().top;
  let best: Anchor | null = null;
  for (const [id, element] of elements) {
    const rect = element.getBoundingClientRect();
    if (rect.bottom <= top) continue;
    const delta = rect.top - top;
    if (!best || Math.abs(delta) < Math.abs(best.delta)) best = { id, delta };
  }
  return best;
}

export interface VirtualMessages {
  /** The messages that are mounted, and the space the rest take up. */
  window: ChatWindowResult;
  /** True while the chat keeps its newest message in view. */
  atBottom: boolean;
  /** Called on every scroll of the chat. */
  onScroll: () => void;
  /** Attach to every message so its height can be measured. */
  measure: (id: string) => (element: HTMLElement | null) => void;
  /** Keep the newest message in view: a new answer, or another chat opened. */
  followEnd: () => void;
  /** True while the newest message is being kept in view. */
  followsEnd: () => boolean;
}

/**
 * Mounts only the messages near the reader. A chat with five hundred answers
 * builds the bodies of a screenful, not of five hundred, and the rest are
 * represented by the space they would take.
 */
export function useVirtualMessages(
  messages: Array<{ id: string }>,
  containerRef: RefObject<HTMLDivElement | null>,
  resetKey: string | null
): VirtualMessages {
  const [heights, setHeights] = useState<Record<string, number>>({});
  const [scroll, setScroll] = useState({ top: 0, height: 0, following: true });
  const heightsRef = useRef<Record<string, number>>({});
  const elements = useRef(new Map<string, HTMLElement>());
  const callbacks = useRef(new Map<string, (element: HTMLElement | null) => void>());
  const observed = useRef(new Set<string>());
  const observer = useRef<ResizeObserver | null>(null);
  const anchor = useRef<Anchor | null>(null);
  const follow = useRef<FollowState>(INITIAL_FOLLOW);
  const resetRef = useRef(resetKey);

  // Another chat means another history: the reader starts at its newest message.
  if (resetRef.current !== resetKey) {
    resetRef.current = resetKey;
    heightsRef.current = {};
    for (const [id, element] of elements.current) {
      if (observed.current.has(id)) observer.current?.unobserve(element);
    }
    elements.current.clear();
    observed.current.clear();
    callbacks.current.clear();
    anchor.current = null;
    follow.current = INITIAL_FOLLOW;
    setHeights({});
    setScroll({ top: 0, height: 0, following: true });
  }

  const heightList = useMemo(
    () => messages.map((message) => heights[message.id] ?? 0),
    [messages, heights]
  );
  const estimate = useMemo(() => {
    let measured = 0;
    for (const height of heightList) if (height > 0) measured += 1;
    return measured >= MIN_MEASURED ? averageHeight(heightList) : DEFAULT_ESTIMATE_PX;
  }, [heightList]);

  const window = useMemo(
    () =>
      computeWindow({
        total: messages.length,
        heights: heightList,
        estimate,
        scrollTop: scroll.top,
        viewportHeight: scroll.height,
        atBottom: scroll.following,
        overscan: DEFAULT_OVERSCAN,
      }),
    [messages.length, heightList, estimate, scroll]
  );

  const onScroll = useCallback(() => {
    const element = containerRef.current;
    if (!element) return;
    const top = element.scrollTop;
    const height = element.scrollHeight;
    const viewport = element.clientHeight;
    const next = followState(follow.current, { top, height, viewport });
    follow.current = next;

    if (!next.following) {
      // The reader is in the past: the message under their eye is the one that
      // has to stay put when the rows around it change height.
      anchor.current = captureAnchor(element, elements.current);
    }
    setScroll({ top, height: viewport, following: next.following });
  }, [containerRef]);

  // A message is measured as soon as it is on screen, so the observer has to
  // exist before the first one is attached — a ref callback runs before the
  // passive effects, and a message that was never measured would keep the
  // guessed height for the rest of the session.
  useLayoutEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const instance =
      observer.current ??
      new ResizeObserver((entries) => {
        let changed = false;
        const next = { ...heightsRef.current };
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.messageId;
          if (!id) continue;
          const height = Math.round(
            entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height
          );
          if (next[id] === height) continue;
          next[id] = height;
          changed = true;
        }
        if (!changed) return;
        heightsRef.current = next;
        setHeights(next);
      });
    observer.current = instance;

    for (const [id, element] of elements.current) {
      if (observed.current.has(id)) continue;
      observed.current.add(id);
      instance.observe(element);
    }
  });

  useEffect(
    () => () => {
      observer.current?.disconnect();
      observer.current = null;
      observed.current.clear();
    },
    []
  );

  // The window's own height is needed before the first message can be placed.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    if (typeof ResizeObserver === "undefined") {
      onScroll();
      return;
    }
    const instance = new ResizeObserver(() => onScroll());
    instance.observe(element);
    onScroll();
    return () => instance.disconnect();
  }, [containerRef, onScroll]);

  // The chat keeps its newest message in view until the reader scrolls up to
  // read the past. After the rows moved, the position they asked for is put
  // back: the end of the chat, or the message that was under the eye.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const mark = anchor.current;
    anchor.current = null;

    if (follow.current.following) {
      const top = container.scrollTop;
      const height = container.scrollHeight;
      const viewport = container.clientHeight;
      const next = followState(follow.current, { top, height, viewport });
      if (!next.following) {
        // The reader scrolled up between two frames: the chat stops following,
        // and the anchor keeps them where they are.
        follow.current = next;
        setScroll((current) => ({ ...current, following: false }));
      } else {
        const max = Math.max(0, height - viewport);
        container.scrollTop = max;
        follow.current = { following: true, top: max, height };
      }
    } else if (mark) {
      const element = elements.current.get(mark.id);
      const top = container.getBoundingClientRect().top;
      if (element && element.getBoundingClientRect().bottom > top) {
        const now = element.getBoundingClientRect().top - top;
        const shift = now - mark.delta;
        if (Math.abs(shift) > 0.5) {
          container.scrollTop = Math.max(0, container.scrollTop + shift);
          follow.current = { ...follow.current, top: container.scrollTop };
        }
      }
    }

    if (!follow.current.following) {
      anchor.current = captureAnchor(containerRef.current, elements.current);
    }
  });

  // A ref callback that keeps its identity does not detach and reattach the
  // element on every render, so the observer is not asked to measure the same
  // message again and again.
  const measure = useCallback((id: string) => {
    const existing = callbacks.current.get(id);
    if (existing) return existing;
    const callback = (element: HTMLElement | null) => {
      const previous = elements.current.get(id);
      if (previous && previous !== element) {
        observer.current?.unobserve(previous);
        elements.current.delete(id);
        observed.current.delete(id);
      }
      if (!element) return;
      elements.current.set(id, element);
    };
    callbacks.current.set(id, callback);
    return callback;
  }, []);

  const followEnd = useCallback(() => {
    const element = containerRef.current;
    follow.current = {
      following: true,
      top: element?.scrollTop ?? 0,
      height: element?.scrollHeight ?? 0,
    };
    setScroll((current) => ({ ...current, following: true }));
  }, [containerRef]);

  const followsEnd = useCallback(() => follow.current.following, []);

  return {
    window,
    atBottom: scroll.following,
    onScroll,
    measure,
    followEnd,
    followsEnd,
  };
}
