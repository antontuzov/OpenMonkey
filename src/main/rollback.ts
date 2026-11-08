import fs from "node:fs";
import path from "node:path";
import { app, session, shell, type DownloadItem } from "electron";
import { allowOutboundRequest, NETWORK_OFF_MESSAGE } from "../utils/network";
import { pickPreviousRelease, type GitHubRelease } from "../utils/rollback";
import type { RollbackResult, RollbackTarget } from "../utils/types";

const REPO = "antontuzov/OpenMonkey";
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases?per_page=30`;

/** The releases this project has published, newest first. */
async function publishedReleases(): Promise<GitHubRelease[]> {
  const response = await fetch(RELEASES_API, {
    headers: { accept: "application/vnd.github+json" },
  });
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
  const body = (await response.json()) as unknown;
  return Array.isArray(body) ? (body as GitHubRelease[]) : [];
}

/** The build to go back to, when there is one. */
async function previousRelease(): Promise<RollbackTarget | null> {
  try {
    const releases = await publishedReleases();
    return pickPreviousRelease(releases, app.getVersion());
  } catch {
    return null;
  }
}

/** The build to go back to, when there is one and the network is on. */
export async function findRollbackTarget(): Promise<RollbackTarget | null> {
  if (!allowOutboundRequest("update-check")) return null;
  return previousRelease();
}

/**
 * Fetches a file to the Downloads folder.
 *
 * The name carries the version, so the older disk image never overwrites the one
 * the reader downloaded for the version they are on.
 */
async function downloadTo(url: string, savePath: string): Promise<void> {
  const ses = session.defaultSession;
  await new Promise<void>((resolve, reject) => {
    const onWillDownload = (_event: Electron.Event, item: DownloadItem) => {
      item.setSavePath(savePath);
      item.once("done", (_doneEvent, state) => {
        ses.removeListener("will-download", onWillDownload);
        if (state === "completed") resolve();
        else reject(new Error("The download did not finish."));
      });
    };
    ses.on("will-download", onWillDownload);
    try {
      ses.downloadURL(url);
    } catch (error) {
      ses.removeListener("will-download", onWillDownload);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/**
 * Fetches the older build and hands it to the reader.
 *
 * An unsigned build cannot replace itself, so the app does not try: the disk image
 * is fetched and opened, and the reader drags the app over the old one. Their chats
 * are in the data folder either way and are not touched.
 */
export async function downloadRollback(target: RollbackTarget): Promise<RollbackResult> {
  try {
    const downloads = app.getPath("downloads");
    fs.mkdirSync(downloads, { recursive: true });
    const file = path.join(downloads, `OpenMonkey-${target.version}-arm64.dmg`);
    await downloadTo(target.url, file);
    // The disk image is mounted so the app can be dragged out of it.
    await shell.openPath(file);
    return { ok: true, path: file };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function startRollback(): Promise<RollbackResult> {
  if (!allowOutboundRequest("update-check")) {
    return { ok: false, error: NETWORK_OFF_MESSAGE };
  }
  const target = await previousRelease();
  if (!target) {
    return { ok: false, error: "There is no earlier release to go back to." };
  }
  return downloadRollback(target);
}
