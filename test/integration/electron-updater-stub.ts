import { EventEmitter } from "node:events";

/**
 * electron-updater's singleton with its network feed removed: `src/main/updater.ts`
 * only configures this object and reacts to its events, so a test can drive both sides
 * and count what the app did. esbuild aliases the `electron-updater` import here.
 */
export class FakeAutoUpdater extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  allowDowngrade = true;
  disableDifferentialDownload = false;
  channel = "latest";
  checkCalls = 0;
  quitCalls = 0;
  downloadCalls = 0;
  updateInfoAndProvider: unknown = null;

  checkForUpdates() {
    this.checkCalls += 1;
    return Promise.resolve({ version: "9.9.9" });
  }

  /** The real updater refuses to download before a check has found something. */
  downloadUpdate() {
    this.downloadCalls += 1;
    return Promise.resolve(["/tmp/OpenMonkey-arm64.zip"]);
  }

  quitAndInstall() {
    this.quitCalls += 1;
  }
}

export const autoUpdater = new FakeAutoUpdater();

/** Start a test with the object in a known state and last run's listeners gone. */
export function resetAutoUpdater(): void {
  autoUpdater.removeAllListeners();
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = true;
  autoUpdater.disableDifferentialDownload = false;
  autoUpdater.updateInfoAndProvider = null;
  autoUpdater.checkCalls = 0;
  autoUpdater.quitCalls = 0;
  autoUpdater.downloadCalls = 0;
}
