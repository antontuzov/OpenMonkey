import { app, dialog } from "electron";
import { autoUpdater } from "electron-updater";
import config from "../utils/config";
import logger from "../utils/logger";
import { networkAllowed } from "../utils/network";

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

function applyChannel(): void {
  // GitHub Releases serve `latest`; prereleases on the `beta` branch are opt-in.
  autoUpdater.channel = config.get("desktop").updateChannel === "beta" ? "beta" : "latest";
}

/** App-initiated traffic obeys the same switch as downloads and page fetches. */
export async function checkForUpdates(): Promise<void> {
  if (!app.isPackaged || !networkAllowed()) return;
  applyChannel();
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    logger.warn("update.check.failed", { error: errorText(error) });
  }
}

export function startUpdates(): void {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  // A release is pulled only after it is published; reinstalling an older build is
  // the documented rollback, so the updater never silently downgrades on its own.
  autoUpdater.allowDowngrade = false;

  autoUpdater.on("error", (error) => logger.warn("update.error", { error: errorText(error) }));
  autoUpdater.on("update-available", (info) => logger.info("update.available", { version: info.version }));
  autoUpdater.on("update-not-available", () => logger.info("update.none"));
  autoUpdater.on("update-downloaded", async (info) => {
    logger.info("update.downloaded", { version: info.version });
    const { response } = await dialog.showMessageBox({
      type: "info",
      message: `OpenMonkey ${info.version} is ready`,
      detail: "Restart now to finish the update, or keep working — it installs when you quit.",
      buttons: ["Restart now", "Later"],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });

  void checkForUpdates();
  const timer = setInterval(() => void checkForUpdates(), CHECK_INTERVAL_MS);
  timer.unref();
}
