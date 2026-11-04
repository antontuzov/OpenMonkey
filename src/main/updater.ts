import { app, dialog, shell } from "electron";
import { autoUpdater } from "electron-updater";
import { bundleIsSigned } from "../utils/bundle-signature";
import config from "../utils/config";
import logger from "../utils/logger";
import { allowOutboundRequest } from "../utils/network";

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const RELEASES_URL = "https://github.com/antontuzov/OpenMonkey/releases/latest";

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

function applyChannel(): void {
  // GitHub Releases serve `latest`; prereleases on the `beta` branch are opt-in.
  autoUpdater.channel = config.get("desktop").updateChannel === "beta" ? "beta" : "latest";
}

/** App-initiated traffic obeys the same switch as downloads and page fetches. */
export async function checkForUpdates(): Promise<void> {
  if (!app.isPackaged || !allowOutboundRequest("update-check")) return;
  applyChannel();
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    logger.warn("update.check.failed", { error: errorText(error) });
  }
}

export function startUpdates(): void {
  if (!app.isPackaged) return;

  const signed = bundleIsSigned(app.getAppPath());
  autoUpdater.autoDownload = signed;
  autoUpdater.autoInstallOnAppQuit = signed;
  // A release is pulled only after it is published; reinstalling an older build is
  // the documented rollback, so the updater never silently downgrades on its own.
  autoUpdater.allowDowngrade = false;

  autoUpdater.on("error", (error) => logger.warn("update.error", { error: errorText(error) }));
  autoUpdater.on("update-not-available", () => logger.info("update.none"));

  if (!signed) {
    // Saying nothing would leave the reader believing the app updates itself. One
    // conversation per version is enough; the check runs every six hours.
    const announced = new Set<string>();
    autoUpdater.on("update-available", async (info) => {
      logger.info("update.available", { version: info.version, installed: false });
      if (announced.has(info.version)) return;
      announced.add(info.version);
      const { response } = await dialog.showMessageBox({
        type: "info",
        message: `OpenMonkey ${info.version} is out`,
        detail:
          "This build is not signed with an Apple Developer ID, so macOS will not let it " +
          "replace itself. Download the new disk image instead — your chats stay put.",
        buttons: ["Open the release page", "Later"],
        defaultId: 0,
        cancelId: 1,
      });
      if (response === 0) await shell.openExternal(RELEASES_URL);
    });
  } else {
    autoUpdater.on("update-available", (info) => logger.info("update.available", { version: info.version }));
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
  }

  void checkForUpdates();
  const timer = setInterval(() => void checkForUpdates(), CHECK_INTERVAL_MS);
  timer.unref();
}
