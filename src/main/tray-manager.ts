import { Tray, Menu, nativeImage, app, BrowserWindow } from "electron";
import {
  MOODS,
  MOOD_LOGOS,
  type AppLanguage,
  type MenuCommand,
  type Mood,
} from "../utils/types";
import logger from "../utils/logger";

const TRAY_SIZE = process.platform === "darwin" ? 18 : 16;

interface TrayCopy {
  open: string;
  quickAsk: string;
  cycleMood: string;
  moods: string;
  settings: string;
  quit: string;
  tagline: string;
  moodMode: string;
}

const TRAY_COPY: Record<AppLanguage, TrayCopy> = {
  en: {
    open: "Open OpenMonkey",
    quickAsk: "Quick Ask",
    cycleMood: "Cycle Mood",
    moods: "Moods",
    settings: "Settings",
    quit: "Quit OpenMonkey",
    tagline: "Your Local AI Agent",
    moodMode: "{mood} mode",
  },
  ru: {
    open: "Открыть OpenMonkey",
    quickAsk: "Быстрый вопрос",
    cycleMood: "Сменить настроение",
    moods: "Настроения",
    settings: "Настройки",
    quit: "Выйти из OpenMonkey",
    tagline: "Ваш локальный ИИ-агент",
    moodMode: "Режим «{mood}»",
  },
};

export interface TrayHandlers {
  cycleMood: () => void;
  setMood: (mood: Mood) => void;
  quickAsk: () => void;
  showMain: (command?: MenuCommand) => void;
}

export class TrayManager {
  private tray: Tray | null = null;
  private currentLogoPath = "";

  constructor(
    private getWindow: () => BrowserWindow | null,
    private handlers: TrayHandlers,
    private getLanguage: () => AppLanguage
  ) {}

  private get copy(): TrayCopy {
    return TRAY_COPY[this.getLanguage()] ?? TRAY_COPY.en;
  }

  /** Mood names come from the shared table so the tray and the UI never drift. */
  private moodName(mood: Mood): string {
    const logo = MOOD_LOGOS[mood] ?? MOOD_LOGOS.neutral;
    return this.getLanguage() === "ru" ? logo.labelRu : logo.label;
  }

  setupTray(initialLogoPath: string): void {
    const icon = this.imageFrom(initialLogoPath);
    if (!icon) return;

    this.tray = new Tray(icon);
    this.currentLogoPath = initialLogoPath;
    this.tray.setToolTip(`OpenMonkey - ${this.copy.tagline}`);
    this.tray.setContextMenu(this.buildMenu());
    this.tray.on("click", () => this.toggleWindow());
    this.tray.on("right-click", () => this.tray?.popUpContextMenu());
  }

  private buildMenu(): Menu {
    const copy = this.copy;
    // The agent owns mood state, so menu items act on it directly instead of asking
    // the renderer to keep a second copy in sync.
    const moodItems: Electron.MenuItemConstructorOptions[] = MOODS.map((mood) => ({
      label: this.moodName(mood),
      click: () => this.handlers.setMood(mood),
    }));

    return Menu.buildFromTemplate([
      { label: copy.open, click: () => this.handlers.showMain() },
      { label: copy.quickAsk, accelerator: "Alt+Space", registerAccelerator: false, click: () => this.handlers.quickAsk() },
      { type: "separator" },
      { label: copy.cycleMood, click: () => this.handlers.cycleMood() },
      { label: copy.moods, submenu: moodItems },
      { label: copy.settings, click: () => this.handlers.showMain("settings") },
      { type: "separator" },
      { label: copy.quit, click: () => app.quit() },
    ]);
  }

  /** Language lives in settings, so the tray menu has to follow a config change. */
  refreshMenu(): void {
    if (!this.tray) return;
    this.tray.setContextMenu(this.buildMenu());
    this.tray.setToolTip(`OpenMonkey - ${this.copy.tagline}`);
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
    this.tray?.setToolTip(
      `OpenMonkey - ${this.copy.moodMode.replace("{mood}", this.moodName(mood))}`
    );
  }

  private imageFrom(filePath: string): Electron.NativeImage | null {
    const image = nativeImage.createFromPath(filePath);
    return image.isEmpty() ? null : image;
  }

  private showWindow(): void {
    const window = this.getWindow();
    if (!window || window.isDestroyed()) {
      this.handlers.showMain();
      return;
    }
    window.show();
    window.focus();
  }

  private toggleWindow(): void {
    const window = this.getWindow();
    if (!window || window.isDestroyed()) {
      this.handlers.showMain();
      return;
    }
    if (window.isVisible() && window.isFocused()) window.hide();
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
