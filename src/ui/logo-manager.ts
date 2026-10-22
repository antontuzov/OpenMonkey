import * as path from "node:path";
import { assetPath } from "../utils/config";
import { MOODS, MOOD_LOGOS, type Mood } from "../utils/types";
import logger from "../utils/logger";

export type MoodListener = (mood: Mood, logoFilePath: string) => void;

/**
 * Main-process mood state. The spec imported `ipcRenderer` here, which only exists
 * in a renderer; instead the owner (OpenMonkey) subscribes and forwards the change
 * to the tray, the dock, and the React avatar.
 */
export class LogoManager {
  private currentMood: Mood = "neutral";
  private listener: MoodListener | null = null;

  constructor(listener?: MoodListener) {
    this.listener = listener ?? null;
    this.apply("neutral");
  }

  subscribe(listener: MoodListener): void {
    this.listener = listener;
    this.apply(this.currentMood);
  }

  setMood(mood: string): void {
    if (!MOOD_LOGOS[mood as Mood]) {
      logger.warn("logo.mood.unknown", { mood });
      return;
    }
    this.apply(mood as Mood);
  }

  getCurrentMood(): Mood {
    return this.currentMood;
  }

  cycleMood(): Mood {
    const next = MOODS[(MOODS.indexOf(this.currentMood) + 1) % MOODS.length];
    this.apply(next);
    return next;
  }

  getAllMoods(): Mood[] {
    return [...MOODS];
  }

  getLogoPath(mood: Mood): string | undefined {
    return MOOD_LOGOS[mood] ? this.resolveAsset(mood) : undefined;
  }

  private resolveAsset(mood: Mood): string {
    return assetPath("logos", MOOD_LOGOS[mood].file);
  }

  private apply(mood: Mood): void {
    this.currentMood = mood;
    const filePath = path.normalize(this.resolveAsset(mood));
    try {
      this.listener?.(mood, filePath);
    } catch (error) {
      // A broken icon must never take the conversation down with it.
      logger.warn("logo.listener.failed", { mood, error });
    }
  }
}

export default LogoManager;
