import { Tray, Menu, nativeImage, app, BrowserWindow } from "electron";
import { MOODS, MOOD_LOGOS, type Mood } from "../utils/types";
import logger from "../utils/logger";

const TRAY_SIZE = process.platform === "darwin" ? 18 : 16;

export interface TrayHandlers {
  cycleMood: () => void;
  setMood: (mood: Mood) => void;
}

export class TrayManager {
  private tray: Tray | null = null;
  private currentLogoPath = "";

  constructor(
    private mainWindow: BrowserWindow,
    private handlers: TrayHandlers
  ) {}

  setupTray(initialLogoPath: string): void {
    const icon = this.imageFrom(initialLogoPath);
    if (!icon) return;

    this.tray = new Tray(icon);
    this.currentLogoPath = initialLogoPath;
    this.tray.setToolTip("OpenMonkey - Your Local AI Agent");
    this.tray.setContextMenu(this.buildMenu());
    this.tray.on("click", () => this.toggleWindow());
    this.tray.on("right-click", () => this.tray?.popUpContextMenu());
  }

  private buildMenu(): Menu {
    // The agent owns mood state, so menu items act on it directly instead of asking
    // the renderer to keep a second copy in sync.
    const moodItems: Electron.MenuItemConstructorOptions[] = MOODS.map((mood) => ({
      label: MOOD_LOGOS[mood].label,
      click: () => this.handlers.setMood(mood),
    }));

    return Menu.buildFromTemplate([
      { label: "Open OpenMonkey", click: () => this.showWindow() },
      { type: "separator" },
      { label: "Cycle Mood", click: () => this.handlers.cycleMood() },
      { label: "Moods", submenu: moodItems },
      { label: "Settings", click: () => this.openSettings() },
      { type: "separator" },
      { label: "Quit OpenMonkey", click: () => app.quit() },
    ]);
  }

  /** Called from the agent's mood-change event; keeps tray and dock in sync with the avatar. */
  updateLogo(mood: Mood, logoPath: string): void {
    const icon = this.imageFrom(logoPath);
    if (!icon) {
      logger.warn("tray.icon.missing", { mood, logoPath });
      return;
    }
    this.currentLogoPath = logoPath;

    this.tray?.setImage(icon.resize({ width: TRAY_SIZE, height: TRAY_SIZE }));
    if (process.platform === "darwin") {
      app.dock?.setIcon(icon.resize({ width: 128, height: 128 }));
    }
  }

  /** The tooltip is the only reliable tray feedback; native bubbles need OS opt-in. */
  showMoodChange(mood: Mood): void {
    this.tray?.setToolTip(`OpenMonkey - ${MOOD_LOGOS[mood].label} mode`);
  }

  private imageFrom(filePath: string): Electron.NativeImage | null {
    const image = nativeImage.createFromPath(filePath);
    return image.isEmpty() ? null : image;
  }

  private openSettings(): void {
    this.showWindow();
    this.mainWindow.webContents.send("open-settings");
  }

  private showWindow(): void {
    if (this.mainWindow.isDestroyed()) return;
    this.mainWindow.show();
    this.mainWindow.focus();
  }

  private toggleWindow(): void {
    if (this.mainWindow.isDestroyed()) return;
    if (this.mainWindow.isVisible() && this.mainWindow.isFocused()) this.mainWindow.hide();
    else this.showWindow();
  }

  get logoPath(): string {
    return this.currentLogoPath;
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = null;
  }
}

export default TrayManager;
