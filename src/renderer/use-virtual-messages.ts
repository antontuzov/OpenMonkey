import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { averageHeight, computeWindow, DEFAULT_OVERSCAN, type ChatWindowResult } from "./chat-window";

/** How close to the newest message counts as "the reader is at the end". */
const BOTTOM_SLACK_PX = 96;

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
  /** True when the reader is at the newest message. */
  atBottom: boolean;
  /** Called on every scroll of the chat. */
  onScroll: () => void;
  /** Attach to every message so its height can be measured. */
  measure: (id: string) => (element: HTMLElement | null) => void;
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
  const [scroll, setScroll] = useState({ top: 0, height: 0, atBottom: true });
  const heightsRef = useRef<Record<string, number>>({});
  const elements = useRef(new Map<string, HTMLElement>());
  const observer = useRef<ResizeObserver | null>(null);
  const anchor = useRef<Anchor | null>(null);
  const atBottomRef = useRef(true);
  const resetRef = useRef(resetKey);

  // Another chat means another history: the reader starts at its newest message.
  if (resetRef.current !== resetKey) {
    resetRef.current = resetKey;
    heightsRef.current = {};
    elements.current.clear();
    anchor.current = null;
    atBottomRef.current = true;
    setHeights({});
    setScroll({ top: 0, height: 0, atBottom: true });
  }

  const heightList = useMemo(
    () => messages.map((message) => heights[message.id] ?? 0),
    [messages, heights]
  );
  const estimate = useMemo(() => averageHeight(heightList), [heightList]);

  const window = useMemo(
    () =>
      computeWindow({
        total: messages.length,
        heights: heightList,
        estimate,
        scrollTop: scroll.top,
        viewportHeight: scroll.height,
        atBottom: scroll.atBottom,
        overscan: DEFAULT_OVERSCAN,
      }),
    [messages.length, heightList, estimate, scroll]
  );
  const windowRef = useRef(window);
  windowRef.current = window;

  const onScroll = useCallback(() => {
    const element = containerRef.current;
    if (!element) return;
    const top = element.scrollTop;
    const height = element.clientHeight;
    const atBottom = element.scrollHeight - top - height <= BOTTOM_SLACK_PX;
    atBottomRef.current = atBottom;

    // The window only moves when the reader leaves the messages that are mounted;
    // that is the moment the message under the eye has to be held in place.
    const current = windowRef.current;
    const mountedTop = current.padTop;
    const mountedBottom = current.totalHeight - current.padBottom;
    if (top < mountedTop || top + height > mountedBottom) {
      anchor.current = captureAnchor(element, elements.current);
    }

    setScroll({ top, height, atBottom });
  }, [containerRef]);

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const instance = new ResizeObserver((entries) => {
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
      // The rows around the reader may have moved: hold the message they read.
      anchor.current = anchor.current ?? captureAnchor(containerRef.current, elements.current);
      setHeights(next);
    });
    observer.current = instance;
    return () => {
      instance.disconnect();
      observer.current = null;
    };
  }, [containerRef]);

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

  // After the rows moved, put the message the reader was looking at back where it
  // was — or stay at the newest one when that is where they were.
  useLayoutEffect(() => {
    const mark = anchor.current;
    if (!mark) return;
    anchor.current = null;
    const container = containerRef.current;
    if (!container) return;
    if (atBottomRef.current) {
      container.scrollTop = container.scrollHeight - container.clientHeight;
      return;
    }
    const element = elements.current.get(mark.id);
    if (!element) return;
    const now = element.getBoundingClientRect().top - container.getBoundingClientRect().top;
    const shift = now - mark.delta;
    if (Math.abs(shift) > 0.5) container.scrollTop += shift;
  });

  const measure = useCallback(
    (id: string) => (element: HTMLElement | null) => {
      const previous = elements.current.get(id);
      if (previous && previous !== element) {
        observer.current?.unobserve(previous);
        elements.current.delete(id);
      }
      if (!element) return;
      elements.current.set(id, element);
      observer.current?.observe(element);
    },
    []
  );

  return {
    window,
    atBottom: scroll.atBottom,
    onScroll,
    measure,
  };
}
