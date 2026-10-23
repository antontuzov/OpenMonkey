import { BrowserWindow, screen } from "electron";
import Store from "electron-store";

interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
}

const DEFAULTS: WindowState = { width: 1360, height: 860, maximized: false };

const store = new Store<{ main: WindowState }>({
  name: "openmonkey-window",
  defaults: { main: DEFAULTS },
});

/** A saved position is only reused while it still overlaps a connected display. */
function onScreen(bounds: WindowState): boolean {
  if (bounds.x == null || bounds.y == null) return false;
  return screen.getAllDisplays().some(({ workArea }) => {
    const overlapX =
      Math.min(bounds.x! + bounds.width, workArea.x + workArea.width) - Math.max(bounds.x!, workArea.x);
    const overlapY =
      Math.min(bounds.y! + bounds.height, workArea.y + workArea.height) - Math.max(bounds.y!, workArea.y);
    return overlapX >= 160 && overlapY >= 120;
  });
}

export function applyWindowState(window: BrowserWindow): void {
  const saved = store.get("main");
  if (onScreen(saved)) {
    window.setBounds({ x: saved.x, y: saved.y, width: saved.width, height: saved.height });
  }
  if (saved.maximized) window.maximize();

  let timer: NodeJS.Timeout | null = null;
  const save = () => {
    if (window.isDestroyed() || window.isMinimized() || window.isFullScreen()) return;
    const bounds = window.getNormalBounds();
    store.set("main", {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      maximized: window.isMaximized(),
    });
  };
  const debounced = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, 400);
  };

  window.on("resize", debounced);
  window.on("move", debounced);
  window.on("maximize", save);
  window.on("unmaximize", save);
  window.on("close", () => {
    if (timer) clearTimeout(timer);
    save();
  });
}
