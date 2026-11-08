import { app, BrowserWindow, dialog, shell } from "electron";
import { autoUpdater } from "electron-updater";
import { bundleIsSigned } from "../utils/bundle-signature";
import config from "../utils/config";
import logger from "../utils/logger";
import { allowOutboundRequest } from "../utils/network";
import { isInCohort, rolloutBucket, rolloutOf } from "../utils/rollout";
import type { UpdateState } from "../utils/types";
import { installId } from "./install-id";
import { notesFor } from "./release-notes";

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const RELEASES_URL = "https://github.com/antontuzov/OpenMonkey/releases/latest";

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

type Listener = (state: UpdateState) => void;

const listeners = new Set<Listener>();
/** One conversation per release is enough; the check runs every six hours. */
const announced = new Set<string>();

let state: UpdateState = {
  status: "idle",
  currentVersion: app.getVersion(),
  version: null,
  detail: null,
  rollout: null,
  notes: null,
  rollback: null,
};

/** The state as it stands, for a renderer that just opened. */
export function currentUpdateState(): UpdateState {
  return state;
}

/** Every window is told when the state changes, so no one is left behind. */
function broadcast(): void {
  for (const target of BrowserWindow.getAllWindows()) {
    if (!target.isDestroyed()) target.webContents.send("update-state", state);
  }
}

/** Sets the state and tells everyone who asked to hear about it. */
function setState(next: Partial<UpdateState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener(state);
  broadcast();
}

/** Subscribes to the state; the current one arrives at once. */
export function onUpdateState(listener: Listener): () => void {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}

function applyChannel(): void {
  // GitHub Releases serve `latest`; prereleases on the `beta` branch are opt-in.
  autoUpdater.channel = config.get("desktop").updateChannel === "beta" ? "beta" : "latest";
}

/**
 * Looks for a new version now.
 *
 * A build that was never installed cannot update itself, and a build with the
 * network switch off does not go looking: both say so instead of pretending.
 */
export async function checkForUpdates(): Promise<UpdateState> {
  if (!app.isPackaged) {
    setState({ status: "local", version: null, detail: null, rollout: null, notes: null });
    return state;
  }
  if (!allowOutboundRequest("update-check")) {
    setState({ status: "off", version: null, detail: null, rollout: null, notes: null });
    return state;
  }
  applyChannel();
  setState({ status: "checking" });
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    logger.warn("update.check.failed", { error: errorText(error) });
    setState({ status: "failed", detail: errorText(error) });
  }
  return state;
}

/** Restarts into the version that was already downloaded. */
export async function installUpdate(): Promise<void> {
  if (!bundleIsSigned(app.getAppPath())) {
    setState({ status: "blocked", detail: "This build is not signed, so it cannot install a new version." });
    return;
  }
  autoUpdater.quitAndInstall();
}

/** Opens the release page, where the disk image can be fetched by hand. */
export async function openReleasePage(): Promise<void> {
  await shell.openExternal(RELEASES_URL);
}

export function startUpdates(): void {
  if (!app.isPackaged) {
    setState({ status: "local" });
    return;
  }

  const signed = bundleIsSigned(app.getAppPath());
  // The download is started by hand below, so a release can be held back for a
  // share of the installs before anyone fetches it.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = signed;
  // A release is pulled only after it is published; reinstalling an older build is
  // the documented rollback, so the updater never silently downgrades on its own.
  autoUpdater.allowDowngrade = false;
  // The archive keeps one name for every version, so the blockmap of the build that
  // is running and the blockmap of the release on offer are the same file. A patch
  // built from them would not be the release, so the whole archive is fetched.
  autoUpdater.disableDifferentialDownload = true;

  autoUpdater.on("error", (error) => {
    logger.warn("update.error", { error: errorText(error) });
    setState({ status: "failed", detail: errorText(error) });
  });
  autoUpdater.on("update-not-available", () => {
    logger.info("update.none");
    setState({ status: "up-to-date", version: null, detail: null, rollout: null, notes: null });
  });

  autoUpdater.on("update-available", async (info) => {
    const version = String(info.version);
    logger.info("update.available", { version, installed: false });

    // A release can be let out slowly: only a share of the installs is offered it
    // first, and the rest are told it is coming.
    const rollout = rolloutOf(info);
    const bucket = rolloutBucket(installId(), version);
    const offered = isInCohort(bucket, rollout);
    const notes = notesFor(version);

    if (!offered) {
      logger.info("update.held", { version, rollout, bucket });
      setState({ status: "held", version, detail: null, rollout, notes });
      return;
    }

    if (!signed) {
      // Saying nothing would leave the reader believing the app updates itself. One
      // conversation per version is enough; the check runs every six hours.
      setState({ status: "blocked", version, detail: null, rollout, notes });
      if (announced.has(version)) return;
      announced.add(version);
      const { response } = await dialog.showMessageBox({
        type: "info",
        message: `OpenMonkey ${version} is out`,
        detail:
          "This build is not signed with an Apple Developer ID, so macOS will not let it " +
          "replace itself. Download the new disk image instead — your chats stay put.",
        buttons: ["Open the release page", "Later"],
        defaultId: 0,
        cancelId: 1,
      });
      if (response === 0) await shell.openExternal(RELEASES_URL);
      return;
    }

    // The build can install what it fetches, so it fetches it.
    setState({ status: "available", version, detail: null, rollout, notes });
    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      logger.warn("update.download.failed", { error: errorText(error) });
      setState({ status: "failed", version, detail: errorText(error), rollout, notes });
    }
  });

  autoUpdater.on("update-downloaded", async (info) => {
    const version = String(info.version);
    logger.info("update.downloaded", { version });
    if (!signed) {
      // An unsigned build cannot replace itself, so it does not offer to restart
      // into something macOS will refuse to install.
      setState({ status: "blocked", version, rollout: rolloutOf(info), notes: notesFor(version) });
      return;
    }
    setState({ status: "ready", version, detail: null, rollout: rolloutOf(info), notes: notesFor(version) });
    const { response } = await dialog.showMessageBox({
      type: "info",
      message: `OpenMonkey ${version} is ready`,
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
